import {
  OTP_DIGITS,
  generateOtp,
  hashOtp,
  maskEmail,
  verifyOtp,
} from './two-factor.util';

describe('two-factor util', () => {
  const secret = 'secreto-de-prueba-con-mas-de-32-caracteres';

  it('genera códigos de 6 dígitos', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateOtp();
      expect(code).toMatch(new RegExp(`^\\d{${OTP_DIGITS}}$`));
    }
  });

  it('verifica solo el código correcto y en el scope correcto', () => {
    const code = generateOtp();
    const hash = hashOtp(secret, 'challenge-1', code);

    expect(verifyOtp(secret, 'challenge-1', code, hash)).toBe(true);
    expect(verifyOtp(secret, 'challenge-2', code, hash)).toBe(false);

    const other = code === '000000' ? '000001' : '000000';
    expect(verifyOtp(secret, 'challenge-1', other, hash)).toBe(false);
  });

  it('rechaza hashes con formato inválido sin lanzar', () => {
    expect(verifyOtp(secret, 'scope', '123456', 'no-es-hex')).toBe(false);
  });

  it('enmascara el correo sin revelar el usuario completo', () => {
    expect(maskEmail('usuario@unach.mx')).toBe('us*****@unach.mx');
    expect(maskEmail('a@b.mx')).toBe('a***@b.mx');
    expect(maskEmail('sin-arroba')).toBe('***');
  });
});
