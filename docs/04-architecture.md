# 04 — Local-First Architecture

## 1. The one-sentence architecture

Friday Amanah is a React Native app whose entire state lives in a local SQLite database on
the device; the UI reads from typed repositories, all money logic lives in a pure
TypeScript domain layer with no React and no database in it, and there is **no server**.

---

## 2. Recommended technology stack, with reasoning

The founder proposed a stack. Here is my evaluation of each part, as requested, with
versions verified against the npm registry on 4 August 2026.

| Layer | Choice | Verdict | Reasoning |
|---|---|---|---|
| Framework | **React Native via Expo SDK 57** (`expo@57.0.10`) | **Keep** | Expo removes almost all native build pain, which is the single biggest source of "it broke and I don't know why" for a beginner. It gives one codebase for Android and iOS, and an iOS build path that does not require owning a Mac (EAS Build). |
| Language | **TypeScript, strict mode** | **Keep** | In a money app, a `number \| undefined` slipping into a total is a real bug that ships. Strict mode catches a whole class of them at compile time. |
| Routing | **Expo Router v57** | **Keep** | File-based routing means the folder structure *is* the sitemap in doc 03. Easy to reason about; typed routes are supported. |
| Local database | **expo-sqlite 57** | **Keep** | Bundled with Expo Go, mature, synchronous and async APIs, supports WAL and transactions. SQLite is the right store for relational financial data. |
| Data access | **Hand-written repositories + Zod, no ORM** | **Changed from "ORM optional"** | See ADR-003. An ORM adds a code-generation step and a second mental model. Plain parameterised SQL behind typed repository functions is fewer moving parts, and every error message is directly understandable. This matters more than developer ergonomics for a beginner-led project. |
| Migrations | **Numbered SQL files + `user_version` runner** (hand-rolled, ~80 lines) | **Added** | Non-negotiable for a financial app that must survive updates without data loss. |
| State | **Zustand 5** | **Keep** | Small, no boilerplate, no context nesting. Used only for UI/session state — server-ish data comes from the DB through repositories. |
| Forms | **React Hook Form 7 + Zod 4** | **Keep** | Zod schemas do double duty: form validation *and* runtime validation at the database boundary. One source of truth for what a valid transaction is. |
| Secrets | **expo-secure-store 57** | **Keep** | Android Keystore / iOS Keychain backed. Stores the PIN hash, the salt, and later any sync tokens. |
| Auth (device) | **expo-local-authentication 57** | **Added explicitly** | Biometrics. Works inside Expo Go. |
| Crypto | **`@noble/ciphers` + `@noble/hashes` (both 2.2.0)** | **Added** | For encrypted backups. Audited, pure JavaScript, so it works in Expo Go with no native build. Gives AES-256-GCM and scrypt/PBKDF2. `expo-crypto` provides secure random bytes. |
| i18n | **i18next 26 + react-i18next** | **Added** | Mature plural handling, namespaces, lazy loading. Bangla plural rules are simple, but date/number formatting is not. |
| Locale/device | **expo-localization** | **Added** | Detect device language and region for the first-run default. |
| Hijri dates | **`@umalqura/core`** | **Added** | Pure-JS Umm al-Qura conversion. Deliberately avoids `Intl` calendar support, which is unreliable on Hermes. [RECOMMENDED] — verify accuracy against a known table in Phase 5. |
| Charts | **react-native-gifted-charts + react-native-svg** | **Added** | SVG-based, so it runs in Expo Go with no Skia native build. [RECOMMENDED] — confirm peer compatibility with RN in SDK 57 at install time; fall back to hand-drawn `react-native-svg` charts if it lags. |
| Files / export | **expo-file-system, expo-sharing, expo-print** | **Added** | CSV writing, backup files, and HTML→PDF for reports without a native PDF library. |
| Testing | **Jest + jest-expo 57, @testing-library/react-native 14, Maestro for E2E** | **Added** | Maestro chosen over Detox: YAML flows, far simpler for a beginner, no native build config. |
| Backend | **Supabase — deferred entirely to Phase 9** | **Changed from "MVP optional"** | See ADR-002. Including any backend in the MVP roughly doubles the security surface and adds account recovery, RLS, and conflict resolution before the app has a single user. The MVP ships with no network code at all. |
| Analytics | **None** | **Decided** | See doc 07. |

### Stack changes I am recommending, and why

1. **No ORM.** Repositories + raw parameterised SQL. Reversible later; adding Drizzle to an
   existing schema is straightforward if the project outgrows this.
