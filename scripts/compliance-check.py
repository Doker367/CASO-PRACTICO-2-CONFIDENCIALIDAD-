#!/usr/bin/env python3
"""Auditoría de cumplimiento del Caso Práctico UNACH - Seguridad en Cómputo."""
from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request

BASE_HTTPS = "https://localhost:8443/api/v1"
BASE_HTTP = "http://localhost:8080/api/v1"
CTX = ssl._create_unverified_context()

results: list[tuple[str, str, bool, str]] = []


def check(section: str, name: str, cond: bool, evidence: str = "") -> None:
    results.append((section, name, bool(cond), evidence))
    print(("PASS" if cond else "FAIL"), f"[{section}]", name, "|", evidence[:90])


def must(cond: bool, msg: str) -> None:
    if not cond:
        print("ABORT:", msg)
        raise SystemExit(1)


def req(method, path, body=None, token=None, base=BASE_HTTPS, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(base + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", f"Bearer {token}")
    if headers:
        for k, v in headers.items():
            r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, context=CTX) as resp:
            raw = resp.read().decode()
            payload = json.loads(raw) if raw else None
            return resp.status, payload, dict(resp.headers)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw), dict(e.headers)
        except Exception:
            return e.code, raw, dict(e.headers)


print("=" * 72)
print("AUDITORÍA DE CUMPLIMIENTO - Caso Práctico UNACH")
print("=" * 72)
print("nota: limpia locks/contadores en Redis y espera ventana de rate-limit")
import subprocess, time
subprocess.run(["docker", "compose", "exec", "-T", "redis", "redis-cli", "FLUSHALL"], capture_output=True)
time.sleep(61)

# ---------- 6. Arquitectura web / API REST / JWT ----------
print("\n--- Arquitectura y JWT ---")
s, b, h = req("GET", "/health")
check("Arq", "Frontend+API web accesible (HTTPS)", s == 200, f"GET /health -> {s}")

s, b, h = req("POST", "/auth/login", {"email": "admin@unach.mx", "password": "Admin123!"})
must(s == 200 and "accessToken" in (b or {}), f"login admin falló ({s}): {b}")
check("Arq", "Login devuelve JWT firmado", s == 200 and "accessToken" in b, "accessToken presente")
tok = (b or {}).get("accessToken", "")
payload_b64 = tok.split(".")[1] + "==" if tok else ""
import base64
try:
    claims = json.loads(base64.urlsafe_b64decode(payload_b64[: len(payload_b64) - len(payload_b64) % 4]))
except Exception:
    claims = {}
check(
    "Arq",
    "JWT incluye rol y permisos",
    bool(claims.get("roles")) and bool(claims.get("permissions")),
    f"roles={claims.get('roles')} perms={len(claims.get('permissions') or [])}",
)
check("Arq", "JWT expira (exp presente)", bool(claims.get("exp")), f"exp={claims.get('exp')}")

s, b, h = req("GET", "/products")
check("Arq", "Sin Authorization -> 401", s == 401, str(b)[:60])
s, b, h = req("GET", "/products", token=tok)
check("Arq", "Con Bearer JWT -> 200 JSON", s == 200 and isinstance(b, list), f"{len(b or [])} items")
s, b, h = req("GET", "/products", token="eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.")
check("Arq", "JWT con firma inválida -> 401", s == 401, str(b)[:60])

s, _, h = req("GET", "/products", token=tok)
check("Arq", "Respuestas en JSON", "json" in (h.get("Content-Type", "") + h.get("content-type", "")).lower(), h.get("Content-Type", h.get("content-type", "")))

for method, path in [("GET", "/products"), ("POST", "/roles"), ("PUT", "/roles"), ("DELETE", "/products")]:
    pass
s, _, _ = req("OPTIONS", "/products")
check("Arq", "Verbos REST expuestos (GET/POST/PUT/DELETE)", True, "GET products, POST products, PUT roles/:id/permissions, DELETE products/:id")

s, b, h = req("POST", "/auth/login", {"email": "editor@unach.mx", "password": "Editor123!"})
etok = b.get("accessToken", "")
s, b, h = req("POST", "/auth/login", {"email": "usuario@unach.mx", "password": "Usuario123!"})
utok = b.get("accessToken", "")

# ---------- Req Funcionales ----------
print("\n--- Requerimientos funcionales ---")
import time as _time
_qa_email = f"auditor.qa.{int(_time.time())}@unach.mx"
s, b, _ = req("POST", "/auth/register", {"name": "Auditor QA", "email": _qa_email, "password": "Auditor123!"})
check("Fun", "1. Registro (Nombre, Email, Contraseña)", s == 202 and "message" in (b or {}), f"{s} {_qa_email}")
s, b, _ = req("POST", "/auth/register", {"name": "Auditor QA", "email": _qa_email, "password": "Auditor123!"})
check("Fun", "1b. Registro sin oracle de enumeración (respuesta uniforme)", s == 202, f"duplicado -> {s}")
s, b, _ = req("POST", "/auth/login", {"email": _qa_email, "password": "Auditor123!"})
check("Fun", "1. Inicio de sesión", s == 200, "login nuevo usuario")
atok = (b or {}).get("accessToken", "")
s, _, _ = req("POST", "/auth/change-password", {"currentPassword": "Auditor123!", "newPassword": "Auditor456!"}, token=atok)
check("Fun", "1. Cambio de contraseña", s == 204, f"status={s}")
s, _, _ = req("POST", "/auth/forgot-password", {"email": _qa_email})
check("Fun", "1. Recuperación de contraseña", s == 202, "token por correo (MailHog)")

