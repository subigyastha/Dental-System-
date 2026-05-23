import { NepaliDate } from "nepali-date-library";

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

const nepaliDigitMap: Record<string, string> = {
  "०": "0",
  "१": "1",
  "२": "2",
  "३": "3",
  "४": "4",
  "५": "5",
  "६": "6",
  "७": "7",
  "८": "8",
  "९": "9",
};

export function normalizeNepaliDigits(value: string) {
  return value.replace(/[०-९]/g, (digit) => nepaliDigitMap[digit] ?? digit);
}

export function normalizeDateInput(value: string) {
  return normalizeNepaliDigits(value).trim().replace(/[/.]/g, "-");
}

export function isValidAdDateKey(value: string) {
  const normalized = normalizeDateInput(value);
  if (!dateKeyPattern.test(normalized)) {
    return false;
  }

  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isValidBsDateKey(value: string) {
  const normalized = normalizeDateInput(value);
  if (!dateKeyPattern.test(normalized)) {
    return false;
  }

  const [year, month, day] = normalized.split("-").map(Number);
  return NepaliDate.isValid(year, month - 1, day);
}

export function normalizeAdDateKey(value: string) {
  const normalized = normalizeDateInput(value);
  if (!isValidAdDateKey(normalized)) {
    throw new Error(`Invalid AD date key: ${value}`);
  }
  return normalized;
}

export function normalizeBsDateKey(value: string) {
  const normalized = normalizeDateInput(value);
  if (!isValidBsDateKey(normalized)) {
    throw new Error(`Invalid BS date key: ${value}`);
  }
  return normalized;
}
