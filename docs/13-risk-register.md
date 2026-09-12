# 13 — Risk Register

Scored as Likelihood × Impact, each 1–5. Ordered by score.

---

## R-01 · Scope creep kills the project · L5 × I5 = **25** — the biggest risk
An eight-phase MVP is a lot for one beginner. Every phase will suggest three more features,
and each will feel small and reasonable.

**Symptoms:** Phase 2 is still open after 12 weeks; new tables appear that are not in doc 05;
"while I'm in here" appears in commit messages.

**Mitigation:** doc 01 §4's non-goals table is binding. New ideas go into `docs/backlog.md`
and nothing else happens. The roadmap's anti-pattern list (doc 11) is the script for saying
no. Review scope at every phase boundary in writing.

---

## R-02 · Founder is a beginner on a genuinely hard problem · L4 × I5 = **20**
Financial correctness, cryptography, migrations, and localisation are each individually
demanding. This is not a beginner-sized project; it is being attempted by a beginner with
assistance, which is a different thing.

**Mitigation:** phases are ordered so each teaches what the next needs. Phase 1 is entirely
about learning the tools with no product pressure. Every phase requires the app to run on a
real device — a short feedback loop is what turns a beginner into a developer. The pure
domain layer means the hardest logic is testable without understanding React.

**Realistic expectation:** Phases 1–2 will take longer than estimated. That is normal and is
not evidence the project is failing.

---

## R-03 · Zakat calculation is wrong or religiously misleading · L3 × I5 = **15**
The most serious *product* risk. A wrong Zakat figure harms someone in a way a wrong grocery
total does not.

**Mitigation:** every safeguard in doc 08. No method default. Disclaimers everywhere.
Full breakdown. Immutable versioned snapshots. Parameters as data. 100% branch coverage plus
the mandatory case list. A second person reproduces a worked example on paper. The register
in doc 14 is sent to a qualified scholar before public launch.

**Residual:** unreviewed items may be wrong at launch. Mitigated by never presenting the
figure as anything other than a user-configured estimate.

---

## R-04 · Bangla localisation is done badly · L4 × I3 = **12**
Machine-translated Bangla will be immediately obvious to the primary audience and will make
the product feel foreign — the opposite of the intent.

**Mitigation:** ADR-007 architecture from Phase 1. Bangla copy written by a native speaker as
product copy. Religious terms in doc 14 item S-19 reviewed separately. Layouts tested at
200% scale with real Bangla strings, not lorem ipsum. Test Bangla with actual users early —
this is cheap and catches problems nothing else will.

---

## R-05 · Balance or total calculation bug reaches users · L3 × I4 = **12**
Once a user catches the app being wrong about their money, they stop trusting every number
in it, permanently.

**Mitigation:** integer money (ADR-004), derived balances (ADR-005), the transfer test
suite, the 10,000-row reconciliation test, and the founder using the app on their own money
for a week at the end of Phase 2.

---

## R-06 · Data loss during a migration or restore · L2 × I5 = **10**
A user loses two years of records.

**Mitigation:** automatic pre-migration backup (last three kept). Migrations run in a
transaction. Every migration has a data-survival test. Restore stages into a temporary
database and swaps atomically. Restore is never partial. A checksum-verified round-trip test
is a Phase 7 exit criterion.

---

## R-07 · Backup passphrase forgotten, backup unusable · L4 × I2 = **8** (severe for that user)
Backups are encrypted with no recovery path — by design.

**Mitigation:** the backup screen states in bold, before the user proceeds, that the
passphrase cannot be recovered. A strength meter, a confirm-entry field, and a suggestion to
store it in a password manager. [RECOMMENDED] Offer an optional printable recovery sheet the
user writes the passphrase on themselves. **Do not** add a recovery mechanism — that would
mean holding a key, and the file would no longer be genuinely encrypted.

---

## R-08 · Expo SDK 57 library incompatibility · L3 × I2 = **6**
SDK 57 is recent; charting or crypto libraries may not have caught up.

**Mitigation:** prefer Expo-maintained modules. `@noble/*` is pure JS and version-independent.
Verify every third-party peer range at install time. Charts have a fallback plan (hand-drawn
`react-native-svg`). Pin exact versions and commit the lockfile.

---

## R-09 · Motivation collapse · L3 × I4 = **12**
Solo projects most often die from the founder losing interest during a long unglamorous
middle, not from technical failure.

**Mitigation:** Phase 2 produces an app the founder personally uses — the strongest possible
motivator. Phases are sized to produce something visible every 3–5 weeks. Handoff documents
mean picking the project back up after a break is possible. [RECOMMENDED] Show the app to
five real people at the end of Phase 3; external interest is fuel.

---

## R-10 · iOS release blocked · L3 × I2 = **6**
Requires an Apple Developer account ($99/year), and App Store review can reject on vague
grounds, particularly for finance and religion categories.

**Mitigation:** Android first, entirely. Build for iOS via EAS (no Mac needed) but treat it
as a post-1.0 target. Write store copy that avoids any claim of financial advice or
religious authority — the disclaimers already in the product help here.

---

## R-11 · Performance degrades with real data volumes · L2 × I3 = **6**
**Mitigation:** the index set in doc 05 defined before Phase 2 ships. Aggregations done in
SQL, not JavaScript. Pagination from the start. The 10,000-row performance test is a Phase 2
exit criterion, not a Phase 8 discovery.

---

## R-12 · Security vulnerability in a dependency · L3 × I2 = **6**
**Mitigation:** `npm audit` in CI failing on high/critical. Small dependency budget. Prefer
audited libraries. No dependency added without a written reason.

---

## R-13 · Legal or regulatory exposure in Bangladesh · L2 × I3 = **6**
[ASSUMPTION] A local-only app that stores no data on a server, handles no payments, and
gives no advice is unlikely to require financial licensing. **This is an assumption, not
legal advice.**

**Mitigation:** verify with a Bangladeshi lawyer before public launch — specifically whether
a Zakat estimation feature triggers any consumer-protection or religious-content
requirement. Terms of service must disclaim financial and religious advice explicitly. Keep
the "no payments, no advice, no data transmission" position, which is the safest posture.

---

## R-14 · Reputational harm from a religious mistake · L2 × I4 = **8**
A single screenshot of the app saying something religiously wrong could spread quickly and
be very hard to correct.

**Mitigation:** doc 08's rules, doc 14's register, and a copy review of every religiously
adjacent string by a Bangla-speaking Muslim reviewer before release. Never use the words
"halal", "haram", "Shariah-compliant", "approved", or "certified" about anything the app
produces.

---

## R-15 · The Friday ecosystem's other products compete for the founder's time · L4 × I3 = **12**
`D:\MyApps` already contains Friday, Friday Note, Friday Task, Friday Flow, Friday Live, and
several other projects. Friday Amanah is the largest of them and the least forgiving of
partial attention.

**Mitigation:** be explicit about which product is active. A financial app with a half-built
security layer sitting idle for three months is worse than one that was never started —
because the security work will be half-remembered when it resumes. If Friday Amanah is going
to be paused, pause it at a phase boundary with a written handoff, never mid-phase.

---

## Review cadence

Re-score this register at every phase boundary. Add new risks as they appear. Move closed
risks to a "Closed" section with a note on how they were resolved — do not delete them.
