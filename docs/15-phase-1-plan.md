# 15 — Phase 1 Implementation Plan

> **Revision 2 · 5 August 2026.** Updated for the Friday Amanah name, the approved brand
> package, and the reduced 42-route scope. **Do not begin these steps until the founder has
> approved the revision-2 corrections and answered the open decisions in doc 18 §10.**

**Goal of Phase 1:** an Expo app that launches on your phone, has five working tabs, a
light/dark theme, English and Bangla switching, a real SQLite database with the schema from
doc 05, a small component library, and a fully tested `Money` module.

**Phase 1 contains no features.** No transactions, no budgets, no Zakat. That is deliberate.
This phase is about building a foundation you understand and can debug. Every hour spent
here saves several later.

**Estimated time:** 2–3 weeks at 15–20 hours per week. Step 1 alone may take a full evening
the first time. That is normal.

---

## Step 1 — Choose how you will run the app

You said you were unsure. Here is my advice.

### Recommendation: **Android phone + Expo Go**

**Why.** You are on Windows with a D: drive and several existing Node projects, so you
already have a working development machine. Expo Go means you scan a QR code and the app
appears on your phone in seconds. No Android Studio, no 8 GB download, no virtualisation
settings in the BIOS, no emulator that runs slowly on a machine also running VS Code.

Crucially, it also means the app you are testing is running on **exactly the kind of device
your users have** — a real Android phone with a real screen size, real Bangla font
rendering, and a real fingerprint sensor.

Everything Phase 1–6 needs is available inside Expo Go: `expo-sqlite`, `expo-secure-store`,
`expo-local-authentication`, `expo-file-system`, `expo-crypto`. You will only need to move
to a custom development build at Phase 7, and by then you will know enough for that to be
straightforward.

**What you need:** an Android phone (any Android 8 or newer), the Expo Go app from the Play
Store, and both the phone and the PC on the same Wi-Fi network.

**If you do not have an Android phone**, tell me and we will set up Android Studio's
emulator instead — it works, it is just a heavier first day.

### Before we start, run these three commands

Open **PowerShell** (press `Win`, type `powershell`, press Enter) and run each line, one at
a time. Send me the output of all three.

```powershell
node --version
npm --version
git --version
```

**What we need to see:**

| Command | Needed | If it is missing or too old |
|---|---|---|
| `node --version` | v20.x or v22.x | Download the **LTS** installer from nodejs.org and install it. Then close and reopen PowerShell. |
| `npm --version` | 10.x or higher | Comes with Node. Fixed by installing Node. |
| `git --version` | any 2.x | Install from git-scm.com. Accept all defaults. |

If a command prints something like `'node' is not recognized`, that program is not installed
or not on your PATH. Install it, then **close PowerShell completely and open a new one** —
PATH changes do not apply to already-open windows. This catches almost everyone once.

**Do not continue past this step until all three commands print a version number.**

---

## Step 2 — Create the project

The `docs` folder already exists at `D:\MyApps\friday-amanah\docs`. We will create the Expo
project into that same `friday-amanah` folder.

```powershell
cd D:\MyApps
npx create-expo-app@latest friday-amanah --template blank-typescript
```

**What each part means:**
- `npx` runs a tool without permanently installing it
- `create-expo-app@latest` is Expo's project generator
- `friday-amanah` is the folder name — it already exists, and the generator will fill it in
  alongside your `docs` folder
- `--template blank-typescript` starts with an empty TypeScript app rather than an example

This downloads a few hundred megabytes and takes 2–5 minutes. If it asks anything, accept
the default.

**If it refuses because the folder is not empty:** create it in a temporary folder instead
and then move the files:

```powershell
cd D:\MyApps
npx create-expo-app@latest fm-temp --template blank-typescript
Move-Item -Path D:\MyApps\fm-temp\* -Destination D:\MyApps\friday-amanah -Force
Move-Item -Path D:\MyApps\fm-temp\.* -Destination D:\MyApps\friday-amanah -Force -ErrorAction SilentlyContinue
Remove-Item D:\MyApps\fm-temp -Recurse -Force
```

### Verify it runs before changing anything

```powershell
cd D:\MyApps\friday-amanah
npx expo start
```

A QR code appears in the terminal. On your phone: open **Expo Go** → **Scan QR code** →
point at the terminal. Your phone should show a white screen saying
"Open up App.tsx to start working on your app!"

