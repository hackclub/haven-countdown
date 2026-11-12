#!/usr/bin/env python3
"""
Build data/events.js from a dump of the Haven Airtable "Events" table.

Usage:
  python3 scripts/build_events.py path/to/events_dump.json

The dump is a JSON array of records with these keys (Airtable field names in
snake_case): name, slug, city_region, start_date, format, latitude, longitude,
country, cc, n_att, is_test, website_data.

Each event's start/end comes from the schedule in its website data (the same
schedule shown on haven.hackclub.com/<slug>). Events without a parseable
schedule fall back to a default window based on their format and are marked
"approx". Timezones come from the event's coordinates.

Needs: pip install timezonefinder json5
"""
import json
import re
import sys
import unicodedata
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import json5
from timezonefinder import TimezoneFinder

YEAR, MONTH = 2026, 11

WEEKDAYS = {
    4: ["friday", "fri", "viernes", "vendredi", "freitag", "cuma", "jumat", "piatek",
        "venerdi", "sexta", "vineri", "pentek", "perjantai", "petak", "星期五", "金曜"],
    5: ["saturday", "sat", "sabado", "samedi", "samstag", "cumartesi", "sabtu", "sobota",
        "dissabte", "lauantai", "rahoroi", "subota", "星期六", "sabato", "sambata",
        "szombat", "土曜", "thu bay", "thứ bảy"],
    6: ["sunday", "sun", "domingo", "dimanche", "sonntag", "pazar", "minggu", "niedziela",
        "diumenge", "sunnuntai", "ratapu", "nedjelja", "星期日", "domenica", "duminica",
        "vasarnap", "日曜", "chu nhat", "chủ nhật"],
}

# default local windows when no schedule: (start "HH:MM", duration hours)
DEFAULTS = {
    "12-hour": ("09:00", 12),
    "24-hour": ("10:00", 24),
    "2-day": ("09:00", 33),  # day 1 09:00 -> day 2 18:00
    None: ("09:00", 12),
}


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def load_site_json(raw):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        pass
    try:
        return json5.loads(raw)
    except Exception:
        pass
    # last resort: drop trailing commas and try again
    try:
        return json5.loads(re.sub(r",(\s*[}\]])", r"\1", raw))
    except Exception:
        return None


PART_RE = re.compile(r"^\s*(\d{1,2})(?:\s*[:.;h]\s*(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?", re.I)
DAY = 24 * 60


class T:
    """A clock reading from a schedule. `flippable` means am/pm might be wrong or missing."""

    def __init__(self, h, mi, mer, has_min):
        self.h, self.mi, self.mer, self.has_min = h, mi, mer, has_min

    def minutes(self, mer=None):
        mer = mer or self.mer
        h = self.h
        if mer == "am":
            h = 0 if h == 12 else h
        elif mer == "pm":
            h = h if h == 12 else h + 12
        return (h % 24) * 60 + self.mi if h != 24 else DAY + self.mi

    def candidates(self, allow_flip):
        base = self.minutes()
        cands = [base]
        if allow_flip and 1 <= self.h <= 12:
            cands.append(base + 720 if base < 720 else base - 720)
        return cands + [c + DAY for c in cands]


def parse_part(s):
    m = PART_RE.match(s)
    if not m:
        return None
    h = int(m.group(1))
    mi = int(m.group(2) or 0)
    mer = (m.group(3) or "").lower().replace(".", "").replace(" ", "") or None
    if h > 24 or mi > 59:
        return None
    if h > 12:
        mer = None  # 24h clock, ignore stray "PM"
    return T(h, mi, mer, m.group(2) is not None)


def parse_time(s):
    """'1:30 - 2:30 pm' -> (T start, T end | None), or None if it isn't a time."""
    if not s:
        return None
    s = s.replace("\n", " ").strip()
    parts = re.split(r"\s*(?:-|–|—|~|\bto\b|\bbis\b)\s*", s, maxsplit=1)
    a = parse_part(parts[0])
    b = parse_part(parts[1]) if len(parts) > 1 else None
    if not a:
        return None
    if b and not (b.has_min or b.mer):
        b = None
    if not (a.has_min or a.mer or (b and b.mer)):
        return None  # a bare "1." list number, not a time
    if b and a.mer is None and b.mer and a.h <= 12:
        # "1:30 - 2:30 pm": borrow the meridiem unless that puts start after end
        a.mer = b.mer if a.minutes(b.mer) <= b.minutes() else ("am" if b.mer == "pm" else "pm")
    if b and b.mer is None and a.mer and b.h <= 12:
        b.mer = a.mer
    return a, b


