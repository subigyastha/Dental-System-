import type { SessionUser } from "@/lib/domain";

export function signedInRoute(user: SessionUser) {
  if (user.role === "SuperAdmin") return "/platform";
  return user.providerId && ["Provider", "Assistant"].includes(user.role) ? "/my-schedule" : "/dashboard";
}

export function isPlatformOnlyUser(user: Pick<SessionUser, "role">) {
  return user.role === "SuperAdmin";
}
