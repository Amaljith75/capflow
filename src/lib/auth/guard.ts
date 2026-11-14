import "server-only";
import { PermissionError } from "@/lib/auth/context";
import { fail, type ActionResult } from "@/lib/result";

/** Runs a server action body, turning a failed role check into a normal error result. */
export async function guard<T = undefined>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PermissionError) return fail(e.message);
    throw e;
  }
}
