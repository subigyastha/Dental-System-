import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

const organizationId = "org-koi-dental";
const locationId = "location-main-kathmandu";
const demoSeedPassword = process.env.DEMO_SEED_PASSWORD;

if (process.env.ALLOW_DEMO_SEED !== "true") {
  throw new Error("Refusing to seed demo accounts. Set ALLOW_DEMO_SEED=true only in an isolated development environment.");
}

if (!demoSeedPassword || demoSeedPassword.length < 15 || ["demo-password", "password", "password123", "12345678", "qwerty123", "welcome123", "admin123"].includes(demoSeedPassword.toLowerCase())) {
  throw new Error("DEMO_SEED_PASSWORD must be a unique, non-common passphrase of at least 15 characters.");
}

const demoPasswordHash = hashPassword(demoSeedPassword);

function normalizeClientPhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("977") && digits.length >= 10) return digits;
  if (digits.length === 10 && digits.startsWith("9")) return `977${digits}`;
  if (digits.length >= 8 && digits.length <= 10 && digits.startsWith("0")) {
    return `977${digits.slice(1)}`;
  }
  return digits;
}

const users = [
  ["user-owner", "Darrell Steward", "owner@zendenta.local", "Owner", null],
  ["user-reception", "Reception Desk", "receptionist@zendenta.local", "Receptionist", null],
  ["user-arya", "Dr. Arya Shrestha", "arya@zendenta.local", "Provider", "provider-arya"],
  ["user-mira", "Dr. Mira KC", "mira@zendenta.local", "Provider", "provider-mira"],
  ["user-nabin", "Dr. Nabin Rai", "nabin@zendenta.local", "Provider", "provider-nabin"],
  ["user-sana", "Sana Maharjan", "sana@zendenta.local", "Provider", "provider-sana"],
];

const staffProfileByUserId = {
  "user-owner": {
    phone: "+977 980-000-1100",
    staffLabel: "Clinic owner",
    department: "Operations",
    employeeCode: "OWN-001",
    employmentType: "Full time",
    startDate: "2024-01-15T00:00:00.000Z",
    emergencyContactName: "Nora Steward",
    emergencyContactPhone: "+977 980-000-1101",
    notes: "Primary signatory and clinic owner.",
    isSchedulable: false,
  },
  "user-reception": {
    phone: "+977 980-100-2200",
    staffLabel: "Front desk",
    department: "Reception",
    employeeCode: "REC-014",
    employmentType: "Full time",
    startDate: "2025-06-01T00:00:00.000Z",
    emergencyContactName: "Sujan Khadka",
    emergencyContactPhone: "+977 980-100-2201",
    notes: "Handles confirmations, intake, and reschedules.",
    isSchedulable: false,
  },
  "user-arya": {
    phone: "+977 980-201-0001",
    staffLabel: "Doctor",
    department: "Restorative",
    employeeCode: "DOC-101",
    licenseNumber: "NMC-DEN-20341",
    employmentType: "Full time",
    startDate: "2023-04-10T00:00:00.000Z",
    emergencyContactName: "Isha Shrestha",
    emergencyContactPhone: "+977 980-201-0011",
    notes: "Handles more complex restorative sessions.",
    isSchedulable: true,
  },
  "user-mira": {
    phone: "+977 980-201-0002",
    staffLabel: "Orthodontist",
    department: "Orthodontics",
    employeeCode: "DOC-115",
    licenseNumber: "NMC-DEN-22140",
    employmentType: "Full time",
    startDate: "2024-02-12T00:00:00.000Z",
    emergencyContactName: "Sarina KC",
    emergencyContactPhone: "+977 980-201-0012",
    notes: "Owns continuity-sensitive ortho follow-up.",
    isSchedulable: true,
  },
  "user-nabin": {
    phone: "+977 980-201-0003",
    staffLabel: "Oral surgeon",
    department: "Surgery",
    employeeCode: "DOC-124",
    licenseNumber: "NMC-DEN-21402",
    employmentType: "Part time",
    startDate: "2024-08-01T00:00:00.000Z",
    emergencyContactName: "Mona Rai",
    emergencyContactPhone: "+977 980-201-0013",
    notes: "Scheduled for procedure blocks and consults.",
    isSchedulable: true,
  },
  "user-sana": {
    phone: "+977 980-201-0004",
    staffLabel: "Dental hygienist",
    department: "Preventive care",
    employeeCode: "CLN-205",
    licenseNumber: "NDHA-7741",
    employmentType: "Full time",
    startDate: "2025-01-10T00:00:00.000Z",
    emergencyContactName: "Rekha Maharjan",
    emergencyContactPhone: "+977 980-201-0014",
    notes: "Supports hygiene and preventive continuity.",
    isSchedulable: true,
  },
};

