import axios from 'axios';

const BACKEND = import.meta.env.VITE_API_URL || 'https://arvyax-journal.onrender.com';

const http = axios.create({
  baseURL: `${BACKEND}/api`,
  timeout: 60_000, // 60s — Render free tier can take 30-50s to wake up
  headers: { 'Content-Type': 'application/json' },
});

// Friendly error messages
http.interceptors.response.use(
  res => res,
  err => {
    if (!err.response) {
      // Network / CORS / server down
      err.message =
        'Cannot reach the server. It may be waking up (Render free tier sleeps after inactivity). Wait 30 seconds and try again.';
    }
    return Promise.reject(err);
  }
);

export const ping         = () =>
  http.get('/health').then(r => r.data);

export const createEntry  = (userId, ambience, text) =>
  http.post('/journal', { userId, ambience, text }).then(r => r.data);

export const getEntries   = (userId, limit = 50, offset = 0) =>
  http.get(`/journal/${userId}`, { params: { limit, offset } }).then(r => r.data);

export const analyzeEntry = (text, entryId = null) =>
  http.post('/journal/analyze', { text, entryId }).then(r => r.data);

export const getInsights  = (userId) =>
  http.get(`/journal/insights/${userId}`).then(r => r.data);
