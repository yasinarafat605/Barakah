# 14 — Scholar Review Register

Every decision in Friday Amanah that touches Islamic rulings is listed here. Each one is
**unreviewed** until a named, qualified scholar of Islamic finance signs it off and the
sign-off is recorded in this table.

## How this works

1. Build the feature with the decision configurable, not hardcoded.
2. Ship it clearly labelled as an estimate with the standard disclaimer.
3. Send this register to a qualified scholar for review.
4. Record their name, credentials, date, and response below.
5. Where they differ from our default, change the **configuration**, not the code.

**Until an item is signed off, the app must not present it as settled.** The disclaimer
does this work; do not weaken it.

[RECOMMENDED] Engage a scholar with specific competence in *contemporary financial
transactions* (mu'amalat), not general fiqh, ideally one familiar with Bangladeshi practice,
and preferably in consultation with a recognised body such as AAOIFI's standards or a
Bangladeshi Shariah supervisory board. Budget for this before public launch, not after.

---

## Register

| ID | Question | Our default | Where it lives | Status |
|---|---|---|---|---|
| **S-1** | Gold Nisab weight in grams | 87.48 g | `zakat/config.ts` | ☐ Unreviewed |
| **S-2** | Silver Nisab weight in grams | 612.36 g | `zakat/config.ts` | ☐ Unreviewed |
| **S-3** | Zakat rate | 2.5% (250 bp) | `zakat/config.ts` | ☐ Unreviewed |
| **S-4** | Presenting gold and silver Nisab as an unweighted user choice with no recommendation | Neutral choice, no default (ADR-008) | Method chooser screen | ☐ Unreviewed |
| **S-5** | Is jewellery in personal use zakatable? | App does not decide; per-item toggle, both positions stated | Asset entry UI | ☐ Unreviewed |
| **S-6** | Bhori to gram conversion for Bangladesh | 1 bhori = 11.6638 g | `zakat/config.ts` | ☐ Unreviewed |
| **S-7** | Recording an interest-bearing obligation as a neutral "additional charge" with no commentary either way | Neutral record-keeping only | `debts` module | ☐ Unreviewed |
| **S-8** | Which liabilities may be deducted (short-term only? all debts? one year's worth?) | User-selected; app defaults to nothing and offers short-term liabilities as a suggestion | Deduction entry | ☐ Unreviewed |
| **S-9** | Valuation basis for business inventory (cost, market, or wholesale) | User-entered amount, app offers no basis | Asset entry | ☐ Unreviewed |
| **S-10** | Treatment of trade receivables that may not be recovered | User's own judgement of the amount, explicitly acknowledged | Asset entry | ☐ Unreviewed |
| **S-11** | Which portion of an investment is zakatable | User-entered; app gives no formula | Asset entry | ☐ Unreviewed |
| **S-12** | Whether the app may compute Hawl completion | App only tracks a date the user sets; it never judges completion | Hawl screen | ☐ Unreviewed |
| **S-13** | Umm al-Qura calculated calendar vs. local moon sighting | Umm al-Qura used, with an on-screen note that local sighting may differ | Date handling | ☐ Unreviewed |
| **S-14** | Rounding direction for the final Zakat figure | Half-up, disclosed in the breakdown | `zakat/engine.ts` | ☐ Unreviewed |
| **S-15** | English disclaimer wording | Doc 08 §1 | i18n `en` | ☐ Unreviewed |
| **S-16** | **Bangla disclaimer wording** — accuracy and tone | Doc 08 §1 | i18n `bn` | ☐ Unreviewed |
| **S-17** | The term "Qard Hasan" as an optional user label on a debt | User-applied only; the app never infers or asserts it | `debts` module | ☐ Unreviewed |
| **S-18** | Use of the word **"Amanah"** (a trust held on behalf of another) as a commercial product name, and the tagline "Manage Wealth with Purpose." | Founder decision, 5 Aug 2026 | Branding | ☐ Unreviewed |
| **S-18b** | Whether the shield-and-keyhole logo, read alongside the name Amanah, could imply a religious guarantee of safekeeping that the app cannot make | Visual only; no claim is made in copy | Branding | ☐ Unreviewed |
| **S-19** | Bangla translations of religious terms throughout the interface (Zakat, Sadaqah, Nisab, Hawl, Qard Hasan) | See i18n files | i18n `bn` | ☐ Unreviewed |
| **S-20** | Framing giving targets as a personal plan rather than an obligation, with no completion score | Doc 05 §8 | Giving module | ☐ Unreviewed |
| **S-21** | [LATER] Zakat al-Fitr calculation | Not implemented | — | ☐ Not built |
| **S-22** | [LATER] Ushr / agricultural Zakat | Not implemented | — | ☐ Not built |
| **S-23** | [LATER] Allocation across the eight categories of recipients | Not implemented, and will not be without a board | — | ☐ Not built |

---

## Sign-off log

| Date | Scholar | Credentials | Items reviewed | Outcome | Recorded by |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

---

## Release policy

**Public release is permitted with items unreviewed, provided that:**

- the standard disclaimer appears on every screen displaying a Zakat figure and in every
  export,
- the methodology screen states plainly that the calculation has not yet been reviewed by a
  qualified scholar,
- the store listing does not claim scholarly endorsement, certification, or approval,
- the app store description does not use the words "Shariah-compliant", "approved",
  "certified", or "verified" about the calculation.

**Public release is not permitted if** any screen presents a Zakat figure as a ruling,
obligation, or final amount rather than an estimate.

When items are signed off, the methodology screen is updated to name the reviewer and the
date, and `methodology_version` is bumped.
