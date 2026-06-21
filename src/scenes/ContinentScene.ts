import Phaser from 'phaser';
import { GAME_W, GAME_H } from './GameScene.js';

// Continent view (Phase B) — a stylized, Catan-flavoured top-down overview of
// the whole 200x200 world. Tab toggles between this and the local IsometricScene.
// The entire continent is rendered into a 200x200 canvas (one pixel per tile,
// coloured by biome + territory) scaled up to fit, with drawn icons for
// settlements, castles and goblin camps on top.

const N = 200;
const MAP_PX = 600;                 // on-screen size of the (square) continent
const MX = (GAME_W - MAP_PX) / 2;   // top-left of the map on screen
const MY = 86;

// (Phase 4 Decision 4) More saturated, distinct biome colours.
const BIOME: Record<string, number> = {
  start: 0x3a8a3a, middle: 0x5a7a2a, forest: 0x1a4a1a, mountains: 0x6b6b5a,
  delta: 0x5a7a2a, wildlands: 0x4a4a1a,
};
const WATER = 0x2a5a8a;

function blend(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

export class ContinentScene extends Phaser.Scene {
  [key: string]: any;

  constructor() { super('ContinentScene'); }

  create() {
    this.iso = this.scene.get('IsometricScene');
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x0c1018, 1).setOrigin(0, 0);

    // Continent map image (built from a per-tile canvas, scaled to MAP_PX).
    if (!this.textures.exists('continentMap')) this.textures.createCanvas('continentMap', N, N);
    this.mapImg = this.add.image(MX, MY, 'continentMap').setOrigin(0, 0).setDisplaySize(MAP_PX, MAP_PX);
    this.mapImg.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.add.rectangle(MX, MY, MAP_PX, MAP_PX).setOrigin(0, 0).setStrokeStyle(2, 0x3a4656);

    this.icons = this.add.graphics();
    // (Phase 4 Decision 4) Subtle vignette around the map edges.
    const vg = this.add.graphics().setDepth(50);
    for (let i = 0; i < 5; i++) { vg.lineStyle(14 - i * 2, 0x000000, 0.05 + i * 0.02); vg.strokeRect(MX + i * 4, MY + i * 4, MAP_PX - i * 8, MAP_PX - i * 8); }
    this.iconText = this.add.container(0, 0);
    this.labels = this.add.container(0, 0);
    this.buildLabels();

    // ---- UI ----
    this.add.text(GAME_W / 2, 10, 'CONTINENT', { fontFamily: 'monospace', fontSize: '20px', color: '#dfe6ee', fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.statsText = this.add.text(16, 40, '', { fontFamily: 'monospace', fontSize: '12px', color: '#b9c6d6', lineSpacing: 3 });
    this.resText = this.add.text(GAME_W - 16, 40, '', { fontFamily: 'monospace', fontSize: '12px', color: '#e3c27a', align: 'right', lineSpacing: 3 }).setOrigin(1, 0);
    this.tip = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff', backgroundColor: '#000000cc', padding: { x: 6, y: 4 } }).setOrigin(0.5, 1).setDepth(50).setVisible(false);

    // (Bug 3) Always reset the close guards on (re)entry so we can never start
    // a session already flagged as "closing" and become unable to leave.
    this._closing = false;
    this._finished = false;

    // (Bug 3) Always-on-top, always-clickable "Return to Kingdom" button.
    const btn = this.add.rectangle(GAME_W / 2, GAME_H - 34, 260, 40, 0x2d6cb0).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }).setDepth(200);
    this.add.text(GAME_W / 2, GAME_H - 34, 'Return to Kingdom  (Tab / Esc)', { fontFamily: 'monospace', fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(201);
    btn.on('pointerover', () => btn.setFillStyle(0x3d83cf));
    btn.on('pointerout', () => btn.setFillStyle(0x2d6cb0));
    btn.on('pointerdown', () => this.close());

    // (Bug 3) Tab closes (with fade); Escape is a guaranteed instant escape hatch
    // that bypasses the fade and the _closing guard entirely.
    this.input.keyboard.on('keydown-TAB', (e) => { if (e && e.preventDefault) e.preventDefault(); this.close(); });
    this.input.keyboard.on('keydown-ESC', (e) => { if (e && e.preventDefault) e.preventDefault(); this.forceClose(); });
    this.input.keyboard.on('keydown-ESCAPE', (e) => { if (e && e.preventDefault) e.preventDefault(); this.forceClose(); });
    this.input.on('pointermove', (p) => this.onHover(p));
    this.input.on('pointerdown', (p) => this.onClick(p));

    this.rebuildMap();
    this.cameras.main.fadeIn(220, 12, 16, 24);

    this.showContinentTutorial();

    // Mark which tiles the local fog has revealed (for hiding undiscovered sites).
    this._refresh = 0;
  }

  // (UI overhaul Phase 2) Stage 4 of the staged tutorial — shown the first time
  // the player opens the continent view, then never again (localStorage).
  showContinentTutorial() {
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem('kg_tut') || '{}'); } catch (e) {}
    if (seen[4]) return;
    seen[4] = true;
    try { localStorage.setItem('kg_tut', JSON.stringify(seen)); } catch (e) {}
    const W = 540, H = 110, cx = GAME_W / 2, top = GAME_H - 34 - 20 - H - 14;
    const els: any[] = [];
    els.push(this.add.rectangle(cx, top + H / 2, W, H, 0x1a140c, 0.97).setStrokeStyle(2, 0xc9a14a, 0.95).setDepth(60));
    els.push(this.add.text(cx - W / 2 + 18, top + 12, '📜 The Continent', { fontFamily: 'monospace', fontSize: '16px', color: '#ffe9b0', fontStyle: 'bold' }).setDepth(61));
    els.push(this.add.text(cx - W / 2 + 18, top + 36, 'This is your continent. Your territory glows; enemy kingdoms sit in the far corners; neutral settlements can be conquered. Press Tab or the button below to return.', { fontFamily: 'monospace', fontSize: '12px', color: '#f0e6d0', wordWrap: { width: W - 36 }, lineSpacing: 3 }).setDepth(61));
    const bg = this.add.rectangle(cx + W / 2 - 70, top + H - 20, 110, 26, 0x2d6cb0).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }).setDepth(61);
    els.push(bg);
    els.push(this.add.text(cx + W / 2 - 70, top + H - 20, 'Got it →', { fontFamily: 'monospace', fontSize: '13px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(62));
    bg.on('pointerover', () => bg.setFillStyle(0x3d83cf));
    bg.on('pointerout', () => bg.setFillStyle(0x2d6cb0));
    bg.on('pointerdown', (p, lx, ly, ev) => { if (ev) ev.stopPropagation(); els.forEach((o) => o.destroy()); });
  }

  // Tile (c,r) -> on-screen point on the continent map.
  toScreen(c, r) { return { x: MX + (c / N) * MAP_PX, y: MY + (r / N) * MAP_PX }; }
  toTile(px, py) { return { col: Math.floor(((px - MX) / MAP_PX) * N), row: Math.floor(((py - MY) / MAP_PX) * N) }; }

  buildLabels() {
    const mk = (c, r, txt) => {
      const p = this.toScreen(c, r);
      this.labels.add(this.add.text(p.x, p.y, txt, { fontFamily: 'monospace', fontSize: '13px', color: '#e8eef6', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5));
    };
    mk(100, 22, 'Deep Forest');
    mk(178, 100, 'Iron Mountains');
    mk(100, 178, 'River Delta');
    mk(22, 100, 'Western Wildlands');
    mk(100, 100, 'Your Lands');
  }

  rebuildMap() {
    const iso = this.iso;
    if (!iso || !iso.biomeGrid) return;
    const tex = this.textures.get('continentMap') as Phaser.Textures.CanvasTexture;
    const ctx = tex.getContext();
    const img = ctx.createImageData(N, N);
    const data = img.data;
    const castle = iso.buildings.castle;
    const baseR = iso.territory ? iso.territory.baseR() : 8;
    const explored = iso.territory ? iso.territory.explored : null;
    // (Phase 7) Base biome colour, with neighbour blending to soften the hard
    // rectangular biome seams and a cheap positional noise for texture.
    const biomeAt = (c, r) => (c < 0 || r < 0 || c >= N || r >= N) ? null : (iso.terrainType[r][c] === 'water' ? WATER : (BIOME[iso.biomeGrid[r][c]] || BIOME.middle));
    const avg4 = (base, a, b, d, e) => {
      let rr = (base >> 16) & 255, gg = (base >> 8) & 255, bb = base & 255, n = 1;
      for (const x of [a, b, d, e]) { if (x == null) continue; rr += (x >> 16) & 255; gg += (x >> 8) & 255; bb += x & 255; n++; }
      return (Math.round(rr / n) << 16) | (Math.round(gg / n) << 8) | Math.round(bb / n);
    };
    const shade = (col, f) => {
      const rr = Phaser.Math.Clamp(Math.round(((col >> 16) & 255) * (1 + f)), 0, 255);
      const gg = Phaser.Math.Clamp(Math.round(((col >> 8) & 255) * (1 + f)), 0, 255);
      const bb = Phaser.Math.Clamp(Math.round((col & 255) * (1 + f)), 0, 255);
      return (rr << 16) | (gg << 8) | bb;
    };
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        let col = biomeAt(c, r);
        col = blend(col, avg4(col, biomeAt(c - 1, r), biomeAt(c + 1, r), biomeAt(c, r - 1), biomeAt(c, r + 1)), 0.35);
        const hsh = ((c * 73856093) ^ (r * 19349663)) >>> 0;
        col = shade(col, (((hsh % 16) - 8) / 8) * 0.05);
        // Unexplored area is dimmed (the geography is known but unscouted).
        const seen = !explored || explored[r][c] || (castle && Phaser.Math.Distance.Between(c, r, castle.col, castle.row) <= baseR + 16);
        if (!seen) col = blend(col, 0x10141c, 0.66);
        // Territory overlays.
        if (castle && Phaser.Math.Distance.Between(c, r, castle.col, castle.row) <= baseR) col = blend(col, 0x4aa0ff, 0.55);
        else if (iso.settlements && iso.settlements.list.some((s) => s.owner === 'player' && Phaser.Math.Distance.Between(c, r, s.col, s.row) <= 4)) col = blend(col, 0x4aa0ff, 0.5);
        else if (iso.kingdoms) {
          for (const k of iso.kingdoms) { if (k.castleAlive && Phaser.Math.Distance.Between(c, r, k.castleCol, k.castleRow) <= 9) { col = blend(col, k.cfg.color, 0.5); break; } }
        }
        const i = (r * N + c) * 4;
        data[i] = (col >> 16) & 255; data[i + 1] = (col >> 8) & 255; data[i + 2] = col & 255; data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
    this.drawIcons();
    this.updateStats();
  }

  drawIcons() {
    const iso = this.iso;
    const g = this.icons;
    g.clear();
    this.iconText.removeAll(true);
    const explored = iso.territory ? iso.territory.explored : null;
    const isSeen = (c, r) => !explored || (explored[r] && explored[r][c]);

    // (Phase 4 Decision 4) AI castles — faction-coloured circle (8px).
    for (const k of iso.kingdoms || []) {
      if (!k.castleAlive) continue;
      const p = this.toScreen(k.castleCol, k.castleRow);
      g.fillStyle(k.cfg.color, 1).fillCircle(p.x, p.y, 6);
      g.lineStyle(1.5, 0x000000, 0.6).strokeCircle(p.x, p.y, 6);
    }
    // Neutral settlements — white diamond (6px); player-owned — blue circle.
    for (const s of iso.settlements ? iso.settlements.list : []) {
      if (s.owner !== 'player' && !s.discovered) continue;
      const p = this.toScreen(s.col, s.row);
      if (s.owner === 'player') { g.fillStyle(0x4aa0ff, 1).fillCircle(p.x, p.y, 4); g.lineStyle(1, 0xffffff, 0.8).strokeCircle(p.x, p.y, 4); }
      else { g.fillStyle(0xffffff, 1).fillPoints([{ x: p.x, y: p.y - 5 }, { x: p.x + 5, y: p.y }, { x: p.x, y: p.y + 5 }, { x: p.x - 5, y: p.y }], true); g.lineStyle(1, 0x000, 0.5); g.strokePoints([{ x: p.x, y: p.y - 5 }, { x: p.x + 5, y: p.y }, { x: p.x, y: p.y + 5 }, { x: p.x - 5, y: p.y }], true); }
    }
    // Goblin camps — dark red X (6px).
    for (const cmp of iso.goblinCamps ? iso.goblinCamps.list : []) {
      if (!cmp.alive || !cmp.discovered) continue;
      const p = this.toScreen(cmp.col, cmp.row);
      g.lineStyle(2, 0x8a1a1a, 1);
      g.lineBetween(p.x - 4, p.y - 4, p.x + 4, p.y + 4).lineBetween(p.x - 4, p.y + 4, p.x + 4, p.y - 4);
    }
    // (Phase 4 Decision 4) Ancient ruins (discovered) — gray triangle.
    for (const ru of iso.ruins ? iso.ruins.list : []) {
      if (!ru.discovered) continue;
      const p = this.toScreen(ru.col, ru.row);
      g.fillStyle(0x9aa0a6, 1).fillTriangle(p.x, p.y - 5, p.x - 5, p.y + 4, p.x + 5, p.y + 4);
      g.lineStyle(1, 0x000, 0.5).strokeTriangle(p.x, p.y - 5, p.x - 5, p.y + 4, p.x + 5, p.y + 4);
    }
    // Player castle — blue crown.
    const c = iso.buildings.castle;
    if (c) {
      // (Phase 7) Warm-gold outline marking the area shown in the local view.
      const half = 15;
      const a = this.toScreen(c.col - half, c.row - half);
      const b = this.toScreen(c.col + half, c.row + half);
      g.lineStyle(2, 0xe6c87a, 0.85);
      g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      this.iconText.add(this.add.text((a.x + b.x) / 2, a.y - 4, 'local view', { fontFamily: 'monospace', fontSize: '11px', color: '#ffe9b0', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 1));
      const p = this.toScreen(c.col, c.row);
      // (Phase 4 Decision 4) Player castle — gold star.
      this.iconText.add(this.add.text(p.x, p.y, '★', { fontFamily: 'monospace', fontSize: '16px', color: '#ffd24a', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(5));
    }
    // (Phase 2) Armies on the map — arrow dots in faction colour.
    if (iso.armyMgr) {
      const FC: Record<string, number> = { player: 0x3a7bd5, red: 0xd64a4a, purple: 0xa45ad6, yellow: 0xd6c04a };
      for (const a of iso.armyMgr.armies) {
        const p = this.toScreen(a.col, a.row);
        const col = FC[a.faction] || 0x888888;
        g.fillStyle(col, 1).fillTriangle(p.x, p.y - 6, p.x - 5, p.y + 5, p.x + 5, p.y + 5);
        g.lineStyle(1, 0xffffff, 0.8).strokeTriangle(p.x, p.y - 6, p.x - 5, p.y + 5, p.x + 5, p.y + 5);
      }
    }
    // (Session-1 Phase 2) Wandering factions — caravans (brown), tribes (orange), pilgrims (white).
    if (iso.factions && iso.factions.continentDots) {
      for (const d of iso.factions.continentDots()) {
        const p = this.toScreen(d.col, d.row);
        g.fillStyle(d.color, 1).fillCircle(p.x, p.y, 3);
        g.lineStyle(1, 0x000000, 0.5).strokeCircle(p.x, p.y, 3);
      }
    }
    // Player army (centroid of troops) — blue dot, if any in the field.
    const units = iso.troops ? iso.troops.allUnits() : [];
    if (units.length) {
      let sc = 0, sr = 0;
      for (const u of units) { const t = iso.screenToTile(u.x, u.y); sc += t.col; sr += t.row; }
      const p = this.toScreen(sc / units.length, sr / units.length);
      g.fillStyle(0x66ddff, 1).fillCircle(p.x, p.y, 3);
    }
    // AI armies (live attack waves) — colored dots.
    for (const e of iso.waves ? iso.waves.enemies : []) {
      if (!e.alive) continue;
      const t = iso.screenToTile((e.rect || e.spr).x, (e.rect || e.spr).y);
      const col = e.faction ? e.faction.cfg.color : 0xff3333;
      const p = this.toScreen(t.col, t.row);
      g.fillStyle(col, 1).fillCircle(p.x, p.y, 2);
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
      `Day ${iso.gameDay} — ${season}`,
      `Your Kingdom: ${pct}% of continent`,
      `Settlements: ${owned}/${total}`,
      `Threats: ${hostile} kingdom${hostile === 1 ? '' : 's'} hostile, ${camps} goblin camps active`,
    ].join('\n'));
    const r = iso.resources;
    this.resText.setText([
      `Wood ${Math.floor(r.wood)}   Stone ${Math.floor(r.stone)}`,
      `Food ${Math.floor(r.food)}   Gold ${Math.floor(r.gold)}`,
      `Iron ${Math.floor(r.iron)}`,
    ].join('\n'));
  }

  // Hover tooltip over settlements / camps.
  onHover(p) {
    const iso = this.iso;
    let hit = null;
    for (const s of iso.settlements ? iso.settlements.list : []) {
      if (s.owner !== 'player' && !s.discovered) continue;
      const sp = this.toScreen(s.col, s.row);
      if (Phaser.Math.Distance.Between(p.x, p.y, sp.x, sp.y) < 8) { hit = { x: sp.x, y: sp.y, txt: `${s.name} — ${s.owner === 'player' ? 'Yours' : 'Neutral'} · ${s.note}` }; break; }
    }
    if (hit) this.tip.setText(hit.txt).setPosition(hit.x, hit.y - 10).setVisible(true);
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

  // (Bug 3) Normal close: fade out, then hand back to the world. A fallback timer
  // guarantees the hand-off even if the fade-complete event never fires, so the
  // player can never get stuck on a faded continent screen.
  close(focus?: any) {
    if (this._closing) return;
    this._closing = true;
    this._focus = focus || null;
    const finish = () => this.finishClose();
    try {
      this.cameras.main.fadeOut(180, 8, 12, 18);
      this.cameras.main.once('camerafadeoutcomplete', finish);
      this.time.delayedCall(500, finish); // fallback if the event is missed
    } catch (e) {
      finish(); // if the fade itself throws, hand back immediately
    }
  }

  // (Bug 3) Guaranteed escape hatch (Escape key): instant, ignores the _closing
  // guard and the fade entirely.
  forceClose() {
    this._closing = true;
    this.finishClose();
  }

  // (Bug 3) The single, idempotent hand-back to IsometricScene. Wrapped so a
  // failure in any one step still resumes + stops the scene.
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
