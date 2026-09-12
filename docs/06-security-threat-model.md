# 06 — Security Threat Model

> **Revision 2 · 5 August 2026.** Section 0 added: mandatory security vocabulary. Read it
> before writing any user-facing, marketing, or developer copy about security.

Scope: the MVP, which is a **local-only mobile application with no backend**. That single
fact eliminates the majority of the attack surface a typical finance app carries. This
document covers what remains, plus a forward-looking section for the [LATER] sync phase.

---

## 0. Security vocabulary — six distinct things, never used interchangeably

Friday Amanah handles other people's money records. Overstating its protection is worse
than having less of it, because a user who believes their database is encrypted will make
different decisions about where they store their phone and who they lend it to.

**These six protections are not equivalent. Never write one when you mean another.**

| # | Protection | What it actually does | Status in the MVP |
|---|---|---|---|
| 1 | **OS device encryption** | The whole phone's storage is encrypted by Android/iOS, unlocked when the user unlocks the device | ✅ Present, but **provided by the operating system, not by us**. Only active if the user has a screen lock |
| 2 | **App sandbox isolation** | The OS prevents other apps from reading our files | ✅ Present, provided by the OS |
| 3 | **App access control** (PIN / biometric) | Stops someone who picks up an unlocked phone from opening *this app* | ⏳ Phase 7. Controls **access to the UI**, not the file on disk |
| 4 | **SecureStore-protected secrets** | The PIN hash, salt, and device ID sit in Android Keystore / iOS Keychain, hardware-backed where available | ⏳ Phase 7. Protects **those specific values only** — not the database |
| 5 | **Encrypted backup** | Exported backup files are AES-256-GCM encrypted with a user passphrase | ⏳ Phase 7. Protects **the exported file**, not the live database |
| 6 | **Whole-database encryption** (SQLCipher) | The SQLite file itself is unreadable without a key, even with the raw file in hand | ❌ **Not in the MVP.** Evaluated in Phase 7 (ADR-006) |
| 7 | **End-to-end encrypted cloud sync** | Server holds only ciphertext it cannot read | ❌ Not built. Phase 9 at the earliest |

### Phrases that are BANNED until the feature actually exists and has been tested

Do not write these in the app, in onboarding, in store listings, on a website, in a README,
in a commit message, or in a reply to a user:

- ❌ "Fully encrypted local database"
- ❌ "Complete at-rest encryption"
- ❌ "End-to-end encryption"
- ❌ "Bank-grade encryption" *(meaningless in any case — banks use ordinary AES)*
- ❌ "Fully protected financial records"
- ❌ "Military-grade security"
- ❌ "Your data is encrypted and always protected" *(this exact sentence appears in the supplied brand feature strip — see doc 17 §5.9)*

### Accurate phrasing to use instead, before Phase 7

- ✅ "Local-first storage — your data stays on your device"
- ✅ "Device-protected application access" / "Protected by PIN and biometric lock"
- ✅ "Sensitive keys are stored using secure platform storage"
- ✅ "Encrypted backup files" — **only once §T-05's implementation is tested**
- ✅ "No account required. No data leaves your phone unless you export it."

### After Phase 7, what becomes sayable

Only what was actually implemented **and verified by the Phase 7 exit criteria**. If
SQLCipher is adopted, "the database file is encrypted at rest" becomes true and may be said.
If it is deferred again, it stays banned. The claim follows the code, never the other way
round.

**Applies to:** doc 01, doc 07, onboarding screens, the privacy screen, the About screen,
store listings, the brand feature strip, and any developer note. The Phase 8 release
checklist includes a copy audit against this table.

---

## 1. What we are protecting

| Asset | Sensitivity | Why |
|---|---|---|
| Transaction records | High | Reveals income, family, habits, health spending, religious practice |
| Account balances | High | Net worth |
| Debts and counterparty names | **Very high** | Names third parties who never consented to being in this app |
| Giving records and recipients | **Very high** | Charity recipients; anonymity may be religiously important to the giver |
| Notes fields | **Very high** | Free text; users write anything here |
| Zakat calculations | High | Full asset picture, including gold |
| PIN | Critical | Gate to everything above |
| Backup encryption passphrase | Critical | Gate to the exported file |
| Backup files | **Very high** | Leave the app sandbox by design |

