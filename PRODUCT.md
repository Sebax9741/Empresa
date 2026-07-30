# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **El administrador (dueño de Importadora Nueva Vista S.A.C):** controla toda la operación de crédito, decide permisos por empleado, cierra las hojas de cobranza al final del día, y es el único que puede saltarse un candado con su código de seguridad.
- **Empleados cobradores:** trabajan en la calle, tablet en mano, muchas veces sin internet. Crean la hoja de cobranza del día, cobran cuota por cuota, hacen firmar al cliente y suben fotos de la boleta física. Sus permisos son granulares y los define el administrador (crear, editar, pagos, borrar, cobranza, clientes, crear hoja, cambiar vencimiento).

## Product Purpose

Llevar el control de los créditos que Importadora Nueva Vista S.A.C. le da a sus clientes de distribución: quién debe, cuánto, desde cuándo, cuándo vence, y qué se le ha cobrado. Reemplaza el cuaderno/hoja de cobranza en papel por una app que funciona en celular, tablet y computadora, con los mismos datos sincronizados en la nube para todo el equipo.

## Positioning

Herramienta interna, no un producto que se vende a terceros. Su ventaja frente a llevar cuentas en papel o en una hoja de cálculo suelta es la combinación de: hoja de cobranza diaria con apertura/cierre auditado por hora de servidor, firma digital del cliente en cada cobro, y funcionamiento completo sin internet en la calle con sincronización automática al volver la señal.

## Operating Context

- Ventas a crédito puerta a puerta: el empleado despacha el producto y cobra las cuotas en la casa/negocio del cliente, no en un local fijo.
- El cobro diario se organiza en una "hoja de cobranza" por fecha, que el empleado debe crear al empezar su turno; el administrador la cierra al final del día y desde ahí queda bloqueada salvo con código de seguridad.
- Cada crédito lleva una boleta física (papel) cuya foto se guarda en la app; el cliente firma en la tablet al recibir un pago.
- Zonas de reparto/cobro ya identificadas: MODELO, 3 DE MAYO, CIUDAD, MILAGROS, CARRETERA, PADRE ALDAMIZ, ALAMEDA.
- Métodos de pago que se registran: Efectivo, Yape, BCP.
- Trabajo mayormente en tablets Android en la calle, con conexión intermitente o nula; también se usa desde celular/computadora para administración.

## Capabilities and Constraints

- Multi-dispositivo con base de datos en la nube (Firebase/Firestore) en tiempo real; también funciona completamente offline (clientes, créditos, cobros, firmas y fotos guardados en el dispositivo) con sincronización automática al recuperar señal.
- Permisos granulares por empleado, definidos por el administrador: crear, editar, registrar pagos, borrar, ver/exportar cobranza, registrar/editar clientes, crear la hoja de cobranza del día, cambiar la fecha de vencimiento.
- Código de seguridad (PIN de 4 dígitos, hash SHA-256 con sal) del administrador, requerido para acciones destructivas o para tocar una hoja de cobranza ya cerrada.
- Hora de apertura/cierre de cada hoja de cobranza tomada del servidor de Firebase, nunca del dispositivo, para que un empleado no pueda adelantar/atrasar el reloj de su tablet.
- Exportación e impresión de hojas de cobranza (con fecha de emisión y fecha de despacho de cada crédito) y respaldo/restauración de toda la base con fotos incluidas.
- Se distribuye como PWA instalable y como APK de Android (empaquetado con Capacitor); no es una app nativa con lenguaje de diseño propio de la plataforma.
- Único negocio, un solo administrador. No está pensada (por ahora) para venderse a otros dueños de negocio como multi-tenant.

## Brand Commitments

- Negocio: **Importadora Nueva Vista S.A.C.**
- Nombre de la app tal como aparece hoy: "Control de Créditos" (título/marca de la app en sí, no del negocio).
- Logo/colores de marca: aún no definidos/entregados.

## Evidence on Hand

- Código fuente completo de la app (index.html, js/app.js, css/styles.css) como implementación visual incumbente.
- README.md del proyecto documenta a detalle cada función ya construida.
- Sin activos de marca (logo, paleta) entregados todavía para Importadora Nueva Vista S.A.C.

## Product Principles

1. Lo que el empleado hace en la calle sin internet debe funcionar igual que con internet; la nube nunca puede ser un bloqueo para cobrar o consultar.
2. Ninguna hora ni fecha crítica (apertura/cierre de hoja, registro de pago) puede depender del reloj del dispositivo del empleado.
3. El administrador conserva siempre una vía de anulación (PIN) sobre cualquier candado que un permiso granular le ponga a un empleado.
4. Cada acción sensible (crear/cerrar hoja, cambiar vencimiento, editar fecha de un pago) deja constancia de quién y cuándo, en vez de prohibir directamente.
5. La app es una herramienta interna de un solo negocio: prioriza la operación real de Importadora Nueva Vista S.A.C. sobre la genericidad multi-cliente.
