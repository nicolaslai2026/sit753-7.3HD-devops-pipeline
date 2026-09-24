// INTEGRATION TESTS: real HTTP requests against the Express app via Supertest.
const request = require('supertest');
const { freshDbPath } = require('../helpers');
process.env.DB_PATH = freshDbPath('api');
jest.spyOn(console, 'log').mockImplementation(() => {});

const app = require('../../server');

describe('health + monitoring endpoints', () => {
  test('GET /health -> 200 ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('GET /metrics exposes Prometheus metrics', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('mmm_class_seats_remaining');
  });

  test('security headers are set (helmet)', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});

describe('static front end', () => {
  test('GET / serves the booking page', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('app.js');
  });
});

describe('GET /api/classes', () => {
  test('returns all 5 seeded classes with live status', async () => {
    const res = await request(app).get('/api/classes');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
    expect(res.body[0]).toHaveProperty('remaining');
    expect(res.body[0]).toHaveProperty('status');
  });

  test('GET /api/classes/:id returns one class', async () => {
    const res = await request(app).get('/api/classes/1');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Watercolour for Kids');
  });

  test('unknown class -> 404', async () => {
    expect((await request(app).get('/api/classes/999')).status).toBe(404);
  });
});

describe('POST /api/bookings', () => {
  const good = { classId: 1, name: 'Nic', email: 'nic@example.com', spots: 1 };

  test('valid booking -> 201 with reference, seat count drops', async () => {
    const before = (await request(app).get('/api/classes/1')).body.remaining;
    const res = await request(app).post('/api/bookings').send(good);
    expect(res.status).toBe(201);
    expect(res.body.refCode).toMatch(/^MMM-/);
    const after = (await request(app).get('/api/classes/1')).body.remaining;
    expect(after).toBe(before - 1);
  });

  test.each([
    ['missing fields', { classId: 1 }],
    ['bad email', { ...good, email: 'not-an-email' }],
    ['zero spots', { ...good, spots: 0 }],
    ['fractional spots', { ...good, spots: 1.5 }],
  ])('%s -> 400', async (_label, body) => {
    expect((await request(app).post('/api/bookings').send(body)).status).toBe(400);
  });

  test('full class -> 409 and offers waitlist', async () => {
    const res = await request(app).post('/api/bookings').send({ ...good, classId: 3 });
    expect(res.status).toBe(409);
    expect(res.body.offerWaitlist).toBe(true);
  });

  test('unknown class -> 404', async () => {
    expect((await request(app).post('/api/bookings').send({ ...good, classId: 999 })).status).toBe(404);
  });
});

describe('POST /api/waitlist', () => {
  test('joins waitlist -> 201', async () => {
    const res = await request(app).post('/api/waitlist').send({ classId: 3, name: 'Nic', email: 'nic@example.com' });
    expect(res.status).toBe(201);
  });

  test('bad email -> 400', async () => {
    expect((await request(app).post('/api/waitlist').send({ classId: 3, name: 'Nic', email: 'x' })).status).toBe(400);
  });

  test('unknown class -> 404', async () => {
    expect((await request(app).post('/api/waitlist').send({ classId: 999, name: 'Nic', email: 'nic@example.com' })).status).toBe(404);
  });
});
