-- Saha Dağıtım v1: schema, functions, RLS.
-- Rules: no deletes (zones are archived, assignments are ended, people are deactivated).
-- All writes from the app go through the security definer functions below.

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null check (length(btrim(full_name)) > 0),
  phone      text not null unique check (phone ~ '^\+905[0-9]{9}$'),
  role       text not null default 'worker' check (role in ('admin', 'worker')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.zones (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  color       text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  note        text,
  geom        extensions.geometry(Polygon, 4326) not null,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);

create index zones_geom_gist on public.zones using gist (geom);

create table public.assignments (
  id          uuid primary key default gen_random_uuid(),
  zone_id     uuid not null references public.zones (id),
  worker_id   uuid not null references public.profiles (id),
  assigned_by uuid references public.profiles (id),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  check (ended_at is null or ended_at >= started_at)
);

-- ended_at null = active. At most one active row per (zone, worker).
create unique index assignments_active_unique
  on public.assignments (zone_id, worker_id) where ended_at is null;
create index assignments_active_worker
  on public.assignments (worker_id) where ended_at is null;
create index assignments_active_zone
  on public.assignments (zone_id) where ended_at is null;

-- ---------------------------------------------------------------------------
-- Helpers (security definer so RLS policies can use them without recursion)
-- ---------------------------------------------------------------------------

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and active
  );
$$;

create function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active
  );
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- Admin (active): read/insert/update on all three tables. No delete policies.
-- Worker (active): read own profile, own active assignments, and
--   non-archived zones with an active assignment of theirs. No writes.
-- Inactive users and signed-out clients: nothing.
-- ---------------------------------------------------------------------------

alter table public.profiles    enable row level security;
alter table public.zones       enable row level security;
alter table public.assignments enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (public.is_admin() or (id = (select auth.uid()) and public.is_active_user()));

create policy profiles_admin_insert on public.profiles
  for insert to authenticated with check (public.is_admin());

create policy profiles_admin_update on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy assignments_select on public.assignments
  for select to authenticated
  using (
    public.is_admin()
    or (worker_id = (select auth.uid()) and ended_at is null and public.is_active_user())
  );

create policy assignments_admin_insert on public.assignments
  for insert to authenticated with check (public.is_admin());

create policy assignments_admin_update on public.assignments
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- The subquery on assignments is itself filtered by assignments_select, which
-- never references zones, so there is no policy cycle.
create policy zones_select on public.zones
  for select to authenticated
  using (
    public.is_admin()
    or (
      archived_at is null
      and public.is_active_user()
      and exists (
        select 1 from public.assignments a
        where a.zone_id = zones.id
          and a.worker_id = (select auth.uid())
          and a.ended_at is null
      )
    )
  );

create policy zones_admin_insert on public.zones
  for insert to authenticated with check (public.is_admin());

create policy zones_admin_update on public.zones
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Table privileges: signed-out clients may only select (and get 0 rows from RLS);
-- nobody but the service role may delete or truncate.
revoke insert, update, delete, truncate, references, trigger on public.profiles, public.zones, public.assignments from anon;
revoke delete, truncate, references, trigger on public.profiles, public.zones, public.assignments from authenticated;

-- ---------------------------------------------------------------------------
-- View
-- ---------------------------------------------------------------------------

create view public.zones_geojson
with (security_invoker = true)
as
select
  z.id,
  z.name,
  z.color,
  z.note,
  extensions.st_asgeojson(z.geom)::jsonb as geojson,
  (
    select count(*)::int from public.assignments a
    where a.zone_id = z.id and a.ended_at is null
  ) as active_count
from public.zones z
where z.archived_at is null;

revoke insert, update, delete, truncate, references, trigger on public.zones_geojson from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Write functions (admin only)
-- ---------------------------------------------------------------------------

