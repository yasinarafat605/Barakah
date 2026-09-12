# 09 — Design System and Brand Direction

> **Revision 2 · 5 August 2026.** Rewritten after the approved Friday Amanah brand asset
> package was supplied. The previous "Balanced F" logo concept and the unapproved `#0E9F6E`
> accent have been **removed entirely**. The supplied assets are the visual source of truth.

**Source of truth:** `D:\MyApps\friday-amanah\Friday_Amanah_Brand_Assets\`
Full inventory and integration map: **[doc 17](17-brand-assets-and-metadata.md)**.

---

## 1. Product identity

| | |
|---|---|
| Product name | **Friday Amanah** |
| Tagline | **Manage Wealth with Purpose.** |
| Ecosystem | Friday, by Yasin Arafat |
| Sibling products | Friday, Friday Task, Friday Note, Friday Flow, Friday Live |
| Personality | Trustworthy · Calm · Protective · Purposeful · Premium · Discreet |

**"Amanah"** means a trust — something held on behalf of another, to be safeguarded and
returned intact. It is the right concept for this product: the app holds the user's
financial life, and the user holds their wealth as a responsibility. The name sets the
security and stewardship posture that the rest of this document implements.

---

## 2. The approved logo — do not recreate

The supplied mark, as verified by inspecting the brand board:

- A **shield** in an emerald gradient, deep emerald at the base rising to fresh mint
- The Friday ecosystem **F**, formed by two flowing leaf-like strokes across the shield's
  upper face, separated by a white counter-stroke
- A **gold keyhole** centred low on the shield
- Wordmark: **Friday** in Midnight Navy, **Amanah** in emerald, tagline beneath a short
  emerald rule

Meaning: Amanah · trust · security · responsible wealth management · privacy · purposeful
growth.

### Rules

1. **Never redraw, reinterpret, recolour, rotate, stretch, or add effects to the mark.**
2. **Never generate a replacement logo.** The "Balanced F" concept from revision 1 is void.
3. Never add crescents, domes, minarets, coins, currency symbols, scales, graphs, or any
   other finance or religious symbol to the mark or beside it.
4. Never crop the shield, the keyhole, or the F.
5. Clear space on all sides ≥ **25% of the shield's height**. Nothing may enter it.
6. Minimum sizes: icon-only **24 px** · horizontal lockup **120 px** wide · stacked lockup
   **96 px** wide. Below a lockup minimum, use icon-only.
7. **Never place the full wordmark inside a small navigation icon, tab bar, or button.**
   Small UI locations use the icon-only asset.
8. On photography or busy backgrounds, use the icon on one of the five approved solid
   background variations rather than placing the transparent mark directly.

### Approved lockups

| Lockup | Asset (verified dimensions) | Use |
|---|---|---|
| Primary | `01_Logos/Friday_Amanah_Primary_Transparent_4K.png` — 4096×1959 | Onboarding, About, PDF report cover |
| Horizontal | `01_Logos/Friday_Amanah_Horizontal_Transparent_3K.png` — 3072×1114 | Headers, documents, email |
| Stacked | `01_Logos/Friday_Amanah_Stacked_Transparent_2K.png` — 2048×2405 | Square layouts, splash |
| Compact | `01_Logos/Friday_Amanah_Compact_Transparent_2K.png` — 2048×1239 | Tight horizontal space |
| Icon only | `01_Logos/Friday_Amanah_Icon_Only_Transparent_4K.png` — 4096×4096 | In-app header, watermark, small UI |

---

## 3. Brand colour palette — approved, verbatim

The eight approved brand colours, taken from
`05_Brand_References/Friday_Amanah_Color_Palette.json` and matching the founder's
confirmation exactly. **They are not to be altered.**

```css
--amanah-midnight-navy : #0A1D37   /* ecosystem identity, dark surfaces, headings  */
--amanah-deep-emerald  : #087A62   /* primary emerald, actions on light surfaces   */
--amanah-emerald-green : #10A981   /* brand emerald, fills, dark-mode actions      */
--amanah-fresh-mint    : #38D3A5   /* highlights, dark-mode accents                */
--amanah-trust-gold    : #D2A74B   /* LIMITED accent only — see §3.3               */
--amanah-mint-white    : #EAF8F3   /* tinted surfaces, subtle positive backgrounds */
--amanah-cloud-white   : #F8FAFC   /* app background                               */
--amanah-charcoal-text : #1F2937   /* body text                                    */
--amanah-white         : #FFFFFF   /* cards, sheets, inputs                        */
```

`#0E9F6E` from revision 1 is **deleted** and appears nowhere in this project.

