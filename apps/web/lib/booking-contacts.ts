import { canonicalPhoneDigits } from "@/lib/client-intake";
import { isSearchablePhone } from "@/lib/guided-booking";

export type BookingContact = { name: string; phones: string[] };
export type BookingContactsApi = {
  select(
    properties: Array<"name" | "tel">,
    options: { multiple: false },
  ): Promise<unknown[]>;
};
export type BookingContactPickerEnvironment = {
  isSecureContext: boolean;
  isTopLevel: boolean;
  contacts?: BookingContactsApi;
};

function browserEnvironment(): BookingContactPickerEnvironment {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { isSecureContext: false, isTopLevel: false };
  }
  return {
    isSecureContext: window.isSecureContext,
    isTopLevel: window.self === window.top,
    contacts: (navigator as Navigator & { contacts?: BookingContactsApi }).contacts,
  };
}

export function isBookingContactPickerSupported(
  environment = browserEnvironment(),
) {
  return environment.isSecureContext && environment.isTopLevel &&
    typeof environment.contacts?.select === "function";
}

/** Only the contact explicitly shared by the user is examined, in memory. */
export function parseBookingContact(raw: unknown): BookingContact | null {
  if (!raw || typeof raw !== "object") return null;
  const contact = raw as { name?: unknown; tel?: unknown };
  const name = Array.isArray(contact.name)
    ? contact.name.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim() ?? ""
    : "";
  const phones = new Map<string, string>();
  if (Array.isArray(contact.tel)) {
    for (const value of contact.tel) {
      if (typeof value !== "string" || !isSearchablePhone(value)) continue;
      const phone = value.trim();
      const key = canonicalPhoneDigits(phone);
      if (!phones.has(key)) phones.set(key, phone);
    }
  }
  return { name, phones: [...phones.values()] };
}

export async function pickBookingContact(
  environment = browserEnvironment(),
): Promise<BookingContact | null> {
  if (!isBookingContactPickerSupported(environment)) {
    throw new Error("Phone contacts are unavailable in this browser.");
  }
  try {
    // Call select before any awaited work so the button's user gesture remains
    // active. Request only the name and phone numbers needed for this booking.
    const contacts = await environment.contacts!.select(["name", "tel"], { multiple: false });
    return parseBookingContact(contacts[0]);
  } catch (error) {
    if (error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "NotAllowedError")) return null;
    throw error;
  }
}

/** An imported name is a suggestion for this phone, never a Client identity. */
export function bookingContactNameForPhone(
  contact: { name: string; phone: string } | null,
  phone: string,
) {
  return contact && canonicalPhoneDigits(contact.phone) === canonicalPhoneDigits(phone)
    ? contact.name
    : "";
}
