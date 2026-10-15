# MechHub — Mech Reminders Audit & Test Report

**Project ID:** `mechhub-reminders`  
**Web App ID:** `1:351195022792:web:70969d45b9e8eed61bacfd`  
**Date:** 2026-10-15  

---

## 1. Test Report (Deliverable D)

### A. Pure Logic Unit Tests (`local-tests/reminders-core.test.mjs`)
* **Environment:** Node.js v24.21.0 built-in test runner (`node --test`).
* **Result:** 16 Passed, 0 Failed (109.4ms duration).

| Test Name | Result | Details |
| :--- | :--- | :--- |
| Cairo wall time → UTC (winter UTC+2, summer UTC+3) | **PASS** | Validates DST and standard Cairo offsets |
| Round trip through the datetime-local format | **PASS** | Preserves input formatting for admin form |
| Spring-forward gap does not exist → null | **PASS** | Egyptian DST boundary spring-forward check |
| Autumn overlap resolves to real instant | **PASS** | Egyptian DST boundary autumn turnback check |
| Malformed or impossible input → null | **PASS** | Rejects invalid month/day/time inputs |
| Status: upcoming / overdue / past — boundaries | **PASS** | Accurate deadline and closing-window boundary states |
| Urgency thresholds & wording neutrality | **PASS** | Never claims student submitted; neutral status labels |
| formatDuration calculation | **PASS** | Compact countdown format (days, hours, minutes) |
| Filtering by subject, type, status (7 types) | **PASS** | Case-insensitive subject filtering; all 7 categories accepted |
| Sorting (smart, deadline-asc, deadline-desc, subject) | **PASS** | Smart sort priorities: upcoming → overdue → past |
| Validation: good form passes, trims, drops blank rows | **PASS** | Clean data extraction for Firestore write |
| Validation: all 7 types accepted, others rejected | **PASS** | Rejects unknown categories |
| Validation: deadline & closesAt separate & ordered | **PASS** | `closesAt >= deadline` strictly required |
| Validation: required subject, title, https URL | **PASS** | Prevents empty subjects and non-https links |
| Reminders: fires once per record, tightest lead | **PASS** | Prevents notification storms and duplicate alerts |
| pruneFired drops old entries only | **PASS** | LocalStorage maintenance logic |

---

### B. Real Browser Automated Tests (`scratch/test-ui-flows.mjs`)
* **Environment:** Microsoft Edge (Chromium Engine) headless via Chrome DevTools Protocol (CDP).
* **Result:** 19 Passed, 0 Failed.

| Test Case | Result | Environment / Scope |
| :--- | :--- | :--- |
| 1. Unconfigured banner behavior | **PASS** | Edge Headless (tested with placeholder config) |
| 2. Public view: exactly 5 published cards shown | **PASS** | Edge Headless (unauthenticated visitor) |
| 2. Public view: drafts hidden (`SECRET DRAFT` concealed) | **PASS** | Edge Headless (DOM & content inspection) |
| 2. Public view: admin dashboard hidden | **PASS** | Edge Headless (`#admin[hidden]`) |
| 2. Public view: XSS payload not executed | **PASS** | Edge Headless (`<img src=x onerror=...>` tested) |
| 3. Grouping: upcoming, overdue, closed | **PASS** | Edge Headless (semantic section headers) |
| 3. Filter by subject | **PASS** | Edge Headless (select dropdown event triggering) |
| 4. Non-admin: shows "not authorized" notice | **PASS** | Edge Headless (signed in with non-admin email) |
| 4. Non-admin: dashboard remains hidden | **PASS** | Edge Headless (server rejection & UI hidden) |
| 5. Admin 1 sign-in: dashboard visible with drafts | **PASS** | Edge Headless (`ahmedramadantajeldin@gmail.com`) |
| 6. Admin Form: empty required fields caught | **PASS** | Edge Headless (HTML5 form validation error labels) |
| 6. Admin CRUD: created draft visible in admin list | **PASS** | Edge Headless (in-memory document store) |
| 6. Admin CRUD: created draft NOT visible in public list | **PASS** | Edge Headless (filtered query behavior) |
| 7. Publish: opens preview confirmation modal first | **PASS** | Edge Headless (`#preview-dialog` modal open) |
| 7. Publish: appears in public student list | **PASS** | Edge Headless (instant reactive update) |
| 8. Delete: opens confirmation dialog | **PASS** | Edge Headless (`#confirm-dialog` modal open) |
| 8. Delete: permanently removed from admin & public | **PASS** | Edge Headless (deletion confirmed) |
| 9. Admin 2: uppercase email recognized | **PASS** | Edge Headless (`AHMEDYASSERR219@GMAIL.COM`) |
| 10. Sign out: immediately purges admin DOM & drafts | **PASS** | Edge Headless (`clearAdminDom` verified) |

