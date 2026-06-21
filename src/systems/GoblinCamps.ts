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
  scene: any;
  col: number;
  row: number;
  x: number;
  y: number;
  huts: any[];
  guards: any[];
  discovered: boolean;
  respawnTimer: number;
  [key: string]: any;

  constructor(scene: any, def: any) {
    this.scene = scene;
    this.col = def.col;
    this.row = def.row;
    this.discovered = false;
    this.respawnTimer = 0;
    this.tier = 1;       // (V2 Phase 10) 1 camp → 2 large camp → 3 fortress
    this._ageDays = 0;
    const { x, y } = scene.tileCenter(def.col, def.row);
    this.x = x;
    this.y = y;
    this.huts = [];
    this.guards = [];
    this.build();
  }

  get alive() { return this.guards.some((g) => g.alive); }
  get tierName() { return ['', 'Goblin Camp', 'Large Goblin Camp', 'Goblin Fortress'][this.tier] || 'Goblin Camp'; }

  build() {
    const s = this.scene;
    this.huts = [];
    const huts = Phaser.Math.Between(3, 4) + (this.tier - 1) * 2; // (V2 P10) bigger camps have more huts
    const hutTint = this.tier >= 3 ? 0x2a3424 : 0x3a4a32;
    for (let i = 0; i < huts; i++) {
      const a = (i / huts) * Math.PI * 2;
      const r = i === 0 ? 0 : (18 + this.tier * 6) + Math.random() * 8;
      this.huts.push(s.add.image(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r * 0.6, 'house').setOrigin(0.5, 1.0).setScale(0.6 + (this.tier - 1) * 0.12).setTint(hutTint));
    }
    this.guards = [];
    const n = Phaser.Math.Between(4, 6) + (this.tier - 1) * 3; // (V2 P10) larger garrison per tier
    for (let i = 0; i < n; i++) this.guards.push(new Defender(s, this.x + Phaser.Math.Between(-22, 22), this.y + Phaser.Math.Between(4, 18), 30 + (this.tier - 1) * 10, 'goblin_idle', this.tier >= 3 ? 0x9c6cff : 0x6cff8a));
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

  // (V2 Phase 10) Left alone, a camp grows: camp → large camp → fortress.
  onNewDay() {
    if (this._cleared || !this.alive) return;
    this._ageDays += 1;
    const need = this.tier * 25; // 25 days to become large, 50 to become a fortress
    if (this.tier < 3 && this._ageDays >= need) { this.expand(); }
  }

  expand() {
    this.tier += 1;
    this._ageDays = 0;
    // Rebuild bigger in place (preserves position, raises garrison/huts/tint).
    for (const h of this.huts) h.destroy();
    if (this.flag) { this.flag.destroy(); this.flag = null; }
    for (const g of this.guards) if (g.destroy) g.destroy();
    this.build();
    const s = this.scene;
    if (s.threatWarning) s.threatWarning(`A goblin camp has grown into a ${this.tierName}!`, 0x6cff8a, true);
    if (s.logEvent) s.logEvent(`Left unchecked, goblins raised a ${this.tierName}`, 'orange');
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
    const bonus = (this.tier - 1) * 30;
    const gold = Phaser.Math.Between(30, 50) + bonus;
    s.resources.add('gold', gold);
    s.resources.add('iron', 20 + (this.tier - 1) * 15);
    if (s.floatText) s.floatText(this.x, this.y - 30, `${this.tierName} cleared! +${gold} Gold`, '#ffd23f');
    this.tier = 1; this._ageDays = 0; // razed back to nothing; respawns as a small camp
  }

  applyDepths(D, BODY, BARB, BARF) {
    for (const h of this.huts) h.setDepth(D(h.y) + BODY);
    for (const g of this.guards) { g.spr.setDepth(D(g.y) + 0.008); g.hpBarBg.setDepth(D(g.y) + BARB); g.hpBarFill.setDepth(D(g.y) + BARF); }
  }
}

export class GoblinCampManager {
  scene: any;
  list: any[];
  [key: string]: any;

  constructor(scene: any) {
    this.scene = scene;
    this.list = CAMP_DEFS.map((d) => new GoblinCamp(scene, d));
  }
  aliveCount() { return this.list.filter((c) => c.alive).length; }

  threats() {
    const out: any[] = [];
    for (const c of this.list) if (c.alive) for (const g of c.guards) if (g.alive) out.push(g);
    return out;
  }

  nearestAliveTo(col, row) {
    let best = null, bd = Infinity;
    for (const c of this.list) { if (!c.alive) continue; const d = Phaser.Math.Distance.Between(col, row, c.col, c.row); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  update(dt) { for (const c of this.list) c.update(dt); }
  onNewDay() { for (const c of this.list) c.onNewDay(); } // (V2 Phase 10) camps expand over time
  applyDepths(D, BODY, BARB, BARF) { for (const c of this.list) c.applyDepths(D, BODY, BARB, BARF); }

  serialize() { return this.list.map((c) => ({ tier: c.tier, age: c._ageDays })); }
  restore(d: any) {
    if (!Array.isArray(d)) return;
    d.forEach((e, i) => {
      const c = this.list[i]; if (!c) return;
      c.tier = e.tier || 1; c._ageDays = e.age || 0;
      if (c.tier > 1 && !c._cleared) { // rebuild visuals at the saved tier
        for (const h of c.huts) h.destroy(); if (c.flag) { c.flag.destroy(); c.flag = null; } for (const g of c.guards) if (g.destroy) g.destroy();
        c.build();
      }
    });
  }
}
