# 08 — Zakat Calculation Design and Safeguards

> **The governing rule of this entire document:** Friday Amanah is a calculator, not a
> scholar. It performs arithmetic on numbers the user provides, using a method the user
> selects, and it shows its work. It never rules on anything.

---

## 1. Non-negotiable safeguards

| # | Safeguard | Implementation |
|---|---|---|
| S1 | **Never called a ruling.** The word "Zakat due" never appears without "estimate". | Every string containing a Zakat figure includes `estimate`/`আনুমানিক`. Enforced by a copy review checklist. |
| S2 | **No default method.** | `zakat_nisab_basis` is NULL until the user chooses. No figure renders while it is NULL. (ADR-008) |
| S3 | **Every number is traceable.** | `breakdown_json` records each step: input → operation → intermediate → result. The UI renders it as a readable list. |
| S4 | **All parameters are data, not code.** | Nisab weights, rate, and eligibility flags live in a versioned config object, editable without touching the engine. |
| S5 | **Methodology is versioned.** | Every saved snapshot stores `methodology_version`. A later change never retroactively alters a past snapshot. |
| S6 | **Snapshots are immutable.** | No UPDATE path exists for a saved calculation. Corrections create a new one. |
| S7 | **Disclaimer is on-screen, not behind a link.** | Present on the result screen, on every snapshot, and in every export. |
| S8 | **No live prices in the MVP.** | The user enters the metal price and, optionally, where it came from. (ADR: doc 01 §4) |
| S9 | **No comparison, no ranking, no encouragement.** | No "you gave more than last year", no percentage-of-income score, no streaks, no badges. |
| S10 | **Uncertainty is shown, not hidden.** | Where scholars differ, the app says so and offers the choice rather than picking silently. |

### The standard disclaimer (every screen showing a Zakat figure)

Revised 5 August 2026 to the founder's approved wording. The previous version opened with
"This is an estimate…", which left the *source* of the estimate unnamed and could be read as
though the figure carried some authority. Naming the product as the calculating party makes
the limitation explicit: it is software performing arithmetic, not a scholar answering a
question.

**English — canonical**
> **Friday Amanah provides a configurable estimate based on the information and method
> selected by the user. It is not a Fatwa or a substitute for guidance from a qualified
> scholar.**

**Extended form** — used on the result screen, the methodology screen, and every export,
where there is room:
> Friday Amanah provides a configurable estimate based on the information and method
> selected by the user. It is not a Fatwa or a substitute for guidance from a qualified
> scholar. Zakat rules differ between scholars and depend on your personal circumstances.
> Method: {method} · Version: {methodologyVersion} · Calculated: {date}.

**বাংলা**
> **আপনার দেওয়া তথ্য ও নির্বাচিত পদ্ধতি অনুসারে Friday Amanah একটি পরিবর্তনযোগ্য আনুমানিক হিসাব
> প্রদান করে। এটি ফতোয়া নয় এবং কোনো যোগ্য আলিমের পরামর্শের বিকল্পও নয়।**

**Extended Bangla form**
> আপনার দেওয়া তথ্য ও নির্বাচিত পদ্ধতি অনুসারে Friday Amanah একটি পরিবর্তনযোগ্য আনুমানিক হিসাব
> প্রদান করে। এটি ফতোয়া নয় এবং কোনো যোগ্য আলিমের পরামর্শের বিকল্পও নয়। যাকাতের বিধান আলিমদের
> মধ্যে ভিন্ন হতে পারে এবং আপনার ব্যক্তিগত অবস্থার উপর নির্ভর করে।
> পদ্ধতি: {method} · সংস্করণ: {methodologyVersion} · হিসাবের তারিখ: {date}

### What the disclaimer must never do [DECIDED]

- **Never imply scholar endorsement.** It must not say "reviewed by scholars", "verified",
  "approved", "Shariah-compliant", "certified", or name any scholar or institution unless
  that sign-off is genuinely recorded in doc 14.
- **Never soften into reassurance.** "Don't worry, this is accurate enough" is forbidden.
- **Never be collapsed behind a "learn more" link** on a screen showing a figure.
- **Never be removed from an export.** A PDF or CSV leaves the app and may be shown to
  someone else; it carries the disclaimer in its footer, on every page.

[NEEDS SCHOLAR REVIEW — doc 14, items S-15 and S-16] Both the English and Bangla wording
must be reviewed by a qualified, native-speaking reviewer for accuracy and tone before
public release. The Bangla above keeps the product name in Latin script, which is normal for
brand names in Bangladeshi usage; confirm this reads naturally with a native writer.

---

## 2. Engine architecture

The engine is a **pure function**. It takes an input object, returns a result object, and
touches nothing else — no database, no React, no clock, no locale.

