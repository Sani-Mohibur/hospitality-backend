import { EventEmitter } from 'events';
import logger from './logger';
import { requestContext } from './requestContext';
import { outsideTransaction } from './transaction';

// In-process domain events. Emitted after a transaction commits; listeners (loyalty,
// alerts, outbound webhooks, guest stats) run in the tenant's context and can never
// fail the operation that emitted them.
export type TDomainEvent =
  | 'reservation.created'
  | 'reservation.updated'
  | 'reservation.cancelled'
  | 'stay.checkedIn'
  | 'stay.checkedOut'
  | 'stay.noShow'
  | 'folio.closed'
  | 'order.created'
  | 'order.closed'
  | 'order.itemsFired'
  | 'order.itemsVoided'
  | 'payment.completed'
  | 'payment.refunded'
  | 'inventory.low'
  | 'availability.changed'
  | 'retailSale.completed'
  | 'retailReturn.completed';

type THandler = (payload: any) => Promise<void> | void;

const bus = new EventEmitter();
bus.setMaxListeners(50);

export const onDomainEvent = (event: TDomainEvent, handler: THandler) => {
  bus.on(event, (payload: { tenantId: string }) => {
    requestContext
      .asTenant(payload.tenantId, async () => handler(payload))
      ?.catch?.((err: unknown) => logger.error(err, `Handler for ${event} failed`));
  });
};

export const emitDomainEvent = (event: TDomainEvent, payload: { tenantId: string; [key: string]: unknown }) => {
  outsideTransaction(() => setImmediate(() => bus.emit(event, payload)));
};
