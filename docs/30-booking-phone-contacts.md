# Phone contacts in booking

Booking can use a phone contact through the browser's Contact Picker when it is
available. The user opens the picker and chooses one contact; the app requests
only the name and phone numbers. If the contact has several valid numbers, the
user chooses which number to use. The selected number follows the existing
phone matching flow. Choosing a contact does not create or select a Client,
rename an existing Client, or bypass identity review.

The contact name can prefill the new Client form for that number. Names and
numbers remain editable, and creation still requires the existing explicit
review and booking actions. Manual phone entry remains available on every
device and when the picker is cancelled or unavailable.

## Browser support and privacy

The Contact Picker requires HTTPS, a top-level page and a user gesture. Support
is limited, so availability is detected at runtime. Permission is on demand:
there is no background address-book access or persistent contact permission.
Only the contact chosen by the user is returned. The feature does not import
the whole phone book or add a contact sync service.

Contact selection itself does not persist an address book. The chosen phone
number is sent through the existing authenticated Client lookup, and Client
data is saved only through the existing explicit creation/booking workflow.

## Recently called contacts

A PWA has no supported API for reading the device's system recent-call list.
The supported alternative is to open the phone's Recents, copy a number and
paste it into booking. Existing **Recent Clients** continues to mean recently
used clinic Clients; it does not claim to be a list of phone calls.

A native Android call-log integration would add sensitive permissions and
distribution restrictions: Google Play generally requires a default Phone or
Assistant handler role or an approved exception. That is a separate product
decision, not a permission the PWA can request. No native wrapper or call-log
access is added by this feature.

Sources:

- [Chrome Contact Picker guide](https://developer.chrome.com/docs/capabilities/web-apis/contact-picker)
- [Contact Picker API support](https://developer.mozilla.org/en-US/docs/Web/API/Contact_Picker_API)
- [Android default handler restrictions](https://developer.android.com/guide/topics/permissions/default-handlers)

## Verification

Focused tests exercise support detection, user-initiated selection, cancellation,
invalid or missing phone values, multiple numbers and equivalent Nepal numbers,
and protection against stale name prefill after editing the phone. Existing
booking identity and hold regressions remain in the normal suite.

Physical-device acceptance must cover the actual picker on a supported Android
browser, denied/cancelled selection, multiple numbers, unsupported-browser
manual entry, and the installed PWA. Synthetic tests must use fake contacts;
real contacts or call history are never accessed without the user's action.