**If the QR code does not connect:** press `Ctrl+C` to stop, then run
`npx expo start --tunnel`. This routes through Expo's servers and works even when the phone
and PC are on different networks or the network blocks device-to-device traffic. It is
slower but reliable.

**Stop here and confirm this works.** Do not install anything else until you have seen the
white screen on your phone. If this step fails we fix it now; if we skip past it, every
later error will have two possible causes instead of one.

---

## Step 3 — Set up version control

```powershell
cd D:\MyApps\friday-amanah
git init
git add .
git commit -m "Phase 1: initial Expo TypeScript project"
```

From now on, commit after every working step. A commit is a save point you can return to
when something breaks. This will save you more than once.

---

## Step 4 — Install dependencies

Run these **one group at a time**, and check for errors after each. Grouping them makes it
obvious which install caused a problem.

```powershell
# Navigation and routing
npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar

# Storage and security
npx expo install expo-sqlite expo-secure-store expo-crypto expo-local-authentication expo-file-system

# Localisation and fonts
npx expo install expo-localization @expo-google-fonts/inter @expo-google-fonts/poppins @expo-google-fonts/noto-sans-bengali expo-font

# State, forms, validation, i18n, crypto
npm install zustand react-hook-form zod @hookform/resolvers i18next react-i18next @noble/ciphers @noble/hashes @umalqura/core

# Development and testing tools
npm install --save-dev jest jest-expo @testing-library/react-native @types/jest eslint prettier eslint-config-expo babel-plugin-transform-remove-console
```

**Use `npx expo install`, not `npm install`, for anything starting with `expo-` or that is a
React Native native module.** `expo install` picks the version that matches your SDK;
`npm install` picks the newest, which often does not match and produces confusing runtime
errors. This is the single most common source of "it worked yesterday" problems in Expo.

After each group, if you see `ERESOLVE` or a peer-dependency error, **stop and send me the
full message.** Do not use `--force` or `--legacy-peer-deps` to push past it — that hides a
real incompatibility until it surfaces as a crash later.

---

## Step 5 — Files we will create

I will give you each of these in order, with its full contents and an explanation of what it
does. You will not have to write code from scratch.

### Configuration (7 files)
```
package.json          modified — scripts: start, lint, typecheck, test, check:*
app.json              modified — name, slug, scheme, icon, splash, allowBackup false
tsconfig.json         modified — strict: true, path aliases (@/…)
babel.config.js       modified — expo-router plugin, remove-console in production
metro.config.js       new      — SQL file support for migrations
jest.config.js        new      — jest-expo preset, coverage thresholds
.eslintrc.js          new      — expo config + import boundaries + no-hardcoded-strings
.prettierrc           new
.gitignore            modified — .env, *.keystore, *.db, backups
```

### Theme (6 files) — doc 09 tokens
```
src/theme/tokens.ts        Spacing, radius, shadow
src/theme/colors.ts        Light and dark palettes
src/theme/typography.ts    Type scale, Bangla line-height multiplier
src/theme/ThemeProvider.tsx
src/theme/useTheme.ts
src/theme/types.ts
```

### Localisation (8 files) — doc 09 ADR-007
```
src/i18n/index.ts                  i18next init, device detection, persistence
src/i18n/en/common.json            ~80 starter keys
src/i18n/en/errors.json
src/i18n/en/accessibility.json
src/i18n/bn/common.json            same keys, written Bangla
src/i18n/bn/errors.json
src/i18n/bn/accessibility.json
src/i18n/format/bengaliNumerals.ts
```

### Money domain (5 files + tests) — ADR-004, the most important code in Phase 1
```
src/domain/money/money.ts       Money type, add, subtract, multiply, allocate, compare
src/domain/money/currency.ts    Minor-unit table, symbols
src/domain/money/format.ts      Display formatting, both numeral systems
src/domain/money/parse.ts       User input → minor units
src/domain/money/index.ts
src/domain/money/__tests__/money.test.ts     ~60 tests from doc 12 §4
```

### Database (6 files + migration)
```
src/db/client.ts                     Open, PRAGMAs (foreign_keys, WAL), single connection
src/db/migrate.ts                    Migration runner using PRAGMA user_version
src/db/migrations/001_initial.sql    Full schema from doc 05
src/db/migrations/index.ts
src/db/seed/categories.ts            23 default categories, bilingual keys
src/db/seed/currencies.ts            BDT, USD, GBP, EUR, SAR, AED, MYR, INR, PKR
src/db/types.ts                      Row types matching the schema
```

