import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import protect from '../middleware/auth.js';

const router = Router();

const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#14b8a6'];
const sign = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
const publicUser = (u) => ({ id: String(u._id), username: u.username, avatarColor: u.avatarColor });

router.post('/register', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ message: 'Username must be 3-20 characters' });
    }
    if (!/^[a-z0-9_]+$/.test(username)) {
      return res.status(400).json({ message: 'Username can only use letters, numbers and _' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    if (await User.findOne({ username })) {
      return res.status(409).json({ message: 'Username is already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const avatarColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    const user = await User.create({ username, passwordHash, avatarColor });

    res.status(201).json({ token: sign(user._id), user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    res.json({ token: sign(user._id), user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/me', protect, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
