# 17 — Brand Assets, Integration Map, and Product Metadata

New document · 5 August 2026. Written after inspecting the supplied brand package.

---

## 1. Discovered asset folder

**Exact path**

```
D:\MyApps\friday-amanah\Friday_Amanah_Brand_Assets\
```

The project folder itself was renamed from `friday-mizan` to `friday-amanah` as part of this
correction pass. The brand package was supplied inside it and has not been moved or altered.

**Structure:** 6 folders, 55 files, all raster PNG/ICO plus one CSS, one JSON, one
webmanifest, one README.

---

## 2. Complete inventory (dimensions verified by reading each file)

### `01_Logos/` — 10 files
| File | Dimensions | Background | Role |
|---|---|---|---|
| `Friday_Amanah_Primary_Transparent_4K.png` | 4096×1959 | transparent | **Primary logo** |
| `Friday_Amanah_Primary_White_BG_4K.png` | 4096×1980 | white | Primary on white |
| `Friday_Amanah_Horizontal_Transparent_3K.png` | 3072×1114 | transparent | **Horizontal logo** |
| `Friday_Amanah_Horizontal_White_BG_3K.png` | 3072×1344 | white | Horizontal on white |
| `Friday_Amanah_Stacked_Transparent_2K.png` | 2048×2405 | transparent | **Stacked logo** |
| `Friday_Amanah_Stacked_White_BG_2K.png` | 2048×2108 | white | Stacked on white |
| `Friday_Amanah_Compact_Transparent_2K.png` | 2048×1239 | transparent | Compact lockup |
| `Friday_Amanah_Compact_White_BG_2K.png` | 2048×1382 | white | Compact on white |
| `Friday_Amanah_Icon_Only_Transparent_4K.png` | 4096×4096 | transparent | **Transparent icon-only mark** |
| `Friday_Amanah_Dark_Brand_Banner_4K.png` | 4096×859 | navy | Banner / hero |

### `02_App_Icons/Dark/` — 11 files
`.ico` plus PNG at 16, 32, 48, 64, 96, 128, 180, 192, 256, 512, 1024.
Verified: **full-bleed, square corners, fully opaque, background `#0A1D37` Midnight Navy**,
alpha channel present but unused.
→ **Dark app icon.**

### `02_App_Icons/Light/` — 11 files
Same size ladder. Verified: full-bleed, square corners, fully opaque, background `#FFFFFF`.
→ **Light app icon.**

### `03_Web_Icons/` — 9 files
| File | Dimensions | Role |
|---|---|---|
| `favicon.ico` | multi-size | **Favicon** |
| `favicon-16x16.png` / `-32x32` / `-48x48` | as named | Favicon PNGs |
| `apple-touch-icon-180x180.png` | 180×180 | **iOS web clip** |
| `android-chrome-192x192.png` | 192×192 | **Android web icon** |
| `android-chrome-512x512.png` | 512×512 | Android web icon |
| `pwa-icon-1024x1024.png` | 1024×1024 | **PWA icon** |
| `site.webmanifest` | — | **PWA manifest** — already contains `"name": "Friday Amanah"`, `"short_name": "Amanah"`, `theme_color #0A1D37`, `background_color #F8FAFC` |

### `04_Icon_Variations/` — 5 files, all 2048×2048
Icon on Navy · Emerald · Mint · White · Black backgrounds.
→ Use these when the mark must sit on a busy or photographic background.

### `05_Brand_References/` — 5 files
| File | Role |
|---|---|
| `Friday_Amanah_Color_Palette.json` | **JSON design tokens** — 8 colours |
| `Friday_Amanah_Color_Palette.css` | **CSS design tokens** — `--friday-amanah-*` variables |
| `Friday_Amanah_Complete_Brand_Board.png` (1536×1024) | Full brand board |
| `Friday_Amanah_Color_Palette_Reference_3K.png` (3072×1076) | Palette reference |
| `Friday_Amanah_Background_Variations_3K.png` (3072×754) | Background variations |
| `Friday_Amanah_Feature_Strip_4K.png` (4096×291) | Feature strip — **see §5 warning** |

### Root
`README.md` · `Friday_Amanah_Assets_Preview.png` (1800×1500)

---

## 3. Asset role mapping — the founder's checklist, answered

