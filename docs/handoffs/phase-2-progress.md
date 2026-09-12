# Phase 2 Technical Handoff — Core Ledger & Architecture Status

**Document Version:** 1.0.0  
**Date:** 12 September 2026  
**Author:** Technical Lead & System Architect  
**Audience:** Incoming Lead Engineers, Core Collaborators  
**Repository Path:** `D:\Friday\friday-amanah`  
**Target Application:** `D:\Friday\friday-amanah\mobile`  

---

## 1. Executive Summary

### 1.1 Project Overview
**Friday Amanah** is a privacy-first, local-first Islamic personal finance mobile application tailored for Bangladesh and global Muslim users. The product enforces mathematical zero-drift financial tracking, authentic Shariah compliance (Zakat calculation, Riba avoidance, Halal income/expense categorization), and offline-first data custody.

### 1.2 Core Architecture Stack

| Layer | Technology | Specification / Standard | Architectural Role |
|---|---|---|---|
| **Mobile Runtime** | Expo SDK 54 | `expo@~54.0.37` | Managed workflow with prebuild capability |
| **Framework** | React Native 0.81.5 | React 19.1.0, New Architecture enabled | Cross-platform core engine |
| **Language** | TypeScript ~5.9.2 | Strict Mode (`"strict": true`) | Complete compile-time type safety |
| **Local Database** | SQLite (`expo-sqlite`) | `expo-sqlite@~16.0.10` | Embedded local-first storage (ADR-001) |
| **Data Pragmas** | SQLite Engine | `PRAGMA foreign_keys = ON;`, `WAL` | Relational integrity & concurrent reads |
| **Navigation** | Expo Router | `expo-router@~6.0.24` (File-based) | Unified tab, stack, and modal navigation |
| **Localization** | `react-i18next` & `i18next` | Bangla-first (`bn` primary, `en` secondary) | Zero hardcoded UI strings (ADR-007) |
| **Repository Root** | Git Monorepo Root | `D:\Friday\friday-amanah` | Unified tracking across docs, brand & mobile |

### 1.3 Key Architectural Decisions (ADR Reference)
- **ADR-001 (Local-First):** Zero server dependency in MVP. All user data stays on device.
- **ADR-003 (Repository Pattern):** Parameterized SQL queries with explicit domain mappers. No heavy ORMs (Drizzle/Prisma rejected to avoid native build overhead and runtime drift).
- **ADR-004 (Integer-Only Minor Units):** All monetary figures stored as minor units (poisha/cents). Zero floating-point representation.
- **ADR-005 (Derived Balances):** Account balances are computed on demand (`initial_balance + sum(income) - sum(expense)`). Stored running totals are prohibited to prevent drift bugs.
- **ADR-006 (Honest Security):** Phase 1–6 relies on OS sandbox + FDE. Whole-database SQLCipher encryption and encrypted backup scheduled for Phase 7.
- **ADR-015 (Brand Mark Integrity):** `BrandMark` component governs logo display with hard clear-space and aspect ratio rules.

---

## 2. Exact Current Status

```
[Phase 1A: Setup & Launch]       --> [Phase 1B: Foundation & Tokens] --> [Phase 2: Ledger Core]
              DONE                                 DONE                      IN PROGRESS (Blocker identified)
        (Expo 54, Strict TS)           (BrandMark, Theme, Money Domain)         (Accounts Repo, Derived Balances)
```

