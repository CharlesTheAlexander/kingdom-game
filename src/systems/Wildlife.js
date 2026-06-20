import Phaser from 'phaser';
import { sfx } from '../audio/SoundEngine.js';

// Wildlife threat system (Phase 2). A layered, low-intensity danger that exists
// from day 1 — separate from the AI kingdom waves (which only start on day 3).
//
//   WOLVES  — roam the north forest in packs; chase worker pawns within 3 tiles,
//             scaring them home and stealing 1 Wood/Meat. Drop 5 Meat.
//   GOBLINS — raid from the west every 2 days; drain resource nodes (2x at the
//             node), or smash buildings if no node is near. Party drops 10-20 Gold.
//   BOARS   — wander the southern plains; eat 5 from a sheep (food) node on
//             contact. Not aggressive to units. Drop 15 Meat.
//
// Every beast conforms to the "enemy interface" used by Troops/Towers/Waves
// (x, y, alive, takeDamage(amount), destroy()) so the player kills them with the
// exact same combat code that fights the AI — but they are kept in their own
// list (scene.wildlife.units), never in scene.waves.enemies, so destroying an AI
// castle does not clear them and vice-versa.

const MAX_WILDLIFE = 20;       // (Phase B) the map is 25x bigger
// Wolf tuning.
const MAX_WOLVES = 8;          // wolves on the map at once
const WOLF_CHASE_TILES = 5;    // max chase range
const NORTH_ROW = 50;          // a unit at row < 50 counts as "in the deep forest"
const WOLF_MIN_DIST = 12;      // min tiles from the player castle for a wolf spawn
const GOBLIN_MIN_DIST = 8;     // min tiles from the player castle for a goblin spawn

// ---- Shared base ----------------------------------------------------------
class Beast {
  constructor(scene, x, y, cfg) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.cfg = cfg;
    this.maxHp = cfg.hp;
    this.hp = cfg.hp;
    this.alive = true;
    this.kind = cfg.kind;
    this.noWarriorMelee = true; // wildlife harasses economy, not warriors directly
    this.spr = scene.add.sprite(x, y, cfg.tex, 0).setScale(cfg.px / 192).setDepth(8);
    if (cfg.tint) this.spr.setTint(cfg.tint);
    if (cfg.anim && scene.anims.exists(cfg.anim)) this.spr.play(cfg.anim);
    this._barW = Math.max(20, cfg.px - 4);
    this.hpBarBg = scene.add.rectangle(x, y - cfg.px * 0.55, this._barW + 2, 5, 0x000000, 0.7).setDepth(9);
    this.hpBarFill = scene.add.rectangle(x - this._barW / 2, y - cfg.px * 0.55, this._barW, 3, 0xff7043).setOrigin(0, 0.5).setDepth(10);
  }

  // Distance in gameplay tiles (TILE px).
  tilesTo(x, y) {
    return Phaser.Math.Distance.Between(this.x, this.y, x, y) / this.scene.TILE;
  }

  moveToward(tx, ty, speed, dt) {
    const ang = Math.atan2(ty - this.y, tx - this.x);
    this.x += Math.cos(ang) * speed * dt;
    this.y += Math.sin(ang) * speed * dt;
    this.spr.setFlipX(tx < this.x);
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    const pct = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    this.hpBarFill.width = this._barW * pct;
    // (Phase 7) brief red flash when hit.
    this.spr.setTintFill(0xff3333);
    this.scene.time.delayedCall(70, () => { if (this.alive) { if (this.cfg.tint) this.spr.setTint(this.cfg.tint); else this.spr.clearTint(); } });
    if (this.hp <= 0) this.killedByPlayer();
  }

  // Died to player combat → drop loot.
  killedByPlayer() {
    const c = this.cfg;
    if (c.dropType) {
      const amt = Array.isArray(c.dropAmt) ? Phaser.Math.Between(c.dropAmt[0], c.dropAmt[1]) : c.dropAmt;
      this.scene.resources.add(c.dropType, amt);
      const label = c.dropType[0].toUpperCase() + c.dropType.slice(1);
      this.scene.floatText(this.x, this.y - 16, `+${amt} ${label}`, '#ffe066');
    }
    this.destroy();
  }

  syncBar() {
    this.spr.x = this.x;
    this.spr.y = this.y;
    const oy = this.cfg.px * 0.55;
    this.hpBarBg.x = this.x;
    this.hpBarBg.y = this.y - oy;
    this.hpBarFill.x = this.x - this._barW / 2;
    this.hpBarFill.y = this.y - oy;
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    if (this.scene.dustAt) this.scene.dustAt(this.x, this.y);
    this.hpBarBg.destroy();
    this.hpBarFill.destroy();
    // (Phase 7) 0.45s fade-out on death.
    if (this.cfg.tint) this.spr.setTint(this.cfg.tint); else this.spr.clearTint();
    this.scene.tweens.add({ targets: this.spr, alpha: 0, scale: this.spr.scale * 0.8, duration: 450, onComplete: () => this.spr.destroy() });
  }

  // Pick a random wander point inside one of the given regions.
  wanderPoint(regions) {
    const s = this.scene;
    for (let a = 0; a < 30; a++) {
      const col = Phaser.Math.Between(0, s.COLS - 1);
      const row = Phaser.Math.Between(0, s.ROWS - 1);
      if (!regions.includes(s.regionAt(col, row))) continue;
      if (s.terrainType && s.terrainType[row][col] === 'water') continue;
      const t = s.tileCenter(col, row);
      return { x: t.x, y: t.y };
    }
    return { x: this.x + Phaser.Math.Between(-60, 60), y: this.y + Phaser.Math.Between(-60, 60) };
  }
}

