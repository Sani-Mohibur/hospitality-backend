import httpStatus from 'http-status';
import { Types } from 'mongoose';
import AppError from '../../../errors/AppError';
import { MenuItem, ModifierGroup } from './menuItem.model';
import { MenuCategory, MenuSchedule } from '../menuCategory/menuCategory.model';
import { Outlet } from '../../outlet/outlet.model';
import { Location } from '../../location/location.model';
import { dayOfWeek, localDate, localMinutes, parseTimeOfDay } from '../../../utils/businessDate';
import { found } from '../../../utils/query';

type TId = Types.ObjectId | string;

const scopedToLocation = (locationId: TId) => ({
  $or: [{ locationId: new Types.ObjectId(String(locationId)) }, { locationId: null }, { locationId: { $exists: false } }],
});

const inWindow = (windows: { days: number[]; from: string; to: string }[], day: number, minutes: number) =>
  windows.some((w) => {
    const from = parseTimeOfDay(w.from);
    const to = parseTimeOfDay(w.to);
    if (from <= to) return w.days.includes(day) && minutes >= from && minutes < to;
    // Window past midnight (22:00-02:00): the late part belongs to the previous day
    return (w.days.includes(day) && minutes >= from) || (w.days.includes((day + 6) % 7) && minutes < to);
  });

// Effective price and availability of an item at a location (master menu overrides).
export const effectiveItem = (item: any, locationId: TId) => {
  const override = (item.locationOverrides || []).find((o: any) => String(o.locationId) === String(locationId));
  const priceMinor = override?.priceMinor ?? item.priceMinor;
  const available = item.isActive && !item.isSoldOut && override?.isAvailable !== false && (item.availableQty === undefined || item.availableQty === null || item.availableQty > 0);
  return { priceMinor, available };
};

// What an outlet can sell right now: schedules, outlet restrictions, overrides and 86'd items applied.
const outletMenu = async (outletId: TId, at = new Date()) => {
  const outlet = found(await Outlet.findById(outletId).lean(), 'Outlet');
  const location = found(await Location.findById(outlet.locationId).lean(), 'Location');
  const day = dayOfWeek(localDate(location.timezone, at));
  const minutes = localMinutes(location.timezone, at);

  const schedules = await MenuSchedule.find({ locationId: location._id, isActive: true, $or: [{ outletIds: outlet._id }, { outletIds: { $size: 0 } }] }).lean();
  const activeSchedules = schedules.filter((s) => inWindow(s.windows, day, minutes));
  const scheduledCategoryIds = schedules.length ? new Set(activeSchedules.flatMap((s) => s.categoryIds.map(String))) : undefined;

  const categories = (await MenuCategory.find({ ...scopedToLocation(location._id), isActive: true }).sort({ sortOrder: 1, name: 1 }).lean()).filter(
    (c) => (!c.outletIds?.length || c.outletIds.map(String).includes(String(outlet._id))) && (!scheduledCategoryIds || scheduledCategoryIds.has(String(c._id))),
  );
  const items = await MenuItem.find({ ...scopedToLocation(location._id), categoryId: { $in: categories.map((c) => c._id) }, isActive: true })
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  const groupIds = [...new Set(items.flatMap((i) => i.modifierGroupIds.map(String)))];
  const groups = await ModifierGroup.find({ _id: { $in: groupIds }, isActive: true }).lean();
  const groupById = new Map(groups.map((g) => [String(g._id), g]));

  return {
    outlet: { _id: outlet._id, name: outlet.name, type: outlet.type },
    activeMenus: activeSchedules.map((s) => s.name),
    categories: categories.map((c) => ({
      _id: c._id,
      name: c.name,
      items: items
        .filter((i) => String(i.categoryId) === String(c._id) && (!i.outletIds?.length || i.outletIds.map(String).includes(String(outlet._id))))
        .map((i) => {
          const eff = effectiveItem(i, location._id);
          return {
            _id: i._id,
            name: i.name,
            description: i.description,
            imageUrl: i.imageUrl,
            priceMinor: eff.priceMinor,
            available: eff.available,
            availableQty: i.availableQty,
            allergens: i.allergens,
            defaultCourse: i.defaultCourse,
            modifierGroups: i.modifierGroupIds.map((id) => groupById.get(String(id))).filter(Boolean),
          };
        }),
    })),
  };
};

export type TModifierPick = { groupId: string; optionId: string; quantity?: number };

// Validates modifier choices against the item's groups and prices them.
export const priceModifiers = async (item: { name: string; modifierGroupIds: Types.ObjectId[] }, picks: TModifierPick[] = []) => {
  const groups = await ModifierGroup.find({ _id: { $in: item.modifierGroupIds }, isActive: true }).lean();
  const out: { groupId: Types.ObjectId; groupName: string; optionId: Types.ObjectId; name: string; priceMinor: number; quantity: number }[] = [];
  for (const group of groups) {
    const chosen = picks.filter((p) => p.groupId === String(group._id));
    const count = chosen.reduce((s, p) => s + (p.quantity || 1), 0);
    if (count < group.minSelect) throw new AppError(httpStatus.BAD_REQUEST, `${item.name}: choose at least ${group.minSelect} from "${group.name}"`);
    if (count > group.maxSelect) throw new AppError(httpStatus.BAD_REQUEST, `${item.name}: at most ${group.maxSelect} from "${group.name}"`);
    for (const pick of chosen) {
      const option = group.options.find((o) => String(o._id) === pick.optionId);
      if (!option || !option.isAvailable) throw new AppError(httpStatus.BAD_REQUEST, `${item.name}: option not available in "${group.name}"`);
      if ((pick.quantity || 1) > group.maxPerOption) throw new AppError(httpStatus.BAD_REQUEST, `${item.name}: ${option.name} at most ${group.maxPerOption}x`);
      out.push({ groupId: group._id as Types.ObjectId, groupName: group.name, optionId: option._id as Types.ObjectId, name: option.name, priceMinor: option.priceMinor, quantity: pick.quantity || 1 });
    }
  }
  const unknown = picks.filter((p) => !groups.some((g) => String(g._id) === p.groupId));
  if (unknown.length) throw new AppError(httpStatus.BAD_REQUEST, `${item.name}: modifier group not offered for this item`);
  return out;
};

// Limited-quantity specials count down; reaching zero marks the item sold out.
export const consumeAvailability = async (menuItemId: TId, quantity: number) => {
  const item = await MenuItem.findOneAndUpdate(
    { _id: menuItemId, availableQty: { $gte: quantity } },
    { $inc: { availableQty: -quantity } },
    { returnDocument: 'after' },
  );
  if (!item) {
    const exists = await MenuItem.findOne({ _id: menuItemId, availableQty: { $ne: null } }).lean();
    if (exists) throw new AppError(httpStatus.CONFLICT, `Only ${exists.availableQty} ${exists.name} left`);
    return;
  }
  if (item.availableQty === 0) {
    item.isSoldOut = true;
    await item.save();
  }
};

export const MenuServices = { outletMenu, priceModifiers, effectiveItem, consumeAvailability };
