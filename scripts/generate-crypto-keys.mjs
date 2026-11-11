#!/usr/bin/env node
/**
 * Genera las llaves criptográficas de la aplicación:
 *
 *   secrets/data-encryption.key       -> clave AES-256 (32 bytes, base64)
 *   secrets/notes-signing-private.pem -> llave privada RSA-3072 (permisos 600)
 *   secrets/notes-signing-public.pem  -> llave pública RSA-3072 (permisos 644)
 *
 * Uso:
 *   node scripts/generate-crypto-keys.mjs
 *   node scripts/generate-crypto-keys.mjs --force   # rota las llaves
 *
 * La llave privada NUNCA se sube al repositorio: `secrets/` está en .gitignore.
 * En Docker, el directorio se monta como solo lectura en /run/secrets y las
 * rutas se pasan por variables de entorno.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const secretsDir = resolve(repoRoot, 'secrets');
const force = process.argv.includes('--force');

const paths = {
  symmetric: resolve(secretsDir, 'data-encryption.key'),
  privateKey: resolve(secretsDir, 'notes-signing-private.pem'),
  publicKey: resolve(secretsDir, 'notes-signing-public.pem'),
};

function ensureWritable() {
  if (!force && existsSync(paths.privateKey)) {
    console.error(
      `[keys] Ya existe ${paths.privateKey}.\n` +
        'No se sobrescribe por seguridad: las notas existentes dejarían de descifrarse.\n' +
        'Si realmente quieres rotar las llaves, ejecuta: node scripts/generate-crypto-keys.mjs --force',
    );
    process.exit(1);
  }
}

function generateSymmetricKey() {
  // 32 bytes = 256 bits para AES-256.
  const key = randomBytes(32);
  writeFileSync(paths.symmetric, `${key.toString('base64')}\n`, { mode: 0o600 });
  chmodSync(paths.symmetric, 0o600);
}

function generateSigningPair() {
  // RSA-3072: tamaño recomendado actualmente para firmas de larga vida.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  writeFileSync(paths.privateKey, privateKey, { mode: 0o600 });
  chmodSync(paths.privateKey, 0o600);
  writeFileSync(paths.publicKey, publicKey, { mode: 0o644 });
  chmodSync(paths.publicKey, 0o644);
}

ensureWritable();
mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
chmodSync(secretsDir, 0o700);

if (!force && existsSync(paths.symmetric)) {
  console.log(`[keys] Reutilizando ${paths.symmetric}`);
} else {
  generateSymmetricKey();
  console.log(`[keys] Clave AES-256 generada: ${paths.symmetric}`);
}

generateSigningPair();
console.log(`[keys] Llave privada RSA-3072 generada: ${paths.privateKey} (chmod 600)`);
console.log(`[keys] Llave pública  RSA-3072 generada: ${paths.publicKey} (chmod 644)`);

const keyMaterial = readFileSync(paths.symmetric, 'utf8').trim();

console.log(`
[keys] Listo. Configura estas variables de entorno (o usa el archivo protegido):

# Opción A — archivo protegido (recomendada, ya usada por docker-compose)
DATA_ENCRYPTION_KEY_FILE=/run/secrets/data-encryption.key
NOTES_SIGNING_PRIVATE_KEY_PATH=/run/secrets/notes-signing-private.pem
NOTES_SIGNING_PUBLIC_KEY_PATH=/run/secrets/notes-signing-public.pem

# Opción B — variable de entorno con la clave en base64
DATA_ENCRYPTION_KEY=${keyMaterial}

# Desarrollo local sin Docker (desde la raíz del repo):
#   DATA_ENCRYPTION_KEY_FILE=secrets/data-encryption.key
#   NOTES_SIGNING_PRIVATE_KEY_PATH=secrets/notes-signing-private.pem
#   NOTES_SIGNING_PUBLIC_KEY_PATH=secrets/notes-signing-public.pem

No subas secrets/ al repositorio ni pegues la llave privada en el código.
`);
