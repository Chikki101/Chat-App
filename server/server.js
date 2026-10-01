import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import connectDB from './config/db.js';
import authRoutes from './routes/auth.js';
import messageRoutes from './routes/messages.js';
import roomRoutes from './routes/rooms.js';
import friendRoutes from './routes/friends.js';
import protect from './middleware/auth.js';
import { analyze } from './utils/sentiment.js';
import { initSocket } from './socket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173';

if (!process.env.JWT_SECRET || !process.env.MONGO_URI) {
  console.error('Missing MONGO_URI or JWT_SECRET. Copy server/.env.example to server/.env and fill it in.');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: CLIENT_URL }));
app.use(express.json({ limit: '10kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/friends', friendRoutes);

// Live "tone preview" used by the message box while the user types
app.post('/api/analyze', protect, async (req, res) => {
  const text = String(req.body?.text || '').slice(0, 500);
  try {
    res.json(await analyze(text));
  } catch (err) {
    console.error('sentiment analysis failed', err);
    res.status(503).json({ message: 'The local sentiment model is not available yet' });
  }
});

// In production the Express server also serves the built React app
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.locals.io = initSocket(server, CLIENT_URL);

connectDB().then(() => {
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
