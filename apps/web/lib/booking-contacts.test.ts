import assert from "node:assert/strict";
import test from "node:test";

import {
  bookingContactNameForPhone,
  isBookingContactPickerSupported,
  parseBookingContact,
  pickBookingContact,
  type BookingContactPickerEnvironment,
} from "./booking-contacts";

test("contact picker support requires a secure top-level context and API", () => {
  const picker = { select: async () => [] };
  assert.equal(isBookingContactPickerSupported({
    isSecureContext: true,
    isTopLevel: true,
    contacts: picker,
  }), true);
  assert.equal(isBookingContactPickerSupported({
    isSecureContext: false,
    isTopLevel: true,
    contacts: picker,
  }), false);
  assert.equal(isBookingContactPickerSupported({
    isSecureContext: true,
    isTopLevel: false,
    contacts: picker,
  }), false);
  assert.equal(isBookingContactPickerSupported({
    isSecureContext: true,
    isTopLevel: true,
  }), false);
});

test("selection requests one contact with only name and phone, then parses its first result", async () => {
  const calls: unknown[][] = [];
  const environment: BookingContactPickerEnvironment = {
    isSecureContext: true,
    isTopLevel: true,
    contacts: {
      select: async (...args) => {
        calls.push(args);
        return [
          { name: ["  Mina Rai  "], tel: ["+977 9841234567"] },
          { name: ["Ignored"], tel: ["9800000000"] },
        ];
      },
    },
  };

  assert.deepEqual(await pickBookingContact(environment), {
    name: "Mina Rai",
    phones: ["+977 9841234567"],
  });
  assert.deepEqual(calls, [[ ["name", "tel"], { multiple: false } ]]);
});

test("contact parsing filters invalid values and deduplicates Nepal number spellings", () => {
  assert.deepEqual(parseBookingContact({
    name: ["Asha", "Other"],
    tel: [
      "9841234567",
      "+977 9841234567",
      "  09841234567  ",
      "123",
      9841234567,
      "+977-9801234567",
    ],
  }), {
    name: "Asha",
    phones: ["9841234567", "+977-9801234567"],
  });
  assert.equal(parseBookingContact(null), null);
  assert.deepEqual(parseBookingContact({ name: ["No phone"], tel: [] }), {
    name: "No phone",
    phones: [],
  });
});

test("picker cancellation and denial return no contact while other errors remain visible", async () => {
  for (const name of ["AbortError", "NotAllowedError"]) {
    const environment: BookingContactPickerEnvironment = {
      isSecureContext: true,
      isTopLevel: true,
      contacts: {
        select: async () => { throw new DOMException("Dismissed", name); },
      },
    };
    assert.equal(await pickBookingContact(environment), null);
  }

  const failed: BookingContactPickerEnvironment = {
    isSecureContext: true,
    isTopLevel: true,
    contacts: { select: async () => { throw new Error("Picker failed"); } },
  };
  await assert.rejects(pickBookingContact(failed), /Picker failed/);
});

test("empty picker result is cancellation and imported name follows only the same phone", async () => {
  const environment: BookingContactPickerEnvironment = {
    isSecureContext: true,
    isTopLevel: true,
    contacts: { select: async () => [] },
  };
  assert.equal(await pickBookingContact(environment), null);

  const contact = { name: "Mina Rai", phone: "9841234567" };
  assert.equal(bookingContactNameForPhone(contact, "+977 9841234567"), "Mina Rai");
  assert.equal(bookingContactNameForPhone(contact, "9801234567"), "");
  assert.equal(bookingContactNameForPhone(null, "9841234567"), "");
});
