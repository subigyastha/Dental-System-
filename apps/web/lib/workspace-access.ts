export type WorkspaceGate = "redirecting" | "loading" | "unavailable" | "ready";

export function resolveWorkspaceGate({
  hasData,
  hasError,
  requiresSignIn,
}: {
  hasData: boolean;
  hasError: boolean;
  requiresSignIn: boolean;
}): WorkspaceGate {
  if (requiresSignIn) {
    return "redirecting";
  }

  if (hasError) {
    return "unavailable";
  }

  return hasData ? "ready" : "loading";
}