The two entries that most often get underrated are **counterparty names** and **giving
recipients**. Those are other people's data, held without their knowledge. They get the
strictest handling.

---

## 2. Trust boundaries

```
        ┌──────────────────────────────────────────────┐
        │  DEVICE                                      │
        │                                              │
        │  ┌────────────────────────────────────────┐  │
        │  │  App sandbox (OS enforced)             │  │
        │  │   • SQLite database file               │  │
        │  │   • attachments/  (private dir)        │  │
        │  │   • Keystore / Keychain (SecureStore)  │  │
        │  └────────────────────────────────────────┘  │
        │            │                    │            │
        │   ═════════╪════════════════════╪══════════  │  ◀── trust boundary
        │            ▼                    ▼            │
        │   share sheet / SAF      OS biometric API    │
        │   (backup + exports)                         │
        └──────────────────────────────────────────────┘
                     │
                     ▼
            User-chosen destination
            (Drive, WhatsApp, SD card…)   ◀── we lose all control here
```

**In the MVP there is no network boundary at all.** The only way data leaves the app is
when the user deliberately exports or backs it up. That moment is therefore the single most
important security event in the product, and it is why backup encryption is mandatory
rather than optional.

---

## 3. Threat analysis (STRIDE)

### T-01 · Another app on the device reads our database — *Information disclosure*
**Likelihood:** Low on a healthy device; **High** on a rooted/jailbroken one.
**Impact:** Total.
**Controls:** OS sandbox; never write to shared/external storage; `android:allowBackup="false"`
so the DB is excluded from Android auto-backup; no exported content providers or activities.
**Residual risk:** On a rooted device, the unencrypted DB is readable. **Accepted and
disclosed** (ADR-006). Phase 7 evaluates SQLCipher. A root/jailbreak detection *notice*
(informational, not a block) is [RECOMMENDED] for Phase 7.

### T-02 · Physical access to an unlocked phone — *Elevation of privilege*
**Likelihood:** Medium (shared family phones are common).
**Impact:** High.
**Controls:** Optional PIN (encouraged, not forced); biometric unlock; auto-lock after
inactivity (default 2 min); screen masked in the app switcher; privacy mode hides amounts
even when unlocked; failed-attempt backoff (see T-04).

### T-03 · PIN extracted from storage — *Information disclosure*
**Controls:** The PIN is **never stored**. We store `scrypt(pin, salt)` plus the salt in
`expo-secure-store` (Android Keystore / iOS Keychain). Parameters: `N=2^15, r=8, p=1` via
`@noble/hashes` — [RECOMMENDED] tune on a real mid-range device so verification stays under
about 500 ms. Comparison is constant-time. The PIN never appears in a log, a crash report,
a state object, or a React prop.

### T-04 · PIN brute force — *Elevation of privilege*
A 4-digit PIN is 10,000 combinations, which is nothing without a delay.
**Controls:** exponential backoff — attempts 1–4 free, 5th → 30 s, 6th → 2 min, 7th → 5 min,
8th → 15 min, 10th → 1 hour. The counter and lockout timestamp live in SecureStore so
killing the app does not reset them. Every failed attempt is written to `audit_events`.
[RECOMMENDED] Offer an optional "erase all data after 10 failed attempts" setting, off by
default, with a very explicit confirmation. 6-digit PINs are offered and encouraged.

### T-05 · Backup file leaks — *Information disclosure* — **highest residual risk in the MVP**
The user exports a backup and it lands in Google Drive, a WhatsApp chat, or an SD card.
**Controls:** Backups are **always encrypted, with no opt-out.** AES-256-GCM
(`@noble/ciphers`), key derived from a user passphrase with scrypt and a 16-byte random
salt, 12-byte random nonce, authenticated header containing format version, app version,
KDF parameters, and creation time. The passphrase is never stored, never auto-filled, and
never recoverable — this is stated in bold on the backup screen before the user proceeds.
Minimum passphrase length 10 characters with a strength meter.
**Residual risk:** A weak passphrase plus a leaked file equals compromise. Accepted; the
alternative (a device-bound key) would make backups useless for phone migration, which is
their entire purpose.