const providers = [
  ["provider-arya", "user-arya", "Dr. Arya Shrestha", "Doctor", "Restorative dentistry", "#0f766e", "Busy"],
  ["provider-mira", "user-mira", "Dr. Mira KC", "Doctor", "Orthodontics", "#7c3aed", "Available"],
  ["provider-nabin", "user-nabin", "Dr. Nabin Rai", "Doctor", "Oral surgery", "#b45309", "Busy"],
  ["provider-sana", "user-sana", "Sana Maharjan", "Hygienist", "Preventive care", "#2563eb", "Available"],
];

const customers = [
  ["customer-lhamu", "Lhamu Sherpa", "+977 980-110-4570", "lhamu.sherpa@email.com", "Female", "1992-02-12", "Maharajgunj, Kathmandu", "Passang Sherpa", "+977 980-100-0001", "No known drug allergies", "Crown planning pending after root canal completion.", "Needs attention", "2026-02-13T04:45:00.000Z"],
  ["customer-bibek", "Bibek Adhikari", "+977 981-442-0198", "bibek.a@email.com", "Male", "1985-09-22", "Lalitpur, Bagmati", "Mina Adhikari", "+977 981-300-4004", "No known allergies", "Prefers preventive appointments after 3 PM.", "Routine", "2026-04-02T10:00:00.000Z"],
  ["customer-srijana", "Srijana Tamang", "+977 984-218-6671", "srijana.tamang@email.com", "Female", "1999-01-18", "Bhaktapur, Bagmati", "Ramesh Tamang", "+977 984-000-1122", "Penicillin", "Impacted molar case with consent already on file.", "High priority", "2026-05-01T06:30:00.000Z"],
  ["customer-amit", "Amit Gurung", "+977 986-009-7721", "amit.gurung@email.com", "Male", "1974-06-09", "Pokhara, Gandaki", "Sarita Gurung", "+977 986-001-8877", "Latex sensitivity", "Orthodontic continuity at risk due to repeated missed reviews.", "Needs attention", "2025-11-28T03:15:00.000Z"],
  ["customer-nisha", "Nisha Basnet", "+977 980-658-2401", "nisha.basnet@email.com", "Female", "2007-04-03", "Baneshwor, Kathmandu", "Sushma Basnet", "+977 980-777-2525", "No known allergies", "Guardian requests printed school notes after each ortho visit.", "Routine", "2026-03-17T11:00:00.000Z"],
  ["customer-roshan", "Roshan Thapa", "+977 981-741-8839", "roshan.t@email.com", "Male", "1980-12-28", "Kirtipur, Kathmandu", "Anita Thapa", "+977 981-122-7788", "Metformin timing note before treatment", "Diabetic patient; watch gum bleeding and healing response.", "High priority", "2026-04-25T07:25:00.000Z"],
];

const services = [
  ["service-checkup", "Comprehensive checkup", "Diagnostic", 30, 5],
  ["service-cleaning", "Scaling and polish", "Preventive", 45, 10],
  ["service-root-canal", "Root canal treatment", "Treatment", 90, 15],
  ["service-extraction", "Surgical extraction", "Surgery", 75, 15],
  ["service-ortho-review", "Orthodontic review", "Orthodontics", 40, 5],
];

const resources = [
  ["resource-chair-1", "Chair 1", "Dental chair"],
  ["resource-chair-2", "Chair 2", "Dental chair"],
  ["resource-chair-3", "Chair 3", "Dental chair"],
  ["resource-chair-4", "Chair 4", "Dental chair"],
  ["resource-surgery", "Surgery room", "Procedure room"],
];

const appointments = [
  ["appt-1001", "customer-lhamu", "provider-arya", "resource-chair-2", ["service-root-canal"], "2026-05-06T02:45:00.000Z", 90, 15, "Confirmed", "High", "Second sitting. Review pain level before anesthesia.", "Confirmed by phone"],
  ["appt-1002", "customer-bibek", "provider-sana", "resource-chair-4", ["service-cleaning"], "2026-05-06T03:30:00.000Z", 45, 10, "Scheduled", "Normal", "Routine cleaning. Offer six-month recall setup.", "SMS sent"],
  ["appt-1003", "customer-srijana", "provider-nabin", "resource-surgery", ["service-extraction"], "2026-05-06T04:15:00.000Z", 75, 15, "CheckedIn", "Urgent", "Impacted molar. Consent form completed at front desk.", "Confirmed by phone"],
  ["appt-1004", "customer-amit", "provider-mira", "resource-chair-1", ["service-ortho-review"], "2026-05-06T05:45:00.000Z", 40, 5, "FollowUpRequired", "High", "Missed aligner review twice. Needs treatment continuity call.", "Needs call"],
  ["appt-1005", "customer-nisha", "provider-mira", "resource-chair-1", ["service-ortho-review"], "2026-05-06T07:30:00.000Z", 40, 5, "Confirmed", "Normal", "Bracket adjustment. Parent requested school note.", "Confirmed by phone"],
  ["appt-1006", "customer-roshan", "provider-arya", "resource-chair-2", ["service-checkup", "service-cleaning"], "2026-05-06T09:15:00.000Z", 75, 10, "Scheduled", "High", "Diabetic patient. Flag gum bleeding history.", "Unconfirmed"],
  ["appt-1007", "customer-amit", "provider-mira", "resource-chair-1", ["service-ortho-review"], "2026-05-05T08:45:00.000Z", 40, 5, "NoShow", "Urgent", "Third missed continuation review. Escalate before archiving plan.", "Needs call"],
];

