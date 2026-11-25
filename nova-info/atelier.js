/* Atelier Nova-Info — éditeur de vidéos « Et si… ? » dans le navigateur.
 *
 * Charge un PROJET exporté par la chaîne de production Nova-Info (dossier : project.nova.json, audio.mp3, images/, clips/, fonts/),
 * permet de remplacer les images, régler cadrage / étalonnage / effets, éditer sous-titres et textes d'habillage,
 * puis exporte la vidéo (capture temps réel du canvas + son).
 *
 * Rien n'est envoyé nulle part : tout reste dans le navigateur, les fichiers restent sur ton ordinateur.
 */
(function () {
  'use strict';
  const W = 1080, H = 1920;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const cl = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const E = { io: x => { x = cl(x); return x * x * x * (x * (x * 6 - 15) + 10); }, out: x => 1 - Math.pow(1 - cl(x), 3), in: x => Math.pow(cl(x), 3), lin: x => cl(x) };
  const easeBack = x => { x = cl(x); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mulberry = seed => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
  const toast = (m, a) => (typeof window.toast === 'function' ? window.toast(m, a) : console.log(m));

  /* ------------------------------------------------------------------ état */
  const S = {
    P: null, dir: null, files: new Map(), urls: new Map(), imgs: new Map(), vids: new Map(),
    audio: null, sel: 0, tab: 'plans', t: 0, playing: false, dirty: false, hist: [], fut: [], busy: false,
    hostEl: null, ready: false, raf: 0, exporting: false,
  };
  const COLOR_KEY = [255, 96, 72];

  /* ------------------------------------------------------------------ fichiers du projet */
  async function readFromDir(path) {
    let h = S.dir; const parts = path.split('/');
    for (let i = 0; i < parts.length - 1; i++) h = await h.getDirectoryHandle(parts[i]);
    return (await h.getFileHandle(parts[parts.length - 1])).getFile();
  }
  async function getFile(path) {
    if (S.files.has(path)) return S.files.get(path);
    if (S.dir) { const f = await readFromDir(path); S.files.set(path, f); return f; }
    throw new Error('Fichier introuvable dans le projet : ' + path);
  }
  async function urlOf(path) {
    if (S.urls.has(path)) return S.urls.get(path);
    const u = URL.createObjectURL(await getFile(path)); S.urls.set(path, u); return u;
  }
  async function loadImage(path) {
    if (S.imgs.has(path)) return S.imgs.get(path);
    const im = new Image(); im.src = await urlOf(path); await im.decode().catch(() => { });
    S.imgs.set(path, im); return im;
  }
  async function loadVideo(path) {
    if (S.vids.has(path)) return S.vids.get(path);
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = await urlOf(path);
    await new Promise(r => { v.onloadeddata = r; v.onerror = r; setTimeout(r, 4000); });
    S.vids.set(path, v); return v;
  }

  async function openProject(src) {
    busy('Ouverture du projet…');
    try {
      let proj;
      if (src.dir) { S.dir = src.dir; S.files.clear(); proj = JSON.parse(await (await readFromDir('project.nova.json')).text()); }
      else {
        S.dir = null; S.files.clear();
        for (const f of src.files) { const rel = f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(1).join('/') : f.name; S.files.set(rel, f); }
        const pf = S.files.get('project.nova.json'); if (!pf) throw new Error("Pas de fichier project.nova.json dans ce dossier.");
        proj = JSON.parse(await pf.text());
      }
      if (proj.format !== 'nova-info-project') throw new Error("Ce n'est pas un projet Nova-Info.");
      for (const [p, d] of Object.entries(proj.embedded || {})) S.files.set(p, await (await fetch(d)).blob());
      S.urls.forEach(u => URL.revokeObjectURL(u)); S.urls.clear(); S.imgs.clear(); S.vids.clear();
      S.P = proj; S.sel = 0; S.t = 0; S.hist = []; S.fut = []; S.dirty = false;
      // polices
      for (const [k, p] of Object.entries(proj.brand.fonts)) {
        const ff = new FontFace('NI-' + k, `url(${await urlOf(p)})`); await ff.load(); document.fonts.add(ff);
      }
      // audio
      if (S.audio) { S.audio.pause(); }
      S.audio = new Audio(await urlOf(proj.audio)); S.audio.preload = 'auto';
      await new Promise(r => { S.audio.onloadeddata = r; S.audio.onerror = r; setTimeout(r, 5000); });
      // médias
      let n = 0;
      for (const s of proj.shots) { busy(`Chargement des médias… ${++n}/${proj.shots.length}`); await (s.kind === 'image' ? loadImage(s.src) : loadVideo(s.src)); }
      S.ready = true; buildUI(); renderNow(); toast('Projet ouvert : ' + proj.meta.title);
    } catch (e) { console.error(e); toast('Impossible d’ouvrir le projet : ' + e.message); }
    busy('');
  }

  async function saveProject() {
    if (!S.P) return;
    const P = JSON.parse(JSON.stringify(S.P)); delete P.embedded;
    if (S.dir) {
      try {
        for (const [p, f] of S.files) if (/^images\/custom_/.test(p) && !S.saved?.has(p)) {
          const parts = p.split('/'); const d = await S.dir.getDirectoryHandle(parts[0], { create: true });
          const w = await (await d.getFileHandle(parts[1], { create: true })).createWritable(); await w.write(f); await w.close();
          (S.saved ||= new Set()).add(p);
        }
        const w = await (await S.dir.getFileHandle('project.nova.json', { create: true })).createWritable();
        await w.write(JSON.stringify(P, null, 1)); await w.close();
        S.dirty = false; refreshTop(); toast('Projet enregistré dans le dossier');
      } catch (e) { toast('Enregistrement impossible : ' + e.message); }
    } else {
      P.embedded = {};
      for (const [p, f] of S.files) if (/^images\/custom_/.test(p)) P.embedded[p] = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      download(new Blob([JSON.stringify(P)], { type: 'application/json' }), 'project.nova.json');
      S.dirty = false; refreshTop(); toast('project.nova.json téléchargé (remplace l’ancien dans ton dossier de projet)');
    }
  }
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

  /* historique (annuler / rétablir) */
  function snap() { return JSON.stringify(S.P); }
  function commit(label) {
    S.hist.push(snap()); if (S.hist.length > 120) S.hist.shift(); S.fut = []; S.dirty = true; refreshTop();
  }
  async function undo() { if (!S.hist.length) return; S.fut.push(snap()); S.P = JSON.parse(S.hist.pop()); await ensureMedia(); S.dirty = true; buildInspector(); buildTimeline(); renderNow(); refreshTop(); }
  async function redo() { if (!S.fut.length) return; S.hist.push(snap()); S.P = JSON.parse(S.fut.pop()); await ensureMedia(); S.dirty = true; buildInspector(); buildTimeline(); renderNow(); refreshTop(); }
  async function ensureMedia() { for (const s of S.P.shots) { if (s.kind === 'image') await loadImage(s.src); else await loadVideo(s.src); } }

  /* ------------------------------------------------------------------ moteur de rendu */
  class Renderer {
    constructor(scale) {
      this.s = scale; this.cw = Math.round(W * scale); this.ch = Math.round(H * scale);
      this.main = document.createElement('canvas'); this.main.width = this.cw; this.main.height = this.ch;
      this.A = this.mk(); this.B = this.mk(); this.vig = null; this.grain = null;
      this.mctx = this.main.getContext('2d');
    }
    mk() { const c = document.createElement('canvas'); c.width = this.cw; c.height = this.ch; return c; }
    vignette() {
      if (this.vig) return this.vig;
      const c = this.mk(), x = c.getContext('2d'); x.setTransform(this.s, 0, 0, this.s, 0, 0);
      const g = x.createRadialGradient(W / 2, H * 0.48, W * 0.2, W / 2, H * 0.48, H * 0.66);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.55, 'rgba(0,0,0,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.62)');
      x.fillStyle = g; x.fillRect(0, 0, W, H); return (this.vig = c);
    }
    grainTile() {
      if (this.grain) return this.grain;
      const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'), d = x.createImageData(256, 256), r = mulberry(7);
      for (let i = 0; i < d.data.length; i += 4) { const v = 128 + (r() - 0.5) * 110; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
      x.putImageData(d, 0, 0); return (this.grain = c);
    }
  }

  const shotAt = (P, t) => { const sh = P.shots; for (let i = sh.length - 1; i >= 0; i--) if (t >= sh[i].t0) return i; return 0; };

  function filterFor(P, name, dim) {
    const g = P.grades[name]; if (!g) return dim ? `brightness(${1 - dim})` : 'none';
    const gain = (g.gain[0] + g.gain[1] + g.gain[2]) / 3;
    const br = gain * Math.pow(0.5, (g.gamma - 1) * 0.6) * (1 - g.dark * 0.55) * (1 - (dim || 0)) * (1 + (g.lift[0] + g.lift[1] + g.lift[2]) / 3 * 0.8);
    return `saturate(${g.sat}) contrast(${g.contrast}) brightness(${br.toFixed(3)})`;
  }
  function tintFor(P, name) {
    const g = P.grades[name]; if (!g) return null; const m = Math.max(...g.gain);
    return g.gain.map(v => Math.round(v / m * 255));
  }

  function camAt(shot, lt) {
    const dur = Math.max(shot.t1 - shot.t0, 0.05), p = cl(lt / dur), e = (E[shot.ease || 'io'] || E.io)(p), f = shot.cam.from, t = shot.cam.to;
    return [lerp(f[0], t[0], e), lerp(f[1], t[1], e), lerp(f[2], t[2], e)];
  }

  /* dessine un plan (image ou clip) dans le contexte x (coordonnées 1080×1920 via setTransform) */
  function drawShot(R, x, shot, t) {
    const P = S.P, lt = t - shot.t0;
    x.save(); x.setTransform(R.s, 0, 0, R.s, 0, 0); x.fillStyle = '#05060b'; x.fillRect(0, 0, W, H);
    if (shot.kind === 'image') {
      const im = S.imgs.get(shot.src);
      if (im && im.naturalWidth) {
        const [cx, cy, h] = camAt(shot, lt), iw = im.naturalWidth, ih = im.naturalHeight;
        const shake = [0.0016 * Math.sin(lt * 1.3 + 1), 0.0012 * Math.cos(lt * 1.7)];
        let ch = h * ih, cw = ch * W / H; if (cw > iw) { cw = iw; ch = cw * H / W; }
        const x0 = cl(cx * iw - cw / 2 + shake[0] * cw, 0, iw - cw), y0 = cl(cy * ih - ch / 2 + shake[1] * ch, 0, ih - ch);
        if (shot.contain) {  // image entière sur fond flouté
          const c = shot.contain, z = lerp((c.zoom || [1, 1.08])[0], (c.zoom || [1, 1.08])[1], E.io(lt / Math.max(shot.t1 - shot.t0, .05)));
          const f = filterFor(P, shot.grade, shot.dim); x.filter = `blur(28px) ${f === 'none' ? '' : f} brightness(${c.bg ?? .35})`; x.drawImage(im, 0, 0, iw, ih, -80, -80, W + 160, H + 160);
          const tw = W * (c.scale ?? .94) * z, th = tw * ih / iw; x.filter = f; x.drawImage(im, 0, 0, iw, ih, (W - tw) / 2, (c.y ?? .46) * H - th / 2, tw, th); x.filter = 'none'; tint(x, P, shot.grade);
        } else if (shot.split) {
          const sp = shot.split, xd = lerp(sp.div[0], sp.div[1], E.io(lt / Math.max(shot.t1 - shot.t0, .05))) * W;
          x.save(); x.beginPath(); x.rect(0, 0, xd, H); x.clip(); x.filter = filterFor(P, sp.left, shot.dim); x.drawImage(im, x0, y0, cw, ch, 0, 0, W, H); tint(x, P, sp.left); x.restore();
          x.save(); x.beginPath(); x.rect(xd, 0, W - xd, H); x.clip(); x.filter = filterFor(P, sp.right, shot.dim); x.drawImage(im, x0, y0, cw, ch, 0, 0, W, H); tint(x, P, sp.right); x.restore();
          x.fillStyle = rgb(P.brand.colors.bone); x.fillRect(xd - 2, 0, 4, H);
        } else {
          x.filter = filterFor(P, shot.grade, shot.dim); x.drawImage(im, x0, y0, cw, ch, 0, 0, W, H); x.filter = 'none'; tint(x, P, shot.grade);
        }
      }
    } else {
      const v = S.vids.get(shot.src);
      if (v && v.readyState >= 2) { x.filter = shot.dim ? `brightness(${1 - shot.dim})` : 'none'; x.drawImage(v, 0, 0, W, H); x.filter = 'none'; }
    }
    effects(R, x, shot, lt);
    x.restore();
  }
  function tint(x, P, name) {
    const c = tintFor(P, name); if (!c || (c[0] > 250 && c[1] > 250 && c[2] > 250)) return;
    x.save(); x.globalCompositeOperation = 'multiply'; x.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; x.fillRect(0, 0, W, H); x.restore();
  }
  function effects(R, x, shot, lt) {
    for (const fx of shot.fx || []) {
      const name = Array.isArray(fx) ? fx[0] : fx, a = Array.isArray(fx) ? (fx[1] || {}) : {};
      if (name === 'fog') {
        const d = a.density ?? 0.2, col = a.color || [150, 160, 170], sp = a.speed ?? 12;
        x.save();
        for (let i = 0; i < 6; i++) {
          const cx = ((i * 330 + lt * sp * 6 + 90 * Math.sin(lt * 0.2 + i)) % (W + 700)) - 350, cy = 380 + i * 260 + 70 * Math.sin(lt * 0.15 + i * 2);
          const g = x.createRadialGradient(cx, cy, 0, cx, cy, 460); g.addColorStop(0, rgb(col, d * 1.1)); g.addColorStop(1, rgb(col, 0));
          x.fillStyle = g; x.fillRect(cx - 460, cy - 460, 920, 920);
        }
        x.restore();
      } else if (name === 'embers' || name === 'snow' || name === 'dust') {
        const n = a.n ?? 60, r = mulberry(a.seed ?? 3); x.save(); x.filter = 'blur(1.6px)';
        for (let i = 0; i < n; i++) {
          const x0 = r() * W, y0 = r() * H, sp = 0.4 + r() * 1.0, ph = r() * 6.28, sz = 1.5 + r() * 3;
          let px, py, col;
          if (name === 'embers') { px = (x0 + 30 * Math.sin(lt * .8 * sp + ph) + W * 2) % W; py = ((y0 - lt * 70 * sp) % H + H) % H; col = `rgba(255,${Math.round(120 + 80 * Math.sin(lt * 3 + ph))},40,0.85)`; }
          else if (name === 'snow') { px = (x0 + 40 * Math.sin(lt * .5 + ph) + W * 2) % W; py = (y0 + lt * 90 * sp) % H; col = 'rgba(232,236,246,0.85)'; }
          else { px = (x0 + lt * 20 * sp) % W; py = y0 + 14 * Math.sin(lt * .4 + ph); col = 'rgba(210,200,170,0.7)'; }
          x.fillStyle = col; x.beginPath(); x.arc(px, py, sz * 1.1, 0, 7); x.fill();
        }
        x.restore();
      } else if (name === 'flicker') {
        const k = 0.93 + 0.07 * Math.sin(lt * 9) * Math.sin(lt * 3.1 + 1.3); x.fillStyle = `rgba(0,0,0,${(1 - k).toFixed(3)})`; x.fillRect(0, 0, W, H);
      } else if (name === 'streak') {
        const k = (lt - (a.t0 ?? 0)) / (a.dur ?? 1); if (k > 0 && k < 1.6) {
          const [x0, y0] = a.from, [x1, y1] = a.to, kk = Math.pow(Math.min(k, 1), 1.7), hx = lerp(x0, x1, kk) * W, hy = lerp(y0, y1, kk) * H;
          const dx = (x0 - x1) * W, dy = (y0 - y1) * H; x.save(); x.globalCompositeOperation = 'lighter'; x.shadowColor = 'rgba(255,190,100,.9)'; x.shadowBlur = 36;
          for (let q = 0; q < 28; q++) { const f = q / 28, px = hx + dx * .22 * f * Math.min(kk * 3, 1), py = hy + dy * .22 * f * Math.min(kk * 3, 1);
            x.fillStyle = `rgba(255,${Math.round(200 * Math.pow(1 - f, 1.6))},${Math.round(110 * Math.pow(1 - f, 2.2))},${Math.pow(1 - f, 1.2).toFixed(3)})`; x.beginPath(); x.arc(px, py, Math.max(11 * (1 - f) + 2, 2), 0, 7); x.fill(); }
          if (k < 1) { x.fillStyle = 'rgba(255,250,235,1)'; x.beginPath(); x.arc(hx, hy, 14, 0, 7); x.fill(); }
          else { const fk = (k - 1) / .6; x.fillStyle = `rgba(255,${Math.round(210 * (1 - fk))},${Math.round(120 * (1 - fk))},${Math.pow(1 - fk, 1.3).toFixed(3)})`; x.beginPath(); x.arc(x1 * W, y1 * H, 30 + 260 * fk, 0, 7); x.fill(); }
          x.restore(); }
      } else if (name === 'redpulse') {
        const k = 0.10 + 0.08 * Math.sin(lt * 2.4); x.fillStyle = `rgba(255,0,0,${k.toFixed(3)})`; x.fillRect(0, 0, W, H);
      }
    }
  }

  /* ---- habillage ---- */
  function text(x, str, px, py, fontName, size, color, o = {}) {
    x.save(); x.font = `${size}px "NI-${fontName}", sans-serif`; x.textBaseline = 'top'; x.textAlign = o.align || 'left';
    x.letterSpacing = (o.spacing || 0) + 'px'; x.globalAlpha = o.alpha ?? 1; x.lineJoin = 'round';
    if (o.shadow) { x.shadowColor = 'rgba(0,0,0,.85)'; x.shadowBlur = 14; x.shadowOffsetY = 6; if (!o.stroke) { x.fillStyle = color; x.fillText(str, px, py); x.shadowColor = 'transparent'; } }
    if (o.stroke) { x.strokeStyle = '#08080a'; x.lineWidth = o.stroke * 2; x.strokeText(str, px, py); x.shadowColor = 'transparent'; }
    x.fillStyle = color; x.fillText(str, px, py); x.restore();
  }
  const measure = (x, str, fontName, size, spacing = 0) => { x.save(); x.font = `${size}px "NI-${fontName}", sans-serif`; x.letterSpacing = spacing + 'px'; const w = x.measureText(str).width; x.restore(); return w; };

  function drawLogo(x, P, a = 1) { text(x, P.brand.name, P.brand.safe.left, P.brand.safe.top - 6, 'black', 40, rgb(P.brand.colors.bone), { spacing: 4, shadow: true, alpha: .92 * a }); }

  function drawChip(x, P, tag, t, source) {
    const col = P.brand.tags[tag] || [236, 176, 66], a = E.out(t / 0.3), sf = P.brand.safe;
    const tw = measure(x, tag, 'extrabold', 36, 3), w = tw + 86, h = 68, px = sf.left - (1 - a) * 40, py = sf.top + 44;
    x.save(); x.globalAlpha = a; x.fillStyle = 'rgba(10,13,19,.75)'; x.strokeStyle = rgb(col); x.lineWidth = 3;
    x.beginPath(); x.roundRect(px, py, w, h, 34); x.fill(); x.stroke();
    x.fillStyle = rgb(col); x.beginPath(); x.arc(px + 36, py + h / 2, 10, 0, 7); x.fill(); x.restore();
    text(x, tag, px + 60, py + 12, 'extrabold', 36, rgb(col), { spacing: 3, alpha: a });
    if (source) text(x, source, sf.left, sf.top + 142, 'semibold', 29, rgb(P.brand.colors.bone), { spacing: 2, shadow: true, alpha: .9 * a });
  }

  function drawOverlay(x, P, o, t) {
    const sf = P.brand.safe, amber = P.brand.colors.amber, bone = P.brand.colors.bone, lt = t - (o.at || 0), dur = o.dur ?? 3;
    if (o.type === 'card') {
      if (lt < 0 || lt > dur) return; const tail = cl((lt - (dur - 0.35)) / 0.35), a = E.out(lt / 0.35) * (1 - tail), y = o.y ?? 560, size = o.size ?? 96;
      const top = Math.max(y - 70, 0), bot = Math.min(y + size * 1.5 + 120, H), g = x.createLinearGradient(0, top, 0, bot);
      for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, `rgba(0,0,0,${(0.6 * Math.pow(Math.max(Math.sin(Math.PI * i / 12), 0), 1.15) * a).toFixed(3)})`);
      x.fillStyle = g; x.fillRect(0, top, W, bot - top);
      text(x, o.text || '', sf.left - (1 - E.out(lt / .45)) * 60, y + 24, 'black', size, rgb(bone), { shadow: true, alpha: a, spacing: 1 });
      const lw = E.out((lt - .1) / .5) * Math.min(measure(x, o.text || '', 'black', size, 1), 640);
      if (lw > 0) { x.fillStyle = rgb(amber); x.fillRect(sf.left, y + size * 1.5 + 6, lw, 6); }
      if (o.sub) text(x, o.sub, sf.left, y + size * 1.5 + 22 + 24, 'semibold', 36, rgb(amber), { spacing: 4, shadow: true, alpha: a * E.out((lt - .2) / .4) });
    } else if (o.type === 'bigword') {
      if (lt < 0 || lt > dur) return; const size = o.size ?? 150, a = E.out(lt / .25) * (1 - cl((lt - (dur - .3)) / .3)), k = 1 + .18 * (1 - E.out(lt / .5));
      x.save(); x.translate((W - sf.right / 2) / 2 + 20, (o.y ?? 700) + size * .5); x.scale(k, k);
      text(x, o.text || '', 0, -size * .5, o.font || 'serif_italic', size, rgb(bone), { align: 'center', shadow: true, alpha: a, spacing: 2 }); x.restore();
    } else if (o.type === 'stamp') {
      if (lt < 0) return; const size = o.size ?? 118, tw = measure(x, o.text || '', 'black', size, 4), pad = 36, k = 1 + .9 * (1 - easeBack(lt / .22)), col = o.color || P.brand.colors.red;
      x.save(); x.globalAlpha = cl(lt / .08) * .93; x.translate(o.x ?? 520, o.y ?? 760); x.rotate((o.rot ?? -7) * Math.PI / 180); x.scale(k, k);
      x.strokeStyle = rgb(col); x.lineWidth = 12; x.beginPath(); x.roundRect(-tw / 2 - pad, -size * .6 - pad / 2, tw + pad * 2, size * 1.2 + pad, 14); x.stroke();
      text(x, o.text || '', 0, -size * .62, 'black', size, rgb(col), { align: 'center', spacing: 4 }); x.restore();
    } else if (o.type === 'list') {
      (o.items || []).forEach((it, i) => {
        const l2 = t - (o.times?.[i] ?? 0); if (l2 < 0) return; const a = E.out(l2 / .3), yy = (o.y ?? 560) + i * 132;
        text(x, '0' + (i + 1), sf.left - (1 - a) * 50, yy + 24, 'black', 40, rgb(amber), { spacing: 2, shadow: true, alpha: a });
        text(x, it, sf.left + 8 - (1 - a) * 80, yy + 68, 'black', o.size ?? 66, rgb(bone), { shadow: true, alpha: a, spacing: 1 });
      });
    }
  }

  /* sous-titres karaoké */
  function subLayout(x, words, size, maxW) {
    const sp = measure(x, ' ', 'black', size, 2) + 4, wl = w => measure(x, w.w.toUpperCase(), 'black', size, 2);
    const total = words.reduce((a, w) => a + wl(w), 0) + sp * (words.length - 1);
    if (total <= maxW * 0.62 || words.length === 1) return { lines: [words], sp, wl };
    let best = null, bi = 1;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).reduce((s, w) => s + wl(w), 0) + sp * (i - 1), b = words.slice(i).reduce((s, w) => s + wl(w), 0) + sp * (words.length - i - 1);
      if (best === null || Math.max(a, b) < best) { best = Math.max(a, b); bi = i; }
    }
    return { lines: [words.slice(0, bi), words.slice(bi)], sp, wl };
  }
  function drawSubs(x, P, t) {
    const st = P.brand.subtitle, subs = P.subtitles, opt = P.options || {};
    if (opt.subsOff) return;
    for (let ci = 0; ci < subs.length; ci++) {
      const c = subs[ci]; if (!(c.start - 0.04 <= t && t < c.end) || !c.words.length) continue;
      let size = opt.subSize || st.max_font, L;
      for (let k = 0; k < 8; k++) {
        L = subLayout(x, c.words, size, st.max_width);
        const widest = Math.max(...L.lines.map(l => l.reduce((s, w) => s + L.wl(w), 0) + L.sp * (l.length - 1)));
        if (widest <= st.max_width || size <= st.min_font) break; size -= 4;
      }
      let active = -1; c.words.forEach((w, i) => { if (w.start - 0.02 <= t) active = i; }); if (t > c.words[c.words.length - 1].end + 0.05) active = -1;
      const a = E.out((t - (c.start - 0.04)) / 0.08), lh = size * 1.18, y0 = (opt.subY || st.y_center) - lh * L.lines.length / 2 + (1 - a) * 14;
      let idx = 0;
      L.lines.forEach((ln, li) => {
        const lw = ln.reduce((s, w) => s + L.wl(w), 0) + L.sp * (ln.length - 1); let px = st.x_center - lw / 2;
        for (const w of ln) {
          const col = idx === active ? P.brand.colors.amber : (w.key ? COLOR_KEY : P.brand.colors.bone);
          text(x, w.w.toUpperCase(), px, y0 + li * lh, 'black', size, rgb(col), { spacing: 2, stroke: 9, shadow: true, alpha: a });
          px += L.wl(w) + L.sp; idx++;
        }
      });
      return;
    }
  }

  function drawEnd(x, P, tl) {
    const a = E.io(tl / .6), c = P.brand.colors; x.save(); x.fillStyle = rgb(c.ink, a * .92); x.fillRect(0, 0, W, H); x.restore();
    text(x, P.brand.name, W / 2 - 20, 800 + 24, 'black', 112, rgb(c.bone), { align: 'center', spacing: 9, shadow: true, alpha: E.out((tl - .2) / .5) });
    const ln = E.out((tl - .55) / .5) * 380; if (ln > 0) { x.fillStyle = rgb(c.amber); x.fillRect(W / 2 - ln / 2 - 20, 972, ln, 4); }
    if (P.brand.outro_title) text(x, P.brand.outro_title, W / 2 - 20, 1000 + 24, 'extrabold', 50, rgb(c.amber), { align: 'center', spacing: 5, alpha: E.out((tl - .95) / .5) });
  }

  /* un instant complet de la vidéo */
  function renderFrame(R, t, o = {}) {
    const P = S.P, sh = P.shots, i = shotAt(P, t), s = sh[i], lt = t - s.t0, x = R.mctx;
    const kind = s.trans || 'cut', d = { cut: 0, dissolve: .28, dip: .45, whip: .26, flash: .12 }[kind] || 0;
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.filter = 'none';
    const ax = R.A.getContext('2d'); drawShot(R, ax, s, t);
    x.drawImage(R.A, 0, 0);
    if (i > 0 && d > 0 && lt < d) {
      const k = E.io(lt / d), bx = R.B.getContext('2d'); drawShot(R, bx, sh[i - 1], t);
      if (kind === 'dissolve') { x.drawImage(R.B, 0, 0); x.globalAlpha = k; x.drawImage(R.A, 0, 0); x.globalAlpha = 1; }
      else if (kind === 'dip') { x.drawImage(k < .5 ? R.B : R.A, 0, 0); x.fillStyle = `rgba(0,0,0,${(1 - Math.abs(k - .5) * 2).toFixed(3)})`; x.fillRect(0, 0, R.cw, R.ch); }
      else if (kind === 'whip') { const sx = Math.round(R.cw * .5 * k); x.drawImage(R.B, -sx, 0); x.drawImage(R.A, R.cw - sx, 0); }
      else if (kind === 'flash') { x.fillStyle = `rgba(255,255,255,${(0.6 * (1 - k)).toFixed(3)})`; x.fillRect(0, 0, R.cw, R.ch); }
    }
    x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(R.vignette(), 0, 0);
    x.save(); x.globalAlpha = .07; x.globalCompositeOperation = 'overlay'; const g = R.grainTile(); const ox = (Math.random() * 256) | 0, oy = (Math.random() * 256) | 0;
    x.fillStyle = x.createPattern(g, 'repeat'); x.translate(-ox, -oy); x.fillRect(ox, oy, R.cw, R.ch); x.restore();
    x.setTransform(R.s, 0, 0, R.s, 0, 0);
    const endAt = P.meta.duration - P.meta.end_card, inEnd = t > endAt, opt = P.options || {};
    for (const ov of s.overlays || []) drawOverlay(x, P, ov, lt);
    const cs = (i > 0 && d > 0 && lt < d * .5 && (kind === 'dip' || kind === 'dissolve')) ? sh[i - 1] : s;
    if (cs.tag && !inEnd && !opt.tagsOff) drawChip(x, P, cs.tag, t - (cs.tag_t0 ?? cs.t0), cs.source);
    drawLogo(x, P);
    if (!inEnd) drawSubs(x, P, t);
    if (t < .35) { x.fillStyle = `rgba(0,0,0,${(1 - E.io(t / .35)).toFixed(3)})`; x.fillRect(0, 0, W, H); }
    if (inEnd) drawEnd(x, P, t - endAt);
    return R.main;
  }

  /* ------------------------------------------------------------------ lecture & aperçu */
  let PR = null; // rendu d'aperçu
  function previewRenderer() { return PR || (PR = new Renderer(0.5)); }
  function syncClips(t, playing) {
    const s = S.P.shots[shotAt(S.P, t)];
    for (const [path, v] of S.vids) {
      const mine = s.kind === 'clip' && s.src === path;
      if (mine) {
        const want = cl(t - s.t0, 0, v.duration || 99);
        if (playing) { if (v.paused) { v.currentTime = want; v.play().catch(() => { }); } else if (Math.abs(v.currentTime - want) > .2) v.currentTime = want; }
        else { v.pause(); if (Math.abs(v.currentTime - want) > .02) v.currentTime = want; }
      } else if (!v.paused) v.pause();
    }
  }
  function renderNow() {
    if (!S.ready || S.exporting) return;
    const R = previewRenderer(), cv = $('#atCanvas'); if (!cv) return;
    syncClips(S.t, S.playing);
    renderFrame(R, S.t); const c = cv.getContext('2d'); c.drawImage(R.main, 0, 0);
    const ph = $('#atHead'); if (ph) ph.style.left = (S.t / S.P.meta.duration * 100) + '%';
    const tl = $('#atTime'); if (tl) tl.textContent = `${fmt(S.t)} / ${fmt(S.P.meta.duration)}`;
    const sc = $('#atScrub'); if (sc && document.activeElement !== sc) sc.value = S.t;
  }
  function loop() {
    if (!S.playing) return;
    S.t = S.audio.currentTime; if (S.t >= S.P.meta.duration - 0.02) { pause(); S.t = S.P.meta.duration - 0.02; }
    const i = shotAt(S.P, S.t); if (i !== S.sel && !S.userSel) { S.sel = i; highlightSel(); }
    renderNow(); S.raf = requestAnimationFrame(loop);
  }
  function play() { if (!S.ready) return; if (S.t >= S.P.meta.duration - 0.05) S.t = 0; S.audio.currentTime = S.t; S.audio.play(); S.playing = true; S.userSel = false; $('#atPlay').textContent = '⏸ Pause'; cancelAnimationFrame(S.raf); loop(); }
  function pause() { S.playing = false; S.audio?.pause(); $('#atPlay') && ($('#atPlay').textContent = '▶ Lecture'); syncClips(S.t, false); }
  function seek(t) { S.t = cl(t, 0, S.P.meta.duration - 0.02); if (S.audio) S.audio.currentTime = S.t; renderNow(); setTimeout(renderNow, 120); }

  /* ------------------------------------------------------------------ export vidéo */
  const nextTick = (ms = 0) => new Promise(r => setTimeout(r, ms));
  async function loadScript(src) {
    if (window.Mp4Muxer) return;
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('bibliothèque mp4-muxer introuvable')); document.head.appendChild(s); });
  }
  /* codecs disponibles pour l'export précis : H.264 + AAC si possible (compatible TikTok / Shorts / Reels), sinon VP9 / Opus */
  async function pickCodecs(w, h) {
    if (!('VideoEncoder' in window) || !('AudioEncoder' in window) || !('VideoFrame' in window)) return null;
    let v = null, a = null;
    for (const [n, c] of [['avc', 'avc1.640028'], ['avc', 'avc1.4d0028'], ['vp9', 'vp09.00.40.08']]) {
      try { if ((await VideoEncoder.isConfigSupported({ codec: c, width: w, height: h, bitrate: 8e6, framerate: 30 })).supported) { v = [n, c]; break; } } catch (e) { }
    }
    for (const [n, c] of [['aac', 'mp4a.40.2'], ['opus', 'opus']]) {
      try { if ((await AudioEncoder.isConfigSupported({ codec: c, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })).supported) { a = [n, c]; break; } } catch (e) { }
    }
    return v && a ? { v, a } : null;
  }
  /* place les clips pré-rendus exactement à l'instant t (le plan courant et, pendant une transition, le précédent) */
  async function seekClips(t) {
    const sh = S.P.shots, i = shotAt(S.P, t), ids = [i]; if (i > 0 && t - sh[i].t0 < 0.5) ids.push(i - 1);
    await Promise.all(ids.map(async j => {
      const s = sh[j]; if (s.kind !== 'clip') return; const v = S.vids.get(s.src); if (!v) return;
      const want = cl(t - s.t0, 0, Math.max((v.duration || 0) - 0.001, 0)); if (Math.abs(v.currentTime - want) < 0.004) return;
      await new Promise(res => { const done = () => { v.removeEventListener('seeked', done); res(); }; v.addEventListener('seeked', done); v.currentTime = want; setTimeout(res, 1500); });
    }));
  }

  /* export précis, image par image (WebCodecs + mp4-muxer) : indépendant de la vitesse de l'ordinateur */
  async function exportFrames(R, from, to, big, codecs, ui) {
    await loadScript('nova-info/mp4-muxer.js');
    const P = S.P, fps = P.meta.fps || 30, w = R.cw & ~1, h = R.ch & ~1;
    const AC = window.AudioContext || window.webkitAudioContext, ac = new AC({ sampleRate: 48000 });
    const buf = await ac.decodeAudioData(await (await fetch(S.urls.get(P.audio))).arrayBuffer()); ac.close().catch(() => { });
    const sr = buf.sampleRate, L = buf.getChannelData(0), Rc = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: codecs.v[0], width: w, height: h, frameRate: fps }, audio: { codec: codecs.a[0], numberOfChannels: 2, sampleRate: sr }, fastStart: 'in-memory' });
    let err = null;
    const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { err = e; } });
    venc.configure({ codec: codecs.v[1], width: w, height: h, bitrate: big ? 14e6 : 8e6, framerate: fps });
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { err = e; } });
    aenc.configure({ codec: codecs.a[1], sampleRate: sr, numberOfChannels: 2, bitrate: 192e3 });
    const a0 = Math.floor(from * sr), a1 = Math.min(Math.floor(to * sr), L.length), CH = 4096;
    for (let i = a0; i < a1; i += CH) {
      const n = Math.min(CH, a1 - i), data = new Float32Array(n * 2); data.set(L.subarray(i, i + n), 0); data.set(Rc.subarray(i, i + n), n);
      aenc.encode(new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i - a0) / sr * 1e6), data }));
      if (aenc.encodeQueueSize > 40) await nextTick(1);
    }
    for (const v of S.vids.values()) v.pause();
    const N = Math.round((to - from) * fps), t0 = performance.now();
    for (let k = 0; k < N; k++) {
      if (!S.exporting) throw new Error('export annulé'); if (err) throw err;
      const t = from + k / fps; await seekClips(t); renderFrame(R, t);
      const vf = new VideoFrame(R.main, { timestamp: Math.round(k / fps * 1e6), duration: Math.round(1e6 / fps) });
      venc.encode(vf, { keyFrame: k % (fps * 2) === 0 }); vf.close();
      while (venc.encodeQueueSize > 8) await nextTick(2);
      if (k % 4 === 0) { const el = (performance.now() - t0) / 1000; ui(k / N, `Encodage image ${k}/${N} · reste environ ${Math.max(0, Math.round(el / Math.max(k, 1) * (N - k)))} s`); await nextTick(0); }
    }
    await venc.flush(); await aenc.flush(); if (err) throw err; muxer.finalize();
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  }

  /* secours : enregistrement du canvas en temps réel (MediaRecorder), uniquement en H.264 pour rester compatible */
  async function exportRealtime(R, from, to, big, ui) {
    const mimes = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mime = mimes.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
    if (!mime) throw new Error('ce navigateur ne sait pas enregistrer la vidéo : utilise Chrome ou Edge');
    if (S.graphFor !== S.audio) {  // createMediaElementSource ne peut être appelé qu'une fois par élément audio
      const AC = window.AudioContext || window.webkitAudioContext; S.ac = new AC(); S.node = S.ac.createMediaElementSource(S.audio);
      S.dest = S.ac.createMediaStreamDestination(); S.node.connect(S.dest); S.node.connect(S.ac.destination); S.graphFor = S.audio;
    }
    await S.ac.resume();
    const stream = R.main.captureStream(30); S.dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: big ? 14e6 : 8e6, audioBitsPerSecond: 192e3 }), chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(r => rec.onstop = r);
    S.audio.currentTime = from; await new Promise(r => { S.audio.onseeked = r; setTimeout(r, 400); });
    for (const v of S.vids.values()) v.pause();
    rec.start(500); S.audio.play();
    await new Promise(res => {
      const tick = () => {
        const t = S.audio.currentTime; if (t >= to - 0.02 || S.audio.ended || !S.exporting) return res();
        syncClips(t, true); renderFrame(R, t); ui((t - from) / (to - from), `Enregistrement en temps réel… ${fmt(t - from)} / ${fmt(to - from)}`); requestAnimationFrame(tick);
      }; tick();
    });
    S.audio.pause(); rec.stop(); await done;
    return new Blob(chunks, { type: mime.split(';')[0] });
  }

  async function exportVideo(from, to, big) {
    if (!S.ready || S.exporting) return;
    pause(); S.exporting = true; const P = S.P, scale = big ? 1 : 2 / 3, R = new Renderer(scale);
    const bar = $('#atExpBar'), msg = $('#atExpMsg'), box = $('#atExp'), ui = (p, m) => { bar.value = p; msg.textContent = m; };
    box.hidden = false; ui(0, 'Préparation…');
    try {
      const codecs = await pickCodecs(R.cw & ~1, R.ch & ~1);
      let blob, ext = 'mp4', note = '';
      if (codecs) {
        blob = await exportFrames(R, from, to, big, codecs, ui);
        if (codecs.v[0] !== 'avc') note = ' (codec VP9 : lisible dans Chrome ; pour TikTok / Shorts / Reels, convertis-la en H.264 avec Montage → Convertir)';
      } else {
        blob = await exportRealtime(R, from, to, big, ui); ext = blob.type === 'video/mp4' ? 'mp4' : 'webm';
        note = ' (enregistrement en temps réel' + (ext === 'webm' ? ', format .webm : convertible en .mp4 avec Montage → Convertir)' : ')');
      }
      download(blob, `${P.meta.slug}_${P.meta.version}_atelier.${ext}`); toast('Vidéo exportée' + note);
    } catch (e) { console.error(e); toast('Export impossible : ' + e.message); }
    S.exporting = false; box.hidden = true; S.t = from; renderNow();
  }

  /* ------------------------------------------------------------------ interface */
  function busy(msg) { const b = $('#atBusy'); if (b) { b.textContent = msg; b.hidden = !msg; } S.busy = !!msg; }
  function refreshTop() { const d = $('#atDirty'); if (d) d.textContent = S.dirty ? '● modifications non enregistrées' : (S.P ? '✓ enregistré' : ''); const u = $('#atUndo'), r = $('#atRedo'); if (u) u.disabled = !S.hist.length; if (r) r.disabled = !S.fut.length; }

  function mount(host) {
    if (S.hostEl === host) return; S.hostEl = host;
    host.innerHTML = `
    <div class="at-root">
      <div class="at-head"><div><h2>Atelier Nova-Info</h2><p class="muted">Ouvre le dossier d'un projet vidéo pour changer les images, les sous-titres et les textes, puis exporte la vidéo. Tout reste sur ton ordinateur.</p></div>
        <div class="at-top"><button class="btn primary" id="atOpen" type="button">📂 Ouvrir un projet…</button><button class="btn" id="atOpenAlt" type="button" title="Si ton navigateur ne propose pas l'accès direct au dossier">Choisir les fichiers…</button><input type="file" id="atDirIn" webkitdirectory multiple hidden>
          <button class="btn" id="atSave" type="button" disabled>💾 Enregistrer</button><button class="btn" id="atUndo" type="button" disabled title="Ctrl+Z">↶</button><button class="btn" id="atRedo" type="button" disabled title="Ctrl+Y">↷</button><span class="muted sm" id="atDirty"></span></div></div>
      <div class="at-busy" id="atBusy" hidden></div>
      <div class="at-empty" id="atEmpty"><div class="at-card"><h3>Aucun projet ouvert</h3><p>Un projet est un dossier créé par la chaîne Nova-Info : <code>project.nova.json</code>, <code>audio.mp3</code>, <code>images/</code>, <code>clips/</code>, <code>fonts/</code>.</p><p class="muted sm">Chrome ou Edge recommandé (accès direct au dossier : tes modifications sont enregistrées dedans).</p></div></div>
      <div class="at-app" id="atApp" hidden></div>
    </div>`;
    $('#atOpen').onclick = async () => {
      if (window.showDirectoryPicker) { try { const dir = await window.showDirectoryPicker({ id: 'nova-info-project', mode: 'readwrite' }); await openProject({ dir }); } catch (e) { if (e.name !== 'AbortError') toast('Ouverture annulée : ' + e.message); } }
      else $('#atDirIn').click();
    };
    $('#atOpenAlt').onclick = () => $('#atDirIn').click();
    $('#atDirIn').onchange = e => { if (e.target.files.length) openProject({ files: [...e.target.files] }); e.target.value = ''; };
    $('#atSave').onclick = saveProject; $('#atUndo').onclick = undo; $('#atRedo').onclick = redo;
    document.addEventListener('keydown', e => {
      if (!$('#tab-atelier')?.classList.contains('on') || !S.ready) return; const tg = e.target;
      if (tg && /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) && tg.type !== 'range' && tg.type !== 'checkbox') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); }
      else if (e.code === 'Space') { e.preventDefault(); S.playing ? pause() : play(); }
    });
    window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  function buildUI() {
    $('#atEmpty').hidden = true; const app = $('#atApp'); app.hidden = false; $('#atSave').disabled = false;
    const P = S.P;
    app.innerHTML = `
    <div class="at-grid">
      <div class="at-left">
        <div class="at-stage"><canvas id="atCanvas" width="${Math.round(W / 2)}" height="${Math.round(H / 2)}"></canvas></div>
        <div class="at-ctrl"><button class="btn primary" id="atPlay" type="button">▶ Lecture</button><input type="range" id="atScrub" min="0" max="${P.meta.duration}" step="0.01" value="0"><span class="muted sm" id="atTime"></span></div>
        <div class="at-exportbox"><b>Exporter la vidéo</b>
          <div class="at-row"><label>De <input type="number" id="atFrom" min="0" step="0.1" value="0"></label><label>à <input type="number" id="atTo" min="0" step="0.1" value="${P.meta.duration.toFixed(1)}"></label>
          <label><input type="checkbox" id="atBig" checked> 1080×1920</label></div>
          <button class="btn primary" id="atExport" type="button">🎬 Exporter</button>
          <div id="atExp" hidden><progress id="atExpBar" value="0" max="1"></progress><div class="muted sm" id="atExpMsg"></div></div>
          <p class="muted sm">L'export se fait en temps réel (la durée de la vidéo) : laisse l'onglet ouvert. Le son vient du projet.</p></div>
      </div>
      <div class="at-right">
        <div class="at-timeline" id="atTL"></div>
        <div class="at-tabs"><button data-tab="plans" type="button">🎞 Plans</button><button data-tab="subs" type="button">💬 Sous-titres</button><button data-tab="global" type="button">✨ Habillage</button></div>
        <div class="at-insp" id="atInsp"></div>
      </div>
    </div>`;
    const cv = $('#atCanvas'); cv.getContext('2d').imageSmoothingQuality = 'high';
    $('#atPlay').onclick = () => (S.playing ? pause() : play());
    $('#atScrub').oninput = e => { pause(); seek(+e.target.value); };
    $('#atExport').onclick = () => exportVideo(+$('#atFrom').value || 0, Math.min(+$('#atTo').value || P.meta.duration, P.meta.duration), $('#atBig').checked);
    $$('.at-tabs button').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; buildInspector(); });
    buildTimeline(); buildInspector(); refreshTop();
  }

  function buildTimeline() {
    const P = S.P, tl = $('#atTL'); if (!tl) return; const D = P.meta.duration;
    tl.innerHTML = `<div class="at-track" id="atTrack">${P.shots.map((s, i) => {
      const w = (s.t1 - s.t0) / D * 100, bg = s.kind === 'image' && S.urls.get(s.src) ? `background-image:url(${S.urls.get(s.src)})` : '';
      return `<button type="button" class="at-shot ${s.kind} ${i === S.sel ? 'sel' : ''}" data-i="${i}" style="left:${s.t0 / D * 100}%;width:${w}%;${bg}" title="${esc(s.id)} · ${fmt(s.t0)}–${fmt(s.t1)}"><span>${i + 1}</span>${s.tag ? `<i class="tg ${s.tag === 'HYPOTHÈSE' ? 'h' : ''}"></i>` : ''}</button>`;
    }).join('')}<div class="at-head-line" id="atHead"></div></div>
    <div class="at-track sub">${P.subtitles.map((c, i) => `<i class="at-sc" data-c="${i}" style="left:${c.start / D * 100}%;width:${Math.max((c.end - c.start) / D * 100, .3)}%"></i>`).join('')}</div>`;
    $$('.at-shot', tl).forEach(b => b.onclick = () => { S.sel = +b.dataset.i; S.userSel = true; pause(); seek(P.shots[S.sel].t0 + .05); highlightSel(); buildInspector(); });
    $$('.at-sc', tl).forEach(b => b.onclick = () => { S.tab = 'subs'; S.selSub = +b.dataset.c; pause(); seek(P.subtitles[S.selSub].start + .05); buildInspector(); });
    $('#atTrack').addEventListener('pointerdown', e => { if (e.target.closest('.at-shot')) return; const r = $('#atTrack').getBoundingClientRect(); pause(); seek((e.clientX - r.left) / r.width * D); });
  }
  function highlightSel() { $$('.at-shot').forEach(b => b.classList.toggle('sel', +b.dataset.i === S.sel)); if (S.tab === 'plans') buildInspector(); }

  const field = (label, html) => `<label class="at-f"><span>${label}</span>${html}</label>`;
  function buildInspector() {
    const insp = $('#atInsp'); if (!insp) return; $$('.at-tabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === S.tab));
    if (S.tab === 'plans') inspPlans(insp); else if (S.tab === 'subs') inspSubs(insp); else inspGlobal(insp);
  }

  function inspPlans(insp) {
    const P = S.P, s = P.shots[S.sel], grades = ['none', ...Object.keys(P.grades)], tags = ['', ...Object.keys(P.brand.tags)];
    const fxAll = ['fog', 'embers', 'snow', 'dust', 'flicker', 'redpulse'], hasFx = n => (s.fx || []).some(f => (Array.isArray(f) ? f[0] : f) === n);
    const cam = s.cam;
    insp.innerHTML = `
      <div class="at-sec"><h3>Plan ${S.sel + 1} <span class="muted sm">${fmt(s.t0)} → ${fmt(s.t1)} · ${s.kind === 'image' ? 'image animée' : 'clip graphique (' + (s.clip_type || '') + ')'}</span></h3>
        <div class="at-thumb" ${s.kind === 'image' && S.urls.get(s.src) ? `style="background-image:url(${S.urls.get(s.src)})"` : ''}>${s.kind === 'clip' ? '<span class="muted sm">Clip pré-rendu (carte / courbe / anneau)</span>' : ''}</div>
        <div class="at-row"><button class="btn primary" id="atImg" type="button">🖼 Remplacer par une image…</button><input type="file" id="atImgIn" accept="image/*" hidden>
        <span class="muted sm">${s.kind === 'clip' ? 'Remplacer le clip par une image le rend entièrement modifiable.' : 'Glisse aussi une image sur l\'aperçu.'}</span></div></div>
      ${s.kind === 'image' ? `<div class="at-sec"><h3>Cadrage (caméra)</h3>
        ${camRow('Début', 'from', cam.from)}${camRow('Fin', 'to', cam.to)}
        <div class="at-row"><button class="btn sm" id="atCamSwap" type="button">⇄ Inverser</button><button class="btn sm" id="atCamStill" type="button">Fixe (fin = début)</button>
        ${field('Mouvement', `<select id="atEase">${[['io', 'Doux'], ['out', 'Freine'], ['in', 'Accélère'], ['lin', 'Linéaire']].map(([v, l]) => `<option value="${v}" ${(s.ease || 'io') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}</div></div>` : ''}
      <div class="at-sec"><h3>Image &amp; ambiance</h3><div class="at-row">
        ${s.kind === 'image' ? field('Étalonnage', `<select id="atGrade">${grades.map(g => `<option ${s.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select>`) : ''}
        ${field('Assombrir', `<input type="range" id="atDim" min="0" max="0.8" step="0.02" value="${s.dim || 0}">`)}
        ${field('Transition d\'entrée', `<select id="atTrans">${['cut', 'dissolve', 'dip', 'whip', 'flash'].map(g => `<option ${s.trans === g ? 'selected' : ''}>${g}</option>`).join('')}</select>`)}</div>
        <div class="at-row at-chk">${fxAll.map(n => `<label><input type="checkbox" data-fx="${n}" ${hasFx(n) ? 'checked' : ''}> ${n}</label>`).join('')}</div></div>
      <div class="at-sec"><h3>Étiquette</h3><div class="at-row">${field('Type', `<select id="atTag">${tags.map(g => `<option value="${g}" ${(s.tag || '') === g ? 'selected' : ''}>${g || '(aucune)'}</option>`).join('')}</select>`)}
        ${field('Source / légende', `<input type="text" id="atSrc" value="${esc(s.source || '')}" placeholder="ex. ILLUSTRATION : BRUEGEL, 1565">`)}</div></div>
      <div class="at-sec"><h3>Textes à l'écran</h3><div id="atOv"></div>
        <div class="at-row"><button class="btn sm" data-addov="card" type="button">+ Carte</button><button class="btn sm" data-addov="bigword" type="button">+ Grand mot</button><button class="btn sm" data-addov="stamp" type="button">+ Tampon</button><button class="btn sm" data-addov="list" type="button">+ Liste</button></div></div>`;
    $('#atImg').onclick = () => $('#atImgIn').click();
    $('#atImgIn').onchange = e => e.target.files[0] && replaceImage(S.sel, e.target.files[0]);
    const set = (fn, label) => { commit(label); fn(); renderNow(); }; // modification + historique
    $$('.at-cam', insp).forEach(r => $$('input', r).forEach(inp => inp.oninput = () => {
      if (!inp.dataset.pushed) { commit('cam'); inp.dataset.pushed = 1; inp.onchange = () => delete inp.dataset.pushed; }
      cam[r.dataset.k][+inp.dataset.n] = +inp.value; $('output', inp.parentElement).textContent = (+inp.value).toFixed(2); seek(s.t0 + (r.dataset.k === 'from' ? .05 : (s.t1 - s.t0) - .05)); }));
    if ($('#atCamSwap')) $('#atCamSwap').onclick = () => set(() => { [cam.from, cam.to] = [cam.to, cam.from]; buildInspector(); });
    if ($('#atCamStill')) $('#atCamStill').onclick = () => set(() => { cam.to = [...cam.from]; buildInspector(); });
    if ($('#atEase')) $('#atEase').onchange = e => set(() => { s.ease = e.target.value; });
    if ($('#atGrade')) $('#atGrade').onchange = e => set(() => { s.grade = e.target.value; });
    $('#atDim').oninput = e => { if (!e.target.dataset.pushed) { commit('dim'); e.target.dataset.pushed = 1; e.target.onchange = () => delete e.target.dataset.pushed; } s.dim = +e.target.value; renderNow(); };
    $('#atTrans').onchange = e => set(() => { s.trans = e.target.value; });
    $$('[data-fx]', insp).forEach(c => c.onchange = () => set(() => { const n = c.dataset.fx; s.fx = (s.fx || []).filter(f => (Array.isArray(f) ? f[0] : f) !== n); if (c.checked) s.fx.push(n === 'fog' ? ['fog', { density: .18 }] : ['embers', 'snow', 'dust'].includes(n) ? [n, { n: 60 }] : n); }));
    $('#atTag').onchange = e => set(() => { s.tag = e.target.value || null; if (s.tag) s.tag_t0 = s.t0; });
    $('#atSrc').oninput = e => { if (!e.target.dataset.pushed) { commit('src'); e.target.dataset.pushed = 1; e.target.onchange = () => delete e.target.dataset.pushed; } s.source = e.target.value || null; renderNow(); };
    renderOverlayList(s);
    $$('[data-addov]', insp).forEach(b => b.onclick = () => set(() => {
      const t = b.dataset.addov, base = { type: t, at: 0.2, dur: Math.min(3, s.t1 - s.t0) };
      (s.overlays ||= []).push(t === 'card' ? { ...base, text: 'TEXTE', sub: 'sous-titre', y: 760, size: 88 } : t === 'bigword' ? { ...base, text: 'MOT', y: 640, size: 150 } : t === 'stamp' ? { type: t, at: 0.4, text: 'TAMPON', x: 520, y: 800, rot: -7, size: 112 } : { type: t, at: 0, items: ['UN', 'DEUX', 'TROIS'], times: [0.1, 0.9, 1.7], y: 600, size: 58 });
      renderOverlayList(s); seek(s.t0 + .6);
    }));
  }
  function camRow(label, k, v) {
    const f = (n, name, min, max, step) => `<label class="at-mini"><span>${name}</span><input type="range" data-n="${n}" min="${min}" max="${max}" step="${step}" value="${v[n]}"><output>${(+v[n]).toFixed(2)}</output></label>`;
    return `<div class="at-cam" data-k="${k}"><b>${label}</b>${f(0, 'X', 0, 1, .005)}${f(1, 'Y', 0, 1, .005)}${f(2, 'Zoom (plus petit = plus proche)', .2, 1, .005)}</div>`;
  }
  function renderOverlayList(s) {
    const box = $('#atOv'); if (!box) return; const ovs = s.overlays || [];
    box.innerHTML = ovs.length ? ovs.map((o, i) => {
      const lab = { card: 'Carte', bigword: 'Grand mot', stamp: 'Tampon', list: 'Liste' }[o.type] || o.type;
      const times = o.type === 'list'
        ? field('Textes (un par ligne)', `<textarea data-k="items" rows="3">${esc((o.items || []).join('\n'))}</textarea>`) + field('Apparitions (s, séparées par des virgules)', `<input type="text" data-k="times" value="${(o.times || []).join(', ')}">`)
        : field('Texte', `<input type="text" data-k="text" value="${esc(o.text || '')}">`) + (o.type === 'card' ? field('Sous-titre', `<input type="text" data-k="sub" value="${esc(o.sub || '')}">`) : '') +
          `<div class="at-row">${field('Début (s)', `<input type="number" data-k="at" step="0.1" value="${o.at ?? 0}">`)}${o.type !== 'stamp' ? field('Durée (s)', `<input type="number" data-k="dur" step="0.1" value="${o.dur ?? 3}">`) : ''}${field('Position Y', `<input type="number" data-k="y" step="10" value="${o.y ?? 600}">`)}${field('Taille', `<input type="number" data-k="size" step="2" value="${o.size ?? ''}">`)}</div>`;
      return `<div class="at-ov" data-i="${i}"><div class="at-ovh"><b>${lab}</b><button class="btn sm danger" data-del="${i}" type="button">Supprimer</button></div>${times}</div>`;
    }).join('') : '<p class="muted sm">Aucun texte sur ce plan.</p>';
    $$('.at-ov', box).forEach(row => {
      const o = ovs[+row.dataset.i];
      $$('[data-k]', row).forEach(inp => inp.oninput = () => {
        if (!inp.dataset.pushed) { commit('ov'); inp.dataset.pushed = 1; inp.onchange = () => delete inp.dataset.pushed; }
        const k = inp.dataset.k;
        if (k === 'items') o.items = inp.value.split('\n').filter(Boolean);
        else if (k === 'times') o.times = inp.value.split(',').map(v => +v.trim() || 0);
        else if (['at', 'dur', 'y', 'size'].includes(k)) o[k] = inp.value === '' ? undefined : +inp.value; else o[k] = inp.value;
        seek(Math.min(s.t1 - 0.05, s.t0 + (o.at ?? 0) + 0.6));
      });
    });
    $$('[data-del]', box).forEach(b => b.onclick = () => { commit('del'); ovs.splice(+b.dataset.del, 1); renderOverlayList(s); renderNow(); });
  }

  async function replaceImage(i, file) {
    commit('img'); const s = S.P.shots[i]; const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `images/custom_${Date.now().toString(36)}.${ext}`; S.files.set(path, file);
    if (s.kind === 'clip') { s.kind = 'image'; s.cam = { from: [0.5, 0.5, 0.8], to: [0.5, 0.5, 0.62] }; s.ease = 'io'; s.grade = 'doc'; s.clip_type = undefined; }
    s.src = path; await loadImage(path); buildTimeline(); buildInspector(); seek(s.t0 + .1); toast('Image remplacée');
  }

  function inspSubs(insp) {
    const P = S.P, subs = P.subtitles; S.selSub = S.selSub ?? 0; const here = subs.findIndex(c => c.start - .04 <= S.t && S.t < c.end);
    insp.innerHTML = `<div class="at-sec"><h3>Sous-titres <span class="muted sm">${subs.length} blocs · clique un mot pour le mettre en rouge (mot-clé)</span></h3>
      <div class="at-row"><button class="btn sm" id="atSubAdd" type="button">+ Ajouter un bloc ici</button><label class="at-chkl"><input type="checkbox" id="atSubOff" ${P.options?.subsOff ? 'checked' : ''}> Masquer les sous-titres</label></div>
      <div class="at-subs" id="atSubs">${subs.map((c, i) => `
        <div class="at-sub ${i === here ? 'cur' : ''}" data-i="${i}">
          <div class="at-subt"><button class="btn sm" data-go="${i}" type="button">▶ ${fmt(c.start)}</button>
            <label>début <input type="number" step="0.05" data-k="start" value="${c.start.toFixed(2)}"></label><label>fin <input type="number" step="0.05" data-k="end" value="${c.end.toFixed(2)}"></label>
            <button class="btn sm danger" data-del="${i}" type="button" title="Supprimer ce bloc">✕</button></div>
          <input type="text" class="at-subx" data-k="text" value="${esc(c.words.map(w => w.w).join(' '))}">
          <div class="at-words">${c.words.map((w, j) => `<button type="button" class="${w.key ? 'key' : ''}" data-key="${j}">${esc(w.w)}</button>`).join('')}</div>
        </div>`).join('')}</div></div>`;
    $('#atSubOff').onchange = e => { commit('subsoff'); (P.options ||= {}).subsOff = e.target.checked; renderNow(); };
    $('#atSubAdd').onclick = () => { commit('subadd'); const t = S.t; subs.push({ id: 'c' + Date.now(), start: +t.toFixed(2), end: +(t + 1.4).toFixed(2), words: [{ w: 'TEXTE', start: +t.toFixed(2), end: +(t + 1.2).toFixed(2), key: false }] }); subs.sort((a, b) => a.start - b.start); buildTimeline(); inspSubs(insp); renderNow(); };
    $$('.at-sub', insp).forEach(row => {
      const c = subs[+row.dataset.i];
      $('[data-go]', row).onclick = () => { pause(); seek(c.start + .05); };
      $('[data-del]', row).onclick = () => { commit('subdel'); subs.splice(+row.dataset.i, 1); buildTimeline(); inspSubs(insp); renderNow(); };
      $$('[data-k]', row).forEach(inp => {
        inp.onfocus = () => { pause(); seek(c.start + .05); };
        inp.oninput = () => {
          if (!inp.dataset.pushed) { commit('sub'); inp.dataset.pushed = 1; inp.onchange = () => delete inp.dataset.pushed; }
          if (inp.dataset.k === 'text') setSubText(c, inp.value); else { c[inp.dataset.k] = +inp.value; }
          seek(S.t); if (inp.dataset.k === 'text') { $('.at-words', row).innerHTML = c.words.map((w, j) => `<button type="button" class="${w.key ? 'key' : ''}" data-key="${j}">${esc(w.w)}</button>`).join(''); bindKeys(row, c); }
        };
        inp.onchange = () => { delete inp.dataset.pushed; buildTimeline(); };
      });
      bindKeys(row, c);
    });
  }
  function bindKeys(row, c) { $$('[data-key]', row).forEach(b => b.onclick = () => { commit('key'); const w = c.words[+b.dataset.key]; w.key = !w.key; b.classList.toggle('key', w.key); renderNow(); }); }
  function setSubText(c, txt) {
    const nw = txt.trim().split(/\s+/).filter(Boolean); if (!nw.length) return;
    if (nw.length === c.words.length) { nw.forEach((w, i) => c.words[i].w = w); return; }
    const t0 = c.words[0].start, t1 = c.words[c.words.length - 1].end, wts = nw.map(w => Math.max(w.length, 1)), tot = wts.reduce((a, b) => a + b, 0); let acc = 0;
    c.words = nw.map((w, i) => { const a = t0 + (t1 - t0) * acc / tot; acc += wts[i]; return { w, start: +a.toFixed(3), end: +(t0 + (t1 - t0) * acc / tot).toFixed(3), key: false }; });
  }

  function inspGlobal(insp) {
    const P = S.P, o = P.options ||= {}, st = P.brand.subtitle;
    insp.innerHTML = `<div class="at-sec"><h3>Habillage de la chaîne</h3>
      ${field('Nom du logo (en haut à gauche)', `<input type="text" id="atBrand" value="${esc(P.brand.name)}">`)}
      ${field('Titre bref de l\'outro (après NOVA·INFO)', `<input type="text" id="atOutro" value="${esc(P.brand.outro_title)}">`)}
      <div class="at-row"><label class="at-chkl"><input type="checkbox" id="atTagsOff" ${o.tagsOff ? 'checked' : ''}> Masquer les étiquettes FAIT / HYPOTHÈSE</label></div></div>
      <div class="at-sec"><h3>Sous-titres</h3><div class="at-row">
        ${field('Taille max', `<input type="range" id="atSubSize" min="46" max="96" step="2" value="${o.subSize || st.max_font}">`)}
        ${field('Position verticale', `<input type="range" id="atSubY" min="900" max="1500" step="10" value="${o.subY || st.y_center}">`)}</div>
        <p class="muted sm">Zones de sécurité : garde les sous-titres au-dessus d'environ y = 1450 et à gauche de x = 930 pour rester visibles sous l'interface de TikTok, Shorts et Reels.</p></div>
      <div class="at-sec"><h3>Projet</h3><p class="muted sm"><b>${esc(P.meta.title)}</b><br>${P.meta.slug} · ${P.meta.version} · ${fmt(P.meta.duration)} · ${P.shots.length} plans · ${P.subtitles.length} blocs de sous-titres</p>
        <p class="muted sm">La voix et la musique sont celles de l'<code>audio.mp3</code> du projet : si tu changes un texte, il ne sera plus synchronisé avec la voix.</p></div>`;
    const bind = (id, fn) => { const el = $(id); el.oninput = () => { if (!el.dataset.pushed) { commit('g'); el.dataset.pushed = 1; el.onchange = () => delete el.dataset.pushed; } fn(el); seek(S.t); }; };
    bind('#atBrand', el => P.brand.name = el.value); bind('#atOutro', el => { P.brand.outro_title = el.value; if (S.t < P.meta.duration - P.meta.end_card) seek(P.meta.duration - 0.6); });
    bind('#atSubSize', el => o.subSize = +el.value); bind('#atSubY', el => o.subY = +el.value);
    $('#atTagsOff').onchange = e => { commit('g'); o.tagsOff = e.target.checked; renderNow(); };
  }

  window.NovaAtelier = { mount, _state: S, _render: renderFrame, _Renderer: Renderer, open: openProject, seek, play, pause, exportVideo, snapshot: () => $('#atCanvas').toDataURL('image/png') };
})();
