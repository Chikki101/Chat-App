import mongoose from 'mongoose';

const friendshipSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted'], default: 'pending' },
  },
  { timestamps: true }
);

friendshipSchema.index({ from: 1, to: 1 }, { unique: true });
friendshipSchema.index({ to: 1, status: 1 });

export default mongoose.model('Friendship', friendshipSchema);
