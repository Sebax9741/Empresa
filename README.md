# 💳 Control de Créditos

Aplicación para controlar los créditos que le das a tus clientes de distribución. Funciona en **celular, tablet y computadora**, con **base de datos en la nube**: lo que editas en un dispositivo se actualiza **al instante** en los demás.

## ¿Qué hace?

- 📋 Lista de créditos con: **Nro de boleta, cliente, zona, monto total, saldo, vencimiento y estado**
- 📍 **Zona** al crear (MODELO, 3 DE MAYO, CIUDAD, MILAGROS, CARRETERA, PADRE ALDAMIZ, ALAMEDA)
- 💵 **Pago inicial** al crear y **"Agregar a cuenta"** al editar: registra los adelantos (hasta 8), cada uno con su **fecha** y **método** (💵 Efectivo / 📱 Yape / 🏦 BCP); el **saldo** y el estado (pendiente/parcial/pagado) se calculan solos
- 🧾 **Hoja de cobranza** (botón 🧾): elige un día y ves todo lo cobrado esa fecha con los **totales de Efectivo, Yape y BCP** y el total general; se puede **imprimir** o **exportar a Excel**
- 📅 **Vencimiento automático** (emisión + días configurables en ⚙️), pero **editable**
- 🧮 **Panel "Filtrar"** con casillas combinables: por **estado**, por **zona**, por **mes** (Ene–Dic) y por **rango de fechas**, todo junto
- 🔀 **Ordena** por vencimiento, boleta, cliente, zona, total, saldo o fecha
- 🏷️ Estados: Pendiente, Pago parcial, Pagado — y marca **Vencido automáticamente** al pasar la fecha
- 📷 **Foto de la boleta física** (cámara o galería) en alta calidad; se ve **a pantalla completa** y se puede **descargar**
- ☁️ **Nube en tiempo real**: entra con tu correo y contraseña en todos tus dispositivos a la vez (varias sesiones activas) y todos ven los mismos datos
- 📶 Funciona **sin internet**: los cambios se guardan y se sincronizan solos al volver la conexión
- 🔔 **Avisos de vencimiento**: en Android te llega una notificación el día que vence un crédito, aunque la app esté cerrada. En iPhone/PC, al abrir la app te avisa cuántos vencen hoy o están vencidos. Se puede activar/desactivar en ⚙️.
- 📊 Resumen: por cobrar, cobrado, activos y vencidos
- 💾 Exportar/importar respaldo en archivo (con fotos incluidas)

> Si aún no configuras la nube, la app funciona en **modo local** (los datos quedan solo en cada dispositivo).

---

## PASO 1 — Crear tu base de datos en la nube (gratis, ~10 minutos)

Se usa **Firebase** de Google (el plan gratuito sobra para este uso).

1. Entra a **https://console.firebase.google.com** con tu cuenta de Google.
2. **"Crear un proyecto"** → nómbralo (ej: `mis-creditos`) → puedes desactivar Google Analytics → Crear.
3. En el menú izquierdo: **Compilación → Authentication** → **Comenzar** → pestaña **Sign-in method** → habilita **Correo electrónico/contraseña** → Guardar.
4. En el menú izquierdo: **Compilación → Firestore Database** → **Crear base de datos** → elige ubicación (ej: `southamerica-east1`) → **modo de producción** → Habilitar.
5. En Firestore, pestaña **Reglas**, borra lo que hay y pega esto (permite que cada usuario vea SOLO sus propios datos) → **Publicar**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /usuarios/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

6. Ve a **⚙️ (arriba a la izquierda) → Configuración del proyecto** → baja hasta **"Tus apps"** → toca el ícono **`</>`** (Web) → ponle un nombre (ej: `creditos-web`) → **Registrar app**. Te mostrará un código con `firebaseConfig = { apiKey: "...", ... }`. **Copia esos valores.**

## PASO 2 — Pegar la configuración en la app

1. En GitHub, abre el archivo **`js/firebase-config.js`** de este repositorio y tócale el lápiz ✏️ (editar).
2. Reemplaza cada `"PEGA_AQUI_..."` con los valores que copiaste de Firebase (respeta las comillas).
3. Guarda con **"Commit changes"**.

Al guardar, **el APK se recompila solo** con tu configuración (tarda ~5-10 minutos).

## PASO 3 — Instalar el APK en celular y tablet

