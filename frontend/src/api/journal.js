import axios from 'axios';

const BACKEND = import.meta.env.VITE_API_URL || 'https://arvyax-journal.onrender.com';

const http = axios.create({
  baseURL: `${BACKEND}/api`,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

export const createEntry  = (userId, ambience, text) =>
  http.post('/journal', { userId, ambience, text }).then(r => r.data);

export const getEntries   = (userId, limit = 50, offset = 0) =>
  http.get(`/journal/${userId}`, { params: { limit, offset } }).then(r => r.data);

export const analyzeEntry = (text, entryId = null) =>
  http.post('/journal/analyze', { text, entryId }).then(r => r.data);

export const getInsights  = (userId) =>
  http.get(`/journal/insights/${userId}`).then(r => r.data);
