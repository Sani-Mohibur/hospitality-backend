import pino from 'pino';
import config from '../config';

const logger = pino({
  level: config.env === 'development' ? 'debug' : 'info',
  transport:
    config.env === 'development'
      ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
        },
      }
      : undefined,
});

export default logger;
