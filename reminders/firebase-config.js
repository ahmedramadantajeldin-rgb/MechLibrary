/* Firebase WEB app config for Mech Reminders (project: mechhub-reminders, web app: MechHub-Reminders).
 *
 * These values are NOT secrets — Firebase web config is designed to be public. Access is controlled by
 * Firebase Authentication and firestore.rules, never by hiding this file.
 *
 * Format note: this site runs on GitHub Pages as plain browser ES modules (no bundler, no import map),
 * so Firebase is loaded from Google's CDN in backend.js. Do not replace this file with an npm-style
 * `import ... from "firebase/app"` version: bare module names cannot be resolved by the browser.
 *
 * If any value is missing or still "REPLACE_ME", Mech Reminders shows "not connected yet" instead of fake data.
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB0-1MjVrqnlZMIkQQr2jiyu_32d1kmMS4',
  authDomain: 'mechhub-reminders.firebaseapp.com',
  projectId: 'mechhub-reminders',
  storageBucket: 'mechhub-reminders.firebasestorage.app',
  messagingSenderId: '351195022792',
  appId: '1:351195022792:web:70969d45b9e8eed61bacfd',
  measurementId: 'G-JWBCQB89NZ'
};

export const isConfigured = () =>
  Object.values(FIREBASE_CONFIG).every((v) => typeof v === 'string' && v.trim() && !/REPLACE_ME/.test(v));
