import { Schema, Types, model } from 'mongoose';
import { Location } from '../location/location.model';
import { sendEmail } from '../../utils/sendEmail';
import logger from '../../utils/logger';

// Who receives the daily manager report, per location.
export interface IReportSchedule {
  tenantId: Types.ObjectId;
  locationId?: Types.ObjectId;
  type: 'DAILY_MANAGER';
  recipients: string[];
  isActive: boolean;
}

const reportScheduleSchema = new Schema<IReportSchedule>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location' },
    type: { type: String, enum: ['DAILY_MANAGER'], default: 'DAILY_MANAGER' },
    recipients: [{ type: String, lowercase: true }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const ReportSchedule = model<IReportSchedule>('ReportSchedule', reportScheduleSchema);

const money = (minor: number) => (minor / 100).toFixed(2);

const renderDaily = (locationName: string, report: any) => {
  const r = report.rooms || {};
  const fnb = (report.fnbByOutlet || []).map((o: any) => `<tr><td>Outlet</td><td>${o.orders} orders, ${o.covers} covers, net ${money(o.net)}</td></tr>`).join('');
  const pays = (report.paymentsByMethod || []).map((p: any) => `<tr><td>${p._id}</td><td>${money(p.amount)} (${p.count})</td></tr>`).join('');
  return `
    <h2>${locationName} — daily report ${report.businessDate}</h2>
    <table cellpadding="4" style="border-collapse:collapse">
      <tr><td>Occupancy</td><td>${r.occupancyPct}% (${r.sold}/${r.available} rooms)</td></tr>
      <tr><td>ADR</td><td>${money(r.adrMinor || 0)}</td></tr>
      <tr><td>RevPAR</td><td>${money(r.revparMinor || 0)}</td></tr>
      <tr><td>TRevPAR</td><td>${money(r.trevparMinor || 0)}</td></tr>
      <tr><td>Arrivals / departures / no-shows</td><td>${r.arrivals} / ${r.departures} / ${r.noShows}</td></tr>
      <tr><td>Room revenue</td><td>${money(report.roomRevenueMinor || 0)}</td></tr>
      <tr><td>Total revenue (net)</td><td>${money(report.totalRevenueMinor || 0)}</td></tr>
      ${fnb}
      ${pays}
    </table>`;
};

// Called by the night audit once a business date closes.
const sendDailyReport = async (locationId: Types.ObjectId | string, report: Record<string, unknown>) => {
  const schedules = await ReportSchedule.find({ type: 'DAILY_MANAGER', isActive: true, $or: [{ locationId }, { locationId: null }] }).lean();
  if (!schedules.length) return 0;
  const location = await Location.findById(locationId).select('name').lean();
  const recipients = [...new Set(schedules.flatMap((s) => s.recipients))];
  const html = renderDaily(location?.name || 'Location', report);
  for (const to of recipients) {
    await sendEmail(to, html, `Daily report ${location?.name || ''} ${report.businessDate}`).catch((err) => logger.warn(err, `Daily report to ${to} failed`));
  }
  return recipients.length;
};

export const ReportScheduleService = { sendDailyReport };
