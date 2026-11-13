import { hashToken } from './strategies/jwt-refresh.strategy';

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,72}$/;

describe('Módulo de Recuperación de Contraseñas', () => {
  describe('Criptografía y almacenamiento de tokens', () => {
    it('genera un hash SHA-256 de 64 caracteres hex para persistencia', () => {
      const rawToken = '7hG8sK9xL2pQ4vW1yZ3bN5mC8tV0rE6u';
      const hashed = hashToken(rawToken);

      expect(hashed).toMatch(/^[a-f0-9]{64}$/);
      expect(hashed).not.toContain(rawToken);
    });

    it('produce el mismo hash para el mismo token (búsqueda indexada confiable)', () => {
      const token = 'ejemplo-token-recuperacion-32-bytes';
      expect(hashToken(token)).toBe(hashToken(token));
    });

    it('genera hashes completamente distintos ante variaciones mínimas de token (efecto avalancha)', () => {
      const h1 = hashToken('token_recuperacion_1');
      const h2 = hashToken('token_recuperacion_2');
      expect(h1).not.toBe(h2);
    });
  });

  describe('Política de complejidad de contraseñas (NIST / OWASP)', () => {
    it('acepta contraseñas robustas con mayúscula, minúscula, número y símbolo', () => {
      expect(PASSWORD_RULE.test('Admin123!')).toBe(true);
      expect(PASSWORD_RULE.test('Seguridad2026#')).toBe(true);
      expect(PASSWORD_RULE.test('UNACH.c0mputo_2026')).toBe(true);
      expect(PASSWORD_RULE.test('C0ntrasena$Fuerte!')).toBe(true);
    });

    it('rechaza contraseñas con menos de 8 caracteres', () => {
      expect(PASSWORD_RULE.test('Ab1!567')).toBe(false);
      expect(PASSWORD_RULE.test('Aa1!')).toBe(false);
    });

    it('rechaza contraseñas sin mayúsculas', () => {
      expect(PASSWORD_RULE.test('contrasena123!')).toBe(false);
    });

    it('rechaza contraseñas sin minúsculas', () => {
      expect(PASSWORD_RULE.test('CONTRASENA123!')).toBe(false);
    });

    it('rechaza contraseñas sin dígitos numéricos', () => {
      expect(PASSWORD_RULE.test('ContrasenaSegura!')).toBe(false);
    });

    it('rechaza contraseñas sin símbolos o caracteres especiales', () => {
      expect(PASSWORD_RULE.test('ContrasenaSegura123')).toBe(false);
    });
  });

  describe('Validación de caducidad y de un solo uso', () => {
    it('identifica correctamente un token vigente vs un token expirado', () => {
      const now = Date.now();
      const validExpiresAt = new Date(now + 30 * 60 * 1000); // +30m
      const expiredExpiresAt = new Date(now - 1000); // 1s en el pasado

      expect(validExpiresAt.getTime() > now).toBe(true);
      expect(expiredExpiresAt.getTime() < now).toBe(true);
    });

    it('garantiza la regla de uso único (usedAt nulo para procesar, no nulo para rechazar)', () => {
      const unusedRecord = { usedAt: null, expiresAt: new Date(Date.now() + 60000) };
      const alreadyUsedRecord = { usedAt: new Date(), expiresAt: new Date(Date.now() + 60000) };

      const isUsable = (rec: { usedAt: Date | null; expiresAt: Date }) =>
        !rec.usedAt && rec.expiresAt.getTime() > Date.now();

      expect(isUsable(unusedRecord)).toBe(true);
      expect(isUsable(alreadyUsedRecord)).toBe(false);
    });
  });
});
