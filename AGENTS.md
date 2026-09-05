# Guía para quien trabaje en este proyecto

Esto es lo que hay que saber **antes** de tocar nada. Vale igual para una
persona que para un asistente de código (Codex, Claude, Copilot o el que sea).

---

## Lo primero: todo va en español

La app la usa una empresa peruana y la lee gente que no programa.

- **La interfaz en español.** Nada de "Save", "Loading…", "No results".
- **Los comentarios del código en español**, y explicando *por qué* se hizo
  así, no *qué* hace la línea. El código ya dice qué hace.
- **Los mensajes de commit en español**, en presente y contando el motivo.
- **Los nombres de funciones y variables en español** cuando son del negocio
  (`creditosPorNumero`, `notaSePuedeEditar`, `puedeVerSeccion`). Lo que es
  vocabulario del navegador se queda como está (`querySelector`, `addEventListener`).

---

## Qué es esta app

Control de créditos y almacén para **Importadora Nueva Vista S.A.C.**, una
distribuidora de abarrotes en Puerto Maldonado.

El recorrido real del negocio, y el orden en que hay que entenderlo:

```
Nota de venta  →  Despacho (reparto)  →  Boleta firmada  →  Crédito  →  Cobros
```

Una **nota de venta** y su **crédito** son la misma venta vista en dos
momentos. Cambiar una cosa sin la otra deja la contabilidad mintiendo.

**Cuándo nace el crédito, que es donde todo el mundo se equivoca:**

```
Nota guardada → crédito creado → despacho → ese MISMO crédito se completa
```

El crédito nace **al guardar la nota**, no cuando vuelve la boleta firmada
(lo hace `crearCreditoDeLaNota()`, llamada desde `guardarNota()` cuando la
nota es nueva). Al volver el reparto **no se crea otro**: se busca el que ya
existe y se le añaden la foto de la boleta, las notas y el pago inicial.
Quien crea que el crédito nace en el despacho acaba haciendo duplicados.

Una **venta al contado** también crea su crédito, pero nace ya pagado y con
saldo cero, sin ningún abono inventado. Así ese dinero no se cuela en la hoja
de cobranza del día, que es para lo que se sale a cobrar.

**Cómo se decide un precio, que es lo otro que confunde:**

El precio lo decide la **cantidad**, no quién compra. Cada producto lleva un
precio base y hasta dos escalones («desde 10, 125»), más un cargo de flete en
soles por unidad que se suma **solo** a los clientes marcados con `aplicaFlete`
en su ficha. Todo eso lo resuelve `precioDeVenta()`, y es el **único** sitio
donde se decide un precio: si hace falta uno en otra parte, se llama ahí.

Antes el precio lo decidía la categoría A/B/C del cliente. Ese modelo **sigue
vivo** para los productos que aún no se han pasado, y los dos conviven a
propósito: un producto cambia de modelo el día que alguien le graba su precio
base, no antes. `usaPreciosPorCantidad()` distingue uno de otro. Así se puede
ir pasando el catálogo sin que ningún precio se mueva un solo día sin que
alguien lo haya escrito.

**Una venta ya emitida no se recalcula nunca.** Cada línea guarda su precio y
su importe dentro de la propia nota, y el crédito su monto. Por eso
`reponerPreciosDeLista()` **no** se llama al abrir una nota que ya existe (ver
el tercer argumento de `nvSeleccionarCliente`): si se llamara, una nota vieja
se vería con los precios de hoy y diría algo distinto del papel que el cliente
tiene firmado en la mano.

Los cobradores trabajan **en la calle, con tablet y muchas veces sin señal**.
Todo tiene que funcionar sin internet y sincronizarse después.

Para el detalle de usuarios, permisos y reglas de negocio, leer `PRODUCT.md`
y la primera sección de `README.md` (que está escrita para el dueño, no para
programadores, y es la descripción más fiel de lo que hace la app).

---

## Cómo está hecha

**HTML, CSS y JavaScript a pelo. Sin frameworks, sin compilación, sin
`npm build`.** Se abre y funciona. Eso es a propósito: el dueño tiene que
poder abrir un archivo y entender qué pasa dentro de diez años.

| Archivo | Qué es |
|---|---|
| `index.html` | Toda la interfaz. Un solo archivo, secciones que se muestran y se esconden |
| `js/app.js` | El programa entero (~10.000 líneas). Es un módulo ES |
| `js/menus.js` | Los desplegables propios que sustituyen a los `<select>` del sistema |
| `js/db.js` | Guardado local y sincronización |
| `js/xlsx-lite.js` | Exportar a Excel sin librerías externas |
| `css/styles.css` | Todo el estilo, con variables en `:root` |
| `sw.js` | Service worker: hace que funcione sin internet |
| `firestore.rules` | Los permisos de verdad, los que blindan los datos |

Del programa **solo `DB` está expuesto globalmente**, y es para que las
pruebas puedan mirar. Todo lo demás vive dentro del módulo. No exponer más.

---

## Reglas que no se saltan

### 1. Subir la versión del service worker en cada cambio

En `sw.js`, primera línea:

```js
const CACHE = 'creditos-v140';
```

**Cada cambio que toque HTML, CSS o JS tiene que subir ese número.** Si no,
la gente sigue viendo la versión vieja guardada en su teléfono y jura que el
arreglo no funcionó. Si se añade un archivo nuevo, meterlo también en la
lista `ARCHIVOS`.

### 2. La clave de firma del APK nunca entra al repositorio

`android-keys/`, `*.keystore` y `*.jks` están excluidos y ahí se quedan. Viven
en los secretos de GitHub. Si alguna vez se hace público el repositorio, hay
que avisar antes.

### 3. Los permisos de verdad están en Firestore, no en la pantalla