const followUps = [
  ["task-501", "appt-1007", "customer-amit", "provider-mira", "NoShowRecovery", "Open", "Urgent", "2026-05-06T03:15:00.000Z", "Recover missed orthodontic continuation", "Call, offer two protected slots, document barrier."],
  ["task-502", "appt-1006", "customer-roshan", "provider-arya", "Reminder", "Open", "High", "2026-05-06T05:15:00.000Z", "Confirm afternoon high-priority checkup", "Phone confirmation and medication reminder."],
  ["task-503", null, "customer-lhamu", "provider-arya", "TreatmentContinuation", "Waiting", "High", "2026-05-07T04:15:00.000Z", "Schedule crown planning after RCT", "Create treatment plan task after today's outcome."],
  ["task-504", null, "customer-bibek", "provider-sana", "Recall", "InProgress", "Normal", "2026-05-08T09:15:00.000Z", "Set six-month preventive recall", "Confirm preferred weekday and create recurrence."],
];

const visitReports = [
  ["session-1001", "appt-1001", "customer-lhamu", "provider-arya", "service-root-canal", "Root canal second sitting completed with improved pain response.", "Reduced night pain, mild bite sensitivity.", "Canal cleaned and dressed. Temporary restoration intact.", "Plan crown preparation after symptom-free review.", true, "2026-05-13T03:45:00.000Z"],
  ["session-1002", "appt-1005", "customer-nisha", "provider-mira", "service-ortho-review", "Bracket adjustment completed for upper arch with no breakages.", "Occasional cheek irritation on upper right.", "Adjusted wire tension and wax guidance provided.", "Next review can stay on routine four-week cycle.", false, null],
  ["session-1003", "appt-1007", "customer-amit", "provider-mira", "service-ortho-review", "Visit marked as no-show after protected continuation slot expired.", "No clinical assessment completed.", "Treatment continuity risk increased; aligner compliance unknown.", "Escalate with call and offer two recovery slots within the week.", true, "2026-05-07T05:15:00.000Z"],
];

await prisma.organization.deleteMany({ where: { id: organizationId } });

await prisma.organization.create({
  data: {
    id: organizationId,
    name: "Koi Dental Coordination Center",
    timezone: "Asia/Kathmandu",
    primaryCalendar: "AD",
    settings: {
      create: {
        defaultBufferMinutes: 10,
        reminderLeadMinutes: 1440,
        businessDayStartsAt: "08:00",
        businessDayEndsAt: "18:00",
      },
    },
  },
});

await prisma.location.create({
  data: {
    id: locationId,
    organizationId,
    name: "Kathmandu Main Branch",
    address: "Baluwatar, Kathmandu",
    phone: "+977 01-4420000",
    timezone: "Asia/Kathmandu",
  },
});

await prisma.user.createMany({
  data: users.map(([id, name, email, role]) => {
    const profile = staffProfileByUserId[id] ?? {};
    return {
      id,
      organizationId,
      name,
      email,
      role,
      passwordHash: demoPasswordHash,
      phone: profile.phone,
      staffLabel: profile.staffLabel,
      department: profile.department,
      employeeCode: profile.employeeCode,
      licenseNumber: profile.licenseNumber,
      employmentType: profile.employmentType,
      startDate: profile.startDate ? new Date(profile.startDate) : undefined,
      emergencyContactName: profile.emergencyContactName,
      emergencyContactPhone: profile.emergencyContactPhone,
      notes: profile.notes,
      isSchedulable: profile.isSchedulable ?? false,
    };
  }),
});

await prisma.provider.createMany({
  data: providers.map(([id, userId, displayName, roleLabel, specialty, color, status]) => ({
    id,
    organizationId,
    userId,
    displayName,
    roleLabel,
    specialty,
    color,
    status,
  })),
});

