# Cifrado simétrico y firma digital en la aplicación

Este documento explica la implementación agregada al caso práctico: una
**bóveda de notas privadas** donde el contenido sensible se cifra con
**AES-256-GCM** antes de guardarse en PostgreSQL y se firma con **RSA-PSS** para
verificar su integridad y autenticidad.

| Requisito | Implementación |
|---|---|
| Cifrado simétrico de un dato de la app | Cuerpo de cada nota (`secure_notes.body_encrypted`) con AES-256-GCM |
| Flujo completo claro → cifrado → descifrado | Formulario → API cifra → PostgreSQL guarda criptograma → API descifra al leer |
| Firma/cifrado asimétrico en una función real | Firma digital de cada nota (documento) con RSA-PSS y verificación con clave pública |
| Librería criptográfica establecida | Módulo `crypto` de Node.js (OpenSSL); no se implementó ningún algoritmo a mano |
| Dónde se guardan las llaves | Clave AES y llave privada RSA en archivos protegidos (`secrets/`, `chmod 600`, montados solo lectura en Docker) o variables de entorno; nunca en el código |
| Aplicación funcional | Página **Datos seguros** del frontend + endpoints REST + tablas Prisma + auditoría |

---

## 1. Por qué el módulo `crypto` de Node.js

El backend es NestJS/TypeScript, así que se usa el módulo `crypto` incluido en
Node.js, que delega en **OpenSSL**:

- Está mantenido y auditado por el propio runtime; no es una dependencia
  experimental.
- Implementa AES-256-GCM y RSA-PSS de forma nativa.
- Evita el error clásico de implementar a mano el modo de operación, el padding o
  la generación de aleatorios.
- No agrega dependencias de terceros a la imagen Docker.

Las primitivas usadas son:

| Uso | Algoritmo | Parámetros |
|---|---|---|
| Cifrado simétrico | AES-256-GCM | Llave de 32 bytes, IV aleatorio de 96 bits, etiqueta de autenticación de 128 bits |
| Firma digital | RSA-PSS con SHA-256 | Llave RSA-3072, salt length = digest |
| Hash de contenido | SHA-256 | Para el payload canónico de la firma |
| Aleatoriedad | `crypto.randomBytes` / `randomUUID` | IV y IDs únicos |

---

## 2. Cifrado simétrico: flujo completo

### 2.1 Escritura (texto claro → criptograma)

1. El usuario escribe el contenido en la página **Datos seguros**.
2. El navegador lo envía por HTTPS al endpoint `POST /api/v1/secure-notes`.
3. La API genera un `id` de nota y un **AAD** (Additional Authenticated Data):
   `secure-note:<id>:<userId>`.
4. `CryptoService.encrypt()` genera un IV aleatorio y cifra con AES-256-GCM.
5. Se guarda en `secure_notes.body_encrypted` un JSON como este:

```json
{
  "v": 1,
  "alg": "AES-256-GCM",
  "keyId": "6d36c5ec81388085",
  "iv": "MQ7wCwwW3sJa9SKn",
  "tag": "A+i4qtaQy9BjaBqQWmcWvw==",
  "ciphertext": "6d6sxQGH/7piSK1+vqrkF++boFACD+Qa9/ZewyRTGcgFYnIh4OlS9+P0i1h/6tKG/FGFG0MMBa2zycHWYnU="
}
```

El texto claro **nunca** se escribe en la base de datos ni en los logs.

### 2.2 Lectura (criptograma → texto claro)

1. `GET /api/v1/secure-notes` recupera las notas del usuario autenticado.
2. `CryptoService.decrypt()` reconstruye el AAD, descifra y **verifica la
   etiqueta GCM**.
3. Si el criptograma, el IV, la etiqueta o el AAD fueron alterados, GCM falla y
   la API devuelve `status: "decryption_error"` sin texto claro.
4. La respuesta incluye tanto `body` (texto claro para el usuario) como
   `stored.value` (el JSON exacto que vive en PostgreSQL), para poder demostrar
   el antes/después en la interfaz.

### 2.3 Código principal

`backend/src/crypto/crypto.service.ts`:

```ts
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

  return JSON.stringify({
    v: 1,
    alg: 'AES-256-GCM',
    keyId: this.dataKeyId,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}

decrypt(stored: string, aad: string): string {
  const record = this.parseEncrypted(stored);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    this.dataKey,
    Buffer.from(record.iv, 'base64'),
    { authTagLength: 16 },
  );
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final(), // lanza si la etiqueta GCM no coincide
  ]).toString('utf8');
}
```

Decisiones de diseño:

- **GCM en lugar de CBC**: es cifrado autenticado (AEAD). Detecta alteraciones y
  evita ataques de padding.
