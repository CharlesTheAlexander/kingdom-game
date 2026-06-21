import { sfx } from '../audio/SoundEngine.js';
// (V2 Phase 6) Building Aging + Disasters.
//
// Aging: every 20 days each building loses one condition level (Perfect → Good
// → Weathered → Damaged → Ruined) unless a staffed Mason's Lodge covers it.
// Masons also slowly repair covered buildings. Output penalties live on the
// Building itself (condMult), this manager only drives the condition changes.
//
// Disasters: Fire (spreads, destroys in 2 days), Plague (workforce penalty),
// Flood (warns, then damages riverside farms), and a rare late-game Dragon
// (slain by a champion hero or Siege Workshop, else it ravages buildings).

export class Maintenance {
  scene: any;
  [key: string]: any;

  constructor(scene: any) {
    this.scene = scene;
    this._lastAge = 0;
    this._calmUntil = 0;
    this.fires = [];
    this.plagueUntil = 0;
    this.floodWarn = 0;
    this.dragon = null;
    this.dragonSlain = false;
  }

  // Production buildings that can age/burn (walls and the castle are excluded).
  buildingsList() {
    return this.scene.buildings.buildings.filter((b: any) => b.alive && b.typeKey !== 'wall');
  }

  masonsCovering(b: any) {
    return this.scene.buildings.buildings.some((m: any) =>
      m.alive && m.typeKey === 'masonslodge' && m.workers > 0 &&
      Math.abs(m.col - b.col) <= 6 && Math.abs(m.row - b.row) <= 6);
  }

