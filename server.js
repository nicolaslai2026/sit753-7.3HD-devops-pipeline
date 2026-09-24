require('dotenv').config({ quiet: true });

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const client = require('prom-client');
const { sendConfirmationEmail } = require('./notify');
const { seed } = require('./scripts/seed');
const pkg = require('./package.json');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_ENV = process.env.APP_ENV || 'development';
const APP_VERSION = process.env.APP_VERSION || pkg.version;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');

// ---------------------------------------------------------------------------
//  Database (tables are created/seeded on start-up, so a fresh container works)
// ---------------------------------------------------------------------------
seed(DB_PATH, { quiet: process.env.NODE_ENV === 'test' });
const db = new DatabaseSync(DB_PATH);

// ---------------------------------------------------------------------------
//  Security middleware  (7.3HD Security stage fixes)
// ---------------------------------------------------------------------------
// FIX: previously fell back to a hard-coded secret in every environment.
// Now production refuses to start without a real secret injected from Jenkins.
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production');
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// FIX: security headers (CSP, X-Content-Type-Options, frameguard...).
// HSTS / upgrade-insecure-requests are off because this demo runs over plain HTTP.
app.use(helmet({
  strictTransportSecurity: false,
  contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
}));

// FIX: rate-limit the write endpoints so one client can't spam bookings.
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_MAX) || 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' },
}));

// ---------------------------------------------------------------------------
//  Monitoring: Prometheus metrics  (7.3HD Monitoring stage)
// ---------------------------------------------------------------------------
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [register],
});

const bookingsTotal = new client.Counter({
  name: 'mmm_bookings_total',
  help: 'Booking attempts by result',
  labelNames: ['result'],
  registers: [register],
});

// Sonar fix: keep a reference instead of a bare `new` (the gauge fills itself via collect())
const seatsRemainingGauge = new client.Gauge({
  name: 'mmm_class_seats_remaining',
  help: 'Seats remaining per class (read from the DB at scrape time)',
  labelNames: ['class'],
  registers: [register],
  collect() {
    this.reset();
    const rows = db.prepare('SELECT name, max_spots - booked_spots AS remaining FROM classes').all();
    rows.forEach((r) => this.set({ class: r.name }, r.remaining));
  },
});

new client.Gauge({
  name: 'mmm_app_info',
  help: 'Static info about the running build',
  labelNames: ['version', 'env'],
  registers: [register],
}).set({ version: APP_VERSION, env: APP_ENV }, 1);

// Count + time every request. Route label uses the Express pattern (e.g. /api/classes/:id)
// so metrics don't explode with one series per id.
app.use((req, res, next) => {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? req.route.path : (res.statusCode === 404 ? 'not_found' : 'static');
    httpRequests.inc({ method: req.method, route, status: res.statusCode });
    end({ method: req.method, route });
  });
  next();
});

// Health endpoint: used by Docker HEALTHCHECK, the Deploy/Release smoke tests, and Prometheus.
app.get('/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', env: APP_ENV, version: APP_VERSION, uptime: process.uptime() });
  } catch {
    res.status(503).json({ status: 'error', error: 'database unavailable' });
  }
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ---------------------------------------------------------------------------
//  Original MMM Art Studio booking logic (SIT774 10.3HD)
// ---------------------------------------------------------------------------
function statusFor(remaining) {
  if (remaining <= 0) return 'full';
  if (remaining <= 2) return 'limited';
  return 'available';
}

function makeRefCode() {
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `MMM-${new Date().getFullYear()}-${rand}`;
}

function toClassDTO(row) {
  const remaining = row.max_spots - row.booked_spots;
  return {
    id: row.id,
    name: row.name,
    day: row.day,
    time: row.time,
    ageGroup: row.age_group,
    price: row.price,
    maxSpots: row.max_spots,
    remaining,
    status: statusFor(remaining),
  };
}

//  FEATURE 1 : DYNAMIC AVAILABILITY
app.get('/api/classes', (req, res) => {
  const rows = db.prepare('SELECT * FROM classes ORDER BY id').all();
  res.json(rows.map(toClassDTO));
});

app.get('/api/classes/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM classes WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Class not found' });
  res.json(toClassDTO(row));
});

