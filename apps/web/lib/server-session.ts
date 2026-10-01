import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * An absent or expired cookie can be handled before contacting the API.
 * Presence only permits loading: Nest still validates expiry and revocation.
 */
export async function requireSessionCookie() {
  const cookieStore = await cookies();
  if (!cookieStore.get("clinicflow_session")?.value) {
    redirect("/login");
  }
}
