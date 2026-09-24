import { TAuthUser } from '../middlewares/auth';

declare global {
  namespace Express {
    interface Request {
      user: TAuthUser;
      // Active location resolved and verified by the locationScope middleware
      locationId?: string;
      // Raw body bytes kept for webhook signature checks
      rawBody?: Buffer;
    }
  }
}