### 2.1 Milestone Sign-off (Phase 1A & Phase 1B: 100% Completed)
- **Phase 1A (Launch & Runtime):** Project initialized under Expo SDK 54. React Native New Architecture validated on physical Android hardware and BlueStacks emulation. Clean tree with zero unmet peer dependencies.
- **Phase 1B (Design System, Tokens & i18n):**
  - **Brand Assets:** 56 authoritative assets mapped in `Friday_Amanah_Brand_Assets/` across 6 directories (`01_Logos`, `02_App_Icons/Dark`, `02_App_Icons/Light`, `03_Web_Icons`, `04_Social_Media`, `05_Brand_Collateral`).
  - **BrandMark Component:** Implemented at `mobile/src/components/BrandMark.tsx`. Supports `icon`, `horizontal`, `stacked`, and `primary` variants with strict minimum pixel constraints and code-enforced 25% clear space.
  - **Color Tokens:** Implemented at `mobile/src/constants/colors.ts` and `mobile/src/constants/theme.ts`. Deep Emerald (`#087A62`, light action, 5.06:1 AA) and Midnight Navy (`#0A1D37`, dark surface & text, 16.14:1 AAA).
  - **Bilingual i18n:** `mobile/src/locales/bn.json` and `mobile/src/locales/en.json` integrated via `mobile/src/lib/i18n.ts`.

### 2.2 Money Domain Object (`mobile/src/domain/money.ts`)
The `Money` value object provides immutable financial arithmetic strictly aligned with ADR-004:
- **Integer Enforcement:** Throws `TypeError` on any floating-point number at construction.
- **Poisha Representation:** 1 BDT = 100 Poisha. All calculations execute within `Number.isSafeInteger` boundaries.
- **Non-Lossy Ratio Allocation (`allocate`):** Distributes money across arbitrary ratios using the Largest Remainder Method (Hamilton/Hare algorithm), guaranteeing zero poisha lost to fractional rounding.
- **Formatting:** Dual-numeral support (`toBengaliNumerals`) rendering Bengali digits (`০-৯`) and currency glyph `৳` dynamically based on active locale.

### 2.3 Automated Test Suite Health: 40/40 Tests Passing
The suite executes via Jest + `better-sqlite3` mock adapter (`mobile/src/db/test-adapter.ts`), guaranteeing instant in-memory verification without native SQLite binaries:

```
PASS src/domain/__tests__/money.test.ts (19 tests)
PASS src/db/__tests__/db.test.ts (9 tests)
PASS src/db/__tests__/accounts.test.ts (12 tests)

Test Suites: 3 passed, 3 total
Tests:       40 passed, 40 total
Snapshots:   0 total
Time:        17.311 s
```

### 2.4 Phase 2 Progress (Accounts & Balances)
- **Database Schema (`001_initial_schema.ts`):** `accounts`, `categories`, `transactions` tables defined with strict foreign key constraints and indexed foreign keys.
- **Accounts Repository (`mobile/src/db/accounts.ts`):** Implements `createAccount`, `getAccountById`, `getAccountsWithBalances`, `updateAccount`, and `deleteAccount`.
- **Derived Balances (ADR-005):** Computed via SQL aggregate queries joining `accounts` with `transactions`:
  $$\text{Current Balance} = \text{initial\_balance} + \sum(\text{Income}) - \sum(\text{Expense})$$
- **UI Screen (`mobile/app/(tabs)/accounts.tsx`):** Complete accounts dashboard with net balance aggregation, account card lists, creation modal, and currency input parsing.

---

## 3. Current Blocker & Pending Immediate Fix

### 3.1 Issue Description: Startup SQLite Migration Race Condition
When launching the application on a fresh install or opening `mobile/app/(tabs)/accounts.tsx`, the screen invokes `loadAccounts() -> getAccountsWithBalances()` during the component mount (`useFocusEffect`). 

Because SQLite migrations in `mobile/src/db/migrations.ts` (`runMigrations`) are currently decoupled from the Expo Router startup sequence in `mobile/app/_layout.tsx`, SQL queries execute against an empty database before `001_initial_schema` has run.

**Fatal Exception:**
```
SQLite Error: no such table: accounts (code 1)
  at getAccountsWithBalances (mobile/src/db/accounts.ts:133)
  at loadAccounts (mobile/app/(tabs)/accounts.tsx:59)
```

