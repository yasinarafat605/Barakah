# Phase 1A Handoff — Environment Verification and Blank App Launch

**Status: IN PROGRESS.** Everything below was actually executed on the founder's Windows
machine and the output pasted verbatim. The final item — the app opening on a device — is
**not yet verified**.

Date: 5 August 2026
Project: `D:\MyApps\friday-amanah`
App: `D:\MyApps\friday-amanah\mobile`

---

## 1. Environment (Step 1) ✅

```
PS D:\MyApps\friday-amanah> node --version
v24.18.0
PS D:\MyApps\friday-amanah> npm --version
11.16.0
PS D:\MyApps\friday-amanah> git --version
git version 2.55.0.windows.3
PS D:\MyApps\friday-amanah> Test-Path D:\MyApps\friday-amanah\mobile
False
```

| Check | Result | Verdict |
|---|---|---|
| Node | v24.18.0 | ✅ Even-numbered LTS. Satisfies `react-native@0.81.5` engines `>= 20.19.4` and `@expo/metro ~54.2.0` |
| npm | 11.16.0 | ✅ |
| Git | 2.55.0.windows.3 | ✅ Available, but **no repository initialised anywhere** — deliberate, per founder instruction |
| `mobile\` | `False` | ✅ Did not previously exist |

**Correction recorded:** doc 15A originally stated Node 20.x or 22.x. That was incomplete —
Node 24 is a valid even-numbered LTS line and meets every engines requirement in the tree.
Corrected in doc 15A Step 1.

---

## 2. Project creation (Step 2) ✅

```powershell
cd D:\MyApps\friday-amanah
npx create-expo-app@latest mobile --template expo-template-default@54.0.62
```

Created without error. `docs\` and `Friday_Amanah_Brand_Assets\` untouched.

---

## 3. Generated project verification (Step 3) ✅

`package.json` was **read in full and compared field by field** against the published
`expo-template-default@54.0.62` tarball. Not assumed.

| Field | Template baseline | Generated | Match |
|---|---|---|---|
| `main` | `expo-router/entry` | `expo-router/entry` | ✅ |
| `expo` | `~54.0.35` | `~54.0.35` | ✅ |
| `react-native` | `0.81.5` | `0.81.5` | ✅ |
| `react` | `19.1.0` | `19.1.0` | ✅ |
| `expo-router` | `~6.0.24` | `~6.0.24` | ✅ |
| `typescript` | `~5.9.2` | `~5.9.2` | ✅ |
| `eslint` | `^9.25.0` | `^9.25.0` | ✅ |
| `eslint-config-expo` | `~10.0.0` | `~10.0.0` | ✅ |
| scripts | start · android · ios · web · lint · reset-project | identical | ✅ |

**SDK 54 confirmed.** Expo Router and TypeScript both present in the default template.
**No `test` or `typecheck` script exists** — so neither was invented or run.

---

## 4. Checks (Step 4)

### `npm ls --depth=0` ✅

```
mobile@1.0.0 D:\MyApps\friday-amanah\mobile
+-- @expo/vector-icons@15.1.1
+-- @react-navigation/bottom-tabs@7.18.14
+-- @react-navigation/elements@2.9.36
+-- @react-navigation/native@7.3.14
+-- @types/react@19.1.17
+-- eslint-config-expo@10.0.0
+-- eslint@9.39.5
+-- expo-constants@18.0.13
+-- expo-font@14.0.12
+-- expo-haptics@15.0.8
+-- expo-image@3.0.11
+-- expo-linking@8.0.12
+-- expo-router@6.0.24
+-- expo-splash-screen@31.0.13
+-- expo-status-bar@3.0.9
+-- expo-symbols@1.0.8
+-- expo-system-ui@6.0.9
+-- expo-web-browser@15.0.11
+-- expo@54.0.36
+-- react-dom@19.1.0
+-- react-native-gesture-handler@2.28.0
+-- react-native-reanimated@4.1.7
+-- react-native-safe-area-context@5.6.2
+-- react-native-screens@4.16.0
+-- react-native-web@0.21.2
+-- react-native-worklets@0.5.1
+-- react-native@0.81.5
+-- react@19.1.0
`-- typescript@5.9.3
```

29 top-level packages. **No `UNMET DEPENDENCY`, no `invalid`, no missing peers.**
Installed patch versions sit above the template's declared minimums but inside their `~`/`^`
ranges (`expo` 54.0.35→54.0.36, `typescript` 5.9.2→5.9.3, `reanimated` 4.1.1→4.1.7). Normal
and expected.

