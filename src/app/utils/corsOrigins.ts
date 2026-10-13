import config from '../config';

/**
 * Checks whether an incoming origin is permitted for CORS.
 * Supports:
 * - Direct local development origins (localhost, 127.0.0.1)
 * - FRONTEND_URL from environment config (single or comma-separated)
 * - Production deployment on Vercel (including preview subdomains)
 * - Non-browser requests with no origin header (curl, mobile apps)
 */
export const isOriginAllowed = (origin?: string): boolean => {
  if (!origin) return true;

  const normalized = origin.trim().replace(/\/$/, '');

  const staticAllowed = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'https://hospitality-frontend-blue.vercel.app',
  ];

  if (staticAllowed.includes(normalized)) {
    return true;
  }

  if (config.urls.frontend) {
    const configuredOrigins = config.urls.frontend
      .split(',')
      .map((url) => url.trim().replace(/\/$/, ''))
      .filter(Boolean);

    if (configuredOrigins.includes(normalized)) {
      return true;
    }
  }

  try {
    const { hostname } = new URL(normalized);
    if (hostname.endsWith('.vercel.app')) {
      return true;
    }
  } catch {
    // Invalid URL format
  }

  return false;
};
