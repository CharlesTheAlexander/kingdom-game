import Phaser from 'phaser';
import { GAME_W, GAME_H } from './GameScene.js';

// Continent view — Phase 8 (Visual): a beautiful hand-drawn illustrated parchment
// map (Northgard-style), rendered ENTIRELY with procedural Phaser Graphics /
// Canvas2D (no external assets). The whole 200x200 world is sampled at low
// resolution and drawn as miniature illustrated biome regions (pines, peaks,
// dunes, grass, wavy water), with watercolour territory washes, illustrated
// settlement/army/ruin icons, a decorative border, a compass rose, biome
// labels, a legend and a parchment stats header. Tab/Esc/return + click-to-focus
// are unchanged — only the RENDER is restyled, never the data or controls.

const N = 200;
const MAP_PX = 600;                 // on-screen size of the (square) continent
const MX = (GAME_W - MAP_PX) / 2;   // top-left of the map on screen
const MY = 86;

// --- Illustrated parchment palette --------------------------------------------
const PARCH = 0xf0e4c0;            // aged parchment base
const PARCH_DK = 0xe2d2a4;         // darker parchment (region shading)
const PARCH_EDGE = 0xcdb888;       // parchment edge / vignette
const INK = 0x4a3a22;              // brown drawing ink
const INK_SOFT = 0x6b5634;         // softer ink for fills
const SEA = 0x8fb5c4;             // map-sea blue (muted, watercolour)
const SEA_DK = 0x6f9bb0;          // deeper sea for ripples
const SEA_FOAM = 0xd9ecef;        // foam / coastline highlight

// Per-biome illustrated treatment.
type BiomeStyle = { ground: number; motif: 'forest' | 'mountains' | 'plains' | 'desert' | 'water'; ink: number };
const BIOME_STYLE: Record<string, BiomeStyle> = {
  start:     { ground: 0xd7d79a, motif: 'plains',    ink: 0x6f7a3a },
  middle:    { ground: 0xd0cf90, motif: 'plains',    ink: 0x70762f },
  forest:    { ground: 0xb9c98a, motif: 'forest',    ink: 0x2f5a2a },
  mountains: { ground: 0xd9cdb0, motif: 'mountains', ink: 0x6a6152 },
  delta:     { ground: 0xc7cf94, motif: 'plains',    ink: 0x5f7a35 },
  wildlands: { ground: 0xc9c084, motif: 'desert',    ink: 0x8a7332 },
};
const DEFAULT_STYLE: BiomeStyle = BIOME_STYLE.middle;

