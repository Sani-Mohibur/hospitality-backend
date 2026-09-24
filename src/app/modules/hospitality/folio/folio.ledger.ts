import httpStatus from 'http-status';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { Folio, FolioInvoice, FolioLine } from './folio.model';
import { FOLIO_LINE_TYPE, FOLIO_SOURCE, FOLIO_STATUS, IFolioLine } from './folio.interface';
import { chargeCodeByCode, taxFor } from '../../finance/finance.service';
import { ChargeCode } from '../../finance/finance.model';
import { Location } from '../../location/location.model';
import { Guest } from '../guest/guest.model';
import { CompanyAccount } from '../companyAccount/companyAccount.model';
import { nextSequence } from '../../system/counter.model';
import { requestContext } from '../../../utils/requestContext';
import { found } from '../../../utils/query';

type TId = Types.ObjectId | string;

const businessDateOf = async (locationId: TId) => {
  const location = found(await Location.findById(locationId).select('businessDate currency invoicePrefix').lean(), 'Location');
  return location.businessDate;
};

export const nextFolioNumber = async (locationId: TId) => {
  const seq = await nextSequence(`folio:${locationId}`);
  return `F${String(seq).padStart(6, '0')}`;
};

type TCreateFolio = {
  locationId: TId;
  type?: 'GUEST' | 'COMPANY' | 'HOUSE' | 'NON_RESIDENT';
  name: string;
  reservationId?: TId;
  roomStayId?: TId;
  guestId?: TId;
  companyAccountId?: TId;
  window?: number;
  creditLimitMinor?: number;
  currency?: string;
};

export const createFolio = async (input: TCreateFolio) => {
  const location = found(await Location.findById(input.locationId).select('currency').lean(), 'Location');
  const [folio] = await Folio.create([
    {
      ...input,
      type: input.type || 'GUEST',
      number: await nextFolioNumber(input.locationId),
      currency: input.currency || location.currency || 'USD',
      window: input.window || 1,
    },
  ]);
  return folio!;
};

type TPostLine = {
  folioId: TId;
  type: keyof typeof FOLIO_LINE_TYPE;
  code: string;
  description?: string;
  quantity?: number;
  unitAmountMinor: number;
  businessDate?: string;
  source: IFolioLine['source'];
  postingKey?: string;
  postedBy?: TId;
  approvedBy?: TId;
  reason?: string;
  paymentId?: TId;
  transferFolioId?: TId;
  reversalOfId?: TId;
  // Pre-computed tax (reversals and transfers copy the original's tax)
  taxOverride?: { netMinor: number; taxMinor: number; taxLines: IFolioLine['taxLines'] };
  allowClosedFolio?: boolean;
  skipCreditLimit?: boolean;
};

