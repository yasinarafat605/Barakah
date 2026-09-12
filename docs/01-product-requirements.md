# 01 — Product Requirements

## 1. Executive overview

Friday Amanah is a **privacy-focused, local-first Islamic personal finance application** for
Android and iOS. It helps a Muslim individual — initially in Bangladesh — see their whole
financial position in one calm place: what came in, what went out, what is owed, what is
saved, what is given, and roughly what Zakat may be due.

It is not a bank, not an investment platform, and not a religious authority. It is a
private ledger and planning tool that happens to understand the financial categories
Muslims actually use: Zakat, Sadaqah, Qard Hasan, Qurbani, Hajj, family support.

**The product bet:** most expense trackers fail Muslims in three ways. They have no
concept of Zakat. They treat interest-bearing debt as normal and even optimise for it.
And they use guilt and streaks to drive engagement. Friday Amanah removes all three.

**Why local-first matters commercially and ethically.** Financial data is the most
sensitive category of personal data after health. A person's spending reveals their
income, their family, their habits, their charity, and their debts. The safest way to
protect that is to never send it anywhere. Friday Amanah's MVP has **no server at all**.
That is a feature, a marketing position, and a large reduction in engineering risk.

**Tagline:** Manage Wealth with Purpose.

**Name.** *Amanah* means a trust — something held on behalf of another, to be safeguarded
and returned intact. That is both what the app does with the user's data and what the user
does with their wealth. The name sets the product's whole posture.

---

## 2. Product principles

These are constraints, not aspirations. If a feature violates one, the feature is wrong.

1. **Local-first.** The device database is the source of truth. The app is fully usable
   with airplane mode on, forever, with no account.
2. **Privacy-first.** No analytics on financial content. No third party ever receives a
   transaction. No data sale, ever.
3. **Secure by default.** Sensible protection is on out of the box, not buried in settings.
4. **Transparent.** Every calculated number can be opened to show exactly how it was
   derived, especially Zakat.
5. **Respectful.** No shame, no streaks, no manipulative urgency, no dark patterns.
6. **Not a Mufti.** The app never issues a ruling. It estimates, discloses its method, and
   points to qualified scholars.
7. **Bengali is a first-class language,** not a translation afterthought.
8. **Accessible.** Usable with a screen reader, at large font sizes, and by someone who
   cannot distinguish red from green.
9. **Fast and light.** Instant app launch, instant list scroll, small download size.
10. **Scalable, not over-engineered.** The data model anticipates households; the MVP code
    does not implement them.

---

## 3. MVP scope — what version 1.0 ships with

### 3.1 Onboarding [DECIDED]
- Welcome carousel (3 screens, skippable)
- Language selection (বাংলা / English) — first screen, before anything else
- Currency selection (BDT default, full ISO list available)
- Financial month start day (1–28, default 1)
- Privacy explanation screen ("your data stays on this phone")
- Optional 4–6 digit PIN
- Optional biometric unlock where the device supports it
- Optional first account creation (Cash, with opening balance)
- Explicit Zakat Nisab method choice is **deferred** to first use of the Zakat Center, not
  forced during onboarding — but it is mandatory before any Zakat number is displayed.
- **No account creation. No email. No internet required.**

### 3.2 Home dashboard [DECIDED]
Net worth-style summary card, then: period income, period expenses, remaining budget,
savings progress, debt owed, receivables, upcoming recurring payments, giving this month,
Zakat status card, recent transactions (last 8), quick-add floating button.
Privacy mode toggle hides every amount behind `••••••` with one tap.

### 3.3 Accounts and wallets [DECIDED]
Types: Cash, Bank, Mobile wallet (bKash/Nagad/Rocket presets), Savings, Business, Custom.
Fields: name, type, currency, opening balance, computed current balance, icon, colour,
active/archived, notes. Archive instead of delete when transactions exist.
**No bank connections in the MVP.**

### 3.4 Income and expense tracking [DECIDED]
Add / edit / delete / duplicate income, expense, and transfer. Search by text. Filter by
date range, type, account, category, tag. Notes, tags, recurring flag, split across
multiple categories, attachment record structure (files stored, UI minimal in MVP).
Soft delete with a 10-second undo, then permanent.
23 default categories seeded in both languages; user can add, rename, archive, reorder.

### 3.5 Monthly budget [DECIDED]
Overall monthly budget plus per-category budgets. Optional weekly limit. Optional rollover
of unspent amounts. Progress bars with percentage and remaining-per-day guidance.
Previous-month comparison. Budget templates (copy last month).
All notification copy is neutral and reviewed against a banned-phrase list.

### 3.6 Savings goals [DECIDED]
Named goals with preset suggestions (Emergency, Hajj, Umrah, Education, Marriage, Home,
Business, Medical, Qurbani, Ramadan giving, Family support, Custom). Target amount, target
date, current amount, linked account, contribution and withdrawal history, progress
percentage, milestones at 25/50/75/100%, notes, archived/completed state.

### 3.7 Debts and receivables [DECIDED]
Two directions: *I owe* and *owed to me*. Counterparty name, original amount, remaining
amount, due date, optional installment schedule, payment history, partial payments, notes,
reminder settings, status, optional **Qard Hasan** label, attachment structure.
Interest, if the user records it, is stored as a neutral fee line with no commentary,
no optimisation advice, and no religious labelling either way.

