import { Router } from 'express';
import auditLogger from '../middlewares/auditLogger';
import { AuthRoutes } from '../modules/auth/auth.route';
import { UserRoutes } from '../modules/user/user.route';
import { RoleRoutes } from '../modules/role/role.route';
import { DeviceRoutes } from '../modules/device/device.route';
import { TenantRoutes } from '../modules/tenant/tenant.route';
import { LocationRoutes } from '../modules/location/location.route';
import { OutletRoutes } from '../modules/outlet/outlet.route';
import { FinanceRoutes } from '../modules/finance/finance.route';
import { RoomCategoryRoutes } from '../modules/hospitality/roomCategory/roomCategory.route';
import { RoomRoutes } from '../modules/hospitality/room/room.route';
import { RateRoutes } from '../modules/hospitality/rate/rate.route';
import { GuestRoutes } from '../modules/hospitality/guest/guest.route';
import { CompanyAccountRoutes } from '../modules/hospitality/companyAccount/companyAccount.route';
import { ReservationRoutes } from '../modules/hospitality/reservation/reservation.route';
import { FolioRoutes } from '../modules/hospitality/folio/folio.route';
import { HousekeepingRoutes } from '../modules/hospitality/housekeeping/housekeeping.route';
import { NightAuditRoutes } from '../modules/hospitality/nightAudit/nightAudit.route';
import { MenuCategoryRoutes } from '../modules/restaurant/menuCategory/menuCategory.route';
import { MenuItemRoutes } from '../modules/restaurant/menuItem/menuItem.route';
import { TableRoutes } from '../modules/restaurant/table/table.route';
import { OrderRoutes } from '../modules/restaurant/order/order.route';
import { ShiftRoutes } from '../modules/shift/shift.route';
import { RetailCategoryRoutes } from '../modules/retail/retailCategory/retailCategory.route';
import { RetailProductRoutes } from '../modules/retail/retailProduct/retailProduct.route';
import { ApprovalRoutes } from '../modules/approval/approval.route';
import { PaymentRoutes } from '../modules/payment/payment.route';
import { InventoryRoutes } from '../modules/inventory/inventory.route';
import { LoyaltyRoutes } from '../modules/loyalty/loyalty.route';
import { AlertRoutes } from '../modules/alert/alert.route';
import { NotificationRoutes } from '../modules/notification/notification.route';
import { ReportRoutes } from '../modules/report/report.route';
import { AuditLogRoutes } from '../modules/auditLog/auditLog.route';
import { PlatformModuleRoutes } from '../modules/platformModule/platformModule.route';
import { SubscriptionRoutes } from '../modules/subscription/subscription.route';
import { SuperAdminRoutes } from '../modules/superAdmin/superAdmin.route';
import { PublicRoutes } from '../modules/public/public.route';
import { IntegrationRoutes } from '../modules/integration/integration.route';
import { SyncRoutes } from '../modules/sync/sync.route';
import { OnboardingRoutes } from '../modules/onboarding/onboarding.route';
import { AiRoutes } from '../modules/ai/ai.route';

const router = Router();

// Every successful write is recorded (with secrets redacted).
router.use(auditLogger());

const moduleRoutes = [
  { path: '/auth', route: AuthRoutes },
  { path: '/user', route: UserRoutes },
  { path: '/role', route: RoleRoutes },
  { path: '/device', route: DeviceRoutes },
  { path: '/tenant', route: TenantRoutes },
  { path: '/location', route: LocationRoutes },
  { path: '/outlet', route: OutletRoutes },
  { path: '/finance', route: FinanceRoutes },

  // Hotel
  { path: '/room-category', route: RoomCategoryRoutes },
  { path: '/room-type', route: RoomCategoryRoutes },
  { path: '/room', route: RoomRoutes },
  { path: '/rate', route: RateRoutes },
  { path: '/guest', route: GuestRoutes },
  { path: '/company-account', route: CompanyAccountRoutes },
  { path: '/reservation', route: ReservationRoutes },
  { path: '/folio', route: FolioRoutes },
  { path: '/housekeeping', route: HousekeepingRoutes },
  { path: '/night-audit', route: NightAuditRoutes },

  // Restaurant / outlets
  { path: '/restaurant/menu-category', route: MenuCategoryRoutes },
  { path: '/restaurant/menu-item', route: MenuItemRoutes },
  { path: '/restaurant/table', route: TableRoutes },
  { path: '/restaurant/order', route: OrderRoutes },
  { path: '/shift', route: ShiftRoutes },

  // Retail
  { path: '/retail/category', route: RetailCategoryRoutes },
  { path: '/retail/product', route: RetailProductRoutes },

  // Shared
  { path: '/approval', route: ApprovalRoutes },
  { path: '/payment', route: PaymentRoutes },
  { path: '/inventory', route: InventoryRoutes },
  { path: '/loyalty', route: LoyaltyRoutes },
  { path: '/alert', route: AlertRoutes },
  { path: '/notification', route: NotificationRoutes },
  { path: '/report', route: ReportRoutes },
  { path: '/audit-log', route: AuditLogRoutes },
  { path: '/onboarding', route: OnboardingRoutes },
  { path: '/sync', route: SyncRoutes },
  { path: '/ai', route: AiRoutes },

  // Platform
  { path: '/platform-module', route: PlatformModuleRoutes },
  { path: '/subscription', route: SubscriptionRoutes },
  { path: '/super-admin', route: SuperAdminRoutes },

  // No-login surfaces
  { path: '/public', route: PublicRoutes },
  { path: '/integrations', route: IntegrationRoutes },
];

moduleRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