```
src/domain/zakat/
├── types.ts          ZakatInput, ZakatResult, ZakatBreakdownStep, ZakatConfig
├── config.ts         Versioned methodology parameters (data, not logic)
├── nisab.ts          computeNisab(basis, prices, config) → Money
├── assets.ts         valueAsset(asset, prices, config) → Money + step trace
├── deductions.ts     valueDeduction(...)  → Money + step trace
├── engine.ts         calculateZakat(input): ZakatResult   ← the only public entry point
├── breakdown.ts      Formats the trace for display and export
└── __tests__/        Extensive. See doc 12 §4.
```

```ts
// Shape only — illustrative, not final code.
function calculateZakat(input: ZakatInput): ZakatResult;

type ZakatResult = {
  methodologyVersion: string;
  nisab: Money;
  totalAssets: Money;
  totalDeductions: Money;
  netZakatable: Money;          // floored at zero, never negative
  meetsNisab: boolean;
  rateBasisPoints: number;      // 250 = 2.5%
  zakatDue: Money;              // zero when meetsNisab is false
  steps: ZakatBreakdownStep[];  // every operation, in order, with its inputs
  warnings: ZakatWarning[];     // e.g. price is 90 days old, an asset has no value
};
```

**Why a pure function matters here.** This is the code a scholar's feedback will change. It
must be readable on its own, testable in milliseconds, and modifiable without any risk to
the rest of the app. It is also the code most likely to be reviewed by someone who is not a
programmer, so it is written for readability over cleverness.

---

## 3. Methodology configuration, version `fa-zakat-1.0.0`

All values below are **defaults that the user can change**, and all are
[NEEDS SCHOLAR REVIEW].

```ts
{
  version: "fa-zakat-1.0.0",
  rateBasisPoints: 250,              // 2.5%
  goldNisabMilligrams:   87_480,     // 87.48 g  ≈ 20 mithqal
  silverNisabMilligrams: 612_360,    // 612.36 g ≈ 200 dirham
  nisabBasis: null,                  // NO DEFAULT — user must choose
  hawlDays: { hijri: 354, gregorian: 365 },
  roundingMode: "half-up",
  roundToNearestMinorUnits: 1,       // user may set 100 (nearest taka)
  netZakatableFloor: 0,              // never negative
}
```

**Note on the weights.** 87.48 g and 612.36 g are the values most commonly used in
contemporary practice, derived from classical measures whose modern gram equivalents are
themselves debated. They are stored as configuration precisely because they are contested.
[NEEDS SCHOLAR REVIEW] — doc 14, item S-1.

---

## 4. Calculation flow

```
1. Validate input
   ├─ nisabBasis chosen?        no → STOP, return NoMethodSelected
   ├─ needed price present?     no → STOP, return MissingPrice
   └─ all amounts ≥ 0?          no → STOP, return InvalidInput

2. Compute Nisab
   ├─ gold   → goldNisabMilligrams   / 1000 × goldPricePerGram
   ├─ silver → silverNisabMilligrams / 1000 × silverPricePerGram
   └─ manual → the user's entered amount, used verbatim
      → record step: "Nisab = 87.48 g × BDT 11,500/g = BDT 1,006,020"

3. Value each asset
   ├─ cash / bank / wallet → the amount as entered
   ├─ gold / silver        → (weight_mg / 1000) × price_per_gram × (purity_bp / 10000)
   ├─ business inventory   → amount as entered  [NEEDS SCHOLAR REVIEW: valuation basis]
   ├─ trade receivable     → amount as entered  [NEEDS SCHOLAR REVIEW: recoverability]
   ├─ investment           → amount as entered  [NEEDS SCHOLAR REVIEW: which portion]
   └─ custom               → amount as entered
      → one recorded step per asset, showing its own arithmetic

4. Sum assets  → totalAssets           (record step)
5. Sum deductions → totalDeductions    (record step)
6. netZakatable = max(0, totalAssets − totalDeductions)   (record step)
7. meetsNisab = netZakatable ≥ nisab   (record step, showing both numbers)
8. zakatDue = meetsNisab
        ? round(netZakatable × rateBasisPoints / 10000)
        : 0                             (record step, including the rounding)
9. Collect warnings
10. Return result + full step list
```

**Every arithmetic operation appends a step.** There is no path through the engine that
produces a number without recording how it was produced. That is what makes the output
defensible to the user and to a scholar.

---

## 5. Gold and silver entry

Users enter **weight and purity**, not a guessed value — this is the single biggest
improvement over how most people currently calculate.

