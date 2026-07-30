---
name: Control de Créditos
description: Panel operativo para llevar el crédito de Importadora Nueva Vista S.A.C.
colors:
  primary: "#0f766e"
  primary-dark: "#0b5450"
  primary-light: "#e2f3f1"
  danger: "#c0392b"
  danger-light: "#f8e6e3"
  warning: "#a3690f"
  warning-light: "#f7ecd8"
  ok: "#16a34a"
  ok-light: "#e0f5e7"
  neutral-bg: "#f1f5f5"
  neutral-bg-tint: "#e6edec"
  neutral-card: "#ffffff"
  neutral-text: "#1e2a2e"
  neutral-muted: "#5b6b74"
  neutral-gray: "#8b96a1"
  neutral-border: "#dde6e5"
typography:
  body:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "{typography.body.fontFamily}"
    fontWeight: 600
    letterSpacing: "0.05em"
rounded:
  sm: "13px"
  md: "20px"
  pill: "999px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "0.6rem 1.15rem"
  button-primary-hover:
    backgroundColor: "{colors.primary-dark}"
---

# Design System: Control de Créditos

## Overview

**Creative North Star: "El mostrador de confianza"**

Una herramienta de trabajo, no una vitrina: la prioridad es que el administrador y sus cobradores lean cifras de dinero rápido, sin dudar, en una tablet al sol o en un escritorio. La paleta anterior (verde oliva apagado, sin tipografía real) funcionaba pero se sentía genérica y sin cuidar. Este refresco mantiene exactamente la misma estructura, jerarquía y funciones — nada de lo que el equipo ya sabe usar cambió — y solo renueva la piel: un acento teal profesional en vez de oliva, neutros fríos en vez de cálidos apagados, y una tipografía propia (autoalojada, funciona sin internet) en vez del system-font por defecto.

Rechazado explícitamente: cualquier combinación crema + terracota (la paleta "IA genérica" más repetida); cualquier invención de nuevas pantallas, componentes o flujos.

**Key Characteristics:**
- Restrained: un solo acento (teal) usado con moderación — cifras clave, botón principal, foco, selección.
- Neutros fríos y limpios en vez de los grises con tinte cálido de antes.
- Una sola familia tipográfica en toda la app (cabeceras, botones, tablas, montos).
- Bastante redondeado: tarjetas, inputs y modales con esquinas suaves; botones siempre en píldora.

## Colors

Paleta restringida: neutros + un acento. El acento es el único color con presencia de marca; los semánticos (peligro/aviso/éxito) existen para estado, no para decorar.

### Primary
- **Teal profesional** (`#0f766e`): botón principal, enlaces, foco de inputs, cifras destacadas (saldo, código de cliente/hoja), selección activa en listas. Coincide con el color ya usado en el ícono/manifest de la app.

### Neutral
- **Niebla fría** (`#f1f5f5`): fondo general de la app.
- **Niebla fría, un paso más oscura** (`#e6edec`): fondo de cabeceras de tabla, franjas alternas, chips neutros.
- **Blanco** (`#ffffff`): tarjetas, modales, inputs.
- **Grafito frío** (`#1e2a2e`): texto principal.
- **Pizarra** (`#5b6b74`): texto secundario/etiquetas (`--muted`).
- **Niebla media** (`#8b96a1`): texto terciario, fechas y ayudas (`--gray`).
- **Borde niebla** (`#dde6e5`): bordes de tarjetas, inputs, separadores.

### Semantic (estado, no marca)
- **Rojo ladrillo** (`#c0392b`): vencido, borrar, error.
- **Ámbar** (`#a3690f`): pendiente, aviso.
- **Verde hoja** (`#16a34a`): pagado, éxito — deliberadamente más verde-puro que el teal del acento para no confundirse con él.

### Named Rules
**La Regla del Acento Único.** El teal solo aparece en la acción principal, cifras que importa destacar y estados de foco/selección — nunca como fondo decorativo de secciones enteras.

## Typography

**Body/Display Font:** Plus Jakarta Sans (variable, 200–800), autoalojada en `css/fonts/PlusJakartaSans-Variable.woff2` — sin dependencia de red, funciona sin internet.

