import { apiFetchJson } from "@/lib/api-client";
import type { SessionUser } from "@/lib/domain";
import {
  unwrapWorkspaceBootstrap,
  type WorkspaceBootstrap,
} from "@/lib/workspace-bootstrap";

type V1Envelope<T> = {
  data: T;
  meta: { apiVersion: "v1"; requestId?: string };
};

export type WorkspaceSession = {
  user: SessionUser;
  bootstrap: WorkspaceBootstrap;
};

export function createWorkspaceSessionLoader(
  load: () => Promise<WorkspaceSession>,
) {
  let cached: WorkspaceSession | null = null;
  let pending: Promise<WorkspaceSession> | null = null;

  return {
    clear() {
      cached = null;
      pending = null;
    },
    load() {
      if (cached) return Promise.resolve(cached);
      if (pending) return pending;
      pending = load()
        .then((value) => {
          cached = value;
          return value;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  };
}

const workspaceSessionLoader = createWorkspaceSessionLoader(async () => {
  const workspaceResponse = await apiFetchJson<V1Envelope<WorkspaceBootstrap>>(
    "/v1/workspace/bootstrap",
    { cache: "no-store" },
  );
  const bootstrap = unwrapWorkspaceBootstrap(workspaceResponse);
  return {
    user: bootstrap.user,
    bootstrap,
  };
});

export function loadWorkspaceSession() {
  return workspaceSessionLoader.load();
}

export function clearWorkspaceSessionCache() {
  workspaceSessionLoader.clear();
}
