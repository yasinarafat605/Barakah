# Phase 5 planning foundation handover

Date: 16 September 2026
Baseline: `d5363180999dc8f6d39aeabc657c7e1bdcaf7963`

## Delivered

- Migration 008; released migrations 001–007 remain byte-identical.
- Stable transaction civil dates with strict Gregorian validation and deterministic UTC backfill/defaulting for legacy SQL callers.
- Account archival preserves history, requires confirmation for funded goals, and blocks new money movement.
- Budgets, category allocations, canonical `archived_at` state, overlap rules, derived actuals, and `none`/`unspent_only` rollover.
- Debt-principal actuals count only explicitly allocated Loan Given/Loan Repayment categories; debt income, transfers, and non-cash adjustments do not count; metadata disagreement fails closed.
- Savings goals with account-wide availability, underfunding, lifecycle derivation, three evidence modes, and bidirectional soft-delete/restore.
- Permanent transaction-evidence reservation across soft deletion; repository rules also reserve the whole transfer.
- Backup manifest v2 planning coverage and authenticated v1 compatibility through isolated schema-8 staging restore.
- Plan and Islamic navigation. Zakat readiness displays no estimate until required inputs and rules exist.

## Verification boundary

Jest uses deterministic mocks and a native-compatible SQLite adapter; it is not native runtime QA. Expo web export and Android prebuild are build-time checks. A real browser reload/OPFS persistence session and an Android emulator or physical-device session must be recorded separately if performed.

## Manual QA still required

- Android emulator or physical device: create/archive/restore accounts; create budgets and goals; exercise transfer-linked goal deletion/restoration; backup, terminate, and restore.
- Browser with required cross-origin isolation headers: create planning records, fully reload, and confirm SQLite/OPFS persistence.
- Accessibility, Bangla copy, and compact-screen layout review for new planning forms.
