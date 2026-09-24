import express from 'express';
import { z } from 'zod';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../../middlewares/auth';
import locationScope, { locationFilter, requireLocationId } from '../../../middlewares/locationScope';
import validateRequest from '../../../middlewares/validateRequest';
import idempotency from '../../../middlewares/idempotency';
import catchAsync from '../../../utils/catchAsync';
import { ok } from '../../../utils/sendResponse';
import AppError from '../../../errors/AppError';
import { PERMISSION } from '../../user/user.constant';
import { Folio, FolioInvoice, FolioLine } from './folio.model';
import { FolioLedger } from './folio.ledger';
import { FOLIO_LINE_TYPE, FOLIO_SOURCE, FOLIO_TYPE } from './folio.interface';
import { Tenant } from '../../tenant/tenant.model';
import { ApprovalService } from '../../approval/approval.service';
import { PaymentService } from '../../payment/payment.service';
import { takePaymentBody } from '../../payment/payment.route';
import { activity } from '../../auditLog/auditLog.service';
import { runInTransaction } from '../../../utils/transaction';
import { requestContext } from '../../../utils/requestContext';
import { found, metaOf, paginationOf } from '../../../utils/query';
import { body, minor, objectId, positiveMinor } from '../../../utils/zod';

const router = express.Router();
const P = PERMISSION;

const approvalThreshold = async () => {
  const tenantId = requestContext.get()?.tenantId;
  const tenant = await requestContext.asSystem(() => Tenant.findById(tenantId).select('settings.approval').lean());
  return tenant?.settings?.approval?.folioAdjustOverMinor ?? 0;
};

router.use(tenantUser());

router.get(
  '/',
  authorize(P.FOLIO_VIEW),
  locationScope({ required: false }),
  catchAsync(async (req, res) => {
    const { page, limit, skip } = paginationOf(req.query, 50);
    const filter: Record<string, unknown> = { ...locationFilter(req) };
    for (const key of ['status', 'type', 'reservationId', 'roomStayId', 'guestId', 'companyAccountId']) {
      if (req.query[key]) filter[key] = req.query[key];
    }
    if (req.query.withBalance === 'true') filter.balanceMinor = { $ne: 0 };
    const [data, total] = await Promise.all([
      Folio.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Folio.countDocuments(filter),
    ]);
    ok(res, 'Folios retrieved successfully', data, { meta: metaOf(page, limit, total) });
  }),
);

router.get(
  '/invoices',
  authorize(P.FOLIO_VIEW),
  locationScope({ required: false }),
  catchAsync(async (req, res) => {
    const { page, limit, skip } = paginationOf(req.query, 50);
    const filter = { ...locationFilter(req) };
    const [data, total] = await Promise.all([
      FolioInvoice.find(filter).sort({ issuedAt: -1 }).skip(skip).limit(limit).lean(),
      FolioInvoice.countDocuments(filter),
    ]);
    ok(res, 'Invoices', data, { meta: metaOf(page, limit, total) });
  }),
);

router.get(
  '/invoices/:id',
  authorize(P.FOLIO_VIEW),
  catchAsync(async (req, res) => ok(res, 'Invoice', found(await FolioInvoice.findById(req.params.id).lean(), 'Invoice'))),
);

router.get(
  '/:id',
  authorize(P.FOLIO_VIEW),
  catchAsync(async (req, res) => ok(res, 'Folio retrieved successfully', await FolioLedger.folioWithLines(req.params.id as string))),
);

// Additional bill: split window on a stay, house account, or outside guest account.
router.post(
  '/',
  authorize(P.FOLIO_POST),
  locationScope(),
  validateRequest(
    body({
      name: z.string().min(1),
      type: z.enum(Object.values(FOLIO_TYPE) as [string, ...string[]]).optional(),
      roomStayId: objectId.optional(),
      reservationId: objectId.optional(),
      guestId: objectId.optional(),
      companyAccountId: objectId.optional(),
      creditLimitMinor: positiveMinor.optional(),
    }),
  ),
  catchAsync(async (req, res) => {
    let window = 1;
    if (req.body.roomStayId) window = (await Folio.countDocuments({ roomStayId: req.body.roomStayId })) + 1;
    const folio = await runInTransaction(() => FolioLedger.createFolio({ ...req.body, locationId: requireLocationId(req), window }));
    ok(res, 'Folio created successfully', folio, { statusCode: httpStatus.CREATED });
  }),
);

router.patch(
  '/:id',
  authorize(P.FOLIO_POST),
  validateRequest(body({ name: z.string().optional(), noPost: z.boolean().optional(), creditLimitMinor: positiveMinor.nullable().optional() })),
  catchAsync(async (req, res) => {
    const folio = found(await Folio.findById(req.params.id), 'Folio');
    const before = folio.toObject();
    if (req.body.name) folio.name = req.body.name;
    if (req.body.noPost !== undefined) folio.noPost = req.body.noPost;
    if (req.body.creditLimitMinor !== undefined) folio.creditLimitMinor = req.body.creditLimitMinor ?? undefined;
    await folio.save();
    await activity.record({ action: 'FOLIO_UPDATED', entity: 'Folio', entityId: folio._id, message: `Updated folio ${folio.number}`, before, after: folio.toObject() });
    ok(res, 'Folio updated', folio);
  }),
);

