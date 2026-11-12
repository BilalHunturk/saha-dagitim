-- Final review fixes.
--
-- 1. save_zone: a new zone can be created under a client-generated id (p_create = true), so a
--    "Kaydet" retried after a lost response updates the zone it already created instead of
--    inserting a duplicate. Without p_create the old behaviour is unchanged: p_id null inserts,
--    p_id set updates an existing, non-archived zone (and errors otherwise).
-- 2. move_worker: when the worker is not active in p_from (a stale board on another tab or
--    device), it no longer silently turns into a plain assign. If the worker is already active in
--    p_to (the same move retried), it is a no-op; otherwise it raises 'Kişi bu bölgede değil'.

drop function public.save_zone(uuid, text, text, text, jsonb);

create function public.save_zone(
  p_id uuid,
  p_name text,
  p_color text,
  p_note text,
  p_geojson jsonb,
  p_create boolean default false
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

  if p_id is null or p_create then
    -- A retried create (same client id) updates the zone the first attempt made, as long as it
    -- is not archived; an archived zone is never revived.
    insert into public.zones (id, name, color, note, geom, created_by)
    values (coalesce(p_id, gen_random_uuid()), v_name, p_color, v_note, v_geom, auth.uid())
    on conflict (id) do update
       set name = excluded.name, color = excluded.color, note = excluded.note,
           geom = excluded.geom, updated_at = now()
     where public.zones.archived_at is null
    returning id into v_id;
  else
    update public.zones
       set name = v_name, color = p_color, note = v_note, geom = v_geom, updated_at = now()
     where id = p_id and archived_at is null
    returning id into v_id;
  end if;

  if v_id is null then
    raise exception 'Bölge bulunamadı';
  end if;

  return v_id;
end;
$$;

create or replace function public.move_worker(p_worker uuid, p_from uuid, p_to uuid)
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
    update public.assignments
       set ended_at = now()
     where worker_id = p_worker and zone_id = p_from and ended_at is null;

    if not found then
      if exists (
        select 1 from public.assignments
         where worker_id = p_worker and zone_id = p_to and ended_at is null
      ) then
        return; -- already moved (a retry): nothing to do
      end if;
      raise exception 'Kişi bu bölgede değil';
    end if;
  end if;

  -- Raises (and rolls back the update above) if the worker or target zone is invalid.
  perform public.assign_worker(p_worker, p_to);
end;
$$;

revoke execute on function public.save_zone(uuid, text, text, text, jsonb, boolean) from public, anon;
grant execute on function public.save_zone(uuid, text, text, text, jsonb, boolean) to authenticated, service_role;
