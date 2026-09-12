import { closeDatabase, setDatabase } from '../client';
import { createBetterSqliteConnection } from '../test-adapter';
import { runMigrations } from '../migrations';
import { DatabaseConnection } from '../types';
import {
  createAccount,
  getAccountsWithBalances,
  getAccountById,
  deleteAccount,
} from '../accounts';
import { Money } from '../../domain/money';

describe('Accounts Repository & Derived Balance Engine (ADR-004, ADR-005)', () => {
  let db: DatabaseConnection;

  beforeEach(async () => {
    // Isolated in-memory database with foreign keys enabled
    db = createBetterSqliteConnection(':memory:');
    await db.execAsync(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
    `);
    setDatabase(db);
    await runMigrations(db);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  describe('Account Creation (ADR-004 / Rule 1)', () => {
    it('creates an account with integer poisha initial balance', async () => {
      const created = await createAccount(
        {
          name: 'City Bank Checking',
          type: 'bank',
          initialBalancePoisha: 250000, // 2,500.00 BDT
          currency: 'BDT',
        },
        db
      );

      expect(created.id).toMatch(/^acc_/);
      expect(created.name).toBe('City Bank Checking');
      expect(created.type).toBe('bank');
      expect(created.initial_balance).toBe(250000);
      expect(created.current_balance_poisha).toBe(250000);
      expect(created.transaction_count).toBe(0);
      expect(created.balance).toBeInstanceOf(Money);
      expect(created.balance.amount).toBe(250000);
      expect(created.balance.format('en')).toBe('৳2,500.00');
      expect(created.balance.format('bn')).toBe('৳২,৫০০.০০');
    });

    it('rejects empty or whitespace-only account names', async () => {
      await expect(
        createAccount(
          {
            name: '   ',
            type: 'cash',
            initialBalancePoisha: 1000,
          },
          db
        )
      ).rejects.toThrow('Account name cannot be empty');
    });

    it('rejects non-integer floating-point initial balance (ADR-004 strict minor units)', async () => {
      await expect(
        createAccount(
          {
            name: 'Floating Point Mistake',
            type: 'cash',
            initialBalancePoisha: 105.75, // Floating point!
          },
          db
        )
      ).rejects.toThrow(TypeError);
    });

    it('supports 0 initial balance and negative initial balance', async () => {
      const zeroAcc = await createAccount(
        {
          name: 'Zero Cash',
          type: 'cash',
          initialBalancePoisha: 0,
        },
        db
      );
      expect(zeroAcc.current_balance_poisha).toBe(0);

      const negativeAcc = await createAccount(
        {
          name: 'Overdraft Account',
          type: 'bank',
          initialBalancePoisha: -50000, // -500.00 BDT
        },
        db
      );
      expect(negativeAcc.current_balance_poisha).toBe(-50000);
      expect(negativeAcc.balance.isNegative()).toBe(true);
      expect(negativeAcc.balance.format('en')).toBe('-৳500.00');
      expect(negativeAcc.balance.format('bn')).toBe('-৳৫০০.০০');
    });
  });

  describe('Derived Balance Calculation (ADR-005 / Rule 2)', () => {
    it('returns empty array when no accounts exist', async () => {
      const accounts = await getAccountsWithBalances(db);
      expect(accounts).toEqual([]);
    });

    it('derives balance = initial_balance when no transactions exist', async () => {
      await createAccount(
        {
          name: 'Wallet',
          type: 'cash',
          initialBalancePoisha: 15000, // 150.00 BDT
        },
        db
      );

      const accounts = await getAccountsWithBalances(db);
      expect(accounts).toHaveLength(1);
      expect(accounts[0].current_balance_poisha).toBe(15000);
      expect(accounts[0].transaction_count).toBe(0);
      expect(accounts[0].balance.amount).toBe(15000);
    });

    it('derives current balance accurately with income and expense transactions', async () => {
      const now = Date.now();

      // Create Cash account with 500.00 BDT (50000 poisha)
      const cash = await createAccount(
        {
          name: 'Pocket Cash',
          type: 'cash',
          initialBalancePoisha: 50000,
        },
        db
      );

      // Create Bank account with 10,000.00 BDT (1000000 poisha)
      const bank = await createAccount(
        {
          name: 'Salary Bank',
          type: 'bank',
          initialBalancePoisha: 1000000,
        },
        db
      );

      // Add category
      await db.runAsync(
        `INSERT INTO categories (id, name_key, icon, color, type)
         VALUES (?, ?, ?, ?, ?);`,
        'cat_income',
        'salary',
        'cash',
        '#087A62',
        'income'
      );
      await db.runAsync(
        `INSERT INTO categories (id, name_key, icon, color, type)
         VALUES (?, ?, ?, ?, ?);`,
        'cat_expense',
        'groceries',
        'cart',
        '#087A62',
        'expense'
      );

      // Transaction 1: Income of 200.00 BDT to Pocket Cash
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, note, timestamp, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        'tx_1',
        cash.id,
        'cat_income',
        20000,
        'income',
        'Gift',
        now,
        now
      );

      // Transaction 2: Expense of 150.50 BDT from Pocket Cash
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, note, timestamp, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        'tx_2',
        cash.id,
        'cat_expense',
        15050,
        'expense',
        'Snacks',
        now + 1,
        now + 1
      );

      // Transaction 3: Expense of 1,200.00 BDT from Salary Bank
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, note, timestamp, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        'tx_3',
        bank.id,
        'cat_expense',
        120000,
        'expense',
        'Utilities',
        now + 2,
        now + 2
      );

      // Fetch all accounts
      const accounts = await getAccountsWithBalances(db);
      expect(accounts).toHaveLength(2);

      const cashAccount = accounts.find((a) => a.id === cash.id)!;
      // 50000 initial + 20000 income - 15050 expense = 54950 poisha (549.50 BDT)
      expect(cashAccount.current_balance_poisha).toBe(54950);
      expect(cashAccount.transaction_count).toBe(2);
      expect(cashAccount.balance.amount).toBe(54950);
      expect(cashAccount.balance.format('en')).toBe('৳549.50');
      expect(cashAccount.balance.format('bn')).toBe('৳৫৪৯.৫০');

      const bankAccount = accounts.find((a) => a.id === bank.id)!;
      // 1000000 initial - 120000 expense = 880000 poisha (8,800.00 BDT)
      expect(bankAccount.current_balance_poisha).toBe(880000);
      expect(bankAccount.transaction_count).toBe(1);
      expect(bankAccount.balance.amount).toBe(880000);
      expect(bankAccount.balance.format('en')).toBe('৳8,800.00');
      expect(bankAccount.balance.format('bn')).toBe('৳৮,৮০০.০০');
    });

    it('retrieves single account by id with derived balance via getAccountById', async () => {
      const created = await createAccount(
        {
          name: 'bKash Wallet',
          type: 'mobile_wallet',
          initialBalancePoisha: 75000, // 750.00 BDT
        },
        db
      );

      const fetched = await getAccountById(created.id, db);
      expect(fetched).not.toBeNull();
      expect(fetched?.name).toBe('bKash Wallet');
      expect(fetched?.type).toBe('mobile_wallet');
      expect(fetched?.current_balance_poisha).toBe(75000);

      const notFound = await getAccountById('non_existent_id', db);
      expect(notFound).toBeNull();
    });
  });

  describe('Account Deletion & Foreign Key Protection (PRAGMA foreign_keys = ON)', () => {
    it('deletes an account when no transactions exist', async () => {
      const account = await createAccount(
        {
          name: 'Temporary Account',
          type: 'cash',
          initialBalancePoisha: 1000,
        },
        db
      );

      const deleted = await deleteAccount(account.id, db);
      expect(deleted).toBe(true);

      const check = await getAccountById(account.id, db);
      expect(check).toBeNull();
    });

    it('rejects deleting an account with existing child transactions (ON DELETE RESTRICT)', async () => {
      const account = await createAccount(
        {
          name: 'Protected Bank',
          type: 'bank',
          initialBalancePoisha: 50000,
        },
        db
      );

      const now = Date.now();
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, category_id, amount, type, note, timestamp, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        'tx_child',
        account.id,
        'cat_exp_food_groceries',
        5000,
        'expense',
        'Protected test',
        now,
        now
      );

      // Must throw FOREIGN KEY constraint violation
      await expect(deleteAccount(account.id, db)).rejects.toThrow(/FOREIGN KEY/i);
    });
  });
});