| Required asset | Supplied file | Status |
|---|---|---|
| Primary logo | `01_Logos/Friday_Amanah_Primary_Transparent_4K.png` | ✅ |
| Horizontal logo | `01_Logos/Friday_Amanah_Horizontal_Transparent_3K.png` | ✅ |
| Stacked logo | `01_Logos/Friday_Amanah_Stacked_Transparent_2K.png` | ✅ |
| Transparent logo | `01_Logos/Friday_Amanah_Icon_Only_Transparent_4K.png` | ✅ |
| Dark app icon | `02_App_Icons/Dark/Friday_Amanah_Dark_1024x1024.png` | ✅ |
| Light app icon | `02_App_Icons/Light/Friday_Amanah_Light_1024x1024.png` | ✅ |
| Android icon | `03_Web_Icons/android-chrome-512x512.png` + dark 1024 | ⚠️ see §5.2 |
| iOS icon | `02_App_Icons/Dark/Friday_Amanah_Dark_1024x1024.png` | ⚠️ see §5.3 |
| PWA icon | `03_Web_Icons/pwa-icon-1024x1024.png` | ✅ |
| Favicon | `03_Web_Icons/favicon.ico` + 16/32/48 PNG | ✅ |
| Splash branding | *derive from* `Stacked_Transparent_2K` or `Icon_Only_Transparent_4K` | ⚠️ see §5.1 |
| Colour palette | `05_Brand_References/Friday_Amanah_Color_Palette.json` | ✅ |
| CSS / JSON tokens | `.css` and `.json` in `05_Brand_References/` | ✅ |

---

## 4. Brand asset integration map

Assets are copied into `assets/brand/` at Phase 1 with the filenames below. **Originals are
never modified in place.**

| Surface | Source asset | Target | Notes |
|---|---|---|---|
| **Expo app icon** (`icon`) | `Dark/Friday_Amanah_Dark_1024x1024.png` | `assets/brand/icon.png` | 1024×1024, opaque, alpha stripped |
| **Android adaptive foreground** | `Icon_Only_Transparent_4K.png` | `assets/brand/adaptive-icon.png` | ⚠️ Needs recomposition — §5.2 |
| **Android adaptive background** | — | colour value | `#0A1D37` Midnight Navy |
| **Android monochrome icon** | — | — | ❌ Missing — §5.4 |
| **Android notification icon** | — | — | ❌ Missing — §5.5 |
| **iOS app icon** | `Dark/Friday_Amanah_Dark_1024x1024.png` | `assets/brand/icon-ios.png` | Alpha channel must be stripped — §5.3 |
| **Splash logo** | `Stacked_Transparent_2K.png` | `assets/brand/splash-logo.png` | Centred, width 60% of screen, `resizeMode: contain` |
| **Splash background** | — | colour value | Light `#F8FAFC` · Dark `#0A1D37` |
| **In-app header** | `Icon_Only_Transparent_4K.png` | `assets/brand/mark.png` | Icon only at 28 px. **Never the wordmark** |
| **Onboarding screens** | `Primary_Transparent_4K.png` | `assets/brand/logo-primary.png` | Full lockup, one screen only, ≥ 25% clear space |
| **About screen** | `Horizontal_Transparent_3K.png` | `assets/brand/logo-horizontal.png` | With version and ecosystem note |
| **Exported PDF reports** | `Horizontal_Transparent_3K.png` | embedded base64 | Header left; Trust Gold rule beneath; footer carries the Zakat disclaimer |
| **Favicon** | `03_Web_Icons/favicon.ico` + PNGs | `assets/brand/web/` | For any future web surface |
| **PWA manifest** | `03_Web_Icons/site.webmanifest` | reuse as-is | Already correct |
| **Social preview** | `Dark_Brand_Banner_4K.png` | needs a 1200×630 crop | ⚠️ §5.6 |
| **Light mode** | Light icon set · `#F8FAFC` background · logo as supplied | | |
| **Dark mode** | Dark icon set · `#0A1D37` background · transparent logo on navy | | |

### Safe-spacing enforcement
The `BrandMark` component (doc 09 §6) is the only component permitted to render the logo. It
applies ≥ 25% clear space and the minimum sizes in code, so the rules cannot be broken by a
careless layout. Shield, keyhole, and F are never cropped because the component only ever
scales the whole asset with `resizeMode: contain`.

