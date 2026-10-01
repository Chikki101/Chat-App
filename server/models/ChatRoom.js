import mongoose from 'mongoose';

const banSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, default: 'Room rules' },
    source: { type: String, enum: ['owner', 'sentiment'], required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const roomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 40 },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    inviteHash: { type: String, required: true, unique: true },
    bans: { type: [banSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model('ChatRoom', roomSchema);
