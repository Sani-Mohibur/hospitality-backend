import { Schema, model } from 'mongoose';
import { IPlatformModule } from './platformModule.interface';

const platformModuleSchema = new Schema<IPlatformModule>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
    },
    description: {
      type: String,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    basePrice: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

export const PlatformModule = model<IPlatformModule>('PlatformModule', platformModuleSchema);
