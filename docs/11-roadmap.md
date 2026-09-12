# 11 — Development Roadmap

## The working method (applies to every phase)

For each phase, in this order:

1. State the goal in one sentence.
2. Inspect the existing project — read `package.json`, look at what is already there.
3. List every file that will be created or changed, before writing any of it.
4. Implement.
5. Run `npm run lint` → report the actual output.
6. Run `npm run typecheck` → report the actual output.
7. Run `npm test` → report the number of tests, passes, failures, skips, warnings.
8. Run the app on a real device and exercise the new flows by hand.
9. Report **verified** results. Never claim a test passed without running it.
10. Write a handoff summary to `docs/handoffs/phase-N.md`.
11. State plainly what is unfinished or degraded.

**Do not start phase N+1 until phase N's exit criteria are all met.**

When something breaks: diagnose the existing project first. Read the error. Check the file
it names. Never rebuild from scratch as a first response — that destroys working code and
usually reproduces the same bug.

---

## Revision 2 · 5 August 2026 — scope reduction applied

Doc 03 cut the MVP from 84 routes to 42 and doc 12 revised the test target from ~615 to
≈ 325. The phase structure is unchanged; the phases are simply smaller.

| Phase | Rev 1 estimate | Rev 2 estimate | Where the saving comes from |
|---|---|---|---|
| 1 Foundation | 2–3 weeks | **2–3 weeks** | unchanged — foundation work is fixed |
| 2 Accounts & transactions | 4–6 weeks | **4–5 weeks** | merged add/edit screens, search inline |
| 3 Budgets & goals | 3–4 weeks | **2–3 weeks** | category detail and goal forms became sheets |
| 4 Debts & giving | 3–4 weeks | **2–3 weeks** | merged forms, giving summary inline |
| 5 Zakat Center | 4–5 weeks | **4–5 weeks** | **unchanged, deliberately** |
| 6 Reports & export | 3–4 weeks | **2 weeks** | 11 screens → 1 parameterised screen |
| 7 Security & backup | 3–4 weeks | **3–4 weeks** | unchanged — no safeguard was cut |
| 8 Production readiness | 3–5 weeks | **3–4 weeks** | fewer screens to audit and test |
| **Total** | **7–11 months** | **5–8 months** | |

Phases 5 and 7 were deliberately left alone. They are the two phases where a mistake costs
the user money or misleads them religiously, and they are the wrong place to save time.

---

## Time estimates

[ASSUMPTION] These assume a beginner founder working with AI assistance, roughly 15–20 hours
per week, learning as they go. They are ranges, not promises. The realistic total after the
revision-2 scope reduction is **5–8 months to a polished 1.0**. A first usable build the
founder can carry around and use personally arrives at the end of Phase 2 — about 6–8 weeks
in. That early moment matters more than the final date for keeping momentum.

---

## Phase 0 — Product and architecture ✅ COMPLETE (revision 2)
This documentation set. No code.

**Exit criteria:** all 19 documents exist, are internally consistent, and the founder has
read 01, 08, 11, 15, and 17. ✅

**Revision 2 additions:** approved brand integrated (doc 17), security vocabulary enforced
(doc 06 §0), scope reduced to 42 routes (doc 03), test targets justified (doc 12).

---

## Phase 1 — Project foundation · 2–3 weeks
**Goal:** an Expo app that launches on a real Android phone, with theme, navigation,
localisation, a database, and a component library — and no features yet.

Build: dev environment · Expo TS project · Expo Router shell with five tabs · theme tokens
and provider (light/dark) · i18n with en/bn scaffolding · 15 core UI components · SQLite
client, migration runner, migration 001 · seed data · Zod schemas · `Money` domain module ·
redacting logger · `Result` type · ESLint, Prettier, TypeScript strict · Jest configured ·
the three custom CI scripts.

**Exit criteria**
- [ ] App launches on a physical Android device
- [ ] All five tabs navigate
- [ ] Theme switches light ↔ dark, follows the system setting
- [ ] Language switches en ↔ bn and persists across restart
- [ ] Database creates on first launch, migration 001 applies, `user_version` = 1
- [ ] Seed data present (23 categories, currency table)
- [ ] `npm run lint` clean · `npm run typecheck` clean
- [ ] `npm test` green, including the full Money test suite
- [ ] The logger redaction test passes
- [ ] Component gallery screen renders every component in both themes and both languages

Full detail in **[doc 15](15-phase-1-plan.md)**.

---

## Phase 2 — Accounts and transactions · 4–6 weeks
**The heart of the app.** Everything else is built on these numbers being right.

Build: account CRUD and archiving · category CRUD, reorder, archive · add/edit/delete
income · same for expense · transfers · duplicate · soft delete with undo · split
transactions · transaction list with day grouping and pagination · search · filters · tags ·
notes · balance domain module and derived balances · the real dashboard.

**Exit criteria**
- [ ] 500 seeded transactions produce balances that match a hand calculation exactly
- [ ] Transfers appear in **neither** income nor expense totals — dedicated test suite
- [ ] Split totals always equal the parent amount; remainder rule tested
- [ ] Deleted transactions are excluded from every total
- [ ] Account archive is blocked or warned when transactions exist
- [ ] List scrolls at 60 fps with 10,000 rows
- [ ] Every screen has empty, loading, and error states
- [ ] Privacy mode masks every amount on every screen
- [ ] Security checklist (doc 06 §5) run and recorded
- [ ] **The founder uses the app for their own money for one full week**

That last item is not optional. It will surface more real problems than any test suite.

---

## Phase 3 — Budgets and goals · 3–4 weeks
Build: monthly budget creation with last-month hints · category budgets · weekly limits ·
rollover · progress indicators · remaining-per-day · previous-month comparison · templates ·
respectful alerts · savings goals with presets · contributions and withdrawals · milestones ·
required-contribution maths.