// ---- Wolf -----------------------------------------------------------------
class Wolf extends Beast {
  constructor(scene, x, y) {
    super(scene, x, y, { kind: 'wolf', tex: 'warrior_idle', anim: 'warrior_idle', px: 28, tint: 0xff6b6b, hp: 20, dropType: 'meat', dropAmt: 5 });
    this.speed = 26;
    this.chaseSpeed = 64;
    this.goal = this.wanderPoint(['north']);
    this.target = null;
    this.biteCd = 0;
  }

  // (FIX 2) Wolves only chase pawns that venture into the north zone (rows
  // <= 11), within a 5-tile range — they never path to the settlement centre.
  inNorth(obj) {
    return this.scene.screenToTile(obj.x, obj.y).row <= NORTH_ROW;
  }

  update(dt) {
    if (!this.alive) return;
    this.biteCd = Math.max(0, this.biteCd - dt);
    const pawns = this.scene.pawns.pawns;
    if (!this.target || !pawns.includes(this.target)) {
      let best = null, bd = WOLF_CHASE_TILES;
      for (const p of pawns) {
        if (!this.inNorth(p)) continue; // only pawns inside the north zone
        const d = this.tilesTo(p.x, p.y);
        if (d < bd) { bd = d; best = p; }
      }
      this.target = best;
    }
    if (this.target) {
      const d = this.tilesTo(this.target.x, this.target.y);
      if (d > WOLF_CHASE_TILES || !this.inNorth(this.target)) {
        this.target = null; // escaped 5 tiles away or left the north zone — return to roam
      } else if (d > 0.5) {
        this.moveToward(this.target.x, this.target.y, this.chaseSpeed, dt);
      } else if (this.biteCd <= 0) {
        this.biteCd = 2.5;
        this.scene.wolfCatchPawn(this.target); // pawn flees + 1 resource stolen
        this.target = null;
        this.goal = this.wanderPoint(['north']);
      }
      this.syncBar();
      return;
    }
    // Roam slowly within the north forest.
    if (Phaser.Math.Distance.Between(this.x, this.y, this.goal.x, this.goal.y) < 8) this.goal = this.wanderPoint(['north']);
    this.moveToward(this.goal.x, this.goal.y, this.speed, dt);
    this.syncBar();
  }
}

// ---- Goblin ---------------------------------------------------------------
class Goblin extends Beast {
  constructor(scene, x, y, party) {
    super(scene, x, y, { kind: 'goblin', tex: 'goblin_idle', anim: 'goblin_idle', px: 24, tint: 0x6cff8a, hp: 15 });
    this.party = party; // shared party object for the gold reward
    this.speed = 40;
    this.targetNode = null;
    this.targetBuilding = null;
    this.drainAcc = 0;
  }