### T-06 · Malicious or corrupt restore file — *Tampering / DoS*
Someone hands the user a crafted `.fmz` file.
**Controls:** AES-GCM authentication fails on any tampering, before parsing. Format version
checked against a supported range. Decompressed size capped (zip-bomb guard). Every record
validated against its Zod schema; a single invalid record aborts the entire restore. Restore
runs into a **temporary database file**, is verified there, and only then atomically replaces
the live database. The current database is backed up first. The user sees a summary
("1,204 transactions, 6 accounts, created 12 July 2026") and must confirm explicitly.
**Restore never merges silently and never partially applies.**

### T-07 · SQL injection — *Tampering*
User-controlled text (notes, names, search terms) reaching SQL.
**Controls:** 100% parameterised queries. String concatenation into SQL is banned and
enforced by an ESLint rule plus a CI grep for `db.exec` with a template literal. Table and
column names are never dynamic. FTS search terms are escaped and quoted.

### T-08 · Malicious file import as an attachment — *Tampering*
**Controls:** Allowlist of MIME types (`image/jpeg`, `image/png`, `image/webp`,
`application/pdf`). Size cap 10 MB. Magic-byte check, not just the declared extension.
Files are copied into the private directory with a generated UUID filename — the original
name is stored only as metadata and never used as a path. Path traversal characters are
stripped. Attachments are never executed, and PDFs are opened by the OS viewer, not rendered
in-app.

### T-09 · Sensitive data in logs or crash reports — *Information disclosure*
**Controls:** All logging goes through `src/lib/logger.ts`, which redacts by key name
(section 7). `console.*` is stripped from release builds by
`babel-plugin-transform-remove-console`. No automatic crash reporting exists (ADR-009). The
error screen's "copy diagnostics" payload contains app version, OS version, route name, and
error class only, and the user sees exactly what is on the clipboard before sharing.

### T-10 · Screen capture and shoulder surfing — *Information disclosure*
**Controls:** Privacy mode masks all amounts with one tap from anywhere. The app switcher
preview is masked (`FLAG_SECURE`-equivalent on Android; a blur overlay on iOS).
[RECOMMENDED] Leave full screenshot blocking off by default — users legitimately screenshot
their own reports — but offer it as a setting.

### T-11 · Insecure direct object reference — *Elevation of privilege*
Not exploitable in the MVP (single local user, no network). It becomes real the moment
households or sync exist. **Control designed now:** every repository function takes a
`profileId` (later `householdId`) and includes it in the `WHERE` clause. No repository
function ever fetches by `id` alone. Establishing this habit now is what prevents the
classic IDOR bug later.

### T-12 · Clipboard leakage — *Information disclosure*
**Controls:** No amount or note is ever copied to the clipboard automatically. Where copy is
offered explicitly, Android's `IS_SENSITIVE` clipboard flag is set where available.

### T-13 · Dependency supply chain — *Tampering*
**Controls:** `package-lock.json` committed. `npm audit` in CI, failing on high/critical.
No dependency added without a stated reason in the PR. Prefer Expo-maintained and audited
packages (`@noble/*` is chosen partly for this). Dependency count is treated as a budget.

### T-14 · Tapjacking / overlay attacks (Android) — *Spoofing*
**Controls:** `filterTouchesWhenObscured` on the PIN entry and on destructive confirmation
screens. [RECOMMENDED] Phase 7.

### T-15 · Weak randomness — *Spoofing*
**Controls:** All salts, nonces, and UUIDs come from `expo-crypto`'s
`getRandomBytesAsync` (OS CSPRNG). `Math.random()` is banned in any security context and is
caught by a lint rule.

---

## 4. [LATER] Threats that arrive with cloud sync — Phase 9 gate

**These are recorded so the gate is unambiguous. None apply to the MVP.**

