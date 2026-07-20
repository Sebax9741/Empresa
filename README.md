# 💳 Control de Créditos

Aplicación para controlar los créditos que le das a tus clientes de distribución. Funciona en **celular, tablet y computadora**, y se puede **instalar como app** en el teléfono (es una PWA).

## ¿Qué hace?

- 📋 Lista de créditos con: **Nro de boleta, cliente, monto total, fecha de vencimiento y estado**
- 📅 **Vencimiento automático** (fecha de emisión + días de crédito configurables), pero **editable** si necesitas otra fecha
- 🔀 **Ordena** por vencimiento, boleta, cliente, monto o fecha (tocando los encabezados o con el selector)
- 🔍 Busca por cliente o número de boleta, y filtra por estado
- 🏷️ Estados: **Pendiente, Pago parcial, Pagado** — y marca **Vencido** automáticamente cuando pasa la fecha
- 📷 **Adjunta una foto de la boleta física** (con la cámara del celular o eligiendo una imagen)
- 📊 Resumen: total por cobrar, cobrado, créditos activos y vencidos
- 💾 Los datos se guardan **en tu dispositivo** (funciona sin internet)
- ⬇️⬆️ **Exporta e importa respaldos** (con fotos incluidas) para no perder nada o pasar los datos a otro equipo

## Cómo publicarla gratis (GitHub Pages)

1. En GitHub, entra a **Settings → Pages** de este repositorio.
2. En **Source** elige **Deploy from a branch**, selecciona la rama principal y la carpeta `/ (root)`. Guarda.
3. En unos minutos tu app estará en: `https://TU-USUARIO.github.io/Empresa/`

## Cómo instalarla en el celular

1. Abre la dirección de la app en **Chrome** (Android) o **Safari** (iPhone).
2. **Android:** toca el menú ⋮ → **"Agregar a la pantalla de inicio"** (o el aviso "Instalar app").
3. **iPhone:** toca el botón Compartir → **"Agregar a pantalla de inicio"**.
4. Listo: te queda el ícono como cualquier app y funciona incluso sin internet.

En la **computadora** basta con abrir la misma dirección en el navegador (Chrome también ofrece instalarla con el ícono ⊕ en la barra de direcciones).

## Importante sobre tus datos

- Los datos viven **en cada dispositivo** (no se sincronizan solos entre teléfono y computadora).
- Usa **⚙️ → Exportar respaldo** con regularidad para guardar una copia, y **Importar respaldo** para restaurarla o pasarla a otro dispositivo.
- No borres los datos de navegación del sitio, porque ahí se guardan los créditos.

## Probarla en tu computadora (opcional)

```bash
# Desde la carpeta del proyecto:
python3 -m http.server 8080
# Luego abre http://localhost:8080
```

## Tecnología

HTML, CSS y JavaScript puros, sin dependencias. Los datos se guardan con IndexedDB y la app se instala/funciona sin internet gracias a un Service Worker.
