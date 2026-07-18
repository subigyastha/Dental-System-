import { dateKeyInTimeZone } from "@/lib/calendar";
import { WorkspaceRoot } from "@/components/workspace/workspace-root";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const todayDateKey = dateKeyInTimeZone("Asia/Kathmandu");

  return (
    <WorkspaceRoot todayDateKey={todayDateKey}>
      {children}
    </WorkspaceRoot>
  );
}
