# Mech Reminders — setup and reference

Mech Reminders lives at `reminders/` (public URL: `https://ahmedramadantajeldin-rgb.github.io/MechLibrary/reminders/`) and has a card on the MechHub homepage.
The page works only after you connect a Firebase project. Until then it shows “not connected yet” and no data. **Nothing below has been done for you** — it needs your Google/Firebase account.

## Status of the Firebase connection

Already done in the code: `reminders/firebase-config.js` holds the web config of project **mechhub-reminders** (web app *MechHub-Reminders*). Firebase is loaded from Google's CDN (`backend.js`, SDK 10.14.1 — a version that appears in Firebase's official JS release notes; the CDN file itself could not be fetched from the author's offline environment) and the app is initialized only once.

Not integrated on purpose: **Firebase Analytics** (optional; adds third-party tracking to a student page; `measurementId` is stored in the config but unused) and **Firebase Hosting** (the site stays on GitHub Pages).

Do not replace `reminders/firebase-config.js` with an npm-style file that uses `import ... from "firebase/app"`: this site has no bundler, so the browser cannot resolve bare module names and the page would break.

## What you must still do in the Firebase Console (nobody can do this for you)

1. **Authentication → Sign-in method → Google → Enable** (choose a support e-mail) → Save.
2. **Authentication → Settings → Authorized domains → Add domain:** `ahmedramadantajeldin-rgb.github.io`. A linked Hosting site only authorizes the `firebaseapp.com` / `web.app` domains, not GitHub Pages. Without this, sign-in fails with “unauthorized domain”.
3. **Firestore Database → Create database** (Production mode, pick a region) if it does not exist yet.
4. **Firestore → Rules:** replace everything with the contents of `firestore.rules` → **Publish** (or `firebase deploy --only firestore:rules`). (This is what protects the data.)
4b. **First sign-in as the owner:** click **Import previous administrators** in Admin Management (one time) so the three earlier administrators keep their access (`ahmedyasserr219` is imported as a manager).
5. **Commit and push** the changed files when you approve (nothing has been pushed for you).

## Verify it (please do these on the live site)

| Check | Expected |
|---|---|
| Open the homepage logged out | “Mech Reminders” card is visible; it opens the page |
| Open Mech Reminders logged out | Page loads; only published records; no admin controls |
| Sign in with `ahmedramadantajeldin@gmail.com` | Dashboard appears; create / edit / publish / unpublish / delete work |
| Sign in with `ahmedyasserr219@gmail.com` (after the one-time import) | Same shared dashboard and data; **no** Admin Management section |
| Owner: add a new e-mail, sign in with it | Dashboard appears at once; revoke it → the open page loses the dashboard within seconds |
| Sign in with any other Google account | “not authorized” note, no dashboard |
| Open the same page on a second device | Same records (data is in Firestore) |
| Firebase console → Firestore → Rules → *Rules Playground* | An unauthenticated *write* to `submissions/x` is denied; a *read* of an unpublished document is denied |
| Optional automated rules test | `npm i -D @firebase/rules-unit-testing firebase` then `npx firebase-tools emulators:exec --only firestore --project demo-mech "node --test local-tests/rules.test.mjs"` |

## How it is built

* **Auth:** Firebase Authentication, Google sign-in (popup). Identity (verified e-mail) comes from Google’s signed token.
* **Data:** Cloud Firestore, one collection `submissions`. Each record: `subject`, `type` (7 allowed values), `deadline`, `closesAt` (both timestamps, stored in UTC, shown in Cairo time), optional `courseCode` / `description`, `attachments[]` (`title`, `url` https only, optional `description`, max 10), `published`, `createdAt`, `updatedAt`.
* **Security:** `firestore.rules`.
  * Anyone may read a record only if `published == true`. Unpublished records are readable by admins only.
  * Create/update/delete require a **verified** e-mail that is the owner or has an **active** entry in the `admins` collection (re-checked on every request), and the data must pass the same validation as the form (type list, closes ≥ deadline, https links, field sizes, server timestamps).
  * The browser never receives a secret. Hiding buttons is only cosmetic; the rules decide.
* **Public vs. admin data:** public pages query `published == true` only; admins subscribe to the whole collection.
* **PWA:** `sw.js`, `manifest.webmanifest` are unchanged. The service worker ignores `reminders/` (it only handles the homepage shell and icons), so the Reminders page and its data are never served from a cache and always load the latest code. Consequence: **the Reminders page needs a connection** (it shows the offline banner).

## Notifications — exactly what exists

* **Implemented:** in-page indicators (time left, urgent < 24 h, soon < 72 h, “deadline passed, still open”, closed) and **browser notifications while the page is open** (tab or installed app) 24 h / 3 h / 1 h before a deadline, chosen per device in *Reminder settings*. Each reminder fires once; opening the page late gives one notification, not several.
* **Not implemented:** e-mail, push messages, or any notification while the app/browser is closed. Those need a server that runs on a schedule: Firebase Cloud Messaging (web push + service-worker `push` handler) and a scheduled Cloud Function, which in turn needs Firebase’s paid Blaze plan, plus a way for each student to opt in. Say the word and this can be designed separately; it was not added because it cannot be configured safely without your Firebase project and billing decisions.
* Mobile browsers (especially iOS, which only allows web notifications for an app added to the Home Screen) may suppress them; the in-page indicators always work.

## Things you may want to change

* **Admins:** no code or rules edit is needed any more. The owner (`ahmedramadantajeldin@gmail.com`, fixed in `ownerEmail()` in `firestore.rules` and `OWNER_EMAIL` in `reminders/core.js`) manages everything in **Admin Management**; the list lives in Firestore (`admins/{e-mail}`). The owner can also give an administrator the **manager right** (`canManageAdmins`): managers (initially `ahmedyasserr219@gmail.com`) can add administrators and revoke / restore / remove *ordinary* ones, but cannot touch the owner, other managers or themselves, and cannot grant the right. Changing the owner itself is the only thing that still needs a rules edit + re-publish.
* **Time zone:** `TZ` at the top of `reminders/core.js` (default `Africa/Cairo`). Admins type times in this zone regardless of the device zone.
* **Firebase SDK version:** `SDK_VERSION` in `reminders/backend.js` (loaded from Google’s CDN; the exact version was not loadable from the author’s offline environment — if the page reports “Could not load the Firebase library”, check this value against <https://firebase.google.com/support/release-notes/js>).
* **Card position:** the homepage card sits directly under the Drive card. To show it first, move `<div id="reminders-slot">` above `<div id="drive-slot">` in `index.html` (and move `#reminders-slot{margin-top:16px}` to `#drive-slot`).

## Known limitations

* PDFs are **links** to existing files; nothing is uploaded or stored.
* Sign-in uses a pop-up; browsers that block pop-ups show a message. Installed iOS web apps can be awkward with pop-ups — administrators can sign in from the normal browser.
* “Closing time” must be the same as or later than the “deadline”; both are stored and shown separately.
* A student’s submission status is unknown to this tool, so it never says “submitted”, “late” or “missed”.
* No App Check / rate limiting is configured (free-tier quotas apply: Firestore’s free read quota is ample for a class, but a public page can be scripted by anyone — enable App Check later if you ever see abuse).