```
[App Launch: _layout.tsx] ──> Renders <Stack> ──> [Mounts accounts.tsx] ──> Calls getAccountsWithBalances()
                                                                                      │
                                                                                      ▼
[SQLite: friday_amanah.db] <──────── Query: "SELECT * FROM accounts" ───────── [FAIL: no such table]
       │
       └──> (runMigrations has NOT been awaited!)
```

---

### 3.2 Solution Blueprint: Root Migration Gate

The application must enforce a synchronous initialization gate in `mobile/app/_layout.tsx` using `expo-splash-screen` and a dedicated `DatabaseProvider` or `useDatabaseInit` hook before mounting child routes.

#### Implementation Architecture:
1. Prevent auto-hiding of splash screen: `SplashScreen.preventAutoHideAsync()`.
2. Initialize SQLite connection: `await getDatabase()`.
3. Execute and record pending migrations: `await runMigrations(db)`.
4. Release splash screen once database is ready: `SplashScreen.hideAsync()`.
5. Provide a fallback branded loader component (`BrandMark` centered on Midnight Navy surface) if rendering outside native splash.

#### Blueprint Implementation Code:

Create `mobile/src/db/provider.tsx`:
```tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { getDatabase } from './client';
import { runMigrations } from './migrations';
import { BrandMark } from '@/src/components/BrandMark';
import { BrandColors } from '@/src/constants/colors';

SplashScreen.preventAutoHideAsync();

interface DatabaseContextValue {
  isReady: boolean;
  error: Error | null;
}

const DatabaseContext = createContext<DatabaseContextValue>({ isReady: false, error: null });

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function initDb() {
      try {
        const db = await getDatabase();
        await runMigrations(db);
        setIsReady(true);
      } catch (err) {
        console.error('Database migration failed during startup:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        await SplashScreen.hideAsync();
      }
    }
    initDb();
  }, []);

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Startup Error</Text>
        <Text style={styles.errorMessage}>{error.message}</Text>
      </View>
    );
  }

  if (!isReady) {
    return (
      <View style={styles.loadingContainer}>
        <BrandMark variant="stacked" width={140} />
        <ActivityIndicator size="large" color={BrandColors.deepEmerald} style={styles.spinner} />
      </View>
    );
  }

  return (
    <DatabaseContext.Provider value={{ isReady, error }}>
      {children}
    </DatabaseContext.Provider>
  );
}

export const useDatabase = () => useContext(DatabaseContext);

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: BrandColors.midnightNavy,
    justifyContent: 'center',
    alignItems: 'center',
  },
  spinner: {
    marginTop: 24,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#FFF0F0',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#B42318',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: '#1F2937',
    textAlign: 'center',
  },
});
```

Integrate into `mobile/app/_layout.tsx`:
```tsx
import { DatabaseProvider } from '@/src/db/provider';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { t } = useTranslation();

  return (
    <DatabaseProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: t('modal.title') }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </DatabaseProvider>
  );
}
```

---

## 4. Next Roadmap Items (Post-Discussion Decisions)

### 4.1 Item 1: Category Seeding (Halal Personal Finance Taxonomy)
- **Objective:** Seed pre-defined default categories in `002_seed_categories.ts` migration.
- **Principles:** Exclude non-permissible structures; provide Shariah-aligned budgeting options.
- **Category Matrix:**

