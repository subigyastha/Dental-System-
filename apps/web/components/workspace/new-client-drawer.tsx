"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { DualDateDisplay } from "@/components/calendar-ui";
import { Button } from "@/components/ui";
import {
  ClientMinimalIntakeFields,
  type MinimalClientIntake,
} from "@/components/workspace/client-intake-fields";
import { ClientMatchReview } from "@/components/workspace/client-match-review";
import { Drawer, inputClassName, textareaClassName } from "@/components/workspace/elements";
import { useWorkspaceApp } from "@/components/workspace/app-state";
import { ApiRequestError } from "@/lib/api-client";
import {
  canonicalPhoneDigits,
  clientIntakeFingerprint,
  createClientAttemptKey,
  validateMinimalClientIntake,
} from "@/lib/client-intake";
import {
  appendClientPhone,
  createStandaloneClient,
  loadNumberMatches,
  type CreatedClientResult,
  type CreateStandaloneClientInput,
  type NumberMatchResult,
} from "@/lib/client-identity";
import { maskPhone } from "@/lib/guided-booking";
import { requestErrorMessage } from "@/lib/request-error";

type Step = "details" | "matches" | "confirm" | "success";
type ExpandedClientIntake = {
  email: string;
  gender: string;
  dateOfBirthIso: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  allergies: string;
  medicalNotes: string;
  risk: "Routine" | "Needs attention" | "High priority";
};

const emptyMinimal: MinimalClientIntake = {
  name: "",
  phone: "",
  address: "",
  priorVisitedClinic: false,
};
const emptyExpanded: ExpandedClientIntake = {
  email: "",
  gender: "",
  dateOfBirthIso: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  allergies: "",
  medicalNotes: "",
  risk: "Routine",
};

