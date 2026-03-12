'use strict';

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const { initDb } = require('./db');
const makeJournalRouter = require('./routes/journal');

const app  = express();
const PORT = process.env.PORT || 5000;

// CORS — FRONTEND_URL=* opens all origins (good for Render while frontend URL is TBD)
const corsOrigin = process.env.FRONTEND_URL === '*'
  ? '*'
  : (process.env.FRONTEND_URL || 'http://localhost:3000');

app.use(cors({ origin: corsOrigin, methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '1mb' }));

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 120,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use(globalLimiter);

// LLM-specific rate limiter
const llmLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  message: { error: 'Too many analysis requests. Wait a moment and try again.' },
});

app.use('/api/journal', makeJournalRouter(llmLimiter));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, _req, res, _next) => {
  console.error('[Unhandled]', err);
  res.status(500).json({ error: 'Internal server error.' });
});

initDb();
app.listen(PORT, () => console.log(`\n🍃  ArvyaX Journal API → http://localhost:${PORT}\n`));

module.exports = app;