def sequence(times, uses24):
    """Turn a day's clock readings into minutes from that day's midnight.

    Schedules are listed in order, so each item should be at or after the previous
    one. That lets us fix common typos ("11:30 pm" between 11 am and noon), missing
    am/pm ("3:00" after "12:45 pm") and items that run past midnight.
    """
    out = []
    last = None
    for i, (a, b) in enumerate(times):
        flip_a = a.mer is not None or (not uses24 and a.h <= 12)
        if last is None:
            s = a.minutes()
            # first item typo: "10:00 pm" followed by "3:00 pm"
            if a.mer == "pm" and i + 1 < len(times):
                nxt = times[i + 1][0].minutes()
                alt = s - 720 if s >= 720 else s
                if alt <= nxt < s:
                    s = alt
        else:
            day_base = (last // DAY) * DAY
            orig = day_base + a.minutes()
            opts = [orig] if orig >= last - 90 else []  # small slack for out-of-order lines
            if flip_a and 1 <= a.h <= 12:
                flipped = orig + 720 if a.minutes() < 720 else orig - 720
                if flipped >= last:
                    opts.append(flipped)
            if opts:
                s = min(opts)
            else:
                # past midnight only makes sense from the evening into the early morning;
                # otherwise it's an out-of-order line, keep it where it was written
                late = last - day_base >= 17 * 60 and a.minutes() <= 10 * 60
                s = orig + DAY if late else orig
        e = None
        if b:
            flip_b = b.mer is not None or (not uses24 and b.h <= 12)
            day_off = (s // DAY) * DAY
            ok = [c + day_off for c in b.candidates(flip_b) if s < c + day_off <= s + 18 * 60]
            e = min(ok) if ok else None
        out.append((s, e))
        last = s if last is None else max(last, s)
    return out


DAYNUM_RE = re.compile(r"(?<!\d)(1[3-9]|2\d|30)(?:st|nd|rd|th|\.)?(?!\d)")


def label_date(label, start):
    """Work out the calendar date a schedule day label refers to, or None."""
    if not label:
        return None
    m = DAYNUM_RE.search(label)
    if m:
        return date(YEAR, MONTH, int(m.group(1)))
    low = strip_accents(label.lower())
    for wd, words in WEEKDAYS.items():
        for w in words:
            w2 = strip_accents(w)
            if len(w2) <= 3:
                if re.search(rf"\b{re.escape(w2)}\b", low):
                    break
            elif w2 in low or w in label:
                break
        else:
            continue
        # nearest date with that weekday, starting the day before start_date
        for k in range(-1, 8):
            d = start + timedelta(days=k)
            if d.weekday() == wd:
                return d
    return None


def parse_schedule(site, start):
    """Returns (items, warnings). items = [(local naive datetime, end datetime|None, title)]."""
    warns = []
    sched = (site or {}).get("schedule") or {}
    days = [d for d in (sched.get("days") or []) if isinstance(d, dict)]
    if not days:
        return [], warns

    parsed = []  # (label, [(T, T|None, title)])
    for day in days:
        rows = []
        for it in day.get("items") or []:
            if not isinstance(it, dict):
                continue
            t = parse_time(str(it.get("time", "")))
            if t:
                rows.append((t[0], t[1], (it.get("title") or "").strip()))
        if rows:
            parsed.append((day.get("day", ""), rows))
    if not parsed:
        return [], warns

    uses24 = any(t.mer is None and t.h > 12 for _, rows in parsed for a, b, _ in rows for t in (a, b) if t)

    dates = []
    prev = None
    for i, (label, _) in enumerate(parsed):
        d = label_date(label, start)
        if d is None:
            d = prev + timedelta(days=1) if prev else start
        dates.append(d)
        prev = d
    # sanity: if the schedule is way off from Airtable's date, trust Airtable
    shift = (start - dates[0]).days
    if abs(shift) > 1:
        warns.append(f"schedule date {dates[0]} far from start_date {start}; shifting")
        dates = [d + timedelta(days=shift) for d in dates]

    items = []
    for (label, rows), d in zip(parsed, dates):
        base = datetime(d.year, d.month, d.day)
        for (s, e), (_, _, title) in zip(sequence([(a, b) for a, b, _ in rows], uses24), rows):
            items.append((base + timedelta(minutes=s),
                          base + timedelta(minutes=e) if e is not None else None,
                          title))
    items.sort(key=lambda x: x[0])
    return items, warns


def tagline_date(site):
    tl = (site or {}).get("tagline")
    if isinstance(tl, list):
        tl = " ".join(str(x) for x in tl)
    if not isinstance(tl, str):
        return None
    tl = strip_accents(tl)
    num = r"(1[3-9]|2\d|30)(?!\d)"
    month = r"(?:nov(?:ember|embre|iembre)?|kas[ıi]m|listopad\w*)"
    for pat in (rf"{month}\.?\s*{num}", rf"(?<!\d){num}(?:\s*[–-]\s*\d{{1,2}})?\s*(?:de\s+)?{month}"):
        m = re.search(pat, tl, re.I)
        if m:
            return date(YEAR, MONTH, int(m.group(1)))
    return None


def main(src, out_js):
    raw = json.loads(Path(src).read_text())
    tf = TimezoneFinder()
    events = []
    report = []
    for r in raw:
        if r.get("is_test") or not r.get("start_date") or not (r.get("name") or "").strip():
            continue
        name = r["name"].strip()
        start = date.fromisoformat(r["start_date"])
        lat, lng = r.get("latitude"), r.get("longitude")
        tz = tf.timezone_at(lat=lat, lng=lng) if lat is not None and lng is not None else None
        if not tz:
            tz = "UTC"
            report.append(f"{name}: no timezone")
        zone = ZoneInfo(tz)
        site = load_site_json(r.get("website_data"))
        if r.get("website_data") and site is None:
            report.append(f"{name}: website data is not valid JSON")
        items, warns = parse_schedule(site, start)
        report += [f"{name}: {w}" for w in warns]
        fmt = r.get("format")
        approx = False
        if len(items) >= 2:
            s_local = items[0][0]
            e_local = max(b or a for a, b, _ in items)
        else:
            approx = True
            d = tagline_date(site) or start
            hhmm, dur = DEFAULTS.get(fmt, DEFAULTS[None])
            hh, mm = map(int, hhmm.split(":"))
            s_local = datetime(d.year, d.month, d.day, hh, mm)
            e_local = s_local + timedelta(hours=dur)
            items = []
        dur_h = (e_local - s_local).total_seconds() / 3600
        if dur_h < 3 or dur_h > 60:
            report.append(f"{name}: odd duration {dur_h:.1f}h ({s_local} -> {e_local})")

        def utc(dt):
            return dt.replace(tzinfo=zone).astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")

        ev = {
            "name": name,
            "slug": r.get("slug"),
            "country": r.get("country"),
            "cc": r.get("cc"),
            "tz": tz,
            "lat": round(lat, 2) if lat is not None else None,
            "lng": round(lng, 2) if lng is not None else None,
            "format": fmt,
            "start": utc(s_local),
            "end": utc(e_local),
            "approx": approx,
            "signups": r.get("n_att") or 0,
        }
        if items:
            ev["schedule"] = [[utc(a), b and utc(b), t] for a, b, t in items if t]
        events.append(ev)

    events.sort(key=lambda e: (e["start"], e["name"]))
    payload = {
        "generated": datetime.now(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "events": events,
    }
    Path(out_js).write_text(
        "// generated by scripts/build_events.py from the Haven Airtable base. do not edit by hand.\n"
        "window.HAVEN_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    print(f"wrote {len(events)} events to {out_js}")
    for line in report:
        print("  !", line)
    return events


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    out = sys.argv[2] if len(sys.argv) > 2 else str(Path(__file__).resolve().parent.parent / "data" / "events.js")
    main(sys.argv[1], out)
