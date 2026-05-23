import { dateKeyInTimeZone } from "@/lib/calendar";
import { getOperationalData } from "@/lib/database-data";
import { WorkspaceRoot } from "@/components/workspace/workspace-root";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const data = await getOperationalData();
  const todayDateKey = dateKeyInTimeZone(data.organization.timezone);

  return (
    <WorkspaceRoot initialData={data} todayDateKey={todayDateKey}>
      {children}
    </WorkspaceRoot>
  );
}
