import { hashToken } from './jwt-refresh.strategy';

describe('hashToken', () => {
  it('genera un hash SHA-256 estable de 64 hex', () => {
    const a = hashToken('token-secreto');
    const b = hashToken('token-secreto');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('no almacena el token en claro', () => {
    const raw = 'eyJhbGciOiJIUzI1NiJ9.payload';
    expect(hashToken(raw)).not.toContain(raw);
  });
});
