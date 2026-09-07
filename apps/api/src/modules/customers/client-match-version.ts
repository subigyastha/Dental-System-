import { createHash } from "node:crypto";

export const clientPhoneNormalizationVersion = "np-v1";

export type ClientMatchVersionCandidate = {
  id: string;
  updatedAt: Date;
  phones: Array<{
    id: string;
    normalizedValue: string;
    updatedAt: Date;
  }>;
};

export function buildClientCandidateSetVersion(
  normalizedPhone: string,
  candidates: ClientMatchVersionCandidate[],
) {
  const evidence = candidates
    .map((candidate) => {
      const phones = candidate.phones
        .map(
          (phone) =>
            `${phone.id}:${phone.normalizedValue}:${phone.updatedAt.toISOString()}`,
        )
        .sort()
        .join(",");
      return `${candidate.id}:${candidate.updatedAt.toISOString()}:${phones}`;
    })
    .sort()
    .join("|");

  return createHash("sha256")
    .update(
      `${clientPhoneNormalizationVersion}:${normalizedPhone}:${evidence}`,
    )
    .digest("hex")
    .slice(0, 24);
}
