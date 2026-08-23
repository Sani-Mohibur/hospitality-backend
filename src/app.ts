import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import globalErrorHandler from './app/middlewares/globalErrorHandler';
import config from './app/config';
import notFound from './app/middlewares/notFound';
import router from './app/routes';

const app: Application = express();

// 1. Security & Performance
app.use(helmet());
app.use(compression());
if (config.env === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// 2. Rate Limiting (Using Config)
const limiter = rateLimit({
  windowMs: Number(config.rate_limit.window) || 15 * 60 * 1000,
  max: Number(config.rate_limit.max) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, please try again later.',
});

app.use('/api/v1', limiter);

// 3. Essential Middlewares
app.use(cors({ origin: config.urls.frontend || 'http://localhost:3000', credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 4. Routes
app.use('/api/v1', router);

app.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'API is running successfully',
    version: '2.0.0',
    environment: config.env,
  });
});

// 5. Error Handling
app.use(notFound);
app.use(globalErrorHandler);

export default app;
