# 12 — Testing Strategy

## 1. Why the testing bar is high here

If a note-taking app has a bug, a note looks wrong. If this app has a bug, someone pays the
wrong Zakat, or believes they have money they do not have, or thinks a debt is settled when
it is not. The consequences are financial and, for Zakat, religious. That justifies more
testing than a typical MVP.

**The rule that makes this affordable:** the money logic lives in a pure `domain` layer with
no React, no database, and no device (doc 04 §3). Thousands of those tests run in a few
seconds on a laptop. The expensive tests — device, UI, end-to-end — are reserved for the few
flows where they genuinely earn their cost.

---

## 2. The pyramid

> **Revision 2 · 5 August 2026.** The revision-1 figure of ~615 tests was an estimate
> presented with more confidence than it deserved, and a round number is a bad target — it
> invites writing tests to hit a count. Targets below are now **per-area and justified**, and
> the real gate is the named case list in §4, not any total.

```
        ▲   E2E (Maestro, real device)        12 flows       slow
       ███  Component (@testing-library/rn)   ~45 tests
      █████ Integration / service + DB        ~85 tests
    █████████ Unit — domain layer            ~185 tests      fast
```

**Revised working target: roughly 325 tests at 1.0**, versus ~615 in revision 1. The
reduction comes from the route consolidation in doc 03 (one parameterised report screen
instead of eleven, sheets instead of screens) and from removing padding at the component
layer. **No reduction was taken from the financial or security suites** — those grew
slightly.

| Level | Tool | Runs | Covers |
|---|---|---|---|
| Unit | Jest | Every save, every commit | Money, balances, budgets, goals, debts, **Zakat**, dates, recurrence, formatting, validation |
| Integration | Jest + in-memory SQLite | Every commit | Repositories, services, transaction atomicity, migrations, backup/restore |
| Component | @testing-library/react-native | Every commit | Rendering, states, accessibility labels, privacy mode |
| E2E | Maestro | Before each phase sign-off and each release | The critical user journeys |

---

## 3. Coverage targets [DECIDED]

### 3.1 Strict areas — non-negotiable

These are the places where a bug costs a user money, or costs them religiously. Coverage is
enforced and the build fails below the threshold.

| Area | Line | Branch | Why this level |
|---|---|---|---|
| `src/domain/money/**` | 100% | **100%** | Every total in the app passes through it |
| `src/domain/balance/**` | 100% | **100%** | Transfers are the classic double-count bug |
| `src/domain/zakat/**` | 100% | **100%** — see §3.3 | Religious and financial consequence |
| `src/domain/debt/**` | 100% | 95% | Partial payments accumulate error |
| `src/services/backup.service.ts` | 100% | 95% | Only migration path to a new phone |
| `src/services/restore.service.ts` | 100% | 95% | Can destroy everything if wrong |
| `src/services/security.service.ts` | 100% | 95% | PIN, lock, backoff |
| `src/db/migrations/**` | 100% | — | Every migration has a data-survival test |
| Delete-all path | 100% | 100% | Irreversible |

### 3.2 Reasonable areas

| Area | Target | Enforced |
|---|---|---|
| `src/domain/**` (budget, goals, period, hijri) | 95% branches | CI fails below |
| `src/db/repositories/**` | 90% lines | CI fails below |
| `src/services/**` (others) | 85% lines | CI fails below |
| `src/components/**` | 60% lines | **Warning only** — lowered from 70%. Snapshot-style component tests are low value and tend to be written to satisfy a number |
| `app/**` | Not measured | Covered by E2E |

### 3.3 Is 100% branch coverage on the Zakat engine actually meaningful?

You asked directly, so here is the honest answer rather than a reassuring one.

**Yes — but only because of how this specific code is built, and only with one condition.**

**Why it is achievable here.** `src/domain/zakat/**` is a pure function: no `async`, no I/O,
no database, no clock, no platform calls, no React. Every branch is a deterministic decision
on plain input — *is the basis gold, silver, or manual · does net meet Nisab · is purity
specified · is the price missing.* Every one of those is reachable by constructing an input
object. There is no unreachable error handler for a network failure or a filesystem error,
because there is no network or filesystem. That is precisely why doc 04 put this layer
outside React and outside SQLite in the first place.

**Why it is meaningful here.** In most codebases 100% branch coverage is a vanity number,
because the hard part is *which* inputs you chose. In the Zakat engine the branches
correspond one-to-one with the religious and arithmetic decisions the methodology makes.
A branch nobody has exercised is a Zakat rule nobody has checked. There is a genuine mapping
between the metric and the risk.

**The condition — and it is the whole point.** Coverage must never be achieved by writing
tests *for* the coverage tool. Two specific failure modes to refuse:

