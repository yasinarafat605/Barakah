# Phase 2 Technical Handoff — Core Ledger, Categories & Transaction Foundation

**Document Version:** 2.0.0  
**Date:** 12 September 2026  
**Author:** Technical Lead & System Architect  
**Audience:** Incoming Lead Engineers, Core Collaborators  
**Repository:** `https://github.com/yasinarafat605/Barakah.git`  
**Application Root:** `mobile/`  

---

## 1. Executive Summary

### 1.1 Project Overview
**Barakah** is a privacy-focused, local-first Islamic personal finance mobile application designed for Bangladesh and global Muslim users. The product enforces mathematical zero-drift financial tracking, Shariah compliance (Zakat calculation, Riba avoidance, Halal income/expense categorization), and complete offline-first on-device data custody.

### 1.2 Core Architecture Stack

| Layer | Technology | Specification / Standard | Architectural Role |
|---|---|---|---|
| **Mobile Runtime** | Expo SDK 54 | `expo@~54.0.37` | Managed workflow with clean native prebuild |
| **Framework** | React Native 0.81.5 | React 19.1.0, New Architecture enabled | Cross-platform core engine |
| **Language** | TypeScript ~5.9.2 | Strict Mode (`"strict": true`) | Complete compile-time type safety |
| **Local Database** | SQLite (`expo-sqlite`) | `expo-sqlite@~16.0.10` | Embedded local-first storage (ADR-001) |
| **Data Pragmas** | SQLite Engine | `PRAGMA foreign_keys = ON;`, `WAL` | Relational integrity & concurrent reads |
| **Navigation** | Expo Router | `expo-router@~6.0.24` (File-based) | Unified tab, stack, and modal navigation |
| **Localization** | `react-i18next` & `i18next` | Bangla-first (`bn` primary, `en` secondary) | Zero hardcoded UI strings (ADR-007) |
| **Accounting Pattern** | Paired Transfer Ledger | Dual-entry account transfers | Balanced debit/credit transfer entries |

---

## 2. Milestone Completion Status: Phase 2 Core Foundation (100% Completed)

```
[Phase 1A: Setup & Rebrand]  --> [Phase 1B: Design System]  --> [Phase 2 Milestone: Ledger & Categories]
           DONE                              DONE                                 DONE
  (Barakah identifiers, App)      (Tokens, Money Domain, i18n)     (Startup Gate, Migrations, Repos, UI)
```

### 2.1 Completed Milestone Deliverables

1. **Database Startup Gate (`mobile/src/db/provider.tsx`)**:
   - `DatabaseProvider` root wrapper holds the native splash screen until migrations complete cleanly.
   - Non-concurrent singleton initialization with promise deduplication.
   - Clean retry mechanism on failure: clears the rejected promise before allowing subsequent attempts.
   - Branded loading and error fallback screens; detailed errors kept to `__DEV__`.
   - Native splash failure does not mask underlying database initialization errors.

2. **Migration 002: Categories & Transfer Integrity (`002_categories_and_transfers`)**:
   - Safe rebuild of `transactions` table with full target schema:
     - `amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0)` (enforcing pure integer storage at the SQLite storage boundary, strictly rejecting floats like `10.5`).
     - `type IN ('income', 'expense', 'transfer')`.
     - `chk_tx_transfer_fields` enforcing:
       - When `type = 'transfer'`: `transfer_id IS NOT NULL`, `transfer_role IN ('source', 'destination')`, `related_account_id IS NOT NULL`, `related_account_id <> account_id`, `category_id IS NULL`.
       - When `type IN ('income', 'expense')`: `category_id IS NOT NULL`, `transfer_id IS NULL`, `transfer_role IS NULL`, `related_account_id IS NULL`.
     - Partial unique index: `CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_transfer_pair ON transactions(transfer_id, transfer_role) WHERE transfer_id IS NOT NULL;` (strictly prevents duplicate source or destination roles).
   - Upgraded `categories` table with `name_custom`, `is_archived`, `sort_order`, `is_default`, `created_at`, `updated_at`.
   - Seeding of 20 default categories (8 income, 12 expense) with stable keys.
   - Full migration verification: row-count preservation, data integrity, and `PRAGMA foreign_key_check`.

