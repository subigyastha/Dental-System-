import { PlatformWorkspace } from "@/components/platform/platform-workspace";
import { requireSessionCookie } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function PlatformRoute() {
  await requireSessionCookie();
  return <PlatformWorkspace />;
}
