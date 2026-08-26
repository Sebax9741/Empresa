# 💳 Control de Créditos

Aplicación para controlar los créditos que le das a tus clientes de distribución. Funciona en **celular, tablet y computadora**, con **base de datos en la nube**: lo que editas en un dispositivo se actualiza **al instante** en los demás.

## ¿Qué hace?

- 📋 Lista de créditos con: **Nro de boleta, cliente, zona, monto total, saldo, vencimiento y estado**
- 🧑‍🤝‍🧑 **Base de datos de clientes** (botón 🧑‍🤝‍🧑): registra cada cliente **una sola vez** con su zona (y **dirección**, teléfono y nota opcionales). Al crear un crédito **escribes el nombre y te va sugiriendo los clientes que coinciden** (ignora mayúsculas y tildes; también busca por zona o dirección); al elegir uno **su zona se pone sola**, así el mismo cliente nunca queda escrito de dos formas distintas. Si cambias su nombre o zona, **sus créditos se actualizan solos**. El botón **"📥 Importar desde mis créditos"** crea la lista a partir de los créditos que ya tienes y **une las variantes** del mismo nombre (mayúsculas, tildes, espacios de más)
- 📍 **Zona** del cliente (MODELO, 3 DE MAYO, CIUDAD, MILAGROS, CARRETERA, PADRE ALDAMIZ, ALAMEDA, LABERINTO, PAMPA)
- 🅰️🅱️ **Categoría de precio del cliente (A, B o C)**: cada cliente se guarda con su categoría —**A mayorista, B intermedio, C menudeo**— y también con su **RUC / DNI**. Es lo que decide qué precio se le cobra al hacerle una nota de venta. Un cliente nuevo entra como **C** por defecto: así nunca se le cobra de menos por descuido
- 🛒 **Productos** (botón 🛒): catálogo, solo eso — **crear, ver y editar**. Código de producto (PR-0001, PR-0002… se genera solo), nombre, presentación (Balde, Caja, Saco, Paquete o Unidad), **tres precios: A, B y C** y su **stock mínimo**, para que la app avise cuando se está acabando. Un producto nace siempre con **0 de stock**: cargarle mercadería se hace aparte, en 📥 Ingreso de productos, nunca desde aquí. Un producto que ya no vendes se marca **inactivo**: deja de salir al vender pero conserva todo su historial
- 📥 **Ingreso de productos** (botón 📥): la sección donde entra la mercadería, con **dos formas de trabajar**. **Por factura o guía**, para cuando llega un camión: todo se llena en **un solo recuadro armado como el comprobante que estás copiando** —cabecera con el documento, el proveedor, la fecha y quién registra; detalle numerado ítem por ítem; y pie con los totales y el botón—. Anotas el **proveedor**, el **tipo y número de documento** y la fecha una sola vez (la cabecera los va repitiendo en grande, para comprobar de un vistazo), y luego **buscas los productos escribiendo su nombre** —van apareciendo debajo con su código, unidad y stock actual— y los vas **agregando a una lista**. Cada línea muestra cuánto entra y **en cuánto va a quedar el stock**; abajo, el total de productos y unidades. Un botón **📦 Agregar stock** registra toda la lista de una vez. La otra forma es **Ajuste o salida**, para un solo producto: **corregir el stock con el conteo físico** (escribes lo contado y la app calcula sola la diferencia) o anotar lo que salió sin venderse (merma, traslado). Abajo queda el historial: **cada factura se ve como una sola entrada** con sus productos debajo, no como filas sueltas. El botón 📥 de cada fila en Productos abre esta sección con ese producto ya elegido
- 📒 **Kardex de almacén** (botón 📒): la hoja **se llena sola** —cada nota de venta descuenta lo vendido y cada ingreso que registras queda anotado—, así que ahí no hay que escribir nada: es la hoja que se consulta y se imprime, con todo el historial completo (ventas incluidas). Cada línea anota **fecha y hora, producto, tipo (📥 entrada / 📤 salida / ⚖️ ajuste), motivo**, **documento de referencia**, **cuánto entró o salió, el saldo que quedó** y **quién lo registró**. El stock **nunca se escribe a mano**: sale de sumar el kardex, así que siempre se puede auditar fila por fila. Se filtra por producto, tipo y rango de fechas
- 🧮 **Notas de venta** (botón 🧮): la toma de pedido completa. Eliges el cliente y **al instante ves su categoría (A/B/C), su zona, su código, su RUC, su dirección, su teléfono y cuánto te debe**. El **número de nota es correlativo** (0001-00000001) y quedan guardados la **fecha de emisión, la hora de creación y qué usuario la está haciendo**. Al agregar un producto, **el precio se pone solo según la categoría del cliente**; los precios están **bloqueados** salvo que marques la casilla **🔓 "Permitir modificación de precios"** (y entonces queda constancia de que ese precio se tocó a mano). Abajo se calculan el subtotal, el descuento, el **total a pagar** y el **importe en letras**. Al guardar, **cada producto vendido sale solo del almacén** con la nota como documento
- 🖨️ **Nota de venta impresa en media hoja A4** (A5 apaisado), con el mismo formato de tu talonario: cabecera del negocio y número de nota en su recuadro, datos del cliente y del comprobante, cuadro de **Código / Cant. / U.M. / Descripción / P.U. / Importe**, la línea **"Son: … CON 00/100 SOLES"** y los recuadros de **Total Dscto** y **Total a Pagar**. El nombre, la dirección, el RUC y el teléfono del negocio se ponen en ⚙️ Configuración
- 💵 **Pago inicial** al crear y **"Agregar a cuenta"** al editar: registra los adelantos (hasta 8), cada uno con su **fecha** y **método** (💵 Efectivo / 📱 Yape / 🏦 BCP); el **saldo** y el estado (pendiente/parcial/pagado) se calculan solos
- 🧾 **Hojas de cobranza por día** (botón 🧾): **cada día tiene su propia hoja, pero no aparece sola: alguien con el permiso "Crear la hoja de cobranza del día" tiene que crearla** (normalmente el empleado, al empezar su turno). Recién ahí se pueden registrar cobros de ese día. Al terminar el día, **el administrador la cierra** (🔒): desde ahí ya no se puede agregar ni quitar ningún cobro de esa fecha sin su código de seguridad. Cada línea dice **a qué cliente** (con su código), **a qué crédito** (Nº de boleta), **cuánto se cobró**, **cuánto queda debiendo**, **si fue Efectivo / Yape / BCP**, **quién lo cobró** y **su firma**. Arriba, los **totales por método** y el total del día. Con **◀ ▶** saltas entre los días que tienen hoja o cobros y una lista muestra todos los días con su total. Tocando una línea se abre el crédito completo. Se puede **imprimir** o **exportar a Excel** (con **fecha de emisión y fecha de despacho** de cada crédito)
- 📦 **Despachos de reparto** (botón 📦): arma cada **salida** como un viaje —un **repartidor** (de una lista de nombres que tú manejas; ellos no usan la app) con su **carguero** en una **fecha**— y adentro cargas los **pedidos** que lleva (cliente, **N° de comprobante** boleta/factura/nota de venta, monto y zona). Cada pedido tiene su estado: **en reparto**, **al contado**, **devuelto** o **a crédito**. Cuando un pedido **vuelve firmado**, un botón abre el **formulario de crédito ya prellenado** (cliente, comprobante, monto y fecha de despacho): solo confirmas y el pedido queda **enlazado** a ese crédito. Cada despacho muestra su total y cuántos pedidos hay en cada estado
- 🆔 **Código de cliente**: cada cliente tiene un código (C001, C002…) que se genera solo al registrarlo. Se puede buscar por él y aparece en la hoja de cobranza
- 📅 **Vencimiento automático** (emisión + días configurables en ⚙️), pero **editable**, con **2 botones de atajo** (+X días) que configuras en ⚙️
- 🧮 **Panel "Filtrar"** con casillas combinables: por **estado**, por **zona**, por **mes** (Ene–Dic) y por **rango de fechas**, todo junto
- 🔀 **Ordena** por vencimiento, boleta, cliente, zona, total, saldo o fecha
- 🏷️ Estados: Pendiente, Pago parcial, Pagado — y marca **Vencido automáticamente** al pasar la fecha
- 📷 **Foto de la boleta física** (cámara o galería) en alta calidad; se ve **a pantalla completa** y se puede **descargar**
- ☁️ **Nube en tiempo real**: entra con tu usuario y contraseña en todos tus dispositivos a la vez (varias sesiones activas) y todos ven los mismos datos
- 🔒 **Código de seguridad (4 dígitos)**: lo pone el administrador en ⚙️ y se pide para **borrar un crédito**, **borrar una "a cuenta"** o **anular un movimiento de almacén** —y anular movimientos (un ingreso entero o una línea del kardex) es **solo del administrador**, porque cambia el stock hacia atrás. Se guarda solo su huella (SHA-256 con sal), nunca el código en claro. **Queda guardado en la nube** (vale en todos los dispositivos) y además copiado en cada equipo, así no se pierde al actualizar la página ni sin internet
- ⚙️ **La configuración se guarda en la nube**: los días de crédito, la moneda y los atajos los define el administrador y **valen para todo el equipo y en todos los dispositivos**. El aviso de vencimiento sí es de cada celular
- 🕵️ **Constancia en cada "a cuenta"**: se guarda automáticamente **quién** la registró, **en qué día real** y **a qué hora** lo hizo (se ve en la ficha y en el formulario de edición). Si la fecha del pago no coincide con el día en que se registró, aparece un **⚠️** para que lo revises. **Solo el administrador puede corregir un pago ya registrado** (fecha, monto y método) con el ✏️ que aparece junto a él: al hacerlo queda una segunda línea **"✏️ Modificado por … el … a las …"**, sin borrar nunca la de quién lo cobró. Si el pago sale de una hoja de cobranza ya cerrada, o entra en una, se le pide su código de seguridad
- ℹ️ **Ficha de información** (botón ℹ️ en cada crédito): muestra todo el detalle en solo lectura — cliente, dirección, teléfono, zona, vencimiento, notas, los pagos a cuenta con su firma y la foto de la boleta. Es la pantalla que usan los empleados en la calle
- ✍️ **Firma digital del cliente**: al cobrar, el cliente firma en la tablet (con lápiz táctil o el dedo) y **la firma queda guardada junto a ese pago**. Sin firma no se registra el cobro
- 🧾 **Cobro en la calle**: desde la ficha, el empleado registra el pago eligiendo **Efectivo / Yape / BCP**; para él la **fecha es siempre la de hoy y no se puede cambiar**. **Solo el administrador puede corregirla** (por ejemplo, para anotar un cobro de ayer que quedó pendiente): no admite fechas futuras, el cobro entra en la hoja de cobranza de ese día —si ya estaba cerrada, se le pide su código— y queda la **constancia del día y la hora reales** en que lo registró, con un **⚠️** cuando las dos fechas no coinciden. Un botón permite **saldar de una vez todo lo que debe**
- 🛠️ **Editar es solo del administrador**: los empleados no ven el botón de editar, solo el de información
- 🚫 **Candado por día**: un empleado **no puede quitar las "a cuenta" de otros días** (solo el administrador). Sí puede registrar un pago con fecha pasada, pero queda la constancia del día real en que lo hizo
- 🔒 **Hoja de cobranza cerrada = candado total**: una vez que el administrador cierra la hoja de un día, **nadie puede agregar ni quitar cobros de esa fecha**, ni siquiera el administrador, **sin escribir su código de seguridad** cada vez
- ⏰ **Hora de apertura y de cierre con la hora del servidor**: queda registrado **a qué hora el empleado abrió la hoja** y **a qué hora el administrador la cerró**. La hora **la pone el servidor de Firebase, no el celular ni la tablet**, así que cambiar la hora del dispositivo no sirve de nada. Se ve en la hoja de cobranza y sale también al imprimir y al exportar a Excel
- 👥 **Usuarios y permisos**: solo el administrador crea usuarios (con contraseña, sin correo); a cada uno le das o le quitas permisos (crear, editar, registrar pagos, **borrar**, ver/exportar cobranza, registrar/editar clientes, **crear la hoja de cobranza del día**, **armar despachos de reparto**, **emitir notas de venta**, **gestionar productos y almacén**). El acceso a los datos y el borrado quedan blindados en la base de datos. Un empleado que ya podía crear créditos **puede vender**, pero **tocar el catálogo, ingresar mercadería y corregir el stock hay que dárselo a propósito**. La sección va a **dos columnas en computadora**: el alta a la izquierda y el equipo a la derecha, con los permisos en dos columnas. La **cuenta de dueño** (con la que se dio de alta el negocio) se muestra aparte del equipo: no se le dan ni se le quitan permisos y **no se puede quitar**, porque es la llave de respaldo. A un **administrador** no se le marcan permisos uno a uno: los tiene todos
- 🖊️ **Todo queda firmado con el nombre visible**: lo que registras sale como **Admin**, no como el usuario con el que entras. El administrador puede cambiar ese nombre desde 👥 Usuarios (✏️ en la cuenta de dueño o en cada ficha del equipo), y **lo anotado hace meses también pasa a leerse con el nombre nuevo** —hojas de cobranza, cobros, kardex, notas de venta— sin tocar ni un dato ya guardado: la traducción se hace al mostrarlo. Una firma de alguien que ya no está en el equipo se deja tal cual
- 🎨 **Iconos en color propios de la app**: los emojis los dibuja cada sistema a su manera —el mismo 🧾 se ve distinto en Windows, en Android y en el iPhone, y algunos ni se ven—. La app trae los suyos, un juego propio de 73 iconos, y los cambia sola en toda la pantalla, incluidos los botones de **información, editar y quitar** de cada fila. Viajan con la app, así que **se ven igual en todos los equipos y también sin internet**. Donde una imagen no cabe —las listas desplegables, los avisos del navegador, lo que se imprime y lo que se exporta a Excel— se sigue usando el emoji de siempre
- 🔲 **Dos versiones del mismo icono, cada una en su sitio**: en `icons/emoji/` está el dibujo suelto, que es el que usa casi toda la app porque sus iconos van pegados al texto (14–28 px) y a esa altura un recuadro de color se comería el dibujo. En `icons/emoji/chip/` está el mismo dibujo dentro de su recuadro redondeado, reservado para donde el icono va solo y en grande haciendo de símbolo de una tarjeta: hoy, las dos tarjetas de modo de **Ingreso de productos**. La lista de sitios con recuadro es `CON_RECUADRO` en `js/iconos.js`. Las tarjetas del **Dashboard** llevan el dibujo suelto a propósito: ya se pintan su propio recuadro en CSS, teñido del color de cada indicador (rojo en *Vencidos*, verde en *Cobrado*), y el recuadro del icono habría metido un segundo color que se pelea con el de la tarjeta
- 🖥️ **Ventanas grandes en computadora**: **editar un crédito** se abre a dos columnas (los datos a la izquierda; los pagos a cuenta, las notas y la foto a la derecha), así cabe entero sin bajar con la rueda —también cuando el crédito trae foto: la vista previa va pequeña al lado de sus botones, porque ahí solo hace falta para comprobar que está puesta—. Y la **ficha del crédito** se ajusta a lo que hay: si no tiene foto o ya está pagado no reserva esa columna, y si le faltan las dos se estrecha, en vez de dejar huecos en blanco
- 🗑️ **Borrar clientes es solo del administrador**: un empleado con permiso de clientes los **registra y los corrige**, pero no los borra — borrar se lleva por delante la ficha y su historial. La base de datos lo rechaza aunque se intente saltando la pantalla
- 🔑 **Entrar con un usuario en vez del correo**: el negocio se da de alta con un correo, pero después no hace falta escribirlo cada vez. En ⚙️ Configuración → 👤 Mi cuenta, el administrador crea su **usuario corto** (por ejemplo `admin`) y elige **cómo lo muestra el sistema** (`Admin`): ese nombre es el que firma las notas de venta, los ingresos de almacén y las hojas de cobranza. El usuario nuevo tiene **los mismos permisos de administrador** y ve **los mismos datos**; el correo original **sigue funcionando**, así que conviene guardarlo por si se olvida la contraseña
- 🧭 **Panel lateral en computadora**: en pantallas anchas aparece un menú a la izquierda con los apartados **agrupados por el trabajo que resuelven** —General, Ventas, Almacén y Administración— con iconos de trazo del mismo estilo. Se puede **contraer** con el botón de abajo o con el **☰** de la cabecera: el panel se estrecha a solo los iconos y el área de trabajo se ensancha con él en la misma transición, así que en una pantalla justa la tabla gana casi 200 píxeles. Contraído, el nombre de cada apartado aparece al pasar el ratón. La app **recuerda** cómo lo dejaste
- 📱 **En el teléfono, el mismo menú es un cajón**: arriba queda solo lo que se mira de reojo —el **☰**, la **hora**, el **usuario** y **Cerrar sesión**— en una sola línea. Los apartados salen al tocar el ☰: el panel entra desde el borde izquierdo, con los mismos grupos e iconos que en la computadora y un velo detrás. Al elegir uno se abre y el cajón se cierra solo; también se cierra tocando fuera, con la ✕ o con Escape. La barra de arriba **se queda a la vista** por encima del cajón, así que el mismo ☰ que lo abrió lo cierra. Antes esa barra llevaba los once apartados en fila y ocupaba 142 px de una pantalla de 844 antes de enseñar un solo dato; ahora ocupa 57
- 🕐 **Reloj del sistema**: la hora corriendo al segundo, con **a. m. / p. m.**, y debajo el día y la fecha ("Martes, 25 de agosto"). Va en la barra de arriba, **junto a la cuenta**, y **no se mueve al cambiar de sección** ni cuando aparece el botón "＋ Nuevo crédito": queda clavado en el mismo sitio siempre. En celular se queda solo con la hora
- 📅 **Cambiar el vencimiento sin abrir todo el crédito**: con el permiso correspondiente, un empleado puede tocar el ✏️ junto a la fecha de vencimiento en la ficha (ℹ️) y cambiarla ahí mismo, sin acceso al resto del crédito. Queda constancia de quién y cuándo la cambió por última vez
- 📶 **Funciona sin internet (pensado para la calle)**: la tablet guarda **todo** en el propio dispositivo —clientes, créditos, cobros, firmas y fotos—, así que el empleado **crea la hoja del día, cobra, firma y consulta igual que siempre aunque no haya señal**. Al volver la conexión, **todo se sube solo** sin tener que hacer nada. Arriba aparece un aviso que dice si está **sin internet** o **subiendo los cambios**. También se puede **entrar a la app sin señal**: el acceso y los permisos quedan guardados en el equipo desde la última vez que sí hubo internet (la primera vez sí hace falta conectarse una vez)
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

