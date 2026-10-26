export const USER_ROLE = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  TENANT_OWNER: 'TENANT_OWNER',
  TENANT_MANAGER: 'TENANT_MANAGER',
  STAFF: 'STAFF',
} as const;

export const FEATURE_MODULES = {
  RESTAURANT: 'RESTAURANT',
  HOSPITALITY: 'HOSPITALITY',
  RETAIL: 'RETAIL',
  INVENTORY: 'INVENTORY',
  DISTRIBUTION: 'DISTRIBUTION',
  AI_ASSISTANT: 'AI_ASSISTANT',
} as const;

// Fine-grained permissions. TENANT_OWNER has all of them, TENANT_MANAGER all except
// billing, STAFF gets the permissions of their assigned Role (system or custom).
export const PERMISSION = {
  TENANT_SETTINGS: 'tenant.settings',
  BILLING_MANAGE: 'billing.manage',
  STAFF_MANAGE: 'staff.manage',
  ROLES_MANAGE: 'roles.manage',
  LOCATIONS_MANAGE: 'locations.manage',
  DEVICES_MANAGE: 'devices.manage',
  INTEGRATIONS_MANAGE: 'integrations.manage',
  REPORTS_VIEW: 'reports.view',
  AUDIT_VIEW: 'audit.view',
  ALERTS_VIEW: 'alerts.view',
  ALERTS_MANAGE: 'alerts.manage',
  APPROVALS_GRANT: 'approvals.grant',

  GUESTS_VIEW: 'guests.view',
  GUESTS_MANAGE: 'guests.manage',
  GUESTS_PII: 'guests.pii',
  GUESTS_MERGE: 'guests.merge',
  COMPANY_ACCOUNTS_MANAGE: 'companies.manage',

  ROOMS_CONFIG: 'rooms.config',
  RATES_MANAGE: 'rates.manage',
  RESERVATIONS_VIEW: 'reservations.view',
  RESERVATIONS_MANAGE: 'reservations.manage',
  FRONT_DESK: 'frontdesk.checkin',
  FOLIO_VIEW: 'folio.view',
  FOLIO_POST: 'folio.post',
  FOLIO_ADJUST: 'folio.adjust',
  FOLIO_PAYMENT: 'folio.payment',
  NIGHT_AUDIT_RUN: 'nightaudit.run',
  HOUSEKEEPING_VIEW: 'housekeeping.view',
  HOUSEKEEPING_UPDATE: 'housekeeping.update',
  HOUSEKEEPING_MANAGE: 'housekeeping.manage',

  MENU_MANAGE: 'pos.menu.manage',
  TABLES_MANAGE: 'pos.tables.manage',
  POS_ORDER: 'pos.order',
  POS_PAY: 'pos.pay',
  POS_DISCOUNT: 'pos.discount',
  POS_VOID: 'pos.void',
  POS_REFUND: 'pos.refund',
  TABLE_BOOKINGS: 'pos.bookings',
  KDS_VIEW: 'kds.view',
  KDS_UPDATE: 'kds.update',
  SHIFT_OWN: 'shift.own',
  CASH_MANAGE: 'cash.manage',

  RETAIL_CATALOGUE_VIEW: 'retail.catalogue.view',
  RETAIL_CATALOGUE_MANAGE: 'retail.catalogue.manage',
  RETAIL_ORDERS_VIEW: 'retail.orders.view',
  RETAIL_ORDERS_MANAGE: 'retail.orders.manage',

  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_MANAGE: 'inventory.manage',
  INVENTORY_RECEIVE: 'inventory.receive',
  LOYALTY_MANAGE: 'loyalty.manage',
} as const;

export type TPermission = (typeof PERMISSION)[keyof typeof PERMISSION];

export const ALL_PERMISSIONS = Object.values(PERMISSION) as TPermission[];

export const MANAGER_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p !== PERMISSION.BILLING_MANAGE);

const P = PERMISSION;

