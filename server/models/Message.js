import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    room: { type: String, required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderName: { type: String, required: true },
    senderColor: { type: String, default: '#6366f1' },
    text: { type: String, required: true, maxlength: 500 },
    // Result of the AI sentiment analysis, stored with every message
    sentiment: {
      label: { type: String, enum: ['positive', 'neutral', 'negative'], default: 'neutral' },
      score: { type: Number, default: 0 },
      comparative: { type: Number, default: 0 },
      confidence: { type: Number, default: 0 },
      negativePoints: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

messageSchema.index({ room: 1, createdAt: -1 });
messageSchema.index({ room: 1, sender: 1, createdAt: -1 });

export default mongoose.model('Message', messageSchema);
