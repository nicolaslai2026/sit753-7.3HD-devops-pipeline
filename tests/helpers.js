// Gives every test file its own throw-away SQLite DB so tests never touch real data.
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDbPath(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mmm-${label}-`));
  return path.join(dir, 'test.db');
}

module.exports = { freshDbPath };
