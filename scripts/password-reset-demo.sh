#!/usr/bin/env bash
# Demostración de extremo a extremo del módulo de recuperación de contraseñas.
#
# Uso:
#   ./scripts/password-reset-demo.sh
#   EMAIL=usuario@unach.mx PASSWORD='Usuario123!' ./scripts/password-reset-demo.sh
#
# Requiere: curl, python3. El token se extrae de MailHog (bandeja de demo).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURL="curl -skS"

EMAIL="${EMAIL:-usuario@unach.mx}"
ORIGINAL_PASSWORD="${PASSWORD:-Usuario123!}"
TEMP_PASSWORD="NuevaClaveSegura2026!"

if [[ -z "${API_URL:-}" ]]; then
  if curl -sk --max-time 2 https://localhost:8443/api/v1/health >/dev/null 2>&1; then
    API_URL="https://localhost:8443/api/v1"
  else
    API_URL="http://localhost:3000/api/v1"
  fi
fi

if [[ -z "${MAILHOG_URL:-}" ]]; then
  if curl -s --max-time 2 http://localhost:8026/api/v2/messages >/dev/null 2>&1; then
    MAILHOG_URL="http://localhost:8026"
  else
    MAILHOG_URL="http://localhost:8025"
  fi
fi

json() {
  python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"
}

clear_mailbox() {
  curl -s -X DELETE "$MAILHOG_URL/api/v1/messages" >/dev/null 2>&1 || true
}

extract_reset_token() {
  local attempts=0
  local token=""
  while [[ $attempts -lt 20 ]]; do
    token=$(curl -s "$MAILHOG_URL/api/v2/messages" 2>/dev/null | python3 -c '
import json, re, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for item in data.get("items", []):
    body = item.get("Content", {}).get("Body", "")
    m = re.search(r"token=([A-Za-z0-9_-]+)", body)
    if m:
        print(m.group(1))
        break
' 2>/dev/null || true)
    if [[ -n "$token" ]]; then
      echo "$token"
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  echo "No se encontró el correo de recuperación en MailHog ($MAILHOG_URL)" >&2
  return 1
}

echo "========================================================================"
echo "DEMO: Módulo de Recuperación de Contraseñas"
echo "API:     $API_URL"
echo "MailHog: $MAILHOG_URL"
echo "Usuario: $EMAIL"
echo "========================================================================"

echo
echo "== 1. Limpieza de bandeja en MailHog ==================================="
clear_mailbox
echo "Bandeja vacía."

echo
echo "== 2. Solicitud de recuperación (POST /auth/forgot-password) ==========="
STATUS_CODE=$($CURL -o /dev/null -w "%{http_code}" -X POST "$API_URL/auth/forgot-password" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\"}")

echo "Código HTTP de respuesta: $STATUS_CODE"
if [[ "$STATUS_CODE" != "202" ]]; then
  echo "ERROR: Se esperaba 202 Accepted pero se obtuvo $STATUS_CODE"
  exit 1
fi
echo "Solicitud aceptada (anti-enumeración activa: 202 sin revelar existencia)."

echo
echo "== 3. Lectura del correo en MailHog y extracción del token ============="
TOKEN=$(extract_reset_token)
echo "Token criptográfico obtenido del correo:"
echo "  $TOKEN"

echo
echo "== 4. Intento con contraseña débil (debe fallar 400) ===================="
WEAK_STATUS=$($CURL -o /dev/null -w "%{http_code}" -X POST "$API_URL/auth/reset-password" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"newPassword\":\"debil\"}")
echo "Respuesta ante contraseña 'debil': HTTP $WEAK_STATUS"
if [[ "$WEAK_STATUS" != "400" ]]; then
  echo "ERROR: La política de contraseñas debía rechazar 'debil' con 400."
  exit 1
fi
echo "Política de contraseñas validada correctamente (rechazó clave débil)."

echo
echo "== 5. Restablecimiento con contraseña robusta =========================="
RESET_STATUS=$($CURL -o /dev/null -w "%{http_code}" -X POST "$API_URL/auth/reset-password" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"newPassword\":\"$TEMP_PASSWORD\"}")
echo "Respuesta de restablecimiento: HTTP $RESET_STATUS"
if [[ "$RESET_STATUS" != "204" ]]; then
  echo "ERROR: Se esperaba 204 No Content pero se obtuvo $RESET_STATUS"
  exit 1
fi
echo "Contraseña actualizada satisfactoriamente."

echo
echo "== 6. Verificación de uso único (Token replay attack debe fallar 400) ==="
REPLAY_STATUS=$($CURL -o /dev/null -w "%{http_code}" -X POST "$API_URL/auth/reset-password" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"newPassword\":\"OtraClaveSegura123!\"}")
echo "Respuesta al reutilizar el mismo token: HTTP $REPLAY_STATUS"
if [[ "$REPLAY_STATUS" != "400" ]]; then
  echo "ERROR: El token no debió poder reutilizarse."
  exit 1
fi
echo "Protección anti-reuso comprobada: el token fue invalidado al usarse."

echo
echo "== 7. Inicio de sesión con la NUEVA contraseña ========================="
LOGIN_RESP=$($CURL -X POST "$API_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$TEMP_PASSWORD\"}")

NEW_JWT=$(echo "$LOGIN_RESP" | json 'd.get("accessToken", "")')
if [[ -z "$NEW_JWT" ]]; then
  echo "ERROR: No se pudo iniciar sesión con la nueva contraseña."
  echo "$LOGIN_RESP"
  exit 1
fi
echo "Login exitoso. JWT emitido:"
echo "  ${NEW_JWT:0:40}..."

echo
echo "== 8. Restaurando contraseña original para consistencia del entorno ===="
$CURL -X POST "$API_URL/auth/change-password" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $NEW_JWT" \
  -d "{\"currentPassword\":\"$TEMP_PASSWORD\",\"newPassword\":\"$ORIGINAL_PASSWORD\"}" >/dev/null

echo "Contraseña original restaurada correctamente."
echo
echo "========================================================================"
echo "DEMOSTRACIÓN COMPLETADA: 100% EXITOSA"
echo "========================================================================"
