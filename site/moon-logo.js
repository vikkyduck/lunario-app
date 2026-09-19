/* ── Луна с обложки: рисуется один раз с настоящей фазой на сегодня; дыхание и искры — в CSS ── */
(function () {
  const canvases = [...document.querySelectorAll('canvas[data-brand-moon], #moonToday, #moonHero')];   /* #moonHero — герой на «Сегодня», та же луна крупно */
  if (!canvases.length) return;
  let phase = 0.42;                        /* пока данных нет — молодая растущая луна */

  /* ── текстура луны: шар с освещением справа, моря и кратеры с тенями. Рисуется один раз на размер и кэшируется ── */
  function seeded(n) { let x = n >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }
  const MARIA = [[-0.34, -0.28, 0.30, 0.24, -0.4], [0.18, -0.34, 0.22, 0.17, 0.3], [0.42, -0.02, 0.19, 0.24, 0.2], [-0.48, 0.12, 0.20, 0.30, 0.1],
                 [-0.12, 0.22, 0.17, 0.14, 0.6], [0.24, 0.38, 0.14, 0.11, -0.2], [0.05, -0.05, 0.12, 0.09, 0.9]];
  function buildCraters() {
    const rnd = seeded(20260913), out = [];
    const tryPut = (r) => {
      for (let k = 0; k < 40; k++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.9;
        const x = Math.cos(a) * d, y = Math.sin(a) * d;
        if (out.every((o) => Math.hypot(o[0] - x, o[1] - y) > (o[2] + r) * 1.1)) { out.push([x, y, r, rnd()]); return; }
      }
    };
    for (let i = 0; i < 4; i++) tryPut(0.075 + rnd() * 0.035);
    for (let i = 0; i < 9; i++) tryPut(0.04 + rnd() * 0.03);
    for (let i = 0; i < 26; i++) tryPut(0.014 + rnd() * 0.02);
    return out;
  }
  const CRATERS = buildCraters();
  const texCache = new Map();
  function moonTexture(px, R, letter) {                /* px — сторона квадрата в устройственных пикселях, R — радиус в них */
    const key = px + ':' + (letter ? 'l' : 'd');
    if (texCache.has(key)) return texCache.get(key);
    const t = document.createElement('canvas'); t.width = t.height = px;
    const g = t.getContext('2d'); if (!g) return null;
    g.translate(px / 2, px / 2);
    const st = Math.min(1, Math.max(0.45, (R - 20) / 70));
    g.globalAlpha = 1;
    /* шар: свет справа-сверху, к лимбу темнее */
    const body = g.createRadialGradient(R * 0.35, -R * 0.3, R * 0.1, 0, 0, R * 1.05);
    body.addColorStop(0, '#fffbe8'); body.addColorStop(0.5, '#fae4a2'); body.addColorStop(1, '#f0cf78');
    g.fillStyle = body; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
    g.save(); g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.clip();
    /* моря — темные пятна с мягким краем */
    for (const [x, y, rx, ry, rot] of MARIA) {
      g.save(); g.translate(x * R, y * R); g.rotate(rot); g.scale(rx * R, ry * R);
      const m = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      m.addColorStop(0, `rgba(200,155,70,${0.16 * st})`); m.addColorStop(0.7, `rgba(200,155,70,${0.08 * st})`); m.addColorStop(1, 'rgba(200,155,70,0)');
      g.fillStyle = m; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill(); g.restore();
    }
    /* зерно поверхности */
    const rnd = seeded(7);
    const dots = Math.round(R * R * 0.9);
    for (let i = 0; i < dots; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R, sz = 0.6 + rnd() * 1.6;
      g.fillStyle = rnd() < 0.5 ? `rgba(200,155,70,${0.04 * st})` : `rgba(255,252,235,${0.08 * st})`;
      g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, sz, 0, Math.PI * 2); g.fill();
    }
    /* кратеры: дно темнее, тень от вала слева (свет справа), блик вала справа */
    for (const [x, y, rr, v] of CRATERS) {
      const cx = x * R, cy = y * R, r = rr * R;
      const floor = g.createRadialGradient(cx - r * 0.2, cy + r * 0.1, r * 0.1, cx, cy, r);
      floor.addColorStop(0, `rgba(190,140,60,${(0.16 + v * 0.08) * st})`); floor.addColorStop(0.85, `rgba(190,140,60,${(0.11 + v * 0.05) * st})`); floor.addColorStop(1, 'rgba(190,140,60,0)');
      g.fillStyle = floor; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.lineWidth = Math.max(0.6, r * 0.22);
      g.strokeStyle = `rgba(160,115,50,${0.22 * st})`; g.beginPath(); g.arc(cx, cy, r * 0.88, Math.PI * 0.55, Math.PI * 1.45); g.stroke();      /* тень внутри, слева */
      g.strokeStyle = 'rgba(255,252,235,.45)'; g.beginPath(); g.arc(cx, cy, r * 0.98, -Math.PI * 0.45, Math.PI * 0.45); g.stroke();
    }
    g.restore();
    texCache.set(key, t); return t;
  }

  function draw(cv) {
    const letter = cv.hasAttribute('data-brand-moon');        /* луна-буква в заголовке: без своего ободка — ободком служит буква */
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    /* логический размер (208 или 92) запоминаем при первом рисовании: запись в cv.width меняет и атрибут width,
       и если читать его каждый раз, холст удваивается с каждым кадром, пока GPU не откажет — тогда на месте луны
       Chrome рисует серый квадрат «сломанного холста» */
    if (!cv.dataset.s) cv.dataset.s = cv.getAttribute('width');
    const S = +cv.dataset.s, px = S * dpr;
    if (cv.width !== px || cv.height !== px) { cv.width = px; cv.height = px; }
    const ctx = cv.getContext('2d');
    if (!ctx || (ctx.isContextLost && ctx.isContextLost())) return;   /* контекст потерян — дорисуем по contextrestored */
    const R = S * 0.34, Rp = R * dpr;
    const ph = cv.dataset.phase !== undefined ? +cv.dataset.phase : phase;   /* полоска недели: у каждого холста своя фаза в data-phase */
    const p = ph * Math.PI * 2, c = Math.cos(p), waxing = ph < 0.5, sign = waxing ? 1 : -1;
    /* все рисуем в устройственных пикселях; при убывающей луне зеркалим по x — свет на текстуре всегда справа */
    const litPath = (g) => { g.beginPath(); g.arc(0, 0, Rp, -Math.PI / 2, Math.PI / 2, false); g.ellipse(0, 0, Math.max(0.001, Rp * Math.abs(c)), Rp, 0, Math.PI / 2, -Math.PI / 2, c > 0); g.closePath(); };

    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, px, px);
    if (letter && document.body.classList.contains('inner') && document.documentElement.dataset.theme === 'light') {
      // The illuminated part is an opening onto the actual background, so a full moon becomes the letter О.
      ctx.setTransform(sign, 0, 0, 1, px / 2, px / 2);
      ctx.fillStyle = '#2a2150';
      ctx.beginPath(); ctx.arc(0, 0, Rp, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      litPath(ctx); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }
    const tex = moonTexture(px, Rp, letter); if (!tex) return;
    /* теплый нимб — гаснет внутри холста, иначе виден его квадрат */
    const haloR = Math.min(Rp * 2.1, px / 2);
    const halo = ctx.createRadialGradient(px / 2, px / 2, Rp * 0.6, px / 2, px / 2, haloR);
    halo.addColorStop(0, 'rgba(240,215,154,.30)'); halo.addColorStop(1, 'rgba(240,215,154,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(px / 2, px / 2, haloR, 0, Math.PI * 2); ctx.fill();

    ctx.setTransform(sign, 0, 0, 1, px / 2, px / 2);
    /* ночная сторона: та же поверхность в сумерках — рельеф едва читается */
    ctx.drawImage(tex, -px / 2, -px / 2);
    ctx.fillStyle = 'rgba(22,19,42,.86)';
    ctx.beginPath(); ctx.arc(0, 0, Rp, 0, Math.PI * 2); ctx.fill();
    /* освещенная часть с мягким терминатором: маска размывается, если холст умеет фильтры */
    const lit = document.createElement('canvas'); lit.width = lit.height = px;
    const lg = lit.getContext('2d');
    if (lg) {
      lg.setTransform(sign, 0, 0, 1, px / 2, px / 2);
      lg.drawImage(tex, -px / 2, -px / 2);
      lg.globalCompositeOperation = 'destination-in';
      if ('filter' in lg) lg.filter = `blur(${Math.max(0.6, Rp * 0.045)}px)`;
      lg.fillStyle = '#fff'; litPath(lg); lg.fill();
      lg.filter = 'none'; lg.globalCompositeOperation = 'source-over';
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(lit, 0, 0);
      ctx.setTransform(sign, 0, 0, 1, px / 2, px / 2);
    } else { ctx.save(); litPath(ctx); ctx.clip(); ctx.drawImage(tex, -px / 2, -px / 2); ctx.restore(); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!letter) { ctx.strokeStyle = 'rgba(240,215,154,.35)'; ctx.lineWidth = 1.2 * dpr; ctx.beginPath(); ctx.arc(px / 2, px / 2, Rp, 0, Math.PI * 2); ctx.stroke(); }
  }
  /* Луна в заголовке — знак бренда, как на обложке сайта: проходит цикл за 22 секунды, начиная с почти полной.
     Настоящая фаза — у луны на главной. */
  const logos = canvases.filter(cv => cv.hasAttribute('data-brand-moon'));
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const t0 = performance.now();
  const logoPhase = () => motion.matches ? 0.42 : (((performance.now() - t0) / 22000 + 0.42) % 1);
  function drawAll() {
    const keep = phase;
    canvases.forEach(cv => { phase = logos.includes(cv) ? logoPhase() : keep; draw(cv); });
    phase = keep;
  }
  function fitMoonToO() {
    for (const cv of logos) {
      const wrap = cv.closest('.o-wrap'), mark = cv.closest('.wordmark');
      if (!wrap || !mark || !mark.offsetParent) continue;
      const cs = getComputedStyle(mark), F = parseFloat(cs.fontSize), LH = parseFloat(cs.lineHeight) || F;
      const c = document.createElement('canvas').getContext('2d');
      c.font = `300 ${F}px Comfortaa, sans-serif`;
      const m = c.measureText('О');
      const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      const asc = m.fontBoundingBoxAscent || F * .89, desc = m.fontBoundingBoxDescent || F * .23;
      const baseline = (LH - (asc + desc)) / 2 + asc;
      wrap.style.setProperty('--mx', (-m.actualBoundingBoxLeft + inkW / 2) + 'px');
      wrap.style.setProperty('--my', (baseline - m.actualBoundingBoxAscent + inkH / 2) + 'px');
      wrap.style.setProperty('--ms', (inkH * .88 / .68) + 'px');
    }
  }
  let timer;
  function refreshLogos() {
    clearTimeout(timer);
    if (document.hidden) return;
    fitMoonToO();
    const tick = () => {
      if (document.hidden) return;
      const keep = phase; phase = logoPhase();
      logos.filter(cv => cv.offsetParent).forEach(draw); phase = keep;
      if (!motion.matches) timer = setTimeout(tick, 250);
    };
    tick();
  }
  window.refreshMoonLogos = refreshLogos;
  document.fonts?.ready.then(refreshLogos);
  window.addEventListener('resize', refreshLogos);
  motion.addEventListener('change', refreshLogos);
  document.addEventListener('visibilitychange', refreshLogos);
  refreshLogos();
  window.moonSetPhase = function (p) { if (typeof p === 'number' && p >= 0 && p <= 1) phase = p; drawAll(); };
  /* нарисовать луну с заданной фазой в любой холст (полоска недели на «Сегодня»); холст должен иметь атрибут width */
  window.moonPaint = function (cv, p) { if (!cv) return; cv.dataset.phase = String(Math.min(1, Math.max(0, +p || 0))); draw(cv); };
  /* Chrome в фоне «усыпляет» холсты и может потерять их 2D-контекст; без обработчика на месте луны
     остается серый квадрат с «сломанной картинкой». Просим контекст обратно и рисуем заново. */
  canvases.forEach((cv) => {
    cv.addEventListener('contextlost', (e) => e.preventDefault());
    cv.addEventListener('contextrestored', () => draw(cv));
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) drawAll(); });
  window.addEventListener('pageshow', drawAll);
  drawAll();
})();
