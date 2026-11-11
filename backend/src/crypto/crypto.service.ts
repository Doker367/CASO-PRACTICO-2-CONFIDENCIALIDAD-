import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Registro que se guarda en PostgreSQL en la columna `body_encrypted`.
 * No contiene texto claro: solo el criptograma y los parámetros necesarios
 * para descifrarlo (IV y etiqueta de autenticación GCM).
 */
export interface EncryptedPayload {
  v: 1;
  alg: 'AES-256-GCM';
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface CryptoInfo {
  encryption: {
    algorithm: 'AES-256-GCM';
    keyId: string;
    keySource: 'environment' | 'file';
  };
  signing: {
    algorithm: 'RSA-PSS';
    hash: 'SHA-256';
    keyId: string;
    modulusLength: number;
    publicKeyPem: string;
  };
}

const RSA_PSS_OPTIONS = {
  padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
  saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
} as const;

/**
 * Servicio central de criptografía de la aplicación.
 *
 * - Cifrado simétrico: AES-256-GCM con IV aleatorio de 96 bits y AAD que
 *   vincula el criptograma a una nota y a su dueño.
 * - Firma asimétrica: RSA-PSS (SHA-256) con un par de llaves RSA-3072.
 *
 * Se usa el módulo `crypto` de Node.js (OpenSSL) en lugar de implementar los
 * algoritmos a mano. Las llaves se cargan de variables de entorno o de
 * archivos protegidos; nunca están escritas en el código fuente.
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);

  private dataKey!: Buffer;
  private dataKeyId!: string;
  private dataKeySource: 'environment' | 'file' = 'environment';

  private privateKey!: crypto.KeyObject;
  private publicKey!: crypto.KeyObject;
  private signingKeyId!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.loadSymmetricKey();
    this.loadSigningKeys();
  }

  // ---------------------------------------------------------------------------
  // Carga y validación de llaves
  // ---------------------------------------------------------------------------

  private loadSymmetricKey(): void {
    let rawKey = this.config.get<string>('DATA_ENCRYPTION_KEY')?.trim();
    const configuredFile = this.config.get<string>('DATA_ENCRYPTION_KEY_FILE')?.trim();

    if (rawKey) {
      this.dataKeySource = 'environment';
    } else {
      const file = this.resolvePath(configuredFile || 'secrets/data-encryption.key');
      if (!fs.existsSync(file)) {
        throw new Error(
          'Falta la llave de cifrado de datos. Define DATA_ENCRYPTION_KEY (base64 de 32 bytes) ' +
            'o DATA_ENCRYPTION_KEY_FILE con la ruta a un archivo protegido. ' +
            'Genera las llaves con: node scripts/generate-crypto-keys.mjs',
        );
      }
      rawKey = fs.readFileSync(file, 'utf8').trim();
      this.dataKeySource = 'file';
    }

    // Acepta base64 (estándar) o hexadecimal; debe representar exactamente 32 bytes.
    const key = /^[0-9a-f]{64}$/i.test(rawKey)
      ? Buffer.from(rawKey, 'hex')
      : Buffer.from(rawKey, 'base64');

    if (key.length !== 32) {
      throw new Error(
        'La llave de cifrado debe tener exactamente 32 bytes (AES-256). ' +
          'Genera una con: openssl rand -base64 32',
      );
    }

    this.dataKey = key;
    this.dataKeyId =
      this.config.get<string>('DATA_ENCRYPTION_KEY_ID')?.trim() ||
      crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);

    this.logger.log(
      `Cifrado simétrico AES-256-GCM listo (keyId=${this.dataKeyId}, origen=${this.dataKeySource}).`,
    );
  }

  private loadSigningKeys(): void {
    const privatePath = this.resolvePath(
      this.config.get<string>('NOTES_SIGNING_PRIVATE_KEY_PATH')?.trim() ||
        'secrets/notes-signing-private.pem',
    );
    const publicPath = this.resolvePath(
      this.config.get<string>('NOTES_SIGNING_PUBLIC_KEY_PATH')?.trim() ||
        'secrets/notes-signing-public.pem',
    );

    if (!fs.existsSync(privatePath) || !fs.existsSync(publicPath)) {
      throw new Error(
        'Faltan las llaves RSA de firma. Define NOTES_SIGNING_PRIVATE_KEY_PATH y ' +
          'NOTES_SIGNING_PUBLIC_KEY_PATH (archivos PEM, la privada con permisos 600). ' +
          'Genera las llaves con: node scripts/generate-crypto-keys.mjs',
      );
    }

    // Verifica que la llave privada no sea legible por otros usuarios del sistema.
    const mode = fs.statSync(privatePath).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      this.logger.warn(
        `La llave privada ${privatePath} tiene permisos ${mode.toString(8)}; ` +
          'se recomienda 600 (solo el propietario puede leerla).',
      );
    }

    this.privateKey = crypto.createPrivateKey(fs.readFileSync(privatePath, 'utf8'));
    this.publicKey = crypto.createPublicKey(fs.readFileSync(publicPath, 'utf8'));

    if (this.privateKey.asymmetricKeyType !== 'rsa') {
      throw new Error('La llave privada de firma debe ser RSA.');
    }

    // Comprueba que el par cargado realmente corresponde entre sí.
    const derivedPublic = crypto.createPublicKey(this.privateKey);
    const derivedDer = derivedPublic.export({ type: 'spki', format: 'der' });
    const loadedDer = this.publicKey.export({ type: 'spki', format: 'der' });
    if (!derivedDer.equals(loadedDer)) {
      throw new Error(
        'La llave pública de firma no corresponde a la llave privada configurada.',
      );
    }

    this.signingKeyId = crypto
      .createHash('sha256')
      .update(loadedDer)
      .digest('hex')
      .slice(0, 16);

    this.logger.log(
      `Firma digital RSA-PSS lista (keyId=${this.signingKeyId}, ` +
        `bits=${this.publicKey.asymmetricKeyDetails?.modulusLength ?? 'n/d'}).`,
    );
  }

  /**
   * Resuelve rutas relativas tanto en desarrollo (cwd = backend) como en
   * producción (cwd = /app, dist/crypto, etc.). En Docker se usan rutas
   * absolutas a /run/secrets.
   */
  private resolvePath(candidate: string): string {
    if (path.isAbsolute(candidate)) return candidate;

    const bases = [
      process.cwd(),
      path.resolve(process.cwd(), '..'),
      path.resolve(__dirname, '../../..'),
      path.resolve(__dirname, '../../../..'),
    ];
    for (const base of bases) {
      const full = path.resolve(base, candidate);
      if (fs.existsSync(full)) return full;
    }
    return path.resolve(process.cwd(), candidate);
  }