export function NewClientDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (client: CreatedClientResult) => void;
}) {
  const router = useRouter();
  const app = useWorkspaceApp();
  const [step, setStep] = useState<Step>("details");
  const [minimal, setMinimal] = useState(emptyMinimal);
  const [expanded, setExpanded] = useState(emptyExpanded);
  const [matchResult, setMatchResult] = useState<NumberMatchResult | null>(null);
  const [reviewedFingerprint, setReviewedFingerprint] = useState<string | null>(null);
  const [skippedIds, setSkippedIds] = useState<string[]>([]);
  const [result, setResult] = useState<CreatedClientResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"matching" | "creating" | "appending" | null>(
    null,
  );
  const matchRequestRef = useRef<AbortController | null>(null);
  const submitLockRef = useRef(false);
  const attemptRef = useRef<{
    key: string;
    fingerprint: string;
    payload: CreateStandaloneClientInput;
  } | null>(null);
  const isDirty =
    clientIntakeFingerprint(minimal) !==
      clientIntakeFingerprint(emptyMinimal) ||
    JSON.stringify(expanded) !== JSON.stringify(emptyExpanded);

  useEffect(
    () => () => {
      matchRequestRef.current?.abort();
    },
    [],
  );

  function updateMinimal(next: MinimalClientIntake) {
    matchRequestRef.current?.abort();
    matchRequestRef.current = null;
    setBusy(null);
    setMinimal(next);
    setMatchResult(null);
    setReviewedFingerprint(null);
    setSkippedIds([]);
    attemptRef.current = null;
    if (step !== "details") setStep("details");
  }

  function updateExpanded<Key extends keyof ExpandedClientIntake>(
    key: Key,
    value: ExpandedClientIntake[Key],
  ) {
    setExpanded((current) => ({ ...current, [key]: value }));
    attemptRef.current = null;
  }

  function requestClose() {
    if (busy) return;
    if (
      step !== "success" &&
      isDirty &&
      !window.confirm("Discard this new Client draft?")
    ) {
      return;
    }
    onClose();
  }

  async function reviewMatches() {
    const validation = validateMinimalClientIntake(minimal);
    if (validation) {
      setError(validation);
      return;
    }
    matchRequestRef.current?.abort();
    const controller = new AbortController();
    matchRequestRef.current = controller;
    setBusy("matching");
    setError(null);
    try {
      const next = await loadNumberMatches(minimal.phone, {
        name: minimal.name,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setMatchResult(next);
      setReviewedFingerprint(clientIntakeFingerprint(minimal));
      setSkippedIds([]);
      setStep(next.matches.length ? "matches" : "confirm");
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(
          requestErrorMessage(
            cause,
            "Possible matches could not be checked. Try again.",
          ),
        );
      }
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  async function handleExistingClient(
    client: NumberMatchResult["matches"][number]["client"],
  ) {
    setBusy("appending");
    setError(null);
    try {
      const entered = canonicalPhoneDigits(minimal.phone);
      const alreadyKnown = client.phoneSummaries.some(
        (phone) => canonicalPhoneDigits(phone.displayValue) === entered,
      );
      if (!alreadyKnown) {
        if (!matchResult) {
          throw new Error("Review possible Client matches again.");
        }
        await appendClientPhone(client.id, minimal.phone, {
          name: minimal.name,
          candidateSetVersion: matchResult.candidateSetVersion,
        });
      }
      window.dispatchEvent(
        new CustomEvent("clinicflow:client-changed", {
          detail: { clientId: client.id },
        }),
      );
      onClose();
      router.push(`/clients/${client.id}`);
    } catch (cause) {
      setError(
        requestErrorMessage(
          cause,
          "Unable to use this Client or append the new phone.",
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  async function createClient() {
    if (
      submitLockRef.current ||
      !matchResult ||
      reviewedFingerprint !== clientIntakeFingerprint(minimal)
    ) {
      setError("Review possible Client matches again before creating.");
      setStep("details");
      return;
    }
    const payload: CreateStandaloneClientInput = {
      name: minimal.name.trim(),
      phone: minimal.phone.trim(),
      address: minimal.address.trim() || undefined,
      priorVisitedClinic: minimal.priorVisitedClinic,
      candidateSetVersion: matchResult.candidateSetVersion,
      duplicateCheckAcknowledged: matchResult.matches.length > 0,
      skippedPossibleMatchClientIds: skippedIds,
      email: expanded.email.trim() || undefined,
      gender: expanded.gender.trim() || undefined,
      dateOfBirthIso: expanded.dateOfBirthIso || undefined,
      emergencyContactName: expanded.emergencyContactName.trim() || undefined,
      emergencyContactPhone:
        expanded.emergencyContactPhone.trim() || undefined,
      allergies: expanded.allergies.trim() || undefined,
      medicalNotes: expanded.medicalNotes.trim() || undefined,
      risk: expanded.risk,
    };
    const fingerprint = JSON.stringify(payload);
    const attempt =
      attemptRef.current?.fingerprint === fingerprint
        ? attemptRef.current
        : {
            key: createClientAttemptKey(),
            fingerprint,
            payload,
          };
    attemptRef.current = attempt;
    submitLockRef.current = true;
    setBusy("creating");
    setError(null);
    try {
      const created = await createStandaloneClient(
        attempt.payload,
        attempt.key,
      );
      setResult(created);
      setStep("success");
      onCreated(created);
      window.dispatchEvent(
        new CustomEvent("clinicflow:client-changed", {
          detail: { clientId: created.id },
        }),
      );
    } catch (cause) {
      if (
        cause instanceof ApiRequestError &&
        (cause.reason === "IDENTITY_MATCH_CHANGED" ||
          cause.reason === "MATCH_REVIEW_REQUIRED")
      ) {
        attemptRef.current = null;
        setMatchResult(null);
        setReviewedFingerprint(null);
        setSkippedIds([]);
        setStep("details");
        setError(
          "Possible matches changed while this draft was open. Review them again.",
        );
      } else {
        setError(
          requestErrorMessage(
            cause,
            "Unable to create the Client. Retry safely with this draft.",
          ),
        );
      }
    } finally {
      submitLockRef.current = false;
      setBusy(null);
    }
  }

  if (step === "success" && result) {
    return (
      <Drawer
        context="The Client was created by the clinic server."
        onClose={requestClose}
        stepLabel="Client created"
        title="New Client"
      >
        <div aria-live="polite" className="space-y-5">
          <div
            className="rounded-lg border border-emerald-200 bg-emerald-50 p-4"
            data-drawer-autofocus
            tabIndex={-1}
          >
            <p className="font-semibold text-emerald-900">{result.name}</p>
            <p className="mt-1 text-sm text-emerald-800">
              {result.clientCode ?? "Client code assigned"} ·{" "}
              {maskPhone(result.phone)}
            </p>
            {result.identityReview ? (
              <p className="mt-2 text-sm text-amber-900">
                Identity review queued for clinic follow-up.
              </p>
            ) : null}
          </div>
          <DrawerFooter>
            <Button onClick={requestClose} variant="ghost">
              Done
            </Button>
            <Button onClick={() => router.push(`/clients/${result.id}`)}>
              View Client
            </Button>
          </DrawerFooter>
        </div>
      </Drawer>
    );
  }

  if (step === "matches" && matchResult) {
    return (
      <Drawer
        closeDisabled={Boolean(busy)}
        context="Choose a record only when you are confident it is the same person."
        onClose={requestClose}
        stepLabel="Step 2 · Possible matches"
        title="New Client"
      >
        <div className="space-y-4">
          <Button disabled={Boolean(busy)} onClick={() => setStep("details")} variant="ghost">
            Back
          </Button>
          <ClientMatchReview
            disabled={Boolean(busy)}
            matches={matchResult.matches}
            onContinueAsNew={() => {
              setSkippedIds(
                matchResult.matches.map((match) => match.client.id),
              );
              setStep("confirm");
            }}
            onUseExisting={(client) => void handleExistingClient(client)}
          />
          <InlineError message={error} />
        </div>
      </Drawer>
    );
  }

  if (step === "confirm" && matchResult) {
    return (
      <Drawer
        closeDisabled={Boolean(busy)}
        context="Confirm the identity details before creating the record."
        onClose={requestClose}
        stepLabel="Step 3 · Confirm"
        title="New Client"
      >
        <div className="space-y-5">
          <Button disabled={Boolean(busy)} onClick={() => setStep(matchResult.matches.length ? "matches" : "details")} variant="ghost">
            Back
          </Button>
          <div
            className="rounded-lg border border-[var(--border)] p-4"
            data-drawer-autofocus
            tabIndex={-1}
          >
            <p className="font-semibold">{minimal.name.trim()}</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {maskPhone(minimal.phone)}
            </p>
            {minimal.address.trim() ? (
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {minimal.address.trim()}
              </p>
            ) : null}
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              Risk: {expanded.risk}
              {minimal.priorVisitedClinic
                ? " · Prior visit claimed; review will be queued"
                : ""}
            </p>
          </div>
          <InlineError message={error} />
          <DrawerFooter>
            <Button disabled={Boolean(busy)} onClick={() => setStep("details")} variant="ghost">
              Edit details
            </Button>
            <Button
              loading={busy === "creating"}
              loadingLabel="Creating Client"
              onClick={() => void createClient()}
            >
              Create Client
            </Button>
          </DrawerFooter>
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      closeDisabled={Boolean(busy)}
      context="Only name and phone are required. Shared household numbers are allowed."
      onClose={requestClose}
      stepLabel="Step 1 · Client details"
      title="New Client"
    >
      <div className="space-y-5">
        <ClientMinimalIntakeFields
          autofocus
          disabled={Boolean(busy)}
          intake={minimal}
          onChange={updateMinimal}
        />
        <details className="rounded-lg border border-[var(--border)] p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            More details
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <ExpandedField label="Email">
              <input
                autoComplete="email"
                className={inputClassName}
                disabled={Boolean(busy)}
                onChange={(event) => updateExpanded("email", event.target.value)}
                type="email"
                value={expanded.email}
              />
            </ExpandedField>
            <ExpandedField label="Date of birth (AD)">
              <input
                className={inputClassName}
                disabled={Boolean(busy)}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) =>
                  updateExpanded("dateOfBirthIso", event.target.value)
                }
                type="date"
                value={expanded.dateOfBirthIso}
              />
              {expanded.dateOfBirthIso ? (
                <div className="mt-2">
                  <DualDateDisplay
                    adDateKey={expanded.dateOfBirthIso}
                    mode={app.calendarMode}
                    variant="short"
                  />
                </div>
              ) : null}
            </ExpandedField>
            <ExpandedField label="Gender">
              <input
                className={inputClassName}
                disabled={Boolean(busy)}
                onChange={(event) => updateExpanded("gender", event.target.value)}
                value={expanded.gender}
              />
            </ExpandedField>
            <ExpandedField label="Risk">
              <select
                className={inputClassName}
                disabled={Boolean(busy)}
                onChange={(event) =>
                  updateExpanded(
                    "risk",
                    event.target.value as ExpandedClientIntake["risk"],
                  )
                }
                value={expanded.risk}
              >
                <option>Routine</option>
                <option>Needs attention</option>
                <option>High priority</option>
              </select>
            </ExpandedField>
            <ExpandedField label="Emergency contact name">
              <input
                autoComplete="name"
                className={inputClassName}
                disabled={Boolean(busy)}
                onChange={(event) =>
                  updateExpanded("emergencyContactName", event.target.value)
                }
                value={expanded.emergencyContactName}
              />
            </ExpandedField>
            <ExpandedField label="Emergency contact phone">
              <input
                autoComplete="tel"
                className={inputClassName}
                disabled={Boolean(busy)}
                inputMode="tel"
                onChange={(event) =>
                  updateExpanded("emergencyContactPhone", event.target.value)
                }
                value={expanded.emergencyContactPhone}
              />
            </ExpandedField>
            <ExpandedField label="Allergies">
              <textarea
                className={textareaClassName}
                disabled={Boolean(busy)}
                onChange={(event) =>
                  updateExpanded("allergies", event.target.value)
                }
                value={expanded.allergies}
              />
            </ExpandedField>
            <ExpandedField label="Medical notes">
              <textarea
                className={textareaClassName}
                disabled={Boolean(busy)}
                onChange={(event) =>
                  updateExpanded("medicalNotes", event.target.value)
                }
                value={expanded.medicalNotes}
              />
            </ExpandedField>
          </div>
        </details>
        <InlineError message={error} />
        <DrawerFooter>
          <Button disabled={Boolean(busy)} onClick={requestClose} variant="ghost">
            Cancel
          </Button>
          <Button
            loading={busy === "matching"}
            loadingLabel="Checking matches"
            onClick={() => void reviewMatches()}
          >
            Continue
          </Button>
        </DrawerFooter>
      </div>
    </Drawer>
  );
}

function ExpandedField({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="block space-y-2 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}

function InlineError({ message }: { message: string | null }) {
  return message ? (
    <p
      aria-live="assertive"
      className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-[var(--danger)]"
      role="alert"
    >
      {message}
    </p>
  ) : null;
}

function DrawerFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky -bottom-5 -mx-5 flex justify-end gap-2 border-t border-[var(--border)] bg-white px-5 py-4">
      {children}
    </div>
  );
}
