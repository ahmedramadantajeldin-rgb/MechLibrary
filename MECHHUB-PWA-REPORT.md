# MechHub PWA — report

Repository: `MechLibrary` (remote `github.com/ahmedramadantajeldin-rgb/MechLibrary`, branch `main`, commit `04926c0`).
Website: **MechHub**, file `index.html` (identified by inspection; the repo has 12 files: `index.html`, `manifest.webmanifest`, `sw.js`, `404.html`, `favicon.ico`, `icons/*`).

**Nothing was pushed, deployed or committed.** Changes exist only as a patch and four modified files for you to review.
No repository, file or course URL was renamed. No other repository was touched.

---

## 1. Already implemented (verified locally unless noted)

| Feature | Result |
|---|---|
| Manifest linked from `index.html`, valid, correct for the `/MechLibrary/` sub-path (`start_url`/`scope` `./`, `id` `/MechLibrary/`) | Chromium reported **0 manifest errors/warnings** and **0 installability errors** |
| Icons: 192/512 "any" + 192/512 maskable + apple-touch 180 + favicons | All load (HTTP 200, correct dimensions). Maskable artwork stays inside the safe zone (0 stray pixels outside). **Logo unchanged.** |
| Colours | `theme_color`/`background_color` `#151515` match the site header |
| Service worker | Registers at `/MechLibrary/sw.js`, scope `/MechLibrary/`; versioned cache, old caches deleted, network-first shell (4 s timeout), stale-while-revalidate for icons/manifest; **never intercepts course or external URLs** |
| Offline | Reload offline shows the MechHub page with all 9 cards and the offline banner |
| Install button | Worked on Chromium (native prompt) and iOS (instructions) |
| Course links | All 9 cards point to the original `https://ahmedramadantajeldin-rgb.github.io/<repo>/` URLs, same tab (since commit `04926c0`); Drive link opens a new tab with `noopener` |
| Deployed site | Live `manifest.webmanifest` and `sw.js` were fetched as text and **match the repo's `main`** (SW `v3`) |

## 2. Missing or broken

1. **Self-reload on every first visit (bug).** On a first install the new worker claims the page, and the old "update detected" check treated that as an update → the page reloaded itself right after loading (measured: 2 navigations instead of 1).
2. **Manifest `name` was "MechHub — Mechanical Engineering Study Hub"**, not `MechHub`.
3. **Manifest "screenshot" was the 512 px app icon** labelled "home screen" — misleading metadata for the install dialog.
4. **Install experience gaps:** button hidden entirely on browsers with no install prompt (no guidance); no feedback if the prompt was dismissed; no message about already-installed.
5. **Updates only checked on page load**, so an installed app left open for days could stay on an old version.
6. **`404.html` icon links were relative**, so on deep 404 URLs the tab icon would not load (cosmetic).
7. **Course "Back to MechHub" links look broken on 6 of 9 course sites (not changed — other repos; see §6 and the snippet).**

## 3. Files modified (4 files, +46 / −44 lines)

| File | Change | Reason |
|---|---|---|
| `index.html` | Replaced only the PWA `<script>` block (install + SW registration); added `aria-live` to the tip. **No CSS/markup/design changes.** | Fixes 1, 4, 5 |
| `manifest.webmanifest` | `name` → `MechHub`; removed the fake `screenshots` entry | Fixes 2, 3 |
| `sw.js` | `VERSION` `v3` → `v4` (comments updated) | Forces a fresh manifest to be precached on update |
| `404.html` | Icon links → `/MechLibrary/icons/…` and `/MechLibrary/favicon.ico` | Fix 6 |

Not changed: icons, course data/URLs, styles, `Back`/Drive links, repo names, `.git`.

## 4. What is now active (and how it behaves)

- **No self-reload on first visit; exactly one reload when a genuinely new version takes over** (remembers whether a worker already controlled the page).
- **Update check when the app is shown again** (at most once per hour) via `reg.update()`.
- **Install button** (existing design, shown unless already running installed):
  native prompt when the browser offers one (used once, mini-infobar suppressed); on iOS → Share → Add to Home Screen steps; otherwise (no prompt, or prompt dismissed) → short manual instructions incl. "if already installed, open it from your app list". Nothing appears automatically; instructions show only after a click or a dismissed prompt.
- **Visual change:** the only difference on the homepage is that the "Install MechHub" button is now visible in more browsers (pixel-compared: with the button hidden, desktop and mobile are **pixel-identical** to before).

## 5. Tests performed

