import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  }

  const { id } = await params;

  await prisma.followUpTask.update({
    where: { id },
    data: { status: "Done" },
  });

  return NextResponse.json({ ok: true });
}
