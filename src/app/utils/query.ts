import { Types } from 'mongoose';
import httpStatus from 'http-status';
import AppError from '../errors/AppError';

export const escapeRegex = (value: string) => value.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

export const paginationOf = (query: Record<string, unknown>, defaultLimit = 20) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || defaultLimit, 1), 200);
  return { page, limit, skip: (page - 1) * limit };
};

export const metaOf = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPage: Math.ceil(total / limit),
});

export const toObjectId = (value: unknown, field = 'id') => {
  if (value instanceof Types.ObjectId) return value;
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new AppError(httpStatus.BAD_REQUEST, `Invalid ${field}`);
  }
  return new Types.ObjectId(value);
};

export const notFound = (entity: string) => new AppError(httpStatus.NOT_FOUND, `${entity} not found`);

// Throws 404 when a lookup returned nothing.
export const found = <T>(doc: T, entity: string): NonNullable<T> => {
  if (!doc) throw notFound(entity);
  return doc as NonNullable<T>;
};
