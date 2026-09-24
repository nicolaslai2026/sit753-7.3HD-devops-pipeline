// UNIT TESTS: pure functions + the concurrency-safe booking transaction.
const { freshDbPath } = require('../helpers');
process.env.DB_PATH = freshDbPath('unit');
jest.spyOn(console, 'log').mockImplementation(() => {});

const app = require('../../server');
const { statusFor, makeRefCode, toClassDTO, bookClassAtomically } = app;

describe('statusFor (seat badge logic)', () => {
  test.each([
    [10, 'available'],
    [3, 'available'],
    [2, 'limited'],
    [1, 'limited'],
    [0, 'full'],
    [-1, 'full'],
  ])('%i remaining -> %s', (remaining, expected) => {
    expect(statusFor(remaining)).toBe(expected);
  });
});

describe('makeRefCode', () => {
  test('matches MMM-YYYY-XXXXXX format', () => {
    const year = new Date().getFullYear();
    expect(makeRefCode()).toMatch(new RegExp(`^MMM-${year}-[0-9A-F]{6}$`));
  });
  test('is random, not sequential', () => {
    const codes = new Set(Array.from({ length: 50 }, makeRefCode));
    expect(codes.size).toBe(50);
  });
});

describe('toClassDTO', () => {
  test('maps DB row to API shape and derives remaining/status', () => {
    const dto = toClassDTO({
      id: 1, name: 'Test', day: 'Mon', time: '9am', age_group: 'All',
      price: 20, max_spots: 8, booked_spots: 7,
    });
    expect(dto).toMatchObject({ id: 1, ageGroup: 'All', maxSpots: 8, remaining: 1, status: 'limited' });
  });
});

describe('bookClassAtomically (transaction)', () => {
  const base = { name: 'Ann', email: 'ann@example.com', phone: null };

  test('confirms a booking and returns a reference', () => {
    // Pottery Basics (id 4) is seeded with 12 max / 4 booked
    const r = bookClassAtomically({ ...base, classId: 4, spots: 2 });
    expect(r.ok).toBe(true);
    expect(r.booking.refCode).toMatch(/^MMM-/);
  });

  test('rejects a full class', () => {
    // Adult Life Drawing (id 3) is seeded full: 10/10
    expect(bookClassAtomically({ ...base, classId: 3, spots: 1 })).toEqual({ ok: false, reason: 'full' });
  });

  test('rejects more spots than remaining', () => {
    // Teen Acrylic (id 2): 6 max / 5 booked -> 1 left
    expect(bookClassAtomically({ ...base, classId: 2, spots: 3 })).toEqual({ ok: false, reason: 'too_many', remaining: 1 });
  });

  test('rejects an unknown class', () => {
    expect(bookClassAtomically({ ...base, classId: 999, spots: 1 }).reason).toBe('not_found');
  });

  test('never oversells: repeated bookings stop exactly at capacity', () => {
    // Calligraphy (id 5): 8 max / 7 booked -> exactly 1 left
    const results = [1, 2, 3].map(() => bookClassAtomically({ ...base, classId: 5, spots: 1 }));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => r.reason === 'full')).toHaveLength(2);
  });
});

describe('validateBooking (input validation)', () => {
  const { validateBooking } = app;
  const ok = { classId: 1, name: 'Ann', email: 'ann@example.com', spots: 2 };

  test('valid input -> null', () => expect(validateBooking(ok)).toBeNull());
  test('missing name', () => expect(validateBooking({ ...ok, name: '' })).toMatch(/Missing/));
  test('bad email', () => expect(validateBooking({ ...ok, email: 'a@b' })).toMatch(/email/));
  test('negative spots', () => expect(validateBooking({ ...ok, spots: -1 })).toMatch(/whole number/));
  test('string spots', () => expect(validateBooking({ ...ok, spots: 'two' })).toMatch(/whole number/));
});
