import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  MONGO_URI: z.string().url('DATABASE_URL must be a valid MongoDB URI'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().default(10),
  
  JWT_SECRET: z.string().optional(),
  JWT_EXPIRE: z.string().optional(),
  ACCESS_TOKEN_SECRET: z.string().min(1, 'ACCESS_TOKEN_SECRET is required'),
  ACCESS_TOKEN_EXPIRES: z.string().default('15m'),
  REFRESH_TOKEN_SECRET: z.string().min(1, 'REFRESH_TOKEN_SECRET is required'),
  REFRESH_TOKEN_EXPIRES: z.string().default('90d'),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  EMAIL_HOST: z.string().optional(),
  EMAIL_PORT: z.coerce.number().optional(),
  EMAIL_ADDRESS: z.string().optional(),
  EMAIL_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  ADMIN_EMAIL: z.string().optional(),
  EMAIL_EXPIRES: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  FRONTEND_URL: z.string().optional(),
  BACKEND_URL: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_ANDROID_CLIENT_ID: z.string().optional(),
  GOOGLE_IOS_CLIENT_ID: z.string().optional(),

  RATE_LIMIT_WINDOW: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().optional(),

  DATA_ENCRYPTION_KEY: z.string().optional(),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().default(15),
  ID_DOCUMENT_RETENTION_DAYS: z.coerce.number().default(90),

  PLATFORM_FEE_BPS: z.coerce.number().default(40),
  TRIAL_DAYS: z.coerce.number().default(14),
  DUNNING_GRACE_DAYS: z.coerce.number().default(14),

  JOBS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),

  SMS_PROVIDER: z.enum(['log', 'twilio']).default('log'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5'),
});

const envVars = envSchema.parse(process.env);

if (envVars.NODE_ENV === 'production' && !envVars.DATA_ENCRYPTION_KEY) {
  throw new Error('DATA_ENCRYPTION_KEY is required in production');
}

export default {
    env: envVars.NODE_ENV,
    port: envVars.PORT,
    database_url: envVars.MONGO_URI,
    bcrypt_salt_rounds: envVars.BCRYPT_SALT_ROUNDS,
    jwt: {
        secret: envVars.JWT_SECRET,
        expires_in: envVars.JWT_EXPIRE,
        access_secret: envVars.ACCESS_TOKEN_SECRET,
        access_expires_in: envVars.ACCESS_TOKEN_EXPIRES,
        refresh_secret: envVars.REFRESH_TOKEN_SECRET,
        refresh_expires_in: envVars.REFRESH_TOKEN_EXPIRES,
    },
    cloudinary: {
        cloud_name: envVars.CLOUDINARY_CLOUD_NAME,
        api_key: envVars.CLOUDINARY_API_KEY,
        api_secret: envVars.CLOUDINARY_API_SECRET,
    },
    email: {
        host: envVars.EMAIL_HOST,
        port: envVars.EMAIL_PORT,
        user: envVars.EMAIL_ADDRESS,
        pass: envVars.EMAIL_PASS,
        from: envVars.EMAIL_FROM,
        admin: envVars.ADMIN_EMAIL,
        expires: envVars.EMAIL_EXPIRES,
    },
    stripe: {
        secret_key: envVars.STRIPE_SECRET_KEY,
        webhook_secret: envVars.STRIPE_WEBHOOK_SECRET,
        connect_webhook_secret: envVars.STRIPE_CONNECT_WEBHOOK_SECRET,
        publishable_key: envVars.STRIPE_PUBLISHABLE_KEY,
    },
    urls: {
        frontend: envVars.FRONTEND_URL,
        backend: envVars.BACKEND_URL,
    },
    google: {
        client_id: envVars.GOOGLE_CLIENT_ID,
        android_client_id: envVars.GOOGLE_ANDROID_CLIENT_ID,
        ios_client_id: envVars.GOOGLE_IOS_CLIENT_ID,
    },
    rate_limit: {
        window: envVars.RATE_LIMIT_WINDOW,
        max: envVars.RATE_LIMIT_MAX,
    },
    security: {
        data_encryption_key: envVars.DATA_ENCRYPTION_KEY || 'dev-only-insecure-key-change-me',
        login_max_attempts: envVars.LOGIN_MAX_ATTEMPTS,
        login_lock_minutes: envVars.LOGIN_LOCK_MINUTES,
        id_document_retention_days: envVars.ID_DOCUMENT_RETENTION_DAYS,
    },
    billing: {
        platform_fee_bps: envVars.PLATFORM_FEE_BPS,
        trial_days: envVars.TRIAL_DAYS,
        dunning_grace_days: envVars.DUNNING_GRACE_DAYS,
    },
    jobs: {
        enabled: envVars.JOBS_ENABLED && envVars.NODE_ENV !== 'test',
    },
    sms: {
        provider: envVars.SMS_PROVIDER,
        twilio_account_sid: envVars.TWILIO_ACCOUNT_SID,
        twilio_auth_token: envVars.TWILIO_AUTH_TOKEN,
        twilio_from: envVars.TWILIO_FROM,
        twilio_whatsapp_from: envVars.TWILIO_WHATSAPP_FROM,
    },
    ai: {
        anthropic_api_key: envVars.ANTHROPIC_API_KEY,
        model: envVars.AI_MODEL,
    },
};