### Si sale "No se pudo guardar" o "La base de datos rechazó el cambio"

No es la conexión: son las **reglas de la base de datos**, que dicen quién puede escribir en cada cosa. Cuando la app estrena una sección nueva (Productos, Kardex, Notas de venta) hay que publicarlas otra vez, o Firestore rechaza todo lo que vaya a esas colecciones.

**Arreglo rápido (2 minutos, vale enseguida):**

1. Entra a la [consola de Firebase](https://console.firebase.google.com) → tu proyecto → **Firestore Database**
2. Pestaña **"Reglas"** (arriba, junto a "Datos")
3. **Borra todo** lo que hay en el recuadro
4. Abre el archivo [`firestore.rules`](firestore.rules) de este repositorio, **copia todo su contenido** y pégalo ahí
5. Botón **"Publicar"**

Tarda unos segundos en surtir efecto. Después recarga la app.

**Arreglo definitivo (para que se publiquen solas):** la cuenta con la que GitHub publica la web no tiene permiso para tocar las reglas, por eso hay que hacerlo a mano. Para dárselo una sola vez: [Google Cloud → IAM](https://console.cloud.google.com/iam-admin/iam) → elige el proyecto → busca la cuenta que empieza por `github-action-` → ✏️ Editar → **Agregar otro rol** → busca **"Firebase Rules Admin"** → Guardar. Desde ahí, cada vez que suba cambios las reglas se publican solas.

## PASO 2 — Pegar la configuración en la app

1. En GitHub, abre el archivo **`js/firebase-config.js`** de este repositorio y tócale el lápiz ✏️ (editar).
2. Reemplaza cada `"PEGA_AQUI_..."` con los valores que copiaste de Firebase (respeta las comillas).
3. Guarda con **"Commit changes"**.

Al guardar, **la web se publica sola** con tu configuración (tarda ~2 minutos).
Para actualizar también el APK de Android, ve a **Actions → "Compilar APK de Android" → "Run workflow"** (tarda ~5-10 minutos).

## Usuarios y permisos (multiusuario)

- **La primera vez que inicies sesión** con tu cuenta (tu correo actual y su contraseña) quedas automáticamente como **administrador dueño**. Entra una vez para activarlo.
- Como administrador verás el botón **👥** arriba. Desde ahí:
  - **Creas usuarios** para tus empleados: un usuario (ej. `juan`), un nombre y una contraseña. No usan correo; entran con ese usuario y contraseña.
  - **Das o quitas permisos** a cada uno con casillas: crear créditos, editar, registrar pagos, **borrar créditos**, ver/exportar cobranza. O lo marcas como **administrador** (todos los permisos).
  - **Quitas el acceso** a un usuario cuando quieras.
- Nadie puede registrarse solo: **solo tú creas usuarios**.
- Si un empleado **olvida su contraseña**, puede cambiarla él mismo desde ⚙️ (estando dentro), o **tú le pones una nueva** con el botón **🔑 Restablecer clave** en 👥 Usuarios (no hace falta saber la anterior; ver siguiente sección para activarlo).

### Restablecer la contraseña de un empleado (🔑)

Nadie, ni tú ni el código de la app, puede **ver** la contraseña de un empleado (se guarda como huella, no en texto). Pero como administrador puedes **ponerle una nueva** sin saber la anterior, con el botón 🔑 en 👥 Usuarios. Esto funciona mediante una función en la nube (Cloud Function) que hay que activar **una sola vez**:

1. En la [consola de Firebase](https://console.firebase.google.com) → tu proyecto → ⚙️ **Configuración del proyecto** → **Uso y facturación** → cambia al plan **Blaze** (pago por uso). Necesita una tarjeta, pero esta función entra sobradamente en la cuota gratis mensual (2 millones de llamadas): en el uso normal de esta app no debería generar cobro.
2. En GitHub, entra a este repositorio → pestaña **Actions** → en la lista de la izquierda elige **"Publicar Cloud Functions (restablecer contraseña)"** → botón **Run workflow** → **Run workflow** de nuevo para confirmar.
3. Espera a que termine en verde (1-2 minutos). Listo, el botón 🔑 ya funciona.

Este paso es manual a propósito (no se dispara solo en cada cambio de código) para no intentar publicar antes de que actives Blaze. Si en el futuro pido que se modifique esta función, hay que repetir el paso 2 para que el cambio quede publicado.

## PASO 3 — Instalar el APK en celular y tablet

1. Desde el celular/tablet, entra a este repositorio en GitHub → sección **Releases** (o directo: `https://github.com/Sebax9741/Empresa/releases`).
2. Descarga **`control-creditos.apk`** (en *Assets*).
3. Ábrelo y acepta instalar (si Android pregunta, permite "instalar apps de origen desconocido").
4. Abre la app, toca **"Crear cuenta nueva"** la primera vez (correo + contraseña de mínimo 6 caracteres).
5. En tus otros dispositivos instala el mismo APK y entra con **el mismo correo y contraseña**: verás los mismos datos, sincronizados al instante.

> **La web se publica sola** con cada cambio. El **APK se genera a pedido**, para no gastar los minutos gratis de GitHub: entra a **Actions → "Compilar APK de Android" → "Run workflow"** y, cuando termine, descarga el APK desde *Releases*. Se instala encima del anterior, sin perder nada (tus datos están en la nube).

## Clave de firma del APK (seguridad)

La clave que firma el APK **no está en este repositorio**: vive en los **secretos de GitHub**,
así el repositorio puede ser público sin exponerla. Son dos secretos, en
**Settings → Secrets and variables → Actions**:

| Nombre del secreto | Qué contiene |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | El archivo `release.keystore` convertido a texto (base64) |
| `ANDROID_KEYSTORE_PASSWORD` | La contraseña de esa clave |

> ⚠️ Guarda una copia del archivo `release.keystore` y de su contraseña en un lugar seguro
> (fuera de GitHub). Si se pierden, no se pueden generar actualizaciones del APK que se
> instalen encima de la app ya instalada: habría que desinstalar y volver a instalar.

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
- **¿Olvidé mi contraseña?** Pídesela al administrador: te pone una nueva con el botón **🔑 Restablecer clave** en 👥 Usuarios (ver "Restablecer la contraseña de un empleado"). No hay correo de recuperación para los empleados porque no entran con un correo suyo sino con un usuario corto (`juan`), y la dirección que la app arma por detrás no recibe mensajes.
- **¿Y si estoy sin señal?** Puedes seguir usando la app; los cambios se sincronizan solos al volver la conexión.

## Tecnología

HTML, CSS y JavaScript sin frameworks. Firebase (Authentication + Firestore con caché local) empaquetado dentro de la app. PWA con Service Worker. APK generado con Capacitor y firmado en GitHub Actions (a pedido).

Para desarrollar localmente: `python3 -m http.server 8080` y abrir `http://localhost:8080`.

## Créditos

Los iconos en color son un juego propio, dibujado a medida para la app: rejilla de 48 px, dos tonos por color con un degradado suave y sin contornos negros. El color dice de qué se trata —verde lo confirmado y lo que entra, celeste lo que sale y las fechas, ámbar el dinero y los avisos, naranja el almacén, rojo el error y lo anulado, morado los créditos, teal las personas y los pedidos—. Cada archivo se llama por el código del emoji al que sustituye (`1f5d1.svg` es 🗑️), que es como los busca `js/iconos.js`.
