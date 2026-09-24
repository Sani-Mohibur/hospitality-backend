import { Schema, model } from 'mongoose';
import logger from './logger';
import { requestContext } from './requestContext';

const jobLockSchema = new Schema({
  name: { type: String, required: true, unique: true },
  lockedUntil: { type: Date, required: true },
  lastRunAt: { type: Date },
  lastError: { type: String },
});

const JobLock = model('JobLock', jobLockSchema);

type TJob = { name: string; everyMs: number; run: () => Promise<void> };

const jobs: TJob[] = [];
const timers: NodeJS.Timeout[] = [];

export const registerJob = (job: TJob) => {
  jobs.push(job);
};

// Takes a DB lock so only one API instance runs a job per interval.
const acquire = async (name: string, everyMs: number) => {
  const now = new Date();
  try {
    const lock = await JobLock.findOneAndUpdate(
      { name, lockedUntil: { $lte: now } },
      { $set: { lockedUntil: new Date(now.getTime() + everyMs * 0.9) } },
      { upsert: true, returnDocument: 'after' },
    );
    return Boolean(lock);
  } catch (err: any) {
    if (err?.code === 11000) return false;
    throw err;
  }
};

export const runJobNow = async (name: string) => {
  const job = jobs.find((j) => j.name === name);
  if (!job) throw new Error(`Unknown job ${name}`);
  await requestContext.asSystem(() => job.run());
};

export const startScheduler = () => {
  for (const job of jobs) {
    const tick = async () => {
      try {
        if (!(await requestContext.asSystem(() => acquire(job.name, job.everyMs)))) return;
        await requestContext.asSystem(() => job.run());
        await JobLock.updateOne({ name: job.name }, { lastRunAt: new Date(), lastError: null });
      } catch (err: any) {
        logger.error(err, `Job ${job.name} failed`);
        await JobLock.updateOne({ name: job.name }, { lastError: String(err?.message || err) }).catch(() => undefined);
      }
    };
    timers.push(setInterval(tick, job.everyMs));
    setTimeout(tick, 5_000);
  }
  logger.info(`Scheduler started with ${jobs.length} jobs`);
};

export const stopScheduler = () => {
  for (const t of timers.splice(0)) clearInterval(t);
};

export const jobStatus = () => JobLock.find().lean();
