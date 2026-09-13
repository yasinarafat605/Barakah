import { createBetterSqliteConnection } from '../test-adapter';
import { runMigrations } from '../migrations';
import { setDatabase, closeDatabase } from '../client';
import { DatabaseConnection } from '../types';
import {
  createCounterparty,
  getCounterparties,
  getCounterpartyById,
  updateCounterparty,
  archiveCounterparty,
  restoreCounterparty,
  deleteCounterparty,
} from '../counterparties';
import { createDebt } from '../debts';

describe('Counterparties Repository (Phase 3)', () => {
  let db: DatabaseConnection;

  beforeEach(async () => {
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

  it('creates neutral counterparty profiles with various types', async () => {
    const person = await createCounterparty({
      name: 'Rahim Ahmed',
      type: 'person',
      phone: '+8801711000000',
      email: 'rahim@example.com',
      note: 'Colleague',
      avatarColor: '#0B6B57',
    });

    expect(person.id).toMatch(/^cp_/);
    expect(person.name).toBe('Rahim Ahmed');
    expect(person.type).toBe('person');
    expect(person.phone).toBe('+8801711000000');
    expect(person.is_archived).toBe(0);

    const business = await createCounterparty({
      name: 'City Hardware Store',
      type: 'business',
    });
    expect(business.type).toBe('business');
  });

  it('updates counterparty details cleanly', async () => {
    const cp = await createCounterparty({
      name: 'Karim',
      type: 'person',
    });

    const updated = await updateCounterparty(cp.id, {
      name: 'Karim Ullah',
      phone: '+8801811000000',
      note: 'Updated notes',
    });

    expect(updated.name).toBe('Karim Ullah');
    expect(updated.phone).toBe('+8801811000000');
    expect(updated.note).toBe('Updated notes');
  });

  it('archives and restores counterparties', async () => {
    const cp = await createCounterparty({ name: 'Temporary Contact' });

    await archiveCounterparty(cp.id);
    const archivedList = await getCounterparties({ isArchived: true });
    expect(archivedList.some((c) => c.id === cp.id)).toBe(true);

    const activeList = await getCounterparties({ isArchived: false });
    expect(activeList.some((c) => c.id === cp.id)).toBe(false);

    await restoreCounterparty(cp.id);
    const restoredActive = await getCounterparties({ isArchived: false });
    expect(restoredActive.some((c) => c.id === cp.id)).toBe(true);
  });

  it('allows deleting an unused counterparty with no debts', async () => {
    const cp = await createCounterparty({ name: 'Accidental Contact' });
    await deleteCounterparty(cp.id);

    const found = await getCounterpartyById(cp.id);
    expect(found).toBeNull();
  });

  it('rejects deleting a counterparty referenced by existing debts', async () => {
    const cp = await createCounterparty({ name: 'Lender Uncle' });

    await createDebt({
      counterpartyId: cp.id,
      direction: 'borrowed',
      originalPrincipalMinor: 50000,
      currency: 'BDT',
      openingMode: 'existing_balance',
    });

    await expect(deleteCounterparty(cp.id)).rejects.toThrow(
      /Cannot delete counterparty with existing debts/i
    );
  });

  it('aggregates multi-currency debt summaries per counterparty', async () => {
    const cp = await createCounterparty({ name: 'Multi-Currency Friend' });

    // 1. Borrowed BDT 10,000
    await createDebt({
      counterpartyId: cp.id,
      direction: 'borrowed',
      originalPrincipalMinor: 1000000, // ৳10,000.00
      currency: 'BDT',
      openingMode: 'existing_balance',
    });

    // 2. Lent USD $100
    await createDebt({
      counterpartyId: cp.id,
      direction: 'lent',
      originalPrincipalMinor: 10000, // $100.00
      currency: 'USD',
      openingMode: 'existing_balance',
    });

    const summary = await getCounterpartyById(cp.id);
    expect(summary).toBeDefined();
    expect(summary?.active_debt_count).toBe(2);
    expect(summary?.total_borrowed_by_currency['BDT']).toBe(1000000);
    expect(summary?.total_lent_by_currency['USD']).toBe(10000);
  });

  it('blocks archiving a counterparty when active debts exist', async () => {
    const cp = await createCounterparty({ name: 'Active Debtor' });
    await createDebt({
      counterpartyId: cp.id,
      direction: 'borrowed',
      originalPrincipalMinor: 50000,
      currency: 'BDT',
      openingMode: 'existing_balance',
    });

    // Attempt to archive must fail
    await expect(archiveCounterparty(cp.id)).rejects.toThrow(
      /Cannot archive counterparty with active debts/i
    );
  });
});

