import { AddressInfo } from 'net';
import { Server } from 'http';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// Boots the real app against an in-memory MongoDB replica set (transactions work)
// and returns a tiny JSON client for it.

export type TApi = {
  call: (method: string, path: string, options?: { token?: string; body?: unknown; headers?: Record<string, string> }) => Promise<{ status: number; body: any }>;
  stop: () => Promise<void>;
};

export const startApp = async (): Promise<TApi> => {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 60_000 }] });
  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI = replSet.getUri('hpos_test');
  process.env.ACCESS_TOKEN_SECRET = 'test-access-secret';
  process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
  process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';
  process.env.RATE_LIMIT_MAX = '100000';

  const mongoose = (await import('mongoose')).default;
  const { default: app } = await import('../src/app');
  const { ensurePlatformModules } = await import('../src/app/modules/subscription/subscription.service');
  const { requestContext } = await import('../src/app/utils/requestContext');

  await mongoose.connect(process.env.MONGO_URI);
  // Unique indexes are the double-booking guard, so they must exist before the tests.
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  await requestContext.asSystem(() => ensurePlatformModules());

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  const call: TApi['call'] = async (method, path, options = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.headers || {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await res.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON (e.g. CSV)
    }
    return { status: res.status, body };
  };

  const stop = async () => {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await replSet.stop();
  };

  return { call, stop };
};

export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
