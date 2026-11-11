#!/usr/bin/env bash
# Demostración de extremo a extremo del cifrado simétrico y la firma digital.
#
# Uso:
#   ./scripts/crypto-demo.sh
#   API_URL=https://localhost:8443/api/v1 EMAIL=usuario@unach.mx \
#     PASSWORD='Usuario123!' ./scripts/crypto-demo.sh
#
# Requiere: curl, python3. Detecta el stack de Docker Compose o un API local y
# muestra la fila real de PostgreSQL (psql local si DATABASE_URL está definido,
# o docker compose exec postgres cuando corre en contenedores).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Detecta el stack: Docker (HTTPS :8443) o desarrollo local (HTTP :3000).
if [[ -z "${API_URL:-}" ]]; then
  if curl -sk --max-time 2 https://localhost:8443/api/health >/dev/null 2>&1; then
    API_URL="https://localhost:8443/api/v1"
  else
    API_URL="http://localhost:3000/api/v1"
  fi
fi
EMAIL="${EMAIL:-usuario@unach.mx}"
PASSWORD="${PASSWORD:-Usuario123!}"
TITLE="${TITLE:-Demo de cifrado $(date +%H:%M:%S)}"
BODY="${BODY:-usuario: admin-srv / contraseña: S3cr3t!2026}"
CURL="curl -skS"

json() { python3 -c "$1"; }

echo "== 1. Login ==========================================================="
LOGIN=$($CURL -X POST "$API_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(printf '%s' "$LOGIN" | json 'import json,sys; print(json.load(sys.stdin)["accessToken"])')
printf 'Token JWT obtenido (%s caracteres)\n\n' "${#TOKEN}"

echo "== 2. Texto claro que captura el usuario =============================="
printf '%s\n\n' "$BODY"

echo "== 3. POST /secure-notes: la API cifra y firma antes de guardar ========"
NOTE=$($CURL -X POST "$API_URL/secure-notes" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$(TITLE="$TITLE" BODY="$BODY" python3 -c 'import json,os; print(json.dumps({"title":os.environ["TITLE"],"body":os.environ["BODY"]}))')")
NOTE_ID=$(printf '%s' "$NOTE" | json 'import json,sys; print(json.load(sys.stdin)["id"])')
printf '%s' "$NOTE" | json '
import json,sys
d=json.load(sys.stdin)
print("id:              ", d["id"])
print("Lo que ve el usuario (descifrado):")
print("  ", repr(d["body"]))
print("Lo que se guarda en PostgreSQL (body_encrypted):")
print("  ", d["stored"]["value"])
print("Firma RSA-PSS válida:", d["signature"]["valid"])
print()
'

echo "== 4. GET /secure-notes: se lee de PostgreSQL y se descifra ============"
$CURL "$API_URL/secure-notes/$NOTE_ID" -H "Authorization: Bearer $TOKEN" | json '
import json,sys
d=json.load(sys.stdin)
print("Cuerpo descifrado:", repr(d["body"]))
print("Estado:", d["status"], "| firma válida:", d["signature"]["valid"])
print()
'

echo "== 5. GET /secure-notes/:id/verify: verificación con la llave pública =="
$CURL "$API_URL/secure-notes/$NOTE_ID/verify" -H "Authorization: Bearer $TOKEN" | json '
import json,sys
d=json.load(sys.stdin)
print(json.dumps(d, ensure_ascii=False, indent=2))
print()
'

echo "== 6. Fila real en PostgreSQL =========================================="
if [[ -n "${DATABASE_URL:-}" ]] && command -v psql >/dev/null 2>&1; then
  # psql no entiende el parámetro ?schema=public de Prisma.
  PSQL_URL="${DATABASE_URL%%\?*}"
  psql "$PSQL_URL" -x -c \
    "SELECT id, title, body_encrypted, left(signature, 48) AS firma_rsa_pss, encryption_key_id, signing_key_id FROM secure_notes WHERE id = '$NOTE_ID';"
elif command -v docker >/dev/null 2>&1 && \
     docker compose -f "$REPO_ROOT/docker-compose.yml" ps postgres --status running -q 2>/dev/null | grep -q .; then
  # Stack de Docker Compose: consulta el contenedor de PostgreSQL.
  docker compose -f "$REPO_ROOT/docker-compose.yml" exec -T postgres \
    psql -U "${POSTGRES_USER:-rbac_user}" -d "${POSTGRES_DB:-rbac_app}" -x -c \
    "SELECT id, title, body_encrypted, left(signature, 48) AS firma_rsa_pss, encryption_key_id, signing_key_id FROM secure_notes WHERE id = '$NOTE_ID';"
else
  echo "No se detectó PostgreSQL local ni el stack de Docker Compose."
  echo "Puedes ver la fila directamente con:"
  echo "  docker compose exec postgres psql -U rbac_user -d rbac_app \\"
  echo "    -c \"SELECT body_encrypted FROM secure_notes WHERE id = '$NOTE_ID';\""
fi

echo
echo "Nota de prueba creada: $NOTE_ID"
echo "Para eliminarla:"
echo "  curl -X DELETE '$API_URL/secure-notes/$NOTE_ID' -H 'Authorization: Bearer <token>'"
