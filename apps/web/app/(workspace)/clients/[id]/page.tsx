import { ClientProfilePage } from "@/components/workspace/client-hub-page";

export default async function ClientProfileRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClientProfilePage clientId={id} />;
}
