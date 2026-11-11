#!/usr/bin/env bash
# Demostración de extremo a extremo del segundo factor (2FA) por correo.
#
# Uso:
#   ./scripts/two-factor-demo.sh
#   EMAIL=2fa@unach.mx PASSWORD='Doble123!' ./scripts/two-factor-demo.sh
#
# Requiere: curl, python3. El código se lee de MailHog (bandeja de demo).
# Si el usuario aún no tiene 2FA activo, el script lo activa y vuelve a entrar.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CURL="curl -skS"

EMAIL="${EMAIL:-2fa@unach.mx}"
PASSWORD="${PASSWORD:-Doble123!}"

if [[ -z "${API_URL:-}" ]]; then
  if curl -sk --max-time 2 https://localhost:8443/api/health >/dev/null 2>&1; then
    API_URL="https://localhost:8443/api/v1"
  else
    API_URL="http://localhost:3000/api/v1"
  fi
fi

# MailHog: el stack Docker publica 8026; en desarrollo local suele ser 8025.
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

# Espera a que llegue el correo y extrae el código de 6 dígitos del cuerpo.
latest_code() {
  local attempts=0
  local code=""
  while [[ $attempts -lt 20 ]]; do
    code=$(curl -s "$MAILHOG_URL/api/v2/messages" 2>/dev/null | python3 -c '
import json, re, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for item in data.get("items", []):
    body = item.get("Content", {}).get("Body", "")
    m = re.search(r"es:\s*(\d{6})", body)
    if m:
        print(m.group(1))
        break
' 2>/dev/null || true)
    if [[ -n "$code" ]]; then
      echo "$code"
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  echo "No se encontró el correo con el código. Revisa MailHog en $MAILHOG_URL" >&2
  return 1
}

login() {
  $CURL -X POST "$API_URL/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
}

echo "== 1. Limpieza de la bandeja de MailHog ==============================="
clear_mailbox
echo "Bandeja vacía en $MAILHOG_URL"

echo
echo "== 2. Login con correo y contraseña ==================================="
INITIAL=$(login)
MFA_REQUIRED=$(echo "$INITIAL" | json 'd.get("mfaRequired", False)')

if [[ "$MFA_REQUIRED" == "False" ]]; then
  echo "El usuario aún no tiene 2FA. Se activará ahora."
  TOKEN=$(echo "$INITIAL" | json 'd["accessToken"]')

  echo
  echo "== Activación: la API envía un código al correo ======================="
  $CURL -X POST "$API_URL/auth/2fa/setup" \
    -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
  SETUP_CODE=$(latest_code)
  echo "Código recibido en el correo: $SETUP_CODE"

  $CURL -X POST "$API_URL/auth/2fa/confirm" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"code\":\"$SETUP_CODE\"}" | python3 -m json.tool

  echo
  echo "== Nuevo login: la contraseña ya no basta ============================="
  INITIAL=$(login)
else
  echo "El usuario ya tiene 2FA activo."
fi

echo
echo "== Reto de segundo factor (sin sesión todavía) ========================"
echo "$INITIAL" | python3 -c '
import json, sys
d = json.load(sys.stdin)
print("mfaRequired :", d.get("mfaRequired"))
print("correo      :", d.get("email"))
print("vence en    :", d.get("expiresInSeconds"), "segundos")
print("challenge   :", d.get("challengeToken", "")[:16] + "…")
'

CHALLENGE=$(echo "$INITIAL" | json 'd["challengeToken"]')
CODE=$(latest_code)

echo
echo "== El código llegó por correo (MailHog) ==============================="
curl -s "$MAILHOG_URL/api/v2/messages" | python3 -c '
import email.header, json, quopri, sys
data = json.load(sys.stdin)
print("Mensajes en la bandeja:", data.get("total"))
if data.get("items"):
    item = data["items"][0]
    print("Para:", ", ".join(t.get("Mailbox", "") + "@" + t.get("Domain", "") for t in item.get("To", [])))
    raw_subject = " ".join(item.get("Content", {}).get("Headers", {}).get("Subject", ["(sin asunto)"]))
    parts = email.header.decode_header(raw_subject)
    print("Asunto:", "".join(p.decode(c or "utf-8") if isinstance(p, bytes) else p for p, c in parts))
    body = quopri.decodestring(item.get("Content", {}).get("Body", "")).decode("utf-8", "replace")
    for line in body.splitlines():
        if "digo de verificaci" in line or "es:" in line:
            print("  ", line.strip())
'
echo "Código detectado: $CODE"

echo
echo "== Un código incorrecto es rechazado =================================="
WRONG=$(printf '%06d' $(( (10#$CODE + 1) % 1000000 )))
$CURL -X POST "$API_URL/auth/2fa/verify" \
  -H 'Content-Type: application/json' \
  -d "{\"challengeToken\":\"$CHALLENGE\",\"code\":\"$WRONG\"}" \
  -w '\nHTTP %{http_code}\n' || true

echo
echo "== El código correcto emite la sesión ================================="
VERIFIED=$($CURL -X POST "$API_URL/auth/2fa/verify" \
  -H 'Content-Type: application/json' \
  -d "{\"challengeToken\":\"$CHALLENGE\",\"code\":\"$CODE\"}")

echo "$VERIFIED" | python3 -c '
import base64, json, sys
d = json.load(sys.stdin)
token = d.get("accessToken", "")
parts = token.split(".")
print("accessToken :", (token[:24] + "…") if token else "(vacío)")
print("usuario     :", d.get("user", {}).get("email"))
print("roles       :", ", ".join(d.get("user", {}).get("roles", [])))
if len(parts) == 3:
    payload = parts[1] + "=" * (-len(parts[1]) % 4)
    claims = json.loads(base64.urlsafe_b64decode(payload))
    print("JWT typ     :", claims.get("typ"), "| exp:", claims.get("exp"))
'

echo
echo "2FA verificado. El código quedó consumido:"
$CURL -X POST "$API_URL/auth/2fa/verify" \
  -H 'Content-Type: application/json' \
  -d "{\"challengeToken\":\"$CHALLENGE\",\"code\":\"$CODE\"}" \
  -w '\nHTTP %{http_code}\n' || true

echo
echo "Listo. Revisa los correos en $MAILHOG_URL"
echo "Para desactivar 2FA: Mi cuenta -> Verificación en dos pasos."
