import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

const PASSWORD_MIN_LENGTH = 15;
const PASSWORD_MAX_LENGTH = 128;
const SCRYPT_N = 2 ** 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;
const COMMON_PASSWORDS = new Set([
  "demo-password",
  "password",
  "password123",
  "12345678",
  "qwerty123",
  "welcome123",
  "admin123",
]);

try {
  if (process.env.ALLOW_PLATFORM_ADMIN_PROVISION !== "true") {
    throw new Error(
      "Refusing to provision a platform administrator. Set ALLOW_PLATFORM_ADMIN_PROVISION=true for this one command.",
    );
  }

  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.PLATFORM_ADMIN_NAME?.trim() || "Platform Administrator";
  const password = process.env.PLATFORM_ADMIN_PASSWORD;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("PLATFORM_ADMIN_EMAIL must be a valid email address.");
  }

  assertPasswordPolicy(password);

  const matchingUsers = await prisma.user.findMany({
    where: { email },
    select: { id: true, organizationId: true, role: true, status: true },
  });

  if (matchingUsers.length > 0) {
    const existingPlatformAdmin = matchingUsers.find(
      (user) => user.role === "SuperAdmin" && user.organizationId === null,
    );

    if (existingPlatformAdmin) {
      throw new Error(
        `A platform-scoped Super Admin with email ${email} already exists (${existingPlatformAdmin.status}). No password was changed.`,
      );
    }

    throw new Error(
      `Email ${email} already belongs to a clinic user. Use a separate platform-administrator email.`,
    );
  }

  const passwordHash = hashPassword(password);

  const administrator = await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.create({
      data: {
        name,
        email,
        organizationId: null,
        passwordHash,
        role: "SuperAdmin",
        status: "Active",
        isSchedulable: false,
      },
      select: { id: true, email: true, name: true, role: true, status: true },
    });

    await transaction.platformAuditEvent.create({
      data: {
        actorUserId: user.id,
        entityType: "platform_user",
        entityId: user.id,
        action: "bootstrap_provisioned",
        description: "Initial platform administrator provisioned through the guarded CLI command.",
        payload: { email: user.email, role: user.role },
      },
    });

    return user;
  });

  console.log(
    `Provisioned active ${administrator.role} account for ${administrator.email}. The password was not logged.`,
  );
} finally {
  await prisma.$disconnect();
}

function assertPasswordPolicy(password) {
  if (
    typeof password !== "string" ||
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH ||
    password.includes("\0") ||
    COMMON_PASSWORDS.has(password.toLowerCase())
  ) {
    throw new Error(
      `PLATFORM_ADMIN_PASSWORD must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters and must not be a commonly used password.`,
    );
  }
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEMORY,
  });

  return `scrypt$v1$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash.toString("hex")}`;
}
