# 03 — Sitemap and Navigation Map

> **Revision 2 · 5 August 2026.** Scope review completed at the founder's request.
> **84 routes → 42 routes.** No financial safeguard was removed. The reduction comes from
> combining fragmented screens, converting simple pickers to bottom sheets, and deferring
> two genuinely optional modules. Full analysis in §3–§6.

---

## 1. Navigation shell [DECIDED — unchanged]

Five bottom tabs plus a quick-add button. Five is the maximum before tabs become unreadable
at large font sizes in Bangla.

```
┌──────────────────────────────────────────────────────────┐
│                     Screen content                       │
│                                        ┌───┐             │
│                                        │ ⊕ │  quick-add  │
│                                        └───┘             │
├──────────────────────────────────────────────────────────┤
│  Home    Transactions    Plan    Islamic    Settings     │
│   হোম      লেনদেন        পরিকল্পনা   ইসলামিক    সেটিংস      │
└──────────────────────────────────────────────────────────┘
```

The ⊕ button is a floating action button above the tab bar, present on Home, Transactions,
Plan, and Islamic. It opens the add sheet as a modal, never a navigation push.

[RECOMMENDED] Validate the "Islamic / ইসলামিক" tab label with real users. Some may prefer
"Zakat & Giving / যাকাত ও দান", which is more concrete and less identity-labelling.

---

## 2. Why the reduction was needed

84 routes is roughly the size of a funded team's first release. For a beginner-led solo
project it creates three specific problems:

1. **Every route costs 4–6 files** — screen, feature component, hook, states, tests. 84
   routes is over 400 files before any of them does anything useful.
2. **Fragmentation hurts the user too.** A separate screen to pick a theme is worse UX than
   a bottom sheet — it is an extra navigation push for a one-tap decision.
3. **Eleven near-identical report screens** was a design failure, not a feature. They differ
   only in which query runs and which chart renders.

The principle applied: **a route earns its existence if the user needs to navigate *back*
from it, deep-link to it, or spend more than a few seconds there.** Everything else is a
sheet.

---

## 3. Routes combined (−18)

| Was | Now | Why |
|---|---|---|
| Currency select + Financial month start | `/onboarding/preferences` | Two dropdowns; one screen |
| Onboarding "complete" screen | folded into first-account step | A confirmation screen is not a destination |
| Transaction list + Search screen | `/transactions` with an inline search bar | Search is a mode of a list, not a place |
| Transaction new + Transaction edit | `/transactions/edit` with optional `?id` | Same form, same validation, one file |
| Split editor screen | inline section in the edit screen | Splitting is part of entering a transaction |
| Account new + Account edit | `/accounts/edit` with optional `?id` | Same form |
| Category new + edit + reorder | `/categories` with an edit sheet | The list *is* the reorder UI |
| Goal new + Goal edit | `/plan/goals/edit` | Same form |
| Debt new + Debt edit | `/plan/debts/edit` | Same form |
| Giving new + Giving edit | `/islamic/giving/edit` | Same form |
| Giving summary screen | header section on `/islamic/giving` | It is a summary of the list beneath it |
| Zakat assets + Zakat deductions | `/islamic/zakat/worksheet` | One scrolling worksheet reads far better than two half-screens, and it lets the user see assets and deductions together — which matters for a calculation they must be able to check |
| Zakat metal price screen | inline card in the worksheet | Price is an input to the worksheet |
| Zakat Hawl settings | section on `/islamic/zakat/method` | Both are "how my Zakat is configured" |
| Zakat snapshot detail + its payments | `/islamic/zakat/history/[id]` | Payments belong to the snapshot they pay |
| **11 report screens** | **`/reports/[type]`** | One screen, a report registry, 11 configurations. The single biggest win — and better engineering, since a new report becomes a config entry rather than a new screen |
| 3 legal screens | `/settings/legal/[doc]` | Same layout, different markdown |
| Version/diagnostics screen | section on `/settings/about` | |

---

## 4. Routes converted to bottom sheets or modals (−11)

These stop being routes but **do not stop existing**. A sheet is often the better interaction.

| Was a route | Now |
|---|---|
| `/settings/language` | Sheet from Settings hub |
| `/settings/currency` | Sheet |
| `/settings/calendar` | Sheet |
| `/settings/theme` | Sheet (3 options) |
| `/settings/profile` | Sheet (display name + emoji) |
| `/settings/privacy-mode` | Toggle directly on the hub |
| Category budget detail | Sheet from the budget list row |
| Category add/edit | Sheet from the category list |
| Goal contribute | Sheet *(already a modal in rev 1)* |
| Debt record payment | Sheet *(already a modal in rev 1)* |
| Export options | Sheet from any report |

