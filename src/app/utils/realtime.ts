import { Types } from 'mongoose';
import { EventLog } from '../modules/system/eventLog.model';
import { nextSequence } from '../modules/system/counter.model';
import { requestContext } from './requestContext';
import { socketManager } from './socket';
import logger from './logger';
import { outsideTransaction } from './transaction';

// Socket room names. IDs are globally unique ObjectIds, so no tenant prefix is needed;
// the socket server only lets a client join rooms inside its own grants.
export const rooms = {
  tenant: (id: unknown) => `tenant:${id}`,
  location: (id: unknown) => `location:${id}`,
  outlet: (id: unknown) => `outlet:${id}`,
  station: (id: unknown) => `station:${id}`,
  user: (id: unknown) => `user:${id}`,
  housekeeping: (locationId: unknown) => `housekeeping:${locationId}`,
  managers: (locationId: unknown) => `managers:${locationId}`,
};

type TPublishInput = {
  tenantId: unknown;
  locationId?: unknown;
  rooms: string[];
  event: string;
  data: unknown;
};

// Persists the event with a sequence number, then emits it. Failures never break
// the business operation that triggered them.
export const publish = (input: TPublishInput) => outsideTransaction(() => publishNow(input));

const publishNow = async (input: TPublishInput) => {
  try {
    const seqKey = `events:${input.locationId || input.tenantId}`;
    const seq = await requestContext.asSystem(() => nextSequence(seqKey));
    const payload = JSON.parse(JSON.stringify(input.data ?? null));
    await requestContext.asSystem(() =>
      EventLog.create({
        tenantId: new Types.ObjectId(String(input.tenantId)),
        locationId: input.locationId ? new Types.ObjectId(String(input.locationId)) : undefined,
        seq,
        event: input.event,
        rooms: input.rooms,
        data: payload,
      }),
    );
    const envelope = { seq, event: input.event, locationId: input.locationId, data: payload, at: new Date() };
    for (const room of new Set(input.rooms)) socketManager.emitToRoom(room, input.event, envelope);
  } catch (err) {
    logger.error(err, `Failed to publish realtime event ${input.event}`);
  }
};

export type TOutbox = TPublishInput[];

// Services collect events while a transaction runs and flush them after it commits,
// so clients never see an event for a change that was rolled back.
export const flush = (outbox: TOutbox) => {
  for (const item of outbox.splice(0)) void publish(item);
};

export const eventsSince = async (locationId: string, since: number, limit = 500) =>
  EventLog.find({ locationId: new Types.ObjectId(locationId), seq: { $gt: since } })
    .sort({ seq: 1 })
    .limit(limit)
    .lean();