| Type | Key (`name_key`) | Default English | Default Bengali | Icon (Ionicons) | Color Token |
|---|---|---|---|---|---|
| **Income** | `cat.income.salary` | Halal Salary / Wages | বেতন ও পারিশ্রমিক | `briefcase-outline` | `#087A62` |
| **Income** | `cat.income.business` | Business & Trade | ব্যবসা ও বাণিজ্য | `storefront-outline` | `#10A981` |
| **Income** | `cat.income.investments` | Halal Investments / Profit | হালাল বিনিয়োগ মুনাফা | `trending-up-outline` | `#38D3A5` |
| **Income** | `cat.income.rental` | Rental Income | ভাড়া আয় | `home-outline` | `#0A1D37` |
| **Income** | `cat.income.gift` | Gift / Hadya | হাদিয়া ও উপহার | `gift-outline` | `#D2A74B` |
| **Expense** | `cat.expense.food` | Food & Groceries | খাদ্য ও মুদি | `fast-food-outline` | `#8A5A1E` |
| **Expense** | `cat.expense.housing` | Rent & Utilities | আবাসন ও বিল | `home-outline` | `#52606D` |
| **Expense** | `cat.expense.family` | Family & Dependents | পরিবার ও নির্ভরতা | `people-outline` | `#087A62` |
| **Expense** | `cat.expense.medical` | Health & Medical | স্বাস্থ্য ও চিকিৎসা | `medkit-outline` | `#B42318` |
| **Expense** | `cat.expense.education` | Education | শিক্ষা | `school-outline` | `#1E3557` |
| **Expense** | `cat.expense.sadaqah` | Sadaqah & Charity | সদকা ও দান | `heart-outline` | `#10A981` |
| **Expense** | `cat.expense.transport` | Transportation | যাতায়াত | `car-outline` | `#8A94A0` |
| **Expense** | `cat.expense.debt` | Debt Repayment | ঋণ পরিশোধ | `receipt-outline` | `#B42318` |

---

### 4.2 Item 2: Transaction Repository & Entry Modal
- **Target File:** `mobile/src/db/transactions.ts`
- **Supported Ledger Types:**
  1. `income`: Increases account balance.
  2. `expense`: Decreases account balance.
  3. `transfer`: Atomic transfer between two accounts using `withTransactionAsync` (debit origin account, credit destination account).
- **Validation Rules:**
  - All amounts passed as integer minor units (`amount >= 1`).
  - Strict Foreign Key verification (`account_id` and `category_id` must exist).
  - Soft-delete support (`deleted_at` timestamp) per `docs/05-data-model.md`.
- **UI Modal:** Wire `mobile/app/modal.tsx` with category selector, numeric keypad supporting Bengali digits, and account picker.

---

### 4.3 Item 3: Standalone Android APK Generation via EAS Build
To enable direct distribution without Google Play Store dependencies:
1. Ensure EAS CLI is configured (`npm install -g eas-cli` or `npx eas-cli`).
2. Add build profile in `mobile/eas.json`:
   ```json
   {
     "cli": {
       "version": ">= 14.0.0"
     },
     "build": {
       "preview": {
         "android": {
           "buildType": "apk"
         },
         "env": {
           "APP_VARIANT": "preview"
         }
       },
       "production": {
         "android": {
           "buildType": "app-bundle"
         }
       }
     }
   }
   ```
3. Command to build:
   ```bash
   eas build -p android --profile preview
   ```

---

### 4.4 Item 4: Phase 7 Security Roadmap (Post-MVP Architecture)
In strict compliance with ADR-006 ("Deferred database encryption, honestly labelled"):

| Security Feature | Implementation Strategy | Target Technology | Target Milestone |
|---|---|---|---|
| **Whole-Database Encryption** | Prebuild custom development client replacing `expo-sqlite` | `op-sqlite` + SQLCipher (256-bit AES-CBC) | Phase 7 |
| **Biometric Authentication** | Local device authentication guarding app resume | `expo-local-authentication` + `expo-secure-store` | Phase 7 |
| **Screen Privacy** | Prevent task-switcher screenshots & OS cache leaks | Native `FLAG_SECURE` / `expo-screen-capture` | Phase 7 |
| **Encrypted Backups** | Scrypt KDF + AES-256-GCM encrypted export file | `@noble/ciphers` (passphrase-derived key) | Phase 7 |

*Note: Do not advertise "Bank-Grade Encryption" or "Fully Encrypted Database" in UI or marketing until Phase 7 validation completes.*

---

## 5. Verification Commands for the Incoming Engineer

All commands must be executed from inside the `mobile/` directory (`D:\Friday\friday-amanah\mobile`).

### 5.1 Step-by-Step Command Runbook