3. **Categories Repository (`mobile/src/db/categories.ts`)**:
   - Explicit separation of delete vs archive:
     - `archiveCategory(id)`: Sets `is_archived = 1`. Archived categories remain fully visible on historical transactions via LEFT JOIN.
     - `restoreCategory(id)`: Restores `is_archived = 0`.
     - `deleteCategory(id)`: Permanently deletes ONLY unused custom categories. Default categories cannot be deleted. Categories with transaction history are blocked both at repository level and database boundary (`ON DELETE RESTRICT`).
   - Renaming default categories: Preserves stable `name_key`, stores custom label in `name_custom`. Resetting `name_custom` restores default localized label.
   - Atomic reordering via `reorderCategories` in an exclusive transaction (`BEGIN EXCLUSIVE`).
   - Category type locking: Prevents changing category type if transactions exist.

4. **Paired Transfer Ledger & Transaction Repository (`mobile/src/db/transactions.ts`)**:
   - Dual-entry transfer model: Creates two linked positive-minor-unit rows (`source` debit and `destination` credit) with a shared `transfer_id`.
   - **Paired-Transfer Presentation Rule**: The global transactions history feed groups the two internal ledger rows by `transfer_id` into one single logical list item: `Source Account → Destination Account`, displaying one amount. Individual account ledgers display the single relevant transfer leg. Both rows are strictly preserved for balance calculation. Deleting or restoring either leg affects both linked rows atomically within an exclusive transaction. Development integrity warnings are emitted if an unmatched transfer row is encountered.
   - Derived balance query: Computes net balance as `+income -expense +transfer_destination -transfer_source` excluding `deleted_at IS NULL`.
   - Currency compatibility: Transfers strictly enforced between accounts with the same currency. Cross-currency transfers rejected with localized error.
   - Accessible restore UX: Floating undo snackbar displayed immediately upon soft-deletion with a 6-second auto-dismiss timer and atomic paired restoration.

5. **Bilingual Money Parsing (`mobile/src/domain/money.ts`)**:
   - `parseMoneyInput(rawInput, decimalPlaces)`:
     - Accepts Latin (`0-9`) and Bengali (`০-৯`) digits.
     - Accepts either `.` or `,` as decimal separator; rejects input with both.
     - Zero floating-point arithmetic: pure BigInt string parsing.
     - Rejects exponent notation (`1e3`), internal whitespace, signs (`+`, `-`), zero/negative values, and values outside safe integer bounds.

6. **Add Transaction Modal (`mobile/app/modal.tsx`)**:
   - Accessible 3-mode selector (Expense, Income, Transfer).
   - Real-time bilingual numeral input with formatted live preview (`new Money(...).format(locale)`).
   - Date & Time controls: Defaults to local current date and time; editable before saving; quick-select Today and Yesterday chips; invalid date/time validation preventing submission; localized date/time preview in English and Bengali.
   - Optional note: whitespace-only notes transformed to `null`; 200-character limit enforced with live counter.
   - Account selectors (Single for Income/Expense; From/To with cross-currency and same-account validation for Transfer).
   - Category selector dynamically filtered by type.
   - Dirty-state tracking with discard confirmation alert.
   - Double-submission lock (`isSubmitting` state).

7. **Multi-Currency Account Aggregation (`mobile/app/(tabs)/accounts.tsx`)**:
   - **Currency Aggregation Rule**: Net balances are strictly grouped by currency (e.g. BDT, USD, GBP). Balances in different currencies are NEVER summed into a single mixed-currency total without explicit exchange-rate conversion.

8. **Transactions History (`mobile/app/(tabs)/transactions.tsx`)**:
   - Ordered chronological transaction feed with grouped paired transfers.
   - Visual distinction not reliant on color alone: distinct iconography + text badges for Income, Expense, and Transfer.
   - Soft-delete with contextual confirmation and accessible undo banner.
   - Pull-to-refresh and empty state with quick-add action.

---

## 3. Test & Verification Matrix

### 3.1 Automated Test Suite (Jest + In-Memory SQLite Adapter)

Run Command: `npm test` inside `mobile/`

