-- 009_planning_integrity_corrections.sql
-- Phase 5 close-out: fail-closed civil dates at every planning database boundary.
-- The executable migration performs the same validation before installing these triggers.

-- Existing rows are validated by 009_planning_integrity_corrections.ts before any DDL.

DROP TRIGGER IF EXISTS trg_transactions_occurred_on_default;
DROP TRIGGER IF EXISTS trg_transactions_occurred_on_insert;

CREATE TRIGGER trg_transactions_occurred_on_insert
BEFORE INSERT ON transactions
WHEN NEW.occurred_on IS NULL OR NOT (
  length(NEW.occurred_on) = 10
  AND substr(NEW.occurred_on, 5, 1) = '-'
  AND substr(NEW.occurred_on, 8, 1) = '-'
  AND substr(NEW.occurred_on, 1, 4) GLOB '[0-9][0-9][0-9][0-9]'
  AND substr(NEW.occurred_on, 6, 2) GLOB '[0-9][0-9]'
  AND substr(NEW.occurred_on, 9, 2) GLOB '[0-9][0-9]'
  AND CAST(substr(NEW.occurred_on, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
  AND CAST(substr(NEW.occurred_on, 6, 2) AS INTEGER) BETWEEN 1 AND 12
  AND CAST(substr(NEW.occurred_on, 9, 2) AS INTEGER) BETWEEN 1 AND CASE
    WHEN CAST(substr(NEW.occurred_on, 6, 2) AS INTEGER) IN (1,3,5,7,8,10,12) THEN 31
    WHEN CAST(substr(NEW.occurred_on, 6, 2) AS INTEGER) IN (4,6,9,11) THEN 30
    WHEN (CAST(substr(NEW.occurred_on, 1, 4) AS INTEGER) % 400 = 0 OR
      (CAST(substr(NEW.occurred_on, 1, 4) AS INTEGER) % 4 = 0 AND CAST(substr(NEW.occurred_on, 1, 4) AS INTEGER) % 100 <> 0)) THEN 29
    ELSE 28
  END
)
BEGIN SELECT RAISE(ABORT, 'MIGRATION_ERR_INVALID_CIVIL_DATE'); END;

CREATE TRIGGER trg_budgets_civil_dates_insert
BEFORE INSERT ON budgets
WHEN NOT (
  length(NEW.starts_on)=10 AND substr(NEW.starts_on,5,1)='-' AND substr(NEW.starts_on,8,1)='-'
  AND substr(NEW.starts_on,1,4) GLOB '[0-9][0-9][0-9][0-9]' AND substr(NEW.starts_on,6,2) GLOB '[0-9][0-9]' AND substr(NEW.starts_on,9,2) GLOB '[0-9][0-9]'
  AND CAST(substr(NEW.starts_on,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(NEW.starts_on,6,2) AS INTEGER) BETWEEN 1 AND 12
  AND CAST(substr(NEW.starts_on,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(NEW.starts_on,6,2) AS INTEGER) IN (1,3,5,7,8,10,12) THEN 31 WHEN CAST(substr(NEW.starts_on,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 WHEN (CAST(substr(NEW.starts_on,1,4) AS INTEGER)%400=0 OR (CAST(substr(NEW.starts_on,1,4) AS INTEGER)%4=0 AND CAST(substr(NEW.starts_on,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END
) OR NOT (
  length(NEW.ends_on)=10 AND substr(NEW.ends_on,5,1)='-' AND substr(NEW.ends_on,8,1)='-'
  AND substr(NEW.ends_on,1,4) GLOB '[0-9][0-9][0-9][0-9]' AND substr(NEW.ends_on,6,2) GLOB '[0-9][0-9]' AND substr(NEW.ends_on,9,2) GLOB '[0-9][0-9]'
  AND CAST(substr(NEW.ends_on,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(NEW.ends_on,6,2) AS INTEGER) BETWEEN 1 AND 12
  AND CAST(substr(NEW.ends_on,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(NEW.ends_on,6,2) AS INTEGER) IN (1,3,5,7,8,10,12) THEN 31 WHEN CAST(substr(NEW.ends_on,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 WHEN (CAST(substr(NEW.ends_on,1,4) AS INTEGER)%400=0 OR (CAST(substr(NEW.ends_on,1,4) AS INTEGER)%4=0 AND CAST(substr(NEW.ends_on,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END
)
BEGIN SELECT RAISE(ABORT, 'MIGRATION_ERR_INVALID_BUDGET_DATE'); END;

CREATE TRIGGER trg_budgets_civil_dates_update
BEFORE UPDATE OF starts_on, ends_on ON budgets
WHEN NOT (
  length(NEW.starts_on)=10 AND substr(NEW.starts_on,5,1)='-' AND substr(NEW.starts_on,8,1)='-'
  AND substr(NEW.starts_on,1,4) GLOB '[0-9][0-9][0-9][0-9]' AND substr(NEW.starts_on,6,2) GLOB '[0-9][0-9]' AND substr(NEW.starts_on,9,2) GLOB '[0-9][0-9]'
  AND CAST(substr(NEW.starts_on,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(NEW.starts_on,6,2) AS INTEGER) BETWEEN 1 AND 12
  AND CAST(substr(NEW.starts_on,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(NEW.starts_on,6,2) AS INTEGER) IN (1,3,5,7,8,10,12) THEN 31 WHEN CAST(substr(NEW.starts_on,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 WHEN (CAST(substr(NEW.starts_on,1,4) AS INTEGER)%400=0 OR (CAST(substr(NEW.starts_on,1,4) AS INTEGER)%4=0 AND CAST(substr(NEW.starts_on,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END
) OR NOT (
  length(NEW.ends_on)=10 AND substr(NEW.ends_on,5,1)='-' AND substr(NEW.ends_on,8,1)='-'
  AND substr(NEW.ends_on,1,4) GLOB '[0-9][0-9][0-9][0-9]' AND substr(NEW.ends_on,6,2) GLOB '[0-9][0-9]' AND substr(NEW.ends_on,9,2) GLOB '[0-9][0-9]'
  AND CAST(substr(NEW.ends_on,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(NEW.ends_on,6,2) AS INTEGER) BETWEEN 1 AND 12
  AND CAST(substr(NEW.ends_on,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(NEW.ends_on,6,2) AS INTEGER) IN (1,3,5,7,8,10,12) THEN 31 WHEN CAST(substr(NEW.ends_on,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 WHEN (CAST(substr(NEW.ends_on,1,4) AS INTEGER)%400=0 OR (CAST(substr(NEW.ends_on,1,4) AS INTEGER)%4=0 AND CAST(substr(NEW.ends_on,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END
)
BEGIN SELECT RAISE(ABORT, 'MIGRATION_ERR_INVALID_BUDGET_DATE'); END;

CREATE TRIGGER trg_savings_goals_target_date_insert
BEFORE INSERT ON savings_goals
WHEN NEW.target_date IS NOT NULL AND NOT (
  length(NEW.target_date)=10 AND substr(NEW.target_date,5,1)='-' AND substr(NEW.target_date,8,1)='-'
  AND substr(NEW.target_date,1,4) GLOB '[0-9][0-9][0-9][0-9]' AND substr(NEW.target_date,6,2) GLOB '[0-9][0-9]' AND substr(NEW.target_date,9,2) GLOB '[0-9][0-9]'
  AND CAST(substr(NEW.target_date,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(NEW.target_date,6,2) AS INTEGER) BETWEEN 1 AND 12
  AND CAST(substr(NEW.target_date,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(NEW.target_date,6,2) AS INTEGER) IN (1,3,5,7,8,10,12) THEN 31 WHEN CAST(substr(NEW.target_date,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 WHEN (CAST(substr(NEW.target_date,1,4) AS INTEGER)%400=0 OR (CAST(substr(NEW.target_date,1,4) AS INTEGER)%4=0 AND CAST(substr(NEW.target_date,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END
)
BEGIN SELECT RAISE(ABORT, 'MIGRATION_ERR_INVALID_GOAL_DATE'); END;
CREATE TRIGGER trg_savings_goals_target_date_update
BEFORE UPDATE OF target_date ON savings_goals
WHEN NEW.target_date IS NOT NULL AND NOT (
  length(NEW.target_date)=10 AND substr(NEW.target_date,5,1)='-' AND substr(NEW.target_date,8,1)='-'
  AND substr(NEW.target_date,1,4) GLOB '[0-9][0-9][0-9][0-9]' AND substr(NEW.target_date,6,2) GLOB '[0-9][0-9]' AND substr(NEW.target_date,9,2) GLOB '[0-9][0-9]'
  AND CAST(substr(NEW.target_date,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(NEW.target_date,6,2) AS INTEGER) BETWEEN 1 AND 12
  AND CAST(substr(NEW.target_date,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(NEW.target_date,6,2) AS INTEGER) IN (1,3,5,7,8,10,12) THEN 31 WHEN CAST(substr(NEW.target_date,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 WHEN (CAST(substr(NEW.target_date,1,4) AS INTEGER)%400=0 OR (CAST(substr(NEW.target_date,1,4) AS INTEGER)%4=0 AND CAST(substr(NEW.target_date,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END
)
BEGIN SELECT RAISE(ABORT, 'MIGRATION_ERR_INVALID_GOAL_DATE'); END;

CREATE TRIGGER trg_savings_goal_entries_occurred_on_insert
BEFORE INSERT ON savings_goal_entries
WHEN NEW.occurred_on IS NULL OR NOT (
  length(NEW.occurred_on)=10 AND substr(NEW.occurred_on,5,1)='-' AND substr(NEW.occurred_on,8,1)='-'
  AND substr(NEW.occurred_on,1,4) GLOB '[0-9][0-9][0-9][0-9]' AND substr(NEW.occurred_on,6,2) GLOB '[0-9][0-9]' AND substr(NEW.occurred_on,9,2) GLOB '[0-9][0-9]'
  AND CAST(substr(NEW.occurred_on,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(NEW.occurred_on,6,2) AS INTEGER) BETWEEN 1 AND 12
  AND CAST(substr(NEW.occurred_on,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(NEW.occurred_on,6,2) AS INTEGER) IN (1,3,5,7,8,10,12) THEN 31 WHEN CAST(substr(NEW.occurred_on,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 WHEN (CAST(substr(NEW.occurred_on,1,4) AS INTEGER)%400=0 OR (CAST(substr(NEW.occurred_on,1,4) AS INTEGER)%4=0 AND CAST(substr(NEW.occurred_on,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END
)
BEGIN SELECT RAISE(ABORT, 'MIGRATION_ERR_INVALID_GOAL_ENTRY_DATE'); END;
CREATE TRIGGER trg_savings_goal_entries_occurred_on_update
BEFORE UPDATE OF occurred_on ON savings_goal_entries
WHEN NEW.occurred_on IS NULL OR NOT (
  length(NEW.occurred_on)=10 AND substr(NEW.occurred_on,5,1)='-' AND substr(NEW.occurred_on,8,1)='-'
  AND substr(NEW.occurred_on,1,4) GLOB '[0-9][0-9][0-9][0-9]' AND substr(NEW.occurred_on,6,2) GLOB '[0-9][0-9]' AND substr(NEW.occurred_on,9,2) GLOB '[0-9][0-9]'
  AND CAST(substr(NEW.occurred_on,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(NEW.occurred_on,6,2) AS INTEGER) BETWEEN 1 AND 12
  AND CAST(substr(NEW.occurred_on,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(NEW.occurred_on,6,2) AS INTEGER) IN (1,3,5,7,8,10,12) THEN 31 WHEN CAST(substr(NEW.occurred_on,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 WHEN (CAST(substr(NEW.occurred_on,1,4) AS INTEGER)%400=0 OR (CAST(substr(NEW.occurred_on,1,4) AS INTEGER)%4=0 AND CAST(substr(NEW.occurred_on,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END
)
BEGIN SELECT RAISE(ABORT, 'MIGRATION_ERR_INVALID_GOAL_ENTRY_DATE'); END;

PRAGMA foreign_key_check;