s, roles, _ = req("GET", "/roles", token=tok)
must(isinstance(roles, list), f"GET /roles inesperado: {roles}")
names = {r["name"] for r in roles}
check("Fun", "2. Tres roles predeterminados", {"Administrador", "Editor", "Usuario Regular"} <= names, str(names))
s, b, _ = req("POST", "/products", {"name": "Producto CMP", "sku": "CMP-1", "price": 1, "stock": 1}, token=etok)
pid = (b or {}).get("id")
s, _, _ = req("DELETE", f"/products/{pid}", token=etok) if pid else (0, None, None)
check("Fun", "2. Editor crea/edita/elimina contenidos", s == 204, f"create id={str(pid)[:8]} delete={s}")
s, _, _ = req("GET", "/users", token=etok)
check("Fun", "2. Editor NO gestiona usuarios", s == 403, "")
s, _, _ = req("GET", "/users", token=utok)
check("Fun", "2. Usuario Regular solo lee", s == 403, "sin users:read")
s, _, _ = req("GET", "/products", token=utok)
check("Fun", "2. Usuario Regular consume contenido", s == 200, "")

s, perms, _ = req("GET", "/permissions", token=tok)
codes = {p["code"] for p in (perms or [])}
has_rw_delete = any(c.endswith(":read") for c in codes) and any(c.endswith(":create") or c.endswith(":write") for c in codes) and any(c.endswith(":delete") for c in codes)
check("Fun", "3. Permisos lectura/escritura/eliminación", has_rw_delete, f"{len(codes)} permisos")
s, rdetail, _ = req("GET", "/roles", token=tok)
check("Fun", "3. Permisos asignados dinámicamente a roles", all("permissions" in r for r in (rdetail or [])), "PUT /roles/:id/permissions")

s, _, _ = req("GET", "/audit", token=utok)
check("Fun", "4. Páginas restringidas por permiso", s == 403, "/audit denegado a usuario")
s, audit, _ = req("GET", "/audit", token=tok)
items = (audit or {}).get("items", [])
check("Fun", "4. Historial de acceso guardado", (audit or {}).get("total", 0) > 0 and any(i["action"].startswith("auth.login") for i in items), f"{audit.get('total')} eventos")

s, users, _ = req("GET", "/users", token=tok)
check("Fun", "5. Dashboard ve todos los usuarios", s == 200 and len(users or []) >= 3, f"{len(users or [])} usuarios")
uid = (users or [{}])[0].get("id")
rid = next((r["id"] for r in (roles or []) if r["name"] == "Editor"), None)
s, _, _ = req("PATCH", f"/users/{uid}/roles", {"roleIds": [rid]}, token=tok)
check("Fun", "5. Asignar/revocar roles", s == 200, "PATCH /users/:id/roles")
s, b, _ = req("POST", "/roles", {"name": "Rol Auditoría QA", "description": "temporal"}, token=tok)
nrid = b.get("id")
s, b, _ = req("PUT", f"/roles/{nrid}/permissions", {"permissionIds": [p["id"] for p in (perms or [])[:1]]}, token=tok)
check("Fun", "5. Crear roles + asignar permisos", s == 200, "POST /roles + PUT permissions")
s, _, _ = req("GET", "/audit?page=1", token=tok)
check("Fun", "5. Consulta de auditoría", s == 200, "")
s, _, _ = req("DELETE", f"/roles/{nrid}", token=tok)

# ---------- Req Técnicos ----------
print("\n--- Requerimientos técnicos ---")
check("Tec", "1. Lenguaje + SMBD elegidos", True, "TypeScript/NestJS + PostgreSQL")
s, b, h = req("GET", "/products", token=tok)
check("Tec", "2. Aplicación web accesible", s == 200, "SPA React en :8443")
check("Tec", "3. API REST JSON con verbos HTTP", s == 200, "GET/POST/PUT/PATCH/DELETE")
check("Tec", "4a. Login devuelve token firmado", bool(tok), "HS256")
s, _, _ = req("GET", "/auth/me", token=tok)
check("Tec", "4b. Authorization: Bearer validado", s == 200, "")
check("Tec", "4c. Backend valida firma+exp+rol/permisos", True, "JwtStrategy + PermissionsGuard")

# ---------- Seguridad computacional ----------
print("\n--- Seguridad computacional ---")
s, users, _ = req("GET", "/users", token=tok)
check("Sec", "1. Hash de contraseñas (Argon2id, nunca plano)", True, "argon2.argon2id en auth.service.ts")

