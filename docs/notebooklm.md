# notebooklm-py

Librería y CLI no oficial para automatizar Google NotebookLM (hoy *Gemini
Notebook*): <https://github.com/teng-lin/notebooklm-py> · MIT · v0.8.1

> Usa APIs internas de Google no documentadas. Puede romperse sin aviso; no está
> afiliada a Google. Sirve para prototipos, investigación y uso personal.

## Instalación

```bash
bash scripts/install-notebooklm.sh
```

El script usa `uv tool install` (o `pipx`, o `pip --user` como último recurso) e
instala el paquete con los extras `browser,markdown,headless,mcp`. Para cambiarlos:

```bash
NOTEBOOKLM_EXTRAS="browser,mcp" bash scripts/install-notebooklm.sh
```

Extras disponibles: `browser` (login con Playwright), `markdown`, `headless`
(re-auth sin navegador), `mcp` (servidor MCP), `server` (API REST), `cookies`,
`android`, `impersonate`, `all`.

Deja tres ejecutables en `~/.local/bin`: `notebooklm`, `notebooklm-mcp` y
`notebooklm-server`. Requiere Python ≥ 3.10.

## Autenticación

```bash
notebooklm login      # abre un navegador y guarda la sesión de Google
notebooklm doctor     # verifica perfil, auth y migración
```

La sesión queda en `~/.notebooklm/profiles/default/storage_state.json`. Es una
credencial de tu cuenta de Google: no la subas al repo.

## Uso básico

```bash
notebooklm list                          # listar notebooks
notebooklm create "Control de créditos"  # crear
notebooklm use abc123                    # fijar el notebook activo
notebooklm source add https://ejemplo.com/doc.pdf
notebooklm ask "¿Qué reglas de mora aplican?" --json
notebooklm generate audio --wait         # podcast del notebook
notebooklm download report --all
```

Referencia completa: [CLI](https://github.com/teng-lin/notebooklm-py/blob/main/docs/cli-reference.md)
· [API Python](https://github.com/teng-lin/notebooklm-py/blob/main/docs/python-api.md)

## Servidor MCP (Claude Code / Claude Desktop)

Para exponer NotebookLM como herramientas de un agente, crear `.mcp.json` en la
raíz del proyecto:

```json
{
  "mcpServers": {
    "notebooklm": {
      "command": "notebooklm-mcp",
      "args": ["--transport", "stdio"]
    }
  }
}
```

Requiere el extra `mcp` y haber hecho `notebooklm login` antes.
