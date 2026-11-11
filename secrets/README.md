# secrets/

Este directorio contiene material criptográfico **local** y está ignorado por
git. Nunca se sube al repositorio.

Genera las llaves con:

```bash
node scripts/generate-crypto-keys.mjs
```

Archivos generados:

| Archivo | Contenido | Permisos |
|---|---|---|
| `data-encryption.key` | Clave AES-256 en base64 (32 bytes) | `600` |
| `notes-signing-private.pem` | Llave privada RSA-3072 (PKCS#8) | `600` |
| `notes-signing-public.pem` | Llave pública RSA-3072 (SPKI) | `644` |

En Docker Compose este directorio se monta **solo lectura** en `/run/secrets`
y la API recibe las rutas por variables de entorno:

```
DATA_ENCRYPTION_KEY_FILE=/run/secrets/data-encryption.key
NOTES_SIGNING_PRIVATE_KEY_PATH=/run/secrets/notes-signing-private.pem
NOTES_SIGNING_PUBLIC_KEY_PATH=/run/secrets/notes-signing-public.pem
```

En producción usa un almacén de secretos (Docker secrets, Vault, AWS Secrets
Manager, etc.) y rota las llaves periódicamente.