function blend(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
function shade(col: number, f: number): number {
  const rr = Phaser.Math.Clamp(Math.round(((col >> 16) & 255) * (1 + f)), 0, 255);
  const gg = Phaser.Math.Clamp(Math.round(((col >> 8) & 255) * (1 + f)), 0, 255);
  const bb = Phaser.Math.Clamp(Math.round((col & 255) * (1 + f)), 0, 255);
  return (rr << 16) | (gg << 8) | bb;
}

export class ContinentScene extends Phaser.Scene {
  [key: string]: any;

  constructor() { super('ContinentScene'); }

  create() {
    this.iso = this.scene.get('IsometricScene');

    // Deep desk backdrop (behind the parchment sheet).
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x241a10, 1).setOrigin(0, 0);
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.35).setOrigin(0, 0);

    // --- Static parchment sheet (background + border + compass), drawn ONCE
    // into a canvas texture. The illustrated biome regions + watercolour washes
    // are drawn into a SEPARATE canvas (mapCanvas) that we refresh on rebuild. ---
    if (!this.textures.exists('contParch')) this.buildParchmentTexture();
    this.parchImg = this.add.image(MX - 40, MY - 40, 'contParch').setOrigin(0, 0).setDepth(0);

    // Illustrated map canvas (biomes + washes + coastline). Refreshed on rebuild.
    if (!this.textures.exists('contIllus')) this.textures.createCanvas('contIllus', MAP_PX, MAP_PX);
    this.illusImg = this.add.image(MX, MY, 'contIllus').setOrigin(0, 0).setDepth(1);

    // Vector overlay graphics (icons, pins, roads, council, fog clouds, labels).
    this.icons = this.add.graphics().setDepth(4);
    this.iconText = this.add.container(0, 0).setDepth(6);
    this.labels = this.add.container(0, 0).setDepth(5);

    // Night/parchment darkening tint over the map sheet only (below icons).
    this.nightTint = this.add.rectangle(MX, MY, MAP_PX, MAP_PX, 0x0c1430, 0).setOrigin(0, 0).setDepth(3);
    this.nightDots = this.add.graphics().setDepth(3.5); // warm settlement lights at night

    // --- Parchment stats header (with wax seal) ---
    this.buildHeader();

    this.tip = this.add.text(0, 0, '', { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#2a1c0c', backgroundColor: '#efe2bccc', padding: { x: 7, y: 5 } }).setOrigin(0.5, 1).setDepth(60).setVisible(false);

    // (Bug 3) Always reset the close guards on (re)entry.
    this._closing = false;
    this._finished = false;

    // (Bug 3) Always-on-top, always-clickable "Return to Kingdom" button — styled
    // as a wax-sealed parchment tab to match the map.
    const by = GAME_H - 34;
    const btn = this.add.rectangle(GAME_W / 2, by, 268, 40, 0x6b4a26).setStrokeStyle(2, 0xe9d6a4, 0.9).setInteractive({ useHandCursor: true }).setDepth(200);
    this.add.text(GAME_W / 2, by, 'Return to Kingdom  (Tab / Esc)', { fontFamily: 'Georgia, serif', fontSize: '14px', color: '#f5ecd2', fontStyle: 'bold' }).setOrigin(0.5).setDepth(201);
    btn.on('pointerover', () => btn.setFillStyle(0x82602f));
    btn.on('pointerout', () => btn.setFillStyle(0x6b4a26));
    btn.on('pointerdown', () => this.close());

    // (Bug 3) Tab closes (with fade); Escape is a guaranteed instant escape hatch.
    this.input.keyboard.on('keydown-TAB', (e) => { if (e && e.preventDefault) e.preventDefault(); this.close(); });
    this.input.keyboard.on('keydown-ESC', (e) => { if (e && e.preventDefault) e.preventDefault(); this.forceClose(); });
    this.input.keyboard.on('keydown-ESCAPE', (e) => { if (e && e.preventDefault) e.preventDefault(); this.forceClose(); });
    this.input.on('pointermove', (p) => this.onHover(p));
    this.input.on('pointerdown', (p) => this.onClick(p));

    this.buildLabels();
    this.rebuildMap();
    this.cameras.main.fadeIn(220, 20, 14, 8);

    this.showContinentTutorial();
    this._refresh = 0;
  }

  // --- Parchment sheet texture (drawn once): aged paper + fibers + age spots +
  // decorative vine/rope border + corner flourishes + compass rose. -----------
  buildParchmentTexture() {
    const PAD = 40;
    const W = MAP_PX + PAD * 2, H = MAP_PX + PAD * 2;
    const tex = this.textures.createCanvas('contParch', W, H) as Phaser.Textures.CanvasTexture;
    const ctx = tex.getContext();
    const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

    // Base sheet with a soft radial aging from centre.
    const grad = ctx.createRadialGradient(W / 2, H / 2, MAP_PX * 0.2, W / 2, H / 2, MAP_PX * 0.78);
    grad.addColorStop(0, hex(blend(PARCH, 0xfff0cc, 0.25)));
    grad.addColorStop(0.7, hex(PARCH));
    grad.addColorStop(1, hex(PARCH_EDGE));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Faint paper fibre lines.
    const rnd = mulberry(1337);
    ctx.lineWidth = 1;
    for (let i = 0; i < 220; i++) {
      const x = rnd() * W, y = rnd() * H, len = 6 + rnd() * 26, ang = rnd() * Math.PI;
      ctx.strokeStyle = 'rgba(120,96,52,' + (0.03 + rnd() * 0.05).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    }
    // A few brown age spots / coffee-stain blooms.
    for (let i = 0; i < 14; i++) {
      const x = PAD + rnd() * MAP_PX, y = PAD + rnd() * MAP_PX, rad = 8 + rnd() * 34;
      const g2 = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g2.addColorStop(0, 'rgba(120,88,40,' + (0.04 + rnd() * 0.06).toFixed(3) + ')');
      g2.addColorStop(1, 'rgba(120,88,40,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    // Inner shadow / vignette toward the edges.
    const vg = ctx.createRadialGradient(W / 2, H / 2, MAP_PX * 0.5, W / 2, H / 2, MAP_PX * 0.82);
    vg.addColorStop(0, 'rgba(60,40,16,0)');
    vg.addColorStop(1, 'rgba(60,40,16,0.34)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // --- Decorative border (double rope/vine frame + corner flourishes) ---
    const bx = PAD - 16, by = PAD - 16, bw = MAP_PX + 32, bh = MAP_PX + 32;
    ctx.strokeStyle = hex(INK);
    ctx.lineWidth = 3;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hex(INK_SOFT);
    ctx.strokeRect(bx + 6, by + 6, bw - 12, bh - 12);

    // Rope twist between the two frame lines (short diagonal ticks all around).
    ctx.strokeStyle = 'rgba(74,58,34,0.55)';
    ctx.lineWidth = 1.5;
    const tick = (x: number, y: number, dx: number, dy: number) => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); ctx.stroke(); };
    for (let x = bx + 4; x < bx + bw - 4; x += 9) { tick(x, by + 1, 4, 4); tick(x, by + bh - 5, 4, 4); }
    for (let y = by + 4; y < by + bh - 4; y += 9) { tick(bx + 1, y, 4, 4); tick(bx + bw - 5, y, 4, 4); }

    // Corner flourishes (little leafy curls).
    const flourish = (cx: number, cy: number, fx: number, fy: number) => {
      ctx.strokeStyle = hex(INK);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx + fx * 22, cy + fy * 6, cx + fx * 26, cy + fy * 24);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx + fx * 6, cy + fy * 22, cx + fx * 24, cy + fy * 26);
      ctx.stroke();
      // small leaf
      ctx.fillStyle = 'rgba(74,58,34,0.7)';
      ctx.beginPath();
      ctx.ellipse(cx + fx * 24, cy + fy * 24, 5, 2.5, Math.PI / 4 * (fx * fy), 0, Math.PI * 2);
      ctx.fill();
    };
    flourish(bx + 8, by + 8, 1, 1);
    flourish(bx + bw - 8, by + 8, -1, 1);
    flourish(bx + 8, by + bh - 8, 1, -1);
    flourish(bx + bw - 8, by + bh - 8, -1, -1);

    // --- Compass rose (bottom-right inside the map) ---
    const compX = PAD + MAP_PX - 56, compY = PAD + MAP_PX - 56, cr = 30;
    ctx.save();
    ctx.translate(compX, compY);
    // faint backing disc
    ctx.fillStyle = 'rgba(240,228,192,0.55)';
    ctx.beginPath(); ctx.arc(0, 0, cr + 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = hex(INK); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, cr, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, cr - 5, 0, Math.PI * 2); ctx.stroke();
    // 8-point star
    for (let k = 0; k < 4; k++) {
      const ang = (k * Math.PI) / 2;
      const long = cr - 3, w = 6;
      const px = Math.cos(ang), py = Math.sin(ang);
      const ox = -py, oy = px;
      ctx.fillStyle = (k % 2 === 0) ? hex(INK) : hex(INK_SOFT);
      ctx.beginPath();
      ctx.moveTo(px * long, py * long);
      ctx.lineTo(ox * w, oy * w);
      ctx.lineTo(-px * 4, -py * 4);
      ctx.lineTo(-ox * w, -oy * w);
      ctx.closePath();
      ctx.fill();
    }
    // minor diagonal points
    ctx.fillStyle = 'rgba(74,58,34,0.6)';
    for (let k = 0; k < 4; k++) {
      const ang = (k * Math.PI) / 2 + Math.PI / 4;
      const long = cr - 10, w = 3;
      const px = Math.cos(ang), py = Math.sin(ang), ox = -py, oy = px;
      ctx.beginPath();
      ctx.moveTo(px * long, py * long); ctx.lineTo(ox * w, oy * w); ctx.lineTo(-ox * w, -oy * w); ctx.closePath(); ctx.fill();
    }
    // N marker
    ctx.fillStyle = hex(INK);
    ctx.font = 'bold 13px Georgia, serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -cr + 1);
    ctx.restore();

    tex.refresh();
  }

  // --- Parchment stats header with wax seal --------------------------------
  buildHeader() {
    const hg = this.add.graphics().setDepth(40);
    const x = 12, y = 8, w = 290, h = 96;
    // parchment plaque
    hg.fillStyle(0xe9dab2, 0.96).fillRoundedRect(x, y, w, h, 8);
    hg.lineStyle(2, 0x6b4a26, 0.9).strokeRoundedRect(x, y, w, h, 8);
    hg.lineStyle(1, 0x8a6a3a, 0.5).strokeRoundedRect(x + 4, y + 4, w - 8, h - 8, 6);
    // wax seal (top-right of plaque)
    const sx = x + w - 22, sy = y + 22;
    hg.fillStyle(0x000000, 0.18).fillCircle(sx + 1.5, sy + 2, 15);
    hg.fillStyle(0x8c2b2b, 1).fillCircle(sx, sy, 15);
    hg.fillStyle(0xa83b3b, 1).fillCircle(sx - 3, sy - 3, 6);
    hg.lineStyle(1.5, 0x5e1c1c, 0.9).strokeCircle(sx, sy, 15);
    // tiny embossed star on the seal
    this.add.text(sx, sy, '✦', { fontFamily: 'serif', fontSize: '14px', color: '#5e1c1c' }).setOrigin(0.5).setDepth(41);

    this.add.text(x + 14, y + 10, 'THE KNOWN WORLD', { fontFamily: 'Georgia, serif', fontSize: '15px', color: '#3a2810', fontStyle: 'bold' }).setDepth(41);
    this.statsText = this.add.text(x + 14, y + 34, '', { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#4a3418', lineSpacing: 4 }).setDepth(41);

    // Resources plaque (top-right).
    const rw = 220, rh = 78, rx = GAME_W - rw - 12, ry = 8;
    hg.fillStyle(0xe9dab2, 0.96).fillRoundedRect(rx, ry, rw, rh, 8);
    hg.lineStyle(2, 0x6b4a26, 0.9).strokeRoundedRect(rx, ry, rw, rh, 8);
    this.add.text(rx + 12, ry + 8, 'STORES', { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#5a3a14', fontStyle: 'bold' }).setDepth(41);
    this.resText = this.add.text(rx + rw - 12, ry + 26, '', { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#6a4a1c', align: 'right', lineSpacing: 4 }).setOrigin(1, 0).setDepth(41);
  }

  // (UI overhaul Phase 2) Stage 4 of the staged tutorial — first continent open.
  showContinentTutorial() {
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem('kg_tut') || '{}'); } catch (e) {}
    if (seen[4]) return;
    seen[4] = true;
    try { localStorage.setItem('kg_tut', JSON.stringify(seen)); } catch (e) {}
    const W = 540, H = 110, cx = GAME_W / 2, top = GAME_H - 34 - 20 - H - 14;
    const els: any[] = [];
    els.push(this.add.rectangle(cx, top + H / 2, W, H, 0x2a1d0e, 0.97).setStrokeStyle(2, 0xc9a14a, 0.95).setDepth(70));
    els.push(this.add.text(cx - W / 2 + 18, top + 12, '📜 The Continent', { fontFamily: 'Georgia, serif', fontSize: '16px', color: '#ffe9b0', fontStyle: 'bold' }).setDepth(71));
    els.push(this.add.text(cx - W / 2 + 18, top + 36, 'This is your continent. Your territory glows; enemy kingdoms sit in the far corners; neutral settlements can be conquered. Press Tab or the button below to return.', { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#f0e6d0', wordWrap: { width: W - 36 }, lineSpacing: 3 }).setDepth(71));
    const bg = this.add.rectangle(cx + W / 2 - 70, top + H - 20, 110, 26, 0x6b4a26).setStrokeStyle(2, 0xe9d6a4, 0.85).setInteractive({ useHandCursor: true }).setDepth(71);
    els.push(bg);
    els.push(this.add.text(cx + W / 2 - 70, top + H - 20, 'Got it →', { fontFamily: 'Georgia, serif', fontSize: '13px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(72));
    bg.on('pointerover', () => bg.setFillStyle(0x82602f));
    bg.on('pointerout', () => bg.setFillStyle(0x6b4a26));
    bg.on('pointerdown', (p, lx, ly, ev) => { if (ev) ev.stopPropagation(); els.forEach((o) => o.destroy()); });
  }

  // Tile (c,r) -> on-screen point on the continent map.
  toScreen(c, r) { return { x: MX + (c / N) * MAP_PX, y: MY + (r / N) * MAP_PX }; }
  toTile(px, py) { return { col: Math.floor(((px - MX) / MAP_PX) * N), row: Math.floor(((py - MY) / MAP_PX) * N) }; }

  buildLabels() {
    this.labels.removeAll(true);
    const mk = (c, r, txt, big?) => {
      const p = this.toScreen(c, r);
      this.labels.add(this.add.text(p.x, p.y, txt, {
        fontFamily: 'Georgia, serif', fontSize: (big ? '17px' : '13px'),
        color: '#3a2810', fontStyle: 'italic bold',
        stroke: '#f0e4c0', strokeThickness: 4,
      }).setOrigin(0.5).setAlpha(0.92));
    };
    mk(100, 22, 'Deep Forest');
    mk(178, 100, 'Iron Mountains');
    mk(100, 178, 'River Delta');
    mk(22, 100, 'Western Wildlands');
    mk(100, 102, 'Your Realm', true);
  }

  rebuildMap() {
    const iso = this.iso;
    if (!iso || !iso.biomeGrid) return;
    this.drawIllustratedMap(iso);
    this.drawIcons();
    this.updateStats();
    this.applyNight(iso);
  }

  // --- Illustrated biome + watercolour map into the contIllus canvas. We sample
  // the 200x200 biome grid at a coarse cell size and draw a hand-drawn MOTIF per
  // cell (pines / peaks / dunes / grass / waves) rather than per-pixel colour. --
  drawIllustratedMap(iso: any) {
    const tex = this.textures.get('contIllus') as Phaser.Textures.CanvasTexture;
    const ctx = tex.getContext();
    const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
    ctx.clearRect(0, 0, MAP_PX, MAP_PX);

    const scale = MAP_PX / N;
    const castle = iso.buildings && iso.buildings.castle;
    const baseR = iso.territory ? iso.territory.baseR() : 8;
    const explored = iso.territory ? iso.territory.explored : null;
    const seenAt = (c: number, r: number) =>
      !explored || (explored[r] && explored[r][c]) ||
      (castle && Phaser.Math.Distance.Between(c, r, castle.col, castle.row) <= baseR + 16);

    const isWater = (c: number, r: number) =>
      c < 0 || r < 0 || c >= N || r >= N ? false : iso.terrainType[r][c] === 'water';
    const styleAt = (c: number, r: number): BiomeStyle =>
      (c < 0 || r < 0 || c >= N || r >= N) ? DEFAULT_STYLE : (BIOME_STYLE[iso.biomeGrid[r][c]] || DEFAULT_STYLE);

    const rnd = mulberry(99173);

    // 1) Base ground wash — coarse cells of softly-blended biome ground colour
    // so the whole sheet reads as tinted land, with a wavy watercolour sea.
    const G = 3; // ground cell in tiles
    for (let r = 0; r < N; r += G) {
      for (let c = 0; c < N; c += G) {
        const px = c * scale, py = r * scale, sz = G * scale + 0.6;
        if (isWater(c, r)) {
          ctx.fillStyle = hex(blend(SEA, SEA_DK, ((r + c) % 12) / 14));
        } else {
          const s0 = styleAt(c, r), s1 = styleAt(c + G, r), s2 = styleAt(c, r + G);
          let col = blend(s0.ground, blend(s1.ground, s2.ground, 0.5), 0.4);
          col = shade(col, (((c * 19 + r * 7) % 8) - 4) / 4 * 0.04);
          ctx.fillStyle = hex(col);
        }
        ctx.fillRect(px, py, sz, sz);
      }
    }

    // 2) Coastline foam — light stroke where land meets water.
    ctx.strokeStyle = hex(SEA_FOAM);
    ctx.lineWidth = 1.4;
    for (let r = 0; r < N; r += 2) {
      for (let c = 0; c < N; c += 2) {
        if (!isWater(c, r)) continue;
        if (!isWater(c - 2, r) || !isWater(c + 2, r) || !isWater(c, r - 2) || !isWater(c, r + 2)) {
          const p = c * scale, q = r * scale;
          ctx.globalAlpha = 0.5;
          ctx.beginPath(); ctx.arc(p, q, 1.6, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
    // water ripple strokes
    ctx.strokeStyle = 'rgba(80,130,150,0.35)';
    ctx.lineWidth = 1;
    for (let r = 4; r < N; r += 7) {
      for (let c = 4; c < N; c += 9) {
        if (!isWater(c, r)) continue;
        const p = c * scale, q = r * scale;
        ctx.beginPath();
        ctx.moveTo(p - 6, q);
        ctx.quadraticCurveTo(p - 3, q - 2.5, p, q);
        ctx.quadraticCurveTo(p + 3, q + 2.5, p + 6, q);
        ctx.stroke();
      }
    }

    // 3) Watercolour territory washes (soft, bleeding past borders). Drawn as
    // translucent radial blooms so they read as painted, not hard fills.
    const wash = (cx: number, cy: number, radTiles: number, col: number, alpha: number) => {
      const x = cx * scale, y = cy * scale, rad = radTiles * scale;
      const g = ctx.createRadialGradient(x, y, rad * 0.25, x, y, rad);
      g.addColorStop(0, rgba(col, alpha));
      g.addColorStop(0.7, rgba(col, alpha * 0.55));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    };
    // player realm wash (a soft layered bloom so it bleeds organically)
    if (castle) {
      wash(castle.col, castle.row, baseR + 6, 0x3f7fd6, 0.30);
      wash(castle.col, castle.row, baseR + 2, 0x4aa0ff, 0.22);
    }
    for (const s of (iso.settlements ? iso.settlements.list : [])) {
      if (s.owner === 'player') wash(s.col, s.row, 7, 0x4aa0ff, 0.24);
    }
    // AI realm washes in faction colours
    for (const k of (iso.kingdoms || [])) {
      if (k.castleAlive) wash(k.castleCol, k.castleRow, 12, k.cfg.color, 0.26);
    }

    // 4) Illustrated biome motifs (hand-drawn) at a coarser grid. Only over land
    // and only where the biome motif applies; jittered for an organic feel.
    const M = 6; // motif cell in tiles
    for (let r = 0; r < N; r += M) {
      for (let c = 0; c < N; c += M) {
        if (isWater(c, r)) continue;
        const st = styleAt(c, r);
        const jx = (rnd() - 0.5) * M * scale * 0.7;
        const jy = (rnd() - 0.5) * M * scale * 0.7;
        const x = c * scale + scale * (M / 2) + jx;
        const y = r * scale + scale * (M / 2) + jy;
        if (rnd() > 0.82 && st.motif !== 'mountains') continue; // thin density slightly
        switch (st.motif) {
          case 'forest': this.drawPine(ctx, x, y, 4 + rnd() * 2, st.ink); break;
          case 'mountains': this.drawPeak(ctx, x, y, 6 + rnd() * 3, st.ink); break;
          case 'plains': this.drawGrass(ctx, x, y, st.ink); break;
          case 'desert': this.drawDune(ctx, x, y, st.ink); break;
        }
      }
    }

    // 5) Fog-of-war as an illustrated dark cloud bank over unexplored land.
    ctx.save();
    for (let r = 0; r < N; r += 4) {
      for (let c = 0; c < N; c += 4) {
        if (seenAt(c, r)) continue;
        const x = c * scale, y = r * scale, sz = 4 * scale + 1;
        // darken the unexplored area
        ctx.fillStyle = 'rgba(22,26,40,0.62)';
        ctx.fillRect(x, y, sz, sz);
      }
    }
    // soft cloud puffs along the explored frontier
    ctx.fillStyle = 'rgba(36,40,58,0.5)';
    for (let r = 2; r < N; r += 5) {
      for (let c = 2; c < N; c += 5) {
        const here = seenAt(c, r);
        const edge = here && (!seenAt(c - 5, r) || !seenAt(c + 5, r) || !seenAt(c, r - 5) || !seenAt(c, r + 5));
        const dark = !here && (seenAt(c - 5, r) || seenAt(c + 5, r) || seenAt(c, r - 5) || seenAt(c, r + 5));
        if (!edge && !dark) continue;
        const x = c * scale, y = r * scale;
        for (let k = 0; k < 3; k++) {
          ctx.globalAlpha = 0.18 + rnd() * 0.12;
          ctx.beginPath();
          ctx.arc(x + (rnd() - 0.5) * 14, y + (rnd() - 0.5) * 14, 5 + rnd() * 7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // 6) Faint parchment grain over the whole map so even land reads as paper.
    ctx.fillStyle = 'rgba(120,90,40,0.05)';
    for (let i = 0; i < 90; i++) ctx.fillRect(rnd() * MAP_PX, rnd() * MAP_PX, 1, 1);

    tex.refresh();
  }

  // --- Hand-drawn biome motif primitives (Canvas2D) ---
  drawPine(ctx: any, x: number, y: number, h: number, ink: number) {
    const hex = '#' + ink.toString(16).padStart(6, '0');
    ctx.fillStyle = hex;
    ctx.strokeStyle = 'rgba(20,40,18,0.5)';
    ctx.lineWidth = 0.6;
    // trunk
    ctx.fillStyle = 'rgba(70,50,28,0.8)';
    ctx.fillRect(x - 0.6, y + h * 0.4, 1.2, h * 0.4);
    // two stacked triangles
    ctx.fillStyle = hex;
    const tri = (cy: number, w: number, hh: number) => { ctx.beginPath(); ctx.moveTo(x, cy - hh); ctx.lineTo(x - w, cy); ctx.lineTo(x + w, cy); ctx.closePath(); ctx.fill(); };
    tri(y + h * 0.5, h * 0.6, h * 0.7);
    tri(y + h * 0.15, h * 0.45, h * 0.65);
  }
  drawPeak(ctx: any, x: number, y: number, h: number, ink: number) {
    const hex = '#' + ink.toString(16).padStart(6, '0');
    // mountain triangle
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.lineTo(x - h * 0.85, y + h * 0.5);
    ctx.lineTo(x + h * 0.85, y + h * 0.5);
    ctx.closePath();
    ctx.fill();
    // snow cap
    ctx.fillStyle = 'rgba(248,246,238,0.92)';
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.lineTo(x - h * 0.28, y - h * 0.38);
    ctx.lineTo(x - h * 0.1, y - h * 0.5);
    ctx.lineTo(x + h * 0.06, y - h * 0.38);
    ctx.lineTo(x + h * 0.28, y - h * 0.4);
    ctx.closePath();
    ctx.fill();
    // shading line
    ctx.strokeStyle = 'rgba(40,34,24,0.4)';
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + h * 0.25, y + h * 0.5); ctx.stroke();
  }
  drawGrass(ctx: any, x: number, y: number, ink: number) {
    ctx.strokeStyle = 'rgba(' + ((ink >> 16) & 255) + ',' + ((ink >> 8) & 255) + ',' + (ink & 255) + ',0.45)';
    ctx.lineWidth = 1;
    // a couple of undulating grass tufts
    for (let k = -1; k <= 1; k++) {
      const gx = x + k * 4;
      ctx.beginPath();
      ctx.moveTo(gx - 3, y + 1.5);
      ctx.quadraticCurveTo(gx, y - 2.5, gx + 3, y + 1.5);
      ctx.stroke();
    }
  }
  drawDune(ctx: any, x: number, y: number, ink: number) {
    ctx.strokeStyle = 'rgba(' + ((ink >> 16) & 255) + ',' + ((ink >> 8) & 255) + ',' + (ink & 255) + ',0.5)';
    ctx.lineWidth = 1.1;
    // dune ripple lines
    for (let k = 0; k < 2; k++) {
      const yy = y + k * 3 - 1;
      ctx.beginPath();
      ctx.moveTo(x - 6, yy);
      ctx.quadraticCurveTo(x, yy - 3, x + 6, yy);
      ctx.stroke();
    }
  }

  drawIcons() {
    const iso = this.iso;
    const g = this.icons;
    g.clear();
    this.iconText.removeAll(true);
    const explored = iso.territory ? iso.territory.explored : null;

    // (Completion Phase 5) Roads — illustrated DOUBLE brown lines along road tiles.
    if (iso.roads && iso.roads.tiles) {
      g.fillStyle(0x6b4a26, 0.5);
      for (const k of iso.roads.tiles) { const [c, r] = k.split(',').map(Number); const p = this.toScreen(c, r); g.fillCircle(p.x, p.y, 1.9); }
      g.fillStyle(0x8a6a3a, 0.85);
      for (const k of iso.roads.tiles) { const [c, r] = k.split(',').map(Number); const p = this.toScreen(c, r); g.fillCircle(p.x, p.y, 1); }
    }

    // (Completion Phase 9) Caravan routes — a dotted illustrated line + a wagon dot.
    this._caravanDots = [];
    if (iso.caravans && iso.caravans.routes) {
      for (const rt of iso.caravans.routes) {
        if (!rt.from || !rt.to || rt.from.col == null || rt.to.col == null) continue;
        const a = this.toScreen(rt.from.col, rt.from.row), b = this.toScreen(rt.to.col, rt.to.row);
        this.dottedLine(g, a.x, a.y, b.x, b.y, 0x8a6a3a, 0.4, 4, 4);
        const t = Phaser.Math.Clamp((rt.progress || 0) / (rt.days || 1), 0, 1);
        const x = Phaser.Math.Linear(a.x, b.x, t), y = Phaser.Math.Linear(a.y, b.y, t);
        g.fillStyle(0x8b5e3c, 1).fillCircle(x, y, 3); g.lineStyle(1, 0xf5ecd2, 0.8).strokeCircle(x, y, 3);
        this._caravanDots.push({ x, y, txt: `Caravan: ${rt.resource} · ${rt.from.name}→${rt.to.name} · ~${Math.max(0, Math.round((rt.days || 1) - (rt.progress || 0)))}d` });
      }
    }

    // (Completion Phase 9) Expedition parties — compass dots drifting from castle.
    if (iso.expeditions && iso.expeditions.state && iso.buildings.castle) {
      const cc = this.toScreen(iso.buildings.castle.col, iso.buildings.castle.row); let ei = 0;
      for (const key of Object.keys(iso.expeditions.state)) for (const slot of iso.expeditions.state[key]) {
        const total = (iso.expeditions.defs[key] && iso.expeditions.defs[key].days ? iso.expeditions.defs[key].days : 1) * 300;
        const frac = 1 - Phaser.Math.Clamp((slot.timeLeft || 0) / total, 0, 1);
        const ang = ei * 1.27, dist = 12 + frac * 46;
        const x = cc.x + Math.cos(ang) * dist, y = cc.y + Math.sin(ang) * dist;
        g.fillStyle(0xf0e4c0, 1).fillCircle(x, y, 2.4); g.lineStyle(1, 0x4a3a22, 0.9).strokeCircle(x, y, 2.4);
        g.lineStyle(1, 0x4a3a22, 0.9); g.lineBetween(x - 2, y, x + 2, y); g.lineBetween(x, y - 2, x, y + 2); ei++;
      }
    }

    // --- AI fortresses — faction-coloured illustrated keep with banner ---
    for (const k of iso.kingdoms || []) {
      if (!k.castleAlive) continue;
      const p = this.toScreen(k.castleCol, k.castleRow);
      this.drawFortress(g, p.x, p.y, k.cfg.color);
    }

    // --- Neutral settlements (house cluster) / player settlements (small keep) ---
    for (const s of iso.settlements ? iso.settlements.list : []) {
      if (s.owner !== 'player' && !s.discovered) continue;
      const p = this.toScreen(s.col, s.row);
      if (s.owner === 'player') this.drawFortress(g, p.x, p.y, 0x3f7fd6, 0.8);
      else this.drawVillage(g, p.x, p.y);
    }

    // --- Goblin camps — illustrated dark-red skull/X mark ---
    for (const cmp of iso.goblinCamps ? iso.goblinCamps.list : []) {
      if (!cmp.alive || !cmp.discovered) continue;
      const p = this.toScreen(cmp.col, cmp.row);
      g.fillStyle(0x1a0c0c, 0.25).fillCircle(p.x + 1, p.y + 1.5, 5);
      g.lineStyle(2.4, 0x7a1414, 1);
      g.lineBetween(p.x - 4, p.y - 4, p.x + 4, p.y + 4).lineBetween(p.x - 4, p.y + 4, p.x + 4, p.y - 4);
      g.lineStyle(1, 0x3a0a0a, 0.8);
      g.lineBetween(p.x - 4, p.y - 4, p.x + 4, p.y + 4).lineBetween(p.x - 4, p.y + 4, p.x + 4, p.y - 4);
    }

    // --- Ancient ruins (discovered) — crumbled arch ---
    for (const ru of iso.ruins ? iso.ruins.list : []) {
      if (!ru.discovered) continue;
      const p = this.toScreen(ru.col, ru.row);
      this.drawRuin(g, p.x, p.y);
    }

    // --- Player castle — illustrated keep with banner + "local view" frame ---
    const c = iso.buildings.castle;
    if (c) {
      const half = 15;
      const a = this.toScreen(c.col - half, c.row - half);
      const b = this.toScreen(c.col + half, c.row + half);
      // soft dashed gold frame for the local view area
      this.dashedRect(g, a.x, a.y, b.x - a.x, b.y - a.y, 0xe6c87a, 0.85);
      this.iconText.add(this.add.text((a.x + b.x) / 2, a.y - 4, 'local view', { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#5a3a14', fontStyle: 'italic', stroke: '#f0e4c0', strokeThickness: 3 }).setOrigin(0.5, 1));
      const p = this.toScreen(c.col, c.row);
      this.drawCastle(g, p.x, p.y);
    }

    // --- Armies as MAP PINS (faction-coloured, sword motif, soft shadow) + faint
    // dotted movement trail toward their (optional) destination. ---
    if (iso.armyMgr) {
      const FC: Record<string, number> = { player: 0x3a7bd5, red: 0xd64a4a, purple: 0xa45ad6, yellow: 0xd6c04a };
      for (const a of iso.armyMgr.armies) {
        const p = this.toScreen(a.col, a.row);
        const col = FC[a.faction] || 0x888888;
        // movement trail (if the army has a destination)
        const dest = a.dest || a.target || (a.path && a.path.length ? a.path[a.path.length - 1] : null);
        if (dest && dest.col != null) { const d = this.toScreen(dest.col, dest.row); this.dottedLine(g, p.x, p.y, d.x, d.y, col, 0.35, 3, 4); }
        this.drawArmyPin(g, p.x, p.y, col);
      }
    }

    // (Session-1 Phase 2) Wandering factions — small coloured travellers.
    if (iso.factions && iso.factions.continentDots) {
      for (const d of iso.factions.continentDots()) {
        const p = this.toScreen(d.col, d.row);
        g.fillStyle(0x2a1c0c, 0.2).fillCircle(p.x + 0.6, p.y + 1, 3);
        g.fillStyle(d.color, 1).fillCircle(p.x, p.y, 2.6);
        g.lineStyle(1, 0x2a1c0c, 0.5).strokeCircle(p.x, p.y, 2.6);
      }
    }

    // Player field army (centroid of troops) — small blue pin.
    const units = iso.troops ? iso.troops.allUnits() : [];
    if (units.length) {
      let sc = 0, sr = 0;
      for (const u of units) { const t = iso.screenToTile(u.x, u.y); sc += t.col; sr += t.row; }
      const p = this.toScreen(sc / units.length, sr / units.length);
      this.drawArmyPin(g, p.x, p.y, 0x3a7bd5);
    }

    // AI armies (live attack waves) — small faction dots.
    for (const e of iso.waves ? iso.waves.enemies : []) {
      if (!e.alive) continue;
      const t = iso.screenToTile((e.rect || e.spr).x, (e.rect || e.spr).y);
      const col = e.faction ? e.faction.cfg.color : 0xc0392b;
      const p = this.toScreen(t.col, t.row);
      g.fillStyle(col, 1).fillCircle(p.x, p.y, 2.2);
      g.lineStyle(0.8, 0x2a1c0c, 0.6).strokeCircle(p.x, p.y, 2.2);
    }

    this.drawCouncilAftermath(iso, g); // (V2 P2)
    this.drawLegend();                 // illustrated legend box
  }

  // ----- Illustrated icon primitives (vector Graphics) -----
  drawCastle(g: any, x: number, y: number) {
    // soft shadow
    g.fillStyle(0x2a1c0c, 0.28).fillEllipse(x, y + 7, 18, 6);
    // keep body (gold-stone)
    g.fillStyle(0xe8d49a, 1);
    g.fillRect(x - 7, y - 4, 14, 10);
    g.lineStyle(1, 0x6b4a26, 1).strokeRect(x - 7, y - 4, 14, 10);
    // crenellations
    g.fillStyle(0xe8d49a, 1);
    for (let i = -7; i < 7; i += 4) g.fillRect(x + i, y - 7, 2.4, 3);
    // two towers
    g.fillStyle(0xdcc488, 1);
    g.fillRect(x - 9, y - 7, 4, 13); g.fillRect(x + 5, y - 7, 4, 13);
    g.lineStyle(0.8, 0x6b4a26, 1).strokeRect(x - 9, y - 7, 4, 13).strokeRect(x + 5, y - 7, 4, 13);
    // gate
    g.fillStyle(0x5a3a14, 1).fillRect(x - 1.6, y + 1, 3.2, 5);
    // banner pole + blue flag
    g.lineStyle(1, 0x4a3a22, 1).lineBetween(x, y - 7, x, y - 16);
    g.fillStyle(0x3a7bd5, 1).fillTriangle(x, y - 16, x + 9, y - 13.5, x, y - 11);
    g.lineStyle(0.8, 0xf5ecd2, 0.7).strokeTriangle(x, y - 16, x + 9, y - 13.5, x, y - 11);
  }
  drawFortress(g: any, x: number, y: number, col: number, scale = 1) {
    const s = scale;
    g.fillStyle(0x2a1c0c, 0.26).fillEllipse(x, y + 6 * s, 14 * s, 5 * s);
    // keep, tinted toward faction colour but kept stony
    const body = blend(0xcdbb90, col, 0.35);
    g.fillStyle(body, 1).fillRect(x - 6 * s, y - 3 * s, 12 * s, 9 * s);
    g.lineStyle(1, 0x4a3a22, 1).strokeRect(x - 6 * s, y - 3 * s, 12 * s, 9 * s);
    for (let i = -6; i < 6; i += 3.5) g.fillRect(x + i * s, y - 6 * s, 2 * s, 2.6 * s);
    g.fillStyle(blend(0xbcaa80, col, 0.4), 1).fillRect(x - 8 * s, y - 6 * s, 3.4 * s, 12 * s).fillRect(x + 4.5 * s, y - 6 * s, 3.4 * s, 12 * s);
    g.lineStyle(0.7, 0x4a3a22, 1).strokeRect(x - 8 * s, y - 6 * s, 3.4 * s, 12 * s).strokeRect(x + 4.5 * s, y - 6 * s, 3.4 * s, 12 * s);
    // faction banner
    g.lineStyle(1, 0x4a3a22, 1).lineBetween(x, y - 6 * s, x, y - 14 * s);
    g.fillStyle(col, 1).fillTriangle(x, y - 14 * s, x + 8 * s, y - 11.5 * s, x, y - 9.5 * s);
  }
  drawVillage(g: any, x: number, y: number) {
    g.fillStyle(0x2a1c0c, 0.22).fillEllipse(x, y + 5, 12, 4);
    // a little cluster of three thatched houses
    const house = (hx: number, hy: number, w: number) => {
      g.fillStyle(0xe7d3a0, 1).fillRect(hx - w / 2, hy, w, w * 0.7);
      g.lineStyle(0.7, 0x6b4a26, 1).strokeRect(hx - w / 2, hy, w, w * 0.7);
      g.fillStyle(0x8a5a30, 1).fillTriangle(hx - w / 2 - 1, hy, hx + w / 2 + 1, hy, hx, hy - w * 0.6);
    };
    house(x - 4, y - 1, 5);
    house(x + 4, y - 1, 5);
    house(x, y - 4, 5.5);
  }
  drawRuin(g: any, x: number, y: number) {
    g.fillStyle(0x2a1c0c, 0.2).fillEllipse(x, y + 5, 11, 4);
    // crumbled arch: two broken pillars + a partial top
    g.fillStyle(0xb7ad9a, 1);
    g.fillRect(x - 6, y - 5, 2.6, 11);
    g.fillRect(x + 3.4, y - 2, 2.6, 8);
    g.lineStyle(0.7, 0x5a5247, 1).strokeRect(x - 6, y - 5, 2.6, 11).strokeRect(x + 3.4, y - 2, 2.6, 8);
    // arch fragment
    g.lineStyle(2, 0xb7ad9a, 1);
    g.beginPath(); g.arc(x - 1.5, y - 5, 4.5, Math.PI, Math.PI * 1.7); g.strokePath();
    // rubble
    g.fillStyle(0x9aa0a6, 1).fillCircle(x + 1, y + 5, 1.4).fillCircle(x - 3, y + 5.5, 1.1);
  }
  drawArmyPin(g: any, x: number, y: number, col: number) {
    // soft shadow
    g.fillStyle(0x2a1c0c, 0.3).fillEllipse(x, y + 1, 8, 3);
    // teardrop pin
    g.fillStyle(col, 1);
    g.beginPath();
    g.arc(x, y - 7, 5, 0, Math.PI * 2);
    g.fillPath();
    g.fillTriangle(x - 4, y - 4, x + 4, y - 4, x, y + 2);
    g.lineStyle(1, 0xf5ecd2, 0.85).strokeCircle(x, y - 7, 5);
    // sword motif on the disc
    g.lineStyle(1.2, 0xffffff, 0.92);
    g.lineBetween(x, y - 10, x, y - 4);          // blade
    g.lineBetween(x - 2, y - 5.5, x + 2, y - 5.5); // crossguard
  }

  // small dashed / dotted line + dashed rect helpers
  dottedLine(g: any, x1: number, y1: number, x2: number, y2: number, col: number, alpha: number, dash: number, gap: number) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len, uy = dy / len;
    g.lineStyle(1.4, col, alpha);
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(d + dash, len);
      g.lineBetween(x1 + ux * d, y1 + uy * d, x1 + ux * e, y1 + uy * e);
    }
  }
  dashedRect(g: any, x: number, y: number, w: number, h: number, col: number, alpha: number) {
    this.dottedLine(g, x, y, x + w, y, col, alpha, 6, 4);
    this.dottedLine(g, x + w, y, x + w, y + h, col, alpha, 6, 4);
    this.dottedLine(g, x + w, y + h, x, y + h, col, alpha, 6, 4);
    this.dottedLine(g, x, y + h, x, y, col, alpha, 6, 4);
  }

  // --- Illustrated legend box (bottom-left corner of the map) ---
  drawLegend() {
    const g = this.icons;
    const x = MX + 8, y = MY + MAP_PX - 118, w = 150, h = 110;
    g.fillStyle(0xe9dab2, 0.88).fillRoundedRect(x, y, w, h, 6);
    g.lineStyle(1.5, 0x6b4a26, 0.85).strokeRoundedRect(x, y, w, h, 6);
    this.iconText.add(this.add.text(x + 8, y + 6, 'Legend', { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#3a2810', fontStyle: 'bold italic' }));
    const rows: Array<[string, (gx: number, gy: number) => void]> = [
      ['Your castle', (gx, gy) => this.drawCastle(g, gx, gy)],
      ['Enemy keep', (gx, gy) => this.drawFortress(g, gx, gy, 0xd64a4a, 0.7)],
      ['Village', (gx, gy) => this.drawVillage(g, gx, gy)],
      ['Ruins', (gx, gy) => this.drawRuin(g, gx, gy)],
      ['Goblin camp', (gx, gy) => { g.lineStyle(2, 0x7a1414, 1); g.lineBetween(gx - 4, gy - 4, gx + 4, gy + 4).lineBetween(gx - 4, gy + 4, gx + 4, gy - 4); }],
    ];
    let ry = y + 26;
    for (const [label, draw] of rows) {
      draw(x + 16, ry + 4);
      this.iconText.add(this.add.text(x + 34, ry - 3, label, { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#4a3418' }));
      ry += 16;
    }
  }

  // (V2 P2) Council aftermath — restyled to fit the illustrated map.
  drawCouncilAftermath(iso: any, g: any) {
    const ce = iso._councilEffect; if (!ce) return;
    const castle = iso.buildings && iso.buildings.castle;
    const facCastle = (key: string) => { const k = (iso.kingdoms || []).find((x: any) => x.cfg.key === key); return k && k.castleAlive ? this.toScreen(k.castleCol, k.castleRow) : null; };
    if (ce.type === 'trade' && castle) {
      const home = this.toScreen(castle.col, castle.row);
      for (const key of ce.participants || []) {
        const p = facCastle(key); if (!p) continue;
        // illustrated golden trade route (dashed) + a coin marker
        this.dottedLine(g, home.x, home.y, p.x, p.y, 0xe0b24a, 0.85, 5, 4);
        g.fillStyle(0xf2cf5a, 1).fillCircle(p.x, p.y - 18, 3.2);
        g.lineStyle(1, 0x8a6a20, 0.9).strokeCircle(p.x, p.y - 18, 3.2);
      }
    } else if (ce.type === 'enemy' && ce.target) {
      const p = facCastle(ce.target);
      if (p) {
        g.lineStyle(3.2, 0x9c2b2b, 1);
        g.lineBetween(p.x - 9, p.y - 21, p.x + 9, p.y - 9);
        g.lineBetween(p.x - 9, p.y - 9, p.x + 9, p.y - 21);
        g.lineStyle(1, 0x3a0a0a, 0.6);
        g.lineBetween(p.x - 9, p.y - 21, p.x + 9, p.y - 9);
        g.lineBetween(p.x - 9, p.y - 9, p.x + 9, p.y - 21);
      }
    } else if (ce.type === 'peace' && castle) {
      const p = this.toScreen(castle.col, castle.row - 20);
      g.fillStyle(0xfdfaf0, 0.97); g.fillCircle(p.x, p.y, 3.4);
      g.lineStyle(2, 0xfdfaf0, 0.95); g.beginPath(); g.arc(p.x - 4, p.y - 1, 4, -0.4, 1.2); g.strokePath(); g.beginPath(); g.arc(p.x + 4, p.y - 1, 4, 1.9, 3.5); g.strokePath();
    } else if (ce.type === 'highking') {
      for (const k of iso.kingdoms || []) { if (!k.castleAlive) continue; const p = this.toScreen(k.castleCol, k.castleRow); g.lineStyle(2, 0xe0b24a, 0.9); g.strokeCircle(p.x, p.y - 6, 13); }
      if (castle) { const p = this.toScreen(castle.col, castle.row); g.lineStyle(2.6, 0xf2cf5a, 1); g.strokeCircle(p.x, p.y - 6, 15); }
    }
  }

  // --- Night darkening of the parchment + warm settlement light dots ---
  applyNight(iso: any) {
    let night = typeof iso._nightness === 'number' ? iso._nightness : 0;
    if (!night && typeof iso.dayTimer === 'number') {
      const phase = (iso.dayTimer / 300000) % 1;
      night = phase >= 0.84 ? (phase - 0.84) / 0.1 : phase < 0.08 ? 1 - phase / 0.08 : 0;
    }
    night = Phaser.Math.Clamp(night, 0, 1);
    this.nightTint.setFillStyle(0x0c1430).setAlpha(0.5 * night);
    const nd = this.nightDots;
    nd.clear();
    if (night > 0.15) {
      const warm = 0xffdf8c, a = night;
      const light = (cx: number, cy: number) => { const p = this.toScreen(cx, cy); nd.fillStyle(warm, 0.85 * a).fillCircle(p.x, p.y - 6, 2.2); nd.fillStyle(warm, 0.25 * a).fillCircle(p.x, p.y - 6, 4.5); };
      const castle = iso.buildings && iso.buildings.castle;
      if (castle) light(castle.col, castle.row);
      for (const s of (iso.settlements ? iso.settlements.list : [])) { if (s.owner === 'player' || s.discovered) light(s.col, s.row); }
      for (const k of (iso.kingdoms || [])) { if (k.castleAlive) light(k.castleCol, k.castleRow); }
    }
  }

  updateStats() {
    const iso = this.iso;
    const pct = iso.territory ? iso.territory.percentOwned.toFixed(1) : '0';
    const owned = iso.settlements ? iso.settlements.ownedCount() : 0;
    const total = iso.settlements ? iso.settlements.total() : 0;
    const hostile = (iso.kingdoms || []).filter((k) => k.castleAlive && iso.gameDay >= k.startDay).length;
    const camps = iso.goblinCamps ? iso.goblinCamps.aliveCount() : 0;
    const season = iso.seasonHint ? iso.seasonHint(iso.gameDay) : '';
    this.statsText.setText([
      `Day ${iso.gameDay}  ·  ${season}`,
      `Realm: ${pct}% of the continent`,
      `Settlements: ${owned}/${total}   ·   Camps: ${camps}`,
      `Hostile kingdoms: ${hostile}`,
    ].join('\n'));
    const r = iso.resources;
    this.resText.setText([
      `Wood ${Math.floor(r.wood)}   Stone ${Math.floor(r.stone)}`,
      `Food ${Math.floor(r.food)}   Gold ${Math.floor(r.gold)}`,
      `Iron ${Math.floor(r.iron)}`,
    ].join('\n'));
  }

  // Hover tooltip over settlements / caravans.
  onHover(p) {
    const iso = this.iso;
    let hit = null;
    for (const s of iso.settlements ? iso.settlements.list : []) {
      if (s.owner !== 'player' && !s.discovered) continue;
      const sp = this.toScreen(s.col, s.row);
      if (Phaser.Math.Distance.Between(p.x, p.y, sp.x, sp.y) < 9) { hit = { x: sp.x, y: sp.y, txt: `${s.name} — ${s.owner === 'player' ? 'Yours' : 'Neutral'} · ${s.note}` }; break; }
    }
    if (!hit && this._caravanDots) for (const d of this._caravanDots) { if (Phaser.Math.Distance.Between(p.x, p.y, d.x, d.y) < 7) { hit = d; break; } }
    if (hit) this.tip.setText(hit.txt).setPosition(hit.x, hit.y - 12).setVisible(true);
    else this.tip.setVisible(false);
  }

  // Click a player settlement / castle → zoom local view there; close.
  onClick(p) {
    const iso = this.iso;
    const t = this.toTile(p.x, p.y);
    if (t.col < 0 || t.row < 0 || t.col >= N || t.row >= N) return;
    let target = null;
    for (const s of iso.settlements ? iso.settlements.list : []) {
      if (s.owner !== 'player') continue;
      if (Phaser.Math.Distance.Between(t.col, t.row, s.col, s.row) <= 3) { target = { col: s.col, row: s.row }; break; }
    }
    const castle = iso.buildings.castle;
    if (!target && castle && Phaser.Math.Distance.Between(t.col, t.row, castle.col, castle.row) <= 4) target = { col: castle.col, row: castle.row };
    if (target) this.close(target);
  }

  // (Bug 3) Normal close: fade out, then hand back to the world.
  close(focus?: any) {
    if (this._closing) return;
    this._closing = true;
    this._focus = focus || null;
    const finish = () => this.finishClose();
    try {
      this.cameras.main.fadeOut(180, 20, 14, 8);
      this.cameras.main.once('camerafadeoutcomplete', finish);
      this.time.delayedCall(500, finish);
    } catch (e) {
      finish();
    }
  }

  // (Bug 3) Guaranteed escape hatch (Escape key): instant.
  forceClose() {
    this._closing = true;
    this.finishClose();
  }

  // (Bug 3) The single, idempotent hand-back to IsometricScene.
  finishClose() {
    if (this._finished) return;
    this._finished = true;
    const iso = this.iso || this.scene.get('IsometricScene');
    try { if (this._focus && iso) { const w = iso.tileCenter(this._focus.col, this._focus.row); iso.cameras.main.centerOn(w.x, w.y); } } catch (e) {}
    try {
      this.scene.resume('IsometricScene');
      if (iso && iso.cameras && iso.cameras.main) iso.cameras.main.fadeIn(220, 8, 12, 18);
    } catch (e) {}
    try { this.scene.stop(); } catch (e) {}
  }

  update(time, delta) {
    this._refresh += delta;
    if (this._refresh >= 500) { this._refresh = 0; this.rebuildMap(); } // keep armies / territory fresh
  }
}

// --- tiny deterministic PRNG (no deps) for stable parchment / motif jitter ---
function mulberry(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rgba(col: number, a: number) {
  return 'rgba(' + ((col >> 16) & 255) + ',' + ((col >> 8) & 255) + ',' + (col & 255) + ',' + a + ')';
}
