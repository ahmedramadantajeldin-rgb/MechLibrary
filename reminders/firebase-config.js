/* Firebase WEB app config for Mech Reminders (project: mechhub-reminders, web app: MechHub-Reminders).
 *
 * These values are NOT secrets — Firebase web config is designed to be public; access is controlled by
 * firestore.rules and Firebase Authentication, not by hiding this file.
 *
 * This file keeps the shape reminders.js expects (FIREBASE_CONFIG + isConfigured). The site is served as plain
 * browser ES modules from GitHub Pages (no bundler), so the SDK is loaded from Google's CDN in backend.js —
 * do NOT replace this file with `import ... from "firebase/app"` style code; bare specifiers do not resolve in a browser.
 *
 * Until every REQUIRED value is real, Mech Reminders shows "not connected yet" instead of fake data.
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB0-1MjVrqnlZMIkQQr2jiyu_32d1kmMS4',
  authDomain: 'mechhub-reminders.firebaseapp.com',
  projectId: 'mechhub-reminders',
  storageBucket: 'mechhub-reminders.firebasestorage.app',
  messagingSenderId: '351195022792',
  appId: '1:351195022792:web:70969d45b9e8eed61bacfd',
  measurementId: 'G-JWBCQB89NZ'          // used only by optional Analytics (see backend.js)
};

const REQUIRED = ['apiKey', 'authDomain', 'projectId', 'appId'];

export const isConfigured = () =>
  REQUIRED.every((k) => typeof FIREBASE_CONFIG[k] === 'string' && FIREBASE_CONFIG[k].trim() && !/REPLACE_ME/.test(FIREBASE_CONFIG[k]));