- **IV aleatorio por operación**: el mismo texto produce criptogramas distintos.
- **AAD con id y userId**: impide copiar el criptograma de una nota a otra o de
  un usuario a otro.
- **`keyId` en el registro**: permite rotar llaves y saber con cuál se cifró cada
  dato.
- **JSON autocontenido**: el dato se puede descifrar sin columnas auxiliares.

---

## 3. Firma digital asimétrica: RSA-PSS

Cada nota es un pequeño documento. Al crearla, la API firma un **payload
canónico** con la llave privada RSA:

```
secure-note:v1
<id>
<userId>
<título>
<sha256(cuerpo en claro)>
```

La firma se calcula con:

```ts
crypto.sign('sha256', Buffer.from(payload, 'utf8'), {
  key: this.privateKey,
  padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
  saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
});
```

Al leer o verificar (`GET /api/v1/secure-notes/:id/verify`), la API descifra el
cuerpo, reconstruye el payload y verifica con la llave pública:

```ts
crypto.verify(
  'sha256',
  Buffer.from(payload, 'utf8'),
  { key: this.publicKey, padding: RSA_PKCS1_PSS_PADDING, saltLength: RSA_PSS_SALTLEN_DIGEST },
  Buffer.from(signatureBase64, 'base64'),
);
```

Propiedades que se demuestran:

- **Integridad**: si cambia el título, el cuerpo o el id, la firma deja de ser
  válida.
- **Autenticidad**: solo quien tiene la llave privada pudo generar esa firma.
- **Verificación pública**: el endpoint `GET /api/v1/secure-notes/crypto-info`
  expone la llave pública (SPKI PEM) y su `keyId`; no expone la privada.
