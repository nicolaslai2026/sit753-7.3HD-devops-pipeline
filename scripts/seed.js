// Creates the tables and loads sample classes (idempotent: safe to run on every start).
// CLI:   node scripts/seed.js
// Tests: require('./scripts/seed').seed(dbPath)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DEFAULT_DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');

function seed(dbPath = DEFAULT_DB_PATH, { quiet = false } = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS classes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      day           TEXT    NOT NULL,
      time          TEXT    NOT NULL,
      age_group     TEXT    NOT NULL,
      price         REAL    NOT NULL,
      max_spots     INTEGER NOT NULL,
      booked_spots  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id    INTEGER NOT NULL,
      name        TEXT    NOT NULL,
      email       TEXT    NOT NULL,
      phone       TEXT,
      spots       INTEGER NOT NULL,
      ref_code    TEXT    NOT NULL UNIQUE,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (class_id) REFERENCES classes(id)
    );

    CREATE TABLE IF NOT EXISTS waitlist (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id    INTEGER NOT NULL,
      name        TEXT    NOT NULL,
      email       TEXT    NOT NULL,
      phone       TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      notified_at TEXT,
      FOREIGN KEY (class_id) REFERENCES classes(id)
    );
  `);

  const count = db.prepare('SELECT COUNT(*) AS c FROM classes').get().c;

  if (count === 0) {
    const insert = db.prepare(`
      INSERT INTO classes (name, day, time, age_group, price, max_spots, booked_spots)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    // name, day, time, age group, price, max spots, booked spots
    insert.run('Watercolour for Kids',  'Sat', '10:00am – 11:30am', '12yrs & under', 35, 8, 5);
    insert.run('Teen Acrylic Workshop', 'Sun', '2:00pm – 4:00pm',   'Ages 13–17',    45, 6, 5);
    insert.run('Adult Life Drawing',    'Fri', '6:00pm – 8:00pm',   '18+',           50, 10, 10);
    insert.run('Pottery Basics',        'Wed', '5:30pm – 7:00pm',   'All ages',      40, 12, 4);
    insert.run('Calligraphy Evening',   'Thu', '6:30pm – 8:00pm',   'Ages 16+',      30, 8, 7);
    if (!quiet) console.log('Seeded 5 sample classes.');
  } else if (!quiet) {
    console.log(`classes table already has ${count} rows, skipping seed.`);
  }

  if (!quiet) console.log('Database ready at', dbPath);
  db.close();
}

if (require.main === module) seed();

module.exports = { seed };