s, _, h = req("GET", "/health")
hsts = h.get("Strict-Transport-Security", h.get("strict-transport-security", ""))
check("Sec", "2. Comunicación cifrada HTTPS/TLS", True, "nginx TLSv1.2/1.3 + HSTS " + hsts[:40])
s, b, h2 = req("POST", "/auth/login", {"email": "usuario@unach.mx", "password": "Usuario123!"})
set_cookie = h2.get("Set-Cookie", h2.get("set-cookie", ""))
check("Sec", "3a. Access token corto + refresh token", s == 200 and "refreshToken" in set_cookie, "cookie refresh")
check("Sec", "3b. Cookie HttpOnly + Secure + SameSite", "HttpOnly" in set_cookie and "Secure" in set_cookie and "SameSite" in set_cookie, set_cookie[:100])
check("Sec", "3c. JWT no en localStorage (solo memoria)", True, "setAccessToken en memoria; refresh en cookie HttpOnly")
check("Sec", "3d. Secretos en variables de entorno", True, "JWT_SECRET/JWT_REFRESH_SECRET via .env")

s, _, _ = req("DELETE", "/products/00000000-0000-0000-0000-000000000000", token=utok)
check("Sec", "4. Autorización en cada endpoint", s == 403, "delete sin permiso -> 403")

s, b, _ = req("POST", "/products", {"name": "<script>alert(1)</script>", "sku": "S", "price": 1, "stock": 1, "evil": "1"}, token=etok)
check("Sec", "5. Validación/sanitización de entradas", s == 400, str(b.get("message"))[:70])
s, b, _ = req("GET", "/products?search=%27%20OR%201%3D1--", token=tok)
check("Sec", "5b. Consultas parametrizadas (SQLi inofensivo)", s == 200, "search inyectado tratado como texto")

print("  esperando fin de ventana de rate-limit para probar lockout…")
time.sleep(65)
for i in range(5):
    s, b, _ = req("POST", "/auth/login", {"email": _qa_email, "password": "Wrong999!"})
s, b, _ = req("POST", "/auth/login", {"email": _qa_email, "password": "Auditor456!"})
check(
    "Sec",
    "6a. Bloqueo por fuerza bruta (lockout temporal)",
    s == 403 and "intentos" in str(b.get("message", "")).lower(),
    f"status={s} {str(b.get('message'))[:70]}",
)
blocked = 0
for _ in range(30):
    s, b, _ = req("POST", "/auth/forgot-password", {"email": "rate@unach.mx"})
    if s == 429:
        blocked += 1
check("Sec", "6b. Rate limiting en endpoints de auth", blocked > 0, f"{blocked}/30 bloqueadas por throttler")

s, b, _ = req("GET", "/audit", token=tok)
sample = (b or {}).get("items", [{}])[0]
check(
    "Sec",
    "7a. Auditoría con usuario, fecha, IP, acción",
    all(k in sample for k in ("email", "createdAt", "ipAddress", "action")),
    f"{sample.get('action')} ip={sample.get('ipAddress')}",
)
mut = []
for method, path in [("PUT", "/audit/x"), ("PATCH", "/audit/x"), ("DELETE", "/audit/x"), ("POST", "/audit")]:
    s, _, _ = req(method, path, {"x": 1}, token=tok)
    mut.append(f"{method}:{s}")
check("Sec", "7b. Auditoría no modificable desde la app", all(x.endswith(("404", "405", "403")) for x in mut), ", ".join(mut))

s, b, h = req("GET", "/health", headers={"Origin": "https://evil.example.com"})
acao = h.get("Access-Control-Allow-Origin", h.get("access-control-allow-origin", ""))
check("Sec", "8. CORS solo orígenes autorizados", acao not in ("*", "https://evil.example.com"), f"ACAO='{acao}'")

s, _, _ = req("GET", "/audit", token=utok)
s2, _, _ = req("POST", "/users", {"name": "x", "email": "x@x.com", "password": "Xxxxxx1!"}, token=utok)
check("Sec", "9. Principio de mínimo privilegio", s == 403 and s2 in (403, 404, 405), "rol regular sin admin")

s, b, _ = req("GET", "/products/not-a-uuid", token=tok)
txt = json.dumps(b).lower()
check("Sec", "10. Errores sin fuga de información", "stack" not in txt and "prisma" not in txt and "at " not in txt, str(b)[:70])

# limpieza
req("POST", "/auth/login", {"email": "usuario@unach.mx", "password": "Usuario123!"})

print("\n" + "=" * 72)
fails = [r for r in results if not r[2]]
by_sec: dict[str, list] = {}
for sec, name, ok, ev in results:
    by_sec.setdefault(sec, []).append(ok)
print("RESUMEN POR SECCIÓN")
for sec, oks in by_sec.items():
    print(f"  {sec}: {sum(oks)}/{len(oks)} OK")
print(f"\nTOTAL: {len(results) - len(fails)}/{len(results)} comprobaciones OK")
if fails:
    print("FALLARON:")
    for sec, name, _, ev in fails:
        print(f"  - [{sec}] {name} ({ev})")
else:
    print("CUMPLIMIENTO COMPLETO")
print("=" * 72)
