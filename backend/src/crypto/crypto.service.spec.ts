import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  let service: CryptoService;
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-service-'));
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    fs.writeFileSync(path.join(tempDir, 'private.pem'), privateKey, { mode: 0o600 });
    fs.writeFileSync(path.join(tempDir, 'public.pem'), publicKey);

    const values: Record<string, string> = {
      DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      NOTES_SIGNING_PRIVATE_KEY_PATH: path.join(tempDir, 'private.pem'),
      NOTES_SIGNING_PUBLIC_KEY_PATH: path.join(tempDir, 'public.pem'),
    };
    const config = { get: (key: string) => values[key] } as unknown as ConfigService;
    service = new CryptoService(config);
    service.onModuleInit();
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('cifra y descifra el dato (flujo completo)', () => {
    const plaintext = 'Nota confidencial: la contraseña del servidor es 1234.';
    const aad = service.noteAad('note-1', 'user-1');
    const stored = service.encrypt(plaintext, aad);

    expect(stored).not.toContain(plaintext);
    expect(stored).not.toContain('confidencial');
    expect(JSON.parse(stored).alg).toBe('AES-256-GCM');
    expect(service.decrypt(stored, aad)).toBe(plaintext);
  });

  it('usa un IV distinto en cada cifrado del mismo texto', () => {
    const aad = service.noteAad('note-1', 'user-1');
    const a = JSON.parse(service.encrypt('mismo texto', aad));
    const b = JSON.parse(service.encrypt('mismo texto', aad));
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('rechaza el criptograma si cambia el AAD (nota/usuario distinto)', () => {
    const stored = service.encrypt('dato', service.noteAad('note-1', 'user-1'));
    expect(() => service.decrypt(stored, service.noteAad('note-2', 'user-1'))).toThrow();
  });

  it('detecta la alteración del criptograma (etiqueta GCM)', () => {
    const aad = service.noteAad('note-1', 'user-1');
    const record = JSON.parse(service.encrypt('dato íntegro', aad));
    const bytes = Buffer.from(record.ciphertext, 'base64');
    bytes[0] ^= 0xff;
    record.ciphertext = bytes.toString('base64');
    expect(() => service.decrypt(JSON.stringify(record), aad)).toThrow();
  });

  it('firma y verifica el documento; detecta alteraciones', () => {
    const note = { id: 'note-1', userId: 'user-1', title: 'Título', body: 'Contenido' };
    const payload = service.noteSigningPayload(note);
    const signature = service.sign(payload);

    expect(service.verify(payload, signature)).toBe(true);
    expect(service.verify(`${payload}\nALTERADO`, signature)).toBe(false);
    expect(
      service.verify(
        service.noteSigningPayload({ ...note, body: 'Contenido alterado' }),
        signature,
      ),
    ).toBe(false);
  });

  it('expone información pública sin llaves privadas', () => {
    const info = service.info();
    expect(info.encryption.algorithm).toBe('AES-256-GCM');
    expect(info.signing.algorithm).toBe('RSA-PSS');
    expect(info.signing.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(JSON.stringify(info)).not.toContain('PRIVATE KEY');
  });
});
