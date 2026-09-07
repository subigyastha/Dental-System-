"use client";

export type MinimalClientIntake = {
  name: string;
  phone: string;
  address: string;
  priorVisitedClinic: boolean;
};

const inputClassName =
  "h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]";

export function ClientMinimalIntakeFields({
  autofocus = false,
  disabled = false,
  intake,
  onChange,
}: {
  autofocus?: boolean;
  disabled?: boolean;
  intake: MinimalClientIntake;
  onChange: (intake: MinimalClientIntake) => void;
}) {
  return (
    <>
      <IntakeField label="Full name" required>
        <input
          autoComplete="name"
          className={inputClassName}
          data-drawer-autofocus={autofocus ? true : undefined}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...intake, name: event.target.value })
          }
          value={intake.name}
        />
      </IntakeField>
      <IntakeField label="Phone number" required>
        <input
          autoComplete="tel"
          className={inputClassName}
          disabled={disabled}
          inputMode="tel"
          onChange={(event) =>
            onChange({ ...intake, phone: event.target.value })
          }
          value={intake.phone}
        />
      </IntakeField>
      <IntakeField label="Address">
        <input
          autoComplete="street-address"
          className={inputClassName}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...intake, address: event.target.value })
          }
          value={intake.address}
        />
      </IntakeField>
      <label className="flex min-h-11 items-start gap-3 rounded-lg border border-[var(--border)] p-3 text-sm">
        <input
          checked={intake.priorVisitedClinic}
          className="mt-0.5 size-4"
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...intake,
              priorVisitedClinic: event.target.checked,
            })
          }
          type="checkbox"
        />
        This person has visited this clinic before
      </label>
    </>
  );
}

function IntakeField({
  children,
  label,
  required = false,
}: {
  children: React.ReactNode;
  label: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm font-medium">
      <span className="mb-1.5 block">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}