---

## 5. Routes deferred (−13)

Deferred means: **not built in the MVP, data model unchanged, no rework needed later.**

| Deferred | To | Why this is safe |
|---|---|---|
| `/recurring` list + `/recurring/[id]` editor | **Phase 3** | The `recurring_rules` table and the "mark as recurring" flag stay in the MVP. Only the *management* screen moves out. Users can still flag a transaction as recurring |
| `/notifications` list | **Phase 3** | Alerts render inline on the dashboard. A separate inbox is a convenience, not a requirement |
| `/settings/sync` placeholder | **Phase 9** | It was a disabled screen advertising a feature that does not exist |
| `/plan/budgets/[period]/[categoryId]` | → sheet | (counted in §4) |
| Update-required screen | Post-MVP | Only needed once there is a server |
| 8 of 11 report *screens* | → `/reports/[type]` | (counted in §3) |

**Nothing removed touches a financial safeguard.** Balances, transfers, splits, debt
payments, the Zakat worksheet, backup, restore, delete-all, and the lock screen are all
fully retained.

---

## 6. Final revised MVP route list — 42 routes

### Onboarding — 5
| # | Route | Notes |
|---|---|---|
| 1 | `/onboarding/language` | First screen ever shown |
| 2 | `/onboarding/welcome` | 3-step carousel: what it is · privacy · what it is *not* |
| 3 | `/onboarding/preferences` | Currency + financial month start day |
| 4 | `/onboarding/security` | Optional PIN, then optional biometric |
| 5 | `/onboarding/first-account` | Optional Cash account + opening balance → Home |

### Home — 1
| # | Route | Notes |
|---|---|---|
| 6 | `/` | Dashboard. Period picker, privacy toggle, and alerts are inline or sheets |

### Transactions — 7
| # | Route | Notes |
|---|---|---|
| 7 | `/transactions` | List, day-grouped, inline search, filter sheet |
| 8 | `/transactions/[id]` | Detail |
| 9 | `/transactions/edit` | New and edit; splits inline |
| 10 | `/accounts` | List |
| 11 | `/accounts/[id]` | Account detail + its ledger |
| 12 | `/accounts/edit` | New and edit |
| 13 | `/categories` | List, reorder, archive; add/edit via sheet |

### Plan — 9
| # | Route | Notes |
|---|---|---|
| 14 | `/plan` | Hub: Budgets · Goals · Debts |
| 15 | `/plan/budgets` | Period overview; category detail via sheet |
| 16 | `/plan/budgets/edit` | Create/edit a budget period |
| 17 | `/plan/goals` | List |
| 18 | `/plan/goals/[id]` | Progress, contributions, withdrawals |
| 19 | `/plan/goals/edit` | New and edit |
| 20 | `/plan/debts` | Two tabs: I owe · Owed to me |
| 21 | `/plan/debts/[id]` | Detail + payment history + schedule |
| 22 | `/plan/debts/edit` | New and edit |

### Islamic — 10
| # | Route | Notes |
|---|---|---|
| 23 | `/islamic` | Hub: Zakat card · Giving card |
| 24 | `/islamic/zakat/method` | **Blocking method chooser** + Hawl + calendar preference |
| 25 | `/islamic/zakat/worksheet` | Assets + deductions + metal prices, one scroll |
| 26 | `/islamic/zakat/result` | Estimate + full tappable breakdown + disclaimer |
| 27 | `/islamic/zakat/history` | Saved snapshots |
| 28 | `/islamic/zakat/history/[id]` | Immutable snapshot + its payments |
| 29 | `/islamic/zakat/methodology` | Full methodology and disclaimer text |
| 30 | `/islamic/giving` | List + month/year summary header |
| 31 | `/islamic/giving/[id]` | Detail |
| 32 | `/islamic/giving/edit` | New and edit |

**The Zakat module was reduced least deliberately** — from 15 routes to 10, and the two
removals were merges that make the calculation *easier* to check, not harder.

### Reports — 2
| # | Route | Notes |
|---|---|---|
| 33 | `/reports` | Hub listing all 11 reports as cards |
| 34 | `/reports/[type]` | One parameterised screen. `type` ∈ income-expense · categories · accounts · cashflow · budget · savings · debt · receivables · giving · zakat · yearly. Export via sheet |

