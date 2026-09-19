# 05 — Data Model

SQLite. All money as `INTEGER` minor units. All timestamps as `INTEGER` Unix milliseconds
UTC. All primary keys as `TEXT` UUID v4 generated on device.

## Universal column conventions

Every table below carries these unless stated otherwise:

| Column | Type | Purpose |
|---|---|---|
| `id` | TEXT PK | UUID v4, generated on the device. Never reused. |
| `cloud_id` | TEXT NULL | Reserved for [LATER] sync. Always NULL in the MVP. |
| `household_id` | TEXT NULL | Reserved for [LATER] households. Always NULL in the MVP. |
| `created_at` | INTEGER NOT NULL | Unix ms |
| `updated_at` | INTEGER NOT NULL | Unix ms, touched on every write |
| `deleted_at` | INTEGER NULL | Soft delete. **Every query must filter `deleted_at IS NULL`.** |
| `sync_version` | INTEGER NOT NULL DEFAULT 0 | Reserved for [LATER] |

**Why soft delete.** A user who deletes a transaction and then discovers their balance is
wrong needs a recovery path. Soft-deleted rows are purged permanently after 30 days by a
maintenance job, or immediately by "Delete all data".

---

## 1. Identity and device

### `profiles` — the local user
One row in the MVP. Multi-row when households arrive.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `display_name` | TEXT NULL | Local only, never transmitted |
| `avatar_emoji` | TEXT NULL | Avoids storing an image |
| `is_current` | INTEGER NOT NULL | 0/1 |

### `devices`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Stable device UUID stored in SecureStore |
| `platform` | TEXT | `android` / `ios` |
| `model_name` | TEXT NULL | For the [LATER] device list in sync settings |
| `last_seen_at` | INTEGER | |

### `households` [LATER — table created, unused in MVP]
`id`, `name`, `owner_profile_id`, `currency`, `created_at`.

### `household_members` [LATER — table created, unused in MVP]
`id`, `household_id`, `profile_id`, `role` (`admin`/`spouse`/`adult`/`teen`/`viewer`),
`invited_at`, `joined_at`, `status`.

---

## 2. Money structure

### `currencies` — seeded reference table
| Column | Type | Notes |
|---|---|---|
| `code` | TEXT PK | ISO 4217, e.g. `BDT` |
| `minor_units` | INTEGER NOT NULL | BDT 2, KWD 3, JPY 0 |
| `symbol` | TEXT | `৳` |
| `name_en` | TEXT | |
| `name_bn` | TEXT | |

**This table is why no code hardcodes ×100.**

### `accounts`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `profile_id` | TEXT NOT NULL FK→profiles | |
| `name` | TEXT NOT NULL | |
| `type` | TEXT NOT NULL | `cash`\|`bank`\|`mobile_wallet`\|`savings`\|`business`\|`custom` |
| `currency_code` | TEXT NOT NULL FK→currencies | One currency per account |
| `opening_balance_minor` | INTEGER NOT NULL DEFAULT 0 | Can be negative |
| `cached_balance_minor` | INTEGER NOT NULL DEFAULT 0 | Optimisation only; derived value always wins |
| `icon` | TEXT NULL | Icon key, not a file |
| `color` | TEXT NULL | Hex from the approved palette |
| `sort_order` | INTEGER NOT NULL DEFAULT 0 | |
| `is_archived` | INTEGER NOT NULL DEFAULT 0 | |
| `exclude_from_totals` | INTEGER NOT NULL DEFAULT 0 | e.g. a business account the user wants out of personal net worth |
| `notes` | TEXT NULL | Treated as sensitive — see doc 06 |

Constraint: `UNIQUE(profile_id, name) WHERE deleted_at IS NULL`.

### `categories`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `profile_id` | TEXT NOT NULL | |
| `parent_id` | TEXT NULL FK→categories | One level of nesting only, enforced in code |
| `name_key` | TEXT NULL | Set for the 23 seeded categories so they follow the app language |
| `name_custom` | TEXT NULL | Set for user-created categories; stored as typed |
| `kind` | TEXT NOT NULL | `income`\|`expense`\|`both` |
| `icon` | TEXT NULL | |
| `color` | TEXT NULL | |
| `sort_order` | INTEGER NOT NULL | |
| `is_system` | INTEGER NOT NULL DEFAULT 0 | Seeded categories cannot be deleted, only archived |
| `is_archived` | INTEGER NOT NULL DEFAULT 0 | |
| `zakat_relevant` | INTEGER NOT NULL DEFAULT 0 | Flags Zakat/Sadaqah categories for reporting |