await prisma.customer.createMany({
  data: customers.map(([id, fullName, phone, email, gender, dateOfBirth, address, emergencyContactName, emergencyContactPhone, allergies, medicalNotes, riskLabel, lastVisitAt]) => ({
    id,
    organizationId,
    fullName,
    phone,
    normalizedPhone: normalizeClientPhone(phone),
    email,
    normalizedEmail: email?.trim().toLowerCase() ?? null,
    gender,
    dateOfBirth: new Date(dateOfBirth),
    address,
    emergencyContactName,
    emergencyContactPhone,
    allergies,
    medicalNotes,
    riskLabel,
    lastVisitAt: new Date(lastVisitAt),
  })),
});

await prisma.clientPhone.createMany({
  data: customers.map(([customerId, , phone]) => ({
    id: `seed-phone-${customerId}`,
    organizationId,
    customerId,
    rawValue: phone,
    normalizedValue: normalizeClientPhone(phone),
    normalizationVersion: "np-v1",
    type: "Mobile",
    isPrimary: true,
    verificationStatus: "Unverified",
    source: "DemoSeed",
  })),
});

await prisma.service.createMany({
  data: services.map(([id, name, category, durationMinutes, bufferMinutes]) => ({
    id,
    organizationId,
    name,
    category,
    durationMinutes,
    bufferMinutes,
  })),
});

await prisma.resource.createMany({
  data: resources.map(([id, name, type]) => ({
    id,
    organizationId,
    locationId,
    name,
    type,
  })),
});

await prisma.providerService.createMany({
  data: providers.flatMap(([providerId]) =>
    services.map(([serviceId, , , durationMinutes]) => ({
      providerId,
      serviceId,
      locationId,
      customDurationMinutes: durationMinutes,
    })),
  ),
});

await prisma.providerAvailability.createMany({
  data: providers.flatMap(([providerId]) =>
    [0, 1, 2, 3, 4, 5].map((dayOfWeek) => ({
      organizationId,
      providerId,
      locationId,
      dayOfWeek,
      startsAtLocal: "08:00",
      endsAtLocal: "18:00",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    })),
  ),
});

await prisma.blockedTime.createMany({
  data: providers.map(([providerId]) => ({
    organizationId,
    providerId,
    locationId,
    startsAt: new Date("2026-05-06T06:15:00.000Z"),
    endsAt: new Date("2026-05-06T07:00:00.000Z"),
    reason: "Lunch break",
  })),
});

for (const [
  id,
  customerId,
  providerId,
  resourceId,
  serviceIds,
  startsAt,
  durationMinutes,
  bufferMinutes,
  status,
  priority,
  notes,
  communicationState,
] of appointments) {
  const startsAtDate = new Date(startsAt);
  await prisma.appointment.create({
    data: {
      id,
      organizationId,
      locationId,
      customerId,
      providerId,
      resourceId,
      startsAt: startsAtDate,
      endsAt: new Date(startsAtDate.getTime() + Number(durationMinutes) * 60_000),
      durationMinutes,
      bufferMinutes,
      status,
      priority,
      notes,
      communicationState,
      services: {
        create: serviceIds.map((serviceId) => ({ serviceId })),
      },
    },
  });
}

await prisma.auditLog.createMany({
  data: appointments.map(([id, customerId]) => ({
    organizationId,
    entityType: "appointment",
    entityId: id,
    action: "created",
    description: `Seeded appointment for ${customerId}`,
  })),
});

await prisma.followUpTask.createMany({
  data: followUps.map(
    ([id, appointmentId, customerId, ownerId, type, status, priority, dueAt, summary, nextAction]) => ({
      id,
      organizationId,
      appointmentId,
      customerId,
      ownerId,
      type,
      status,
      priority,
      dueAt: new Date(dueAt),
      summary,
      nextAction,
    }),
  ),
});

await prisma.appointmentSession.createMany({
  data: visitReports.map(
    ([id, appointmentId, customerId, providerId, serviceId, visitSummary, symptoms, clinicalNotes, doctorNotes, followUpRequired, followUpDate]) => ({
      id,
      appointmentId,
      customerId,
      providerId,
      serviceId,
      visitSummary,
      symptoms,
      clinicalNotes,
      doctorNotes,
      followUpRequired,
      followUpDate: followUpDate ? new Date(followUpDate) : null,
    }),
  ),
});

await prisma.$disconnect();

console.log("Seeded Koi workflow operational data.");

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64, {
    N: 2 ** 17,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  }).toString("hex");
  return `scrypt$v1$131072$8$1$${salt}$${hash}`;
}