// Single entry point for writing to a folio. Call inside runInTransaction.
export const postLine = async (input: TPostLine) => {
  if (!Number.isInteger(input.unitAmountMinor)) throw new AppError(httpStatus.BAD_REQUEST, 'Amounts must be integers in minor units');

  if (input.postingKey) {
    const existing = await FolioLine.findOne({ postingKey: input.postingKey }).lean();
    if (existing) return existing;
  }

  const folio = found(await Folio.findById(input.folioId), 'Folio');
  if (folio.status !== FOLIO_STATUS.OPEN && !input.allowClosedFolio) {
    throw new AppError(httpStatus.CONFLICT, `Folio ${folio.number} is closed`);
  }

  const chargeCode = await chargeCodeByCode(input.code);
  const quantity = input.quantity ?? 1;
  const gross = input.unitAmountMinor * quantity;

  let netMinor = gross;
  let taxMinor = 0;
  let taxLines: IFolioLine['taxLines'] = [];
  let amountMinor = gross;

  if (input.type === FOLIO_LINE_TYPE.PAYMENT) {
    // A payment lowers the balance; reversing (refunding) one raises it again.
    amountMinor = input.reversalOfId ? Math.abs(gross) : -Math.abs(gross);
    netMinor = amountMinor;
  } else if (input.taxOverride) {
    ({ netMinor, taxMinor, taxLines } = input.taxOverride);
    amountMinor = netMinor + taxMinor;
  } else {
    const tax = await taxFor(gross, chargeCode.taxCategory, folio.locationId);
    netMinor = tax.netMinor;
    taxMinor = tax.taxMinor;
    taxLines = tax.taxLines;
    amountMinor = tax.grossMinor;
  }

  if (
    amountMinor > 0 &&
    !input.skipCreditLimit &&
    folio.creditLimitMinor !== undefined &&
    folio.creditLimitMinor !== null &&
    folio.balanceMinor + amountMinor > folio.creditLimitMinor
  ) {
    throw new AppError(httpStatus.PAYMENT_REQUIRED, `Credit limit reached on folio ${folio.number}`);
  }

  const ctx = requestContext.get();
  const [line] = await FolioLine.create([
    {
      locationId: folio.locationId,
      folioId: folio._id,
      type: input.type,
      chargeCodeId: chargeCode._id,
      code: chargeCode.code,
      description: input.description || chargeCode.name,
      quantity,
      unitAmountMinor: input.unitAmountMinor,
      netMinor,
      taxMinor,
      amountMinor,
      taxLines,
      businessDate: input.businessDate || (await businessDateOf(folio.locationId)),
      postedBy: input.postedBy || ctx?.userId,
      approvedBy: input.approvedBy,
      source: input.source,
      postingKey: input.postingKey,
      reversalOfId: input.reversalOfId,
      transferFolioId: input.transferFolioId,
      paymentId: input.paymentId,
      reason: input.reason,
    },
  ]);

  const isPayment = input.type === FOLIO_LINE_TYPE.PAYMENT;
  await Folio.updateOne(
    { _id: folio._id },
    {
      $inc: {
        balanceMinor: amountMinor,
        chargesMinor: isPayment ? 0 : amountMinor,
        paymentsMinor: isPayment ? -amountMinor : 0,
      },
    },
  );
  return line!.toObject();
};

// Cancels a line with an equal and opposite line; the original stays visible.
export const reverseLine = async (lineId: TId, reason: string, approvedBy?: TId) => {
  const line = found(await FolioLine.findById(lineId), 'Folio line');
  if (line.reversedById) throw new AppError(httpStatus.CONFLICT, 'Line is already reversed');
  if (line.reversalOfId) throw new AppError(httpStatus.BAD_REQUEST, 'A reversal cannot be reversed; post a new charge');

  const reversal = await postLine({
    folioId: line.folioId,
    type: line.type === FOLIO_LINE_TYPE.PAYMENT ? FOLIO_LINE_TYPE.PAYMENT : FOLIO_LINE_TYPE.ADJUSTMENT,
    code: line.code,
    description: `Reversal: ${line.description}`,
    quantity: line.quantity,
    unitAmountMinor: line.type === FOLIO_LINE_TYPE.PAYMENT ? line.unitAmountMinor : -line.unitAmountMinor,
    source: { kind: FOLIO_SOURCE.REVERSAL, refId: line._id as Types.ObjectId },
    reversalOfId: line._id as Types.ObjectId,
    reason,
    approvedBy,
    skipCreditLimit: true,
    taxOverride:
      line.type === FOLIO_LINE_TYPE.PAYMENT
        ? undefined
        : {
            netMinor: -line.netMinor,
            taxMinor: -line.taxMinor,
            taxLines: line.taxLines.map((t) => ({ ...t, amountMinor: -t.amountMinor })),
          },
  });
  await FolioLine.updateOne({ _id: line._id }, { reversedById: reversal._id });
  return reversal;
};

