Local test scripts used to verify the changes (Playwright + Chromium). They are NOT part of the repository.
Setup:  npm i playwright-core   (Chromium path is hard-coded to /opt/pw-browsers/chromium; edit executablePath for your machine)
Serve the site under the same sub-path as GitHub Pages, e.g. a folder "site/" containing "MechLibrary/" (the repo files):
        python3 -m http.server 8771 --directory site
        node pwa-check.mjs http://localhost:8771/MechLibrary/
behavior.mjs also expects mock same-origin course pages at /Heat-Transfer/ (index.html, ch1.html, unfixed.html) that contain the
snippet from ../course-repo-snippet/. Ports and paths are at the top of each script.