  pickTarget() {
    const s = this.scene;
    // Resource nodes first — but nodes inside your territory are raid-safe, so
    // goblins go after exposed nodes (and only smash buildings once they've
    // breached, which the auto-defending warriors usually punish).
    let best = null, bd = Infinity;
    for (const n of s.nodes.nodes) {
      if (!n.alive) continue;
      if (s.territory && s.territory.nodeProtected(n)) continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, n.x, n.y);
      if (d < bd) { bd = d; best = n; }
    }
    if (best) { this.targetNode = best; this.targetBuilding = null; return; }
    // Otherwise the nearest player building.
    let bb = null, bbd = Infinity;
    for (const b of s.buildings.buildings) {
      if (!b.alive) continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, b.x, b.y);
      if (d < bbd) { bbd = d; bb = b; }
    }
    this.targetBuilding = bb;
    this.targetNode = null;
  }

  update(dt) {
    if (!this.alive) return;
    if ((!this.targetNode || !this.targetNode.alive) && (!this.targetBuilding || !this.targetBuilding.alive)) this.pickTarget();

    const tgt = (this.targetNode && this.targetNode.alive) ? this.targetNode : (this.targetBuilding && this.targetBuilding.alive ? this.targetBuilding : null);
    if (!tgt) { this.syncBar(); return; }

    const d = Phaser.Math.Distance.Between(this.x, this.y, tgt.x, tgt.y);
    if (d > this.scene.TILE * 0.7) {
      this.moveToward(tgt.x, tgt.y, this.speed, dt);
    } else if (this.targetNode) {
      // Drain the node at 2x speed (6 / sec) while standing on it.
      this.drainAcc += 6 * dt;
      while (this.drainAcc >= 1 && this.targetNode.alive) { this.drainAcc -= 1; this.targetNode.harvest(); }
    } else if (this.targetBuilding) {
      this.targetBuilding.takeDamage(8 * dt); // 8 dmg/sec to buildings
    }
    this.syncBar();
  }
}

// ---- Boar -----------------------------------------------------------------
class Boar extends Beast {
  constructor(scene, x, y) {
    super(scene, x, y, { kind: 'boar', tex: 'boar_idle', anim: 'boar_idle', px: 30, tint: 0x9c6b3f, hp: 30, dropType: 'meat', dropAmt: 15 });
    this.speed = 20;
    this.goal = null;
    this.eatCd = 0;
  }

  nearestFoodNode() {
    let best = null, bd = Infinity;
    for (const n of this.scene.nodes.nodes) {
      if (!n.alive || n.type !== 'food') continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, n.x, n.y);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  update(dt) {
    if (!this.alive) return;
    this.eatCd = Math.max(0, this.eatCd - dt);
    const node = this.nearestFoodNode();
    if (node) {
      const d = Phaser.Math.Distance.Between(this.x, this.y, node.x, node.y);
      if (d > this.scene.TILE * 0.7) this.moveToward(node.x, node.y, this.speed, dt);
      else if (this.eatCd <= 0) {
        this.eatCd = 3;
        for (let i = 0; i < 5 && node.alive; i++) node.harvest(); // eats 5 sheep at once
        this.scene.floatText(node.x, node.y - 20, 'Boar ate the sheep!', '#ffab91');
      }
      this.syncBar();
      return;
    }
    // No sheep left → amble around the southern plains.
    if (!this.goal || Phaser.Math.Distance.Between(this.x, this.y, this.goal.x, this.goal.y) < 8) this.goal = this.wanderPoint(['south', 'plain']);
    this.moveToward(this.goal.x, this.goal.y, this.speed, dt);
    this.syncBar();
  }
}

// ---- Manager --------------------------------------------------------------
export class WildlifeManager {
  constructor(scene) {
    this.scene = scene;
    this.units = [];
    this.goblinParties = [];
    this._lastWolfDay = 1;
    this._lastBoarDay = 1;
    this._lastGobDay = 0;
  }

  count() { return this.units.length; }
  wolfCount() { return this.units.reduce((n, u) => n + (u.kind === 'wolf' ? 1 : 0), 0); }

  // Spawn a starting wolf pack + a boar so the world feels alive on day 1.
  spawnInitial() {
    this.spawnWolfPack();
    this.spawnBoar();
  }