Esconder un botón no protege nada. Si un cambio afecta a quién puede ver o
hacer algo, hay que mirar también `firestore.rules`. La app tiene además un
candado en su propio enrutador (`puedeVerSeccion`), porque al arrancar hay un
instante en que todavía no se sabe qué permisos tiene quien entró.

### 4. No romper el enlace nota ↔ crédito ↔ despacho

El enlace se guarda siempre **en el papel que viene después**, nunca en los
dos sitios. Así no hay dos versiones que puedan discrepar.

### 5. `css/styles.css` manda en el aspecto

`DESIGN.md` es un documento generado y **está desactualizado** (dice colores
teal y otra tipografía). La verdad son las variables de `:root` en
`css/styles.css`.

---

## Detalles que sorprenden si no se avisan

**Hay DOS juegos de iconos, y no se mezclan.**

- Los **emojis en color** de `icons/emoji/`: `vigilarIconos()` cambia cada
  emoji del texto visible por su SVG, para que se vea igual en Windows,
  Android y iPhone. Consecuencia práctica: leer `.textContent` de algo que
  tenía un emoji **ya no devuelve el emoji**. En las pruebas hay que tenerlo
  en cuenta.
- Los **de un solo trazo** (`iconoLinea()`, dibujos de Lucide incrustados en
  `TRAZOS_ICONOS`): toman el color de donde estén y son los que dan el aire
  sobrio del panel. Van en las cabeceras de sección (`data-icono="…"` en el
  HTML, los pinta `ponerIconosDeSeccion()`), en los botones de fila
  (`botonDeFila()`), en los chips y en el Dashboard.

La regla para elegir: **si el botón es solo un dibujo, va de trazo**; si lleva
texto al lado, el emoji en color se queda. Veinte pastillas de color en una
tabla de veinte filas pesan más que los datos.

**Los desplegables no son los del navegador.** `js/menus.js` sustituye la
lista que dibuja el sistema operativo por un menú propio. El `<select>` de
verdad **sigue en la página**, invisible, y es el que guarda el valor y
dispara `change`. Por eso el resto del programa no se entera. Si se añade un
`<select>` nuevo, no hay que hacer nada: se convierte solo.

**Un menú dentro de una ventana `<dialog>`** tiene que colgarse de esa
ventana, no del `body`: una ventana abierta se dibuja en una capa por encima
de todo y cualquier cosa colgada del `body` queda detrás, invisible.

**Un `<select>` obligatorio no se puede esconder con `display:none`**, o el
navegador se queja de que no puede enfocar un campo inválido y el formulario
no se envía. Por eso se esconde con `opacity: 0`.

**La columna de una tabla no se cuenta a mano.** Varias pruebas leían el stock
con `cells[6]`, y añadir una columna delante las rompió todas de golpe. Se
busca por el título de la cabecera (`findIndex(th => /stock/i…)`).

**El formulario de la nota se congela al mirar una nota vieja**
(`aplicarSoloLecturaNota`). Todo lo que se apague ahí hay que encenderlo en
`descongelarFormularioNota()`, que corre al abrir cualquier nota. Si se apaga
algo y nadie lo enciende, el vendedor se queda sin poder vender hasta que
recargue la app — y eso ya pasó una vez.

---

## Las pruebas

Están en `pruebas/`. Son **Playwright contra la app de verdad**: abren un
navegador, hacen clic, miden y comprueban. No hay pruebas unitarias.

Para correrlas hace falta el navegador y la app servida en el puerto 8099:

```bash
npm install --no-save playwright-core     # una vez
npx playwright-core install chromium      # una vez, se baja ~200 MB

python3 -m http.server 8099 --directory .    # dejarlo corriendo aparte
node pruebas/menus.js
```

En Windows, si `python3` no existe, suele ser `py -m http.server 8099`.

Qué navegador se usa lo decide `pruebas/navegador.js`: la variable `CHROMIUM`
si está puesta, si no la ruta de siempre en Linux, y si tampoco, el que se
bajó Playwright. **No volver a escribir una ruta a fuego en las pruebas**: se
escribieron en Linux y así no arrancaban en ninguna otra máquina.

Cada prueba imprime ✅ o ❌ por línea y al final si hubo errores de
JavaScript. Se pueden correr varias a la vez: cada una abre su propio
navegador y no se pisan.

**Elegir cuáles correr, no correrlas todas.** Son 42 y tardan. Correr las que
tocan lo que se cambió. Si un cambio rompe otra prueba, **arreglarla y
decirlo** — nunca borrarla ni bajarle el listón para que pase.

Algunas necesitan el emulador de Firebase en el puerto 9099 (`cierre.js`,
`usuarios.js`); sin él fallan al arrancar, y eso no significa que la app esté
rota.

**El punto ciego más peligroso:** un clic hecho desde JavaScript atraviesa
cualquier cosa que esté encima. Una prueba puede pasar en verde con el fallo
delante. Si lo que se comprueba es que algo *se ve*, hay que preguntar qué
hay pintado en ese punto (`document.elementFromPoint`), no si existe en el
DOM. Así se escapó el fallo de los desplegables dentro de ventanas.

La carpeta `scratchpad/` es otra cosa: es el borrador, está excluida del
repositorio y ahí va lo que se tira.

---

## Al terminar un cambio

1. Correr las pruebas que tocan lo cambiado.
2. Subir el número de versión en `sw.js`.
3. Actualizar `README.md` si cambió algo que el dueño note al usar la app.
4. Commit en español, contando el motivo del cambio, no solo el qué.
5. **Decir siempre qué quedó roto**, aunque se haya arreglado en el momento.

No abrir un pull request salvo que lo pidan expresamente.