---

## 5. Missing or unsuitable assets — reported, not invented

**Nothing below has been created, redrawn, or substituted. Each item needs your decision.**

### 5.1 Splash-screen asset — *derivable, needs approval of method*
No dedicated splash asset exists. Expo needs a centred PNG on a solid background.
**Proposed method (no redrawing):** take `Stacked_Transparent_2K.png` unmodified, place it
centred on a `#F8FAFC` (light) or `#0A1D37` (dark) canvas at 60% width, `resizeMode: contain`.
This is pure placement — the artwork is untouched. **Approve or supply a splash asset.**

### 5.2 Android adaptive icon foreground — *needs recomposition, needs approval*
Android requires a **transparent square** foreground where the artwork occupies only the
central ~66% safe zone; the outer ring is cropped by the launcher's mask.

Measured from `Icon_Only_Transparent_4K.png`: the mark's actual bounding box is
**2514 × 3261** within the 4096×4096 canvas — a portrait shield, not square, and offset
90 px left of centre. Used as-is, **the launcher would crop the shield and possibly the
keyhole.**

**Proposed method (no redrawing):** scale the existing bounding box to 0.207 of a fresh
1024×1024 transparent canvas and centre it exactly, giving a 676 px-tall mark inside the
safe zone. Again, pure scale and placement. **Approve, or supply a purpose-made adaptive
foreground.**

### 5.3 iOS icon alpha channel — *must be fixed before App Store submission*
Both 1024×1024 icons are fully opaque but **still carry an alpha channel**. App Store
Connect rejects icons containing an alpha channel. Fix: strip the channel (`RGBA → RGB`)
during the Phase 1 asset copy. No visual change. Recording it here so it is not discovered
during a release.

### 5.4 Android monochrome icon — ❌ **missing**
Android 13+ themed icons need a single-colour silhouette on transparent, 1024×1024.
Cannot be derived automatically without flattening the gradient and losing the keyhole.
**Request: a monochrome (white-on-transparent) silhouette version of the shield mark.**
Not blocking — Android falls back to the standard icon.

### 5.5 Android notification icon — ❌ **missing**
Android requires a **pure white silhouette on transparent**, 96×96, for the status bar.
Anything else renders as a white blob. Needed from Phase 3 (reminders).
**Request: a 96×96 white-silhouette notification icon.**

### 5.6 Social preview at 1200×630 — ⚠️ **wrong aspect ratio**
`Dark_Brand_Banner_4K.png` is 4096×859 (4.77:1) and `Feature_Strip_4K.png` is 4096×291
(14:1). Open Graph wants 1.91:1. Cropping the banner would clip the lockup.
**Request: a 1200×630 social preview, or approval to letterbox the banner on navy.**

### 5.7 No vector artwork — ❌ **acknowledged in the supplied README**
The package is high-resolution raster only. This is fine for the app: 4096 px sources
downscale cleanly to every icon size needed. It is **not** sufficient for large-format print
or a trademark master file. The supplied README already recommends a designer redraw the mark
in a vector editor. **No action needed for the MVP.** Recorded so it is not forgotten.

### 5.8 Cloud White label discrepancy — minor
The brand board artwork labels Cloud White as **`#FBFAFC`**, while `Color_Palette.json`,
`Color_Palette.css`, the package README, and your confirmation all say **`#F8FAFC`**.
**Resolved as `#F8FAFC`** — three machine-readable sources plus your explicit confirmation
outweigh one label rendered in an image. Flagging it so the board can be corrected later.

### 5.9 ⚠️ **Feature strip contains a security claim we have agreed not to make**
`Friday_Amanah_Feature_Strip_4K.png` and the same strip on the brand board read:

> **SECURE** — "Your data is encrypted and always protected."

This directly contradicts the security-language correction in doc 06 §0 and doc 18. Until
Phase 7 the database is **not** encrypted, and this sentence would be inaccurate in a store
listing, on a website, or in onboarding.

**Recommended replacement, accurate today:**
> **SECURE** — "Your data stays on your device, protected by PIN and biometric lock."

**Action required:** do not publish this asset until the strip is re-exported with corrected
copy. The strip is a marketing asset only — it is not used inside the app, so it does not
block Phase 1.

---

## 6. Product metadata recommendations

