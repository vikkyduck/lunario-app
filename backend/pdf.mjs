/* Маленький генератор PDF без зависимостей — для выгрузки «Скачать мои данные».
   Умеет ровно то, что нужно документу в стиле Лунарио: страницы A4 с темным фоном и мягким свечением,
   шрифт TrueType с кириллицей (встраивается целиком, кодировка Identity-H, ToUnicode для поиска и копирования),
   картинки PNG (с прозрачностью) и JPEG, скругленные панели с прозрачностью, линии, текст с переносами.
   Все пишется руками по спецификации PDF 1.7: объекты, потоки с FlateDecode, таблица xref. */
import { deflateSync, inflateSync } from 'node:zlib';

/* ── TrueType: коды символов → глифы и ширины. Нужны таблицы head, hhea, hmtx, maxp, cmap; остальное едет в PDF как есть ── */
export function parseTrueType(buf) {
  const tables = {};
  const n = buf.readUInt16BE(4);
  for (let i = 0; i < n; i++) { const o = 12 + i * 16; tables[buf.toString('latin1', o, o + 4)] = { off: buf.readUInt32BE(o + 8), len: buf.readUInt32BE(o + 12) }; }
  for (const t of ['head', 'hhea', 'hmtx', 'maxp', 'cmap']) if (!tables[t]) throw new Error('TrueType без таблицы ' + t);
  const head = tables.head.off, hhea = tables.hhea.off;
  const unitsPerEm = buf.readUInt16BE(head + 18);
  const bbox = [buf.readInt16BE(head + 36), buf.readInt16BE(head + 38), buf.readInt16BE(head + 40), buf.readInt16BE(head + 42)];
  const ascender = buf.readInt16BE(hhea + 4), descender = buf.readInt16BE(hhea + 6), numberOfHMetrics = buf.readUInt16BE(hhea + 34);
  const numGlyphs = buf.readUInt16BE(tables.maxp.off + 4);
  const advances = new Array(numGlyphs);
  for (let g = 0; g < numGlyphs; g++) advances[g] = buf.readUInt16BE(tables.hmtx.off + Math.min(g, numberOfHMetrics - 1) * 4);
  let capHeight = Math.round(ascender * 0.7);
  if (tables['OS/2'] && buf.readUInt16BE(tables['OS/2'].off) >= 2) capHeight = buf.readInt16BE(tables['OS/2'].off + 88);
  /* cmap: предпочитаем полную юникодную (3,10 — формат 12), иначе BMP (3,1 — формат 4) */
  const cmap = tables.cmap.off, sub = buf.readUInt16BE(cmap + 2), map = new Map();
  let best = null;
  for (let i = 0; i < sub; i++) {
    const o = cmap + 4 + i * 8, plat = buf.readUInt16BE(o), enc = buf.readUInt16BE(o + 2), off = buf.readUInt32BE(o + 4);
    const fmt = buf.readUInt16BE(cmap + off);
    const score = (plat === 3 && enc === 10 && fmt === 12) ? 3 : (plat === 3 && enc === 1 && fmt === 4) ? 2 : (plat === 0 && (fmt === 4 || fmt === 12)) ? 1 : 0;
    if (score && (!best || score > best.score)) best = { score, off: cmap + off, fmt };
  }
  if (!best) throw new Error('TrueType без юникодной cmap');
  if (best.fmt === 4) {
    const s = best.off, segX2 = buf.readUInt16BE(s + 6), segs = segX2 / 2;
    const ends = s + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let i = 0; i < segs; i++) {
      const end = buf.readUInt16BE(ends + i * 2), start = buf.readUInt16BE(starts + i * 2), delta = buf.readInt16BE(deltas + i * 2), ro = buf.readUInt16BE(ranges + i * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end; c++) {
        let g;
        if (ro === 0) g = (c + delta) & 0xffff;
        else { const a = ranges + i * 2 + ro + (c - start) * 2; if (a + 1 >= buf.length) continue; g = buf.readUInt16BE(a); if (g) g = (g + delta) & 0xffff; }
        if (g) map.set(c, g);
      }
    }
  } else {
    const s = best.off, groups = buf.readUInt32BE(s + 12);
    for (let i = 0; i < groups; i++) { const o = s + 16 + i * 12, a = buf.readUInt32BE(o), b = buf.readUInt32BE(o + 4), g0 = buf.readUInt32BE(o + 8); for (let c = a; c <= b && c - a < 65536; c++) map.set(c, g0 + (c - a)); }
  }
  return { data: buf, unitsPerEm, ascender, descender, capHeight, bbox, numGlyphs, advances, gid: (cp) => map.get(cp) || 0 };
}