// Manual charge (minibar, laundry, spa...) by charge code.
router.post(
  '/:id/charges',
  authorize(P.FOLIO_POST),
  idempotency({ required: false }),
  validateRequest(
    body({
      code: z.string().min(2),
      description: z.string().optional(),
      quantity: z.number().int().min(1).optional(),
      unitAmountMinor: positiveMinor,
    }),
  ),
  catchAsync(async (req, res) => {
    const line = await runInTransaction(async () => {
      const posted = await FolioLedger.postLine({
        folioId: req.params.id as string,
        type: FOLIO_LINE_TYPE.CHARGE,
        code: req.body.code,
        description: req.body.description,
        quantity: req.body.quantity,
        unitAmountMinor: req.body.unitAmountMinor,
        source: { kind: FOLIO_SOURCE.MANUAL },
      });
      await activity.record({ action: 'FOLIO_CHARGE', entity: 'Folio', entityId: posted.folioId, message: `Posted ${posted.code} ${posted.amountMinor}: ${posted.description}` });
      return posted;
    });
    ok(res, 'Charge posted', line, { statusCode: httpStatus.CREATED });
  }),
);

// Allowance / discount on the bill (negative adjustment against a charge code).
router.post(
  '/:id/adjustments',
  authorize(P.FOLIO_ADJUST),
  validateRequest(body({ code: z.string().min(2), amountMinor: minor.max(-1), reason: z.string().min(2) })),
  catchAsync(async (req, res) => {
    const needsApproval = Math.abs(req.body.amountMinor) > (await approvalThreshold());
    const approvedBy = await ApprovalService.requireApproval(req, 'FOLIO_ADJUST', needsApproval);
    const line = await runInTransaction(async () => {
      const posted = await FolioLedger.postLine({
        folioId: req.params.id as string,
        type: FOLIO_LINE_TYPE.ADJUSTMENT,
        code: req.body.code,
        description: `Allowance: ${req.body.reason}`,
        unitAmountMinor: req.body.amountMinor,
        source: { kind: FOLIO_SOURCE.MANUAL },
        reason: req.body.reason,
        approvedBy,
        skipCreditLimit: true,
      });
      await activity.record({ action: 'FOLIO_ADJUSTMENT', entity: 'Folio', entityId: posted.folioId, approvedBy, message: `Allowance ${posted.amountMinor}: ${req.body.reason}` });
      return posted;
    });
    ok(res, 'Adjustment posted', line, { statusCode: httpStatus.CREATED });
  }),
);

// Void a line by posting its exact reversal; the original stays visible.
router.post(
  '/lines/:lineId/void',
  authorize(P.FOLIO_ADJUST),
  validateRequest(body({ reason: z.string().min(2) })),
  catchAsync(async (req, res) => {
    const line = found(await FolioLine.findById(req.params.lineId).lean(), 'Folio line');
    if (line.type === FOLIO_LINE_TYPE.PAYMENT) throw new AppError(httpStatus.BAD_REQUEST, 'Refund payments through the payment instead');
    const approvedBy = await ApprovalService.requireApproval(req, 'FOLIO_ADJUST', Math.abs(line.amountMinor) > (await approvalThreshold()));
    const reversal = await runInTransaction(async () => {
      const posted = await FolioLedger.reverseLine(line._id, req.body.reason, approvedBy);
      await activity.record({ action: 'FOLIO_VOID', entity: 'Folio', entityId: line.folioId, approvedBy, message: `Voided ${line.code} ${line.amountMinor}: ${req.body.reason}` });
      return posted;
    });
    ok(res, 'Line voided', reversal);
  }),
);

router.post(
  '/:id/payments',
  authorize(P.FOLIO_PAYMENT),
  locationScope(),
  idempotency(),
  validateRequest(body({ ...takePaymentBody, target: z.undefined().optional() })),
  catchAsync(async (req, res) => {
    const { target: _ignored, ...payload } = req.body;
    ok(res, 'Payment recorded', await PaymentService.payFolio(req, req.params.id as string, payload), { statusCode: httpStatus.CREATED });
  }),
);

router.post(
  '/:id/transfer-lines',
  authorize(P.FOLIO_ADJUST, P.FOLIO_POST),
  validateRequest(body({ lineIds: z.array(objectId).min(1), toFolioId: objectId, reason: z.string().optional() })),
  catchAsync(async (req, res) => {
    const moved = await runInTransaction(async () => {
      const lines = await FolioLine.find({ _id: { $in: req.body.lineIds }, folioId: req.params.id }).select('_id').lean();
      if (lines.length !== req.body.lineIds.length) throw new AppError(httpStatus.BAD_REQUEST, 'Some lines are not on this folio');
      const result = await FolioLedger.transferLines(req.body.lineIds, req.body.toFolioId, req.body.reason);
      await activity.record({ action: 'FOLIO_TRANSFER', entity: 'Folio', entityId: req.params.id as string, message: `Moved ${result.length} line(s) to another folio` });
      return result;
    });
    ok(res, 'Lines moved', moved);
  }),
);

router.post(
  '/:id/transfer-balance',
  authorize(P.FOLIO_ADJUST),
  validateRequest(body({ toFolioId: objectId, reason: z.string().min(2) })),
  catchAsync(async (req, res) => {
    const amount = await runInTransaction(() => FolioLedger.transferBalance(req.params.id as string, req.body.toFolioId, req.body.reason));
    ok(res, 'Balance transferred', { amountMinor: amount || 0 });
  }),
);

router.post(
  '/:id/close',
  authorize(P.FOLIO_PAYMENT, P.FRONT_DESK),
  validateRequest(body({ billTo: z.object({ name: z.string().optional(), address: z.string().optional(), taxId: z.string().optional() }).optional() })),
  catchAsync(async (req, res) => {
    const folio = await runInTransaction(() => FolioLedger.closeFolio(req.params.id as string, req.body.billTo));
    ok(res, 'Folio closed and invoice issued', { folio, invoice: await FolioInvoice.findById(folio.invoiceId).lean() });
  }),
);

export const FolioRoutes = router;