**Why `name_key` and `name_custom` are separate.** A seeded category must display as
"Groceries" in English and "মুদি বাজার" in Bangla — so it stores a translation key, not text.
A user-created category stores the literal text the user typed and is never translated.
Storing both in one column is a bug waiting to happen.

Seeded categories (23): Salary, Freelance income, Business income, Gifts received, Food &
groceries, Housing, Utilities, Transportation, Education, Healthcare, Family support,
Personal care, Business expenses, Debt repayment, Savings, Zakat, Sadaqah, Mosque &
community, Gifts given, Subscriptions, Entertainment, Travel, Other.

### `tags` and `transaction_tags`
`tags`: `id`, `profile_id`, `name`, `color`, `sort_order`.
`transaction_tags`: `transaction_id`, `tag_id`, composite PK. Many-to-many.

---

## 3. Transactions — the core of the app

### `transactions`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `profile_id` | TEXT NOT NULL | |
| `type` | TEXT NOT NULL | `income`\|`expense`\|`transfer` |
| `amount_minor` | INTEGER NOT NULL | **Always positive.** Direction comes from `type` and the account columns. |
| `currency_code` | TEXT NOT NULL | |
| `from_account_id` | TEXT NULL FK→accounts | NULL for income |
| `to_account_id` | TEXT NULL FK→accounts | NULL for expense |
| `category_id` | TEXT NULL FK→categories | NULL for transfers; NULL when the transaction is split |
| `occurred_at` | INTEGER NOT NULL | Unix ms of the transaction date |
| `note` | TEXT NULL | **Sensitive** |
| `is_split` | INTEGER NOT NULL DEFAULT 0 | When 1, the split rows are authoritative for categories |
| `recurring_rule_id` | TEXT NULL FK→recurring_rules | Set on generated instances |
| `debt_payment_id` | TEXT NULL FK→debt_payments | Links a repayment transaction to its debt |
| `goal_contribution_id` | TEXT NULL FK→goal_contributions | Links a savings transfer to its goal |
| `giving_id` | TEXT NULL FK→giving_records | Links a charity expense to its giving record |
| `zakat_payment_id` | TEXT NULL FK→zakat_payments | |

**Invariants — enforced by CHECK constraints and by a Zod schema before every insert:**

1. `amount_minor > 0` always.
2. `type='income'` → `from_account_id IS NULL AND to_account_id IS NOT NULL`
3. `type='expense'` → `from_account_id IS NOT NULL AND to_account_id IS NULL`
4. `type='transfer'` → both NOT NULL, and `from_account_id <> to_account_id`
5. `type='transfer'` → `category_id IS NULL`
6. Both accounts of a transfer must share `currency_code`. Cross-currency transfer is
   [LATER] and is rejected with a clear message in the MVP.
7. If `is_split = 1`, `category_id IS NULL` and the sum of its splits must equal
   `amount_minor` exactly. Checked in the service layer inside the same DB transaction.

**Indexes (required before Phase 2 sign-off):**
```sql
CREATE INDEX idx_tx_profile_date    ON transactions(profile_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_from_account    ON transactions(from_account_id, occurred_at)  WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_to_account      ON transactions(to_account_id, occurred_at)    WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_category_date   ON transactions(category_id, occurred_at)      WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_type_date       ON transactions(type, occurred_at)             WHERE deleted_at IS NULL;
```
Search uses a `transactions_fts` FTS5 virtual table over `note` only, kept in sync by
triggers. [RECOMMENDED] — if FTS5 proves awkward in Expo Go, fall back to `LIKE` with an
index; note search over a personal dataset is small.

### `transaction_splits`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `transaction_id` | TEXT NOT NULL FK→transactions ON DELETE CASCADE | |
| `category_id` | TEXT NOT NULL FK→categories | |
| `amount_minor` | INTEGER NOT NULL | > 0 |
| `note` | TEXT NULL | Sensitive |

Rule: `SUM(splits.amount_minor) = transactions.amount_minor`. Any remainder from a
percentage-based split is added to the largest split, and this rule is unit tested.

