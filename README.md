# haven-countdown

Big-screen countdown for Hack Club Haven: one huge countdown to the next haven starting, plus a marquee of every haven live right now.

Static site, no build step. Open `index.html` (works straight from disk too) and press `F` or double-click for fullscreen.

## testing

- `?at=2026-11-13T03:59:50Z` pretends it's that moment
- `?speed=60` runs the clock faster

e.g. `index.html?at=2026-11-14T14:59:40Z` to see a bunch of havens start at once.

## data

`data/events.js` is generated from the Events table in the Haven Airtable base (active, non-test events). Start/end times come from each event's website schedule (`Website Data`), timezones from its coordinates. Events with no schedule fall back to a default window for their format and are marked `approx`.

To refresh, dump the events to JSON and run:

```bash
pip install timezonefinder json5
python3 scripts/build_events.py events_dump.json
```

The dump is an array of rows with `name, slug, city_region, start_date, format, latitude, longitude, country, cc, n_att, is_test, website_data`.
