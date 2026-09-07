"use client";

import { Users } from "lucide-react";

import { Button } from "@/components/ui";
import {
  primaryPhone,
  type BookingClientIdentity,
  type NumberMatch,
} from "@/lib/client-identity";
import { maskPhone } from "@/lib/guided-booking";

export function ClientMatchReview({
  disabled = false,
  matches,
  onContinueAsNew,
  onUseExisting,
}: {
  disabled?: boolean;
  matches: NumberMatch[];
  onContinueAsNew: () => void;
  onUseExisting: (client: BookingClientIdentity) => void;
}) {
  return (
    <div className="space-y-4">
      <div
        aria-live="polite"
        className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
        data-drawer-autofocus
        tabIndex={-1}
      >
        No match is selected automatically. A shared household number may
        legitimately belong to more than one Client.
      </div>
      {matches.map((match) => (
        <div
          className="rounded-lg border border-[var(--border)] p-4"
          key={match.client.id}
        >
          <ClientIdentitySummary client={match.client} />
          <p className="mt-2 text-xs capitalize text-[var(--text-muted)]">
            {match.classification.replace("_", " ")} · matched on{" "}
            {match.matchedOn.join(" and ")}
          </p>
          <Button
            aria-label={`Use ${match.client.name}`}
            className="mt-3 w-full"
            disabled={disabled}
            onClick={() => onUseExisting(match.client)}
            variant="secondary"
          >
            Use this Client
          </Button>
        </div>
      ))}
      <Button
        className="min-h-11 w-full"
        disabled={disabled}
        onClick={onContinueAsNew}
      >
        Continue as a distinct new Client
      </Button>
    </div>
  );
}

export function ClientIdentitySummary({
  client,
}: {
  client: BookingClientIdentity;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]">
        <Users aria-hidden="true" size={17} />
      </span>
      <span>
        <strong className="block text-sm">{client.name}</strong>
        <span className="block text-xs text-[var(--text-muted)]">
          {maskPhone(primaryPhone(client))}
        </span>
      </span>
    </div>
  );
}
