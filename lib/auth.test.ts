import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { homeFor, loadSessionState } from "./auth";

describe("homeFor", () => {
  it("sends admins to /yonetim", () => {
    expect(homeFor("admin")).toBe("/yonetim");
  });

  it("sends workers to /gorevim", () => {
    expect(homeFor("worker")).toBe("/gorevim");
  });
});

type Result<T> = { data: T; error: unknown };

const USER = { id: "u1" };
const PROFILE = {
  id: "u1",
  full_name: "Ali",
  phone: "+905321234567",
  role: "worker",
  active: true,
  created_at: "2026-01-01T00:00:00Z",
};
const DB_DOWN = { message: "connection refused", code: "PGRST000", details: "", hint: "" };

function fakeClient(opts: {
  user?: Result<{ user: typeof USER | null }>;
  profile?: Result<typeof PROFILE | null>;
  rpc?: Result<boolean | null>;
}): SupabaseClient {
  const user = opts.user ?? { data: { user: USER }, error: null };
  const profile = opts.profile ?? { data: null, error: null };
  const rpc = opts.rpc ?? { data: false, error: null };
  return {
    auth: { getUser: async () => user },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => profile }) }),
    }),
    rpc: async () => rpc,
  } as unknown as SupabaseClient;
}

const exists = (value: boolean) => async () => value;
const lookupFails = async (): Promise<boolean> => {
  throw new Error("service role query failed");
};
const lookupMustNotRun = async (): Promise<boolean> => {
  throw new Error("existence lookup should not run");
};

describe("loadSessionState", () => {
  it("is signed-out when there is no session", async () => {
    const supabase = fakeClient({
      user: { data: { user: null }, error: { name: "AuthSessionMissingError", status: 400 } },
    });
    expect(await loadSessionState(supabase, lookupMustNotRun)).toEqual({ status: "signed-out" });
  });

  it("is an error, not signed-out, when the auth server is unreachable", async () => {
    const supabase = fakeClient({
      user: { data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0 } },
    });
    expect(await loadSessionState(supabase, lookupMustNotRun)).toEqual({ status: "error" });
  });

  it("is ok for a readable, active profile", async () => {
    const supabase = fakeClient({ profile: { data: PROFILE, error: null } });
    expect(await loadSessionState(supabase, lookupMustNotRun)).toEqual({
      status: "ok",
      profile: PROFILE,
    });
  });

  it("is an error when the profile query fails", async () => {
    const supabase = fakeClient({ profile: { data: null, error: DB_DOWN } });
    expect(await loadSessionState(supabase, lookupMustNotRun)).toEqual({ status: "error" });
  });

  it("is an error when is_active_user fails", async () => {
    const supabase = fakeClient({ rpc: { data: null, error: DB_DOWN } });
    expect(await loadSessionState(supabase, lookupMustNotRun)).toEqual({ status: "error" });
  });

  it("is an error when is_active_user says active but the profile is unreadable", async () => {
    const supabase = fakeClient({ rpc: { data: true, error: null } });
    expect(await loadSessionState(supabase, lookupMustNotRun)).toEqual({ status: "error" });
  });

  it("is an error when the existence lookup fails", async () => {
    expect(await loadSessionState(fakeClient({}), lookupFails)).toEqual({ status: "error" });
  });

  it("is inactive when is_active_user is false and the row exists", async () => {
    expect(await loadSessionState(fakeClient({}), exists(true))).toEqual({ status: "inactive" });
  });

  it("is no-profile only when is_active_user is false and the row definitely does not exist", async () => {
    expect(await loadSessionState(fakeClient({}), exists(false))).toEqual({
      status: "no-profile",
    });
  });
});
