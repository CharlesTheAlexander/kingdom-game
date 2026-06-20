import Phaser from 'phaser';
import { Defender } from './Settlements.js';

// Goblin camps at fixed locations — mostly in the western wildlands, a few
// hidden in the northern deep forest (Phase B). Each is a cluster of small huts
// guarded by goblins (real enemy-interface defenders) and is the source of the
// goblin raids that harry your territory. Clear a camp by marching troops in for
// 30-50 gold + 20 iron; cleared camps respawn after 5 game days.

const CAMP_DEFS = [
  { col: 20, row: 70 }, { col: 30, row: 110 }, { col: 15, row: 140 },
  { col: 40, row: 92 }, { col: 25, row: 158 }, { col: 36, row: 42 }, // western wildlands
  { col: 90, row: 24 }, { col: 122, row: 34 }, { col: 70, row: 30 },  // deep forest
];
const RESPAWN_DAYS = 5;

class GoblinCamp {
  constructor(scene, def) {
    this.scene = scene;
    this.col = def.col;
    this.row = def.row;
    this.discovered = false;
    this.respawnTimer = 0;
    const { x, y } = scene.tileCenter(def.col, def.row);
    this.x = x;
    this.y = y;
    this.huts = [];
    this.guards = [];
    this.build();
  }

  get alive() { return this.guards.some((g) => g.alive); }

  build() {
    const s = this.scene;
    this.huts = [];
    const huts = Phaser.Math.Between(3, 4);
    for (let i = 0; i < huts; i++) {
      const a = (i / huts) * Math.PI * 2;
      const r = i === 0 ? 0 : 18 + Math.random() * 8;
      this.huts.push(s.add.image(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r * 0.6, 'house').setOrigin(0.5, 1.0).setScale(0.6).setTint(0x3a4a32));
    }
    this.guards = [];
    const n = Phaser.Math.Between(4, 6);
    for (let i = 0; i < n; i++) this.guards.push(new Defender(s, this.x + Phaser.Math.Between(-22, 22), this.y + Phaser.Math.Between(4, 18), 30, 'goblin_idle', 0x6cff8a));
    // (Phase 8) A red banner above the camp so it reads clearly on the map.
    if (this.rubble) { this.rubble.destroy(); this.rubble = null; }
    this.flag = s.add.graphics();
    this.flag.fillStyle(0x5a3a1a, 1).fillRect(this.x - 1, this.y - 30, 2, 22); // pole
    this.flag.fillStyle(0xcc2222, 1).fillTriangle(this.x + 1, this.y - 30, this.x + 1, this.y - 20, this.x + 12, this.y - 25); // pennant
    this.flag.setDepth(s.worldDepth ? s.worldDepth(this.y) + 0.02 : 9);
    this._cleared = false;
  }

  aliveGuards() { return this.guards.filter((g) => g.alive); }

  update(dt) {
    const s = this.scene;
    if (this._cleared) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.build();
      return;
    }
    this.guards = this.guards.filter((g) => g.alive);
    if (!this.discovered) {
      const t = s.screenToTile(this.x, this.y);
      if (s.territory && s.territory.explored[t.row] && s.territory.explored[t.row][t.col]) this.discovered = true;
    }
    if (this.guards.length === 0) this.clear();
  }

  clear() {
    const s = this.scene;
    this._cleared = true;
    this.respawnTimer = RESPAWN_DAYS * (s.DAY_SECONDS || 300);
    for (const h of this.huts) { if (s.explosionAt) s.explosionAt(h.x, h.y); h.destroy(); }
    this.huts = [];
    if (this.flag) { this.flag.destroy(); this.flag = null; }
    // (Phase 8) Leave ash/rubble remains where the camp stood.
    this.rubble = s.add.ellipse(this.x, this.y, 34, 18, 0x2a2620, 0.7).setDepth(s.worldDepth ? s.worldDepth(this.y) - 0.001 : 3);
    const gold = Phaser.Math.Between(30, 50);
    s.resources.add('gold', gold);
    s.resources.add('iron', 20);
    if (s.floatText) s.floatText(this.x, this.y - 30, `Goblin camp cleared! +${gold} Gold +20 Iron`, '#ffd23f');
  }

  applyDepths(D, BODY, BARB, BARF) {
    for (const h of this.huts) h.setDepth(D(h.y) + BODY);
    for (const g of this.guards) { g.spr.setDepth(D(g.y) + 0.008); g.hpBarBg.setDepth(D(g.y) + BARB); g.hpBarFill.setDepth(D(g.y) + BARF); }
  }
}

export class GoblinCampManager {
  constructor(scene) {
    this.scene = scene;
    this.list = CAMP_DEFS.map((d) => new GoblinCamp(scene, d));
  }
  aliveCount() { return this.list.filter((c) => c.alive).length; }

  threats() {
    const out = [];
    for (const c of this.list) if (c.alive) for (const g of c.guards) if (g.alive) out.push(g);
    return out;
  }

  nearestAliveTo(col, row) {
    let best = null, bd = Infinity;
    for (const c of this.list) { if (!c.alive) continue; const d = Phaser.Math.Distance.Between(col, row, c.col, c.row); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  update(dt) { for (const c of this.list) c.update(dt); }
  applyDepths(D, BODY, BARB, BARF) { for (const c of this.list) c.applyDepths(D, BODY, BARB, BARF); }
}
