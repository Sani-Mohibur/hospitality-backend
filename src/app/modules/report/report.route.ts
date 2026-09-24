import express, { Request, Response } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import httpStatus from 'http-status';
import { authorize, tenantUser } from '../../middlewares/auth';
import locationScope from '../../middlewares/locationScope';
import validateRequest from '../../middlewares/validateRequest';
import catchAsync from '../../utils/catchAsync';
import { ok } from '../../utils/sendResponse';
import AppError from '../../errors/AppError';
import { PERMISSION } from '../user/user.constant';
import { ReportService } from './report.service';
import { ReportSchedule } from './reportSchedule.service';
import { toCsv } from '../../utils/csv';
import { found } from '../../utils/query';
import { body, objectId } from '../../utils/zod';

const router = express.Router();

router.use(tenantUser(), authorize(PERMISSION.REPORTS_VIEW), locationScope({ required: false }));

// Reports cover the chosen location, or every location the user is granted.
const scopeOf = (req: Request) => {
  if (req.locationId) return { locationIds: [new Types.ObjectId(req.locationId)] };
  if (req.user.allLocations) return {};
  return { locationIds: req.user.locationIds.map((id) => new Types.ObjectId(id)) };
};

const range = (req: Request) => {
  const from = String(req.query.from || '');
  const to = String(req.query.to || from);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new AppError(httpStatus.BAD_REQUEST, 'Give from and to as YYYY-MM-DD');
  return { from, to };
};

// Sends JSON, or CSV when ?format=csv.
const respond = (req: Request, res: Response, name: string, rows: Record<string, unknown>[] | Record<string, unknown>) => {
  if (req.query.format === 'csv') {
    const list = Array.isArray(rows) ? rows : [rows];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return res.send(toCsv(list.map((r) => ({ ...r, _id: typeof r._id === 'object' ? JSON.stringify(r._id) : r._id }))));
  }
  return ok(res, name, rows);
};

router.get('/dashboard', catchAsync(async (req, res) => {
  const { from, to } = range(req);
  ok(res, 'Dashboard', await ReportService.dashboard(scopeOf(req), from, to));
}));

router.get('/sales', catchAsync(async (req, res) => {
  const { from, to } = range(req);
  const groupBy = (req.query.groupBy as any) || 'item';
  if (!['item', 'category', 'outlet', 'staff', 'hour', 'day'].includes(groupBy)) throw new AppError(httpStatus.BAD_REQUEST, 'Unknown groupBy');
  respond(req, res, `sales-by-${groupBy}`, await ReportService.sales(scopeOf(req), from, to, groupBy));
}));

router.get('/tax', catchAsync(async (req, res) => {
  const { from, to } = range(req);
  respond(req, res, 'tax', await ReportService.taxReport(scopeOf(req), from, to));
}));

router.get('/payments', catchAsync(async (req, res) => {
  const { from, to } = range(req);
  respond(req, res, 'payments', await ReportService.paymentsReport(scopeOf(req), new Date(`${from}T00:00:00Z`), new Date(`${to}T23:59:59Z`)));
}));

// Accounting export (journal by GL account) for Xero / QuickBooks import.
router.get('/accounting-journal', catchAsync(async (req, res) => {
  const { from, to } = range(req);
  const journal = await ReportService.accountingJournal(scopeOf(req), from, to);
  if (req.query.format === 'csv') return respond(req, res, `journal-${from}-${to}`, journal.lines);
  ok(res, 'Accounting journal', journal);
}));

router.get('/anomalies', catchAsync(async (req, res) => ok(res, 'Staff anomalies', await ReportService.anomalies(scopeOf(req), Number(req.query.days || 30)))));

// Original endpoints kept for compatibility (they now filter correctly)
router.get('/hospitality-stats', catchAsync(async (req, res) => ok(res, 'Hospitality stats retrieved successfully', await ReportService.getHospitalityStats(scopeOf(req)))));
router.get('/restaurant-stats', catchAsync(async (req, res) => ok(res, 'Restaurant stats retrieved successfully', await ReportService.getRestaurantStats(scopeOf(req)))));

// Scheduled email reports
router.get('/schedules', catchAsync(async (_req, res) => ok(res, 'Report schedules', await ReportSchedule.find().lean())));

router.post(
  '/schedules',
  authorize(PERMISSION.TENANT_SETTINGS),
  validateRequest(body({ locationId: objectId.optional(), recipients: z.array(z.string().email()).min(1), isActive: z.boolean().optional() })),
  catchAsync(async (req, res) => ok(res, 'Report schedule saved', await ReportSchedule.create({ ...req.body, type: 'DAILY_MANAGER' }), { statusCode: httpStatus.CREATED })),
);

router.delete(
  '/schedules/:id',
  authorize(PERMISSION.TENANT_SETTINGS),
  catchAsync(async (req, res) => {
    found(await ReportSchedule.findByIdAndDelete(req.params.id), 'Report schedule');
    ok(res, 'Report schedule removed', null);
  }),
);

export const ReportRoutes = router;
