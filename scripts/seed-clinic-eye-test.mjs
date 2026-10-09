import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

// This fixture must never target a clinic database or change existing test days.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (!['localhost', '127.0.0.1'].includes(url.hostname) || !/^\/workflow_eye_test_/.test(url.pathname)) {
  throw new Error("Use an isolated localhost workflow_eye_test_* database.");
}
const db = new PrismaClient();
const date = process.argv[2] ?? "2026-10-10";
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error("Choose an AD date in YYYY-MM-DD format.");
const org = `eye-test-${date}`;
const location = `${org}-clinic`;
const password = process.env.EYE_TEST_PASSWORD;
if (!password || password.length < 15) throw new Error("Set an eye-test-only password of at least 15 characters.");
const salt = randomBytes(16).toString('hex');
const hash = scryptSync(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex');
const passwordHash = `scrypt$v1$131072$8$1$${salt}$${hash}`;
const api = "http://localhost:4000/api";
let cookie = "";
let csrf = "";
async function request(path, body) {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie, 'x-csrf-token': csrf } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(value)}`);
  if (path === '/auth/login') { cookie = response.headers.get('set-cookie').split(';')[0]; csrf = value.csrfToken; }
  return value;
}
const schedules = {
  pratik: [
    ['08:00', 30, 'Completed', 'custom', 'Post-treatment check'],
    ['08:30', 30, 'Completed', 'consultation'],
    ['09:00', 45, 'CheckedIn', 'scaling'],
    ['09:45', 15, 'Confirmed', 'review'],
    ['10:00', 30, 'Confirmed', 'filling', 'Move this 30-minute visit to 10:15'],
    ['10:30', 30, 'Cancelled', 'consultation', 'Client unavailable; time is free'],
    ['11:00', 60, 'Scheduled', 'root-canal'],
    ['13:00', 45, 'Confirmed', 'scaling'],
    ['13:45', 15, 'Scheduled', 'review'],
    ['14:00', 30, 'Cancelled', 'consultation', 'Travel plans changed; book a new visit here'],
    ['14:30', 45, 'Confirmed', 'custom', 'Bite adjustment'],
    ['15:15', 15, 'Scheduled', 'review'],
    ['15:30', 30, 'Cancelled', 'consultation', 'Preferred another date; replacement now occupies this time'],
    ['15:30', 30, 'Confirmed', 'consultation', 'Replacement booking; cancelled notice should be hidden'],
    ['16:00', 45, 'Scheduled', 'filling'],
    ['16:45', 15, 'Confirmed', 'review'],
    ['17:00', 60, 'Confirmed', 'root-canal'],
  ],
  mira: [
    ['08:00', 45, 'Completed', 'scaling'],
    ['08:45', 15, 'Completed', 'review'],
    ['09:00', 30, 'Confirmed', 'consultation'],
    ['09:30', 45, 'CheckedIn', 'custom', 'Retainer adjustment'],
    ['10:15', 15, 'Scheduled', 'review'],
    ['10:30', 30, 'Cancelled', 'consultation', 'Client requested afternoon; time is free'],
    ['11:00', 45, 'Confirmed', 'filling'],
    ['11:45', 15, 'Scheduled', 'review'],
    ['13:00', 60, 'Confirmed', 'root-canal'],
    ['14:00', 30, 'Scheduled', 'consultation'],
    ['14:30', 30, 'Confirmed', 'custom', 'Move this visit to 14:45', 'Retainer review'],
    ['15:00', 30, 'Cancelled', 'consultation', 'Requested change; time is free'],
    ['15:30', 45, 'Scheduled', 'scaling'],
    ['16:15', 15, 'Confirmed', 'review'],
    ['16:30', 30, 'NoShow', 'consultation', 'Synthetic early no-show authorized by local test owner'],
    ['17:00', 60, 'Confirmed', 'custom', 'Complex restoration'],
  ],
};

try {
  if (await db.organization.findUnique({ where: { id: org } })) throw new Error("This eye-test day already exists. Keep your edits or choose another day.");
  await db.organization.create({ data: { id: org, name: 'EYETEST Clinic — synthetic patients' } });
  await db.location.create({ data: { id: location, organizationId: org, name: 'Local eye-test clinic' } });
  await db.organizationSetting.create({ data: { organizationId: org, defaultBufferMinutes: 0, businessDayStartsAt: '08:00', businessDayEndsAt: '18:00', slotStartIntervalMinutes: 15 } });
  await db.user.createMany({ data: [
    { id: `${org}-owner`, name: 'Eye-test owner', email: 'owner@eyetest.local', role: 'Owner' },
    { id: `${org}-reception`, name: 'Eye-test reception', email: 'reception@eyetest.local', role: 'Receptionist' },
    ...['pratik', 'mira'].map(id => ({ id: `${org}-${id}-user`, name: id === 'pratik' ? 'Dr. Pratik Shrestha' : 'Dr. Mira KC', email: `${id}@eyetest.local`, role: 'Provider', isSchedulable: true })),
  ].map(user => ({ ...user, organizationId: org, passwordHash })) });
  const services = [['consultation', 'Consultation', 30], ['scaling', 'Scaling', 45], ['filling', 'Filling', 45], ['review', 'Check-up', 15], ['root-canal', 'Root canal', 60]];
  await db.service.createMany({ data: services.map(([id, name, durationMinutes]) => ({ id: `${org}-${id}`, organizationId: org, name, category: 'Dental', durationMinutes, bufferMinutes: 0, price: 500 })) });
  for (const id of ['pratik', 'mira']) {
    const providerId = `${org}-${id}`;
    await db.provider.create({ data: { id: providerId, organizationId: org, userId: `${org}-${id}-user`, displayName: id === 'pratik' ? 'Dr. Pratik Shrestha' : 'Dr. Mira KC', roleLabel: 'Doctor', specialty: 'Dentist', color: id === 'pratik' ? '#0f766e' : '#7c3aed' } });
    await db.providerService.createMany({ data: services.map(([serviceId]) => ({ providerId, serviceId: `${org}-${serviceId}`, locationId: location })) });
    await db.providerAvailability.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ organizationId: org, providerId, locationId: location, dayOfWeek, startsAtLocal: '08:00', endsAtLocal: '18:00', slotDurationMinutes: 15, bufferMinutes: 0, effectiveFrom: new Date('2026-01-01T00:00:00Z') })) });
    await db.providerRecurringBlock.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ organizationId: org, providerId, locationId: location, dayOfWeek, startsAtLocal: '12:00', endsAtLocal: '13:00', reason: 'Lunch break' })) });
  }
  await db.clientCodeSequence.create({ data: { organizationId: org, nextValue: 100 } });
  await request('/auth/login', { email: 'owner@eyetest.local', password });
  let count = 0;
  for (const [doctor, rows] of Object.entries(schedules)) {
    for (const [time, duration, status, procedure, note, customName] of rows) {
      const number = ++count;
      const customerId = `${org}-client-${number}`;
      const phone = `000000${String(number).padStart(4, '0')}`;
      await db.customer.create({ data: { id: customerId, organizationId: org, fullName: `TEST ${doctor === 'pratik' ? 'P' : 'M'}${String(number).padStart(2, '0')} — ${time}`, phone, normalizedPhone: phone, patientCode: `ET-${String(number).padStart(3, '0')}` } });
      await db.clientPhone.create({ data: { organizationId: org, customerId, rawValue: phone, normalizedValue: phone, isPrimary: true } });
      const appointment = await request('/appointments', { organizationId: org, locationId: location, customerId, providerId: `${org}-${doctor}`, serviceIds: procedure === 'custom' ? [] : [`${org}-${procedure}`], ...(procedure === 'custom' ? { customProcedureName: customName ?? note } : {}), startsAtIso: `${date}T${time}:00+05:45`, durationMinutes: duration, bufferMinutes: 0, priority: 'Normal', notes: `[EYETEST] ${note ?? 'Synthetic daily workflow appointment'}` });
      if (status === 'Cancelled' || status === 'NoShow') await request(`/appointments/${appointment.id}/${status === 'Cancelled' ? 'cancel' : 'no-show'}`, { reason: note });
      else if (status !== 'Scheduled') {
        await request(`/appointments/${appointment.id}/confirm`, {});
        if (['CheckedIn', 'Completed'].includes(status)) await request(`/appointments/${appointment.id}/check-in`, {});
        if (status === 'Completed') await request(`/appointments/${appointment.id}/complete`, {});
      }
    }
  }
  console.log(JSON.stringify({ date, doctors: ['Dr. Pratik Shrestha', 'Dr. Mira KC'], appointments: count, hours: '08:00–18:00', lunch: '12:00–13:00', account: 'reception@eyetest.local' }));
} finally {
  await db.$disconnect();
}
