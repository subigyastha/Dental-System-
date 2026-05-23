import { PatientDetailPage } from "@/components/workspace/patient-detail-page";

export default async function PatientDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PatientDetailPage customerId={id} />;
}
