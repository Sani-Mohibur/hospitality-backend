import { Types } from 'mongoose';

// A room type ("Deluxe King"). Hotels sell room types; specific rooms are assigned later.
export interface IRoomCategory {
  name: string;
  code?: string;
  description?: string;
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  // Default nightly price when no rate plan price is set, in minor units
  baseRateMinor: number;
  // Guests included in the rate; extra guests pay the extra-person prices
  baseOccupancy: number;
  capacity: number;
  maxAdults: number;
  maxChildren: number;
  extraAdultMinor: number;
  extraChildMinor: number;
  amenities: string[];
  images: string[];
  sortOrder: number;
  isActive: boolean;
  isDeleted: boolean;
}