// Moves lines to another folio (split billing) keeping their original tax.
export const transferLines = async (lineIds: TId[], toFolioId: TId, reason?: string) => {
  const target = found(await Folio.findById(toFolioId), 'Target folio');
  if (target.status !== FOLIO_STATUS.OPEN) throw new AppError(httpStatus.CONFLICT, 'Target folio is closed');
  const moved = [];
  for (const id of lineIds) {
    const line = found(await FolioLine.findById(id), 'Folio line');
    if (String(line.folioId) === String(toFolioId)) continue;
    if (line.reversedById || line.reversalOfId) throw new AppError(httpStatus.BAD_REQUEST, 'Reversed lines cannot be moved');
    if (line.type === FOLIO_LINE_TYPE.PAYMENT) throw new AppError(httpStatus.BAD_REQUEST, 'Payments cannot be moved; refund and re-take instead');
    const tax = { netMinor: line.netMinor, taxMinor: line.taxMinor, taxLines: line.taxLines };
    const out = await postLine({
      folioId: line.folioId,
      type: FOLIO_LINE_TYPE.TRANSFER_OUT,
      code: line.code,
      description: `Moved to folio ${target.number}: ${line.description}`,
      quantity: line.quantity,
      unitAmountMinor: -line.unitAmountMinor,
      businessDate: line.businessDate,
      source: { kind: FOLIO_SOURCE.TRANSFER, refId: line._id as Types.ObjectId },
      transferFolioId: target._id,
      reversalOfId: line._id as Types.ObjectId,
      reason,
      skipCreditLimit: true,
      taxOverride: { netMinor: -tax.netMinor, taxMinor: -tax.taxMinor, taxLines: tax.taxLines.map((t) => ({ ...t, amountMinor: -t.amountMinor })) },
    });
    await FolioLine.updateOne({ _id: line._id }, { reversedById: out._id });
    const copy = await postLine({
      folioId: target._id,
      type: FOLIO_LINE_TYPE.TRANSFER_IN,
      code: line.code,
      description: line.description,
      quantity: line.quantity,
      unitAmountMinor: line.unitAmountMinor,
      businessDate: line.businessDate,
      source: { ...line.source, kind: line.source.kind },
      transferFolioId: line.folioId,
      reason,
      taxOverride: tax,
    });
    moved.push(copy);
  }
  return moved;
};

// Moves the whole balance (e.g. to the company's city-ledger folio at check-out).
export const transferBalance = async (fromFolioId: TId, toFolioId: TId, reason: string) => {
  const from = found(await Folio.findById(fromFolioId), 'Folio');
  const to = found(await Folio.findById(toFolioId), 'Target folio');
  if (from.balanceMinor === 0) return undefined;
  const amount = from.balanceMinor;
  await postLine({
    folioId: from._id,
    type: FOLIO_LINE_TYPE.TRANSFER_OUT,
    code: 'XFER',
    description: `Balance transferred to folio ${to.number}`,
    unitAmountMinor: -amount,
    source: { kind: FOLIO_SOURCE.TRANSFER, refId: to._id },
    transferFolioId: to._id,
    reason,
    skipCreditLimit: true,
    taxOverride: { netMinor: -amount, taxMinor: 0, taxLines: [] },
  });
  await postLine({
    folioId: to._id,
    type: FOLIO_LINE_TYPE.TRANSFER_IN,
    code: 'XFER',
    description: `Balance from folio ${from.number} (${from.name})`,
    unitAmountMinor: amount,
    source: { kind: FOLIO_SOURCE.TRANSFER, refId: from._id },
    transferFolioId: from._id,
    reason,
    taxOverride: { netMinor: amount, taxMinor: 0, taxLines: [] },
  });
  return amount;
};

export const folioWithLines = async (folioId: TId) => {
  const folio = found(await Folio.findById(folioId).lean(), 'Folio');
  const lines = await FolioLine.find({ folioId }).sort({ createdAt: 1 }).lean();
  return { ...folio, lines };
};

