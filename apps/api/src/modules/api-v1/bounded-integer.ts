import { BadRequestException } from "@nestjs/common";

export function boundedInteger(
  value: unknown,
  {
    defaultValue,
    field,
    max,
    min = 1,
  }: {
    defaultValue: number;
    field: string;
    max: number;
    min?: number;
  },
) {
  const normalized =
    typeof value === "string" && /^\d+$/.test(value.trim())
      ? Number(value)
      : value;

  if (
    typeof normalized !== "number" ||
    !Number.isInteger(normalized) ||
    normalized < min ||
    normalized > max
  ) {
    if (value === undefined || value === null) {
      return defaultValue;
    }
    throw new BadRequestException(`${field} must be an integer between ${min} and ${max}`);
  }

  return normalized;
}
