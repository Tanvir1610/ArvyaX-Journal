'use strict';

require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const { initDb } = require('./db');
const makeJournalRouter = require('./routes/journal');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── CORS — allow ALL origins (fixes browser network errors) ──────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors()); // handle preflight for all routes

app.use(express.json({ limit: '1mb' }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 120,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use(globalLimiter);

const llmLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  message: { error: 'Too many analysis requests. Wait a moment.' },
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/journal', makeJournalRouter(llmLimiter));

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', ts: new Date().toISOString() })
);

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, _req, res, _next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
initDb();
app.listen(PORT, () =>
  console.log(`\n🍃  ArvyaX API → http://localhost:${PORT}\n`)
);

module.exports = app;