### 3.8 Zakat Center [DECIDED — engine design in doc 08]
Configurable worksheet: assets (cash, bank, mobile wallet, gold, silver, business
inventory, trade receivables, eligible investments, custom), deductions (short-term
liabilities, custom). Nisab basis chosen explicitly by the user (gold / silver / manual).
Manual metal price entry — **no live price feed in the MVP**. Hijri or Gregorian Hawl
tracking. Saved snapshots, full line-by-line breakdown, payment records with partial
payments, methodology version stamp, disclaimer on every screen and every export.

### 3.9 Sadaqah and giving [DECIDED]
Types: Sadaqah, Zakat payment, family assistance, mosque, community, emergency support,
gift, custom. Amount, date, private recipient nickname, anonymous option, notes, recurring
giving target, receipt structure, monthly and yearly summaries.

### 3.10 Reports [DECIDED]
Income vs expenses, category spending, account balances, monthly cash flow, budget
performance, savings progress, debt, receivables, giving, Zakat calculation report, yearly
summary. Date-range filters, bilingual labels, CSV export (formula-injection safe),
PDF-ready layout, privacy mode respected, local file export via the OS share sheet.

### 3.11 Settings [DECIDED]
Profile (local only), language, currency, number format (Western/Bengali numerals),
calendar preference, theme (light/dark/system), PIN, biometric, auto-lock timeout,
privacy mode, notifications, encrypted backup, restore, data export, delete all data,
app version, privacy policy, terms, Zakat disclaimer, about Friday.

### 3.12 Cross-cutting [DECIDED]
Full Bangla + English localisation. Light and dark themes. Offline always. **Encrypted
backup files** (the exported file, not the live database — see doc 06 §0) and verified
restore. PIN + biometric app access control with auto-lock. Accessibility baseline.
Complete empty/loading/error/success/locked states for every screen.

**Security wording note.** Everything in this document, in the app, and in any store listing
must follow the vocabulary table in **doc 06 §0**. The MVP does **not** have whole-database
encryption, and no copy anywhere may imply that it does.

---

## 4. Explicit non-goals — NOT in the MVP

Listing these protects the project. Every one of these is a real feature request that will
appear, and every one of them would delay shipping.

| Excluded from MVP | Why | Planned? |
|---|---|---|
| Cloud accounts, login, sync | Entire backend, auth, and security surface. Removing it cuts MVP risk roughly in half. | [LATER] Phase 9 |
| Household / family sharing | Requires sync first. Data model supports it already. | [LATER] Phase 10 |
| Bank or bKash API integration | Licensing, partnership, and compliance work — not an engineering task. | [LATER] |
| Live gold/silver price feed | Needs a reliable, attributable source and an update policy. Wrong prices produce wrong Zakat. | [LATER] Phase 9 |
| Receipt OCR / scanning | Large dependency, unclear MVP value. Attachment *storage* is in scope. | [LATER] |
| Voice entry | Bangla speech accuracy is not dependable enough yet. | [LATER] |
| "Amanah Guide" AI assistant | Requires sending data off-device — needs the privacy and consent model built first. | [LATER] Phase 11 |
| Halal/haram classification of transactions | The app must never issue rulings. | **Never automatic.** |
| Shariah-compliant investment screening | Requires a licensed data provider and scholarly board. | [LATER, if ever] |
| Multi-currency *within one account* | Real FX accounting is genuinely hard; per-account single currency is enough for v1. | [LATER] |
| Web dashboard | Different platform, different security model. | [LATER] |
| Subscription detection, bill auto-import | Depends on bank data we do not have. | [LATER] |
| Widgets, watch app, Wear OS | Nice, not necessary. | [LATER] |
| Ramadan / Hajj dedicated modes | Savings goals already cover the need for v1. | [LATER] Phase 10 |

**The non-goal rule:** any request to add something from this table during Phases 1–8 gets
written into a `docs/backlog.md` file and nothing else happens. Shipping beats scope.

---

## 5. Success criteria for the MVP

Friday Amanah 1.0 is ready to release when all of the following are true and *verified*:

1. A new user can install, complete onboarding, and record their first expense in under
   90 seconds without instructions.
2. Every balance in the app can be reproduced by hand from the transaction list. Zero
   rounding drift across 10,000 seeded transactions.
3. The app functions completely with the device in airplane mode from first launch.
4. Backup → wipe device → restore reproduces the database exactly, verified by checksum.
5. Every user-visible string appears correctly in both বাংলা and English, with no layout
   breakage at 200% font scale.
6. Zakat output always shows its method, its inputs, its version, and its disclaimer.
7. TalkBack can complete: add expense, view dashboard, view Zakat estimate.
8. No PIN, token, key, note, or amount appears in any log in a release build.
9. All automated tests pass, with the command output recorded in the phase handoff.
10. A qualified scholar has reviewed the items in doc 14, or those features ship clearly
    marked as unreviewed estimates.

---

## 6. What "done" means for any feature

A feature is done when: it works on a physical Android device; its empty, loading, error,
and success states exist; its strings are in both languages; its numbers are covered by a
unit test; it respects privacy mode; and it does not log anything sensitive. Anything less
is "in progress", regardless of how complete the screen looks.