  // ---- water adjacency (for floods) -------------------------------------
  tileIsWater(c: number, r: number) {
    const t = this.scene.terrainType;
    return !!(t && t[r] && t[r][c] === 'water');
  }
  nextToWater(b: any) {
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) if (this.tileIsWater(b.col + dc, b.row + dr)) return true;
    return false;
  }
  mapHasWater() {
    const t = this.scene.terrainType; if (!t) return false;
    for (let r = 0; r < t.length; r++) for (let c = 0; c < t[r].length; c++) if (t[r][c] === 'water') return true;
    return false;
  }

  onNewDay() {
    const day = this.scene.gameDay;
    if (day - this._lastAge >= 20 && day > 1) { this._lastAge = day; this.ageBuildings(); }
    this.masonRepairs();
    this.tickFires();
    this.tickPlague(day);
    this.tickFlood(day);
    this.tickDragon(day);
    if (day > 14) this.rollDisaster(day);
  }

  ageBuildings() {
    let degraded = 0;
    for (const b of this.buildingsList()) {
      if (b.typeKey === 'castle') continue;        // the seat is maintained by the court
      if (this.masonsCovering(b)) continue;
      if (b.condition > 0) {
        b.condition -= 1; this.applyConditionVisual(b); degraded++;
        if (b.condition === 1) this.scene.logEvent(`${b.type.name} is deteriorating — assign a mason`, 'orange');
        else if (b.condition === 0) this.scene.logEvent(`${b.type.name} has crumbled to a ruin`, 'red');
      }
    }
    if (degraded && this.scene.showToast) this.scene.showToast('Buildings are weathering with age');
  }

  masonRepairs() {
    for (const m of this.scene.buildings.buildings) {
      if (!(m.alive && m.typeKey === 'masonslodge' && m.workers > 0)) continue;
      const target = this.buildingsList().find((b: any) =>
        b !== m && b.condition > 0 && b.condition < 4 &&
        Math.abs(m.col - b.col) <= 6 && Math.abs(m.row - b.row) <= 6);
      if (target) {
        target.condition += 1; this.applyConditionVisual(target);
        if (this.scene.floatText) this.scene.floatText(target.x, target.y - 30, 'repaired', '#9fd8a8');
      }
    }
  }

  applyConditionVisual(b: any) {
    if (!b.rect) return;
    const tints: Record<number, any> = { 4: null, 3: null, 2: 0xcfc0a0, 1: 0xb08050, 0: 0x6a5a4a };
    const t = tints[b.condition];
    if (t == null) b.rect.clearTint(); else b.rect.setTint(t);
  }

  // ---- DISASTERS --------------------------------------------------------
  rollDisaster(day: number) {
    if (this._calmUntil && day < this._calmUntil) return;
    if (Math.random() > 0.07) return; // ~7%/day once past the grace period
    this._calmUntil = day + 6;        // no back-to-back disasters
    const opts: string[] = ['fire', 'fire', 'plague'];
    if (this.mapHasWater()) opts.push('flood');
    if (day > 60 && !this.dragonSlain && !this.dragon) opts.push('dragon');
    const kind = opts[Math.floor(Math.random() * opts.length)];
    if (kind === 'fire') this.startFire();
    else if (kind === 'plague') this.startPlague(day);
    else if (kind === 'flood') this.startFloodWarning(day);
    else if (kind === 'dragon') this.startDragon(day);
  }

  // ---- fire -------------------------------------------------------------
  startFire() {
    const cands = this.buildingsList().filter((b: any) => b.typeKey !== 'castle' && !b._onFire);
    if (!cands.length) return;
    const b = cands[Math.floor(Math.random() * cands.length)];
    this.igniteBuilding(b);
    this.scene.threatWarning(`${b.type.name} is on fire! Click it to send workers (2 days)`, 0xff8c3a, true);
  }
  igniteBuilding(b: any) {
    if (b._onFire || !b.alive) return;
    b._onFire = true; b._fireDays = 2; this.fires.push(b);
    sfx.play('building_fire'); // (V2 P4 #8) crackle
    if (this.scene.add) {
      b._fireFx = this.scene.add.text(b.x, b.y - 30, '🔥', { fontSize: '20px' }).setOrigin(0.5).setDepth(40);
      this.scene.tweens.add({ targets: b._fireFx, scale: { from: 0.9, to: 1.25 }, yoyo: true, duration: 300, repeat: -1 });
    }
  }
  extinguishFire(b: any) {
    if (!b._onFire) return false;
    if (this.scene.resources.gold < 20) { if (this.scene.showToast) this.scene.showToast('Need 20 gold to fight the fire'); return false; }
    this.scene.resources.gold -= 20;
    this.clearFire(b);
    this.scene.logEvent(`Fire at ${b.type.name} extinguished`, 'green');
    return true;
  }
  clearFire(b: any) {
    b._onFire = false; b._fireDays = 0;
    if (b._fireFx) { b._fireFx.destroy(); b._fireFx = null; }
    this.fires = this.fires.filter((f: any) => f !== b);
  }
  tickFires() {
    for (const b of [...this.fires]) {
      if (!b.alive) { this.clearFire(b); continue; }
      if (this.masonsCovering(b) && Math.random() < 0.6) { this.clearFire(b); this.scene.logEvent(`Masons doused the fire at ${b.type.name}`, 'green'); continue; }
      b._fireDays -= 1;
      if (b._fireDays <= 0) {
        this.clearFire(b);
        b.condition = 0; this.applyConditionVisual(b);
        this.scene.logEvent(`${b.type.name} burned down`, 'red');
        if (this.scene.razeBuilding) this.scene.razeBuilding(b); else b.alive = false;
      } else if (Math.random() < 0.3) {
        const near = this.buildingsList().find((o: any) => o !== b && !o._onFire && o.typeKey !== 'castle' && Math.abs(o.col - b.col) <= 2 && Math.abs(o.row - b.row) <= 2);
        if (near) { this.igniteBuilding(near); this.scene.logEvent(`Fire spread to ${near.type.name}!`, 'red'); }
      }
    }
  }

  // ---- plague -----------------------------------------------------------
  startPlague(day: number) {
    this.plagueUntil = day + 5;
    this.scene._plagueMult = 0.7;
    this.scene.threatWarning('A plague spreads through your people — production falls', 0x8aa84a, true);
  }
  tickPlague(day: number) {
    if (this.plagueUntil && day >= this.plagueUntil) {
      this.plagueUntil = 0; this.scene._plagueMult = 1;
      this.scene.logEvent('The plague has passed', 'green');
    }
  }

  // ---- flood ------------------------------------------------------------
  startFloodWarning(day: number) {
    if (!this.mapHasWater()) return;
    this.floodWarn = day + 3;
    this.scene.threatWarning('River levels are rising — riverside farms are at risk', 0x4a7bd5, true);
  }
  tickFlood(day: number) {
    if (!this.floodWarn || day < this.floodWarn) return;
    this.floodWarn = 0;
    let hit = 0, saved = 0;
    for (const b of this.buildingsList()) {
      if (b.typeKey !== 'farm') continue;
      if (!this.nextToWater(b)) continue;
      if (this.leveeNear(b)) { saved++; continue; } // (Assets V2) a levee holds the flood back
      b.condition = Math.max(0, b.condition - 2); this.applyConditionVisual(b); hit++;
    }
    if (hit) this.scene.threatWarning(`The flood damaged ${hit} riverside farm${hit > 1 ? 's' : ''}`, 0x4a7bd5, true);
    else if (saved) this.scene.logEvent(`Your levees held — ${saved} farm${saved > 1 ? 's' : ''} spared the flood`, 'green');
    else this.scene.logEvent('The river receded with little harm', 'green');
  }

  // (Assets V2) Is a flood-protecting levee within 4 tiles of this building?
  leveeNear(b: any) {
    return this.scene.buildings.buildings.some((l: any) => l.alive && l.typeKey === 'levee' && Math.abs(l.col - b.col) <= 4 && Math.abs(l.row - b.row) <= 4);
  }

  // ---- dragon -----------------------------------------------------------
  hasChampion() {
    const H = this.scene.heroes;
    return !!(H && H.living && H.living().some((h: any) => (h.type === 'warrior' && h.level >= 3) || h.id === 'aldric'));
  }
  hasSiege() { return this.scene.buildings.buildings.some((b: any) => b.alive && b.typeKey === 'siegeworkshop'); }
  startDragon(day: number) {
    this.dragon = { since: day };
    this.spawnDragonSprite(); // (Assets V2) show the beast circling the kingdom
    sfx.play('dragon_roar'); // (V2 P4 #8) massive roar
    this.scene.threatWarning('A DRAGON descends upon your kingdom! A champion or siege weapons can stop it', 0xc0392b, true);
  }
  // (Assets V2) A dragon sprite circles over the castle while the threat is active.
  spawnDragonSprite() {
    const s = this.scene, c = s.buildings && s.buildings.castle;
    if (!c || !s.add || !s.textures || !s.textures.exists('dragon')) return;
    this.clearDragonSprite();
    this._dragonSpr = s.add.image(c.x, c.y - 140, 'dragon').setDepth(9999).setScale(1.1);
    if (s.tweens) s.tweens.add({ targets: this._dragonSpr, x: c.x + 120, y: c.y - 120, yoyo: true, repeat: -1, duration: 2600, ease: 'Sine.inOut' });
  }
  clearDragonSprite() { if (this._dragonSpr) { this._dragonSpr.destroy(); this._dragonSpr = null; } }
  tickDragon(day: number) {
    if (!this.dragon || day <= this.dragon.since) return;
    this.clearDragonSprite();
    if (this.hasChampion() || this.hasSiege()) {
      this.dragon = null; this.dragonSlain = true;
      this.scene.resources.add('gold', 300); this.scene.resources.add('iron', 80);
      this.scene.logEvent('Your champion slew the dragon! Legendary hoard claimed (+300 gold, +80 iron)', 'gold');
      this.scene.threatWarning('The dragon is slain! Its hoard is yours', 0xffd24a, true);
    } else {
      const list = this.buildingsList().filter((b: any) => b.typeKey !== 'castle');
      for (let i = 0; i < 3 && list.length; i++) {
        const b = list.splice(Math.floor(Math.random() * list.length), 1)[0];
        b.condition = Math.max(0, b.condition - 2); this.applyConditionVisual(b);
      }
      this.dragon = null;
      this.scene.threatWarning('The dragon ravaged your kingdom and flew off — recruit a champion or build a Siege Workshop', 0xc0392b, true);
    }
  }

  serialize() {
    return {
      lastAge: this._lastAge, calmUntil: this._calmUntil, plagueUntil: this.plagueUntil,
      floodWarn: this.floodWarn, dragonSlain: this.dragonSlain, dragon: this.dragon,
      cond: this.scene.buildings.buildings.map((b: any) => ({ k: b.col + ',' + b.row, c: b.condition, f: !!b._onFire })),
    };
  }
  restore(d: any) {
    if (!d) return;
    this._lastAge = d.lastAge || 0; this._calmUntil = d.calmUntil || 0;
    this.plagueUntil = d.plagueUntil || 0; this.floodWarn = d.floodWarn || 0;
    this.dragonSlain = !!d.dragonSlain; this.dragon = d.dragon || null;
    if (this.plagueUntil) this.scene._plagueMult = 0.7;
    if (d.cond) {
      const map: Record<string, any> = {};
      for (const e of d.cond) map[e.k] = e;
      for (const b of this.scene.buildings.buildings) {
        const e = map[b.col + ',' + b.row];
        if (!e) continue;
        if (e.c != null) { b.condition = e.c; this.applyConditionVisual(b); }
        if (e.f) this.igniteBuilding(b);
      }
    }
  }
}
