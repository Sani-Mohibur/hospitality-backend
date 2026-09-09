import { Types } from 'mongoose';

export const FOLIO_STATUS = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;

export type TFolioStatus = keyof typeof FOLIO_STATUS;

export interface IFolio {
  reservationId: Types.ObjectId;
  guestId: Types.ObjectId;
  tenantId: Types.ObjectId;
  locationId: Types.ObjectId;
  status: TFolioStatus;
  isActive: boolean;
  isDeleted: boolean;
}