```text
PASS src/domain/__tests__/money.test.ts (19 tests)
PASS src/domain/__tests__/money-parsing.test.ts (19 tests)
PASS src/db/__tests__/startup.test.ts (2 tests)
PASS src/db/__tests__/migration-002.test.ts (7 tests)
PASS src/db/__tests__/transactions.test.ts (11 tests)
PASS src/db/__tests__/db.test.ts (9 tests)
PASS src/db/__tests__/categories.test.ts (10 tests)
PASS src/db/__tests__/accounts.test.ts (14 tests)

Test Suites: 8 passed, 8 total
Tests:       91 passed, 91 total
Snapshots:   0 total
Time:        14.676 s
```

### 3.2 TypeScript & Lint Health
- `npx tsc --noEmit`: Exited with code 0 (0 errors).
- `npm run lint`: Exited with code 0 (0 errors, 0 warnings).

### 3.3 Build Verification
- **Web Export:** `npx expo export -p web -c` succeeded (13 static routes generated, bundle size: 2.48 MB).
- **Android Prebuild:** `npx expo prebuild -p android --no-install` succeeded cleanly.

### 3.4 Platform Status & Testing Integrity

| Verification Target | Status | Detail / Result |
|---|---|---|
| **Unit Tests (Logic & Money)** | **VERIFIED** | 38/38 unit tests passing |
| **SQLite Integration Tests** | **VERIFIED** | 53/53 integration tests passing (`better-sqlite3` native engine) |
| **Android Prebuild** | **VERIFIED** | Clean prebuild output with `money.barakah.app` package |
| **Web Static Export** | **VERIFIED** | 13 static pages, service worker, asset manifest |
| **Web Server Headers** | **VERIFIED** | `COOP: same-origin`, `COEP: require-corp` verified |
| **Web SQLite Runtime (Browser)** | **UNVERIFIED** | Manual test protocol documented in `docs/qa/web-sqlite-manual-verification.md`. Remains marked UNVERIFIED until physically executed in a live browser. |

---

## 4. Architectural Rules for Incoming Developers

1. **Integer Minor Units Only**: Never introduce floating-point numbers for money storage. Enforce `typeof(amount) = 'integer'` at the database layer and `Money` in domain logic.
2. **Paired Transfer Ledger**: Transfers must always create two rows sharing a single `transfer_id`, both with positive integer minor units. Signs are derived in balance queries, never stored inverted.
3. **Paired-Transfer Presentation**: The global feed must always present paired transfer rows as one logical item (`Source → Destination`). Individual account ledgers display the relevant leg.
4. **Currency Aggregation Rule**: Never calculate a mixed-currency grand total. Display totals grouped by currency unless explicit exchange rates exist.
5. **Database Constraints Boundary**: Always complement repository validation with database-level CHECK (`typeof(amount) = 'integer'`, `chk_tx_transfer_fields`) and FOREIGN KEY constraints (`ON DELETE RESTRICT`).
6. **Exclusive Transactions**: Always wrap multi-row mutations (paired transfers, category reordering, atomic soft-delete/restore) in `withExclusiveTransactionAsync` (`runExclusiveTransaction`).
7. **No Blind Categorization for Transfers**: Transfers have `category_id = NULL` by database CHECK constraint.
8. **Soft-Delete with Undo**: All deletions must be reversible through a soft-deletion pattern with clear, accessible undo capability.

---

## 5. Remaining Manual QA Checklist

Refer to `docs/qa/web-sqlite-manual-verification.md` for full instructions:
- [ ] 1. Run local HTTP server with COOP/COEP headers (`node -e ...` or `npx serve dist -l 3000`).
- [ ] 2. Open `http://127.0.0.1:3000` in Google Chrome / Firefox.
- [ ] 3. Create two accounts (`Primary Cash`, `Bank Savings`).
- [ ] 4. Record an expense with custom date, time, and note.
- [ ] 5. Hard refresh (`Ctrl + F5`) to test IndexedDB reload persistence.
- [ ] 6. Execute account transfer and verify single-item list presentation and atomic undo.
- [ ] 7. Inspect DevTools Console for zero runtime exceptions.
- [ ] 8. Inspect IndexedDB object store in Application tab.

