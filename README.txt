SIMPLY WEATHER v10 — audited rebuild

Fixes:
- Daily forecast dates are calculated from the selected city timezone and refresh across midnight.
- Daily consensus is actually mounted in HTML and switches to tomorrow after 22:00.
- Hourly forecasts are matched by timestamps, not array positions.
- Forecast hours are compared using location UTC offset rather than the phone timezone.
- One unified SVG icon family, no pie-chart symbols.
- Daily rain value is labeled peak hourly probability, not full-day probability.
- Concurrent refreshes cannot overwrite newer location requests.
- Stable network-first service worker; no repeated unregister/reload loop.

Upload all files to the root of the existing GitHub Pages repository.
