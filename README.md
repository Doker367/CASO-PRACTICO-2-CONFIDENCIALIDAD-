# Caso Práctico – Confidencialidad | Seguridad en Cómputo (UNACH)

Aplicación web con **gestión de roles y permisos**, **API REST protegida con JWT** sobre **HTTPS**, frontend React y despliegue **Dockerizado**.

> **Resultado de la auditoría automatizada: 48/48 comprobaciones OK** (`python3 scripts/compliance-check.py`)

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + Vite + TypeScript + React Router |
| Backend | NestJS 10 + TypeScript (API REST `/api/v1`, JSON) |
| Base de datos | PostgreSQL 16 + Prisma ORM |
| Cache / anti-fuerza-bruta | Redis 7 |
| Autenticación | JWT HS256 (access 15 min + refresh 7 días rotatorio) |
| Hash de contraseñas | Argon2id |
| TLS | nginx con TLS 1.2/1.3 + HSTS (cert self-signed para demo) |
| Correo (recuperación) | MailHog (dev/demo) |
| Despliegue | Docker Compose |

## Arranque rápido

```bash
cp .env.example .env
# OBLIGATORIO: generar secretos fuertes y pegarlos en .env (JWT_SECRET y JWT_REFRESH_SECRET)
#   openssl rand -base64 64
# La API se niega a arrancar con secretos placeholder o de menos de 32 caracteres.
docker compose up --build
```

| Servicio | URL |
|---|---|
| **Frontend (HTTPS)** | https://localhost:8443 |
| Frontend (HTTP → redirige a HTTPS) | http://localhost:8080 |
| API REST | https://localhost:8443/api/v1 |
| MailHog | http://localhost:8026 |

