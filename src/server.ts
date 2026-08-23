import { Server } from 'http';
import mongoose from 'mongoose';
import app from './app';
import config from './app/config';
import logger from './app/utils/logger';

let server: Server;

async function main() {
  try {
    await mongoose.connect(config.database_url as string);
    logger.info('Database connected successfully');

    server = app.listen(config.port, () => {
      logger.info(`Server is running on port ${config.port}`);
    });
  } catch (err) {
    logger.error(err, 'Failed to connect to database:');
    process.exit(1); // Exit if DB fails on startup
  }
}

main();

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
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  if (server) {
    server.close(async () => {
      await mongoose.disconnect();
      logger.info('Process terminated.');
    });
  }
});
