import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      databaseConfigured: false,
      provider: null,
      persistenceMode: "seeded-local",
      organizationCount: 0,
    });
  }

  try {
    const organizationCount = await prisma.organization.count();

    return NextResponse.json({
      databaseConfigured: true,
      provider: "postgresql",
      persistenceMode: "database-connected",
      organizationCount,
    });
  } catch {
    return NextResponse.json(
      {
        databaseConfigured: true,
        provider: "postgresql",
        persistenceMode: "database-unreachable",
        organizationCount: 0,
      },
      { status: 503 },
    );
  }
}