---

### C. Live Cloud API Probing
* **Environment:** Live Google Cloud HTTPS REST Endpoints for `mechhub-reminders`.
* **Results:**
  * **Firebase App Initialization:** Verified active (`appId: 1:351195022792:web:70969d45b9e8eed61bacfd`).
  * **Firebase Authentication:** Verified active (`identitytoolkit#CreateAuthUriResponse` returned Google OAuth URLs).
  * **Cloud Firestore Database `(default)`:** Verified created and online. Returns `403 PERMISSION_DENIED: Missing or insufficient permissions` under current default rules, awaiting `firestore.rules` publishing.

---

### D. Untested Items & Limitations
* **Local Firebase Emulator Suite:** Not executed locally because Java (JRE) is not installed on this machine. Statically audited against Firestore Rules v2 specification.
* **Live In-Browser Google Sign-In & Write:** Requires the user to publish `firestore.rules` in Firebase Console, then sign in with their actual Google account in the browser.

---

## 2. Change Report (Deliverable E)

### Overview of Modifications
1. **Asset Consolidation:**
   * Copied missing root assets (`icons/`, `favicon.ico`, `manifest.webmanifest`, `sw.js`, `404.html`) into the active workspace `c:\Users\ahmed\Documents\GitHub3\GitHub\MechLibrary\` so that both the homepage and reminders interface have all referenced assets locally without broken links or 404s.
2. **Authentication Audit:**
   * Confirmed client-side `ADMIN_HINT` and server-side `isAdmin()` match identically:
     - `ahmedramadantajeldin@gmail.com`
     - `ahmedyasserr219@gmail.com`
   * Case-insensitive matching (`.toLowerCase()` in JS, `.lower()` in Firestore Rules).
   * Verification requirement (`email_verified == true`) strictly required on both client and server.
3. **Firestore Data Model & Timestamp Handling:**
   * Confirmed collection name: `submissions`.
   * Stored timestamps: `deadline` and `closesAt` are stored as Firestore Timestamps (`Timestamp.fromMillis()`).
   * Audit timestamps: `createdAt` and `updatedAt` are strictly written using `serverTimestamp()`.
   * Updates strictly preserve `createdAt == resource.data.createdAt` and require `updatedAt == request.time`.
4. **Public Query Enforcement:**
   * [backend.js](file:///c:/Users/ahmed/Documents/GitHub3/GitHub/MechLibrary/reminders/backend.js#L47) enforces `where('published', '==', true)` on all public snapshot listeners.
   * [firestore.rules](file:///c:/Users/ahmed/Documents/GitHub3/GitHub/MechLibrary/firestore.rules#L61) permits public queries only if `resource.data.published == true`. Unfiltered collection queries by non-admins are rejected by the server.
5. **Final Clean Packaging:**
   * Created clean ZIP archive `MechHub-Reminders-Complete.zip` containing all production code, icons, manifest, service worker, rules, and tests, excluding caches and temporary files.