**Exit criteria**
- [ ] Budget spend matches a manual sum for every category
- [ ] Financial month start day of 15 produces correct period boundaries (test it with 1, 15, and 28)
- [ ] Rollover arithmetic verified across three consecutive months
- [ ] Goal progress correct including withdrawals
- [ ] Every alert string passes the tone lint
- [ ] Deleting a category with a budget is handled gracefully

---

## Phase 4 — Debts and giving · 3–4 weeks
Build: debt CRUD both directions · payment history · partial payments · installment
schedules · Qard Hasan label · reminders · neutral additional-charge field · giving records ·
anonymous giving · recipient privacy · giving targets · monthly and yearly summaries.

**Exit criteria**
- [ ] Remaining balance correct across many partial payments
- [ ] A debt payment linked to an account creates exactly one transaction, counted once
- [ ] Anonymous giving stores no recipient — verified by inspecting the database directly
- [ ] Nothing in the debt module comments on interest in any language
- [ ] Reminder copy passes the tone lint

---

## Phase 5 — Zakat Center · 4–5 weeks
**Highest-care phase.** Build to doc 08 exactly.

Build: blocking method chooser · asset entry including weight-and-purity for metals ·
deduction entry · manual price entry with date and source · the pure engine · full
breakdown UI · immutable snapshots · payment recording with partials · Hijri conversion ·
Hawl tracking · methodology and disclaimer screens · Zakat export.

**Exit criteria**
- [ ] No figure renders while `nisab_basis` is NULL
- [ ] Every step of a worked example matches a hand calculation
- [ ] 30+ engine unit tests pass, including all boundary cases from doc 12 §4
- [ ] Hijri conversion verified against a published table for 20 dates
- [ ] Snapshots cannot be edited — verified by attempting it
- [ ] The disclaimer appears on every screen showing a figure, and in the export
- [ ] `docs/14` reviewed and every item confirmed still accurate
- [ ] **A second person reproduces the estimate on paper and gets the same number**

---

## Phase 6 — Reports and export · 3–4 weeks
Build: 11 report screens · charts with table alternatives · date-range filters · bilingual
labels · CSV export with injection sanitising · PDF-ready HTML via `expo-print` · privacy
mode in reports · share sheet integration.

**Exit criteria**
- [ ] Every report's totals reconcile with the transaction list
- [ ] CSV opens correctly in Excel and Google Sheets with Bangla text intact (UTF-8 BOM)
- [ ] A cell beginning with `=` is neutralised — verified by opening the file in Excel
- [ ] Every chart has a working table alternative and a screen-reader summary
- [ ] PDF output is readable in both languages
- [ ] Privacy mode masks report amounts and chart axis values

---

## Phase 7 — Security and backup · 3–4 weeks
Build: PIN set/change/remove with scrypt · biometric unlock · auto-lock and app-switcher
masking · failed-attempt backoff · encrypted backup · verified atomic restore · secure
delete-all · privacy mode polish · SQLCipher evaluation (ADR-006) · full security audit.

**Exit criteria**
- [ ] PIN verified stored only as a hash — inspect SecureStore contents
- [ ] Backoff survives an app kill
- [ ] Backup → factory-reset a test device → restore reproduces the database exactly (checksum compared)
- [ ] A tampered backup file is rejected before any parsing
- [ ] A wrong passphrase fails cleanly with a clear message
- [ ] Delete-all leaves no readable data — verified by inspecting the file
- [ ] Full security checklist (doc 06 §5) passed and recorded
- [ ] ADR-006 decision recorded: SQLCipher adopted, or deferred with a stated reason

---

## Phase 8 — Production readiness · 3–5 weeks
Build: full test suite green · accessibility pass with TalkBack · performance profiling ·
`npm audit` · every error and empty state exercised · offline verification · Android release
build via EAS · iOS build instructions · store listings in both languages · privacy policy
and terms · release checklist · beginner handoff guide.

**Exit criteria**
- [ ] All tests pass — output recorded in the handoff
- [ ] TalkBack completes all ten critical flows
- [ ] Cold start under 2.0 s on a mid-range device
- [ ] Zero high/critical vulnerabilities
- [ ] Airplane mode from first launch: everything works
- [ ] Packet capture on a release build shows zero outbound requests
- [ ] Signed AAB produced and installed from a file
- [ ] All ten success criteria in doc 01 §5 verified
- [ ] `docs/handoffs/` complete for every phase

---

## Post-MVP

| Phase | Content | Gate |
|---|---|---|
| **9** | Cloud sync + optional account (Supabase) | Threat model and data-flow diagram added to doc 06 **first** |
| **10** | Households, shared budgets, roles, Ramadan/Hajj modes | Sync stable for 3 months |
| **11** | "Amanah Guide" AI assistant | Consent model from doc 07 §8 implemented **first** |
| **12** | Receipt scanning, voice entry, live metal prices, web dashboard | — |

---

## Anti-patterns to refuse

If any of these is suggested during Phases 1–8 — by anyone, including an AI assistant — the
answer is no:

- "Let's add cloud sync while we're here" → Phase 9. It is not a small addition.
- "Just store the balance to make it faster" → ADR-005. Derived always wins.
- "Use a float, it's only cosmetic" → ADR-004. It is never only cosmetic.
- "Ship the Zakat estimate without the disclaimer" → doc 08 S7. Non-negotiable.
- "We'll add Bangla after launch" → ADR-007. Retrofitting costs 5× more.
- "Rewrite it, it'll be faster than debugging" → diagnose first. Almost always false.
- "Add analytics to see what users do" → ADR-009.
- "Skip the tests this once, the phase is late" → the tests are the reason the numbers can
  be trusted. Move the date instead.
