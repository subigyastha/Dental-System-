import "dotenv/config";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const orgId = `phase4-guard-${Date.now()}`;

async function main() {
  const firstStartsAt = new Date("2035-01-01T04:00:00.000Z");
  const firstEndsAt = new Date("2035-01-01T04:30:00.000Z");

  try {
    await prisma.organization.create({
      data: {
        id: orgId,
        name: "Phase 4 Guard Test",
        businessType: "dental_clinic",
        timezone: "Asia/Kathmandu",
        primaryCalendar: "AD",
      },
    });

    await prisma.customer.create({
      data: {
        id: `${orgId}-client`,
        organizationId: orgId,
        fullName: "Phase Guard Client",
        phone: "9800000000",
        patientCode: "CL-0001",
      },
    });

    await prisma.provider.create({
      data: {
        id: `${orgId}-provider`,
        organizationId: orgId,
        displayName: "Phase Guard Provider",
        roleLabel: "Dentist",
      },
    });

    await prisma.appointment.create({
      data: {
        id: `${orgId}-appt-1`,
        organizationId: orgId,
        customerId: `${orgId}-client`,
        providerId: `${orgId}-provider`,
        startsAt: firstStartsAt,
        endsAt: firstEndsAt,
        durationMinutes: 30,
        bufferMinutes: 10,
        status: "Scheduled",
        priority: "Normal",
      },
    });

    let blocked = false;
    let observedCode = null;

    try {
      await prisma.appointment.create({
        data: {
          id: `${orgId}-appt-2`,
          organizationId: orgId,
          customerId: `${orgId}-client`,
          providerId: `${orgId}-provider`,
          startsAt: new Date("2035-01-01T04:20:00.000Z"),
          endsAt: new Date("2035-01-01T04:50:00.000Z"),
          durationMinutes: 30,
          bufferMinutes: 0,
          status: "Scheduled",
          priority: "Normal",
        },
      });
    } catch (error) {
      observedCode = error?.code ?? null;
      const message = String(error?.message ?? error);
      blocked =
        message.includes("Appointment_provider_time_no_overlap") ||
        message.includes("exclusion constraint") ||
        observedCode === "P2004";
    }

    if (!blocked) {
      throw new Error("Provider overlap guard did not block the conflicting appointment.");
    }

    console.log(
      JSON.stringify({
        ok: true,
        proof: "provider overlap blocked",
        observedCode,
        organizationCleanedUp: orgId,
      }),
    );
  } finally {
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect();
  console.error(error);
  process.exit(1);
});