### Library (5 files)
```
src/lib/logger.ts       Redacting logger — doc 06 §7
src/lib/result.ts       Result<T, AppError>
src/lib/errors.ts       Error codes → i18n keys
src/lib/id.ts           UUID v4 via expo-crypto
src/lib/__tests__/logger.test.ts   The redaction test — a Phase 2 gate
```

### Components (15 files)
```
src/components/ui/  Text Button IconButton Card Input Switch Divider Badge
                    ProgressBar ListItem SectionHeader Sheet Toast
src/components/states/  EmptyState ErrorState LoadingSkeleton
src/components/layout/  Screen Header
```

### Routes (8 files)
```
app/_layout.tsx              Root: fonts, i18n, theme, DB init, splash control
app/(tabs)/_layout.tsx       Five tabs + FAB placeholder
app/(tabs)/index.tsx         Home placeholder
app/(tabs)/transactions.tsx  placeholder
app/(tabs)/plan.tsx          placeholder
app/(tabs)/islamic.tsx       placeholder
app/(tabs)/settings.tsx      Real: language switch, theme switch (so we can test both)
app/_gallery.tsx             Dev-only component gallery
```

### Scripts (4 files) — doc 12 §7 and doc 06 §0
```
scripts/check-no-float.ts            No REAL/FLOAT column in any migration (ADR-004)
scripts/check-hardcoded-strings.ts   No bare string literal in JSX (ADR-007)
scripts/check-tone.ts                No banned phrase in any i18n file (doc 02)
scripts/check-security-claims.ts     No banned encryption phrase anywhere (doc 06 §0, ADR-017)
```

### Brand assets (copy step, no new artwork) — doc 17 §4
```
assets/brand/icon.png              ← Dark/Friday_Amanah_Dark_1024x1024.png, alpha stripped
assets/brand/icon-ios.png          ← same, alpha stripped (App Store requirement)
assets/brand/adaptive-icon.png     ← Icon_Only_Transparent_4K.png, scaled + centred  ⚠️ needs approval
assets/brand/splash-logo.png       ← Stacked_Transparent_2K.png, centred              ⚠️ needs approval
assets/brand/mark.png              ← Icon_Only_Transparent_4K.png, for the in-app header
assets/brand/logo-primary.png      ← Primary_Transparent_4K.png, onboarding
assets/brand/logo-horizontal.png   ← Horizontal_Transparent_3K.png, About + PDF header
src/theme/brand.ts                 The 8 approved colours, verbatim from the JSON token file
src/components/ui/BrandMark.tsx    The only component permitted to render the logo
```

**Originals are never modified in place.** The two items marked ⚠️ involve scaling and
centring an existing asset onto a new canvas — placement only, no redrawing — and both need
your approval before Phase 1 begins (doc 17 §5.1 and §5.2).

**Total: about 82 files.** We will build them in seven stages, and after each stage you will
run the app and confirm it still works.

---

## Step 6 — Build order

| Stage | What | You verify by |
|---|---|---|
| 1.1 | Config, TypeScript strict, lint, Prettier | `npm run typecheck` and `npm run lint` both pass |
| 1.2 | Theme + `Text` component | A themed "Hello" renders in light and dark on your phone |
| 1.3 | Expo Router shell, five tabs | All five tabs are tappable on your phone |
| 1.4 | i18n + language switch in Settings | Tapping "বাংলা" changes the tab labels; it persists after restart |
| 1.5 | Money domain + tests | `npm test` shows ~60 tests passing |
| 1.6 | Database client, migration runner, migration 001, seed | Settings shows "Database v1 · 23 categories · 9 currencies" |
| 1.7 | Component library + gallery | The gallery renders every component in both themes and both languages |
| 1.8 | Brand assets, `BrandMark`, app icon, splash | The Friday Amanah icon appears on your home screen; the splash shows the approved logo |

After each stage: `git add . && git commit -m "Phase 1.x — <what>"`.

---

## Step 7 — Phase 1 exit criteria

Phase 1 is complete only when **every** box is ticked, on a real device:

