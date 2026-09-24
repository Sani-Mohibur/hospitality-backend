// Hotel operations run on a "business date" (YYYY-MM-DD) per location that only
// advances when the night audit closes the day. These helpers work on that format.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isBusinessDate = (value: unknown): value is string =>
  typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const toUtc = (date: string) => new Date(`${date}T00:00:00Z`);

export const addDays = (date: string, days: number): string => {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const diffDays = (from: string, to: string): number =>
  Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86400000);

// Nights of a stay: arrival inclusive, departure exclusive.
export const nightsBetween = (arrival: string, departure: string): string[] => {
  const nights: string[] = [];
  for (let d = arrival; d < departure; d = addDays(d, 1)) nights.push(d);
  return nights;
};

// 0 = Sunday ... 6 = Saturday
export const dayOfWeek = (date: string): number => toUtc(date).getUTCDay();

// Calendar date "now" in a location's timezone.
export const localDate = (timeZone: string, at: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

// Local wall-clock minutes since midnight in a timezone.
export const localMinutes = (timeZone: string, at: Date = new Date()): number => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return hour * 60 + minute;
};

export const parseTimeOfDay = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const dateRange = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

// Offset (ms) of a timezone from UTC at a given instant.
const tzOffsetMs = (timeZone: string, at: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - at.getTime();
};

// The UTC instant of a local date and time in a timezone (e.g. arrival day at 14:00).
export const zonedDateTimeToUtc = (date: string, hhmm: string, timeZone: string): Date => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = new Date(Date.UTC(y!, (m || 1) - 1, d || 1, h || 0, mi || 0));
  const first = new Date(guess.getTime() - tzOffsetMs(timeZone, guess));
  // Second pass settles DST transitions.
  return new Date(guess.getTime() - tzOffsetMs(timeZone, first));
};