// Seeded as system roles for every new tenant; tenants can clone and edit them.
export const SYSTEM_ROLE_TEMPLATES: { key: string; name: string; permissions: TPermission[] }[] = [
  {
    key: 'FRONT_DESK',
    name: 'Front desk',
    permissions: [
      P.GUESTS_VIEW, P.GUESTS_MANAGE, P.GUESTS_PII, P.RESERVATIONS_VIEW, P.RESERVATIONS_MANAGE,
      P.FRONT_DESK, P.FOLIO_VIEW, P.FOLIO_POST, P.FOLIO_PAYMENT, P.HOUSEKEEPING_VIEW, P.SHIFT_OWN, P.ALERTS_VIEW,
    ],
  },
  {
    key: 'RESERVATIONS',
    name: 'Reservations agent',
    permissions: [P.GUESTS_VIEW, P.GUESTS_MANAGE, P.RESERVATIONS_VIEW, P.RESERVATIONS_MANAGE, P.FOLIO_VIEW],
  },
  {
    key: 'HOUSEKEEPER',
    name: 'Housekeeper',
    permissions: [P.HOUSEKEEPING_VIEW, P.HOUSEKEEPING_UPDATE],
  },
  {
    key: 'HOUSEKEEPING_SUPERVISOR',
    name: 'Housekeeping supervisor',
    permissions: [P.HOUSEKEEPING_VIEW, P.HOUSEKEEPING_UPDATE, P.HOUSEKEEPING_MANAGE, P.ALERTS_VIEW, P.INVENTORY_VIEW],
  },
  {
    key: 'WAITER',
    name: 'Waiter',
    permissions: [P.POS_ORDER, P.POS_PAY, P.GUESTS_VIEW, P.KDS_VIEW, P.SHIFT_OWN, P.TABLE_BOOKINGS],
  },
  {
    key: 'CASHIER',
    name: 'Cashier / bartender',
    permissions: [P.POS_ORDER, P.POS_PAY, P.GUESTS_VIEW, P.KDS_VIEW, P.SHIFT_OWN],
  },
  {
    key: 'COOK',
    name: 'Cook',
    permissions: [P.KDS_VIEW, P.KDS_UPDATE, P.INVENTORY_VIEW],
  },
  {
    key: 'OUTLET_MANAGER',
    name: 'Outlet manager',
    permissions: [
      P.POS_ORDER, P.POS_PAY, P.POS_DISCOUNT, P.POS_VOID, P.POS_REFUND, P.MENU_MANAGE, P.TABLES_MANAGE,
      P.TABLE_BOOKINGS, P.KDS_VIEW, P.KDS_UPDATE, P.SHIFT_OWN, P.CASH_MANAGE, P.APPROVALS_GRANT, P.GUESTS_VIEW,
      P.INVENTORY_VIEW, P.INVENTORY_MANAGE, P.INVENTORY_RECEIVE, P.REPORTS_VIEW, P.ALERTS_VIEW, P.ALERTS_MANAGE,
    ],
  },
  {
    key: 'RETAIL_MANAGER',
    name: 'Retail manager',
    permissions: [
      P.RETAIL_CATALOGUE_VIEW, P.RETAIL_CATALOGUE_MANAGE, P.RETAIL_ORDERS_VIEW, P.RETAIL_ORDERS_MANAGE,
      P.INVENTORY_VIEW, P.INVENTORY_MANAGE, P.INVENTORY_RECEIVE, P.REPORTS_VIEW, P.ALERTS_VIEW, P.ALERTS_MANAGE,
      P.SHIFT_OWN, P.CASH_MANAGE, P.APPROVALS_GRANT, P.GUESTS_VIEW,
    ],
  },
  {
    key: 'RETAIL_CASHIER',
    name: 'Retail sales associate',
    permissions: [
      P.RETAIL_CATALOGUE_VIEW, P.RETAIL_ORDERS_VIEW, P.RETAIL_ORDERS_MANAGE, P.SHIFT_OWN, P.GUESTS_VIEW,
    ],
  },
  {
    key: 'ACCOUNTANT',
    name: 'Accountant',
    permissions: [P.REPORTS_VIEW, P.FOLIO_VIEW, P.AUDIT_VIEW, P.COMPANY_ACCOUNTS_MANAGE],
  },
];