/* ── PNG: раскодировать в RGB + альфа (8 бит, без чересстрочности); при need2x уменьшить вдвое усреднением ── */
export function decodePng(buf, { half = false } = {}) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('не PNG');
  let w = 0, h = 0, depth = 8, type = 6, idat = [];
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p), tag = buf.toString('latin1', p + 4, p + 8);
    if (tag === 'IHDR') { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); depth = buf[p + 16]; type = buf[p + 17]; if (buf[p + 20]) throw new Error('чересстрочный PNG не поддерживается'); }
    else if (tag === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    else if (tag === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error('PNG: поддерживаются только 8 бит на канал');
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[type]; if (!ch) throw new Error('PNG: палитра не поддерживается');
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(w * h * ch);
  for (let y = 0, src = 0; y < h; y++) {
    const f = raw[src++], row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++, src++) {
      const a = x >= ch ? px[row + x - ch] : 0, b = y ? px[prev + x] : 0, c = (y && x >= ch) ? px[prev + x - ch] : 0, v = raw[src];
      let out;
      if (f === 0) out = v; else if (f === 1) out = v + a; else if (f === 2) out = v + b; else if (f === 3) out = v + ((a + b) >> 1);
      else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      px[row + x] = out & 255;
    }
  }
  const hasAlpha = type === 4 || type === 6, gray = type === 0 || type === 4;
  const colorCh = gray ? 1 : 3;
  let W = w, H = h, rgb, alpha;
  if (half) {
    W = Math.floor(w / 2); H = Math.floor(h / 2); rgb = Buffer.alloc(W * H * colorCh); alpha = hasAlpha ? Buffer.alloc(W * H) : null;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = [((2 * y) * w + 2 * x) * ch, ((2 * y) * w + 2 * x + 1) * ch, ((2 * y + 1) * w + 2 * x) * ch, ((2 * y + 1) * w + 2 * x + 1) * ch];
      for (let k = 0; k < colorCh; k++) rgb[(y * W + x) * colorCh + k] = (px[i[0] + k] + px[i[1] + k] + px[i[2] + k] + px[i[3] + k]) >> 2;
      if (alpha) alpha[y * W + x] = (px[i[0] + colorCh] + px[i[1] + colorCh] + px[i[2] + colorCh] + px[i[3] + colorCh]) >> 2;
    }
  } else {
    rgb = Buffer.alloc(w * h * colorCh); alpha = hasAlpha ? Buffer.alloc(w * h) : null;
    for (let i = 0, j = 0; i < w * h; i++, j += ch) { for (let k = 0; k < colorCh; k++) rgb[i * colorCh + k] = px[j + k]; if (alpha) alpha[i] = px[j + colorCh]; }
  }
  return { width: W, height: H, gray, rgb, alpha };
}
/* JPEG: размер из первого SOF-маркера; поток кладется в PDF как есть (DCTDecode) */
export function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('не JPEG');
  for (let p = 2; p < buf.length;) {
    if (buf[p] !== 0xff) { p++; continue; }
    const m = buf[p + 1];
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { p += 2; continue; }
    const len = buf.readUInt16BE(p + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7), gray: buf[p + 9] === 1 };
    p += 2 + len;
  }
  throw new Error('JPEG без размера');
}

const num = (v) => (Math.round(v * 100) / 100).toString();
const rgbOp = (c, op) => `${num(c[0])} ${num(c[1])} ${num(c[2])} ${op}`;
const K = 0.5523;   /* коэффициент Безье для четверти круга */

export class PdfDocument {
  constructor({ width = 595.28, height = 841.89, title = '', author = 'Лунарио' } = {}) {
    this.w = width; this.h = height; this.title = title; this.author = author;
    this.objects = [];        /* {dict, stream} — номер объекта = индекс + 1 */
    this.pages = []; this.fonts = []; this.images = []; this.states = new Map(); this.shadings = [];
  }
  _add(obj) { this.objects.push(obj); return this.objects.length; }
  _reserve() { return this._add(null); }
  _set(id, obj) { this.objects[id - 1] = obj; }