const billToFor = async (folio: { name: string; guestId?: unknown; companyAccountId?: unknown }) => {
  if (folio.companyAccountId) {
    const company = await CompanyAccount.findById(folio.companyAccountId).lean();
    if (company) return { name: company.name, address: company.billingAddress, taxId: company.taxId, email: company.email };
  }
  if (folio.guestId) {
    const guest = await Guest.findById(folio.guestId).lean();
    if (guest) return { name: `${guest.firstName} ${guest.lastName}`, address: guest.address, email: guest.email };
  }
  return { name: folio.name };
};

// Closes a settled folio and issues its invoice with a gap-free number.
export const closeFolio = async (folioId: TId, billTo?: { name?: string; address?: string; taxId?: string }) => {
  const folio = found(await Folio.findById(folioId), 'Folio');
  if (folio.status === FOLIO_STATUS.CLOSED) return folio;
  if (folio.balanceMinor !== 0) {
    throw new AppError(httpStatus.CONFLICT, `Folio ${folio.number} has an outstanding balance of ${folio.balanceMinor}`);
  }
  const lines = await FolioLine.find({ folioId }).lean();
  const location = found(await Location.findById(folio.locationId).lean(), 'Location');

  // Invoice lists what the guest was charged: pairs cancelled by reversal/transfer are left out.
  const billable = lines.filter(
    (l) => l.type !== FOLIO_LINE_TYPE.PAYMENT && !l.reversedById && !l.reversalOfId && l.code !== 'XFER',
  );
  const payments = lines.filter((l) => l.type === FOLIO_LINE_TYPE.PAYMENT);
  const transfers = lines.filter((l) => l.code === 'XFER');
  const taxSummary = new Map<string, { name: string; rateBps: number; amountMinor: number }>();
  for (const l of billable) {
    for (const t of l.taxLines) {
      const key = `${t.name}:${t.rateBps}`;
      const row = taxSummary.get(key) || { name: t.name, rateBps: t.rateBps, amountMinor: 0 };
      row.amountMinor += t.amountMinor;
      taxSummary.set(key, row);
    }
  }
  const netMinor = billable.reduce((s, l) => s + l.netMinor, 0);
  const taxMinor = billable.reduce((s, l) => s + l.taxMinor, 0);
  const paidMinor = -payments.reduce((s, l) => s + l.amountMinor, 0) - transfers.reduce((s, l) => s + l.amountMinor, 0);
  const seq = await nextSequence(`invoice:${folio.locationId}`);
  const defaultBillTo = await billToFor(folio);

  const [invoice] = await FolioInvoice.create([
    {
      locationId: folio.locationId,
      folioId: folio._id,
      number: `${location.invoicePrefix || 'INV'}-${String(seq).padStart(6, '0')}`,
      billTo: { ...defaultBillTo, ...(billTo || {}), name: billTo?.name || defaultBillTo.name },
      lines: billable.map((l) => ({
        code: l.code,
        description: l.description,
        businessDate: l.businessDate,
        quantity: l.quantity,
        netMinor: l.netMinor,
        taxMinor: l.taxMinor,
        amountMinor: l.amountMinor,
      })),
      taxSummary: [...taxSummary.values()],
      netMinor,
      taxMinor,
      totalMinor: netMinor + taxMinor,
      paidMinor,
      balanceMinor: 0,
      currency: folio.currency,
      issuedBy: requestContext.get()?.userId,
    },
  ]);
  folio.status = FOLIO_STATUS.CLOSED;
  folio.closedAt = new Date();
  folio.invoiceId = invoice!._id;
  await folio.save();
  return folio;
};

export const chargeCodeExists = async (code: string) => Boolean(await ChargeCode.exists({ code: code.toUpperCase(), isActive: true }));

export const FolioLedger = {
  createFolio,
  postLine,
  reverseLine,
  transferLines,
  transferBalance,
  folioWithLines,
  closeFolio,
  nextFolioNumber,
  chargeCodeExists,
};