### 3.1 Measured accessibility — why semantic tokens exist

I computed WCAG contrast ratios for every brand colour against every surface. The results
determine how each colour may be used. This is measurement, not preference:

| Pair | Ratio | Verdict |
|---|---|---|
| Midnight Navy on Cloud White | **16.14** | AAA — headings, primary text |
| Charcoal Text on Cloud White | **14.03** | AAA — body text |
| **Deep Emerald** on Cloud White | **5.06** | **AA — safe for text and icons** |
| White text on **Deep Emerald** | **5.29** | **AA — safe for primary buttons** |
| Emerald Green on Cloud White | 2.86 | ✗ fails for text |
| White text on Emerald Green | 2.99 | ✗ fails for buttons |
| Trust Gold on Cloud White | 2.14 | ✗ fails for text |
| Fresh Mint on Cloud White | 1.82 | ✗ fails for text |
| *— on dark surfaces —* | | |
| Fresh Mint on Midnight Navy | **8.87** | AAA |
| Trust Gold on Midnight Navy | **7.53** | AAA |
| Emerald Green on Midnight Navy | **5.64** | AA |
| Deep Emerald on Midnight Navy | 3.19 | large text / UI only |

**The palette resolves its own accessibility problem, so nothing needed inventing.** Deep
Emerald is the accessible action colour on light surfaces; Emerald Green and Fresh Mint are
the accessible accents on dark surfaces. Every approved colour is used; none is altered.

### 3.2 Semantic tokens

The interface never references a brand colour directly. It references a semantic token that
resolves to an approved brand colour per theme. This is what keeps the palette intact while
satisfying accessibility.

**Light theme**
```
--surface              #FFFFFF   cards, sheets, inputs
--surface-sunken       #F8FAFC   Cloud White — app background
--surface-tinted       #EAF8F3   Mint White — subtle positive panels
--surface-inverse      #0A1D37   Midnight Navy — headers, dark cards

--text-primary         #0A1D37   Midnight Navy      16.14 : 1
--text-body            #1F2937   Charcoal Text      14.03 : 1
--text-secondary       #52606D   Charcoal tint       7.2  : 1   (derived)
--text-tertiary        #8A94A0   Charcoal tint       3.4  : 1   (non-essential only)
--text-on-emerald      #FFFFFF                       5.29 : 1
--text-on-navy         #F8FAFC                      16.14 : 1

--action-primary       #087A62   Deep Emerald — buttons, links, focus ring
--action-primary-press #06614E   Deep Emerald −12%              (derived state)
--brand-fill           #10A981   Emerald Green — large fills, charts, illustration
--accent-highlight     #38D3A5   Fresh Mint — progress fills, chart series
--accent-gold          #D2A74B   Trust Gold — see §3.3

--border               #DCE3EA   Cloud White shaded             (derived)
--border-strong        #B6C1CC                                  (derived)
```

**Dark theme**
```
--surface              #0A1D37   Midnight Navy
--surface-sunken       #06121F   Navy −40%                      (derived)
--surface-raised       #122C4E   Navy +12%                      (derived)
--surface-tinted       #0C2A24   Deep Emerald @18% over navy    (derived)

--text-primary         #F8FAFC   Cloud White        16.14 : 1
--text-body            #EAF8F3   Mint White         15.45 : 1
--text-secondary       #9FB0C0                       7.1  : 1   (derived)

--action-primary       #10A981   Emerald Green       5.64 : 1
--brand-fill           #087A62   Deep Emerald — large fills only
--accent-highlight     #38D3A5   Fresh Mint          8.87 : 1
--accent-gold          #D2A74B   Trust Gold          7.53 : 1
```