  // Pick a scatter point inside one of the given regions (returns world coords).
  // opts.rowMax caps the tile row; opts.minTiles enforces a minimum distance
  // from the player castle (so threats never spawn on top of the settlement).
  regionPoint(regions, opts = {}) {
    const s = this.scene;
    const castle = s.buildings.castle;
    for (let a = 0; a < 90; a++) {
      const col = Phaser.Math.Between(0, s.COLS - 1);
      const row = Phaser.Math.Between(0, s.ROWS - 1);
      if (opts.rowMax != null && row > opts.rowMax) continue;
      if (!regions.includes(s.regionAt(col, row))) continue;
      if (s.terrainType && s.terrainType[row][col] === 'water') continue;
      if (opts.minTiles && castle && Phaser.Math.Distance.Between(col, row, castle.col, castle.row) < opts.minTiles) continue;
      const t = s.tileCenter(col, row);
      return { x: t.x + Phaser.Math.Between(-12, 12), y: t.y + Phaser.Math.Between(-12, 12) };
    }
    return null;
  }

  // (FIX 2) Wolves spawn only in the north forest (rows 0-10), >= 12 tiles from
  // the castle, capped at 4 on the map.
  spawnWolfPack() {
    if (this.wolfCount() >= MAX_WOLVES) return;
    const p = this.regionPoint(['north'], { rowMax: 49, minTiles: WOLF_MIN_DIST });
    if (!p) return;
    const n = Phaser.Math.Between(2, 3);
    for (let i = 0; i < n && this.wolfCount() < MAX_WOLVES && this.count() < MAX_WILDLIFE; i++) {
      this.units.push(new Wolf(this.scene, p.x + Phaser.Math.Between(-30, 30), p.y + Phaser.Math.Between(-20, 20)));
    }
    sfx.play('wolf_spawn'); // (Polish Phase 2)
    this.scene.threatWarning('⚠ Wolves spotted prowling the northern forest', 0xff8a80);
  }

  spawnGoblinRaid() {
    // (Phase B) Raids set out from the goblin camp nearest your territory.
    let p = null;
    const castle = this.scene.buildings.castle;
    if (this.scene.goblinCamps && castle) {
      const camp = this.scene.goblinCamps.nearestAliveTo(castle.col, castle.row);
      if (camp) p = { x: camp.x + Phaser.Math.Between(-20, 20), y: camp.y + Phaser.Math.Between(-20, 20) };
    }
    if (!p) p = this.regionPoint(['west'], { minTiles: GOBLIN_MIN_DIST });
    if (!p) return;
    const party = { rewarded: false, members: [] };
    const n = Phaser.Math.Between(3, 5);
    for (let i = 0; i < n && this.count() < MAX_WILDLIFE; i++) {
      const g = new Goblin(this.scene, p.x + Phaser.Math.Between(-24, 24), p.y + Phaser.Math.Between(-24, 24), party);
      party.members.push(g);
      this.units.push(g);
    }
    if (party.members.length) {
      this.goblinParties.push(party);
      sfx.play('goblin_raid'); // (Polish Phase 2)
      this.scene.threatWarning('⚠ Goblin raid incoming from the West!', 0x6cff8a);
    }
  }

  spawnBoar() {
    const p = this.regionPoint(['south']);
    if (!p || this.count() >= MAX_WILDLIFE) return;
    this.units.push(new Boar(this.scene, p.x, p.y));
  }

  update(dt) {
    const day = this.scene.gameDay;
    if (day - this._lastWolfDay >= 4 && this.wolfCount() < MAX_WOLVES) { this._lastWolfDay = day; this.spawnWolfPack(); } // (FIX 2) every 4 days, max 4
    if (day >= 2 && day - this._lastGobDay >= 2 && this.count() < MAX_WILDLIFE) { this._lastGobDay = day; this.spawnGoblinRaid(); }
    if (day - this._lastBoarDay >= 2 && this.count() < MAX_WILDLIFE) { this._lastBoarDay = day; this.spawnBoar(); }

    for (const u of this.units) u.update(dt);

    // Award the gold reward once a whole goblin party is wiped out.
    for (const party of this.goblinParties) {
      if (party.rewarded) continue;
      if (party.members.every((g) => !g.alive)) {
        party.rewarded = true;
        const gold = Phaser.Math.Between(10, 20);
        this.scene.resources.add('gold', gold);
        const c = this.scene.buildings.castle;
        if (c) this.scene.floatText(c.x, c.y - 50, `Goblin raid repelled! +${gold} Gold`, '#ffd23f');
      }
    }
    this.goblinParties = this.goblinParties.filter((p) => !p.rewarded);
    this.units = this.units.filter((u) => u.alive);
  }
}
