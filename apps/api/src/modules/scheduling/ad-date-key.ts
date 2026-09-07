import {
  buildMessage,
  ValidateBy,
  type ValidationOptions,
} from "class-validator";

const AD_DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isGregorianLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function isValidAdDateKey(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const match = AD_DATE_KEY_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const daysInMonth = [
    31,
    isGregorianLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return day <= daysInMonth[month - 1];
}

export function adDateKeyInTimeZone(
  date: Date,
  timeZone = "Asia/Kathmandu",
) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function IsAdDateKey(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: "isAdDateKey",
      validator: {
        validate: isValidAdDateKey,
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must be a real Gregorian AD date in YYYY-MM-DD format`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
