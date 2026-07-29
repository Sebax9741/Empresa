# 💳 Control de Créditos

Aplicación para controlar los créditos que le das a tus clientes de distribución. Funciona en **celular, tablet y computadora**, con **base de datos en la nube**: lo que editas en un dispositivo se actualiza **al instante** en los demás.

## ¿Qué hace?

- 📋 Lista de créditos con: **Nro de boleta, cliente, zona, monto total, saldo, vencimiento y estado**
- 🧑‍🤝‍🧑 **Base de datos de clientes** (botón 🧑‍🤝‍🧑): registra cada cliente **una sola vez** con su zona (y **dirección**, teléfono y nota opcionales). Al crear un crédito **escribes el nombre y te va sugiriendo los clientes que coinciden** (ignora mayúsculas y tildes; también busca por zona o dirección); al elegir uno **su zona se pone sola**, así el mismo cliente nunca queda escrito de dos formas distintas. Si cambias su nombre o zona, **sus créditos se actualizan solos**. El botón **"📥 Importar desde mis créditos"** crea la lista a partir de los créditos que ya tienes y **une las variantes** del mismo nombre (mayúsculas, tildes, espacios de más)
- 📍 **Zona** del cliente (MODELO, 3 DE MAYO, CIUDAD, MILAGROS, CARRETERA, PADRE ALDAMIZ, ALAMEDA)
- 💵 **Pago inicial** al crear y **"Agregar a cuenta"** al editar: registra los adelantos (hasta 8), cada uno con su **fecha** y **método** (💵 Efectivo / 📱 Yape / 🏦 BCP); el **saldo** y el estado (pendiente/parcial/pagado) se calculan solos
- 🧾 **Hoja de cobranza** (botón 🧾): elige un día y ves todo lo cobrado esa fecha con los **totales de Efectivo, Yape y BCP** y el total general; se puede **imprimir** o **exportar a Excel**
- 📅 **Vencimiento automático** (emisión + días configurables en ⚙️), pero **editable**, con **2 botones de atajo** (+X días) que configuras en ⚙️
- 🧮 **Panel "Filtrar"** con casillas combinables: por **estado**, por **zona**, por **mes** (Ene–Dic) y por **rango de fechas**, todo junto
- 🔀 **Ordena** por vencimiento, boleta, cliente, zona, total, saldo o fecha
- 🏷️ Estados: Pendiente, Pago parcial, Pagado — y marca **Vencido automáticamente** al pasar la fecha
- 📷 **Foto de la boleta física** (cámara o galería) en alta calidad; se ve **a pantalla completa** y se puede **descargar**
- ☁️ **Nube en tiempo real**: entra con tu usuario y contraseña en todos tus dispositivos a la vez (varias sesiones activas) y todos ven los mismos datos
- 🔒 **Código de seguridad (4 dígitos)**: lo pone el administrador en ⚙️ y se pide para **borrar un crédito** o **borrar una "a cuenta"**. Se guarda solo su huella (SHA-256 con sal), nunca el código en claro. **Queda guardado en la nube** (vale en todos los dispositivos) y además copiado en cada equipo, así no se pierde al actualizar la página ni sin internet
- ⚙️ **La configuración se guarda en la nube**: los días de crédito, la moneda y los atajos los define el administrador y **valen para todo el equipo y en todos los dispositivos**. El aviso de vencimiento sí es de cada celular
- 🕵️ **Constancia en cada "a cuenta"**: se guarda automáticamente **quién** la registró y **en qué día real** lo hizo. Si la fecha del pago no coincide con el día en que se registró, aparece un **⚠️** para que lo revises
- 🚫 **Candado por día**: un empleado **no puede quitar las "a cuenta" de otros días** (solo el administrador). Sí puede registrar un pago con fecha pasada, pero queda la constancia del día real en que lo hizo
- 👥 **Usuarios y permisos**: solo el administrador crea usuarios (con contraseña, sin correo); a cada uno le das o le quitas permisos (crear, editar, registrar pagos, **borrar**, ver/exportar cobranza, registrar/editar clientes). El acceso a los datos y el borrado quedan blindados en la base de datos
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

> **Copia el contenido completo del archivo [`firestore.rules`](firestore.rules) de este repositorio** y pégalo ahí. Esas reglas hacen que solo tu equipo vea los datos y que se respeten los permisos (por ejemplo, que un empleado sin permiso no pueda borrar).

6. Ve a **⚙️ (arriba a la izquierda) → Configuración del proyecto** → baja hasta **"Tus apps"** → toca el ícono **`</>`** (Web) → ponle un nombre (ej: `creditos-web`) → **Registrar app**. Te mostrará un código con `firebaseConfig = { apiKey: "...", ... }`. **Copia esos valores.**

## PASO 2 — Pegar la configuración en la app

1. En GitHub, abre el archivo **`js/firebase-config.js`** de este repositorio y tócale el lápiz ✏️ (editar).
2. Reemplaza cada `"PEGA_AQUI_..."` con los valores que copiaste de Firebase (respeta las comillas).
3. Guarda con **"Commit changes"**.

Al guardar, **el APK se recompila solo** con tu configuración (tarda ~5-10 minutos).

## Usuarios y permisos (multiusuario)

- **La primera vez que inicies sesión** con tu cuenta (tu correo actual y su contraseña) quedas automáticamente como **administrador dueño**. Entra una vez para activarlo.
- Como administrador verás el botón **👥** arriba. Desde ahí:
  - **Creas usuarios** para tus empleados: un usuario (ej. `juan`), un nombre y una contraseña. No usan correo; entran con ese usuario y contraseña.
  - **Das o quitas permisos** a cada uno con casillas: crear créditos, editar, registrar pagos, **borrar créditos**, ver/exportar cobranza. O lo marcas como **administrador** (todos los permisos).
  - **Quitas el acceso** a un usuario cuando quieras.
- Nadie puede registrarse solo: **solo tú creas usuarios**.
- Si un empleado **olvida su contraseña**, puede cambiarla él mismo desde ⚙️ (estando dentro), o le creas un usuario nuevo.

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
