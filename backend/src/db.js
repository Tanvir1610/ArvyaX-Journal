'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '../../data/journal.db');

let _db = null;

/**
 * Returns the singleton DB connection (lazy init).
 */
function getDb() {
  if (_db) return _db;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');   // concurrent reads
  _db.pragma('foreign_keys = ON');
  return _db;
}

/**
 * Create tables if they don't exist.
 */
function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      ambience    TEXT NOT NULL,
      text        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_je_user ON journal_entries(user_id);
    CREATE INDEX IF NOT EXISTS idx_je_time ON journal_entries(created_at);

    CREATE TABLE IF NOT EXISTS analysis_cache (
      id           TEXT PRIMARY KEY,
      entry_id     TEXT,
      text_hash    TEXT NOT NULL UNIQUE,
      emotion      TEXT NOT NULL,
      keywords     TEXT NOT NULL,   -- JSON array
      summary      TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ac_hash    ON analysis_cache(text_hash);
    CREATE INDEX IF NOT EXISTS idx_ac_entry   ON analysis_cache(entry_id);
  `);

  console.log('[DB] Initialized →', DB_PATH);
}

module.exports = { getDb, initDb };
