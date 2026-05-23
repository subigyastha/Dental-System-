import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  }

  const body = (await request.json()) as {
    appointmentId: string;
    customerId: string;
    channel: string;
    direction: string;
    summary: string;
  };

  const appointment = await prisma.appointment.findUniqueOrThrow({
    where: { id: body.appointmentId },
    select: { organizationId: true },
  });

  await prisma.$transaction([
    prisma.communicationLog.create({
      data: {
        organizationId: appointment.organizationId,
        appointmentId: body.appointmentId,
        customerId: body.customerId,
        channel: body.channel,
        direction: body.direction,
        summary: body.summary,
      },
    }),
    prisma.appointment.update({
      where: { id: body.appointmentId },
      data: { communicationState: "Confirmed by phone" },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