### `recurring_rules`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `template_json` | TEXT NOT NULL | A validated JSON snapshot of the transaction to create |
| `frequency` | TEXT NOT NULL | `daily`\|`weekly`\|`monthly`\|`yearly`\|`custom` |
| `interval_count` | INTEGER NOT NULL DEFAULT 1 | "every 2 weeks" |
| `day_of_month` | INTEGER NULL | 1–31; a rule for day 31 in February resolves to the last day |
| `weekday` | INTEGER NULL | 0–6 |
| `starts_on` | INTEGER NOT NULL | |
| `ends_on` | INTEGER NULL | |
| `next_run_at` | INTEGER NOT NULL | |
| `last_run_at` | INTEGER NULL | |
| `auto_create` | INTEGER NOT NULL DEFAULT 0 | 0 = only remind, do not create silently |
| `is_paused` | INTEGER NOT NULL DEFAULT 0 | |

[DECIDED] `auto_create` defaults to **0**. An app must not invent transactions the user did
not make. It reminds; the user confirms.

---

## 4. Budgets

### `budgets`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `profile_id` | TEXT NOT NULL | |
| `period_type` | TEXT NOT NULL | `monthly` in MVP; `weekly`/`custom` reserved |
| `period_start` | INTEGER NOT NULL | Respects the user's financial month start day |
| `period_end` | INTEGER NOT NULL | Exclusive |
| `total_amount_minor` | INTEGER NULL | Overall cap; NULL = category budgets only |
| `currency_code` | TEXT NOT NULL | |
| `rollover_enabled` | INTEGER NOT NULL DEFAULT 0 | |
| `rollover_from_budget_id` | TEXT NULL | |
| `notes` | TEXT NULL | |

`UNIQUE(profile_id, period_start) WHERE deleted_at IS NULL`.

### `budget_categories`
`id`, `budget_id` FK, `category_id` FK, `amount_minor`, `weekly_limit_minor` NULL,
`rollover_amount_minor` DEFAULT 0, `alert_threshold_bp` DEFAULT 8000 (80.00%).

Spent amounts are **never stored** — they are queried live from transactions so they can
never drift out of date.

---

## 5. Savings goals

### `savings_goals`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `profile_id` | TEXT NOT NULL | |
| `name` | TEXT NOT NULL | |
| `preset_key` | TEXT NULL | `hajj`, `umrah`, `emergency`, `qurbani`… drives the icon |
| `target_amount_minor` | INTEGER NOT NULL | > 0 |
| `currency_code` | TEXT NOT NULL | |
| `target_date` | INTEGER NULL | |
| `contribution_frequency` | TEXT NULL | `weekly`\|`monthly`\|`custom` |
| `linked_account_id` | TEXT NULL FK→accounts | |
| `status` | TEXT NOT NULL | `active`\|`completed`\|`archived` |
| `notes` | TEXT NULL | |

`current_amount_minor` is **derived**: `SUM(contributions) − SUM(withdrawals)`.

### `goal_contributions`
`id`, `goal_id` FK, `amount_minor` (positive = contribution, negative = withdrawal),
`occurred_at`, `transaction_id` NULL FK, `note` NULL.

Using one signed column rather than two tables keeps the running total trivially correct.

### `goal_milestones`
`id`, `goal_id` FK, `percent_bp` (2500/5000/7500/10000), `reached_at` NULL, `note`.

---

## 6. Debts and receivables

### `debts`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `profile_id` | TEXT NOT NULL | |
| `direction` | TEXT NOT NULL | `i_owe` \| `owed_to_me` |
| `counterparty_name` | TEXT NOT NULL | **Sensitive** |
| `counterparty_note` | TEXT NULL | **Sensitive** |
| `original_amount_minor` | INTEGER NOT NULL | > 0 |
| `currency_code` | TEXT NOT NULL | |
| `started_on` | INTEGER NOT NULL | |
| `due_date` | INTEGER NULL | |
| `is_qard_hasan` | INTEGER NOT NULL DEFAULT 0 | User-applied label only. The app never infers it. |
| `has_additional_charges` | INTEGER NOT NULL DEFAULT 0 | Neutral flag; see below |
| `linked_account_id` | TEXT NULL | |
| `status` | TEXT NOT NULL | `active`\|`settled`\|`written_off`\|`archived` |
| `reminder_enabled` | INTEGER NOT NULL DEFAULT 0 | |
| `reminder_days_before` | INTEGER NULL | |
| `notes` | TEXT NULL | **Sensitive** |

