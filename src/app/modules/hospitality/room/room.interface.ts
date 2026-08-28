import { Types } from 'mongoose';

export const ROOM_STATUS = {
  VACANT_CLEAN: 'VACANT_CLEAN',
  VACANT_DIRTY: 'VACANT_DIRTY',
  OCCUPIED: 'OCCUPIED',
  RESERVED: 'RESERVED',
  OUT_OF_ORDER: 'OUT_OF_ORDER',
  UNDER_MAINTENANCE: 'UNDER_MAINTENANCE',
} as const;

export type TRoomStatus = keyof typeof ROOM_STATUS;

export interface IRoom {
  roomNumber: string;
  roomCategoryId: Types.ObjectId;
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  status: TRoomStatus;
  isActive: boolean;
  isDeleted: boolean;
}