- **RSA-PSS** es un esquema de firma probabilístico recomendado (a diferencia de
  PKCS#1 v1.5) y con SHA-256.

La UI muestra por cada nota el estado **“firma válida” / “firma inválida”** y un
botón **Verificar firma**.

---

## 4. Dónde y cómo se guardan las llaves

### 4.1 Clave simétrica AES-256

Se carga, en este orden, de:

1. `DATA_ENCRYPTION_KEY` (variable de entorno, base64 de 32 bytes), o
2. `DATA_ENCRYPTION_KEY_FILE` (ruta a un archivo protegido con la clave), o
3. `secrets/data-encryption.key` en desarrollo local.

La API valida al arrancar que la clave tenga exactamente 32 bytes; si no, se
niega a iniciar. La clave no aparece en el repositorio.

### 4.2 Par de llaves RSA

- `NOTES_SIGNING_PRIVATE_KEY_PATH`: llave privada PKCS#8, archivo con permisos
  `600`, solo legible por el proceso del backend.
- `NOTES_SIGNING_PUBLIC_KEY_PATH`: llave pública SPKI, distribuible.
- Al arrancar se valida que ambas llaves formen un par y que la privada sea RSA.
  Si la privada tiene permisos más amplios que `600`, se emite una advertencia.

### 4.3 Docker Compose

`docker-compose.yml` monta el directorio local `secrets/` como **solo lectura**
en `/run/secrets` y pasa las rutas por variables de entorno:

```yaml
volumes:
  - ./secrets:/run/secrets:ro
environment:
  DATA_ENCRYPTION_KEY_FILE: /run/secrets/data-encryption.key
  NOTES_SIGNING_PRIVATE_KEY_PATH: /run/secrets/notes-signing-private.pem
  NOTES_SIGNING_PUBLIC_KEY_PATH: /run/secrets/notes-signing-public.pem
```

La llave privada no se copia dentro de la imagen Docker ni se pasa como argumento
de build. En producción se recomienda un almacén de secretos (Docker secrets,
HashiCorp Vault, AWS Secrets Manager, etc.) y rotación periódica.

Generación:

```bash
node scripts/generate-crypto-keys.mjs
# rota las llaves (invalida las notas anteriores):
node scripts/generate-crypto-keys.mjs --force
```

El script crea `secrets/` con permisos `700`, la clave AES con `600`, la llave
privada con `600` y la pública con `644`. `secrets/` está en `.gitignore`.

---

## 5. Modelo de datos y API

### Tabla `secure_notes`

| Columna | Contenido |
|---|---|
| `id` | UUID de la nota |
| `user_id` | Dueño de la nota |
| `title` | Título (metadato visible; no es el dato sensible) |
| `body_encrypted` | JSON con IV, etiqueta GCM, criptograma y `keyId` |
| `signature` | Firma RSA-PSS en base64 |
| `encryption_key_id` | `keyId` de la clave AES usada |
| `signing_key_id` | `keyId` de la llave RSA usada |
| `created_at`, `updated_at` | Fechas |

### Endpoints

| Método | Ruta | Permiso | Función |
|---|---|---|---|
| GET | `/api/v1/secure-notes` | `notes:read` | Lista y descifra las notas del usuario |
| POST | `/api/v1/secure-notes` | `notes:manage` | Cifra, firma y guarda una nota |
| GET | `/api/v1/secure-notes/:id` | `notes:read` | Descifra una nota propia |
| GET | `/api/v1/secure-notes/:id/verify` | `notes:read` | Verifica la firma RSA-PSS |
| DELETE | `/api/v1/secure-notes/:id` | `notes:manage` | Elimina una nota propia |
| GET | `/api/v1/secure-notes/crypto-info` | `notes:read` | Algoritmos, `keyId`s y llave pública |

El acceso está limitado al dueño: otra cuenta autenticada recibe `404` al pedir
una nota ajena. Cada operación se registra en `audit_logs` (crear/eliminar), sin
guardar el contenido.

---

## 6. Guion de demostración en vivo

### Antes de arrancar

```bash
node scripts/generate-crypto-keys.mjs
cp .env.example .env        # si aún no existe; completa los secretos JWT
docker compose up --build
```

Espera a que el servicio `seed` termine. Usuario demo:

```
usuario@unach.mx / Usuario123!
```

### Demostración

1. Entra a `https://localhost:8443` e inicia sesión como
   `usuario@unach.mx`.
2. Abre **Datos seguros** en el menú.
3. Muestra las dos tarjetas: **AES-256-GCM** y **RSA-PSS**, con sus `keyId`s.
4. Crea una nota, por ejemplo:
   - Título: `Credenciales del laboratorio`
   - Contenido: `usuario: admin-srv / contraseña: S3cr3t!2026`
5. En la tarjeta de la nota compara:
   - **“Lo que ve el usuario”**: el texto claro.
   - **“Lo que hay en PostgreSQL”**: el JSON cifrado con IV, tag y criptograma.
6. Pulsa **Verificar firma** → “Firma RSA-PSS válida”.
7. Muestra la fila real en la base de datos:

```bash
docker compose exec postgres psql -U rbac_user -d rbac_app \
  -c "SELECT id, title, body_encrypted, left(signature, 40) AS firma FROM secure_notes;"
```

8. Demuestra la integridad de GCM alterando un byte del criptograma (en una nota
   de prueba):

```bash
docker compose exec postgres psql -U rbac_user -d rbac_app \
  -c "UPDATE secure_notes SET body_encrypted = replace(body_encrypted, 'A', 'B') WHERE id = '<id>';"
```

Al recargar, la nota muestra **“error de integridad”** y no revela texto claro.
Restaura el valor o elimina la nota de prueba.

9. Demuestra la firma: altera el campo `signature` y vuelve a verificar; la UI
   dirá **“firma inválida”** aunque el texto se pueda descifrar. Restaura o borra
   la nota.

### Verificación por terminal (sin UI)

También puedes ejecutar la demo completa con:

```bash
./scripts/crypto-demo.sh
```

El script detecta automáticamente el stack de Docker Compose (`https://localhost:8443`)
o un API local (`http://localhost:3000`). La fila real de PostgreSQL la consulta con
`docker compose exec postgres psql`, porque el contenedor de Postgres no publica el
puerto 5432 al host. Con una base local, exporta `DATABASE_URL` antes de ejecutarlo.

O hacerlo manualmente:

```bash
TOKEN=$(curl -s -X POST https://localhost:8443/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"usuario@unach.mx","password":"Usuario123!"}' | \
  python3 -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])')

curl -s -X POST https://localhost:8443/api/v1/secure-notes \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Demo","body":"dato secreto 123"}' | python3 -m json.tool

curl -s https://localhost:8443/api/v1/secure-notes \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## 7. Pruebas automatizadas

```bash
cd backend
npm test
```

`src/crypto/crypto.service.spec.ts` cubre:

- cifrado y descifrado del mismo dato;
- IV distinto para el mismo texto;
- rechazo si cambia el AAD (nota/usuario);
- detección de alteración del criptograma (etiqueta GCM);
- firma y verificación RSA-PSS;
- rechazo de payload alterado;
- que `info()` nunca exponga la llave privada.

---

## 8. Limitaciones y siguientes pasos

- El certificado TLS es autofirmado (demo académica).
- Se usa una sola clave AES y un solo par RSA; el campo `keyId` deja preparada la
  rotación, pero no se implementa un KMS/HSM.
- El título de la nota se guarda en claro para poder listarlo. Si también fuera
  sensible, se cifraría igual que el cuerpo.
- Para producción: usar un KMS/HSM, rotación automática, backups cifrados,
  monitoreo de fallos de descifrado y separación de funciones (la llave de firma
  podría vivir en un servicio de firma dedicado).
