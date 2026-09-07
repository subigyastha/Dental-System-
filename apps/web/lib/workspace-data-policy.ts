export type WorkspaceDataPolicy =
  | "minimal-bootstrap"
  | "schedule-bootstrap";

const minimalBootstrapRouteRoots = [
  "/archive",
  "/billing",
  "/clients",
  "/dashboard",
  "/inventory",
  "/patients",
  "/staff",
  "/settings",
] as const;
const scheduleBootstrapRouteRoots = ["/reservations", "/my-schedule"] as const;

function normalizePathname(pathname: string) {
  const pathOnly = pathname.split(/[?#]/, 1)[0]?.trim() || "/";
  const withLeadingSlash = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;

  if (withLeadingSlash === "/") {
    return withLeadingSlash;
  }

  return withLeadingSlash.replace(/\/+$/, "");
}

export function workspaceDataPolicy(pathname: string): WorkspaceDataPolicy {
  const normalizedPathname = normalizePathname(pathname);
  const ownsItsRouteData = minimalBootstrapRouteRoots.some(
    (routeRoot) =>
      normalizedPathname === routeRoot ||
      normalizedPathname.startsWith(`${routeRoot}/`),
  );

  if (ownsItsRouteData) return "minimal-bootstrap";

  const ownsScheduleData = scheduleBootstrapRouteRoots.some(
    (routeRoot) =>
      normalizedPathname === routeRoot ||
      normalizedPathname.startsWith(`${routeRoot}/`),
  );
  return ownsScheduleData ? "schedule-bootstrap" : "minimal-bootstrap";
}

export function requiresCompatibilityBootstrap(pathname: string) {
  void pathname;
  return false;
}