1. **Defensive branches that cannot be reached.** If the engine contains
   `if (!input.assets) throw` while the Zod schema upstream already guarantees `assets`
   exists, that branch is dead. The fix is to **delete the dead branch**, not to write a test
   that constructs an impossible input to hit it. Validation belongs at the boundary; the
   engine may then assume valid input.
2. **Tests written to hit a line rather than to assert a behaviour.** A test whose only
   assertion is `expect(result).toBeDefined()` raises coverage and proves nothing. Every
   Zakat test must assert a specific expected number, computed by hand and written into the
   test as a literal.

**Therefore the real gate is the named case list in §4, not the percentage.** The rule:

> The mandatory Zakat case list must be complete and passing. Coverage is then measured. If
> coverage is below 100%, the uncovered branch is examined and one of two things happens: a
> **missing case is added to the mandatory list** (coverage was telling us something real),
> or the **branch is deleted as unreachable** (coverage was telling us the code was wrong).
> A test is never written purely to raise the number.

Excluded from measurement: `types.ts` and `config.ts` in the Zakat folder. They are type
declarations and data with no branches; including them only distorts the figure.

**Where 100% would be dishonest, and so is not required:** the repository and service layers,
which do have genuinely unreachable branches — SQLite errors that cannot be provoked
deterministically, platform APIs that behave differently on device. Those sit at 85–95% and
are covered by integration and E2E tests instead.

---

## 4. Mandatory financial test cases

**Every one of these must exist and pass before its phase is signed off.** This list is
copied directly from the brief's requirements and expanded.

### Money (Phase 1)
- Zero: `0 + 0`, formatting zero, zero budget, zero-amount transaction is **rejected**
- Large: `MAX_SAFE_INTEGER` boundary; the sane-maximum guard rejects beyond it
- Decimals: `0.1 + 0.2` must be exactly `0.30` — the test that proves ADR-004 works
- Minor units: BDT (2), KWD (3), JPY (0) all format and parse correctly
- Negative input rejected at parse, at Zod validation, and at the database CHECK
- `-0`, `NaN`, `Infinity`, `"1e5"`, `"1,000"`, `"১০০০"` (Bengali numerals) all handled
- Rounding: half-up at exactly `.5`, both signs
- Allocation: splitting `100` three ways gives `34 + 33 + 33`, never `33+33+33` losing 1
- Adding two different currencies **throws**

### Balances (Phase 2)
- Empty account equals its opening balance
- Opening balance negative
- Income only · expense only · mixed
- **Transfer counted once, in neither income nor expense totals** — the highest-risk case
- Transfer between two accounts leaves total net worth unchanged
- Soft-deleted transaction excluded from every total
- Split transaction: splits sum to parent; parent counted once, not twice
- 10,000 transactions: result matches an independent sum, and completes within budget
- Same-second transactions ordered deterministically
- Transaction dated in the future included in the correct period
- Account archived: its history remains, its balance is still correct

### Budgets (Phase 3)
- Exactly at 100%, at 99.99%, at 100.01%
- Budget of zero
- Category budget exceeding the overall budget
- Rollover across three months, positive and negative
- Financial month start = 1, 15, 28 — period boundaries correct in each case
- February, leap year, and month-end day 31 → 30 → 28 handling
- Category deleted mid-period
- Spend in a currency other than the budget's is excluded, not silently converted

### Goals (Phase 3)
- Contribution, withdrawal, mixed
- Progress at 0%, 50%, 100%, and above 100% (over-saving is allowed and must not break)
- Target date in the past
- Required-contribution maths with 1 month, 0 months, and 500 months remaining

### Debts (Phase 4)
- Single full payment settles it
- Many partial payments; remaining reaches exactly zero
- Overpayment handled explicitly (rejected or recorded as such — decide and test)
- Payment with an additional charge — principal and charge tracked separately
- Payment linked to an account creates exactly one transaction
- Payment deleted → remaining balance restores correctly
- Installment schedule with a remainder on the final instalment

### Zakat (Phase 5) — **the most important suite in the project**
- No method selected → returns `NoMethodSelected`, produces **no figure**
- Missing metal price for the chosen basis → `MissingPrice`, no figure
- Net exactly equal to Nisab → **meets Nisab** (boundary — decide, document, test)
- Net one paisa below Nisab → does not meet → due is exactly `0`
- Net one paisa above Nisab → meets
- Zero assets · zero deductions · deductions exceeding assets → net floors at 0, never negative
- Gold at 24k, 22k, 21k, 18k, and a custom purity
- Weight entered in grams and in bhori produce the same value
- Very large asset totals
- All three bases: gold, silver, manual — each produces the documented Nisab
- Rounding of the final figure at an exact half
- `breakdown_json` contains a step for **every** arithmetic operation
- A saved snapshot is unchanged after the engine version changes
- Hijri ↔ Gregorian conversion for 20 published dates
- The same input produces byte-identical output on repeated runs (determinism)

