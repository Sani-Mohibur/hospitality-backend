import { Types } from 'mongoose';

export interface ILocation {
  name: string;
  code?: string;
  tenantId: Types.ObjectId;
  address?: string;
  phone?: string;
  email?: string;
  timezone: string;
  currency?: string;
  // Hotel business date; advanced only by the night audit
  businessDate: string;
  checkInTime: string;
  checkOutTime: string;
  hasRooms: boolean;
  nightAudit: {
    autoRun: boolean;
    runAt: string;
    lastRunAt?: Date;
  };
  publicBooking: {
    enabled: boolean;
    slug?: string;
  };
  invoicePrefix: string;
  isActive: boolean;
  isDeleted: boolean;
}
