import { Server } from 'http';
import mongoose from 'mongoose';
import app from './app';
import config from './app/config';
import logger from './app/utils/logger';
import { socketManager } from './app/utils/socket';
import { socketAuthorizer } from './app/modules/system/socketAuthorizer';
import { ensurePlatformModules } from './app/modules/subscription/subscription.service';
import { registerJobs } from './app/jobs';
import { startScheduler, stopScheduler } from './app/utils/scheduler';
import { requestContext } from './app/utils/requestContext';

let server: Server;

async function main() {
  try {
    await mongoose.connect(config.database_url as string);
    logger.info('Database connected successfully');
    await requestContext.asSystem(() => ensurePlatformModules());

    server = app.listen(config.port, () => {
      logger.info(`Server is running on port ${config.port}`);
    });

    // Initialize Socket.io (authenticated; rooms limited to the user's grants)
    socketManager.init(server, socketAuthorizer);

    if (config.jobs.enabled) {
      registerJobs();
      startScheduler();
    }
  } catch (err) {
    logger.error(err, 'Failed to connect to database:');
    process.exit(1); // Exit if DB fails on startup
  }
}

main();

const shutdown = (signal: string) => {
  logger.info(`${signal} received. Shutting down gracefully...`);
  stopScheduler();
  if (server) {
    server.close(async () => {
      await mongoose.disconnect();
      logger.info('Process terminated.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  } else {
    process.exit(0);
  }
};

process.on('unhandledRejection', (error) => {
  logger.error(error, 'Unhandled Rejection detected. Shutting down...');
  if (server) {
    server.close(() => {
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
});

process.on('uncaughtException', (error) => {
  logger.error(error, 'Uncaught Exception detected. Shutting down...');
  process.exit(1);
});

// Added for Production Cloud Environments
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
