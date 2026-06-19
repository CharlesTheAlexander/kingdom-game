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

const BIOME = {
  start: 0x86c186, middle: 0x7cb06a, forest: 0x356b35, mountains: 0x9b8d77,
  delta: 0xa9d98a, wildlands: 0x8c8a4a,
};
const WATER = 0x3f86c6;

function blend(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

export class ContinentScene extends Phaser.Scene {
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
    this.iconText = this.add.container(0, 0);
    this.labels = this.add.container(0, 0);
    this.buildLabels();

    // ---- UI ----
    this.add.text(GAME_W / 2, 10, 'CONTINENT', { fontFamily: 'monospace', fontSize: '20px', color: '#dfe6ee', fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.statsText = this.add.text(16, 40, '', { fontFamily: 'monospace', fontSize: '12px', color: '#b9c6d6', lineSpacing: 3 });
    this.resText = this.add.text(GAME_W - 16, 40, '', { fontFamily: 'monospace', fontSize: '12px', color: '#e3c27a', align: 'right', lineSpacing: 3 }).setOrigin(1, 0);
    this.tip = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff', backgroundColor: '#000000cc', padding: { x: 6, y: 4 } }).setOrigin(0.5, 1).setDepth(50).setVisible(false);

    const btn = this.add.rectangle(GAME_W / 2, GAME_H - 34, 220, 40, 0x2d6cb0).setStrokeStyle(2, 0xf0e6c8, 0.8).setInteractive({ useHandCursor: true });
    this.add.text(GAME_W / 2, GAME_H - 34, 'Return to Kingdom  (Tab)', { fontFamily: 'monospace', fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
    btn.on('pointerover', () => btn.setFillStyle(0x3d83cf));
    btn.on('pointerout', () => btn.setFillStyle(0x2d6cb0));
    btn.on('pointerdown', () => this.close());

    this.input.keyboard.on('keydown-TAB', (e) => { e.preventDefault(); this.close(); });
    this.input.on('pointermove', (p) => this.onHover(p));
    this.input.on('pointerdown', (p) => this.onClick(p));

    this.rebuildMap();
    this.cameras.main.fadeIn(220, 12, 16, 24);

    // Mark which tiles the local fog has revealed (for hiding undiscovered sites).
    this._refresh = 0;
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
    const tex = this.textures.get('continentMap');
    const ctx = tex.getContext();
    const img = ctx.createImageData(N, N);
    const data = img.data;
    const castle = iso.buildings.castle;
    const baseR = iso.territory ? iso.territory.baseR() : 8;
    const explored = iso.territory ? iso.territory.explored : null;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        let col = iso.terrainType[r][c] === 'water' ? WATER : (BIOME[iso.biomeGrid[r][c]] || BIOME.middle);
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

    // AI kingdom castles (faction-coloured crowns).
    for (const k of iso.kingdoms || []) {
      if (!k.castleAlive) continue;
      const p = this.toScreen(k.castleCol, k.castleRow);
      g.fillStyle(k.cfg.color, 1).fillTriangle(p.x - 6, p.y + 5, p.x + 6, p.y + 5, p.x, p.y - 7);
      g.lineStyle(1.5, 0x000000, 0.6).strokeTriangle(p.x - 6, p.y + 5, p.x + 6, p.y + 5, p.x, p.y - 7);
    }
    // Neutral / conquered settlements (only if discovered).
    for (const s of iso.settlements ? iso.settlements.list : []) {
      if (s.owner !== 'player' && !s.discovered) continue;
      const p = this.toScreen(s.col, s.row);
      if (s.owner === 'player') { g.fillStyle(0x4aa0ff, 1).fillCircle(p.x, p.y, 4); g.lineStyle(1, 0xffffff, 0.8).strokeCircle(p.x, p.y, 4); }
      else { g.fillStyle(0xb9bec6, 1).fillRect(p.x - 3, p.y - 3, 6, 6); g.lineStyle(1, 0x000, 0.6).strokeRect(p.x - 3, p.y - 3, 6, 6); }
    }
    // Goblin camps (discovered, still active) — small red X.
    for (const cmp of iso.goblinCamps ? iso.goblinCamps.list : []) {
      if (!cmp.alive || !cmp.discovered) continue;
      const p = this.toScreen(cmp.col, cmp.row);
      g.lineStyle(2, 0xff5252, 1);
      g.lineBetween(p.x - 4, p.y - 4, p.x + 4, p.y + 4).lineBetween(p.x - 4, p.y + 4, p.x + 4, p.y - 4);
    }
    // Player castle — blue crown.
    const c = iso.buildings.castle;
    if (c) {
      const p = this.toScreen(c.col, c.row);
      g.fillStyle(0x2aa0ff, 1).fillTriangle(p.x - 8, p.y + 6, p.x + 8, p.y + 6, p.x, p.y - 9);
      g.lineStyle(2, 0xffffff, 0.9).strokeTriangle(p.x - 8, p.y + 6, p.x + 8, p.y + 6, p.x, p.y - 9);
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

  close(focus) {
    const iso = this.iso;
    if (focus) { const w = iso.tileCenter(focus.col, focus.row); iso.cameras.main.centerOn(w.x, w.y); }
    this.scene.resume('IsometricScene');
    this.scene.stop();
  }

  update(time, delta) {
    this._refresh += delta;
    if (this._refresh >= 500) { this._refresh = 0; this.rebuildMap(); } // keep armies / territory fresh
  }
}
