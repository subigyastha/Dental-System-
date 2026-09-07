/**
 * Canonical comparison key for Nepal phone numbers.
 *
 * The database keeps the entered value for display/audit. This key deliberately
 * contains digits only so local mobile forms, 0-prefixed forms, +977 forms, and
 * 00977 forms resolve to the same ClientPhone identity.
 */
export function normalizeClientPhone(value?: string | null) {
  let digits = value?.replace(/\D+/g, "") ?? "";
  if (!digits) {
    return "";
  }

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }
  if (digits.startsWith("977")) {
    return digits;
  }
  if (digits.startsWith("0") && digits.length >= 9 && digits.length <= 11) {
    return `977${digits.slice(1)}`;
  }
  if (digits.length === 10 && digits.startsWith("9")) {
    return `977${digits}`;
  }

  return digits;
}
