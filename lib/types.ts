export type Role = "admin" | "worker";

export type Profile = {
  id: string;
  full_name: string;
  phone: string;
  role: Role;
  active: boolean;
  created_at: string;
};

export type Zone = {
  id: string;
  name: string;
  color: string;
  note: string | null;
  geojson: GeoJSON.Polygon;
  active_count: number;
};

export type Assignment = {
  id: string;
  zone_id: string;
  worker_id: string;
  started_at: string;
  ended_at: string | null;
};
