import crypto from 'crypto';
import config from '../config';

// ---------- Field encryption (guest ID numbers, MFA secrets) ----------
const key = () => crypto.createHash('sha256').update(config.security.data_encryption_key).digest();

export const encrypt = (plain: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
};

export const decrypt = (payload: string): string => {
  const [version, iv, tag, data] = payload.split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported ciphertext');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
};

export const maskTail = (value: string, visible = 4) =>
  value.length <= visible ? '*'.repeat(value.length) : `${'*'.repeat(value.length - visible)}${value.slice(-visible)}`;

// ---------- Tokens ----------
export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const randomCode = (length = 6) =>
  Array.from({ length }, () => crypto.randomInt(0, 10)).join('');

export const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

export const hmacSha256 = (secret: string, payload: string | Buffer) =>
  crypto.createHmac('sha256', secret).update(payload).digest('hex');

// ---------- TOTP (RFC 6238) for MFA ----------
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const base32Encode = (buf: Buffer) => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
};

const base32Decode = (input: string) => {
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

export const generateTotpSecret = () => base32Encode(crypto.randomBytes(20));

const hotp = (secret: string, counter: number) => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
};

export const totp = (secret: string, at = Date.now()) => hotp(secret, Math.floor(at / 30000));

// Accepts the current code and one step either side for clock drift.
export const verifyTotp = (secret: string, code: string, at = Date.now()) => {
  const step = Math.floor(at / 30000);
  return [-1, 0, 1].some((w) => safeEqual(hotp(secret, step + w), String(code)));
};

export const totpUri = (secret: string, account: string, issuer = 'HPOS') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
