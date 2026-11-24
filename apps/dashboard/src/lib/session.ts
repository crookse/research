// Server-only: who the dashboard is acting as. A stand-in for real sign-in,
// kept in a cookie. Swap getCurrentAccount for a session lookup later; the
// actions and pages already go through it.

import { cookies } from "next/headers";

import { getAccount } from "./api-keys";

export const ACTING_AS_COOKIE = "acting-as";

export async function getCurrentAccount() {
  return getAccount((await cookies()).get(ACTING_AS_COOKIE)?.value);
}