> El certificado TLS es **autofirmado** (demo académica): acepta la advertencia del navegador en `https://localhost:8443`. En producción se usa un certificado de una CA pública (Let's Encrypt u otro).

### Usuarios semilla

| Rol | Email | Contraseña |
|---|---|---|
| Administrador | `admin@unach.mx` | `Admin123!` |
| Editor | `editor@unach.mx` | `Editor123!` |
| Usuario Regular | `usuario@unach.mx` | `Usuario123!` |

## Arquitectura

```
Navegador ──HTTPS──► nginx TLS (:8443) ──► Frontend React (SPA)
                          │
                          └─ /api/v1 ──► API NestJS ──► PostgreSQL (datos + auditoría)
                             Bearer JWT          └──► Redis (lockout, rate-limit)
                             Cookie HttpOnly     └──► MailHog (recuperación)
```

- El frontend **nunca** accede a la base de datos: consume exclusivamente la API REST en JSON.
- Toda comunicación cliente-servidor va por **HTTPS** (TLS termina en nginx).
- El access token vive solo en **memoria** del cliente; el refresh token va en cookie **HttpOnly + Secure + SameSite=Strict** (nunca en `localStorage`).

## API REST principal

| Método | Ruta | Permiso |
|---|---|---|
| POST | `/api/v1/auth/register` | público |
| POST | `/api/v1/auth/login` | público (devuelve JWT) |
| POST | `/api/v1/auth/refresh` | cookie refresh |
| POST | `/api/v1/auth/logout` | cookie refresh |
| POST | `/api/v1/auth/change-password` | autenticado |
| POST | `/api/v1/auth/forgot-password` | público |
| POST | `/api/v1/auth/reset-password` | público |
| GET | `/api/v1/auth/me` | autenticado |
| GET/POST/PATCH/DELETE | `/api/v1/products` | `products:read/create/update/delete` |
| GET/POST/PATCH/DELETE | `/api/v1/categories` | `categories:*` |
| GET | `/api/v1/users` | `users:read` |
| PATCH | `/api/v1/users/:id/roles` | `users:manage` |
| GET/POST/PATCH/DELETE | `/api/v1/roles` | `roles:manage` |
| **PUT** | `/api/v1/roles/:id/permissions` | `roles:manage` |
| GET | `/api/v1/permissions` | `permissions:read` |
| GET | `/api/v1/audit` | `audit:read` (solo lectura) |

## Matriz de permisos por rol (semilla)

| Permiso | Administrador | Editor | Usuario Regular |
|---|---|---|---|
| `products:read` / `categories:read` | ✓ | ✓ | ✓ |
| `products:create/update/delete` | ✓ | ✓ | — |
| `categories:write/delete` | ✓ | ✓ | — |
| `users:read` / `users:manage` | ✓ | — | — |
| `roles:manage` / `permissions:read` / `audit:read` | ✓ | — | — |

Los permisos se asignan **dinámicamente** desde el dashboard (Roles y permisos).

---

## Cumplimiento de Requerimientos (auditoría 48/48)

Ejecuta la auditoría con el stack levantado:

```bash
python3 scripts/compliance-check.py
```

### Requerimientos funcionales

| # | Requisito | Estado | Evidencia |
|---|---|---|---|
| 1 | Registro (Nombre, Email, Contraseña) | ✅ | `POST /auth/register` |
| 1 | Inicio de sesión | ✅ | `POST /auth/login` |
| 1 | Cambio de contraseña | ✅ | `POST /auth/change-password` |
| 1 | Recuperación de contraseña | ✅ | `POST /auth/forgot-password` + MailHog |
| 2 | Tres roles predeterminados | ✅ | `prisma/seed.ts` (Administrador, Editor, Usuario Regular) |
| 2 | Editor crea/edita/elimina contenidos | ✅ | permisos `products:create/update/delete` |
| 2 | Editor no gestiona usuarios/config | ✅ | sin `users:*` ni `roles:manage` → 403 |
| 2 | Usuario Regular solo ve/consume | ✅ | solo `products:read`, `categories:read` |
| 3 | Permisos por acción (lectura/escritura/eliminación) | ✅ | 12 permisos granulares |
| 3 | Asignación dinámica de permisos a roles | ✅ | `PUT /roles/:id/permissions` + UI |
| 4 | Acceso condicionado a páginas/funcionalidades | ✅ | `RequirePermission` (UI) + `PermissionsGuard` (API) |
| 4 | Historial de acceso | ✅ | `audit_logs` con `auth.login.*`, IP, fecha |
| 5 | Dashboard: ver usuarios | ✅ | `GET /users` + `pages/UsersPage` |
| 5 | Dashboard: asignar/revocar roles | ✅ | `PATCH /users/:id/roles` |
| 5 | Dashboard: crear roles y asignar permisos | ✅ | `POST /roles` + `PUT /roles/:id/permissions` |
| 5 | Dashboard: registro de auditoría | ✅ | `GET /audit` + `pages/AuditPage` |
| 6 | Frontend + backend API REST | ✅ | React SPA + NestJS |
| 6 | Frontend consume solo la API (sin BD) | ✅ | `src/api/client.ts` |
| 6 | JWT en encabezado `Authorization: Bearer` | ✅ | interceptor axios/fetch |

### Requerimientos técnicos

| # | Requisito | Estado | Evidencia |
|---|---|---|---|
| 1 | Lenguaje y SMBD a elección | ✅ | TypeScript/NestJS + PostgreSQL 16 |
| 2 | Aplicación web accesible desde navegador | ✅ | https://localhost:8443 |
| 3 | API REST con GET/POST/PUT/DELETE y JSON | ✅ | ver tabla de endpoints |
| 4 | Login devuelve JWT firmado | ✅ | HS256 con `exp` |
| 4 | Peticiones con `Authorization: Bearer` | ✅ | validado en `JwtStrategy` |
| 4 | Backend valida firma, expiración, rol y permisos | ✅ | `JwtAuthGuard` + `PermissionsGuard` |

### Requerimientos de seguridad computacional

| # | Requisito | Estado | Evidencia |
|---|---|---|---|
| 1 | Hash de contraseñas con salt | ✅ | **Argon2id** (`argon2.argon2id`) |
| 2 | Comunicación cifrada HTTPS/TLS | ✅ | nginx **TLS 1.2/1.3** + HSTS `max-age=31536000` |
| 3 | Access token corto (15 min) + refresh token | ✅ | `JWT_ACCESS_TTL=15m`, refresh 7 días rotatorio |
| 3 | Firma HS256 con secreto en variables de entorno | ✅ | `JWT_SECRET` / `JWT_REFRESH_SECRET` en `.env` |
| 3 | JWT no en localStorage; cookies HttpOnly/Secure/SameSite | ✅ | access en memoria; refresh en cookie `HttpOnly; Secure; SameSite=Strict` |
| 4 | Autorización verificada en el servidor | ✅ | cada endpoint exige permiso explícito |
| 5 | Validación y sanitización de entradas | ✅ | `class-validator` + `whitelist`/`forbidNonWhitelisted` + Prisma |
| 5 | Prevención de inyección SQL / XSS | ✅ | consultas parametrizadas Prisma; CSP + React escaping |
| 6 | Anti fuerza bruta (bloqueo temporal) | ✅ | lockout 15 min tras 5 fallos (Redis) |
| 6 | Rate limiting en endpoints de auth | ✅ | `@nestjs/throttler` (login: 10/min) |
| 7 | Auditoría con usuario, fecha, IP y acción | ✅ | `audit_logs` + interceptor en servicios |
| 7 | Registro no modificable desde la app | ✅ | solo `GET /audit`; PUT/PATCH/DELETE → 404 |
| 8 | CORS solo orígenes autorizados | ✅ | `CORS_ORIGIN=https://localhost:8443` |
| 9 | Principio de mínimo privilegio | ✅ | permisos granulares por recurso+acción |
| 10 | Errores sin fuga de información | ✅ | `AllExceptionsFilter` (mensajes genéricos; stack solo en logs) |

---

## Desarrollo local (sin Docker)

```bash
# backend
cd backend && npm install
npx prisma db push && npm run seed
npm run start:dev

# frontend (otra terminal)
cd frontend && npm install
npm run dev   # http://localhost:5173 con proxy a :3000
```

## Pruebas

```bash
cd backend
npm test                  # unitarias (guards, filtro de errores, hash)
npm run test:e2e          # e2e (requiere postgres y redis)
python3 scripts/compliance-check.py   # auditoría de cumplimiento (raíz)
```

## Notas de seguridad operativa

- **Secretos JWT**: la API valida al arrancar que `JWT_SECRET`/`JWT_REFRESH_SECRET` existan, tengan ≥32 caracteres y no sean placeholders; si no, falla el arranque (no hay fallback embebido en el código).
- El cert TLS autofirmado es solo para demo académica; en producción usa una CA pública.
- El bloqueo por intentos fallidos está keyeado por (email, IP): un tercero no puede bloquear una cuenta ajena. Si te bloqueas a ti mismo: `docker compose exec redis redis-cli KEYS 'login:*'` y borra las claves correspondientes.
- El registro devuelve siempre la misma respuesta (202) exista o no el correo, para evitar enumeración de cuentas.
- El registro de auditoría es append-only desde la aplicación; protege el acceso a la BD.
- Los usuarios semilla son solo para demostración: elimínalos o cambia sus contraseñas fuera del aula.


`.env` está en `.gitignore` y **no se sube**: cada quien genera sus secretos con `openssl rand -base64 64`.
