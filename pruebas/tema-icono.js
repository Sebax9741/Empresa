const { chromium } = require('playwright-core');

/* Foto del icono en varios momentos del cambio, para mirar con los ojos que
   de verdad se dobla en vez de parpadear de un dibujo a otro. */
(async () => {
  const b = await chromium.launch({ executablePath: require('./navegador') });
  const p = await (await b.newContext({ viewport: { width: 520, height: 120 },
    serviceWorkers: 'block', deviceScaleFactor: 3 })).newPage();
  await p.route('**/firebase-config.js', r => r.fulfill({
    contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG={apiKey:"X"};' }));
  await p.goto('http://localhost:8099/index.html');
  await p.waitForTimeout(1300);

  // Seis copias del mismo icono, cada una congelada en un punto del camino
  await p.evaluate(() => {
    const original = document.getElementById('btn-tema');
    const tira = document.createElement('div');
    tira.style.cssText = 'display:flex;gap:30px;padding:24px 30px;align-items:center';
    for (let i = 0; i < 6; i++) {
      const c = original.cloneNode(true);
      c.id = 'copia-' + i;
      // Cada máscara necesita su propio nombre o todas usan la primera
      c.querySelector('mask').id = 'm' + i;
      c.querySelector('[mask]').setAttribute('mask', `url(#m${i})`);
      c.style.transform = 'scale(1.7)';
      tira.appendChild(c);
    }
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:var(--bg)';
    document.body.appendChild(tira);
    // Se congela cada copia en su punto: 0 %, 20 %, 40 %, 60 %, 80 % y 100 %
    [0, 0.2, 0.4, 0.6, 0.8, 1].forEach((f, i) => {
      const c = document.getElementById('copia-' + i);
      c.querySelector('.tema-astro').style.cssText = `transition:none;transform:scale(${1 + 0.14 * f})`;
      c.querySelector('.tema-muerde').style.cssText = `transition:none;transform:translateX(${-8.5 * f}px)`;
      c.querySelector('.tema-rayos').style.cssText =
        `transition:none;transform:rotate(${-45 * f}deg) scale(${1 - 0.6 * f});opacity:${1 - f}`;
    });
  });
  await p.waitForTimeout(300);
  await p.screenshot({ path: 'pruebas/tema-icono.png' });
  console.log('✅ Foto del icono guardada en pruebas/tema-icono.png');
  await b.close();
})();