**All technical identifiers below are [RECOMMENDED] and require your explicit approval.**
Bundle identifiers and application IDs are effectively permanent once an app is published —
changing them later means a new store listing and losing every existing install. None will
be written into a config file until you confirm.

| Item | Recommendation | Notes |
|---|---|---|
| App display name | **Friday Amanah** | Confirmed |
| Short name (launcher) | **Amanah** | Matches the supplied `site.webmanifest`. Full name truncates under most launcher icons |
| Tagline | **Manage Wealth with Purpose.** | Confirmed |
| Project slug | `friday-amanah` | Expo `slug`; already the folder name |
| Internal / URL-safe name | `friday-amanah` | lowercase, hyphenated, no spaces |
| Repository name | `friday-amanah` | |
| Deep-link scheme | `fridayamanah://` | **[RECOMMENDED]** Schemes must be lowercase alphanumeric — hyphens are unreliable on iOS. `amanah://` is shorter but far more likely to collide with another app |
| Android application ID | `org.royalopencollege.fridayamanah` | **[RECOMMENDED — needs approval]** Derived from your `royalopencollege.org` domain, which is the correct reverse-DNS practice. Alternative if the ecosystem gets its own domain: `com.fridayapps.amanah`. **Permanent once published** |
| iOS bundle identifier | `org.royalopencollege.fridayamanah` | **[RECOMMENDED — needs approval]** Keep identical to Android for simplicity. **Permanent once published** |
| Database filename | `friday_amanah.db` | Snake case; SQLite convention; no spaces |
| Backup filename prefix | `friday-amanah-backup-` | Full pattern: `friday-amanah-backup-2026-08-05-1423.fmz` |
| Backup file extension | `.fmz` | Kept from revision 1 — "Friday amanah Zipped/encrypted". Distinctive, unclaimed, and signals "not a normal file" |
| Export filename prefix | `friday-amanah-export-` | e.g. `friday-amanah-export-transactions-2026-08-05.csv` |
| Zakat report prefix | `friday-amanah-zakat-` | e.g. `friday-amanah-zakat-1448-report.pdf` |
| Env var convention | `EXPO_PUBLIC_AMANAH_*` for anything bundled into the app; `AMANAH_*` for build-time only | Expo requires the `EXPO_PUBLIC_` prefix for runtime values. **Nothing secret is ever `EXPO_PUBLIC_`** — anything with that prefix is readable in the shipped bundle |
| SecureStore key prefix | `amanah.` | e.g. `amanah.pin.hash`, `amanah.pin.salt`, `amanah.device.id` |
| Settings table key prefix | none | Keys are already scoped by the table |
| Notification channel ID | `amanah-reminders` | Android channel |
| PDF document title | `Friday Amanah — <report name>` | |
| Zakat methodology version | `fa-zakat-1.0.0` | **Changed** from `fa-zakat-1.0.0`. No snapshots exist yet, so no migration is needed |

### Identifier rules applied
No spaces · no uppercase in slugs, schemes, or IDs · no underscores in bundle IDs (invalid
on iOS) · no reserved words · ASCII only · reverse-DNS for application IDs.

### The two decisions I need from you
1. **Do you own or control `royalopencollege.org`** and are you happy for the bundle ID to
   sit under it? If the Friday ecosystem should have its own namespace, tell me the domain
   and I will use it instead.
2. **`fridayamanah://` or `amanah://`** for deep links? I recommend the former — collision
   risk on the latter is real.

---

## 7. Ecosystem consistency

| Product | Primary colour | Type | Relationship to Friday Amanah |
|---|---|---|---|
| Friday (parent) | Navy `#0D1B2A`, emerald `#10B981` | Poppins → Inter | Same navy-and-emerald DNA; Amanah's `#0A1D37` and `#10A981` are the sibling values |
| Friday Task | Own asset pack | Poppins | Same F mark, same lockup grammar |
| Friday Note | Own asset pack | Poppins | Same |
| **Friday Amanah** | Navy `#0A1D37`, emerald `#087A62`/`#10A981`, gold `#D2A74B` | **Poppins + Inter dual system** | Adds the shield, keyhole, and Trust Gold as its own security identity |

Friday Amanah is recognisably part of the family through the F, the navy, and the emerald.
It distinguishes itself through the shield and the gold keyhole — which is exactly right for
the one product in the ecosystem that holds financial data.
