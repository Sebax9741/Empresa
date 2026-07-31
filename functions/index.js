const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();

/**
 * Deja que un administrador cambie la contraseña de un empleado de su
 * mismo negocio, sin necesitar la contraseña anterior. Solo Cloud Functions
 * (con el SDK de administrador) puede tocar la contraseña de otra cuenta;
 * por eso esto no se puede hacer desde el navegador directamente.
 */
exports.restablecerContrasenaEmpleado = onCall(async (request) => {
  const uidQuienLlama = request.auth && request.auth.uid;
  if (!uidQuienLlama) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const { ownerUid, memberUid, nuevaContrasena } = request.data || {};
  if (!ownerUid || !memberUid || typeof nuevaContrasena !== 'string' || nuevaContrasena.length < 6) {
    throw new HttpsError('invalid-argument', 'Faltan datos o la contraseña debe tener al menos 6 caracteres.');
  }

  const db = getFirestore();

  // Solo un administrador del mismo negocio puede restablecer contraseñas.
  const miMembresia = await db.doc(`usuarios/${ownerUid}/miembros/${uidQuienLlama}`).get();
  if (!miMembresia.exists || miMembresia.data().rol !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo un administrador puede restablecer contraseñas.');
  }

  // El objetivo debe pertenecer al mismo negocio (no cualquier cuenta de Firebase).
  const miembroObjetivo = await db.doc(`usuarios/${ownerUid}/miembros/${memberUid}`).get();
  if (!miembroObjetivo.exists) {
    throw new HttpsError('not-found', 'Ese usuario no pertenece a tu equipo.');
  }

  await getAuth().updateUser(memberUid, { password: nuevaContrasena });

  return { ok: true };
});
