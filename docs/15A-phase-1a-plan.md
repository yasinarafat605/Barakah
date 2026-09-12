# 15A — Phase 1A: Environment Verification and Blank App Launch

**Goal:** create a clean Expo SDK 54 app in `D:\MyApps\friday-amanah\mobile` and confirm it
opens on a physical Android phone through Expo Go.

**Explicitly not in this phase:** branding, navigation design, database, localisation,
theme, state management, forms, testing libraries, fonts, native directories, prebuild,
development builds, or any Friday Amanah feature.

**Why this phase exists separately.** Everything in Phase 1B depends on the toolchain
working. If the phone cannot open a blank app, no amount of application code will fix it —
and debugging a connection problem is far easier when the project contains nothing but the
default template.

---

## An honest note on who runs what

I work in a Linux sandbox that can read and write your `D:\MyApps` folder, but it is **not
your Windows machine.** Two things follow:

1. **I cannot run PowerShell commands for you.** Any output I claimed for `node --version`
   would be invented, and doc 12 §8 forbids that.
2. **The development server must run on your PC, not mine.** Your phone connects to it over
   your Wi-Fi. A server running in my sandbox is unreachable from your phone.

So: **you run the commands, I read the output and diagnose.** What I *have* done from my
side is verify the project folder state and the exact SDK 54 package versions, so that when
you paste your output we are comparing against a known-good baseline rather than a guess.

---

## What I verified from my side (5 Aug 2026)

