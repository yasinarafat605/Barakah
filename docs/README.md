# Friday Amanah — Phase 0 Documentation

**Manage Wealth with Purpose.**
Part of the Friday ecosystem by Yasin Arafat.

Status: **Phase 0 — Product & Architecture. No application code written yet.**
Created 4 August 2026 · **Revision 2, 5 August 2026** (rename, brand correction, scope
reduction — see [doc 18](18-change-log.md))

---

## What this folder is

This folder is the "blueprint" for Friday Amanah. Before we write a single line of app
code, everything about the product is written down here: what it does, what it does not
do, how the data is shaped, how it stays secure, and how we build it step by step.

If you ever get lost during development, come back here. If a document here and the code
disagree, one of them is wrong — stop and fix the disagreement before continuing.

## Read in this order

| # | File | What it answers |
|---|------|-----------------|
| 01 | [01-product-requirements.md](01-product-requirements.md) | What are we building, and what are we deliberately not building? |
| 02 | [02-personas-and-journeys.md](02-personas-and-journeys.md) | Who is this for, and what do they actually do in the app? |
| 03 | [03-sitemap-and-navigation.md](03-sitemap-and-navigation.md) | Every screen in the app and how they connect. |
| 04 | [04-architecture.md](04-architecture.md) | How the app is put together technically. |
| 05 | [05-data-model.md](05-data-model.md) | Every database table, column, and relationship. |
| 06 | [06-security-threat-model.md](06-security-threat-model.md) | What could go wrong, and what we do about it. |
| 07 | [07-privacy-model.md](07-privacy-model.md) | Our promises to the user about their data. |
| 08 | [08-zakat-design.md](08-zakat-design.md) | How Zakat is estimated, safely and transparently. |
| 09 | [09-design-system.md](09-design-system.md) | Colours, type, spacing, components, accessibility. |
| 10 | [10-folder-structure.md](10-folder-structure.md) | Where every file lives in the codebase. |
| 11 | [11-roadmap.md](11-roadmap.md) | The 8 build phases and how we know each is done. |
| 12 | [12-testing-strategy.md](12-testing-strategy.md) | How we prove things actually work. |
| 13 | [13-risk-register.md](13-risk-register.md) | What is most likely to go wrong in this project. |
| 14 | [14-scholar-review-register.md](14-scholar-review-register.md) | Every religious decision that needs qualified review. |
| 15A | [15A-phase-1a-plan.md](15A-phase-1a-plan.md) | **Start here.** Environment check + blank SDK 54 app on your phone. |
| 15 | [15-phase-1-plan.md](15-phase-1-plan.md) | Phase 1B — the full foundation, after 1A passes. |
| 16 | [16-architecture-decisions.md](16-architecture-decisions.md) | Why we chose each technology, and what we rejected. |
| 17 | [17-brand-assets-and-metadata.md](17-brand-assets-and-metadata.md) | Approved brand package, asset integration map, technical identifiers. |
| 18 | [18-change-log.md](18-change-log.md) | Every change between revisions, and why. |

## How decisions are labelled in these documents

Throughout, statements are tagged so you always know how firm they are:

- **[DECIDED]** — This is settled. Build it this way. Changing it requires updating the doc first.
- **[RECOMMENDED]** — This is my professional advice, but it is reversible and low-risk to change.
- **[ASSUMPTION]** — I inferred this. Please confirm or correct it.
- **[NEEDS SCHOLAR REVIEW]** — A qualified Islamic finance scholar must sign this off before public release.
- **[LATER]** — Deliberately out of scope for the MVP. Architecture allows it; we are not building it now.

## Confirmed founder decisions

**4 August 2026**

1. **Market:** Bangladesh. Default currency BDT. Bangla-first with full English support.
2. **Zakat Nisab:** No default. The user must explicitly choose gold, silver, or manual.
3. **Deliverable:** Phase 0 documents only. No code yet.
4. **Test device:** Android phone + Expo Go recommended — see [doc 15](15-phase-1-plan.md) §1.

**5 August 2026 — revision 2**

5. **Product name:** **Friday Amanah**. "Friday Mizan" is void.
6. **Tagline:** **Manage Wealth with Purpose.**
7. **Brand:** the supplied asset package is the visual source of truth. The logo is the approved shield + keyhole + F mark and is never recreated.
8. **Palette:** the eight approved brand colours, unaltered. `#0E9F6E` is deleted.
9. **Typography:** dual-font system — Poppins for brand and display, Inter for financial data and interface, Noto Sans Bengali for Bangla.
10. **Future AI assistant:** **Amanah Guide** — still outside the MVP.
11. **Security language:** no encryption claim may exceed what is implemented and tested.
12. **Scope:** MVP reduced from 84 routes to 42.

## Open decisions awaiting the founder

| # | Decision | Where |
|---|---|---|
| 1 | Android application ID and iOS bundle identifier | [doc 17](17-brand-assets-and-metadata.md) §6 |
| 2 | Deep-link scheme: `fridayamanah://` or `amanah://` | doc 17 §6 |
| 3 | Approval of the splash-screen composition method | doc 17 §5.1 |
| 4 | Approval of the Android adaptive-icon recomposition method | doc 17 §5.2 |
| 5 | Supply a monochrome icon, a notification icon, and a 1200×630 social preview | doc 17 §5.4–5.6 |
| 6 | Re-export the brand feature strip with corrected security copy | doc 17 §5.9 |
| 7 | Whether an Android phone is available for testing | [doc 15](15-phase-1-plan.md) §1 |

## The rule that protects this project

> Do not start a phase until the previous phase has been run, tested, and verified on a
> real device. Do not mark anything "done" that has not actually been executed.

A half-finished financial app that silently reports wrong balances is worse than no app.
