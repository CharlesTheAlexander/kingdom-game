import Phaser from 'phaser';

// Neutral settlements scattered across the continent (Phase B). Each is a small
// cluster of cottages defended by a garrison of neutral warriors (gray). The
// player discovers them by exploring and conquers them by marching troops in —
// the garrison are real enemy-interface units, so the existing auto-combat does
// the fighting. When the last defender falls the settlement turns blue, joins
// your territory and yields a small passive income of its specialty each day.

const DEFS = [
  { name: 'Millhaven', col: 130, row: 95, specialty: 'food', note: 'abundant grain' },
  { name: 'Oakhollow', col: 78, row: 62, specialty: 'wood', note: 'old-forest timber' },
  { name: 'Ironpass', col: 158, row: 82, specialty: 'iron', note: 'iron deposits nearby' },
  { name: 'Stonewatch', col: 152, row: 132, specialty: 'stone', note: 'mountain quarry' },
  { name: 'Riverford', col: 108, row: 158, specialty: 'food', note: 'river fishery' },
  { name: 'Goldbrook', col: 70, row: 128, specialty: 'gold', note: 'gold panning' },
  { name: 'Thornwood', col: 62, row: 78, specialty: 'wood', note: 'dense woods' },
  { name: 'Highcairn', col: 176, row: 112, specialty: 'stone', note: 'high stone' },
  { name: 'Greenfield', col: 122, row: 122, specialty: 'food', note: 'rich farmland' },
];

// A stationary defender: a real enemy-interface unit (x/y/alive/takeDamage/
// destroy) that the player's troops auto-attack and that bites back via the
// shared troops damage loop. It never chases — it guards its home tile.
export class Defender {
  constructor(scene, x, y, hp, tex, tint) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.maxHp = hp;
    this.hp = hp;
    this.alive = true;
    this.spr = scene.add.sprite(x, y, tex, 0).setScale(34 / 192).setTint(tint);
    if (scene.anims.exists(tex)) this.spr.play(tex);
    this._barW = 22;
    this.hpBarBg = scene.add.rectangle(x, y - 22, this._barW + 2, 4, 0x000000, 0.6);
    this.hpBarFill = scene.add.rectangle(x - this._barW / 2, y - 22, this._barW, 2, 0xff7043).setOrigin(0, 0.5);
  }
  takeDamage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    this.hpBarFill.width = this._barW * Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    this.spr.setTintFill(0xff5555);
    this.scene.time.delayedCall(70, () => { if (this.alive) this.spr.clearTint(); });
    if (this.hp <= 0) this.destroy();
  }
  destroy() {
    if (!this.alive) return;
    this.alive = false;
    if (this.scene.dustAt) this.scene.dustAt(this.x, this.y);
    this.hpBarBg.destroy();
    this.hpBarFill.destroy();
    this.scene.tweens.add({ targets: this.spr, alpha: 0, duration: 400, onComplete: () => this.spr.destroy() });
  }
}

class Settlement {
  constructor(scene, def) {
    this.scene = scene;
    this.name = def.name;
    this.col = def.col;
    this.row = def.row;
    this.specialty = def.specialty;
    this.note = def.note;
    this.owner = 'neutral';
    this.discovered = false;
    const { x, y } = scene.tileCenter(def.col, def.row);
    this.x = x;
    this.y = y;
    this.buildings = [];
    const huts = Phaser.Math.Between(3, 5);
    for (let i = 0; i < huts; i++) {
      const a = (i / huts) * Math.PI * 2;
      const r = i === 0 ? 0 : 24 + Math.random() * 10;
      const spr = scene.add.image(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.6, 'house').setOrigin(0.5, 1.0).setScale(i === 0 ? 1.1 : 0.85).setTint(0x9aa0a6);
      this.buildings.push(spr);
    }
    this.guards = [];
    const n = Phaser.Math.Between(3, 6);
    for (let i = 0; i < n; i++) {
      this.guards.push(new Defender(scene, x + Phaser.Math.Between(-30, 30), y + Phaser.Math.Between(8, 26), 50, 'blue_warrior_idle', 0x8a8f96));
    }
    this.label = scene.add.text(x, y - 56, def.name, { fontFamily: 'monospace', fontSize: '12px', color: '#e8e2d0', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5, 1).setVisible(false);
  }

  aliveGuards() { return this.guards.filter((g) => g.alive); }

  update(dt) {
    const s = this.scene;
    this.guards = this.guards.filter((g) => g.alive);
    if (!this.discovered) {
      const t = s.screenToTile(this.x, this.y);
      if (s.territory && s.territory.explored[t.row] && s.territory.explored[t.row][t.col]) this.discovered = true;
    }
    let near = false;
    for (const u of s.troops.allUnits()) { if (Phaser.Math.Distance.Between(u.x, u.y, this.x, this.y) <= s.TILE * 6) { near = true; break; } }
    this.label.setVisible(this.discovered || near);
    if (this.owner === 'neutral' && this.guards.length === 0) this.conquer();
  }

  conquer() {
    this.owner = 'player';
    for (const b of this.buildings) b.setTint(0x9ec9ff);
    this.label.setColor('#9ec9ff');
    const s = this.scene;
    if (s.floatText) s.floatText(this.x, this.y - 62, `${this.name} conquered! +${this.specialty}/day`, '#9ec9ff');
    if (s.threatWarning) s.threatWarning(`${this.name} is now yours (${this.note})`, 0x9ec9ff);
    if (s.territory) s.territory.recompute();
  }
}

export class SettlementManager {
  constructor(scene) {
    this.scene = scene;
    this.list = DEFS.map((d) => new Settlement(scene, d));
  }
  ownedCount() { return this.list.filter((s) => s.owner === 'player').length; }
  total() { return this.list.length; }

