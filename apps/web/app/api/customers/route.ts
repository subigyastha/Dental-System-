import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  }

  const body = (await request.json()) as {
    id?: string;
    organizationId: string;
    name: string;
    phone: string;
    age: number;
    risk: "Routine" | "Needs attention" | "High priority";
  };

  const currentYear = new Date().getFullYear();
  const birthYear = currentYear - body.age;

  const customer = await prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({
      data: {
        id: body.id,
        organizationId: body.organizationId,
        fullName: body.name,
        phone: body.phone,
        riskLabel: body.risk,
        dateOfBirth: body.age ? new Date(`${birthYear}-01-01T00:00:00.000Z`) : null,
        lastVisitAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: body.organizationId,
        entityType: "client_profile",
        entityId: created.id,
        action: "created",
        newValue: body,
        description: "Patient profile created",
      },
    });

    return created;
  });

  return NextResponse.json({ id: customer.id });
}