create function public.save_zone(
  p_id uuid,
  p_name text,
  p_color text,
  p_note text,
  p_geojson jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_geom geometry;
  v_id   uuid;
begin
  if not public.is_admin() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'Bölge adı gerekli';
  end if;

  if p_color is null or p_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Geçersiz renk';
  end if;

  if p_geojson is null or jsonb_typeof(p_geojson) <> 'object' or p_geojson ->> 'type' is distinct from 'Polygon' then
    raise exception 'Geçersiz bölge şekli';
  end if;

  begin
    v_geom := st_setsrid(st_geomfromgeojson(p_geojson::text), 4326);
  exception when others then
    raise exception 'Geçersiz bölge şekli';
  end;

  if v_geom is null
     or geometrytype(v_geom) <> 'POLYGON'
     or st_isempty(v_geom)
     or not st_isvalid(v_geom)
     or st_xmin(v_geom) < -180 or st_xmax(v_geom) > 180
     or st_ymin(v_geom) < -90  or st_ymax(v_geom) > 90 then
    raise exception 'Geçersiz bölge şekli';
  end if;

  if p_id is null then
    insert into public.zones (name, color, note, geom, created_by)
    values (v_name, p_color, v_note, v_geom, auth.uid())
    returning id into v_id;
  else
    update public.zones
       set name = v_name, color = p_color, note = v_note, geom = v_geom, updated_at = now()
     where id = p_id and archived_at is null
    returning id into v_id;

    if v_id is null then
      raise exception 'Bölge bulunamadı';
    end if;
  end if;

  return v_id;
end;
$$;

create function public.archive_zone(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;

  if not exists (select 1 from public.zones where id = p_id) then
    raise exception 'Bölge bulunamadı';
  end if;

  update public.zones
     set archived_at = now(), updated_at = now()
   where id = p_id and archived_at is null;

  update public.assignments
     set ended_at = now()
   where zone_id = p_id and ended_at is null;
end;
$$;

create function public.assign_worker(p_worker uuid, p_zone uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;

  -- Row locks serialize against concurrent archive_zone / deactivation.
  perform 1 from public.profiles
   where id = p_worker and role = 'worker' and active
   for share;
  if not found then
    raise exception 'Kişi bulunamadı ya da pasif';
  end if;

  perform 1 from public.zones
   where id = p_zone and archived_at is null
   for share;
  if not found then
    raise exception 'Bölge bulunamadı ya da arşivlenmiş';
  end if;

  -- Already active -> no-op (also safe under concurrent double drops).
  insert into public.assignments (zone_id, worker_id, assigned_by)
  values (p_zone, p_worker, auth.uid())
  on conflict (zone_id, worker_id) where ended_at is null do nothing;
end;
$$;

create function public.unassign_worker(p_worker uuid, p_zone uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;

  update public.assignments
     set ended_at = now()
   where worker_id = p_worker and zone_id = p_zone and ended_at is null;
end;
$$;

create function public.move_worker(p_worker uuid, p_from uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;

  if p_from is distinct from p_to then
    perform public.unassign_worker(p_worker, p_from);
  end if;
  -- Raises (and rolls back the unassign) if the worker or target zone is invalid.
  perform public.assign_worker(p_worker, p_to);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: never callable by signed-out clients.
-- ---------------------------------------------------------------------------

revoke execute on function
  public.is_admin(),
  public.is_active_user(),
  public.save_zone(uuid, text, text, text, jsonb),
  public.archive_zone(uuid),
  public.assign_worker(uuid, uuid),
  public.unassign_worker(uuid, uuid),
  public.move_worker(uuid, uuid, uuid)
from public, anon;

grant execute on function
  public.is_admin(),
  public.is_active_user(),
  public.save_zone(uuid, text, text, text, jsonb),
  public.archive_zone(uuid),
  public.assign_worker(uuid, uuid),
  public.unassign_worker(uuid, uuid),
  public.move_worker(uuid, uuid, uuid)
to authenticated, service_role;
