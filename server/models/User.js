import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 20,
    },
    passwordHash: { type: String, required: true },
    avatarColor: { type: String, default: '#6366f1' },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
