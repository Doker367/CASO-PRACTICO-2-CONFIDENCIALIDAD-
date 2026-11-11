import { createHmac, randomInt, timingSafeEqual } from 'crypto';

export const OTP_DIGITS = 6;
export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;

/** Código numérico uniforme (sin sesgo de módulo) de 6 dígitos. */
export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_DIGITS)
    .toString()
    .padStart(OTP_DIGITS, '0');
}

/**
 * Los códigos nunca se guardan en claro (ni en Redis): solo su HMAC-SHA-256.
 * El `scope` (challenge o userId) impide reutilizar un hash en otro contexto.
 */
export function hashOtp(secret: string, scope: string, code: string): string {
  return createHmac('sha256', secret).update(`${scope}:${code}`).digest('hex');
}

export function verifyOtp(
  secret: string,
  scope: string,
  code: string,
  expectedHash: string,
): boolean {
  const actual = Buffer.from(hashOtp(secret, scope, code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** `usuario@unach.mx` -> `us***@unach.mx` (nunca se revela el correo completo). */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}
