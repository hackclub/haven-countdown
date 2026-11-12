/* Haven countdown. Counts down to the first haven on Nov 14, then to the last one ending,
 * with a small marquee of the havens going on right now.
 *
 * Only havens that start on Nov 14 or 15 (their local date) count. Early/late one-offs are ignored.
 *
 * URL options (for testing / rehearsals):
 *   ?at=2026-11-13T19:59:50Z   pretend it's this moment
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

  const DAYS = ['2026-11-14', '2026-11-15'];
  const localDay = (ms, tz) => {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms); } catch { return ''; }
  };
  const EVENTS = ((window.HAVEN_DATA || {}).events || [])
    .map((e) => ({
      name: e.name && e.country && e.name !== e.country ? `${e.name}, ${e.country}` : e.name,
      start: Date.parse(e.start), end: Date.parse(e.end), tz: e.tz || 'UTC',
    }))
    .filter((e) => e.end > e.start && DAYS.includes(localDay(e.start, e.tz)))
    .sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
  const FIRST = Math.min(...EVENTS.map((e) => e.start));
  const LAST = Math.max(...EVENTS.map((e) => e.end));

  // ---- countdown ----
  const pad = (n) => String(n).padStart(2, '0');
  let shape = '';
  function showCountdown(ms, final) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const units = [['hr', pad(Math.floor(s / 3600))], ['min', pad(Math.floor((s % 3600) / 60))], ['sec', pad(s % 60)]];
    const box = $('digits');
    const sh = units.map(([, v]) => v.length).join();
    if (sh !== shape) {
      box.innerHTML = units.map(([k, v]) =>
        `<div class="unit"><div class="num" data-u="${k}">${[...v].map((c) => `<span>${c}</span>`).join('')}</div><div class="u">${k}</div></div>`).join('');
      shape = sh;
    } else {
      for (const [k, v] of units) {
        box.querySelectorAll(`[data-u="${k}"] span`).forEach((el, i) => { if (el.textContent !== v[i]) el.textContent = v[i]; });
      }
    }
    box.classList.toggle('final', final && s <= 10);
  }
  function setText(id, text) { const el = $(id); if (el.textContent !== text) el.textContent = text; }

  // ---- marquee: "going on now  Christchurch · Melbourne · ..." ----
  const track = $('track');
  const TAG_EVERY = 15;
  let x = 0, queue = [], live = [], prevLive = new Set();
  function cycle() {
    const out = [];
    live.forEach((e, i) => { if (i % TAG_EVERY === 0) out.push(null); out.push(e.name); });
    return out;
  }
  function marqueeFrame(dt) {
    const win = track.parentElement.offsetWidth;
    x -= 160 * dt;
    let first = track.firstElementChild;
    // spans are flex items, so offsetWidth already includes the "·" separator
    while (first && x + first.offsetWidth < 0) {
      x += first.offsetWidth;
      first.remove();
      first = track.firstElementChild;
    }
    let guard = 0;
    while (track.scrollWidth + x < win + 200 && guard++ < 40) {
      if (!queue.length) queue = cycle();
      const item = queue.shift();
      const s = document.createElement('span');
      if (item === null) { s.className = 'tag'; s.textContent = 'going on now'; } else s.textContent = item;
      track.appendChild(s);
    }
    track.style.transform = `translate3d(${x}px,0,0)`;
  }

  // ---- confetti when Haven starts ----
  const confettiCanvas = $('confetti');
  const cctx = confettiCanvas.getContext('2d');
  const COLORS = ['#ffd059', '#ffe382', '#fc8616', '#ed5615', '#fa681b', '#b8c220', '#2cbf90', '#ffffff'];
  let bits = [];
  function sizeConfetti() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    confettiCanvas.width = innerWidth * dpr;
    confettiCanvas.height = innerHeight * dpr;
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function cannon(fromLeft, count) {
    const w = innerWidth, h = innerHeight, unit = Math.min(w / 1920, h / 1080);
    for (let i = 0; i < count; i++) {
      const angle = (fromLeft ? -60 : -120) + (Math.random() - 0.5) * 40;
      const v = (1300 + Math.random() * 900) * unit;
      bits.push({
        x: fromLeft ? -10 : w + 10, y: h * 0.95,
        vx: Math.cos(angle * Math.PI / 180) * v, vy: Math.sin(angle * Math.PI / 180) * v,
        w: (14 + Math.random() * 14) * unit, h: (8 + Math.random() * 8) * unit,
        rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 14,
        flip: Math.random() * Math.PI * 2, flipSpeed: 6 + Math.random() * 8,
        color: COLORS[(Math.random() * COLORS.length) | 0], round: Math.random() < 0.3,
      });
    }
  }
  function rain(count) {
    const w = innerWidth, unit = Math.min(w / 1920, innerHeight / 1080);
    for (let i = 0; i < count; i++) {
      bits.push({
        x: Math.random() * w, y: -20 - Math.random() * innerHeight * 0.6,
        vx: (Math.random() - 0.5) * 200 * unit, vy: (100 + Math.random() * 200) * unit,
        w: (12 + Math.random() * 12) * unit, h: (7 + Math.random() * 7) * unit,
        rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 10,
        flip: Math.random() * Math.PI * 2, flipSpeed: 5 + Math.random() * 7,
        color: COLORS[(Math.random() * COLORS.length) | 0], round: Math.random() < 0.3,
      });
    }
  }
  function celebrate() {
    sizeConfetti();
    cannon(true, 160); cannon(false, 160);
    setTimeout(() => { cannon(true, 90); cannon(false, 90); }, 700);
    setTimeout(() => rain(220), 1200);
  }
  function confettiFrame(dt) {
    if (!bits.length) return;
    const unit = Math.min(innerWidth / 1920, innerHeight / 1080);
    cctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const b of bits) {
      b.vy += 1500 * unit * dt;                 // gravity
      b.vx *= 1 - 1.6 * dt; b.vy *= 1 - 1.6 * dt; // air drag, so it floats down
      b.x += b.vx * dt + Math.sin(b.flip) * 40 * unit * dt;
      b.y += b.vy * dt;
      b.rot += b.spin * dt; b.flip += b.flipSpeed * dt;
      cctx.save();
      cctx.translate(b.x, b.y);
      cctx.rotate(b.rot);
      cctx.scale(1, Math.cos(b.flip));
      cctx.fillStyle = b.color;
      if (b.round) { cctx.beginPath(); cctx.arc(0, 0, b.h / 1.6, 0, Math.PI * 2); cctx.fill(); }
      else cctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      cctx.restore();
    }
    bits = bits.filter((b) => b.y < innerHeight + 60);
    if (!bits.length) cctx.clearRect(0, 0, innerWidth, innerHeight);
  }

  // ---- main tick ----
  let prevT = null;
  function tick() {
    const t = now();
    live = EVENTS.filter((e) => e.start <= t && t < e.end);
    if (prevT !== null && prevT < FIRST && t >= FIRST) celebrate();
    prevT = t;

    if (t < FIRST) {
      showCountdown(FIRST - t, true);
      setText('caption', 'until Haven');
    } else if (t < LAST) {
      showCountdown(LAST - t, false);
      setText('caption', 'Haven has started');
    } else {
      showCountdown(0, false);
      setText('caption', 'Haven is over');
    }

    // havens that just started jump the marquee queue; finished ones drop out of it
    const names = new Set(live.map((e) => e.name));
    const fresh = live.filter((e) => !prevLive.has(e.name)).map((e) => e.name);
    if (fresh.length || prevLive.size !== names.size) {
      queue = [...fresh, ...queue.filter((n) => n === null || (names.has(n) && !fresh.includes(n)))];
    }
    prevLive = names;
    $('marquee').hidden = !live.length;

    if (simulated) $('sim').textContent = `simulated · ${new Date(t).toISOString().slice(0, 19).replace('T', ' ')} UTC${speed !== 1 ? ` · ×${speed}` : ''}`;
  }

  let last = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
    last = ts;
    if (live.length) marqueeFrame(dt);
    confettiFrame(dt);
  }

  // ---- screen fitting + TV niceties ----
  const stage = $('stage');
  function fit() {
    const w = innerWidth, h = innerHeight, k = Math.min(w / 1920, h / 1080);
    stage.style.transform = `translate(${(w - 1920 * k) / 2}px, ${(h - 1080 * k) / 2}px) scale(${k})`;
  }
  addEventListener('resize', () => { fit(); if (bits.length) sizeConfetti(); });
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
