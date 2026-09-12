# 02 — Personas and User Journeys

[ASSUMPTION] These personas are constructed from the stated Bangladesh-first, Bangla-first
direction. They are a starting hypothesis, not research. Before Phase 6, interview at least
five real users and revise this document. Building on unvalidated personas is the single
most common way small products drift.

---

## Primary personas

### P1 — Rafiq, 29, Dhaka — "Where did it all go?"
**Primary persona. Optimise the MVP for him.**

Private-sector employee, salary about BDT 48,000 paid to a bank account. Withdraws cash
weekly. Uses bKash constantly for small payments and to send BDT 8,000 to his parents in
Comilla each month. Android mid-range phone. Reads Bangla comfortably, English adequately.

- **Wants:** to know why the money is gone by the 22nd of every month.
- **Wants:** a believable Zakat number before Ramadan without a spreadsheet.
- **Fears:** the app leaking his salary and family support amounts to anyone.
- **Will abandon the app if:** entering an expense takes more than four taps, or the
  interface is in stiff, translated-sounding Bangla.
- **Design implications:** quick-add must be brutally fast. bKash/Nagad presets matter.
  Bangla copy must be written, not translated.

### P2 — Nusrat, 34, Chattogram — the household manager
School teacher plus private tuition income. Manages the whole household's money although
the salary is not all hers. Saving for Hajj with her husband. Has lent BDT 25,000 to a
cousin with no interest and no clear repayment date, and is quietly worried about it.

- **Wants:** category budgets that survive an irregular second income.
- **Wants:** to track the Qard Hasan without it feeling like debt collection.
- **Wants:** the Hajj goal to feel like progress, not pressure.
- **Design implications:** Qard Hasan label, gentle reminder tone, savings goal milestones,
  income that varies month to month must not break budgets.