1. Desde el celular/tablet, entra a este repositorio en GitHub → sección **Releases** (o directo: `https://github.com/Sebax9741/Empresa/releases`).
2. Descarga **`control-creditos.apk`** (en *Assets*).
3. Ábrelo y acepta instalar (si Android pregunta, permite "instalar apps de origen desconocido").
4. Abre la app, toca **"Crear cuenta nueva"** la primera vez (correo + contraseña de mínimo 6 caracteres).
5. En tus otros dispositivos instala el mismo APK y entra con **el mismo correo y contraseña**: verás los mismos datos, sincronizados al instante.

> Cada vez que se cambia algo del código, GitHub recompila el APK automáticamente. Para actualizar la app, vuelve a descargar e instalar el APK desde Releases (se instala encima, sin perder nada: tus datos están en la nube).

## Instalar en iPhone / iPad (y en la computadora)

En iPhone no se usa el APK (eso es solo de Android). La app se instala desde **Safari** y queda igual que una app normal. Para eso primero hay que publicar la web en **Firebase Hosting** (gratis, usa tu mismo proyecto). Se hace **una sola vez**:

### Paso 1 — Generar la "llave" de publicación (en Firebase)

1. En https://console.firebase.google.com abre tu proyecto → engranaje **⚙️ → Configuración del proyecto**.
2. Pestaña **"Cuentas de servicio"** → botón **"Generar nueva clave privada"** → **"Generar clave"**. Se descarga un archivo `.json`. Ábrelo con un editor de texto y **copia todo su contenido**.

### Paso 2 — Guardar esa llave en GitHub (secreta)

1. En GitHub, entra a este repositorio → **Settings** (Configuración) → en el menú izquierdo **Secrets and variables → Actions**.
2. Botón **"New repository secret"**.
3. En **Name** escribe exactamente: `FIREBASE_SERVICE_ACCOUNT`
4. En **Secret** pega todo el contenido del archivo `.json` del paso 1 → **"Add secret"**.

Con eso, cada vez que se cambie el código, la web se publica sola en:
**`https://empresa-ab.web.app`**

### Paso 3 — Instalar en el iPhone

1. Abre **Safari** (tiene que ser Safari) y entra a **`https://empresa-ab.web.app`**.
2. Toca el botón **Compartir** (el cuadrito con la flecha hacia arriba, abajo en el centro).
3. Baja y toca **"Agregar a pantalla de inicio"** → **"Agregar"**.
4. Te queda el ícono en la pantalla como cualquier app. Ábrela, crea tu cuenta o inicia sesión con tu correo, y verás los mismos datos que en el celular Android y la tablet.

> La misma dirección `https://empresa-ab.web.app` sirve también para **abrirla en la computadora** (cualquier navegador) y en Android.

## Usarla en la computadora

Opciones (la app es la misma):

- **Opción A (recomendada): Netlify, gratis.** Entra a https://app.netlify.com → "Add new site" → "Import an existing project" → conecta GitHub y elige este repositorio (funciona aunque sea privado). Te da una dirección tipo `https://tu-sitio.netlify.app` que puedes abrir en cualquier navegador (y también sirve para instalar la app en iPhone: Safari → Compartir → "Agregar a pantalla de inicio").
- **Opción B: GitHub Pages** (Settings → Pages), pero en repositorios **privados** requiere plan de pago de GitHub. ⚠️ Si decides hacer el repositorio público para usar Pages gratis, avísame antes para mover la clave de firma del APK (`android-keys/`) a un lugar seguro.

## Preguntas frecuentes

- **¿Cuánto cuesta?** Nada: Firebase (plan Spark), GitHub y Netlify tienen planes gratuitos que sobran para este uso.
- **¿Puedo compartirla con un socio o familiar?** Sí: que instale el APK y entre con el mismo correo y contraseña, o crea otra cuenta si quieres datos separados.
- **¿Olvidé mi contraseña?** En la pantalla de entrada toca "Olvidé mi contraseña" y te llega un correo para restablecerla.
- **¿Y si estoy sin señal?** Puedes seguir usando la app; los cambios se sincronizan solos al volver la conexión.

## Tecnología

HTML, CSS y JavaScript sin frameworks. Firebase (Authentication + Firestore con caché local) empaquetado dentro de la app. PWA con Service Worker. APK generado con Capacitor y firmado automáticamente en GitHub Actions.

Para desarrollar localmente: `python3 -m http.server 8080` y abrir `http://localhost:8080`.