Server-side data breach · credential stuffing · session hijacking · broken row-level
security exposing another user's rows · sync conflict causing silent data loss · malicious
server returning crafted payloads · man-in-the-middle · account recovery abuse · insider
access at the hosting provider · API rate-limit abuse · deleted-data resurrection from
backups.

**Hard gate:** before the first line of sync code, this document must gain a full section
with a data-flow diagram, an encryption-key custody decision (client-side E2E encryption is
strongly preferred so the server holds only ciphertext), an RLS policy table, and an
incident response plan. **No exceptions.**

---

## 5. Security controls checklist

Run this at the end of Phases 2, 5, 7, and 8. Record the result in the phase handoff.

### Storage
- [ ] No secret, key, or credential in the repository (verified with `gitleaks`)
- [ ] `.env` and `*.keystore` in `.gitignore`
- [ ] PIN stored only as a scrypt hash in SecureStore
- [ ] `android:allowBackup="false"`
- [ ] Attachments in the private directory only
- [ ] No money column is `REAL`

### Input
- [ ] Every SQL query parameterised — zero string concatenation
- [ ] Every write validated by a Zod schema before it reaches the database
- [ ] Amount inputs reject negatives, non-numerics, and values above the sane maximum
- [ ] Text inputs length-capped
- [ ] Imported files pass MIME allowlist, size cap, and magic-byte check
- [ ] CSV export sanitises `= + - @ TAB CR` leading characters

### Access
- [ ] Auto-lock works after backgrounding
- [ ] Failed-PIN backoff persists across app restarts
- [ ] App-switcher preview is masked
- [ ] Biometric failure falls back to PIN, never bypasses it
- [ ] Every repository function is scoped by `profile_id`

### Output
- [ ] No sensitive value in any log in a release build
- [ ] Error messages contain no SQL, no file paths, no stack traces
- [ ] Diagnostics payload is redacted and shown before sharing

### Backup
- [ ] Backup is always encrypted; no plaintext option exists
- [ ] Restore verifies authentication tag before parsing
- [ ] Restore is atomic — all or nothing
- [ ] Pre-restore backup of the existing database is taken
- [ ] Delete-all genuinely removes the file and recreates it empty

### Dependencies
- [ ] `npm audit` clean of high/critical
- [ ] Lockfile committed
- [ ] No dependency without a documented reason

---

## 6. Input validation rules

| Input | Rule |
|---|---|
| Amount | Integer minor units, `> 0`, `≤ 100_000_000_000` minor units (= BDT 1,000,000,000; configurable). Reject `NaN`, `Infinity`, `-0`. |
| Date | Between 1900-01-01 and today + 100 years. Future-dated transactions allowed but flagged in the UI. |
| Text (name, label) | 1–120 chars, trimmed, control characters stripped, Unicode normalised NFC |
| Notes | ≤ 2,000 chars |
| PIN | 4–6 digits; reject `0000`, `1234`, `123456`, and all-same-digit with a gentle suggestion (not a hard block) |
| Passphrase | ≥ 10 chars, strength meter shown, no maximum |
| Currency code | Must exist in the `currencies` table |
| Percentage / rate | Basis points, integer, 0–10000 |
| File | MIME allowlist + ≤ 10 MB + magic bytes |
| CSV cell (export) | If it starts with `= + - @ \t \r`, prefix with `'` |

---

## 7. Logging policy [DECIDED]

**Never logged, in any build, in any form:**
PINs · passphrases · derived keys · salts · nonces · any token · transaction amounts ·
account balances · counterparty names · giving recipients · any `note` field · attachment
contents or filenames · full database rows.

**Allowed in development logs:** entity type and ID, operation name, row counts, durations,
error codes, migration versions.

`src/lib/logger.ts` implements redaction by key name against a deny-list
(`pin, passphrase, password, token, key, salt, secret, amount, balance, note, notes,
recipient, counterparty, name, label`) applied recursively to any object before output, and
truncates strings to 100 characters. In release builds the logger is a no-op for anything
below `error` level, and `error` output is redacted through the same path.

A unit test feeds the logger an object containing every deny-listed key and asserts none of
the values appear in the output. **This test is required before Phase 2 sign-off.**
