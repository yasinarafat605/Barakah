# 16 — Architecture Decision Records

Each record states the decision, the reasoning, what was rejected, and what would make us
change our mind. When a decision is reversed, do not delete the record — add a new one that
supersedes it. The history is the point.

---

## ADR-001 — React Native + Expo, TypeScript strict
**Status:** Accepted · 4 Aug 2026

**Decision.** Build with Expo SDK 57 (`expo@57.0.10`), React Native, TypeScript in strict
mode, and Expo Router for navigation.

**Reasoning.** One codebase covers Android and iOS. Expo removes native toolchain work that
would otherwise consume weeks of a beginner's time on errors that are hard to diagnose.
EAS Build produces iOS binaries without owning a Mac. Expo Go gives a fast development loop
with no compilation. The founder's existing Friday products are TypeScript/React, so the
mental model carries over.

**Rejected.** Flutter (a whole new language, and the founder's existing skills do not
transfer). Native Android + native iOS (two codebases, impossible solo for a beginner).
Bare React Native without Expo (the native build chain is the main failure point).
A PWA (no biometrics, weak secure storage, poor offline story on iOS).

**Risk.** SDK 57 is recent; some community libraries may lag. Mitigation: prefer
Expo-maintained modules; verify each third-party library's peer range at install time.

**We would revisit if:** a required capability turns out to be unavailable in Expo's managed
workflow — in which case we move to a development build, not away from Expo.

---

## ADR-002 — No backend in the MVP; Supabase deferred to Phase 9
**Status:** Accepted · 4 Aug 2026 · **Changes the founder's original brief**

**Decision.** Ship the MVP with **no server, no account, and no network calls**. Supabase
is evaluated in Phase 9, after the local app is complete and stable.

**Reasoning.** The brief described Supabase as "optional" for the MVP. In practice, adding
any backend brings with it: authentication, password reset, email deliverability, session
management, row-level security policies, encryption key custody, sync conflict resolution,
server-side rate limiting, a privacy policy with a data processor, and a breach response
plan. That is not an add-on to a first release — it is comparable in size to everything
else combined, and it is the part where a mistake exposes real people's financial data.

Shipping local-only also makes the strongest version of the product's core promise: the
data cannot leak from a server, because there is no server.

**Rejected.** "Supabase now, lightly" — there is no light version of storing other people's
financial records.

**Consequence.** Backup/restore must be genuinely good, because it is the only way a user
moves to a new phone. This raises Phase 7's importance considerably.

**We would revisit if:** users tell us multi-device is blocking adoption — which is a good
problem to have, and by then the local schema will already carry sync columns.

---

## ADR-003 — Repositories with parameterised SQL, no ORM
**Status:** Accepted · 4 Aug 2026 · **Changes the founder's original brief**

**Decision.** Data access is hand-written repository functions using `expo-sqlite` with
parameterised queries, validated by Zod at the boundary. No Drizzle, no Prisma, no TypeORM.

**Reasoning.** An ORM adds a code-generation step, a config surface in Metro/Babel, its own
error vocabulary, and a second model of the schema that can drift from the real one. For a
beginner, an unfamiliar ORM error is a hard stop; a SQL error is searchable and concrete.
Zod at the repository boundary provides the runtime type safety an ORM's compile-time types
would have given, and it is needed anyway for forms and for validating restored backups.

Parameterised queries also give SQL-injection safety directly, without relying on an
abstraction to do it for us.

**Rejected.** Drizzle ORM — genuinely good, and the closest call here. If this project had
an experienced team, Drizzle would probably win.

**Cost accepted.** More boilerplate; schema types maintained by hand alongside the SQL.

**We would revisit if:** the repository layer exceeds roughly 2,000 lines or hand-written
types start disagreeing with the schema in practice.

---

## ADR-004 — Money as integer minor units
**Status:** Accepted · 4 Aug 2026 · **Non-negotiable**

**Decision.** All monetary values are integers in the currency's minor unit, in `INTEGER`
columns, wrapped in a `Money` type. No floating point anywhere in the money path. No
`REAL` column in the schema. A CI check enforces this.

