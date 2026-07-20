/* Avisos de vencimiento en Android (notificaciones locales de Capacitor).
   En iPhone/PC/web esto no hace nada (queda el "aviso al abrir la app").
   El archivo funciona tanto en el navegador como en Node (para pruebas). */
(function (global) {
  'use strict';

  /* Hash estable string -> entero positivo (id que exige Capacitor). */
  function idNumerico(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return Math.abs(h) % 2000000000 + 1;
  }

  function mismaFecha(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  /* Función pura y testeable: devuelve las notificaciones a programar.
     Programa un aviso el DÍA del vencimiento a las 09:00 (hora local) para
     cada crédito no pagado. Si vence hoy y ya pasaron las 09:00, avisa enseguida.
     Los vencimientos de días anteriores no se reprograman (solo "ese día"). */
  function calcularNotificaciones(creditos, ahora, moneda) {
    moneda = moneda || '$';
    const items = [];
    for (const c of creditos) {
      if (!c || c.estado === 'pagado' || !c.vencimiento) continue;
      const partes = String(c.vencimiento).split('-').map(Number);
      if (partes.length !== 3 || partes.some(isNaN)) continue;
      const [y, m, d] = partes;
      const venc9 = new Date(y, m - 1, d, 9, 0, 0, 0);
      const soloFechaVenc = new Date(y, m - 1, d);
      const soloFechaHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());

      let at;
      if (mismaFecha(venc9, ahora)) {
        at = (ahora.getTime() >= venc9.getTime()) ? new Date(ahora.getTime() + 30000) : venc9;
      } else if (soloFechaVenc.getTime() > soloFechaHoy.getTime()) {
        at = venc9; // vence en el futuro: avisar ese día a las 09:00
      } else {
        continue;  // ya venció en días anteriores: no reprogramar
      }

      const montoTxt = `${moneda} ${(Number(c.monto) || 0).toLocaleString('es', { maximumFractionDigits: 2 })}`;
      items.push({
        id: idNumerico(String(c.id)),
        title: '⚠️ Crédito vence hoy',
        body: `Boleta ${c.boleta} de ${c.cliente} por ${montoTxt} vence hoy.`,
        atISO: at.toISOString(),
      });
    }
    return items;
  }

  /* Reprograma las notificaciones nativas (solo Android/Capacitor). */
  let temporizador = null;
  function programarAvisos(creditos, opciones) {
    opciones = opciones || {};
    clearTimeout(temporizador);
    temporizador = setTimeout(() => reprogramar(creditos, opciones), 800);
  }

  async function reprogramar(creditos, opciones) {
    const cap = global.Capacitor;
    const LN = cap && cap.Plugins && cap.Plugins.LocalNotifications;
    const esNativo = cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform();
    if (!LN || !esNativo) return; // en web/iPhone/PC no aplica

    try {
      // Borra los avisos que habíamos programado antes
      const pendientes = await LN.getPending();
      if (pendientes && pendientes.notifications && pendientes.notifications.length) {
        await LN.cancel({ notifications: pendientes.notifications.map(n => ({ id: n.id })) });
      }

      if (opciones.activado === false) return; // el usuario apagó los avisos

      // Pide permiso (Android 13+ lo requiere)
      let permiso = await LN.checkPermissions();
      if (permiso.display !== 'granted') {
        permiso = await LN.requestPermissions();
        if (permiso.display !== 'granted') return;
      }

      const items = calcularNotificaciones(creditos, new Date(), opciones.moneda);
      if (!items.length) return;
      await LN.schedule({
        notifications: items.map(it => ({
          id: it.id,
          title: it.title,
          body: it.body,
          schedule: { at: new Date(it.atISO), allowWhileIdle: true },
        })),
      });
    } catch (e) {
      console.warn('No se pudieron programar los avisos:', e);
    }
  }

  global.Avisos = { calcular: calcularNotificaciones, programar: programarAvisos, idNumerico };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calcularNotificaciones, idNumerico };
  }
})(typeof window !== 'undefined' ? window : globalThis);