  // (Save system) Settlement positions come from fixed defs, so we restore by name.
  serialize() {
    return this.list.map((s) => ({ name: s.name, owner: s.owner, discovered: s.discovered, guards: s.guards.filter((g) => g.alive).length, administrator: !!s.administrator }));
  }

  restore(list) {
    if (!list) return;
    for (const d of list) {
      const s = this.list.find((x) => x.name === d.name);
      if (!s) continue;
      s.discovered = !!d.discovered;
      s.administrator = !!d.administrator;
      if (d.owner === 'player' && s.owner !== 'player') {
        for (const g of s.guards) { if (g.alive) { g.alive = false; if (g.destroy) g.destroy(); } }
        s.guards = [];
        s.conquer();
      } else if (typeof d.guards === 'number' && s.owner === 'neutral') {
        // Trim guards down to the saved count (defenders already lost mid-siege).
        while (s.guards.filter((g) => g.alive).length > d.guards) {
          const g = s.guards.find((x) => x.alive);
          if (!g) break;
          g.alive = false; if (g.destroy) g.destroy();
        }
      }
    }
  }

  // Living defenders of un-conquered settlements (added to the combat threats).
  threats() {
    const out = [];
    for (const st of this.list) if (st.owner === 'neutral') for (const g of st.guards) if (g.alive) out.push(g);
    return out;
  }

  nearest(wx, wy, maxPx) {
    let best = null, bd = maxPx == null ? Infinity : maxPx;
    for (const st of this.list) { const d = Phaser.Math.Distance.Between(wx, wy, st.x, st.y); if (d < bd) { bd = d; best = st; } }
    return best;
  }

  // (Phase 6) Daily income from conquered settlements. With an Administrator the
  // settlement runs itself: +30% tribute but a 50 gold/day salary.
  collectDaily() {
    const taxGold = (amt) => Math.round(amt * (this.scene._goldTaxMult || 1)); // (Phase 5) tax on gold tribute
    for (const st of this.list) {
      if (st.owner !== 'player') continue;
      const base = st.admin ? 4 : 3;
      const amt = st.specialty === 'gold' ? taxGold(base) : base;
      this.scene.resources.add(st.specialty, amt);
      if (st.admin) this.scene.resources.gold = Math.max(0, this.scene.resources.gold - 50);
    }
  }

  owned() { return this.list.filter((s) => s.owner === 'player'); }
  toggleAdmin(st) { st.admin = !st.admin; if (this.scene.refreshPanel) this.scene.refreshPanel(); }

  update(dt) { for (const st of this.list) st.update(dt); }

  applyDepths(D, BODY, BARB, BARF, LBL) {
    for (const st of this.list) {
      for (const b of st.buildings) b.setDepth(D(b.y) + BODY);
      for (const g of st.guards) { g.spr.setDepth(D(g.y) + 0.008); g.hpBarBg.setDepth(D(g.y) + BARB); g.hpBarFill.setDepth(D(g.y) + BARF); }
      st.label.setDepth(D(st.y) + LBL);
    }
  }
}