**Reasoning.** IEEE-754 doubles cannot represent 0.1 exactly. Accumulated over thousands of
rows this produces balances that are visibly, indefensibly wrong. Integer minor units are
how every serious financial system does it.

**Rejected.** `decimal.js` / `big.js` — correct, but heavier, slower, serialise awkwardly to
SQLite, and are unnecessary when all values are naturally integral in minor units.

---

## ADR-005 — Derived balances, cache as an optimisation only
**Status:** Accepted · 4 Aug 2026

**Decision.** Account balances, goal progress, debt remainders, and budget spend are all
computed from their underlying rows. `cached_balance_minor` exists for speed, is recomputed
inside the same write transaction, and is verified by a startup integrity check.

**Reasoning.** Stored running totals drift. Every drift bug in a finance app traces back to
a total that was updated in one code path but not another. If the derived value is the
truth, the worst a caching bug can do is show a stale number that a recompute fixes — it
can never corrupt the ledger.

---

## ADR-006 — Deferred database encryption, honestly labelled
**Status:** Accepted · 4 Aug 2026 · **Read this one carefully**

**Decision.** Phases 1–6 use standard `expo-sqlite` with **no whole-database encryption**.
The database is protected by the OS application sandbox and by device full-disk encryption.
In Phase 7 we evaluate moving to `op-sqlite` with SQLCipher on an EAS development build.
Backup files **are** encrypted from Phase 7 with AES-256-GCM via `@noble/ciphers`, keyed by
a user passphrase through scrypt.

**Reasoning.** SQLCipher is not available in Expo Go, so requiring it in Phase 1 forces a
custom development build immediately — much slower iteration and a large early setback for
a beginner. Meanwhile, on a modern non-rooted Android or iOS device with a screen lock, the
app sandbox plus FDE is a meaningful protection: another app cannot read our database file.

**What we are honest about.** On a rooted or jailbroken device, or against someone with
physical access and an unlocked phone and forensic tools, an unencrypted SQLite file is
readable. This limitation is stated in the app's own privacy screen. **We do not describe
the MVP database as "encrypted" anywhere in the product, marketing, or store listing until
it actually is.** Overstating security is worse than not having it.

**We would revisit immediately if:** the app is aimed at users in an environment where
device seizure is a realistic threat. That would make SQLCipher a Phase 1 requirement.

---

## ADR-007 — i18next with keys only, no hardcoded strings
**Status:** Accepted · 4 Aug 2026

**Decision.** Every user-visible string comes from a translation key. Bangla and English
files are maintained side by side. A lint rule fails the build on a bare string literal in
JSX. Bangla is written by a native speaker as *product copy*, not machine-translated.

**Reasoning.** Retrofitting localisation is one of the most expensive mistakes in mobile
development; every screen has to be reopened. Doing it from the first screen costs almost
nothing. Notification text is stored as keys plus parameters so a language switch
retroactively fixes stored notifications.

**Consequence.** Layouts must tolerate roughly 30% text expansion. Bangla script also needs
more line height than Latin — the type scale in doc 09 accounts for this.

---

## ADR-008 — No default Zakat method; explicit user choice required
**Status:** Accepted · 4 Aug 2026 · **Founder decision**

**Decision.** The app ships with `zakat_nisab_basis = NULL`. No Zakat figure is displayed
until the user explicitly selects gold, silver, or manual. The chooser presents the options
neutrally, explains the practical difference, and expresses no preference.

**Reasoning.** A default is an implicit religious recommendation. Since silver Nisab
produces a lower threshold and therefore more liability, defaulting either way nudges a
user toward one scholarly position without their knowledge. Requiring a choice is slower
but is the only position consistent with "the app is not a Mufti".

**Cost accepted.** One extra screen before the first Zakat estimate, and some users will not
know which to pick. Mitigated with plain-language explanation and a "ask your local scholar"
prompt — not with a recommendation from us.

---

## ADR-009 — No analytics in the MVP
**Status:** Accepted · 4 Aug 2026

**Decision.** No analytics SDK, no crash reporter that transmits automatically, no
attribution SDK, no advertising ID access. Crash information is shown to the user with a
"copy diagnostics" button they may choose to send.