`remaining_amount_minor` is **derived**: `original − SUM(payments)`.

**Interest handling [DECIDED].** If a user's real obligation includes interest or fees, they
record it through `debt_payments.charge_amount_minor` — a neutral "additional charge" line.
The app:
- does not name it "interest" or "riba" in any language,
- does not compute an interest schedule,
- does not suggest repayment orderings that optimise interest cost,
- does not warn, praise, or comment on it in any way.
It is a record-keeping field, nothing more. [NEEDS SCHOLAR REVIEW] — see doc 14, item S-7.

### `debt_payments`
`id`, `debt_id` FK, `amount_minor` (principal portion, > 0), `charge_amount_minor`
(DEFAULT 0, neutral additional charge), `paid_at`, `transaction_id` NULL FK, `note` NULL.

### `debt_schedule_items`
`id`, `debt_id` FK, `sequence`, `due_date`, `amount_minor`, `status`
(`pending`/`paid`/`partial`/`skipped`), `paid_payment_id` NULL.

---

## 7. Zakat

Snapshots are **immutable**. Once saved, a calculation is never edited — a new one is made.
This is what makes a saved figure defensible a year later.

### `zakat_calculations`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `profile_id` | TEXT NOT NULL | |
| `calculation_date` | INTEGER NOT NULL | Gregorian ms |
| `hijri_year` | INTEGER NULL | |
| `hijri_month` | INTEGER NULL | |
| `hijri_day` | INTEGER NULL | |
| `calendar_preference` | TEXT NOT NULL | `hijri`\|`gregorian` |
| `hawl_start_date` | INTEGER NULL | |
| `nisab_basis` | TEXT NOT NULL | `gold`\|`silver`\|`manual` — **no default; user must choose** |
| `nisab_amount_minor` | INTEGER NOT NULL | Computed or manually entered |
| `gold_price_per_gram_minor` | INTEGER NULL | Manually entered by the user |
| `silver_price_per_gram_minor` | INTEGER NULL | Manually entered by the user |
| `price_source_note` | TEXT NULL | Free text: where the user got the price |
| `price_entered_at` | INTEGER NULL | |
| `gold_nisab_grams_mg` | INTEGER NOT NULL | Default 87,480 mg (87.48 g) — configurable |
| `silver_nisab_grams_mg` | INTEGER NOT NULL | Default 612,360 mg (612.36 g) — configurable |
| `zakat_rate_bp` | INTEGER NOT NULL | Default 250 = 2.5% — configurable |
| `total_assets_minor` | INTEGER NOT NULL | Computed, frozen |
| `total_deductions_minor` | INTEGER NOT NULL | Computed, frozen |
| `net_zakatable_minor` | INTEGER NOT NULL | Computed, frozen |
| `meets_nisab` | INTEGER NOT NULL | 0/1 |
| `zakat_due_minor` | INTEGER NOT NULL | 0 when Nisab not met |
| `currency_code` | TEXT NOT NULL | |
| `methodology_version` | TEXT NOT NULL | e.g. `fa-zakat-1.0.0` |
| `breakdown_json` | TEXT NOT NULL | Full step-by-step trace, frozen at save time |
| `status` | TEXT NOT NULL | `draft`\|`saved` |
| `notes` | TEXT NULL | |

[NEEDS SCHOLAR REVIEW] The Nisab weights and the rate are stored as *data*, not code,
precisely so a scholar's correction is a configuration change and not a rewrite.

### `zakat_assets`
`id`, `calculation_id` FK, `asset_type` (`cash`\|`bank`\|`mobile_wallet`\|`gold`\|`silver`\|
`business_inventory`\|`trade_receivable`\|`investment`\|`custom`), `label` NULL,
`amount_minor` NULL, `weight_mg` NULL, `purity_bp` NULL (24k = 10000),
`computed_value_minor`, `source_account_id` NULL FK, `is_manual`, `note` NULL.

