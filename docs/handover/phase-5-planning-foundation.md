# Phase 5 planning foundation handover

Date: 19 September 2026
Correction baseline: `3a78d6b00ca7f2d1bb55e5bae48e606820afc754`

## Delivered

- Migration 009 closes the civil-date boundary while released Migrations 001–008 remain byte-identical.
- New transaction inserts require an explicit valid `occurred_on`; budgets, goal targets, and goal entries have strict insert/update Gregorian triggers.
- Schema 9 uses backup envelope v1/manifest v2. Authenticated schema 4–7 manifest-v1 and schema-8 manifest-v2 payloads restore into isolated schema-9 staging databases.
- Budget edits reject archived/deleted rows and lock period, currency, and scope after qualifying activity. Allocation mutation and archive restoration use exclusive transactions and revalidate meaningful targets, limits, rollover, and overlap.
- Restore validation accepts category-only budgets and requires goal transfer evidence to use the linked account's correct transfer leg and pair semantics.
- Money/timestamp write boundaries enforce safe integers. Supported currencies are BDT, USD, GBP, EUR, SAR, AED, MYR, INR, and PKR, each with two fractional digits.
- Planning UI uses integer-minor-unit parsing/display, explicit global currencies, edit/review/dirty-form/submission-lock behavior, budget drill-down, target-only goals, all three entry modes, and entry deletion/restoration.
- English and Bengali planning keys have parity; internal codes map to safe localized messages.

## Verification boundary

Jest uses deterministic mocks and a native-compatible SQLite adapter; it is not native runtime QA. Expo web export and Android prebuild are build-time checks only.

## Manual QA still required

- Android emulator or physical device: all planning lifecycle and entry modes, backup, process termination, and restore.
- Browser with deployment cross-origin-isolation headers: create planning data, fully reload, and verify SQLite/OPFS persistence.
- Manual accessibility review at 200% text scaling with TalkBack/VoiceOver, keyboard navigation, privacy masking, Bangla copy, and compact screens.