**Reasoning.** Any third-party SDK in a finance app is a data-flow we cannot fully audit,
and the privacy promise in doc 07 is absolute. Being able to say "this app makes zero
network requests" is verifiable by any user with a packet capture — and that is a stronger
trust signal than any privacy policy paragraph.

**Cost accepted.** We will be partly blind to crashes and to which features get used. For an
MVP with a small user base and direct user contact, that is an acceptable trade.

**We would revisit with:** a self-hosted, aggregate-only, opt-in mechanism — never
transaction-level, never on by default.

---

## ADR-010 — Maestro for end-to-end tests
**Status:** Accepted · 4 Aug 2026

**Decision.** Critical flows are covered by Maestro YAML flows. Detox is not used.

**Reasoning.** Maestro flows are readable text files that a beginner can write and debug.
Detox requires native build configuration and is notoriously brittle to set up — exactly the
kind of yak-shaving that stalls a solo project.

---

## ADR-011 — Soft delete with a 30-day purge
**Status:** Accepted · 4 Aug 2026

**Decision.** All user records use `deleted_at`. A maintenance pass permanently removes rows
soft-deleted more than 30 days ago. "Delete all data" bypasses this and destroys immediately.

**Reasoning.** Accidental deletion of a transaction is common and its effect on balances is
confusing. Soft delete makes undo possible and makes [LATER] sync deletions propagate
correctly. Every query filters `deleted_at IS NULL` — this is checked by a repository test
that runs against every repository function.

**Tension acknowledged.** Soft delete conflicts with "when I delete something it is gone."
Resolution: the retention window is stated plainly in the privacy screen, and the
delete-all path is genuinely immediate.

---

## ADR-012 — Recurring transactions remind, they do not auto-create
**Status:** Accepted · 4 Aug 2026

**Decision.** `recurring_rules.auto_create` defaults to 0. The app notifies that a recurring
item is due and the user confirms it in one tap.

**Reasoning.** An app that silently invents transactions makes the ledger stop matching
reality, and the user loses trust in every number. A confirmation tap is cheap; a wrong
balance is expensive. Users who want automation can enable it per rule with a clear warning.

---

## ADR-020 — Expo SDK 54 for Expo Go testing (TEMPORARY)
**Status:** Accepted · 5 Aug 2026 · **Temporary compatibility decision — expected to be reversed**
**Supersedes for now:** the SDK 57 choice in ADR-001

**Decision.** Phase 1A creates the app on **Expo SDK 54** (`expo-template-default@54.0.62`)
rather than SDK 57, so it can be opened in **Expo Go on a physical Android phone**. No
custom development build is created at this stage.

**Reasoning (founder-supplied).** Expo's current guidance during the SDK 57 transition is
that Expo Go users on physical devices should work on an SDK 54 project. Development moves
faster on a phone the founder already owns than behind an emulator or a custom build, and
Phase 1A's only goal is to prove the toolchain works end to end.

**What I verified myself, on 5 Aug 2026:**
- `expo-template-default@sdk-54` resolves to **54.0.62** and is published and installable.
- It pins `expo ~54.0.35`, `react-native 0.81.5`, `react 19.1.0`, `typescript ~5.9.2`,
  `expo-router ~6.0.24`.
- It is the **default** template — it already includes Expo Router and TypeScript, so no
  extra flags are needed to satisfy the Phase 1 stack.

**What I could not verify.** I could not reach the Expo documentation site to confirm the
Expo Go / SDK 54 guidance independently — the fetch timed out. I am proceeding on the
founder's instruction, which is safe because SDK 54 is a real, stable, published release.
**The one risk this creates is stated in the Phase 1A plan (doc 15A §1, check 5):** the
Expo Go build installed from the Play Store supports a specific set of SDKs, and if it does
not support 54 the project will not open. That is checked *before* the project is created,
not after.

**Cost accepted.** SDK 54 is roughly three SDK cycles behind. Some libraries in the Phase 1
dependency list may have newer peer ranges. Every one will be installed with
`npx expo install`, which resolves the version matching the installed SDK, so this is
manageable — but it means the versions I verified for SDK 57 in doc 04 will need
re-verifying against SDK 54 before Phase 1B.

