/* Haven countdown. One big countdown + a marquee of the havens running right now.
 *
 * URL options (all optional, for testing / rehearsals):
 *   ?at=2026-11-13T03:59:50Z   pretend it's this moment
 *   ?speed=60                  run the clock faster
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  // clock (real time unless ?at / ?speed are set)
  const realStart = Date.now();
  const atMs = Date.parse(params.get('at') || '');
  const speed = Math.max(0, Number(params.get('speed')) || 1);
  const simulated = !isNaN(atMs) || speed !== 1;
  const base = isNaN(atMs) ? realStart : atMs;
  const now = () => base + (Date.now() - realStart) * speed;

  const EVENTS = ((window.HAVEN_DATA || {}).events || [])
    .map((e) => ({ name: e.name, country: e.country || '', tz: e.tz || 'UTC', start: Date.parse(e.start), end: Date.parse(e.end) }))
    .filter((e) => e.end > e.start)
    .sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
  const COUNTRIES = new Set(EVENTS.map((e) => e.country).filter(Boolean)).size;
  const CHEER_MS = 20000; // how long "Haven X has started!" stays up

  // ---- formatting ----
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  function localWhen(ms, tz) {
    const day = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(ms).replace(',', '');
    const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(ms)
      .replace(/[\s ]?([AP])M/i, (_, p) => ' ' + p.toLowerCase() + 'm');
    return `${day} · ${time} local time`;
  }
  const names = (list) => {
    const n = list.map((e) => e.name);
    return n.length <= 3 ? n.join(', ').replace(/, ([^,]*)$/, ' & $1') : `${n.slice(0, 2).join(', ')} + ${n.length - 2} more`;
  };

  // ---- big center ----
  const center = document.querySelector('.center');
  let shape = '';
  function setText(id, html) { const el = $(id); if (el.dataset.v !== html) { el.innerHTML = html; el.dataset.v = html; } }

  function showCountdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const units = d ? [['days', String(d)], ['hours', pad(h)], ['mins', pad(m)], ['secs', pad(sec)]]
      : [['hours', pad(h)], ['mins', pad(m)], ['secs', pad(sec)]];
    const box = $('digits');
    const sh = 'cd' + units.map(([k, v]) => k + v.length).join();
    if (sh !== shape) {
      box.innerHTML = units.map(([k, v], i) => (i ? '<div class="sep">:</div>' : '') +
        `<div class="unit"><div class="num" data-u="${k}">${[...v].map((c) => `<span>${c}</span>`).join('')}</div><div class="cap">${k}</div></div>`).join('');
      shape = sh;
    } else {
      for (const [k, v] of units) {
        box.querySelectorAll(`[data-u="${k}"] span`).forEach((el, i) => { if (el.textContent !== v[i]) el.textContent = v[i]; });
      }
    }
    box.classList.toggle('days', !!d);
    box.classList.toggle('final', s <= 10);
  }
  function showBig(html) {
    const key = 'big' + html;
    if (shape !== key) { $('digits').innerHTML = `<div class="cheer-title">${html}</div>`; shape = key; }
    $('digits').classList.remove('days', 'final');
  }

  // ---- marquee of live havens ----
  const track = $('track');
  let x = null, queue = [], live = [];
  function marqueeFrame(dt) {
    const win = track.parentElement.offsetWidth;
    if (x === null) x = 0;
    x -= 110 * dt;
    let first = track.firstElementChild;
    while (first && x + first.offsetWidth < 0) { x += first.offsetWidth; first.remove(); first = track.firstElementChild; }
    let guard = 0;
    while (live.length && track.scrollWidth + x < win + 200 && guard++ < 40) {
      if (!queue.length) queue = live.map((e) => e.name);
      const s = document.createElement('span');
      s.textContent = `Haven ${queue.shift()}`;
      track.appendChild(s);
    }
    track.style.transform = `translate3d(${x}px,0,0)`;
  }

  // ---- main tick ----
  function tick() {
    const t = now();
    live = EVENTS.filter((e) => e.start <= t && t < e.end);
    const upcoming = EVENTS.filter((e) => e.start > t);
    const justStarted = EVENTS.filter((e) => e.start <= t && t - e.start < CHEER_MS);

    if (justStarted.length) {
      const first = EVENTS[0] && justStarted.includes(EVENTS[0]);
      setText('label', first ? 'Haven has begun!' : "it's game time");
      if (justStarted.length === 1) {
        showBig(`Haven ${esc(justStarted[0].name)} has started!`);
        setText('sub', esc(justStarted[0].country));
      } else {
        showBig(`${justStarted.length} havens just started!`);
        setText('sub', esc(names(justStarted)));
      }
    } else if (upcoming.length) {
      const next = upcoming[0];
      const group = upcoming.filter((e) => e.start === next.start);
      const started = EVENTS.length - upcoming.length;
      setText('label', started ? `Haven ${esc(names(group))} ${group.length > 1 ? 'start' : 'starts'} in` : 'Haven kicks off in');
      showCountdown(next.start - t);
      setText('sub', `${started ? '' : `first up: ${esc(next.name)}, ${esc(next.country)} · `}${esc(localWhen(next.start, next.tz))}`);
    } else if (live.length) {
      const last = Math.max(...live.map((e) => e.end));
      setText('label', 'Haven wraps up in');
      showCountdown(last - t);
      setText('sub', `${live.length} ${live.length === 1 ? 'haven' : 'havens'} still jamming`);
    } else {
      setText('label', "that's a wrap!");
      showBig('Thanks for jamming');
      setText('sub', `${EVENTS.length} cities · ${COUNTRIES} countries`);
    }

    $('marquee').hidden = !live.length;
    setText('marquee-tag', `${live.length} live now`);
    if (simulated) $('sim').textContent = `simulated · ${new Date(t).toISOString().slice(0, 19).replace('T', ' ')} UTC${speed !== 1 ? ` · ×${speed}` : ''}`;
  }

  let last = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
    last = ts;
    if (live.length) marqueeFrame(dt);
  }

  // ---- screen fitting + TV niceties ----
  const stage = $('stage');
  function fit() {
    const w = innerWidth, h = innerHeight, k = Math.min(w / 1920, h / 1080);
    stage.style.transform = `translate(${(w - 1920 * k) / 2}px, ${(h - 1080 * k) / 2}px) scale(${k})`;
  }
  addEventListener('resize', fit);
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())?.catch?.(() => {});
  addEventListener('dblclick', fullscreen);
  addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'f') fullscreen(); });
  let idle;
  addEventListener('mousemove', () => { document.body.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => document.body.classList.add('idle'), 3000); });
  const wake = () => { if (document.visibilityState === 'visible') navigator.wakeLock?.request('screen').catch(() => {}); };
  document.addEventListener('visibilitychange', wake);
  wake();
  // pick up data changes every few hours, only if the server is reachable (never blank an offline TV)
  if (!simulated) setInterval(() => fetch('data/events.js', { method: 'HEAD', cache: 'no-store' }).then((r) => r.ok && location.reload()).catch(() => {}), 3 * 3600e3);

  $('sim').hidden = !simulated;
  fit();
  tick();
  setInterval(tick, 200);
  requestAnimationFrame(loop);
})();
