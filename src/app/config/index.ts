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
  ACCESS_TOKEN_EXPIRES: z.string().default('30d'),
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

  FRONTEND_URL: z.string().optional(),
  BACKEND_URL: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_ANDROID_CLIENT_ID: z.string().optional(),
  GOOGLE_IOS_CLIENT_ID: z.string().optional(),

  RATE_LIMIT_WINDOW: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().optional(),
});

const envVars = envSchema.parse(process.env);

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
};