Gold and silver are entered by **weight and purity**, and the value is computed from the
user's entered price. Entering a guessed lump-sum value is the most common source of wrong
Zakat, so weight entry is the default path.

### `zakat_deductions`
`id`, `calculation_id` FK, `deduction_type` (`short_term_liability`\|`due_expense`\|`custom`),
`label`, `amount_minor`, `source_debt_id` NULL FK, `note` NULL.

### `zakat_payments`
`id`, `calculation_id` NULL FK, `amount_minor`, `paid_at`, `recipient_label` NULL
(**sensitive**), `is_anonymous`, `transaction_id` NULL FK, `giving_id` NULL FK, `note` NULL.

Partial payments are the norm — many people pay Zakat across the year. `calculation_id` is
nullable so a payment can be recorded without a snapshot.

### `metal_prices`
`id`, `metal` (`gold`/`silver`), `price_per_gram_minor`, `currency_code`, `purity_bp`,
`recorded_at`, `source_note`, `entered_by` (`user` in MVP; `feed` reserved [LATER]).

---

## 8. Giving

### `giving_records`
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `profile_id` | TEXT NOT NULL | |
| `giving_type` | TEXT NOT NULL | `sadaqah`\|`zakat`\|`family_assistance`\|`mosque`\|`community`\|`emergency`\|`gift`\|`custom` |
| `custom_type_label` | TEXT NULL | |
| `amount_minor` | INTEGER NOT NULL | |
| `currency_code` | TEXT NOT NULL | |
| `occurred_at` | INTEGER NOT NULL | |
| `recipient_label` | TEXT NULL | **Highly sensitive.** Nickname, never a full identity. |
| `is_anonymous` | INTEGER NOT NULL DEFAULT 0 | When 1, `recipient_label` must be NULL — enforced by CHECK |
| `transaction_id` | TEXT NULL FK | |
| `zakat_payment_id` | TEXT NULL FK | |
| `notes` | TEXT NULL | **Sensitive** |

### `giving_targets`
`id`, `profile_id`, `period_type`, `target_amount_minor`, `currency_code`, `starts_on`,
`ends_on` NULL, `giving_type` NULL.

Framed as a personal plan, never as an obligation, and never with a completion score.

---

## 9. Attachments, notifications, settings, audit

### `attachments`
`id`, `entity_type` (`transaction`/`debt`/`giving`/`zakat`), `entity_id`, `file_uri`
(app sandbox path only), `mime_type`, `byte_size`, `sha256`, `original_name` NULL,
`is_encrypted`, `created_at`.

Files live in the app's private document directory, never in shared storage. `sha256`
detects corruption at restore time. Type and size are validated on import (doc 06 §6).

### `notifications`
`id`, `type`, `title_key`, `body_key`, `params_json`, `entity_type` NULL, `entity_id` NULL,
`scheduled_for`, `delivered_at` NULL, `read_at` NULL, `is_dismissed`.

Text is stored as **keys plus parameters**, never as rendered sentences — otherwise a
notification created in Bangla would still be Bangla after the user switches to English.

### `settings`
Key–value: `key` TEXT PK, `value_json` TEXT, `updated_at`. Typed accessors wrap it so the
rest of the app never touches raw JSON.

Keys: `language`, `currency_code`, `number_format`, `calendar_preference`, `theme`,
`financial_month_start_day`, `privacy_mode_enabled`, `auto_lock_seconds`,
`biometric_enabled`, `pin_enabled`, `onboarding_completed`, `zakat_nisab_basis` (NULL until
explicitly chosen), `zakat_methodology_version`, `notifications_enabled`,
`last_backup_at`, `db_schema_version`.

### `audit_events`
`id`, `event_type`, `entity_type` NULL, `entity_id` NULL, `device_id`, `occurred_at`,
`metadata_json` (**redacted — IDs and counts only, never amounts or names**).

Logged: PIN set/changed/removed, biometric toggled, backup created, restore performed,
delete-all executed, export performed, failed unlock attempts, [LATER] sync enabled/disabled.
Not logged: any transaction content.

### `sync_metadata` and `sync_conflicts` [LATER — created empty]
`sync_metadata`: `entity_type`, `last_synced_at`, `last_cursor`, `device_id`.
`sync_conflicts`: `id`, `entity_type`, `entity_id`, `local_json`, `remote_json`,
`detected_at`, `resolved_at` NULL, `resolution`.