### `npx expo-doctor` ✅

```
18/18 checks passed. No issues detected!
```

### `npx tsc --noEmit` ✅

```
PS D:\MyApps\friday-amanah\mobile> npx tsc --noEmit
PS D:\MyApps\friday-amanah\mobile>
```

No output. TypeScript compiled the project with zero errors under the template's
`tsconfig.json` (which extends `expo/tsconfig.base` with `strict: true`).

### `npm run lint` ✅

```
PS D:\MyApps\friday-amanah\mobile> npm run lint

> mobile@1.0.0 lint
> expo lint

PS D:\MyApps\friday-amanah\mobile>
```

No errors and no warnings reported by `eslint-config-expo`.

**Note on the earlier failure:** the first attempt at both commands ran from the project root
and failed with directory errors, not code errors — `This is not the tsc command you are
looking for`, `Could not read package.json`, `-- (empty)`, and an expo-doctor install prompt.
Four different-looking messages, one cause. Nothing was broken and no rebuild was performed.
Doc 15A Step 4 now carries a directory warning.

**Diagnosed root-directory error (resolved):** four commands failed with four
different-looking errors — `This is not the tsc command you are looking for`,
`Could not read package.json`, `-- (empty)`, and an expo-doctor install prompt — all caused
by running from `D:\MyApps\friday-amanah` instead of `D:\MyApps\friday-amanah\mobile`.
Nothing was broken; no rebuild was performed. Doc 15A Step 4 now carries a directory warning.

---

## 5. Device launch (Step 5) — ✅ EMULATOR PASSED · ⏳ PHYSICAL DEVICE PENDING

```
> Metro waiting on exp://192.168.0.101:8081
> Using Expo Go
> Opening on Android...
Failed to resolve the Android SDK path. Default install location not found.
Error: 'adb' is not recognized as an internal or external command
Android Bundled 35882ms node_modules\expo-router\entry.js (1455 modules)
```

**Result: the default Expo app rendered successfully.** "Welcome!" heading, wave animation,
Home and Explore tabs both present.

**Environment: BlueStacks App Player 6.22.150.1014, Android 9 (Pie), x86_64.**
Not the Android Studio emulator.

### ✅ Open question resolved
**The installed Expo Go supports SDK 54.** The ADR-020 compatibility risk is closed —
verified empirically rather than from documentation.

### ⚠️ `adb` not found — cosmetic, not a fault
Pressing `a` could not auto-launch because Android SDK platform-tools are not installed, so
`adb` is not on PATH. The connection was made manually through Expo Go instead and worked
correctly. **This does not affect the app, the bundle, or the project.** It only means the
`a` shortcut is unavailable. Installing platform-tools is optional and deferred.

### ⚠️ BlueStacks is not a substitute for a physical device
Recorded so it is not forgotten later. BlueStacks is an app player, not a development
emulator, and differs from a real phone in ways that matter to this project specifically:

| Area | Risk on BlueStacks |
|---|---|
| **Bangla rendering** | Different font stack and text shaping. Conjunct rendering (doc 09 §4.2) **cannot be validated here** |
| **Biometrics** | No fingerprint hardware — Phase 7 `expo-local-authentication` work is untestable |
| **Keystore / SecureStore** | Hardware-backed key storage is absent or emulated; Phase 7 PIN storage behaviour will differ |
| **Architecture** | x86_64, not ARM |
| **Android version** | 9 (API 28) — older than most current phones |
| **Performance** | Timings are meaningless against doc 04 §9 targets |
| **Touch targets / density** | Not representative of a real screen |

**Decision:** BlueStacks is acceptable for fast iteration during Phases 1B–6. **The physical
Android phone remains the reference device**, and every phase exit criterion that mentions
"a real device" means the phone, not BlueStacks.

---

## 6. Scope discipline ✅

No Friday Amanah feature implementation has begun. No branding, navigation design, database,
localisation, theme, state management, forms, fonts, or testing libraries installed. No
`expo prebuild`, no `android/` or `ios/` directories, no development build. Brand assets
untouched. The inaccurate brand feature strip has not been used.

---

## 7. Remaining before Phase 1A sign-off

- [ ] `npx tsc --noEmit` output recorded from `mobile\`
- [ ] `npm run lint` output recorded from `mobile\`
- [ ] Default Expo app confirmed opening on the emulator
- [ ] Same confirmed on the physical Android phone
- [ ] Founder approval to initialise Git at the project root