| Operation | Exact Shell Command | Working Directory | Success Criteria |
|---|---|---|---|
| **Run Test Suite** | `npm test` | `mobile/` | `3 passed, 3 total; 40 passed, 40 total` |
| **Type Check** | `npx tsc --noEmit` | `mobile/` | Silent return, exit code 0 |
| **Lint Check** | `npm run lint` | `mobile/` | Silent return, exit code 0 (`expo lint`) |
| **Start Metro Bundler** | `npx expo start -c` | `mobile/` | Metro bundler listening on port 8081 |

### 5.2 Common Environment Pitfalls & Remedies
- **Issue:** Running `npm test` or `npx tsc` from `D:\Friday\friday-amanah` instead of `D:\Friday\friday-amanah\mobile`.
  - *Remedy:* Always verify current directory with `pwd` or `Get-Location`. Run `cd D:\Friday\friday-amanah\mobile`.
- **Issue:** Metro bundler caching stale SQLite schemas.
  - *Remedy:* Clear Metro cache with `npx expo start -c`.
- **Issue:** Node.js file system mocks leaking into production bundle.
  - *Remedy:* `better-sqlite3` is strictly isolated to `src/db/test-adapter.ts` and devDependencies. Never import `better-sqlite3` inside production components or `client.ts`.

---

## 6. Project Directory & Key Files Map

```
D:\Friday\friday-amanah\
├── Friday_Amanah_Brand_Assets\       # 56 Authoritative brand assets (PNG, ICO, JSON)
├── docs\
│   ├── 04-architecture.md             # System architecture & offline guarantees
│   ├── 05-data-model.md               # SQLite table definitions & column conventions
│   ├── 09-design-system.md            # Color tokens, typography & contrast ratios
│   ├── 16-architecture-decisions.md   # ADR-001 through ADR-020
│   ├── 17-brand-assets-and-metadata.md# Asset inventory & dimensions
│   └── handoffs\
│       ├── phase-1a.md                # Phase 1A baseline record
│       └── phase-2-progress.md        # THIS TECHNICAL HANDOFF
└── mobile\
    ├── app\
    │   ├── _layout.tsx                # Root layout (PENDING DatabaseProvider injection)
    │   ├── modal.tsx                  # Transaction entry modal shell
    │   └── (tabs)\
    │       ├── _layout.tsx            # Tab bar with brand icons & badges
    │       ├── accounts.tsx           # Accounts dashboard & balance aggregator
    │       ├── index.tsx              # Dashboard / home view
    │       ├── transactions.tsx       # Transaction ledger view
    │       ├── zakat.tsx              # Zakat calculator shell
    │       └── settings.tsx           # Language & preference settings
    ├── src\
    │   ├── components\
    │   │   └── BrandMark.tsx          # Authoritative brand visual component (ADR-015)
    │   ├── constants\
    │   │   ├── colors.ts              # Semantic color tokens
    │   │   └── theme.ts               # Light / Dark theme mappings
    │   ├── db\
    │   │   ├── client.ts              # SQLite singleton & PRAGMA configuration
    │   │   ├── migrations.ts          # Schema version tracker & runner
    │   │   ├── migrations\
    │   │   │   └── 001_initial_schema.ts # Base tables (accounts, categories, transactions)
    │   │   ├── accounts.ts            # Accounts repository & balance math (ADR-005)
    │   │   ├── test-adapter.ts        # In-memory better-sqlite3 adapter for Jest
    │   │   └── types.ts               # Database interfaces & row schemas
    │   ├── domain\
    │   │   └── money.ts               # Money domain value object (ADR-004)
    │   └── locales\
    │       ├── bn.json                # Primary Bengali translations
    │       └── en.json                # Secondary English translations
    ├── jest.config.js                 # Jest configuration with Expo presets
    ├── package.json                   # Dependencies & build scripts
    └── tsconfig.json                  # Strict TypeScript configuration
```

---

*Handoff document certified and ready for engineering transition.*
