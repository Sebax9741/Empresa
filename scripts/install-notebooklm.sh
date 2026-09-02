#!/usr/bin/env bash
# Instala notebooklm-py (CLI + MCP) de https://github.com/teng-lin/notebooklm-py
#
#   bash scripts/install-notebooklm.sh
#
# Deja disponibles tres ejecutables: notebooklm, notebooklm-mcp, notebooklm-server.
# Requiere Python >= 3.10.
set -euo pipefail

EXTRAS="${NOTEBOOKLM_EXTRAS:-browser,markdown,headless,mcp}"
SPEC="notebooklm-py[${EXTRAS}]"

if command -v uv >/dev/null 2>&1; then
  echo "==> Instalando ${SPEC} con uv tool"
  uv tool install --force "${SPEC}"
elif command -v pipx >/dev/null 2>&1; then
  echo "==> Instalando ${SPEC} con pipx"
  pipx install --force "${SPEC}"
else
  echo "==> uv/pipx no encontrados; instalando ${SPEC} con pip --user"
  python3 -m pip install --user --upgrade "${SPEC}"
fi

# uv y pip --user dejan los binarios aqui
export PATH="${HOME}/.local/bin:${PATH}"

echo
notebooklm --version
echo
notebooklm doctor || true

cat <<'MSG'

Siguiente paso (una sola vez, en una maquina con navegador):

  notebooklm login

Abre una ventana de Chromium para iniciar sesion en tu cuenta de Google y guarda
la sesion en ~/.notebooklm/profiles/default/. Sin ese paso el CLI responde
"not authenticated".
MSG
