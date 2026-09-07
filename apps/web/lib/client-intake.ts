import type { MinimalClientIntake } from "@/components/workspace/client-intake-fields";

export function clientIntakeFingerprint(intake: MinimalClientIntake) {
  return JSON.stringify({
    name: intake.name.trim().toLocaleLowerCase().replace(/\s+/g, " "),
    phone: intake.phone.replace(/\D/g, ""),
    address: intake.address.trim(),
    priorVisitedClinic: intake.priorVisitedClinic,
  });
}

export function canonicalPhoneDigits(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("9")) return `977${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) {
    return canonicalPhoneDigits(digits.slice(1));
  }
  return digits;
}

export function createClientAttemptKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function validateMinimalClientIntake(intake: MinimalClientIntake) {
  if (!intake.name.trim()) return "Enter the Client's full name.";
  const digits = intake.phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return "Enter a phone number containing 7 to 15 digits.";
  }
  return null;
}