**Derived values** are mathematical tints, shades, or opacities of approved brand colours,
produced by a documented function in `src/theme/derive.ts`. They are not new brand colours
and never appear in brand materials — they exist only so borders and pressed states are not
invented by hand. Every derived value is listed above with its origin.

### 3.3 Trust Gold rule [DECIDED]

Gold appears in the logo's keyhole. In the interface it is a **limited accent**, never a
dominant surface and never body text.

**Permitted:** the Zakat Center's section marker · a savings-goal completion marker · a thin
divider or rule on navy · an icon accent on dark surfaces · the PDF report header rule.

**Forbidden:** page or card backgrounds · body or label text · button fills · large area
fills · anything on a light surface, where it measures 2.14 : 1 and is unreadable.

### 3.4 Financial direction colours

| Meaning | Light | Dark | Ratio (light) |
|---|---|---|---|
| Money in | `#087A62` Deep Emerald | `#38D3A5` Fresh Mint | 5.06 AA |
| Money out | `#8A5A1E` gold-family brown *(Trust Gold darkened for legibility)* | `#D2A74B` Trust Gold | 5.9 AA |
| Transfer / neutral | `#52606D` | `#9FB0C0` | 7.2 AAA |
| Destructive only | `#B42318` | `#F97066` | 6.1 AA |

**Expenses are not red.** Red means error or danger; buying groceries is neither. Colouring
a person's whole month red is a quiet form of shaming, and this product does not do that.
The outgoing colour comes from the Trust Gold family, darkened until it is readable, so it
stays inside the brand. Red is reserved exclusively for destructive actions.

Direction is **always** also carried by an icon and a sign, never by colour alone.

---

## 4. Typography — dual-font system [DECIDED]

Revision 1 incorrectly stated that Inter replaces Poppins. **It does not.** The Friday
ecosystem uses Poppins prominently in branding, and Friday Amanah keeps it. The two families
have separate, documented jobs.

### 4.1 Roles

| Family | Role | Where |
|---|---|---|
| **Poppins** | Brand voice and display | Wordmark-adjacent presentation, splash, onboarding headlines, screen titles (h1/h2), empty-state headlines, marketing, store listings, PDF report cover |
| **Inter** | Working text and data | All amounts, tables, forms, inputs, labels, lists, reports, settings, body copy, captions, error messages |
| **Noto Sans Bengali** | All Bangla text | Substituted automatically when the language is `bn`, in both roles |

**Why the split.** Poppins is geometric and carries the ecosystem's identity, which is
exactly what a title and a splash screen need. But it has a single-storey `a`, comparatively
narrow figures, and no true tabular-figure feature — so columns of money misalign and
jitter. Inter has genuine `tnum` tabular figures and is designed for small sizes and dense
UI. Using the right family for each job beats compromising on either.

**Rule:** every monetary value renders in **Inter with `font-variant-numeric: tabular-nums`**,
without exception, in both languages.

### 4.2 Bengali typeface

**Recommendation: Noto Sans Bengali** (Google Fonts, SIL Open Font License 1.1).

| Requirement | How it is met |
|---|---|
| Renders Bangla naturally | Designed with Bengali type authorities; humanist proportions, not a Latin font stretched to fit |
| Android and iOS | Bundled locally via `@expo-google-fonts/noto-sans-bengali`, so rendering is identical on both and does not depend on the OS font — Android ships Noto, iOS ships Bangla Sangam MN, and they look noticeably different |
| Readable numbers | Bengali digits `০–৯` at consistent width, plus Latin digits for the mixed-numeral setting |
| No broken conjuncts | Full conjunct (যুক্তাক্ষর) coverage with correct GSUB shaping. React Native uses HarfBuzz on both platforms, so shaping is correct provided the font is bundled |
| Weights | 400 / 500 / 700, matching the Latin scale, so faux-bold is never synthesised |
| Licence | **SIL OFL 1.1** — free for commercial use, embeddable in an app binary, no in-app attribution required |

