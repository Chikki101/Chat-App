import mongoose from 'mongoose';

const conversationReadSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    room: { type: String, required: true },
    readAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

conversationReadSchema.index({ user: 1, room: 1 }, { unique: true });

export default mongoose.model('ConversationRead', conversationReadSchema);