| Field | Detail |
|---|---|
| Weight | Grams or *bhori* (Bangladeshi unit). **1 bhori = 11.6638 g** — [NEEDS SCHOLAR/EXPERT REVIEW: confirm the local standard, doc 14 item S-6]. Stored internally as milligrams. |
| Purity | 24k / 22k / 21k / 18k, or custom basis points. 22k = 9167 bp (22/24). |
| Price | Per gram, for 24k, entered by the user, with an optional note of the source and the date. |
| Item breakdown | Multiple entries allowed, e.g. "necklace, 22k, 3 bhori". |

**Warning shown, not enforced:** if the entered price is more than 30 days old, the result
screen displays "The gold price you entered was recorded on 2 June 2026. Prices change —
you may wish to update it." It is informational; nothing is blocked.

[NEEDS SCHOLAR REVIEW] Whether jewellery in personal use is zakatable is a well-known point
of difference. **The app must not decide this.** Implementation: a per-item toggle,
"Include in Zakat calculation", with both positions stated neutrally and no default
preference — matching the ADR-008 principle.

---

## 6. Hawl tracking

- The user sets a Zakat anniversary date, in Hijri or Gregorian as they prefer.
- The app shows days remaining and gives an optional reminder 30 days before.
- **The app does not decide whether the Hawl has been validly completed.** It tracks a date
  the user set; it does not judge whether wealth remained above Nisab throughout the year.
  That judgement requires facts and rules the app does not have.
- Hijri conversion uses `@umalqura/core` (Umm al-Qura). [RECOMMENDED] Verify against a
  published table for at least 20 dates in Phase 5, and display a note that local moon
  sighting may differ from the calculated calendar.

---

## 7. What the result screen shows

```
┌──────────────────────────────────────────────────┐
│  Zakat estimate                                  │
│  Calculated 4 August 2026 · 20 Safar 1448        │
│                                                  │
│         BDT 24,150                               │
│         estimated Zakat                          │
│                                                  │
│  Method: Silver Nisab  ·  Rate 2.5%              │
│  Version fa-zakat-1.0.0                          │
├──────────────────────────────────────────────────┤
│  Total assets              BDT 1,012,000    ▸    │
│  Total deductions          BDT   46,000     ▸    │
│  Net zakatable             BDT  966,000     ▸    │
│  Nisab threshold           BDT  245,000     ▸    │
│  Above Nisab               Yes              ▸    │
│  2.5% of net zakatable     BDT   24,150     ▸    │
├──────────────────────────────────────────────────┤
│  ⓘ  Friday Amanah provides a configurable        │
│     estimate based on the information and        │
│     method selected by the user. It is not a     │
│     Fatwa or a substitute for guidance from a    │
│     qualified scholar.                           │
├──────────────────────────────────────────────────┤
│  [ Save snapshot ]   [ Export ]   [ Method ]     │
└──────────────────────────────────────────────────┘
```

Every `▸` opens the underlying steps for that line. Nothing is a black box.

Visual design rules for this screen: **no green success styling, no celebratory animation,
no checkmark.** The figure is presented in neutral, high-contrast type. Paying Zakat is an
obligation being calculated, not an achievement being unlocked.

---

## 8. Zakat payments

- Payments are recorded against a snapshot, or standalone.
- Partial payments are normal and fully supported; the snapshot shows paid, remaining, and
  the payment list.
- Recording a payment optionally creates one linked expense transaction plus one giving
  record — **one amount, three references, never triple-counted** (doc 05 §10).
- No completion percentage, no progress bar with a celebratory fill, no reminder that
  escalates in tone. A neutral "BDT 12,000 of your BDT 24,150 estimate recorded."

---

## 9. Deliberately out of scope

The app does **not** and will not, without a scholarly board:

- decide whether a specific person is eligible to receive Zakat
- allocate Zakat across the eight categories of recipients
- rule on Zakat for shares, crypto, pensions, or property beyond accepting a user-entered
  value with an explicit "you have determined this amount" acknowledgement
- calculate Zakat al-Fitr [LATER — simple, but still needs review]
- calculate Ushr or agricultural Zakat [LATER]
- handle Zakat on debts owed to the user that are unlikely to be recovered — the app accepts
  the user's own judgement of the amount and says so
- issue any statement about whether a payment has been religiously accepted

---

## 10. Change control

Any change to the calculation engine requires, in order:

1. A written statement of what changes and why
2. A version bump (`fa-zakat-1.0.0` → `1.1.0`)
3. Proof that existing snapshots are unaffected (they store their own version)
4. Updated unit tests, including the previous version's expected outputs
5. An entry in `docs/14-scholar-review-register.md`
6. Where the change affects a religious position: sign-off recorded in that register

**A Zakat engine change never ships in a patch release with an unrelated bug fix.**
