import { Router } from 'express';
import mongoose from 'mongoose';
import Friendship from '../models/Friendship.js';
import User from '../models/User.js';
import protect from '../middleware/auth.js';
import { usersBlocked } from '../utils/blocks.js';

const router = Router();

router.use(protect);

router.get('/:userId/profile', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    const user = await User.findById(req.params.userId).select(
      '_id username avatarColor email phone bio createdAt'
    );
    if (!user) return res.status(404).json({ message: 'User not found' });

    const isSelf = String(user._id) === String(req.user._id);
    const [isFriend, isBlocked] = await Promise.all([
      isSelf
        ? false
        : Friendship.exists({
            status: 'accepted',
            $or: [
              { from: req.user._id, to: user._id },
              { from: user._id, to: req.user._id },
            ],
          }),
      isSelf ? false : usersBlocked(req.user._id, user._id),
    ]);
    const canViewPrivate = isSelf || (Boolean(isFriend) && !isBlocked);
    const profile = {
      id: String(user._id),
      username: user.username,
      avatarColor: user.avatarColor,
      createdAt: user.createdAt,
      isSelf,
      canViewPrivate,
    };
    if (canViewPrivate) {
      profile.email = user.email;
      profile.phone = user.phone;
      profile.bio = user.bio;
    }
    res.json({ profile });
  } catch (err) {
    console.error('users:profile failed', err);
    res.status(500).json({ message: 'Could not load profile' });
  }
});

router.patch('/me/profile', async (req, res) => {
  try {
    const fields = ['email', 'phone', 'bio'];
    const updates = req.body || {};
    if (Object.keys(updates).some((field) => !fields.includes(field))) {
      return res.status(400).json({ message: 'Only email, phone, and bio can be updated' });
    }

    const changes = {};
    for (const field of fields) {
      if (!(field in updates)) continue;
      if (typeof updates[field] !== 'string') {
        return res.status(400).json({ message: `${field} must be text` });
      }
      changes[field] = updates[field].trim();
    }

    if (changes.email !== undefined) {
      changes.email = changes.email.toLowerCase();
      if (
        changes.email.length > 254 ||
        (changes.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.email))
      ) {
        return res.status(400).json({ message: 'Enter a valid email address' });
      }
    }
    if (changes.phone !== undefined && (changes.phone.length > 32 || !/^[+0-9().\-\s]*$/.test(changes.phone))) {
      return res.status(400).json({ message: 'Enter a valid phone number' });
    }
    if (changes.bio !== undefined && changes.bio.length > 500) {
      return res.status(400).json({ message: 'Bio must be 500 characters or fewer' });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: changes },
      { new: true, runValidators: true }
    ).select('_id username avatarColor email phone bio createdAt');
    res.json({
      profile: {
        id: String(user._id),
        username: user.username,
        avatarColor: user.avatarColor,
        email: user.email,
        phone: user.phone,
        bio: user.bio,
        createdAt: user.createdAt,
        isSelf: true,
        canViewPrivate: true,
      },
    });
  } catch (err) {
    console.error('users:update profile failed', err);
    res.status(500).json({ message: 'Could not update profile' });
  }
});

export default router;