**Fallback chain**
```
bn:  Noto Sans Bengali (bundled) → OS Noto Sans Bengali → Bangla Sangam MN → system
en:  Inter / Poppins (bundled)   → system-ui → San Francisco (iOS) / Roboto (Android)
```
Fallbacks exist for resilience only. Because all three families are in the binary, they
should never be reached — verified in Phase 1 by rendering a conjunct test string on both
platforms.

**Alternatives considered and rejected:** *Hind Siliguri* — excellent, but its numerals sit
awkwardly beside Inter's and it has no 500 weight. *Baloo Da 2* — display-only, too informal
for financial data. *SolaimanLipi* — widely loved in Bangladesh, but licensing for commercial
app embedding is unclear; **do not use without written permission.**

### 4.3 Licensing and platform implications [DECIDED]

| Font | Licence | Commercial embedding | Approx. size |
|---|---|---|---|
| Inter | SIL OFL 1.1 | Yes, no attribution required | 4 weights ≈ 380 KB |
| Poppins | SIL OFL 1.1 | Yes, no attribution required | 2 weights ≈ 170 KB |
| Noto Sans Bengali | SIL OFL 1.1 | Yes, no attribution required | 3 weights ≈ 420 KB |

All three bundle locally through `@expo-google-fonts/*`. **No font is fetched at runtime** —
a runtime download would break the offline guarantee and produce a network request, which
contradicts doc 07. Total ≈ 970 KB, inside the 40 MB APK budget. Licence texts appear under
About → Open source licences.

### 4.4 Type scale

Base 16, scales with the OS font setting to 200%.

| Token | Family | Size / line-height | Weight | Use |
|---|---|---|---|---|
| `brandDisplay` | **Poppins** | 34 / 42 | 600 | Splash, onboarding headline |
| `h1` | **Poppins** | 28 / 36 | 600 | Screen titles |
| `h2` | **Poppins** | 22 / 30 | 600 | Section headers |
| `h3` | Inter | 18 / 26 | 600 | Card titles |
| `body` | Inter | 16 / 24 | 400 | Default |
| `bodyStrong` | Inter | 16 / 24 | 500 | List primary text |
| `caption` | Inter | 14 / 20 | 400 | Labels, metadata |
| `micro` | Inter | 12 / 16 | 500 | Badges, tags |
| `amountXl` | **Inter tabular** | 34 / 40 | 600 | The one big dashboard figure |
| `amountLg` | **Inter tabular** | 28 / 34 | 600 | Primary amounts |
| `amountMd` | **Inter tabular** | 18 / 24 | 600 | List amounts |
| `amountSm` | **Inter tabular** | 15 / 20 | 500 | Inline amounts |

**Bangla adjustment:** when the language is `bn`, line-heights are multiplied by **1.18**.
Bengali has both an ascending মাত্রা and descending conjuncts, so it needs more vertical room
than the 1.15 estimated in revision 1. Applied once, in the `Text` component.

---

## 5. Spacing, radius, elevation

Spacing (4px base): `1=4 · 2=8 · 3=12 · 4=16 · 5=20 · 6=24 · 8=32 · 10=40 · 12=48 · 16=64`.
Screen padding 16 · card padding 16 · gap between cards 12 · section gap 24.

Radius: `sm 8 · md 12 · lg 16 · xl 24 · full 999`. Cards `lg` · buttons `md` · sheets `xl`
top corners only · inputs `md`. This matches the shield's soft geometry.

Shadows (light): `sm 0 1px 2px rgba(10,29,55,.06)` · `md 0 8px 24px rgba(10,29,55,.10)` ·
`lg 0 20px 50px rgba(10,29,55,.14)`. Shadow colour derives from Midnight Navy rather than
pure black, keeping depth in the brand's colour temperature. In dark mode, elevation uses
lighter surfaces, not shadow.

Generous spacing is a brand requirement, not a preference. A cramped finance app feels
stressful, and reducing financial stress is the point of the product.

