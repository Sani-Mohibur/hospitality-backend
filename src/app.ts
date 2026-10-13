import './app/config/mongoose';
import express, { Application, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import globalErrorHandler from './app/middlewares/globalErrorHandler';
import config from './app/config';
import notFound from './app/middlewares/notFound';
import router from './app/routes';
import { requestContext } from './app/utils/requestContext';
import { isOriginAllowed } from './app/utils/corsOrigins';
import { stripeWebhookHandler } from './app/modules/payment/payment.route';

const app: Application = express();

app.set('trust proxy', 1);

// 1. Security & Performance
app.use(helmet());
app.use(compression());
if (config.env === 'development') {
  app.use(morgan('dev'));
} else if (config.env === 'production') {
  app.use(morgan('combined'));
}

// Every request gets its own context (tenant scope, acting user).
app.use((req: Request, _res: Response, next: NextFunction) => requestContext.run({}, () => next()));

// 2. Rate Limiting (Using Config)
const limiter = rateLimit({
  windowMs: Number(config.rate_limit.window) || 15 * 60 * 1000,
  max: Number(config.rate_limit.max) || 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, please try again later.',
});

app.use('/api/v1', limiter);

// 3. Essential Middlewares
app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  }),
);
app.use(cookieParser());
// Raw bytes are kept for webhook signature verification (Stripe, partners).
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      (req as Request).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Stripe calls this; payments are confirmed only here (signed events).
app.post('/api/v1/webhooks/stripe', stripeWebhookHandler);

// 4. Routes
app.use('/api/v1', router);

app.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'API is running successfully',
    version: '2.0.0',
    environment: config.env,
    timeStamp: `${new Date().toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'medium',
    })} UTC+0`,
  });
});

// Liveness/readiness for load balancers and uptime checks.
app.get('/health', (_req: Request, res: Response) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'degraded', db: dbUp ? 'up' : 'down', uptimeSeconds: Math.round(process.uptime()) });
});

// 5. Error Handling
app.use(notFound);
app.use(globalErrorHandler);

export default app;