2. **Supabase moved out of the MVP entirely.** Not "optional in MVP" — absent. This removes
   auth, RLS, sync conflicts, and account recovery from the critical path.
3. **SQLCipher (whole-database encryption at rest) is deferred to Phase 7**, where we
   evaluate switching to `op-sqlite` with SQLCipher on a development build. Until then the
   database file is **not encrypted by this application**. It is protected by the OS app
   sandbox and by the device's own full-disk encryption, both of which are provided by the
   operating system rather than by us. There is **no field-level encryption** in the MVP
   either — an earlier draft implied otherwise, and that was wrong.
   **Read doc 06 §0 before writing any copy about security.** Claiming an encrypted database
   when there is not one would be dishonest, and it would change how a user treats their
   phone.

Everything else in the proposed stack is sound and is kept as-is.

---

## 3. Layer diagram

Dependencies point downward only. A lower layer never imports from a higher one. This is
enforced by an ESLint rule in Phase 1.

```
┌────────────────────────────────────────────────────────────────┐
│  app/          Expo Router screens. JSX, navigation, layout.   │
│                Contains NO calculation and NO SQL.             │
└──────────────────────────┬─────────────────────────────────────┘
                           │ calls hooks
┌──────────────────────────▼─────────────────────────────────────┐
│  src/features/*/hooks    React hooks. Orchestrate, cache,      │
│  src/store               hold UI state (Zustand).              │
└──────────────────────────┬─────────────────────────────────────┘
                           │ calls services
┌──────────────────────────▼─────────────────────────────────────┐
│  src/services            Use-cases. "Create a transfer",       │
│                          "Run a Zakat calculation". Transaction │
│                          boundaries live here.                  │
└─────────────┬────────────────────────────┬─────────────────────┘
              │ calls domain               │ calls repositories
┌─────────────▼──────────────┐  ┌──────────▼─────────────────────┐
│  src/domain                │  │  src/db/repositories           │
│  PURE TypeScript.          │  │  Typed functions wrapping       │
│  Money, balances, budgets, │  │  parameterised SQL. Zod-validate│
│  Zakat, schedules.         │  │  on the way in and out.         │
│  No React. No SQLite.      │  └──────────┬─────────────────────┘
│  100% unit tested.         │             │
└────────────────────────────┘  ┌──────────▼─────────────────────┐
                                │  src/db  expo-sqlite, schema,  │
                                │  migrations, transactions      │
                                └────────────────────────────────┘
```

**Why the domain layer must be pure.** Zakat and balance logic that has no React and no
database in it can be tested in milliseconds, thousands of times, with no emulator. That is
the only practical way to be confident the money is right. It is also the layer a scholar's
feedback will change most often, so it must be changeable without touching the UI.

---

## 4. Money handling [DECIDED — this is the most important rule in the codebase]

**Never use JavaScript floating-point numbers for money.** `0.1 + 0.2 === 0.30000000000000004`.
Across thousands of transactions this produces balances that are visibly wrong.

Rules:

1. Money is stored and computed as an **integer number of minor units** — paisa for BDT,
   cents for USD. `BDT 1,250.75` is stored as the integer `125075`.
2. Minor-unit scale comes from a currency table (BDT=2, KWD=3, JPY=0). Never hardcode 100.
3. There is one `Money` type: `{ amountMinor: number; currency: string }`. Arithmetic goes
   through `src/domain/money.ts`. Adding two `Money` values of different currencies throws.
4. Conversion to a display string happens only at the very edge, in a formatter that also
   handles Bengali numerals.
5. SQLite columns are `INTEGER NOT NULL`. There is **no REAL/FLOAT column anywhere in the
   schema for money.** A CI check greps the schema for `REAL` and fails the build.
6. Percentages, rates, and metal weights use their own integer scales: Zakat rate is stored
   in basis points (2.5% = `250`), gold weight in **milligrams** (`INTEGER`).
7. Rounding happens once, at the end of a calculation chain, using half-up (round half away
   from zero), and the rounding step is recorded in Zakat breakdowns.

`Number.MAX_SAFE_INTEGER` is 9,007,199,254,740,991 — about 90 trillion BDT in paisa. That is
sufficient, and a guard rejects any single amount above a configurable sane maximum.

---

## 5. Balance calculation strategy [DECIDED]

Account balance is **derived, never stored as a mutable running total.**

