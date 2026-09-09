import { Reservation } from '../hospitality/reservation/reservation.model';
import { Order } from '../restaurant/order/order.model';
import mongoose from 'mongoose';

const getHospitalityStats = async (tenantId: string) => {
  const objectIdTenant = new mongoose.Types.ObjectId(tenantId);
  
  // Total reservations
  const totalReservations = await Reservation.countDocuments({ tenant: objectIdTenant });
  
  // Revenue (if we had a billing model, but we can assume totalAmount on reservation or orders for now)
  // Just some simple aggregations
  const statusCounts = await Reservation.aggregate([
    { $match: { tenant: objectIdTenant } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);

  return {
    totalReservations,
    statusCounts,
  };
};

const getRestaurantStats = async (tenantId: string) => {
  const objectIdTenant = new mongoose.Types.ObjectId(tenantId);

  const totalOrders = await Order.countDocuments({ tenant: objectIdTenant });
  
  const revenueData = await Order.aggregate([
    { $match: { tenant: objectIdTenant, status: 'COMPLETED' } },
    { $group: { _id: null, totalRevenue: { $sum: '$totalAmount' } } }
  ]);

  return {
    totalOrders,
    totalRevenue: revenueData[0]?.totalRevenue || 0,
  };
};

export const ReportService = {
  getHospitalityStats,
  getRestaurantStats,
};
