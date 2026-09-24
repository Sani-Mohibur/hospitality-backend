import { Types } from 'mongoose';

// Housekeeping state is set by staff. Occupancy is set only by check-in/check-out.
export const HOUSEKEEPING_STATUS = {
  CLEAN: 'CLEAN',
  DIRTY: 'DIRTY',
  IN_PROGRESS: 'IN_PROGRESS',
  INSPECTED: 'INSPECTED',
} as const;

export const OCCUPANCY_STATUS = {
  VACANT: 'VACANT',
  OCCUPIED: 'OCCUPIED',
} as const;

// OUT_OF_ORDER removes the room from sellable inventory; OUT_OF_SERVICE keeps it sellable.
export const ROOM_BLOCK_TYPE = {
  OUT_OF_ORDER: 'OUT_OF_ORDER',
  OUT_OF_SERVICE: 'OUT_OF_SERVICE',
} as const;

export type THousekeepingStatus = keyof typeof HOUSEKEEPING_STATUS;
export type TOccupancyStatus = keyof typeof OCCUPANCY_STATUS;

export interface IRoom {
  roomNumber: string;
  roomCategoryId: Types.ObjectId;
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  floor?: string;
  features: string[];
  housekeepingStatus: THousekeepingStatus;
  occupancyStatus: TOccupancyStatus;
  currentStayId?: Types.ObjectId;
  // Token printed as a QR code in the room (Guest QR)
  qrToken?: string;
  notes?: string;
  isActive: boolean;
  isDeleted: boolean;
}

export interface IRoomBlock {
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  roomId: Types.ObjectId;
  type: keyof typeof ROOM_BLOCK_TYPE;
  // Business dates; `to` is exclusive (like a departure date)
  from: string;
  to: string;
  reason: string;
  createdBy?: Types.ObjectId;
  releasedAt?: Date;
  releasedBy?: Types.ObjectId;
}