  /* Шрифт: TrueType целиком, глифы по Identity-H. Возвращает объект для измерения и вывода текста. */
  addFont(ttfBuffer) {
    const f = parseTrueType(ttfBuffer), id = this.fonts.length + 1;
    const font = { res: 'F' + id, ttf: f, used: new Map(), scale: 1000 / f.unitsPerEm,
      width(text, size, spacing = 0) { let w = 0; const cps = [...text]; for (const ch of cps) w += f.advances[f.gid(ch.codePointAt(0))] || 0; return w / f.unitsPerEm * size + spacing * Math.max(0, cps.length - 1); } };
    this.fonts.push(font); return font;
  }
  /* Картинка: PNG (с прозрачностью) или JPEG */
  addImage(buffer, { half = false } = {}) {
    const id = this.images.length + 1;
    const img = { res: 'Im' + id, obj: null };
    if (buffer[0] === 0x89) {
      const p = decodePng(buffer, { half });
      let smask = null;
      if (p.alpha) smask = this._add({ dict: `/Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, stream: deflateSync(p.alpha) });
      img.obj = this._add({ dict: `/Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /${p.gray ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /FlateDecode${smask ? ` /SMask ${smask} 0 R` : ''}`, stream: deflateSync(p.rgb) });
      img.width = p.width; img.height = p.height;
    } else {
      const j = jpegSize(buffer);
      img.obj = this._add({ dict: `/Type /XObject /Subtype /Image /Width ${j.width} /Height ${j.height} /ColorSpace /${j.gray ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode`, stream: buffer, raw: true });
      img.width = j.width; img.height = j.height;
    }
    this.images.push(img); return img;
  }
  _state(fill, stroke) {
    const key = `${num(fill)}/${num(stroke)}`;
    if (!this.states.has(key)) this.states.set(key, { res: 'GS' + (this.states.size + 1), obj: this._add({ dict: `/Type /ExtGState /ca ${num(fill)} /CA ${num(stroke)}` }) });
    return this.states.get(key).res;
  }
  /* Радиальное свечение: от цвета к цвету фона на радиусе r; рисуется с прозрачностью */
  _shading(cx, cy, r, from, to) {
    const id = this.shadings.length + 1;
    const obj = this._add({ dict: `/ShadingType 3 /ColorSpace /DeviceRGB /Coords [${num(cx)} ${num(cy)} 0 ${num(cx)} ${num(cy)} ${num(r)}] /Function << /FunctionType 2 /Domain [0 1] /C0 [${from.map(num).join(' ')}] /C1 [${to.map(num).join(' ')}] /N 1.6 >> /Extend [false false]` });
    const sh = { res: 'Sh' + id, obj }; this.shadings.push(sh); return sh.res;
  }

  addPage() {
    const page = { ops: [], links: [], doc: this };
    this.pages.push(page);
    return (page.writer = new PageWriter(page, this));
  }

  build() {
    const enc = (s) => Buffer.from(s, 'latin1');
    /* шрифты: дескриптор, файл, CID-шрифт, Type0, ToUnicode */
    const fontRefs = {};
    for (const font of this.fonts) {
      const f = font.ttf, s = font.scale;
      const file = this._add({ dict: `/Length1 ${f.data.length} /Filter /FlateDecode`, stream: deflateSync(f.data) });
      const desc = this._add({ dict: `/Type /FontDescriptor /FontName /${font.res}Onest /Flags 32 /FontBBox [${f.bbox.map((v) => num(v * s)).join(' ')}] /ItalicAngle 0 /Ascent ${num(f.ascender * s)} /Descent ${num(f.descender * s)} /CapHeight ${num(f.capHeight * s)} /StemV 80 /FontFile2 ${file} 0 R` });
      const widths = f.advances.map((a) => Math.round(a * s)).join(' ');
      const cid = this._add({ dict: `/Type /Font /Subtype /CIDFontType2 /BaseFont /${font.res}Onest /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /DW 1000 /W [0 [${widths}]] /CIDToGIDMap /Identity` });
      const pairs = [...font.used.entries()].map(([g, cp]) => `<${g.toString(16).padStart(4, '0')}> <${cp > 0xffff ? String.fromCodePoint(cp).split('').map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('') : cp.toString(16).padStart(4, '0')}>`);
      const chunks = []; for (let i = 0; i < pairs.length; i += 100) chunks.push(`${Math.min(100, pairs.length - i)} beginbfchar\n${pairs.slice(i, i + 100).join('\n')}\nendbfchar`);
      const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chunks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
      const tu = this._add({ dict: '/Filter /FlateDecode', stream: deflateSync(enc(cmap)) });
      fontRefs[font.res] = this._add({ dict: `/Type /Font /Subtype /Type0 /BaseFont /${font.res}Onest /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R` });
    }
    const resources = `/Font << ${Object.entries(fontRefs).map(([r, id]) => `/${r} ${id} 0 R`).join(' ')} >> /XObject << ${this.images.map((i) => `/${i.res} ${i.obj} 0 R`).join(' ')} >> /ExtGState << ${[...this.states.values()].map((g) => `/${g.res} ${g.obj} 0 R`).join(' ')} >> /Shading << ${this.shadings.map((s) => `/${s.res} ${s.obj} 0 R`).join(' ')} >> /ProcSet [/PDF /Text /ImageB /ImageC]`;
    const pagesId = this._reserve();
    /* ссылки — аннотации страницы: прямоугольник без рамки и адрес (URI в скобках PDF — с экранированием скобок и косой) */
    const uri = (u) => u.replace(/[\\()]/g, (c) => '\\' + c);
    const pageIds = this.pages.map((p) => {
      const content = this._add({ dict: '/Filter /FlateDecode', stream: deflateSync(enc(p.ops.join('\n'))) });
      const annots = p.links.map((l) => this._add({ dict: `/Type /Annot /Subtype /Link /Rect [${num(l.x)} ${num(l.y)} ${num(l.x + l.w)} ${num(l.y + l.h)}] /Border [0 0 0] /A << /S /URI /URI (${uri(l.uri)}) >>` }));
      return this._add({ dict: `/Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(this.w)} ${num(this.h)}] /Resources << ${resources} >> /Contents ${content} 0 R${annots.length ? ` /Annots [${annots.map((i) => i + ' 0 R').join(' ')}]` : ''}` });
    });
    this._set(pagesId, { dict: `/Type /Pages /Kids [${pageIds.map((i) => i + ' 0 R').join(' ')}] /Count ${pageIds.length}` });
    const catalog = this._add({ dict: `/Type /Catalog /Pages ${pagesId} 0 R` });
    const text16 = (s) => '<FEFF' + Buffer.from(s, 'utf16le').swap16().toString('hex').toUpperCase() + '>';
    const info = this._add({ dict: `/Title ${text16(this.title)} /Author ${text16(this.author)} /Producer ${text16('Лунарио')} /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z)` });
    /* сборка: заголовок, объекты, xref, трейлер */
    const parts = [enc('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')]; const offsets = []; let pos = parts[0].length;
    this.objects.forEach((o, i) => {
      offsets.push(pos);
      const head = enc(`${i + 1} 0 obj\n<< ${o.dict}${o.stream ? ` /Length ${o.stream.length}` : ''} >>\n`);
      const body = o.stream ? Buffer.concat([enc('stream\n'), o.stream, enc('\nendstream\n')]) : Buffer.alloc(0);
      const tail = enc('endobj\n');
      parts.push(head, body, tail); pos += head.length + body.length + tail.length;
    });
    const xref = enc(`xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${this.objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`);
    parts.push(xref);
    return Buffer.concat(parts);
  }
}

/* Рисование на странице. Координаты — как в PDF: начало внизу слева, y растет вверх. */
class PageWriter {
  constructor(page, doc) { this.page = page; this.doc = doc; }
  _op(s) { this.page.ops.push(s); }
  fillPage(color) { this._op(`q ${rgbOp(color, 'rg')} 0 0 ${num(this.doc.w)} ${num(this.doc.h)} re f Q`); }
  glow(cx, cy, r, color, bg, alpha) { const sh = this.doc._shading(cx, cy, r, color, bg); this._op(`q /${this.doc._state(alpha, alpha)} gs /${sh} sh Q`); }
  _roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2); const k = K * r;
    return `${num(x + r)} ${num(y)} m ${num(x + w - r)} ${num(y)} l ${num(x + w - r + k)} ${num(y)} ${num(x + w)} ${num(y + r - k)} ${num(x + w)} ${num(y + r)} c `
      + `${num(x + w)} ${num(y + h - r)} l ${num(x + w)} ${num(y + h - r + k)} ${num(x + w - r + k)} ${num(y + h)} ${num(x + w - r)} ${num(y + h)} c `
      + `${num(x + r)} ${num(y + h)} l ${num(x + r - k)} ${num(y + h)} ${num(x)} ${num(y + h - r + k)} ${num(x)} ${num(y + h - r)} c `
      + `${num(x)} ${num(y + r)} l ${num(x)} ${num(y + r - k)} ${num(x + r - k)} ${num(y)} ${num(x + r)} ${num(y)} c h`;
  }
  /* Панель: заливка и/или обводка с прозрачностью, скругленные углы */
  panel(x, y, w, h, { radius = 10, fill = null, fillAlpha = 1, stroke = null, strokeAlpha = 1, lineWidth = 0.75 } = {}) {
    const gs = this.doc._state(fillAlpha, strokeAlpha);
    const ops = [`q /${gs} gs`];
    if (fill) ops.push(rgbOp(fill, 'rg')); if (stroke) ops.push(rgbOp(stroke, 'RG'), `${num(lineWidth)} w`);
    ops.push(this._roundRect(x, y, w, h, radius), fill && stroke ? 'B' : fill ? 'f' : 'S', 'Q');
    this._op(ops.join(' '));
  }
  line(x1, y1, x2, y2, color, alpha = 1, width = 0.6) { this._op(`q /${this.doc._state(alpha, alpha)} gs ${rgbOp(color, 'RG')} ${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S Q`); }
  circle(cx, cy, r, color, alpha = 1) {
    const k = K * r;
    this._op(`q /${this.doc._state(alpha, alpha)} gs ${rgbOp(color, 'rg')} ${num(cx + r)} ${num(cy)} m ${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c ${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c ${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c ${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c h f Q`);
  }
  image(img, x, y, w, h, { clipCircle = false } = {}) {
    const clip = clipCircle ? (() => { const r = Math.min(w, h) / 2, cx = x + w / 2, cy = y + h / 2, k = K * r; return `${num(cx + r)} ${num(cy)} m ${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c ${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c ${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c ${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c h W n `; })() : '';
    this._op(`q ${clip}${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /${img.res} Do Q`);
  }
  /* Ссылка: область (x, y — левый нижний угол) ведет по адресу; на бумаге не видна */
  link(x, y, w, h, uri) { this.page.links.push({ x, y, w, h, uri }); }
  /* Текст одной строкой; spacing — трекинг в пунктах (для капительных подписей) */
  text(font, size, x, y, str, color, { spacing = 0, alpha = 1 } = {}) {
    const f = font.ttf; let hex = '';
    for (const ch of str) { const cp = ch.codePointAt(0); let g = f.gid(cp); if (!g && cp !== 32) g = f.gid(0x25a1) || 0; if (g && !font.used.has(g)) font.used.set(g, cp); hex += g.toString(16).padStart(4, '0'); }
    this._op(`BT ${alpha < 1 ? `/${this.doc._state(alpha, alpha)} gs ` : ''}${rgbOp(color, 'rg')} /${font.res} ${num(size)} Tf ${num(spacing)} Tc 1 0 0 1 ${num(x)} ${num(y)} Tm <${hex}> Tj ET`);
  }
}

/* Перенос текста по словам под ширину; слишком длинное слово режется по буквам */
export function wrap(font, size, text, maxWidth, spacing = 0) {
  const lines = [];
  for (const para of String(text).replace(/\r/g, '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean); let line = '';
    if (!words.length) { lines.push(''); continue; }
    for (let w of words) {
      while (font.width(w, size, spacing) > maxWidth) {   /* слово шире строки — отрезаем по буквам */
        let cut = [...w].length - 1; while (cut > 1 && font.width([...w].slice(0, cut).join(''), size, spacing) > maxWidth) cut--;
        const head = [...w].slice(0, cut).join('');
        if (line) { lines.push(line); line = ''; }
        lines.push(head); w = [...w].slice(cut).join('');
      }
      const probe = line ? line + ' ' + w : w;
      if (font.width(probe, size, spacing) <= maxWidth) line = probe; else { lines.push(line); line = w; }
    }
    lines.push(line);
  }
  return lines;
}
