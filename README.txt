SIMPLY WEATHER v7

Critical fix for stale iPhone PWA assets:
- The screenshot showing pie-chart and umbrella icons was the old cached JavaScript, not the v6 SVG renderer.
- v7 force-clears previous Simply Weather service-worker caches one time.
- CSS, JS, manifest and icons now use ?v=7 cache-busting URLs.
- Service worker calls skipWaiting() and uses network-first loading for HTML/JS/CSS.
- Service-worker registration uses updateViaCache:'none'.
- All legacy weather Unicode symbols remain removed.
- The 7-day outlook uses only the custom Swiss/minimal SVG weather icons.

DEPLOY
Upload the CONTENTS of this folder to the repository root and wait for GitHub Pages to finish deploying.
Then open the existing Home Screen app. v7 performs the old-cache cleanup itself.
