import mongoose from 'mongoose';
import logger from './logger';

let supportsTransactions: boolean | undefined;

const detect = async () => {
  if (supportsTransactions !== undefined) return supportsTransactions;
  try {
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    supportsTransactions = Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch {
    supportsTransactions = false;
  }
  if (!supportsTransactions) {
    logger.warn('MongoDB is not a replica set: money-moving writes run WITHOUT transactions');
  }
  return supportsTransactions;
};

// Runs fn in a MongoDB transaction. Queries inside use the session automatically
// (mongoose transactionAsyncLocalStorage), so services do not pass sessions around.
export const runInTransaction = async <T>(fn: () => Promise<T>): Promise<T> => {
  if (!(await detect())) return fn();
  let result: T;
  await mongoose.connection.transaction(async () => {
    result = await fn();
  });
  return result!;
};

// Runs fn with no active transaction, even when called from inside one. Side effects
// that outlive the request (domain-event handlers, realtime events) must not inherit
// a session that will already be committed when they run.
export const outsideTransaction = <T>(fn: () => T): T => {
  const als = (mongoose as unknown as { transactionAsyncLocalStorage?: { exit: <R>(cb: () => R) => R } }).transactionAsyncLocalStorage;
  return als ? als.exit(fn) : fn();
};