### `schema_migrations`
`version` INTEGER PK, `name`, `applied_at`, `checksum`.

---

## 10. Relationship summary

```
profiles ──1:N──▶ accounts ──1:N──▶ transactions ◀──N:1── categories
    │                                    │  │  │
    │                                    │  │  └──1:N──▶ transaction_splits
    │                                    │  └────N:M────▶ tags
    │                                    └──N:1──▶ recurring_rules
    │
    ├──1:N──▶ budgets ──1:N──▶ budget_categories ──N:1──▶ categories
    ├──1:N──▶ savings_goals ──1:N──▶ goal_contributions ──0:1──▶ transactions
    │                       └──1:N──▶ goal_milestones
    ├──1:N──▶ debts ──1:N──▶ debt_payments ──0:1──▶ transactions
    │               └──1:N──▶ debt_schedule_items
    ├──1:N──▶ zakat_calculations ──1:N──▶ zakat_assets
    │                            ├──1:N──▶ zakat_deductions
    │                            └──1:N──▶ zakat_payments ──0:1──▶ giving_records
    ├──1:N──▶ giving_records ──0:1──▶ transactions
    └──1:N──▶ giving_targets

households ──1:N──▶ household_members ──N:1──▶ profiles      [LATER]
any entity ──1:N──▶ attachments                              (polymorphic by entity_type)
```

**Cross-links that matter.** A debt payment, a goal contribution, a giving record, and a
Zakat payment can each *optionally* point at a real transaction. This is how the app avoids
double counting: paying BDT 5,000 of Zakat creates **one** expense transaction, which is
referenced by a `giving_record` and a `zakat_payment`. It is not three separate amounts.
A test suite specifically checks that no linked record inflates any total.

---

## 11. Migration policy [DECIDED]

- Migrations are numbered SQL files: `001_initial.sql`, `002_add_x.sql`. Never edited once
  released — a mistake is fixed by a new migration.
- Applied inside a transaction; a failed migration rolls back completely.
- `PRAGMA user_version` tracks the applied version.
- Before any migration runs, the app writes an automatic pre-migration backup of the
  database file and keeps the last three.
- Every migration gets a test that builds the previous schema, seeds realistic data, runs
  the migration, and asserts the data survived. **A migration without a test does not ship.**
- `PRAGMA foreign_keys = ON` on every connection. `PRAGMA journal_mode = WAL`.

---

## Phase 5 implemented planning schema (Migration 008)

Migration 008 is the authoritative implemented model for the local planning foundation:

- `transactions.occurred_on` preserves the user-facing `YYYY-MM-DD` civil date separately from the audit timestamp. Existing rows are backfilled from UTC, the only deterministic source available.
- `accounts.archived_at` is nullable. Archived accounts remain readable but reject new money movement.
- A budget's only archival state is `archived_at`: null means active and non-null means archived. `deleted_at` remains independent.
- `budget_categories.budget_id` uses `ON DELETE RESTRICT`; planning history is never cascade-deleted.
- Budget actuals derive from the transaction ledger. Debt-principal expense categories are excluded by default and included exactly once only when explicitly allocated. Debt income, transfers, and non-cash adjustments never consume the expense limit.
- Savings allocations are signed `savings_goal_entries` using `allocation_only`, `existing_transfer`, or `owned_transfer` evidence modes.
- The full unique index on non-null `savings_goal_entries.transaction_id` includes soft-deleted rows, so historical transfer evidence cannot be reassigned. Restore revives the original row.
- Derived money aggregation and progress calculations use `BigInt` intermediates and fail outside JavaScript safe-integer boundaries.

## Phase 5 integrity correction (Migration 009)

- Existing planning and transaction civil dates are preflight-validated before trigger changes. Invalid data aborts and rolls back the migration.
- `transactions.occurred_on` is mandatory for every new insert. Migration 008's UTC-derived insert default is historical compatibility behavior only.
- Strict insert/update Gregorian triggers protect budget start/end dates, nullable goal target dates, and goal-entry dates.
- Backup envelope format remains version 1. Schemas 8 and 9 use manifest v2; schema-8 restores upgrade through Migration 009 in staging.
- The canonical checksum registry and frozen-source fixture cover SQL and executable TypeScript sources for Migrations 001–009.
