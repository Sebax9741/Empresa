/* Dónde está el Chromium con el que corren las pruebas.

   Antes cada prueba llevaba escrita a fuego la ruta de la máquina Linux
   donde se escribieron. En Windows o en un Mac eso no existe y las 42
   fallaban antes de abrir el navegador, sin que el fallo tuviera nada que
   ver con la app.

   Ahora se busca por orden:
     1. Lo que diga la variable CHROMIUM, si alguien la puso a propósito
     2. La ruta de siempre en Linux, si de verdad está ahí
     3. Nada: entonces Playwright usa el navegador que se bajó él mismo
        (el que deja `npx playwright-core install chromium`)

   Devolver `undefined` no es un descuido: es justo lo que Playwright espera
   para decidir por su cuenta. */
const fs = require('fs');

const RUTA_LINUX = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

module.exports = process.env.CHROMIUM
  || (fs.existsSync(RUTA_LINUX) ? RUTA_LINUX : undefined);