```
balance(account) = opening_balance
                 + Σ(transactions where to_account_id = account AND deleted_at IS NULL)
                 − Σ(transactions where from_account_id = account AND deleted_at IS NULL)
```

- Income has `to_account_id` set and `from_account_id` NULL.
- Expense has `from_account_id` set and `to_account_id` NULL.
- Transfer has **both** set — which is exactly why a transfer must be excluded from income
  and expense totals: it is one row touching two accounts.

A stored `cached_balance_minor` column exists purely as a performance optimisation, is
recomputed on write inside the same SQL transaction, and a nightly/startup integrity check
recomputes from scratch and reports any mismatch. **The derived value always wins.**

---

## 6. Offline and future sync

### MVP: there is no sync
The device database is the only copy. Backup is a manual, user-initiated, encrypted file.
No network permission is requested beyond what Expo requires for development.

### [LATER] Phase 9 sync design — recorded now so the schema is ready
- Every syncable row carries: `local_id` (UUID v4, generated on device, primary key),
  `cloud_id` (nullable), `updated_at` (ms), `deleted_at` (nullable, soft delete),
  `sync_version` (integer), `device_id`.
- **Local IDs are never reused or reassigned by the server.** Separating local and cloud
  identifiers is what makes offline creation safe.
- Conflict policy: last-write-wins per *field*, not per row, with the losing version
  retained in a `sync_conflicts` table and surfaced to the user. **Never silently discard.**
- A tombstone table records deletions so they propagate.
- Sync is opt-in, off by default, and can be turned off without losing local data.
- **Before any sync code is written, a written threat model and data-flow diagram must be
  added to doc 06.** This is a hard gate.

### Sync conflict UI [LATER]
Designed, not built: a list of conflicting records, both versions shown side by side with
timestamps and device names, and an explicit user choice per conflict.

---

## 7. App lifecycle and locking

```
cold start
   └─▶ load settings from SQLite (fast, synchronous read)
        └─▶ onboarding complete?  no ──▶ Onboarding
                                  yes ─▶ lock enabled? yes ──▶ Lock screen
                                                         no ──▶ Home
background / app switcher
   └─▶ blur or mask the screenshot immediately
        └─▶ record timestamp
foreground
   └─▶ (now − timestamp) > autoLockSeconds ?  yes ──▶ Lock screen
```

Auto-lock default [RECOMMENDED]: 2 minutes. Options: immediately, 1, 2, 5, 15 minutes, never.

---

## 8. Error handling

- A global React error boundary catches render crashes and shows a calm recovery screen
  with a "copy diagnostic info" button. The diagnostic payload is **redacted** — it contains
  the app version, OS, screen name, and error type only. Never data.
- All service functions return a typed `Result<T, AppError>` rather than throwing across
  layers. `AppError` has a stable `code` used to look up a localised message.
- Database errors never reach the UI as raw text. `SQLITE_CONSTRAINT` becomes
  "This account name is already in use."
- In release builds, `console.log` is stripped by a Babel plugin. Logging goes through
  `src/lib/logger.ts`, which redacts by key name (see doc 06 §7).

---

## 9. Performance targets [RECOMMENDED]

| Metric | Target | How |
|---|---|---|
| Cold start to interactive | < 2.0 s on a mid-range Android | Lazy-load non-Home routes; no heavy work before first paint |
| Transaction list scroll | 60 fps with 10,000 rows | `FlashList` or `FlatList` with fixed item height, paginated queries (100/page) |
| Add-transaction save | < 100 ms | Single INSERT in one transaction; no full recompute |
| Dashboard aggregate | < 150 ms | Indexed SUM queries by date range, not JS reduction over all rows |
| APK size | < 40 MB | No unused native modules; no bundled fonts beyond two weights per family |

Indexes are defined in doc 05 and must exist before Phase 2 is signed off.

---

## Phase 5 planning and recovery boundary

Planning repositories are local-first projections over transaction and debt ledgers. They do not store mutable actual balances. Budget and goal writes use Expo SQLite exclusive transaction callbacks and bound parameters.

Backup manifest v2 adds planning tables, account archival, and stable transaction civil dates to the portable identity. Restore still accepts authenticated manifest v1 backups for schemas 4–7: it verifies original checksums, derives only deterministic Phase 5 defaults, migrates an isolated staging database to schema 8, and verifies the complete destination identity before activation.

Zakat remains fail closed. The Islamic surface reports missing readiness inputs and produces no estimate, percentage, or inferred religious ruling.