- [ ] App launches on your Android phone through Expo Go
- [ ] All five tabs navigate without errors
- [ ] Light and dark themes both render correctly, and the system setting is followed
- [ ] Language switches between English and Bangla and survives an app restart
- [ ] Bangla text renders in **Noto Sans Bengali** with correct line spacing
- [ ] **Conjunct test string renders without broken glyphs** on both platforms — verify
      `ক্ষ ঞ্জ ন্ত্র স্প্র দ্ধ ঙ্ক্ষ` and `১২৩৪৫৬৭৮৯০`
- [ ] **Poppins renders on titles, Inter on amounts** — visibly different, and amounts align
      in a column (tabular figures working)
- [ ] **The app icon on the home screen is the approved Friday Amanah mark**, not the Expo
      default, and the shield and keyhole are not cropped by the launcher
- [ ] **Splash screen shows the approved logo** on `#F8FAFC` light / `#0A1D37` dark
- [ ] All eight approved brand colours are present in `src/theme/brand.ts`, verbatim
- [ ] `npm run check:security-claims` — passes (no banned encryption phrase anywhere)
- [ ] The database file is created on first launch and migration 001 applies
- [ ] `PRAGMA user_version` returns 1
- [ ] The 23 default categories and 9 currencies are present
- [ ] Killing and reopening the app does not re-run the migration
- [ ] `npm run typecheck` — zero errors
- [ ] `npm run lint` — zero errors
- [ ] `npm test` — all pass, with the count recorded
- [ ] `npm run check:no-float` — passes
- [ ] The logger redaction test passes
- [ ] The component gallery renders every component in both themes and both languages
- [ ] Everything is committed to git
- [ ] `docs/handoffs/phase-1.md` written, with the real command output pasted in

---

## Step 8 — Handoff document

At the end of Phase 1, create `docs/handoffs/phase-1.md` containing:

1. What was built (file list)
2. Exact command output for lint, typecheck, and test — pasted, not summarised
3. Screenshots of the app on your phone: both themes, both languages
4. What is **not** finished, and why
5. Any warnings you saw, even if everything passed
6. What Phase 2 needs from Phase 1
7. Anything you did not understand, so we cover it before it matters

That last point is the most valuable one. If you write "I don't really understand what the
migration runner does", we address it in Phase 2 instead of it becoming a blocker in Phase 7.

---

## When something breaks

1. **Read the error message.** Expo's errors are usually specific and name a file.
2. **Note what you changed immediately before it broke.** That is the cause more than 90% of the time.
3. **Try the standard reset**, in this order:
   ```powershell
   npx expo start --clear          # clears the Metro bundler cache
   ```
   If that does not help:
   ```powershell
   Remove-Item -Recurse -Force node_modules
   Remove-Item -Force package-lock.json
   npm install
   npx expo start --clear
   ```
4. **Send me the full error**, not a summary — the stack trace, the file, the line.
5. **Do not delete the project and start over.** We diagnose the project that exists.
   Restarting almost always reproduces the same problem while destroying working code.

---

## Before Phase 1 can begin

**Do not run any command in this document yet.** Phase 1 is gated on the revision-2
corrections being approved and on six decisions only you can make.

### Gate A — approve the revision-2 corrections
Read [doc 18](18-change-log.md), then confirm the rename, brand integration, security
language, and the 84 → 42 scope reduction are all correct.

### Gate B — answer the open decisions (doc 18 §10)
| # | Decision | Why it blocks Phase 1 |
|---|---|---|
| 1 | Android application ID / iOS bundle ID — `org.royalopencollege.fridayamanah` recommended | Written into `app.json` in stage 1.1. Permanent once published |
| 2 | Deep-link scheme — `fridayamanah://` recommended | Written into `app.json` |
| 3 | Approve the splash composition method (doc 17 §5.1) | Stage 1.8 |
| 4 | Approve the adaptive-icon recomposition method (doc 17 §5.2) | Stage 1.8 — otherwise the launcher crops the shield |
| 5 | Supply the monochrome icon, notification icon, and 1200×630 social preview | Not blocking Phase 1; needed by Phase 3 and launch |
| 6 | Re-export the brand feature strip with corrected security copy (doc 17 §5.9) | Not blocking Phase 1; must not be published as-is |

### Gate C — then send me
1. The output of `node --version`, `npm --version`, `git --version`
2. Whether you have an Android phone available for testing
3. Confirmation that you have read docs 01 (requirements), 08 (Zakat), 11 (roadmap), and
   17 (brand)

Once all three gates are clear, we start at Step 2.
