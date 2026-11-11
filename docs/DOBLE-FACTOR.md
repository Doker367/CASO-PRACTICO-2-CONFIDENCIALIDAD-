# Doble autenticación (2FA) por correo

La aplicación pide **dos factores** para iniciar sesión:

1. algo que el usuario **sabe**: correo + contraseña (Argon2id);
2. algo que el usuario **tiene**: un código de 6 dígitos enviado a su correo.

El segundo factor es **opcional por cuenta** y se activa desde **Mi cuenta**. Las
cuentas semilla normales lo tienen desactivado para no romper la demo de roles;
la cuenta `2fa@unach.mx` está pensada para esta demostración.

## Flujo

```
POST /auth/login (email + password)
        │
        ├── 2FA desactivado ──► accessToken + cookie refresh
        │
        └── 2FA activado
                │
                ├── se genera un challengeToken (32 bytes aleatorios)
                ├── se genera un código de 6 dígitos (crypto.randomInt)
                ├── el código se guarda como HMAC-SHA-256 en Redis (TTL 10 min)
                ├── se envía el código por SMTP (MailHog en la demo)
                └── respuesta: { mfaRequired, challengeToken, email enmascarado }
                                (NO hay JWT todavía)

POST /auth/2fa/verify (challengeToken + código)
        │
        ├── código incorrecto ──► 401, máximo 5 intentos por reto
        └── código correcto ────► accessToken + cookie refresh
```

Puntos importantes:

- La contraseña correcta **no emite sesión** cuando 2FA está activo.
- El `challengeToken` es opaco y de un solo uso; en Redis se indexa por su
  SHA-256, nunca por el token en claro.
- El código **nunca se guarda en claro**: se almacena
  `HMAC-SHA-256(secreto, challengeId + ":" + código)` y se compara con
  `timingSafeEqual`.
- El código vence a los **10 minutos**, admite **5 intentos** y se invalida al
  usarse. Se puede reenviar con un límite de **1 vez por minuto**.
- La respuesta nunca revela el correo completo (`2f***@unach.mx`).
- Los eventos `auth.login.2fa_challenge`, `auth.2fa.failed`, `auth.2fa.resent`,
  `auth.2fa.enabled` y `auth.2fa.disabled` quedan en el registro de auditoría.

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/v1/auth/2fa/verify` | Verifica reto + código y emite la sesión |
| POST | `/api/v1/auth/2fa/resend` | Reenvía el código (1/min) |
| GET | `/api/v1/auth/2fa/status` | Estado de 2FA del usuario autenticado |
| POST | `/api/v1/auth/2fa/setup` | Envía código para activar 2FA |
| POST | `/api/v1/auth/2fa/confirm` | Confirma el código y activa 2FA |
| POST | `/api/v1/auth/2fa/disable` | Desactiva 2FA (requiere contraseña) |

`/auth/2fa/verify` y `/auth/2fa/resend` son públicos porque todavía no existe
sesión; el reto impide usarlos sin haber validado antes la contraseña.

## Demostración en vivo

Con el stack levantado:

```bash
./scripts/two-factor-demo.sh
```

El script:

1. vacía la bandeja de MailHog;
2. inicia sesión con `2fa@unach.mx` / `Doble123!`;
3. si 2FA no estaba activo, lo activa leyendo el código real del correo;
4. muestra que el login devuelve `mfaRequired` **sin** `accessToken`;
5. enseña el correo recibido y el código detectado;
6. intenta un código incorrecto y muestra el `401`;
7. verifica el código correcto y muestra el JWT emitido;
8. comprueba que el código ya no se puede reutilizar.

### Desde la interfaz

1. Entra a `https://localhost:8443` con cualquier cuenta.
2. Ve a **Mi cuenta → Verificación en dos pasos → Activar 2FA por correo**.
3. Abre MailHog en `http://localhost:8026`, copia el código y confírmalo.
4. Cierra sesión y vuelve a entrar: la app pedirá el código.
5. Para desactivarlo, usa **Mi cuenta → Desactivar 2FA** (pide la contraseña).

### Desde la API manualmente

```bash
# 1) Login: devuelve el reto, no el JWT
curl -sk -X POST https://localhost:8443/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"2fa@unach.mx","password":"Doble123!"}'

# 2) Copia el código desde http://localhost:8026 y verifica
curl -sk -X POST https://localhost:8443/api/v1/auth/2fa/verify \
  -H 'Content-Type: application/json' \
  -d '{"challengeToken":"<challengeToken>","code":"123456"}'
```

## Pruebas automatizadas

```bash
cd backend
npm test
```

`src/auth/two-factor.util.spec.ts` cubre la generación de códigos de 6 dígitos,
la verificación HMAC por scope, el rechazo de hashes inválidos y el enmascarado
del correo. La auditoría general sigue pasando `49/49` porque las cuentas usadas
por `scripts/compliance-check.py` no tienen 2FA activo.