  // ---------------------------------------------------------------------------
  // Cifrado simétrico (AES-256-GCM)
  // ---------------------------------------------------------------------------

  /**
   * Cifra un texto y devuelve un JSON autocontenido que se guarda tal cual en
   * la base de datos. El AAD impide mover el criptograma a otra nota o usuario.
   */
  encrypt(plaintext: string, aad: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.dataKey, iv, {
      authTagLength: 16,
    });
    cipher.setAAD(Buffer.from(aad, 'utf8'));

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    const record: EncryptedPayload = {
      v: 1,
      alg: 'AES-256-GCM',
      keyId: this.dataKeyId,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    return JSON.stringify(record);
  }

  /**
   * Descifra y autentica el registro. Si el criptograma, el IV, la etiqueta o
   * el AAD fueron alterados, GCM lanza una excepción y no devuelve texto claro.
   */
  decrypt(stored: string, aad: string): string {
    const record = this.parseEncrypted(stored);

    if (record.v !== 1 || record.alg !== 'AES-256-GCM') {
      throw new Error('Formato de cifrado no soportado.');
    }
    if (record.keyId !== this.dataKeyId) {
      throw new Error(
        `La nota fue cifrada con la llave ${record.keyId}, que no está disponible.`,
      );
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.dataKey,
      Buffer.from(record.iv, 'base64'),
      { authTagLength: 16 },
    );
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  parseEncrypted(stored: string): EncryptedPayload {
    let record: EncryptedPayload;
    try {
      record = JSON.parse(stored) as EncryptedPayload;
    } catch {
      throw new Error('El dato cifrado no tiene un formato JSON válido.');
    }
    if (
      !record ||
      typeof record.iv !== 'string' ||
      typeof record.tag !== 'string' ||
      typeof record.ciphertext !== 'string' ||
      typeof record.keyId !== 'string'
    ) {
      throw new Error('El registro cifrado está incompleto.');
    }
    return record;
  }

  /** AAD canónico: ata el criptograma a la nota y a su propietario. */
  noteAad(noteId: string, userId: string): string {
    return `secure-note:${noteId}:${userId}`;
  }

  // ---------------------------------------------------------------------------
  // Firma digital (RSA-PSS + SHA-256)
  // ---------------------------------------------------------------------------

  /**
   * Payload canónico de la nota. Se firma el hash SHA-256 del cuerpo para no
   * firmar directamente datos de tamaño arbitrario. El formato es estable y
   * documentado para que pueda verificarse desde otra implementación.
   */
  noteSigningPayload(note: {
    id: string;
    userId: string;
    title: string;
    body: string;
  }): string {
    const bodyHash = crypto.createHash('sha256').update(note.body, 'utf8').digest('hex');
    return ['secure-note:v1', note.id, note.userId, note.title, bodyHash].join('\n');
  }

  sign(payload: string): string {
    const signature = crypto.sign('sha256', Buffer.from(payload, 'utf8'), {
      key: this.privateKey,
      ...RSA_PSS_OPTIONS,
    });
    return signature.toString('base64');
  }

  verify(payload: string, signatureBase64: string): boolean {
    try {
      return crypto.verify(
        'sha256',
        Buffer.from(payload, 'utf8'),
        { key: this.publicKey, ...RSA_PSS_OPTIONS },
        Buffer.from(signatureBase64, 'base64'),
      );
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Información pública para la demo (nunca expone llaves privadas)
  // ---------------------------------------------------------------------------

  info(): CryptoInfo {
    return {
      encryption: {
        algorithm: 'AES-256-GCM',
        keyId: this.dataKeyId,
        keySource: this.dataKeySource,
      },
      signing: {
        algorithm: 'RSA-PSS',
        hash: 'SHA-256',
        keyId: this.signingKeyId,
        modulusLength: this.publicKey.asymmetricKeyDetails?.modulusLength ?? 0,
        publicKeyPem: this.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
    };
  }
}
