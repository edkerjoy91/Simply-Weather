WEATHER v1

A minimal installable weather PWA.

Run locally:
1. Put this folder on any HTTPS static host (Netlify, GitHub Pages, Cloudflare Pages, etc.).
2. Open the HTTPS URL in Safari on iPhone.
3. Share > Add to Home Screen.

Data:
- Open-Meteo: ECMWF, DWD ICON, GFS, ItaliaMeteo ICON-2I forecast feeds.
- RainViewer: past 2 hours of precipitation radar.
- OpenStreetMap: base map tiles.

Notes:
- The consensus averages only models available for the requested hour.
- ItaliaMeteo ICON-2I is regional and short-range, so it naturally drops out beyond its horizon.
- Future precipitation on the Map screen is a model-consensus strip, not future radar.
- Geolocation requires HTTPS (or localhost).


V3: Precipitation probability is now ensemble-based, using DWD ICON-EPS, NOAA GEFS, and CMC GEPS via Open-Meteo. The displayed PoP is the mean of available ensemble-system probabilities for >0.1 mm/hour. Deterministic ECMWF/DWD/GFS/ItaliaMeteo precipitation amounts remain visible separately.
