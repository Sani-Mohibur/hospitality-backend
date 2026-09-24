// All money is stored and exchanged as integer minor units (e.g. cents) plus an
// ISO currency code on the tenant/location. Rates are basis points (1% = 100 bps).

export const TAX_CATEGORY = {
  ROOM: 'ROOM',
  FOOD: 'FOOD',
  BEVERAGE: 'BEVERAGE',
  ALCOHOL: 'ALCOHOL',
  SERVICE: 'SERVICE',
  MINIBAR: 'MINIBAR',
  LAUNDRY: 'LAUNDRY',
  SPA: 'SPA',
  OTHER: 'OTHER',
  NONE: 'NONE',
} as const;

export type TTaxCategory = keyof typeof TAX_CATEGORY;

export type TTaxRuleLike = {
  _id?: unknown;
  name: string;
  rateBps: number;
  categories: string[];
};

export type TTaxLine = { name: string; rateBps: number; amountMinor: number; taxRuleId?: unknown };

export type TTaxResult = {
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  taxLines: TTaxLine[];
};

export const assertMinor = (value: number, field = 'amount') => {
  if (!Number.isInteger(value)) {
    throw new Error(`${field} must be an integer amount in minor units`);
  }
  return value;
};

export const percentOf = (amountMinor: number, bps: number) => Math.round((amountMinor * bps) / 10000);

// Computes tax for one amount. When `inclusive` the amount already contains tax.
export const calculateTax = (
  amountMinor: number,
  category: string,
  rules: TTaxRuleLike[],
  inclusive: boolean,
): TTaxResult => {
  const applicable = rules.filter((r) => r.categories.includes(category) && r.rateBps > 0);
  const totalBps = applicable.reduce((sum, r) => sum + r.rateBps, 0);

  if (!applicable.length || category === TAX_CATEGORY.NONE) {
    return { netMinor: amountMinor, taxMinor: 0, grossMinor: amountMinor, taxLines: [] };
  }

  if (inclusive) {
    const netMinor = Math.round((amountMinor * 10000) / (10000 + totalBps));
    const taxMinor = amountMinor - netMinor;
    // Allocate tax across rules proportionally; last rule absorbs rounding.
    let allocated = 0;
    const taxLines = applicable.map((r, i) => {
      const share =
        i === applicable.length - 1 ? taxMinor - allocated : Math.round((taxMinor * r.rateBps) / totalBps);
      allocated += share;
      return { name: r.name, rateBps: r.rateBps, amountMinor: share, taxRuleId: r._id };
    });
    return { netMinor, taxMinor, grossMinor: amountMinor, taxLines };
  }

  const taxLines = applicable.map((r) => ({
    name: r.name,
    rateBps: r.rateBps,
    amountMinor: percentOf(amountMinor, r.rateBps),
    taxRuleId: r._id,
  }));
  const taxMinor = taxLines.reduce((sum, l) => sum + l.amountMinor, 0);
  return { netMinor: amountMinor, taxMinor, grossMinor: amountMinor + taxMinor, taxLines };
};

// Splits a total into n parts that add up exactly (first parts take the remainder).
export const splitEvenly = (totalMinor: number, parts: number): number[] => {
  const base = Math.floor(totalMinor / parts);
  const remainder = totalMinor - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
};

export const sumMinor = <T>(items: T[], pick: (item: T) => number) =>
  items.reduce((sum, item) => sum + (pick(item) || 0), 0);