//  FEATURE 2 : CONCURRENCY-SAFE BOOKING
function bookClassAtomically({ classId, name, email, phone, spots }) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'not_found' };
    }

    const remaining = cls.max_spots - cls.booked_spots;

    if (remaining <= 0) {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'full' };
    }
    if (spots > remaining) {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'too_many', remaining };
    }

    db.prepare('UPDATE classes SET booked_spots = booked_spots + ? WHERE id = ?')
      .run(spots, classId);

    const refCode = makeRefCode();
    db.prepare(`
      INSERT INTO bookings (class_id, name, email, phone, spots, ref_code)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(classId, name, email, phone || null, spots, refCode);

    db.exec('COMMIT');

    return {
      ok: true,
      booking: {
        refCode,
        className: cls.name,
        when: `${cls.day} ${cls.time}`,
        spots,
        price: cls.price,
        name,
        email,
        phone: phone || null,
      },
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Sonar S5852 fix: domain labels exclude '.', so no two quantifiers overlap -> no catastrophic backtracking
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

// Refactored out of the route handler (ESLint complexity rule flagged it at 14 > 12).
function validateBooking({ classId, name, email, spots }) {
  if (!classId || !name || !email || !spots) return 'Missing required fields.';
  if (!EMAIL_RE.test(email)) return 'Please provide a valid email address.';
  const n = Number(spots);
  if (!Number.isInteger(n) || n < 1) return 'Spots must be a whole number of at least 1.';
  return null;
}

// Maps a failed transaction result to an HTTP status + body.
const FAILURE_RESPONSES = {
  not_found: () => [404, { error: 'Class not found.' }],
  full:      () => [409, { error: 'Sorry, this class just filled up.', offerWaitlist: true }],
  too_many:  (r) => [409, { error: `Only ${r.remaining} spot(s) remaining.`, remaining: r.remaining }],
};

app.post('/api/bookings', writeLimiter, async (req, res) => {
  const { classId, name, email, phone, spots } = req.body;

  const invalid = validateBooking(req.body);
  if (invalid) {
    bookingsTotal.inc({ result: 'invalid' });
    return res.status(400).json({ error: invalid });
  }

  let result;
  try {
    result = bookClassAtomically({ classId: Number(classId), name, email, phone, spots: Number(spots) });
  } catch (err) {
    console.error('Booking transaction failed:', err);
    bookingsTotal.inc({ result: 'error' });
    return res.status(500).json({ error: 'Could not complete the booking. Please try again.' });
  }

  if (!result.ok) {
    bookingsTotal.inc({ result: result.reason });
    const [status, body] = FAILURE_RESPONSES[result.reason](result);
    return res.status(status).json(body);
  }

  bookingsTotal.inc({ result: 'confirmed' });
  const b = result.booking;

  let emailResult = { sent: false };
  try {
    emailResult = await sendConfirmationEmail(b);
  } catch (err) {
    console.error('Confirmation email failed (booking still confirmed):', err.message);
  }

  res.status(201).json({
    refCode: b.refCode,
    className: b.className,
    when: b.when,
    spots: b.spots,
    emailSent: emailResult.sent,
  });
});

app.post('/api/waitlist', writeLimiter, async (req, res) => {
  const { classId, name, email, phone } = req.body;

  if (!classId || !name || !email) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }

  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(Number(classId));
  if (!cls) return res.status(404).json({ error: 'Class not found.' });

  db.prepare(`
    INSERT INTO waitlist (class_id, name, email, phone)
    VALUES (?, ?, ?, ?)
  `).run(Number(classId), name, email, phone || null);

  res.status(201).json({ message: "You're on the waitlist. We'll notify you if a spot opens." });
});

// Only listen when run directly (node server.js). Tests import the app instead.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`MMM Art Studio [${APP_ENV} v${APP_VERSION}] running at http://localhost:${PORT}`);
  });
}

module.exports = app;
module.exports.statusFor = statusFor;
module.exports.makeRefCode = makeRefCode;
module.exports.toClassDTO = toClassDTO;
module.exports.bookClassAtomically = bookClassAtomically;
module.exports.validateBooking = validateBooking;
module.exports.seatsRemainingGauge = seatsRemainingGauge;
