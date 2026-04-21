import admin from 'firebase-admin';
import https from 'https';

// On machines with corporate SSL inspection, Google's certificate chain is
// replaced by a self-signed corp cert — disable verification for dev only.
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' && process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// Patch the global https agent so Firebase Admin SDK requests go through
(https.globalAgent as unknown as { options: { rejectUnauthorized: boolean } }).options.rejectUnauthorized =
  process.env.NODE_ENV === 'production';

if (!admin.apps.length) {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }
}

export default admin;