**Reversal plan.** When a development build is introduced and tested — currently Phase 7,
possibly earlier — the project upgrades to the then-current SDK with
`npx expo install expo@latest && npx expo install --fix`. Doc 04's stack table is updated at
that point and this ADR is marked superseded. **The upgrade must not be attempted during
Phases 1A–6 without a specific reason and a working commit to return to.**

**Not done at this stage, deliberately:** no `expo prebuild`, no `android/` or `ios/`
directories, no native configuration, no application dependencies, no branding.

---

## ADR-014 — Product name: Friday Amanah
**Status:** Accepted · 5 Aug 2026 · Founder decision · **supersedes the name in ADR-001–013**

**Decision.** The product is **Friday Amanah**, tagline **"Manage Wealth with Purpose."**
"Friday Mizan" is void. The future AI assistant is **Amanah Guide**, still out of the MVP.

**Reasoning.** *Amanah* — a trust held on behalf of another, to be safeguarded and returned
intact — describes both what the app does with the user's data and what the user does with
their wealth. *Mizan* (balance/scale) described only the measuring, which is the smaller half
of the product. The name also supports the shield-and-keyhole mark in a way a scale never did.

**Scope of the rename.** Product-facing references only. The word *mizan* is preserved
wherever it appears as a religious or dictionary concept rather than as a product name.
The methodology version identifier changed `fm-zakat-1.0.0` → `fa-zakat-1.0.0`; no snapshots
exist yet, so no migration is required. Scholar-review item S-18 was rewritten to ask about
the Amanah name instead, and S-18b was added.

---

## ADR-015 — Supplied brand package is the visual source of truth
**Status:** Accepted · 5 Aug 2026 · **supersedes the logo and palette in the revision-1 doc 09**

**Decision.** The approved asset package at `Friday_Amanah_Brand_Assets/` governs all visual
identity. The **"Balanced F"** concept is void and must never be regenerated. The eight
approved colours are used unaltered; **`#0E9F6E` is deleted from the project**.

**Reasoning.** Revision 1 proposed both a logo concept and an accent colour before an
approved identity existed. An approved identity now exists, drawn by a designer and signed
off by the founder. Assistant-generated alternatives do not override that, regardless of
their merit.

**Consequence — the accessibility problem solved itself.** I measured every approved colour
against every surface. Emerald Green fails as text on light (2.86 : 1), Trust Gold fails
(2.14 : 1), Fresh Mint fails (1.82 : 1) — but **Deep Emerald passes at 5.06 : 1**, and on
dark surfaces Fresh Mint (8.87) and Trust Gold (7.53) are AAA. So the palette already
contains an accessible option for every role. **Semantic tokens map roles to approved
colours; no colour was invented.** Only borders and pressed states use mathematically
derived tints, each documented with its origin.

**Also decided.** Gold is a limited accent — never a background, never body text. Expenses
are amber-brown from the Trust Gold family, never red; red is reserved for destructive
actions.

---

## ADR-016 — Dual-font system: Poppins and Inter, not one or the other
**Status:** Accepted · 5 Aug 2026 · **corrects revision 1**

**Decision.** **Poppins** for brand presentation, splash, onboarding headlines, and screen
titles. **Inter** for all amounts, tables, forms, reports, and interface text.
**Noto Sans Bengali** for all Bangla. All three bundled locally; none fetched at runtime.

**Reasoning.** Revision 1 claimed Inter replaces Poppins across the identity. That was wrong
— the Friday ecosystem uses Poppins prominently in branding, and dropping it would break
family resemblance. But Poppins has no true tabular-figure feature, and money columns
misalign without one. The two families have genuinely different jobs, so both are used.

**Licensing.** All three are SIL OFL 1.1: free for commercial use, embeddable in an app
binary, no in-app attribution required. Total payload ≈ 970 KB. Licence texts appear under
About → Open source licences.