### Project folder state
```
D:\MyApps\friday-amanah\
├── Friday_Amanah_Brand_Assets\   56 files, untouched
└── docs\                         19 markdown files
```
- ✅ `mobile\` does **not** exist — clear to create
- ✅ No application source code anywhere in the project
- ⚠️ **No Git repository exists** — not at `D:\MyApps\friday-amanah`, not at `D:\MyApps`,
  and nowhere inside the project. Per your instruction, Git is **not** initialised until the
  blank app test succeeds and you approve it.

### SDK 54 template — verified against the npm registry
`expo-template-default@sdk-54` → **54.0.62**, published and installable.

| Package | Version pinned by the template |
|---|---|
| `expo` | `~54.0.35` |
| `react-native` | `0.81.5` |
| `react` | `19.1.0` |
| `typescript` | `~5.9.2` (dev) |
| `expo-router` | `~6.0.24` |
| `eslint` / `eslint-config-expo` | `^9.25.0` / `~10.0.0` (dev) |

**The default template already includes Expo Router and TypeScript**, so no extra flags are
needed to meet your Step 2 requirements.

Scripts the template provides — **these are the only ones that will exist**, and I will not
ask you to run anything else:
```
start   → expo start
android → expo start --android
ios     → expo start --ios
web     → expo start --web
lint    → expo lint
reset-project → strips the demo content (NOT run in Phase 1A)
```
**There is no `test` script and no `typecheck` script.** For the TypeScript check we use
`npx tsc --noEmit`, which the generated `tsconfig.json` supports directly.

---

## Step 1 — Environment verification

Open **PowerShell** (press `Win`, type `powershell`, Enter). Run these **one at a time** and
send me all four outputs verbatim.

```powershell
node --version
npm --version
git --version
Test-Path D:\MyApps\friday-amanah\mobile
```

### What each result must show

| # | Command | Pass | If it fails |
|---|---|---|---|
| 1 | `node --version` | **v20.19.4+, v22.x, or v24.x** — any even-numbered LTS | See below |
| 2 | `npm --version` | 10.x or higher | Fixed by installing Node |
| 3 | `git --version` | any 2.x | Install from git-scm.com, accept defaults |
| 4 | `Test-Path ...\mobile` | **`False`** | If `True`, stop — something already exists there |

**On Node version specifically.** The binding requirement comes from `react-native@0.81.5`,
whose `engines` field is `>= 20.19.4`, and from `@expo/metro ~54.2.0`, which requires the
same. **Node 24 is an even-numbered LTS line and satisfies both.**

Avoid: **Node 18** (past end-of-life; Expo will warn or fail) and any **odd-numbered**
release such as 23 or 25 (not LTS, and a known source of obscure Metro bundler errors).

If `node` is not recognised at all, install the LTS build from nodejs.org, then **close
PowerShell completely and open a new window** — PATH changes do not reach an already-open
terminal. That catches almost everyone once.

### Verified result — 5 August 2026
```
node --version   → v24.18.0            ✅ even LTS, satisfies >= 20.19.4
npm --version    → 11.16.0             ✅
git --version    → 2.55.0.windows.3    ✅
Test-Path mobile → False               ✅ clear to create
```
All four prerequisites passed on the founder's machine.

### Check 5 — the one that saves you an hour

On your Android phone:

1. Open the **Play Store**, search **Expo Go**, install or update it.
2. Open Expo Go.
3. Tell me what it says on the home screen about supported SDK versions — or just send a
   screenshot of the Expo Go home screen.

**Why this matters.** Expo Go from the Play Store supports a specific set of SDK versions.
If the installed Expo Go does not support SDK 54, an SDK 54 project will refuse to open with
a message like *"Project is incompatible with this version of Expo Go."* Checking now costs
30 seconds. Discovering it after creating the project costs a full recreate.

**Do not continue to Step 2 until all five checks pass.**

---

## Step 2 — Create the app (only after Step 1 passes)

```powershell
cd D:\MyApps\friday-amanah
npx create-expo-app@latest mobile --template expo-template-default@54.0.62
```

### What each part does
- `cd D:\MyApps\friday-amanah` — run from the **project root**, not inside it. The command
  creates the `mobile` folder for you.
- `npx create-expo-app@latest` — Expo's official project generator (currently v4.0.0).
- `mobile` — the folder name, so the app lands at `D:\MyApps\friday-amanah\mobile`.
- `--template expo-template-default@54.0.62` — **this is the important part.** Without it,
  the generator gives you SDK 57. The version is pinned exactly rather than using the
  `@sdk-54` tag, so the result is reproducible.

This downloads a few hundred megabytes and takes 2–5 minutes. It runs `npm install` for you.

**Your existing `docs\` and `Friday_Amanah_Brand_Assets\` folders are not touched** — the
generator only writes inside `mobile\`.

### If it fails
Send me the full output. Do not delete anything and do not re-run with `--force`.

---

## Step 3 — Inspect what was generated

```powershell
cd D:\MyApps\friday-amanah\mobile
dir
type package.json
```

Send me the output of `type package.json` in full. I will check it against the baseline table
above rather than assume it is correct.

Then confirm these exist:
```powershell
Test-Path package.json ; Test-Path app.json ; Test-Path tsconfig.json
Test-Path app ; Test-Path node_modules ; Test-Path package-lock.json
```
All six should print `True`. Expo Router configuration lives in `package.json`
(`"main": "expo-router/entry"`) and in `app.json` — I will verify both from your paste.

---

## Step 4 — Run the checks that actually exist

> ⚠️ **Every command in this step must run from `D:\MyApps\friday-amanah\mobile`, not from
> the project root.** The root has no `package.json` and no `node_modules`, so all four
> commands fail there with four different-looking errors that share one cause. Check the
> PowerShell prompt reads `PS D:\MyApps\friday-amanah\mobile>` before you start.
>
> ```powershell
> cd D:\MyApps\friday-amanah\mobile
> Get-Location        # must print D:\MyApps\friday-amanah\mobile
> ```

Only these four. Nothing else is defined by the template.

```powershell
npx tsc --noEmit
```
TypeScript check. **Expected: no output at all.** Silence means success.

```powershell
npm run lint
```
The template's own `expo lint`. May print a small number of warnings on a fresh project —
warnings are fine, errors are not.

```powershell
npm ls --depth=0
```
Dependency tree. Expected: the list from the baseline table with no `UNMET DEPENDENCY` and
no `invalid` markers.

```powershell
npx expo-doctor
```
Expo's own project configuration check. Expected: all checks passed, or a small number of
informational notes.

**Send me all four outputs, including any warnings.** Warnings get reported even when
everything passes — that is the rule in doc 12 §8.

---

## Step 5 — Launch on your phone

```powershell
cd D:\MyApps\friday-amanah\mobile
npx expo start
```

A QR code appears in PowerShell. Then, on your phone:

1. **Open Expo Go.**
2. **Scan the QR code** shown in PowerShell — use the scanner inside Expo Go, not your
   camera app.
3. **Wait** for the bundle to build. The first load takes 30–90 seconds and the progress
   percentage may pause — that is normal.
4. You should see the **default Expo app**: a tabbed screen with a "Welcome!" heading, a
   waving hand, and Home / Explore tabs.
5. **Tell me whether it opened**, and send a screenshot or the exact error text.

**Leave PowerShell running** while you test. `Ctrl+C` stops the server.

---

## Network troubleshooting — in order, do not skip ahead

**Try the standard connection first.** Only escalate if it fails.

### If the QR scan does nothing, or it hangs on "Downloading JavaScript bundle"

**1. Confirm both devices are on the same network.** Phone Wi-Fi and PC Wi-Fi must be the
same network name. A PC on Ethernet and a phone on Wi-Fi often cannot reach each other. Mobile
data on the phone will definitely not work — turn it off and use Wi-Fi.

**2. Send me both error messages** — what PowerShell says *and* what the phone says. They are
usually different, and the phone's message is normally the more useful one.

**3. Only then, try tunnel mode:**
```powershell
npx expo start --tunnel
```
This routes through Expo's servers, so it works even when the local network blocks
device-to-device traffic. It is slower. If the first run asks to install `@expo/ngrok`,
answer yes.

**4. Windows Firewall** is the usual culprit if the standard connection fails but tunnel
works. We will address it after we know that is the cause.

### What we will NOT do at this stage
- ❌ Delete and recreate the project — we diagnose the project that exists
- ❌ Change SDK version — not without a specific error that points at the SDK
- ❌ Install Android Studio — not part of Phase 1A
- ❌ Run `expo prebuild` or create a development build

---

## Step 6 — Git (only after the app opens, and only with your approval)

There is currently **no Git repository anywhere** in or above the project. Once you confirm
the blank app runs, I will propose initialising **one repository at the project root**
(`D:\MyApps\friday-amanah`), covering docs, brand assets, and `mobile\` together — **not** a
second repository inside `mobile\`. Nested repositories cause real problems later.

The generated `mobile\.gitignore` already excludes `node_modules`. The root `.gitignore` will
also need to exclude backup files and any future `.env`.

**Nothing Git-related happens until you say so.**

---

## Phase 1A exit criteria

- [ ] Node, npm, and Git all report a version
- [ ] Node is an LTS release (20.x or 22.x)
- [ ] `mobile\` did not previously exist
- [ ] Expo Go installed, and its supported SDK range confirmed to include 54
- [ ] Project created with the pinned SDK 54 template
- [ ] `package.json` read and verified against the baseline — **not assumed**
- [ ] All six expected files/folders present
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` — no errors
- [ ] `npm ls --depth=0` — no unmet or invalid dependencies
- [ ] `npx expo-doctor` — passed, with any notes recorded
- [ ] **Default Expo app opens on the physical Android phone through Expo Go**
- [ ] Docs and brand assets confirmed untouched
- [ ] `docs/handoffs/phase-1a.md` written with the real command output pasted in

Only then does Phase 1B begin.
