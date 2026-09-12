# 07 — Privacy Model

## 1. The promises

These are commitments, not marketing. Each one has a technical control behind it, and each
is written in plain language on the in-app privacy screen — not buried in a policy document.

1. **Your financial data is never sold.** Not to advertisers, not to data brokers, not to
   banks, not to anyone, under any circumstance, including acquisition of the company.
2. **Your financial data is never used to build an advertising profile.** There is no
   advertising in Friday Amanah.
3. **Your raw financial data is never used to train AI models** without your explicit,
   specific, informed, opt-in permission for that purpose. Continued use of the app is not
   consent. A checkbox buried in an update is not consent.
4. **In this version, your data never leaves your phone** unless you personally export or
   back it up.
5. **Cloud sync does not exist yet.** When it does, it will be off by default and entirely
   optional. The app will always remain fully usable without it.
6. **You can export everything** in an open format (CSV and JSON) at any time.
7. **You can delete everything**, permanently, from inside the app, without contacting anyone.
8. **No analytics SDK is present.** No usage event of any kind is transmitted.
9. **No third-party tracker ever receives a transaction, a balance, a name, or a note.**
10. **No account is required.** No email, no phone number, no name.

## 2. What we collect

**In the MVP: nothing.** There is no server to collect it with.

All data described in doc 05 is created by the user and stored only in the app's private
storage on their device.

- No device identifiers are transmitted (the `devices.id` UUID stays local)
- No advertising ID is read
- No contacts, location, camera, microphone, or SMS permission is requested
- No crash telemetry is sent automatically

The only OS permissions requested, and only at the moment of use:

| Permission | When | Why |
|---|---|---|
| Biometric | Only if the user enables biometric unlock | Local authentication |
| Notifications | Only if the user enables reminders | Local notifications, scheduled on-device |
| File read | Only when picking an attachment or a restore file | User-initiated |
| File write / share | Only when exporting or backing up | User-initiated |

**No internet permission is used at runtime.** [RECOMMENDED] Verify in Phase 8 with a
packet capture on a release build and record the result — "zero outbound requests, verified"
is a claim worth being able to prove.

## 3. Data lifecycle

| Stage | Behaviour |
|---|---|
| Creation | Written to local SQLite, validated first |
| Storage | App private directory only |
| Soft delete | `deleted_at` set; hidden everywhere; recoverable for 30 days |
| Hard delete | Purged by maintenance after 30 days, or immediately via Delete All Data |
| Export | CSV/JSON to a user-chosen destination — control passes to the user |
| Backup | Encrypted `.fmz` file to a user-chosen destination |
| App uninstall | OS removes the sandbox; exported files elsewhere are unaffected |

The 30-day soft-delete window is stated on the privacy screen. Not disclosing it would make
promise #7 misleading.

## 4. Analytics

**MVP: none.** (ADR-009.)

[LATER] If analytics ever becomes necessary, it must satisfy all of:
opt-in, off by default · aggregate counts only, never per-transaction · self-hosted or
privacy-preserving · no user identifier that persists across installs · a visible list
in-app of every event that would be sent · a single switch that stops everything.

Permanently forbidden as analytics events: any amount · any category name a user typed ·
any counterparty or recipient · any note · any Zakat figure · any balance.

## 5. Children

[ASSUMPTION] The app is intended for adults. A teen household role is planned [LATER]. If
under-13 usage ever becomes plausible, COPPA-equivalent review is required first. The MVP
collects nothing and has no social features, which keeps this simple for now.

## 6. Third parties

**MVP third-party data recipients: none.**

App store distribution means Google and Apple see download and crash data at the platform
level. This is outside our control and is disclosed plainly rather than glossed over.

Every future third party must be listed in-app by name, purpose, and data category before it
receives anything.

## 7. What the user sees in the app

The privacy screen (`/settings/legal/privacy`) uses plain Bangla and English, roughly one
screen long, and covers: what is stored, where it is stored, what leaves the device (nothing,
unless you export), what we cannot recover for you (your PIN, your backup passphrase), the
30-day deletion window, and how to delete everything. It links to the full policy for people
who want it, but the summary is the primary artefact.

**Wording principle:** if a sentence would embarrass us when read aloud by a journalist, it
is the wrong sentence.

## 8. Rules for the [LATER] "Amanah Guide" AI assistant

Recorded now so the constraints are set before anyone builds it.

**May:** summarise spending patterns · explain budget performance · flag unusual
transactions · propose a budget the user then edits and approves · compare periods ·
explain goal progress · help draft a repayment schedule · answer questions about data the
user has explicitly selected.

**Must not:** create, edit, or delete a transaction on its own · issue a Fatwa or any
religious ruling · declare anything halal or haram · guarantee a return · shame the user ·
send any financial data to an external provider without a specific, per-session, informed
opt-in that names the provider and the data.

**Preferred architecture:** on-device inference, or a strictly opt-in mode where the exact
payload is shown to the user before it is sent. **Default must be off.** If a hosted model
is used, the data sent must be minimised and pseudonymised, and the provider must be named
in the app.
