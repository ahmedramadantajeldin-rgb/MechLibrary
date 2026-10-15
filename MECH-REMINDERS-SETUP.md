# Mech Reminders — setup and reference

Mech Reminders lives at `reminders/` (public URL: `https://ahmedramadantajeldin-rgb.github.io/MechLibrary/reminders/`) and has a card on the MechHub homepage.
The page works only after you connect a Firebase project. Until then it shows “not connected yet” and no data. **Nothing below has been done for you** — it needs your Google/Firebase account.

## What you must do (about 10 minutes, free “Spark” plan is enough)

1. **Create a Firebase project** at <https://console.firebase.google.com> → *Add project*. (Google Analytics is not needed.)
2. **Register a web app**: Project settings → *Your apps* → `</>` Web → give it any nickname. Do **not** tick “Firebase Hosting”. Copy the `firebaseConfig` values it shows.
3. **Config** — already filled in `reminders/firebase-config.js` for project `mechhub-reminders` (web app `MechHub-Reminders`). These values are public by design; they are not secrets. Keep the file's shape (`FIREBASE_CONFIG` + `isConfigured`): the site has no bundler, so do not replace it with `import … from "firebase/app"` code.
4. **Enable sign-in**: Build → Authentication → *Get started* → Sign-in method → **Google** → Enable (choose a support email) → Save.
5. **Authorize the website**: Authentication → Settings → *Authorized domains* → *Add domain* → `ahmedramadantajeldin-rgb.github.io`. (`localhost` is already allowed for local testing.) Without this, sign-in fails with “unauthorized domain”.
6. **Create the database**: Build → Firestore Database → *Create database* → **Production mode** → pick a region near you.
7. **Publish the security rules** (this is what actually protects the data): Firestore → *Rules* tab → replace everything with the contents of `firestore.rules` → **Publish**.
8. **Commit and push** the new/changed files when you are ready (nothing has been pushed for you).

## Verify it (please do these on the live site)

| Check | Expected |
|---|---|
| Open the homepage logged out | “Mech Reminders” card is visible; it opens the page |
| Open Mech Reminders logged out | Page loads; only published records; no admin controls |
| Sign in with `ahmedramadantajeldin@gmail.com` | Dashboard appears; create / edit / publish / unpublish / delete work |
| Sign in with `ahmedyasserr219@gmail.com` | Same shared dashboard and the same data |
| Sign in with any other Google account | “not authorized” note, no dashboard |
| Open the same page on a second device | Same records (data is in Firestore) |
| Firebase console → Firestore → Rules → *Rules Playground* | An unauthenticated *write* to `submissions/x` is denied; a *read* of an unpublished document is denied |
| Optional automated rules test | `npm i -D @firebase/rules-unit-testing firebase` then `npx firebase-tools emulators:exec --only firestore --project demo-mech "node --test local-tests/rules.test.mjs"` |

## How it is built

* **Auth:** Firebase Authentication, Google sign-in (popup). Identity (verified e-mail) comes from Google’s signed token.
* **Data:** Cloud Firestore, one collection `submissions`. Each record: `subject`, `type` (7 allowed values), `deadline` (timestamp in UTC, shown in Cairo time), optional `closesAt` (closing timestamp, if provided must be >= deadline), optional `courseCode` / `description`, `attachments[]` (`title`, `url` https only, optional `description`, max 10), `published`, `createdAt`, `updatedAt`.
* **Security:** `firestore.rules`.
  * Anyone may read a record only if `published == true`. Unpublished records are readable by admins only.
  * Create/update/delete require a **verified** e-mail equal (case-insensitively) to one of the two allowed addresses, and the data must pass the same validation as the form (type list, closes ≥ deadline if present, https links, field sizes, server timestamps).
  * The browser never receives a secret. Hiding buttons is only cosmetic; the rules decide.
* **Public vs. admin data:** public pages query `published == true` only; admins subscribe to the whole collection.
* **PWA:** `sw.js`, `manifest.webmanifest` are unchanged. The service worker ignores `reminders/` (it only handles the homepage shell and icons), so the Reminders page and its data are never served from a cache and always load the latest code. Consequence: **the Reminders page needs a connection** (it shows the offline banner).

## Notifications — exactly what exists

* **Implemented:** in-page indicators (time left, urgent < 24 h, soon < 72 h, “deadline passed, still open”, closed) and **browser notifications while the page is open** (tab or installed app) 24 h / 3 h / 1 h before a deadline, chosen per device in *Reminder settings*. Each reminder fires once; opening the page late gives one notification, not several.
* **Not implemented:** e-mail, push messages, or any notification while the app/browser is closed. Those need a server that runs on a schedule: Firebase Cloud Messaging (web push + service-worker `push` handler) and a scheduled Cloud Function, which in turn needs Firebase’s paid Blaze plan, plus a way for each student to opt in. Say the word and this can be designed separately; it was not added because it cannot be configured safely without your Firebase project and billing decisions.
* Mobile browsers (especially iOS, which only allows web notifications for an app added to the Home Screen) may suppress them; the in-page indicators always work.

## Things you may want to change

* **Admins:** edit the list in **both** `firestore.rules` (authoritative; re-publish it) and `ADMIN_HINT` at the top of `reminders/reminders.js` (only decides whether the dashboard is shown).
* **Time zone:** `TZ` at the top of `reminders/core.js` (default `Africa/Cairo`). Admins type times in this zone regardless of the device zone.
* **Analytics (optional):** if `measurementId` is present in `firebase-config.js`, `backend.js` loads Firebase Analytics in the background. If it is blocked or fails, only a console warning is logged and the page is unaffected. Delete `measurementId` from the config to turn it off.
* **Firebase SDK version:** `SDK_VERSION` in `reminders/backend.js` (loaded from Google’s CDN; the exact version was not loadable from the author’s offline environment — if the page reports “Could not load the Firebase library”, check this value against <https://firebase.google.com/support/release-notes/js>).
* **Card position:** the homepage card sits directly under the Drive card. To show it first, move `<div id="reminders-slot">` above `<div id="drive-slot">` in `index.html` (and move `#reminders-slot{margin-top:16px}` to `#drive-slot`).

## Known limitations

* PDFs are **links** to existing files; nothing is uploaded or stored.
* Sign-in uses a pop-up; browsers that block pop-ups show a message. Installed iOS web apps can be awkward with pop-ups — administrators can sign in from the normal browser.
* “Closing time” is optional; if provided, it must be the same as or later than the “deadline”.
* A student’s submission status is unknown to this tool, so it never says “submitted”, “late” or “missed”.
* No App Check / rate limiting is configured (free-tier quotas apply: Firestore’s free read quota is ample for a class, but a public page can be scripted by anyone — enable App Check later if you ever see abuse).
