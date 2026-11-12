import { unstable_rethrow } from "next/navigation";
import { LOGIN_MESSAGES } from "@/lib/login";

export type ActionFailure = { ok: false; error: string };

/**
 * Runs a server action from a Client Component and turns a rejection (network drop, timeout,
 * session check failed) into an ordinary `{ ok: false }` result with the connection message.
 * Uncaught, a rejection would reach the error boundary, which replaces the whole screen.
 *
 * - Next's own control-flow errors are rethrown first: when `requireRole` inside the action
 *   redirects (signed out, deactivated), Next navigates and also rejects the action with a
 *   redirect error, which must not be shown as a connection problem.
 * - `onRejected` runs after a real failure; the server state is unknown then (the action may
 *   have committed before the response was lost), so callers re-read the page
 *   (`refreshIfReachable`).
 */
export async function callAction<R extends { ok: boolean }>(
  action: () => Promise<R>,
  onRejected?: () => void,
): Promise<R | ActionFailure> {
  try {
    return await action();
  } catch (e) {
    unstable_rethrow(e);
    console.error("server action failed", e);
    onRejected?.();
    return { ok: false, error: LOGIN_MESSAGES.CONNECTION };
  }
}