### P3 — Imran, 41, Birmingham UK — the diaspora giver
Bangladeshi-British, sends money home monthly, holds meaningful gold (his wife's), some
savings, and a small business share. His Zakat calculation is genuinely complicated and he
currently does it badly in a notebook once a year.

- **Wants:** a Zakat worksheet that shows its work and that he can hand to an imam.
- **Wants:** to record gold by weight and karat, not by a guessed value.
- **Fears:** getting Zakat wrong — spiritually, not financially.
- **Design implications:** the Zakat engine must be genuinely rigorous, exportable, and
  transparent. Multi-currency awareness at account level. [ASSUMPTION] He is a secondary
  market for v1 but validates the Zakat design.

### P4 — Tahmina, 22, Sylhet — the light user
University student, small allowance and tutoring income, no bank account, all cash and
bKash. Gives small Sadaqah regularly and likes seeing it recorded.

- **Wants:** simple. Two accounts, ten categories, no budgets at first.
- **Design implications:** the app must be pleasant when almost empty. Empty states are a
  feature. Nothing may require setting up a budget or a goal.

---

## Anti-persona — who this is NOT for (v1)

- Businesses needing invoicing, VAT, payroll, or double-entry accounting.
- Traders wanting portfolio tracking or market data.
- Anyone wanting automatic bank import — we cannot do it and should not pretend.

---

## Future user types (data model must not block these)

| Type | Can do | Status |
|---|---|---|
| Individual | Everything in their own space | **MVP** |
| Household admin | Create household, invite, set roles, see all shared data | [LATER] |
| Spouse | Full read/write on shared accounts and budgets | [LATER] |
| Adult member | Own transactions + assigned shared categories | [LATER] |
| Teen member | Own allowance and spending; no household totals | [LATER] |
| View-only | Read shared summaries; cannot edit | [LATER] |

The `households`, `household_members`, and per-row `household_id` columns exist in the
schema from day one, all nullable, all unused in the MVP. That is a few hours of work now
that prevents a full migration later.

---

## Core user journeys

Each journey lists the tap path. Anything longer than its target is a design failure.

### J1 — Add an expense (the most important flow in the app) — target: 4 taps, 8 seconds
1. Tap the ⊕ button (visible on every main tab)
2. Amount keypad opens **immediately, focused** — type `450`
3. Tap category `Food` (recent categories shown first)
4. Tap Save

Account defaults to last used. Date defaults to today. Everything else is optional and
lives behind a "More details" expander. Success is a brief, quiet confirmation — not a
celebration, not a streak.

### J2 — Add income — target: 4 taps
Same sheet, "Income" tab at the top. Category defaults to Salary if it is the user's most
frequent income category.

### J3 — Transfer between accounts — target: 5 taps
⊕ → Transfer tab → amount → From account → To account → Save.
Creates a single `transfer` transaction linked to two accounts. It must **never** appear
in income or expense totals. This is the most commonly miscounted thing in finance apps
and gets a dedicated test suite.

### J4 — Create a monthly budget — target: 60 seconds
Plan tab → Budgets → Create → choose month → set overall amount → optionally add category
budgets from a list showing last month's actual spend beside each one → Save.
The "here's what you actually spent last month" hint is what makes budgets realistic.

### J5 — Create a savings goal — target: 45 seconds
Plan tab → Goals → New → pick a preset (Hajj) or type a name → target amount → target date
→ optional linked account → Save. App then shows a neutral, non-pressuring monthly figure:
"To reach this by March 2028, about BDT 12,400 per month." No guilt if they cannot.

### J6 — Record a debt and a repayment
Plan tab → Debts → New → direction (I owe / owed to me) → person → amount → optional due
date → optional Qard Hasan toggle → Save.
Later: open the debt → Record payment → amount → date → optionally link to an account so
it also creates a real transaction. Remaining balance updates and the payment appears in
history. Partial payments are first-class.

### J7 — Estimate Zakat (the flow that must be flawless)
1. Islamic tab → Zakat Center
2. **First run only:** a method screen appears. The user must choose gold Nisab, silver
   Nisab, or manual entry. There is no default and no skip. A short, neutral explanation of
   the difference is shown, with no recommendation from the app.
3. Enter the metal price they wish to use (manual, with the date they got it)
4. Enter assets line by line — each line shows a plain-language "what counts here" note
5. Enter deductions
6. See: total assets, total deductions, net, the Nisab figure, whether net ≥ Nisab, the
   rate applied, and the resulting estimate — every number tappable to see its source
7. Disclaimer is on the screen, not behind a link
8. Save snapshot → later record payments against it, including partial payments

### J8 — Record Sadaqah — target: 4 taps
Islamic tab → Giving → ⊕ → amount → type → Save. Recipient is optional and private by
default. An "anonymous" toggle stores no recipient at all.

### J9 — Export a report
Reports → pick report → set date range → Export → CSV or PDF → OS share sheet.
CSV cells are sanitised against formula injection before writing.

### J10 — Back up and restore
Settings → Backup → choose a passphrase → app writes a single encrypted `.fmz` file →
share/save it. Restore: Settings → Restore → pick file → enter passphrase → app validates
the file, shows a summary of what it contains, and asks for explicit confirmation before
replacing anything. **Restore never merges silently.**

### J11 — Lock and unlock
App backgrounded for longer than the auto-lock timeout → on return, lock screen → biometric
prompt or PIN → unlocked. Content is obscured in the app switcher.

### J12 — Delete everything
Settings → Delete all data → full explanation of what is destroyed → type `DELETE` to
confirm → second confirmation → database file securely removed and recreated empty.
No soft delete, no hidden copy, no "we kept a backup just in case".

---

## Tone rules for every string in the app

Banned, in any language: *failed, overspent, you should have, bad, wasteful, you only
saved, missed, broke your streak, don't forget again.*

Preferred pattern — state the fact, offer a neutral next step, stop talking:

| Situation | ❌ Never | ✅ Instead |
|---|---|---|
| 85% of a budget used | "Warning! You're about to blow your food budget!" | "You've used 85% of your Food budget. BDT 1,200 remains for 9 days." |
| Over budget | "You failed your budget this month." | "Food spending is BDT 800 above the amount you planned. You can adjust the plan or review the category." |
| Goal behind schedule | "You're falling behind on Hajj!" | "At the current pace this goal would be reached in July 2028. Adjusting the target date or monthly amount will update the plan." |
| Debt due | "Overdue! Pay now!" | "This repayment was due on 12 March." |
| Empty dashboard | "Nothing here yet 😢" | "Add your first transaction to see your summary." |

This table becomes an automated lint rule in Phase 1 — see doc 12, section 7.
