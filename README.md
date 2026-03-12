# 🍃 ArvyaX — AI-Assisted Nature Journal

An AI-powered journaling system for immersive nature sessions. Users write about their forest, ocean, or mountain experiences; the system analyses emotions with Claude (Anthropic), stores results, and surfaces mental-state insights over time.

---

## Tech Stack

| Layer    | Technology |
|----------|------------|
| Backend  | Node.js 20 + Express 4 |
| Frontend | React 18 + **Vite 5** (no AJV conflicts) |
| Database | SQLite (better-sqlite3) |
| LLM      | Anthropic Claude Haiku (cheapest/fastest) |
| Caching  | Two-layer: in-process (node-cache) + SQLite |
| Docker   | Docker + Docker Compose |

---

## Prerequisites

- **Node.js ≥ 18** and npm ≥ 9
- A free **Anthropic API key** → https://console.anthropic.com  
  (Haiku costs ~$0.00015 per analysis — very cheap)

---

## Quick Start (Local, no Docker)

### 1 — Backend

```bash
cd backend
cp .env.example .env
# Open .env and set ANTHROPIC_API_KEY=sk-ant-...

npm install
npm start
# ✅ API running → http://localhost:5000
```

### 2 — Frontend (new terminal)

```bash
cd frontend
npm install
npm run dev
# ✅ App running → http://localhost:3000
```

> The Vite dev server proxies `/api/*` to `http://localhost:5000` automatically — no CORS setup needed.

---

## Docker (recommended for submission)

```bash
# Copy and fill in your API key
cp backend/.env.example .env
# Edit .env: ANTHROPIC_API_KEY=sk-ant-...

docker-compose up --build

# Frontend → http://localhost:3000
# Backend  → http://localhost:5000
```

---

## API Reference

### `POST /api/journal`
Create a journal entry.

**Request**
```json
{ "userId": "123", "ambience": "forest", "text": "I felt calm today after listening to the rain." }
```
**Response** `201`
```json
{ "message": "Journal entry saved.", "entry": { "id": "...", "userId": "123", ... } }
```

---

### `GET /api/journal/:userId`
Get all entries for a user (with cached analysis if available).

**Query params:** `?limit=50&offset=0`

**Response** `200`
```json
{
  "entries": [{ "id": "...", "userId": "123", "ambience": "forest", "text": "...", "createdAt": "...", "analysis": null }],
  "total": 1, "limit": 50, "offset": 0
}
```

---

### `POST /api/journal/analyze`
Analyse emotion with Claude. Results are cached — identical text never hits the LLM twice.

**Request**
```json
{ "text": "I felt calm today after listening to the rain", "entryId": "uuid-optional" }
```
Add `"stream": true` for SSE streaming response.

**Response** `200`
```json
{
  "emotion": "calm",
  "keywords": ["rain", "nature", "peace"],
  "summary": "User experienced relaxation during the forest session.",
  "cached": false
}
```

---

### `GET /api/journal/insights/:userId`
Aggregated mental-state insights.

**Response** `200`
```json
{
  "totalEntries": 8,
  "topEmotion": "calm",
  "mostUsedAmbience": "forest",
  "recentKeywords": ["focus", "nature", "rain"]
}
```

---

### `GET /api/health`
```json
{ "status": "ok", "ts": "2025-01-01T00:00:00.000Z" }
```

---

## Features

| Feature | Status |
|---------|--------|
| All 4 required API endpoints | ✅ |
| SQLite persistence | ✅ |
| Real LLM analysis (Claude Haiku) | ✅ |
| Two-layer caching (memory + DB) | ✅ |
| Streaming LLM response (SSE) | ✅ |
| Rate limiting (global + per-LLM) | ✅ |
| Input validation & error handling | ✅ |
| Docker + Docker Compose | ✅ |
| React frontend (Vite, no AJV issues) | ✅ |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | **Yes** | — | Anthropic API key |
| `PORT` | No | `5000` | Backend port |
| `FRONTEND_URL` | No | `http://localhost:3000` | CORS origin |
| `DB_PATH` | No | `./data/journal.db` | SQLite path |

---

## Project Structure

```
arvyax-journal/
├── backend/
│   ├── src/
│   │   ├── index.js                 # Express bootstrap
│   │   ├── db.js                    # SQLite init & helpers
│   │   ├── middleware/
│   │   │   └── validate.js          # Request validators
│   │   ├── routes/
│   │   │   └── journal.js           # All 4 endpoints
│   │   └── services/
│   │       └── llm.js               # Anthropic integration + caching
│   ├── .env.example
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── main.jsx                 # React entry
│   │   ├── App.jsx                  # Full SPA (Write / Entries / Insights)
│   │   ├── index.css
│   │   └── api/
│   │       └── journal.js           # Axios API client
│   ├── index.html
│   ├── vite.config.js
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── docker-compose.yml
├── README.md
└── ARCHITECTURE.md
```
