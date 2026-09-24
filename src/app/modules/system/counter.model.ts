import { Schema, model } from 'mongoose';

// Atomic sequences (invoice numbers, order numbers, socket event sequence).
// Incremented inside the caller's transaction so aborted work leaves no gap.
const counterSchema = new Schema({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});

export const Counter = model('Counter', counterSchema);

export const nextSequence = async (key: string): Promise<number> => {
  const doc = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return doc!.seq;
};
