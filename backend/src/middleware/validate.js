'use strict';

const VALID_AMBIENCES = new Set(['forest', 'ocean', 'mountain', 'desert', 'meadow']);

/** Validate POST /api/journal body */
function validateJournalEntry(req, res, next) {
  const { userId, ambience, text } = req.body ?? {};

  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    return res.status(400).json({ error: 'userId is required (non-empty string).' });
  }
  if (!ambience || !VALID_AMBIENCES.has(ambience)) {
    return res.status(400).json({
      error: `ambience must be one of: ${[...VALID_AMBIENCES].join(', ')}.`,
    });
  }
  if (!text || typeof text !== 'string' || text.trim().length < 10) {
    return res.status(400).json({ error: 'text must be at least 10 characters.' });
  }
  if (text.length > 5000) {
    return res.status(400).json({ error: 'text must not exceed 5000 characters.' });
  }

  // Normalise
  req.body.userId  = userId.trim();
  req.body.text    = text.trim();
  next();
}

/** Validate POST /api/journal/analyze body */
function validateAnalyze(req, res, next) {
  const { text } = req.body ?? {};

  if (!text || typeof text !== 'string' || text.trim().length < 5) {
    return res.status(400).json({ error: 'text is required (min 5 characters).' });
  }
  if (text.length > 5000) {
    return res.status(400).json({ error: 'text must not exceed 5000 characters.' });
  }

  req.body.text = text.trim();
  next();
}

module.exports = { validateJournalEntry, validateAnalyze };