**Rejected for Bangla.** *Hind Siliguri* (numerals clash with Inter, no 500 weight),
*Baloo Da 2* (display-only), *SolaimanLipi* (commercial embedding licence unclear — do not
use without written permission).

---

## ADR-017 — Security claims may never exceed implemented, tested capability
**Status:** Accepted · 5 Aug 2026 · Founder directive · **extends ADR-006**

**Decision.** Doc 06 §0 defines seven distinct protections and forbids seven specific
phrases until the corresponding feature exists and has passed its exit criteria. This binds
the app UI, onboarding, store listings, marketing, the website, README files, and developer
notes.

**Reasoning.** A user who believes their database is encrypted makes different decisions
about where they leave their phone and who they lend it to. An inaccurate security claim is
therefore not a marketing exaggeration — it changes behaviour and can cause the harm it
purports to prevent. ADR-006 already deferred SQLCipher honestly; ADR-017 makes the *language
rule* enforceable rather than relying on good intentions.

**Immediate consequence.** The supplied brand feature strip states "Your data is encrypted
and always protected." That sentence is currently false and must be re-exported before the
asset is published (doc 17 §5.9). Catching this in the approved brand package rather than in
a store listing is exactly why the rule exists.

**Enforcement.** A copy audit against the doc 06 §0 table is a Phase 8 release-checklist item.

---

## ADR-018 — MVP reduced from 84 routes to 42
**Status:** Accepted · 5 Aug 2026 · Founder-requested scope review

**Decision.** 18 routes combined, 11 converted to bottom sheets, 13 deferred. Final MVP: 42
routes. Full analysis in doc 03 §3–§6.

**Reasoning.** 84 routes is a funded team's first release, not a beginner's solo project. At
4–6 files per route that is over 400 files before anything useful happens. The reduction is
mostly *better design*, not less product: eleven near-identical report screens became one
parameterised screen with a report registry, and simple pickers became sheets, which is a
better interaction anyway.

**The rule applied.** A route earns its existence if the user needs to navigate *back* from
it, deep-link to it, or spend more than a few seconds there. Everything else is a sheet.

**What was protected.** No financial safeguard was touched. Balances, transfers, splits, debt
payments, the Zakat worksheet, backup, restore, delete-all, and the lock screen are fully
retained. The Zakat module was reduced least — 15 routes to 10 — and both merges make the
calculation *easier* to check, not harder.

**Estimated saving:** 6–9 weeks, concentrated in Phases 3, 4, and 6.

---

## ADR-019 — Test targets are per-area and justified, not a single number
**Status:** Accepted · 5 Aug 2026

**Decision.** Replace the revision-1 figure of "~615 tests" with per-area coverage thresholds
and a named mandatory case list. Working total ≈ 325. 100% branch coverage retained on
`domain/money`, `domain/balance`, and `domain/zakat`.

**Reasoning.** A round total invites writing tests to reach it, which produces assertions
like `expect(result).toBeDefined()` that raise coverage and prove nothing. The real gate is
the named case list in doc 12 §4.

**On the 100% question, honestly.** It is achievable on the Zakat engine *because* that layer
is pure — no async, no I/O, no clock, no platform calls — so every branch is reachable by
constructing an input. It is meaningful *because* its branches map one-to-one onto the
methodology's decisions: an unexercised branch is an unchecked Zakat rule. The condition is
that coverage must never be reached by testing dead defensive branches — those get **deleted**
instead, since validation belongs at the Zod boundary. Where coverage would be dishonest —
repositories and services, which have genuinely unreachable SQLite and platform branches —
the target is 85–95%, covered by integration and E2E tests instead.

---

## ADR-013 — Five tabs, quick-add as a floating button
**Status:** Accepted · 4 Aug 2026

**Decision.** Home, Transactions, Plan, Islamic, Settings. Reports live under Home rather
than taking a sixth tab. Quick-add is a floating action button, not a tab.

**Reasoning.** Six tabs break at large font sizes in Bangla. Adding a transaction is an
action, not a destination, so it should not consume a navigation slot. Reports are
consulted occasionally; the tab bar should reflect daily use.

**We would revisit if:** usage shows reports being opened frequently — then promote it and
merge Plan's contents.
