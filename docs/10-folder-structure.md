# 10 — Folder Structure

Two rules govern this layout:

1. **`app/` is navigation only.** Expo Router treats files there as routes. Every screen file
   is thin — it renders a feature component and nothing else. No SQL, no calculations.
2. **Dependencies point downward** (doc 04 §3). `domain` imports nothing from the project.
   `db` imports only `domain` types. `services` import `db` and `domain`. `features` import
   `services`. `app` imports `features`. An ESLint boundaries rule enforces this.

```
friday-amanah/
├── app/                              ← Expo Router. Routes only.
│   ├── _layout.tsx                   Root: providers, theme, i18n, DB init, lock gate
│   ├── +not-found.tsx
│   ├── lock.tsx
│   ├── (onboarding)/
│   │   ├── _layout.tsx
│   │   ├── language.tsx  welcome.tsx  currency.tsx  month-start.tsx
│   │   ├── security.tsx  first-account.tsx  complete.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx                Tab bar + FAB
│   │   ├── index.tsx                  Home
│   │   ├── transactions.tsx
│   │   ├── plan.tsx
│   │   ├── islamic.tsx
│   │   └── settings.tsx
│   ├── accounts/      [id].tsx  new.tsx  index.tsx
│   ├── categories/    [id].tsx  new.tsx  index.tsx
│   ├── transactions/  [id]/index.tsx  [id]/edit.tsx  new.tsx  search.tsx
│   ├── recurring/     index.tsx  [id].tsx
│   ├── plan/          budgets/…  goals/…  debts/…
│   ├── islamic/       zakat/…  giving/…
│   ├── reports/       index.tsx  income-expense.tsx  categories.tsx  … yearly.tsx
│   ├── settings/      profile.tsx  language.tsx  … legal/privacy.tsx
│   └── notifications.tsx
│
├── src/
│   ├── domain/                       ← PURE TypeScript. No React. No SQLite. 100% tested.
│   │   ├── money/
│   │   │   ├── money.ts              Money type, add, subtract, multiply, allocate
│   │   │   ├── currency.ts           Minor-unit table, symbols
│   │   │   ├── format.ts             Display strings, Bengali numerals
│   │   │   ├── parse.ts              User input → minor units
│   │   │   └── __tests__/
│   │   ├── balance/                  Account balance, net worth, period totals
│   │   ├── budget/                   Spend vs budget, rollover, remaining-per-day
│   │   ├── goals/                    Progress, required contribution, milestones
│   │   ├── debt/                     Remaining, schedules, partial payments
│   │   ├── zakat/                    See doc 08 §2
│   │   ├── recurring/                Next-occurrence date maths
│   │   ├── period/                   Financial month boundaries, date ranges
│   │   ├── hijri/                    Umm al-Qura wrapper
│   │   └── validation/               Zod schemas shared by forms and repositories
│   │
│   ├── db/
│   │   ├── client.ts                 Open DB, PRAGMAs, single connection
│   │   ├── migrate.ts                Migration runner (user_version)
│   │   ├── migrations/
│   │   │   ├── 001_initial.sql
│   │   │   └── index.ts              Ordered, checksummed list
│   │   ├── seed/                     Default categories, currencies
│   │   ├── types.ts                  Row types matching the schema exactly
│   │   └── repositories/
│   │       ├── base.ts               Shared helpers, soft-delete filter, profile scoping
│   │       ├── accounts.repo.ts   categories.repo.ts   transactions.repo.ts
│   │       ├── splits.repo.ts     budgets.repo.ts      goals.repo.ts
│   │       ├── debts.repo.ts      zakat.repo.ts        giving.repo.ts
│   │       ├── recurring.repo.ts  settings.repo.ts     audit.repo.ts
│   │       ├── attachments.repo.ts  notifications.repo.ts
│   │       └── __tests__/
│   │
│   ├── services/                     ← Use-cases. Transaction boundaries live here.
│   │   ├── transaction.service.ts    Create/edit/delete/transfer/split (atomic)
│   │   ├── account.service.ts        Create, archive, recompute balance
│   │   ├── budget.service.ts   goal.service.ts   debt.service.ts
│   │   ├── zakat.service.ts          Engine + persistence + snapshots
│   │   ├── giving.service.ts   report.service.ts
│   │   ├── backup.service.ts         Encrypt, write, verify
│   │   ├── restore.service.ts        Validate, stage, atomically swap
│   │   ├── export.service.ts         CSV (sanitised) + PDF-ready HTML
│   │   ├── security.service.ts       PIN, biometric, lock state, backoff
│   │   ├── notification.service.ts
│   │   └── __tests__/
│   │
│   ├── features/                     ← UI grouped by domain
│   │   ├── dashboard/  components/  hooks/
│   │   ├── transactions/  accounts/  categories/  budgets/  goals/  debts/
│   │   ├── zakat/  giving/  reports/  settings/  onboarding/  security/
│   │
│   ├── components/                   ← Design system. Knows nothing about finance.
│   │   ├── ui/        Text Button Card Input Sheet Toast Badge …
│   │   ├── money/     Amount.tsx  AmountInput.tsx  (privacy-mode aware)
│   │   ├── charts/    BarChart Donut LineChart + TableAlternative
│   │   ├── states/    EmptyState ErrorState LoadingSkeleton NoResults
│   │   └── layout/    Screen Header TabBar FAB
│   │
│   ├── store/                        ← Zustand. UI/session state only.
│   │   ├── ui.store.ts               Theme, privacy mode, active period
│   │   ├── session.store.ts          Lock state, last-active timestamp
│   │   └── settings.store.ts         Mirrors the settings table, write-through
│   │
│   ├── i18n/
│   │   ├── index.ts                  i18next init, language detection, persistence
│   │   ├── en/  common budgets zakat errors accessibility … .json
│   │   ├── bn/  (same files)
│   │   └── format/  number.ts  date.ts  bengaliNumerals.ts
│   │
│   ├── theme/
│   │   ├── tokens.ts  colors.ts  typography.ts  spacing.ts  shadows.ts
│   │   ├── ThemeProvider.tsx  useTheme.ts
│   │
│   ├── lib/
│   │   ├── logger.ts                 Redacting logger (doc 06 §7)
│   │   ├── result.ts                 Result<T, AppError>
│   │   ├── errors.ts                 AppError codes → i18n keys
│   │   ├── crypto.ts                 @noble wrappers: scrypt, AES-GCM, random
│   │   ├── secureStore.ts            expo-secure-store wrapper
│   │   ├── files.ts                  Sandbox paths, validation
│   │   ├── csv.ts                    Formula-injection-safe writer
│   │   ├── id.ts                     UUID v4 from expo-crypto
│   │   └── date.ts
│   │
│   └── constants/  config.ts  categories.seed.ts  currencies.seed.ts  routes.ts
│
├── assets/  fonts/  images/  icons/
├── e2e/                              Maestro flows (.yaml)
├── docs/                             ← this folder
├── scripts/  check-no-float.ts  check-hardcoded-strings.ts  check-tone.ts
├── __mocks__/
├── app.json  eas.json  babel.config.js  metro.config.js
├── tsconfig.json  jest.config.js  .eslintrc.js  .prettierrc
├── package.json  package-lock.json  .gitignore  README.md
```

## Notes

**Why `domain` is separate from `services`.** `domain` is pure arithmetic that can be tested
without a database, an emulator, or React. `services` do the impure work — open a database
transaction, write rows, schedule a notification. Keeping them apart is what makes the money
logic fast and cheap to test, and it is why doc 12's test pyramid is achievable at all.

**Why `features` and `components` are separate.** `components/ui/Button` knows nothing about
money and could be lifted into another Friday product unchanged. `features/zakat/…` is
specific to this app. Mixing them produces a design system that cannot be reused and feature
code that cannot be found.

**Why `scripts/` exists.** Three custom checks run in CI: no `REAL` column in any migration,
no bare string literal in JSX, and no banned tone phrase in any i18n file. Each is a small
Node script. They encode the rules from docs 04, 07, and 02 so those rules survive contact
with a deadline.
