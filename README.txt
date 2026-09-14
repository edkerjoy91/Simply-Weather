SIMPLY WEATHER v6

Fix:
- Removed every legacy Unicode weather symbol, including the pie-chart-looking partly-cloudy icon.
- All current, hourly, and 7-day weather conditions now use the custom Swiss/minimal SVG icon set.
- Partly cloudy is explicitly sun/moon behind a cloud.
- Current hero icon uses SVG correctly instead of rendering SVG markup as text.
- PWA cache bumped to v6 so iPhone should fetch the corrected assets.

Deploy:
Replace the GitHub Pages repository files with the CONTENTS of this folder.
After GitHub deploys, fully close Simply Weather from the iPhone app switcher and reopen it.