### Backup and restore (Phase 7)
- Round trip: backup → restore → every table row-for-row identical (checksum)
- Wrong passphrase → clear failure, existing data untouched
- Truncated file · single flipped byte · zip bomb · wrong format version → all rejected
- Restore into a database that already has data → atomic replace, with a pre-backup taken
- Restore from an older schema version → migrations run, data survives
- 50,000 transactions: backup and restore complete within a stated time budget

### Migrations (every phase that adds one)
- Build schema at version N−1, seed realistic data, migrate, assert every row survives
- Failed migration rolls back completely, leaving version N−1 intact
- Running migrations twice is a no-op

### Security (Phase 7)
- Logger given an object containing every deny-listed key → none of the values appear
- Repository functions reject a query without a `profile_id`
- SQL injection strings (`'; DROP TABLE transactions;--`, `" OR 1=1--`) in every text field →
  stored as literal text, no effect on the database
- CSV cells beginning with `= + - @ TAB CR` are neutralised
- Attachment with a mismatched extension and magic bytes is rejected
- Path traversal in a filename (`../../etc/passwd`) is neutralised

### Localisation (every phase)
- Every key in `en` exists in `bn` and vice versa — automated, fails the build
- No key is missing at runtime (i18next `missingKeyHandler` throws in test)
- Bengali numerals render for `০১২৩৪৫৬৭৮৯` when the setting is on
- Dates format correctly in both languages
- Currency symbol placement correct in both
- Snapshot test at 200% font scale shows no clipping on the ten main screens

---

## 5. End-to-end flows (Maestro) — 12 flows

Reduced from 15. Three flows were merged into others rather than dropped: editing is
verified inside the add-expense flow, undo inside the delete flow, and Sadaqah inside the
Zakat flow. Every critical path is still covered.

1. Onboarding start to finish, both languages
2. Add an expense, then edit it
3. Add income
4. **Transfer between accounts, and confirm it appears in neither income nor expense totals**
5. Delete a transaction and undo
6. Create a budget and see progress update
7. Create a goal and contribute
8. Record a debt and a partial repayment
9. Complete a Zakat estimate including the blocking method choice, then record a Sadaqah
10. Export a CSV report
11. Backup and restore
12. Set a PIN, lock, unlock, then delete all data

Flows 4, 8, 9, 11, and 12 are the ones that must never be skipped for time.

---

## 6. Test data

A seeder generates a realistic Bangladeshi dataset: 3 accounts (Cash, Bank, bKash), 24
months of history, a salary on day 5, groceries 3× per week, monthly family support,
irregular income, 2 debts, 3 goals, Ramadan giving, and one Zakat snapshot. About 1,800
transactions.

The seed is **deterministic** (fixed random seed) so a bug found in the seeded data can be
reproduced exactly. A larger 10,000-row variant exists for performance work.

---

## 7. Custom CI checks

Three Node scripts in `scripts/`, run in CI and in the pre-commit hook:

1. **`check-no-float.ts`** — scans every migration SQL file for `REAL`, `FLOAT`, `DOUBLE`,
   `NUMERIC`, or `DECIMAL`. Fails the build on a match. Enforces ADR-004.
2. **`check-hardcoded-strings.ts`** — scans JSX for bare string literals outside of `t()`.
   Fails on a match, with an allowlist for symbols and test files. Enforces ADR-007.
3. **`check-tone.ts`** — scans `src/i18n/**/*.json` for the banned phrases in doc 02
   (*failed, overspent, you should have, wasteful, missed, streak*, and their Bangla
   equivalents). Fails on a match. Enforces the product's tone commitment.

Encoding these as automated checks is what makes the principles survive a deadline.

---

## 8. Reporting rules [DECIDED]

Every phase handoff records, verbatim:

```
Command:   npm test
Result:    PASS
Suites:    34 passed, 34 total
Tests:     412 passed, 3 skipped, 415 total
Skipped:   zakat.hijri.test.ts (3) — awaiting published date table, see doc 14 S-13
Warnings:  1 — react-native-gifted-charts peer range on RN 0.8x
Duration:  18.4 s
```

- **Never** state that tests pass without having run them.
- **Never** state that a feature works without having exercised it on a device.
- Skipped tests are listed by name with the reason.
- Warnings are reported even when tests pass.
- If something is partially working, say exactly which part is not.

An honest "Phase 3 is 80% done; rollover across year boundaries is untested" is far more
useful than a confident "Phase 3 complete" that turns out to be wrong three phases later.