**Character:** Geométrica pero cálida, terminaciones ligeramente redondeadas — se siente amigable sin perder seriedad para leer montos y tablas densas.

### Hierarchy
- **Título de encabezado** (700, 1.1rem): nombre de la app.
- **Título de tarjeta/modal** (700–800, 1.02–1.45rem, letter-spacing negativo leve): nombres de cliente, títulos de modal.
- **Body** (400, 0.9–0.95rem): texto general, inputs.
- **Label** (600, 0.72–0.82rem, mayúsculas, letter-spacing 0.05em): encabezados de tabla, etiquetas de campo.
- **Cifras** (700, tabular-nums): montos y saldos — se mantiene el `font-variant-numeric: tabular-nums` ya existente para que las columnas de dinero alineen.

### Named Rules
**La Regla de la Única Familia.** Toda la interfaz usa Plus Jakarta Sans; no hay una tipografía "de marca" separada de la tipografía "de datos". El peso y el tamaño marcan la jerarquía, no un cambio de fuente.

## Layout

Sin cambios: la grilla de resumen (`auto-fit, minmax(140px,1fr)`), la tabla en escritorio y las tarjetas apiladas en celular (`@media max-width: 760px`) siguen igual. El único ajuste de layout es cosmético: los radios de esquina crecen ligeramente (ver Shapes).

## Elevation & Depth

Elevación sutil y consistente: dos niveles de sombra ambiental, nunca estructural.

### Shadow Vocabulary
- **shadow** (`0 1px 2px rgba(15,30,28,.05), 0 8px 24px rgba(15,30,28,.07)`): tarjetas, tabla, paneles flotantes.
- **shadow-lg** (`0 14px 50px rgba(15,30,28,.16)`): modales y menús emergentes (combo de clientes).

## Shapes

Bastante redondeado, a pedido: `--radius` sube de 16px a **20px** (tarjetas, modales, paneles) y `--radius-sm` de 10px a **13px** (inputs, chips). Los botones siguen en píldora completa (999px) — ya eran el elemento más redondeado y no cambiaron.

### Named Rules
**La Regla del Borde Lateral Eliminado.** Las tarjetas de resumen ya no llevan una franja de color de 3px en el borde izquierdo (un tell reconocible de UI genérica). La categoría (vencido/pagado/neutral) se marca coloreando la cifra misma, no el marco de la tarjeta.

## Components

### Buttons
- **Shape:** píldora completa (999px).
- **Primary:** fondo teal (`#0f766e`), texto blanco, sombra suave teñida de teal.
- **Hover:** oscurece a `#0b5450`.
- **Secondary:** fondo niebla (`--bg-tint`), borde niebla, texto grafito.
- **Danger:** fondo rojo ladrillo, texto blanco.

### Cards / Containers
- **Corner Style:** 20px.
- **Background:** blanco sobre fondo niebla fría.
- **Shadow Strategy:** `shadow` (ver Elevation).
- **Border:** 1px borde niebla.

### Inputs / Fields
- **Style:** blanco, borde niebla, radio 13px.
- **Focus:** borde teal + halo `color-mix` al 20% de teal (sin cambios de comportamiento, solo el color base).

### Badges (estado del crédito)
- **Style:** fondo tenue del color semántico (`*-light`) + texto en el color semántico saturado, píldora.
- **State:** pendiente = ámbar, vencido = rojo, pagado = verde, parcial = índigo (sin cambios, ya bien diferenciado del acento).

## Do's and Don'ts

### Do:
- **Do** usar el teal solo para lo que el usuario debe notar primero (acción principal, cifra clave, foco).
- **Do** mantener una sola familia tipográfica; variar peso y tamaño, no la fuente.
- **Do** colorear la cifra/valor para indicar categoría, nunca un borde lateral de color plano.
- **Do** conservar `tabular-nums` en toda cifra de dinero.

### Don't:
- **Don't** introducir una segunda tipografía "de marca" para títulos.
- **Don't** usar el teal como fondo de secciones completas (el modo es Operate: acento restringido, no "Drenched").
- **Don't** combinar crema cálido + terracota (paleta ya descartada explícitamente).
- **Don't** tocar la lógica, los permisos o el flujo de ninguna pantalla al hacer ajustes visuales futuros — este documento es solo la piel.