### Local (Chromium via Playwright, site served under `/MechLibrary/`, localhost)
- Manifest parse, installability errors, icon fetches, SW registration/scope/caches, offline reload, console/page errors: **all clean** (before and after).
- Real Chromium fired `beforeinstallprompt` → install criteria met locally.
- **24/24 behaviour checks pass** (`local-tests/behavior.mjs`): first-visit no reload · one reload on new SW · old cache removed · no reload without change · hourly re-check throttled · install button: accepted, dismissed, no prompt, iOS UA, standalone, `appinstalled` · course opens in same tab · MechHub SW does not control the course page · Back via `history.back()` with no new history entry and no loop · direct visit/bookmark · after in-course navigation · 3 round trips add no tabs and ≤1 history entry · a placeholder `href="#"` back link leaves the user stuck (demonstrates the problem in §6).
- Regression: 9 course URLs identical to the originals; pixel comparison desktop/mobile as above.

> **Simulation note:** the navigation tests use *mock* course pages served from the same local origin (card `href` rewritten locally) because the real course sites are not reachable from this environment. They test the snippet and SW scope logic, **not** the real course pages.

### Deployed website
- Only partially: live `manifest.webmanifest` and `sw.js` fetched as **text** (via a summarising reader) and matched the repo. **Not tested on the deployed site:** icon downloads, installability, SW registration, offline, updates. Please repeat §5 locally-run checks after deploy (Chrome DevTools → Application → Manifest / Service Workers; Lighthouse).
- The raw HTML of the course sites could not be fetched (network blocked); see §6.

### Manual verification required on real devices (not done)
Android Chrome install + open a course + return; iOS Safari Add to Home Screen + open a course + return; desktop Chrome/Edge install window; update flow after deploy (open installed app → deploy → reopen).

## 6. Limitations and findings

**A. Courses are same-origin, but outside the app scope.** MechHub and all courses live on `https://ahmedramadantajeldin-rgb.github.io/`. They are *not* cross-origin, but the MechHub PWA scope is the path `/MechLibrary/`, so `/Heat-Transfer/` etc. are **out of scope**. Per browser behaviour, an installed app typically shows such pages with browser UI (a toolbar / in-app browser) rather than as part of the app; behaviour differs by platform and **I could not verify it on any device**. Same-tab navigation (current) is the best default: `target=_blank` would more likely leave the app for the system browser. The service worker never touches course pages.

**B. Optional, NOT applied — widen the scope.** Because they share the origin, setting `"scope": "/"` in the manifest (start_url stays `./`) *might* keep courses inside the app window. Do **not** do it until every course has a working Back link: in a standalone window with no browser UI, a course page with a dead back link becomes a dead end. Needs device testing; it would also put every site on that origin inside the app's scope.

**C. Course "Back to MechHub" links (read from a text conversion of each live page, NOT raw HTML — please verify with View Source):**

| Course | Repo | Back link seen |
|---|---|---|
| Heat Transfer | `Heat-Transfer` | `href="#"` |
| Fluid Mechanics II | `Fluid2` | `href="#"` (header + menu) |
| Mechanical Measurements | `measurement` | `href="#"` |
| Basics of Electrical Machines | `PME302` | `href="#"` |
| Mechanical Design II | `design2` | `…/MechLibrary/` ✔ |
| Engineering Economy | `economy` | `…/MechLibrary/` ✔ |
| Thermodynamics III | `tageldien` | **none found** |
| Mechanical Design I | `my-website` | `href="#"` |
| Numerical Methods | `math302` | `href="#"` |

A `#` link only jumps to the top of the same page. It might be filled in by JavaScript the converter dropped, so treat this as a lead, not a verdict. `course-repo-snippet/back-to-mechhub.html` is a tested replacement (real URL, `history.back()` only when it is safe, never traps the user). I did not modify any course repo.

**D. Other notes**
- Already-installed copies may keep the old long app name until the browser refreshes the manifest (the home-screen label uses `short_name`, unchanged).
- Existing visitors get one automatic reload when `v4` takes over.
- `404.html` and its back button hard-code `/MechLibrary/`; fine while the repo name stays.
- Your local working files use Windows line endings (CRLF) while Git has LF; content is identical to `main`.
- The `pwa-improvements` branch is one commit behind `main`; no action taken.

## 7. Actions needed from you

1. (Done) The PWA changes were applied to the repository root. The one-off delivery copies (`mechhub-pwa.patch` and `modified-files/`) were removed in the Mech Reminders cleanup; they were superseded by the files in the repository.
2. **Approve** before anything is committed/pushed — I have not done it.
3. After deploy: run the device checks in §5 and the DevTools/Lighthouse checks on the live URL.
4. Verify the Back links in the 7 course repos with View Source and, if confirmed, add the snippet (course repos are yours to change).
5. Decide whether to try the optional scope change (§6B) after step 4 and device testing.
