# Barakah

**Manage Wealth with Purpose.**  
Official website: [barakah.money](https://barakah.money)  
Privacy-first Islamic personal finance application.

> **এই ফাইলটা কী** — কাজ থামিয়ে অনেক দিন পরে ফিরে এলে প্রথমে এটাই পড়বেন। এখানে আছে: এখন
> কোথায় আছি, কী কাজ করছে, কী বাকি, আর কোন কমান্ড দিয়ে আবার শুরু করবেন।
> বাকি সব ডকুমেন্ট ইংরেজিতে, কারণ পরে অন্য কেউ প্রজেক্টে যুক্ত হলে তার কাজে লাগবে।

**Last updated:** 5 August 2026

---

## দ্রুত অবস্থা / Quick status

| | |
|---|---|
| **এখন কোন ধাপে** | Phase 1A — প্রায় শেষ |
| **কী কাজ করে** | খালি Expo SDK 54 অ্যাপ BlueStacks এমুলেটরে চলছে ✅ |
| **কী বাকি** | আসল ফোনে টেস্ট · Git গোছানো |
| **অ্যাপের কোড লেখা হয়েছে?** | না। এখনো Expo-র default template |
| **পরের বড় কাজ** | Phase 1B — theme, navigation, বাংলা/ইংরেজি, database |

### আবার শুরু করতে

```powershell
cd D:\MyApps\friday-amanah\mobile
npx expo start
```

তারপর ফোনে বা BlueStacks-এ **Expo Go** খুলে QR scan করুন।
`a` চাপলে কাজ করবে না — `adb` ইনস্টল নেই। হাতে QR scan করতে হবে। এটা সমস্যা নয়।

**পড়ার ক্রম:** এই ফাইল → `docs/README.md` → `docs/18-change-log.md` → `docs/handoffs/phase-1a.md`

---

## What this project is

A privacy-focused, **local-first** Islamic personal finance app for Android and iOS.
Bangladesh-first: BDT default, Bangla-first with full English support.

It tracks income, expenses, budgets, savings goals, debts and receivables, Zakat estimation,
and charitable giving. **The MVP has no server at all** — the device database is the only
copy of the data.

It is not a bank, not an investment platform, and **not a religious authority**. It never
issues a ruling; it calculates transparently and discloses its method.

---

## Where things are

```
D:\MyApps\friday-amanah\
├── README.md                      ← you are here
├── docs\                          20 planning documents — the blueprint
│   ├── README.md                  document index, start here
│   ├── 01 … 18                    requirements → architecture → brand → change log
│   └── handoffs\phase-1a.md       real command output, verified
├── Friday_Amanah_Brand_Assets\    56 approved brand files — DO NOT EDIT
└── mobile\                        the Expo app (currently the default template)
```

**Golden rule:** if a document and the code disagree, one of them is wrong. Stop and fix the
disagreement before continuing.

---

## Current state, precisely

### ✅ Done and verified on the founder's machine

| What | Evidence |
|---|---|
| Phase 0 — full planning docs | 20 documents in `docs\` |
| Brand package integrated into the plan | `docs/17` — 56 files inventoried, dimensions read from each file |
| Environment | Node v24.18.0 · npm 11.16.0 · Git 2.55.0 |
| Expo app created | SDK 54, `expo-template-default@54.0.62` |
| `package.json` | Compared field-by-field against the published template — exact match |
| `npx tsc --noEmit` | Clean, zero errors under `strict: true` |
| `npm run lint` | Clean, no errors or warnings |
| `npm ls --depth=0` | 29 packages, no UNMET, no invalid |
| `npx expo-doctor` | **18/18 checks passed** |
| **App runs** | Bundled in 35.9 s, 1455 modules. Default Expo screen rendered on BlueStacks |
| **Expo Go supports SDK 54** | Confirmed empirically — this was the main open risk |

### ⏳ Not done yet

- **Physical Android phone test.** BlueStacks worked, but it cannot validate Bangla conjunct
  rendering, biometrics, or Keystore behaviour. The phone is the reference device.
- **Git tidy-up.** See the warning below.
- **`app.json` still says `mobile`** — name, slug, and scheme are template defaults.
- No Friday Amanah feature code of any kind.

---

## ⚠️ Two things to deal with before Phase 1B

### 1. `create-expo-app` created a Git repository inside `mobile\`

`D:\MyApps\friday-amanah\mobile\.git` exists. It has **no commits yet** (branch `master`,
empty), so nothing is lost by changing it.

This was not intended. `docs/15A` §6 recommends **one repository at the project root** so
that docs, brand assets, and the app are versioned together. A repository nested inside
another causes real problems later — the outer repo cannot see inside it properly.

**Proposed fix, not yet applied:**
```powershell
cd D:\MyApps\friday-amanah
Remove-Item -Recurse -Force mobile\.git      # safe: it has zero commits
git init                                      # one repo at the project root
```
Then add a root `.gitignore` covering `node_modules/`, `.expo/`, `*.db`, `.env`, `dist/`.
**Do not run this without deciding on the brand assets question below.**

### 2. Brand assets in Git — decide before the first commit

`Friday_Amanah_Brand_Assets\` is 56 PNG/ICO files, roughly 25 MB.

- **Include** — everything lives together, assets cannot be lost. 25 MB is not a problem for
  a repo this size. **This is the recommendation.**
- **Exclude** — smaller repo, but Git cannot diff large PNGs usefully anyway, and the assets
  would then exist in only one place on one machine.

---

## Decisions still waiting on the founder

These block parts of Phase 1B. Details in `docs/17` §6 and `docs/18` §10.

| # | Decision | Why it matters |
|---|---|---|
| 1 | Android application ID / iOS bundle ID — `money.barakah.app` | **Decided:** configured in `app.json` |
| 2 | Deep-link scheme — `barakah://` | **Decided:** configured in `app.json` |
| 3 | Splash composition method | `docs/17` §5.1 — placement only, no artwork change |
| 4 | Android adaptive icon recomposition | `docs/17` §5.2 — **as-is the launcher would crop the shield** |
| 5 | Three missing assets: monochrome icon, 96×96 white notification icon, 1200×630 social preview | Needed by Phase 3 and launch |
| 6 | Re-export the brand feature strip | It currently claims *"Your data is encrypted and always protected"* — **that is not true today** |
| 7 | Bangla copywriter | Bangla must be *written*, not translated |
| 8 | Qualified scholar for the `docs/14` register | 23 items unreviewed |

---

## Rules that must not be broken

These are the ones most likely to be forgotten after a break. Full reasoning in the ADRs.

1. **Money is always an integer in minor units.** Never a floating-point number. No `REAL`
   column anywhere. `0.1 + 0.2` is not `0.3`, and across thousands of rows that becomes a
   visibly wrong balance. — ADR-004
2. **Balances are derived, never stored.** A cached value is an optimisation; the computed
   value always wins. — ADR-005
3. **The app never issues a religious ruling.** No Zakat figure appears without its method,
   its version, and the disclaimer. No default Nisab — the user must choose. — ADR-008, `docs/08`
4. **Never claim security that does not exist.** Seven phrases are banned until the feature
   is built *and tested*, including "encrypted database" and "bank-grade encryption".
   The database is **not** encrypted today. — ADR-017, `docs/06` §0
5. **No hardcoded user-facing text.** Every string is a translation key from day one.
   Retrofitting Bangla costs about five times more. — ADR-007
6. **Never redraw the logo.** The supplied brand package is the visual source of truth.
   No crescents, domes, coins, or scales. — ADR-015
7. **Expo SDK 54 is temporary.** It exists so Expo Go works on a physical phone. Do not
   upgrade during Phases 1A–6 without a specific reason and a commit to return to. — ADR-020
8. **Diagnose, never rebuild.** When something breaks, read the error and check the file it
   names. Deleting the project reproduces the same bug and destroys working code.
9. **Never claim a test passed without running it.** Record the command, the result, the
   counts, and any warnings. — `docs/12` §8
10. **Scope is closed.** New ideas go in `docs/backlog.md` and nothing else happens until
    Phase 8. — `docs/11`

---

## Lessons already learned the hard way

- **Run npm commands from `mobile\`, not the project root.** The root has no `package.json`.
  Doing otherwise produces four different-looking errors with one cause.
- **`adb` is not installed**, so `a` in the Expo terminal does not work. Scan the QR in Expo
  Go instead. Not a fault, and Android Studio is not needed.
- **BlueStacks is not a real phone.** Android 9, x86_64, no fingerprint hardware, different
  font stack. Fine for fast iteration; useless for validating Bangla rendering or biometrics.

---

## What happens next

| Phase | Content | Estimate |
|---|---|---|
| **1A** | Environment + blank app — *almost done* | — |
| **1B** | Theme, navigation shell, Bangla/English, SQLite + migrations, Money domain, component library, brand assets | 2–3 weeks |
| 2 | Accounts and transactions — **first personally usable build** | 4–5 weeks |
| 3 | Budgets and goals | 2–3 weeks |
| 4 | Debts and giving | 2–3 weeks |
| 5 | Zakat Center | 4–5 weeks |
| 6 | Reports and export | 2 weeks |
| 7 | Security, PIN, biometrics, encrypted backup | 3–4 weeks |
| 8 | Production readiness and release | 3–4 weeks |

**Realistic total: 5–8 months** at 15–20 hours per week. The end of Phase 2 is the moment
this becomes an app you actually use for your own money — that matters more than the finish
date for keeping momentum.

**Do not start a phase until the previous one has been run and verified on a real device.**