---

## 6. Core components

`Text` · `Screen` · `Card` · `Button` · `IconButton` · `Input` · `AmountInput` · `Select` ·
`DatePicker` · `Switch` · `Checkbox` · `Radio` · `SegmentedControl` · `ListItem` ·
`SectionHeader` · `Divider` · `Badge` · `ProgressBar` · `Sheet` · `Modal` · `Toast` ·
`EmptyState` · `ErrorState` · `Skeleton` · `Amount` · `CategoryChip` · `AccountChip` ·
`TabBar` · `FAB` · `ConfirmDialog` · `PinPad` · `Chart*` · `BrandMark`

### Components with special rules

**`Amount`** — the most-used component in the app. Handles minor-unit conversion, currency
symbol placement, Bengali numerals, Inter tabular figures, sign, direction colour, and
**privacy mode**. Every amount goes through it; no other component formats money.

**`AmountInput`** — numeric keypad opens focused. Right-aligned, thousand separators as you
type, currency prefix fixed, negative sign never accepted.

**`PinPad`** — targets ≥ 64×64, no digit preview, haptic feedback,
`filterTouchesWhenObscured`, never writes the entered value to shared state.

**`ProgressBar`** — always paired with a text percentage and the underlying figures. A bar
alone means nothing to a screen reader or to someone who cannot see the fill colour.

**`BrandMark`** — the only component permitted to render the logo. Takes
`variant: 'icon' | 'horizontal' | 'stacked' | 'primary'` and enforces the clear-space and
minimum-size rules from §2 in code, so they cannot be broken by accident.

---

## 7. Motion

150 ms micro · 200 ms sheet · 250 ms navigation. `ease-out` in, `ease-in` out.
`prefers-reduced-motion` honoured — transitions become instant cross-fades, looping
animation stops.

Banned: confetti, celebratory bursts, coin animations, streak flames, bouncing mascots,
anything that rewards a financial action with a dopamine cue. That pattern is how finance
apps manipulate behaviour, and Friday Amanah does not use it.

---

## 8. Accessibility requirements [DECIDED]

| Requirement | Standard |
|---|---|
| Contrast | AA minimum everywhere; AAA on amounts and Zakat figures |
| Colour usage | Governed by the measured table in §3.1 — a colour may not be used for text below 4.5 : 1 |
| Touch targets | ≥ 44×44 pt; 48×48 for primary actions and the PIN pad |
| Screen reader | Every interactive element labelled in the active language. Amounts read as "1,250 taka 75 paisa", not "1250.75" |
| Charts | Screen-reader summary plus a "view as table" toggle on every chart |
| Colour alone | Never the sole carrier of meaning — icon or text always accompanies |
| Font scaling | Functional to 200%, no clipping. `allowFontScaling` never disabled |
| Motion | `prefers-reduced-motion` honoured |
| Errors | Announced, tied to their field, plain language, with a fix |
| Language | `accessibilityLanguage` set so TalkBack uses the correct voice for Bangla |
| Headings | Correct `accessibilityRole="header"` hierarchy on every screen |

Phase 8 includes a manual TalkBack pass over the critical flows, with results recorded.

---

## 9. Privacy mode

One tap from the dashboard header and from Settings. All amounts render as `৳ ••••`; chart
axis values hidden; balances, goal figures, and debt amounts masked. Category names, dates,
and layout stay visible so the user can still navigate and record a transaction. Persists
across launches. `AmountInput` is exempt while focused.

---

## 10. Voice and tone

A calm, competent, discreet accountant who never raises their voice, never flatters, and
never lectures.

Second person, present tense · fact first, option second, then stop · no exclamation marks ·
no emoji in system copy · numbers before adjectives · never claim certainty the app does not
have.

Bangla is **written**, not translated. A Bangla speaker should not be able to tell the app
was designed in English. That requires a native writer, not a translator.

Banned in any language: *failed · overspent · you should have · bad · wasteful · you only
saved · missed · broke your streak · don't forget again.* Enforced by the `check-tone`
script (doc 12 §7).
