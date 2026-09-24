import { Types } from 'mongoose';

// One guest profile per tenant, shared by the hotel and every F&B outlet.
export interface IGuest {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  nationality?: string;
  dateOfBirth?: string;
  address?: string;
  idType?: string;
  // ID numbers are stored encrypted; only the last 4 characters are readable
  idNumberEnc?: string;
  idNumberLast4?: string;
  idExpiry?: string;
  documents: { type: string; url: string; publicId?: string; uploadedAt: Date; deleteAfter: Date }[];
  preferences: string[];
  allergies: string[];
  dietary: string[];
  tags: string[];
  notes?: string;
  companyAccountId?: Types.ObjectId;
  consent: {
    marketing: boolean;
    marketingAt?: Date;
    dataProcessing: boolean;
    dataProcessingAt?: Date;
    source?: string;
  };
  stats: {
    stays: number;
    nights: number;
    visits: number;
    totalSpendMinor: number;
    lastStayAt?: Date;
    lastVisitAt?: Date;
  };
  mergedIntoId?: Types.ObjectId;
  anonymizedAt?: Date;
  tenantId: Types.ObjectId;
  isActive: boolean;
  isDeleted: boolean;
}