### Settings — 5
| # | Route | Notes |
|---|---|---|
| 35 | `/settings` | Hub. Language, currency, calendar, theme, profile, privacy mode all as sheets |
| 36 | `/settings/security` | PIN, biometric, auto-lock timeout |
| 37 | `/settings/data` | Backup · Restore · Export · Delete all data, as sections |
| 38 | `/settings/about` | Version, diagnostics, Friday ecosystem, open-source licences |
| 39 | `/settings/legal/[doc]` | `privacy` · `terms` · `zakat-disclaimer` |

### System — 3
| # | Route | Notes |
|---|---|---|
| 40 | `/lock` | Rendered above everything |
| 41 | `/+not-found` | |
| 42 | `/_gallery` | Dev-only component gallery, excluded from release builds |

**Total: 42 routes** (41 user-facing + 1 dev-only).

### Global modals and sheets — not routes
Quick-add (Expense · Income · Transfer) · period picker · transaction filters · category
edit · goal contribution · debt payment · export options · settings pickers (language,
currency, calendar, theme, profile) · destructive confirmations.

---

## 7. Impact of the reduction

| | Revision 1 | Revision 2 | Change |
|---|---|---|---|
| Routes | 84 | **42** | −50% |
| Estimated screen files | ~400 | ~200 | −50% |
| Zakat routes | 15 | **10** | −33% — least reduced, deliberately |
| Report routes | 12 | **2** | −83% |
| Settings routes | 19 | **5** | −74% |
| Financial safeguards removed | — | **none** | — |

**Estimated time saved: 6–9 weeks**, concentrated in Phases 3, 4, and 6.

---

## 8. Navigation map

```
                          ┌─────────────┐
   first launch  ────────▶│ ONBOARDING  │────────┐
                          │   1 → 5     │        │
                          └─────────────┘        ▼
                                          ┌────────────┐
   returning + locked ───▶ [ LOCK 40 ] ──▶│    HOME  6 │
                                          └─────┬──────┘
      ┌──────────────┬──────────────┬───────────┴───┬──────────────┐
      ▼              ▼              ▼               ▼              ▼
 ┌─────────┐  ┌────────────┐  ┌──────────┐   ┌───────────┐  ┌──────────┐
 │  HOME   │  │TRANSACTIONS│  │   PLAN   │   │  ISLAMIC  │  │ SETTINGS │
 │    6    │  │      7     │  │    14    │   │    23     │  │    35    │
 └────┬────┘  └─────┬──────┘  └────┬─────┘   └─────┬─────┘  └────┬─────┘
      │             │              │               │             │
      │        ┌────┴────┐    ┌────┴────┐     ┌────┴────┐   ┌────┴────┐
      │        │Accounts │    │ Budgets │     │  Zakat  │   │Security │
      │        │Categories│   │  Goals  │     │ Giving  │   │  Data   │
      │        │  Edit   │    │  Debts  │     │ History │   │  About  │
      │        └─────────┘    └─────────┘     │ Method  │   │  Legal  │
      │                                       └─────────┘   └─────────┘
      ▼
 ┌─────────┐
 │ REPORTS │  33 → /reports/[type] 34 → export sheet
 └─────────┘

      ⊕ Quick-add (global sheet) ──▶ Expense │ Income │ Transfer
```

---

## 9. Required UI states for every screen [DECIDED — unchanged]

No screen is complete until all applicable states exist. Checked in code review and at the
phase exit.

| State | Rule |
|---|---|
| **Empty** | Explains what will appear here and offers the one action that fills it. Never just an illustration |
| **Loading** | Skeleton matching the real layout. No spinners on list screens |
| **Error** | Plain-language cause + retry. Never a stack trace or SQL text |
| **Offline** | Not used in the MVP — the app is fully offline by design. Only [LATER] sync screens need it |
| **Sync conflict** | [LATER] Designed in doc 04, not built |
| **Success** | Quiet inline confirmation, ~1.5 s. No modal, no confetti |
| **Permission denied** | What was requested, why, and how to enable it in OS settings |
| **Locked** | Full-screen, nothing visible behind, nothing in the app-switcher preview |
| **No search results** | Repeats the query, offers to clear filters |
| **Destructive confirm** | Names exactly what will be lost. Typed confirmation for irreversible actions |
