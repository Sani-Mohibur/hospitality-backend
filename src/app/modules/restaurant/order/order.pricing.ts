import { calculateTax, percentOf, TAX_CATEGORY, TTaxLine, TTaxRuleLike } from '../../../utils/money';
import { IDiscount, IOrder, IOrderItem, ITEM_STATUS } from './order.interface';

const itemGross = (item: Pick<IOrderItem, 'quantity' | 'unitPriceMinor' | 'modifiers'>) =>
  item.quantity * (item.unitPriceMinor + item.modifiers.reduce((s, m) => s + m.priceMinor * (m.quantity || 1), 0));

const discountAmount = (discount: IDiscount | undefined, base: number) => {
  if (!discount || base <= 0) return 0;
  if (discount.type === 'COMP') return base;
  if (discount.type === 'PERCENT') return Math.min(base, percentOf(base, discount.value));
  return Math.min(base, Math.round(discount.value));
};

// Splits `total` across weights so the parts add up exactly (largest remainder).
export const allocate = (total: number, weights: number[]) => {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum || !total) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let rest = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (rest <= 0) break;
    parts[i]! += 1;
    rest -= 1;
  }
  return parts;
};

const mergeTaxLines = (target: Map<string, TTaxLine>, lines: TTaxLine[]) => {
  for (const line of lines) {
    const key = `${line.name}:${line.rateBps}`;
    const row = target.get(key) || { name: line.name, rateBps: line.rateBps, amountMinor: 0 };
    row.amountMinor += line.amountMinor;
    target.set(key, row);
  }
};

// Recomputes every item's amounts and the order totals. Payments are kept as they are.
export const priceOrder = (
  order: Pick<IOrder, 'items' | 'discounts' | 'totals'> & { taxLines?: TTaxLine[] },
  options: { rules: TTaxRuleLike[]; inclusive: boolean; serviceChargeBps: number },
) => {
  const active = order.items.filter((i) => i.status !== ITEM_STATUS.VOIDED);
  const gross = active.map(itemGross);
  const itemDiscounts = active.map((item, idx) => discountAmount(item.discount, gross[idx]!));
  const afterItem = gross.map((g, idx) => g - itemDiscounts[idx]!);
  const base = afterItem.reduce((a, b) => a + b, 0);

  let orderDiscount = 0;
  for (const d of order.discounts || []) orderDiscount += discountAmount(d, base - orderDiscount);
  orderDiscount = Math.min(orderDiscount, base);
  const allocated = allocate(orderDiscount, afterItem);
  const nets = afterItem.map((a, idx) => a - allocated[idx]!);

  const serviceTotal = percentOf(nets.reduce((a, b) => a + b, 0), options.serviceChargeBps);
  const services = allocate(serviceTotal, nets);

  const taxLines = new Map<string, TTaxLine>();
  let subtotal = 0;
  let discountSum = 0;
  let taxSum = 0;
  let total = 0;
  active.forEach((item, idx) => {
    const tax = calculateTax(nets[idx]!, item.taxCategory, options.rules, options.inclusive);
    const serviceTax = calculateTax(services[idx]!, TAX_CATEGORY.SERVICE, options.rules, false);
    mergeTaxLines(taxLines, tax.taxLines);
    mergeTaxLines(taxLines, serviceTax.taxLines);
    const itemTax = tax.taxMinor + serviceTax.taxMinor;
    const itemTotal = tax.grossMinor + serviceTax.grossMinor;
    item.calc = {
      grossMinor: gross[idx]!,
      discountMinor: itemDiscounts[idx]! + allocated[idx]!,
      netMinor: nets[idx]!,
      serviceMinor: services[idx]!,
      taxMinor: itemTax,
      totalMinor: itemTotal,
      taxLines: [...tax.taxLines, ...serviceTax.taxLines].map(({ name, rateBps, amountMinor }) => ({ name, rateBps, amountMinor })),
    };
    subtotal += gross[idx]!;
    discountSum += itemDiscounts[idx]! + allocated[idx]!;
    taxSum += itemTax;
    total += itemTotal;
  });
  for (const item of order.items) {
    if (item.status === ITEM_STATUS.VOIDED) item.calc = { grossMinor: 0, discountMinor: 0, netMinor: 0, serviceMinor: 0, taxMinor: 0, totalMinor: 0, taxLines: [] };
  }

  const paid = order.totals?.paidMinor || 0;
  order.totals = {
    subtotalMinor: subtotal,
    discountMinor: discountSum,
    serviceChargeMinor: serviceTotal,
    taxMinor: taxSum,
    totalMinor: total,
    tipMinor: order.totals?.tipMinor || 0,
    paidMinor: paid,
    refundedMinor: order.totals?.refundedMinor || 0,
    balanceMinor: total - paid,
  };
  order.taxLines = [...taxLines.values()];
  return order.totals;
};

// Amount a check owes before payments (split by item/seat, or a fixed even share).
export const checkTotal = (order: Pick<IOrder, 'items' | 'checks' | 'totals'>, checkNo: number) => {
  const fixed = order.checks?.find((c) => c.checkNo === checkNo && c.fixedAmountMinor !== undefined && c.fixedAmountMinor !== null);
  if (fixed) return fixed.fixedAmountMinor!;
  return order.items
    .filter((i) => i.status !== ITEM_STATUS.VOIDED && (i.checkNo || 1) === checkNo)
    .reduce((s, i) => s + (i.calc?.totalMinor || 0), 0);
};

export const OrderPricing = { priceOrder, checkTotal, allocate };
