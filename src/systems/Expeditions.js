import Phaser from 'phaser';
import { sfx } from '../audio/SoundEngine.js';

// Expedition system (Phase 5 redesign + FIX 3/6). Workers gather the BASIC
// resources; expeditions only ever return SPECIAL rewards — Iron, Artifacts,
// Scrolls, Mercenaries and Intel — never wood/stone/food. Durations are measured
// in game days (1 day = 5 real minutes). Multiple of the same type can run at
// once (Scout x2, Raid x2, Campaign x1) — each is an independent slot.
//
//   SCOUTING PARTY (2 soldiers, 0.5 day) — reveals the enemy army size for 2 days,
//                                          small chance of an Artifact.
//   RAID ENEMY CAMP (5 soldiers, 1 day)  — 20-40 Iron, chance of a Mercenary,
//                                          30% chance to lose 1 soldier.
//   MAJOR CAMPAIGN (10 soldiers, 2 days) — 40-80 Iron, a guaranteed Artifact,
//                                          chance of a rare Scroll, 50% lose 2-3.

const SEC_PER_DAY = 300; // matches IsometricScene DAY_MS (300000ms)

const DEFS = {
  // (Polish Phase 5) reward strings kept short so they fit the expedition card.
  scout: { name: 'Scouting Party', cost: 2, days: 0.5, maxSlots: 2, reward: 'Reveal enemy army · maybe Artifact' },
  raid: { name: 'Raid Enemy Camp', cost: 5, days: 1, maxSlots: 2, reward: '20-40 Iron · Mercenary? · 30% loss' },
  campaign: { name: 'Major Campaign', cost: 10, days: 2, maxSlots: 1, reward: '40-80 Iron · Artifact · Scroll · risky' },
  // (Session-1 Phase 1) Explore a discovered ruin for a unique reward.
  exploreRuin: { name: 'Explore Ruin', cost: 3, days: 2, maxSlots: 2, reward: 'A unique ancient reward' },
  // (Session-1 Phase 2) Send a gift to a wandering tribe to befriend it.
  envoy: { name: 'Send Envoy', cost: 0, days: 1, maxSlots: 2, reward: 'Befriend a wandering tribe' },
};

const WSCALE = 36 / 192;

export class ExpeditionManager {
  constructor(scene) {
    this.scene = scene;
    this.defs = DEFS;
    // Each type holds an array of active slots: [{ timeLeft }]. (FIX 3)
    this.state = { scout: [], raid: [], campaign: [], exploreRuin: [], envoy: [] };
  }

  activeCount(key) { return this.state[key].length; }
  maxSlots(key) { return this.defs[key].maxSlots; }

  // (Bug 5) Total soldiers currently away on expeditions — they still count
  // toward the soldier cap so the player can't over-train while parties are out.
  deployedSoldiers() {
    let n = 0;
    for (const key of Object.keys(this.state)) for (const slot of this.state[key]) n += slot.cost || this.defs[key].cost;
    return n;
  }

  // Days remaining for each running slot of a type (for the panel readout).
  slotDays(key) { return this.state[key].map((slot) => Math.max(0, slot.timeLeft / SEC_PER_DAY)); }

  canSend(key) {
    return this.state[key].length < this.defs[key].maxSlots && this.scene.troops.count >= this.defs[key].cost;
  }

  send(key) {
    const def = this.defs[key];
    if (this.state[key].length >= def.maxSlots) {
      this.scene.showToast(`All ${def.name} parties already out`);
      return;
    }
    if (this.scene.troops.count < def.cost) {
      this.scene.showToast('Not enough soldiers');
      return;
    }
    this.scene.troops.detach(def.cost); // soldiers leave the muster
    this.marchOff(def.cost);
    this.state[key].push({ timeLeft: def.days * SEC_PER_DAY, cost: def.cost }); // (Bug 5) remember the party size
    this.scene.refreshPanel();
  }

  update(dt) {
    for (const key of Object.keys(this.state)) {
      const slots = this.state[key];
      for (let i = slots.length - 1; i >= 0; i--) {
        slots[i].timeLeft -= dt;
        if (slots[i].timeLeft <= 0) {
          const slot = slots.splice(i, 1)[0]; // remove the finished slot, then resolve
          if (key === 'exploreRuin') this.resolveRuin(slot);
          else if (key === 'envoy') this.resolveEnvoy(slot);
          else this.resolve(key);
        }
      }
    }
  }

  // (Session-1 Phase 1) Send 3 soldiers to explore a specific discovered ruin.
  sendRuin(ruinName) {
    const def = this.defs.exploreRuin;
    if (this.state.exploreRuin.length >= def.maxSlots) { this.scene.showToast('All explorers are already out'); return; }
    if (this.scene.troops.count < def.cost) { this.scene.showToast(`Need ${def.cost} soldiers`); return; }
    this.scene.troops.detach(def.cost); this.marchOff(def.cost);
    this.state.exploreRuin.push({ timeLeft: def.days * SEC_PER_DAY, cost: def.cost, target: ruinName });
    this.scene.refreshPanel();
  }

  resolveRuin(slot) {
    sfx.play('expedition_return');
    this.marchIn(slot.cost); // explorers return
    const ruin = this.scene.ruins && this.scene.ruins.byName(slot.target);
    if (ruin && !ruin.explored) this.scene.ruins.explore(ruin);
    if (this.scene.stats) this.scene.stats.note('expeditions');
    this.scene.refreshPanel();
  }

  // (Session-1 Phase 2) Send a 50-gold gift to a tribe to make it friendly.
  sendEnvoy(tribeKey) {
    const def = this.defs.envoy;
    if (this.state.envoy.length >= def.maxSlots) { this.scene.showToast('An envoy is already travelling'); return; }
    if (this.scene.resources.gold < 50) { this.scene.showToast('Need 50 gold for the gift'); return; }
    this.scene.resources.spend({ gold: 50 });
    this.state.envoy.push({ timeLeft: def.days * SEC_PER_DAY, cost: 0, target: tribeKey });
    this.scene.refreshPanel();
  }

  resolveEnvoy(slot) {
    sfx.play('expedition_return');
    if (this.scene.factions && this.scene.factions.befriendTribe) this.scene.factions.befriendTribe(slot.target);
    if (this.scene.stats) this.scene.stats.note('expeditions');
    this.scene.refreshPanel();
  }

  resolve(key) {
    const def = this.defs[key];
    sfx.play('expedition_return'); // (Polish Phase 2)

    let losses = 0;
    if (key === 'raid' && Math.random() < 0.3) losses = 1;
    if (key === 'campaign' && Math.random() < 0.5) losses = Phaser.Math.Between(2, 3);
    const survivors = Math.max(0, def.cost - losses);

    const s = this.scene;
    const castle = s.buildings.castle;
    const give = (type, amt) => {
      s.resources.add(type, amt);
      const label = type[0].toUpperCase() + type.slice(1);
      if (castle) s.floatText(castle.x + Phaser.Math.Between(-24, 24), castle.y - 34, `+${amt} ${label}!`, '#dfe6ee');
    };

    // (Session-1 Phase 3) "Iron deposits discovered" event doubles iron rewards.
    const ironMul = (s._ironBonusUntil && s.gameDay < s._ironBonusUntil) ? 2 : 1;
    if (key === 'scout') {
      s.grantIntel(2); // reveal enemy army size for 2 days
      if (Math.random() < 0.25) s.awardArtifact();
    } else if (key === 'raid') {
      give('iron', Phaser.Math.Between(20, 40) * ironMul);
      if (Math.random() < 0.4) s.troops.spawnMercenary(); // a mercenary joins
    } else {
      give('iron', Phaser.Math.Between(40, 80) * ironMul);
      s.awardArtifact(); // guaranteed
      if (Math.random() < 0.35) s.grantScroll(); // rare scroll
    }
    if (s.stats) s.stats.note('expeditions');

    if (losses > 0 && castle) s.floatText(castle.x, castle.y - 56, `Lost ${losses} soldier${losses > 1 ? 's' : ''} on the expedition`, '#ff8a80');
    this.marchIn(survivors);
    this.scene.refreshPanel();
  }

  homePoint() {
    const b = this.scene.buildings.buildings.find((x) => x.typeKey === 'barracks') || this.scene.buildings.castle;
    return { x: b.x, y: b.y };
  }

  marchOff(n) {
    const home = this.homePoint();
    for (let i = 0; i < n; i++) {
      const spr = this.scene.add
        .sprite(home.x + Phaser.Math.Between(-20, 20), home.y + Phaser.Math.Between(-10, 20), 'blue_warrior_run', 0)
        .setScale(WSCALE)
        .setDepth(7)
        .setFlipX(false);
      if (this.scene.anims.exists('blue_warrior_run')) spr.play('blue_warrior_run');
      this.scene.tweens.add({ targets: spr, x: home.x + 600, alpha: 0, duration: 1800 + i * 120, onComplete: () => spr.destroy() });
    }
  }

  marchIn(n) {
    const home = this.homePoint();
    // (BUG 1) If the cap shrank while they were away, excess soldiers are
    // discharged (not re-added) instead of overflowing the cap.
    const room = this.scene.soldierRoom ? this.scene.soldierRoom() : n;
    const keep = Math.min(n, room);
    const discharged = n - keep;
    if (discharged > 0 && this.scene.floatText) this.scene.floatText(home.x, home.y - 56, `${discharged} discharged (cap reached)`, '#ff8a80');
    for (let i = 0; i < keep; i++) {
      const spr = this.scene.add
        .sprite(home.x + 620, home.y + Phaser.Math.Between(-10, 20), 'blue_warrior_run', 0)
        .setScale(WSCALE)
        .setDepth(7)
        .setFlipX(true);
      if (this.scene.anims.exists('blue_warrior_run')) spr.play('blue_warrior_run');
      this.scene.tweens.add({
        targets: spr,
        x: home.x + Phaser.Math.Between(-20, 20),
        duration: 1800 + i * 120,
        onComplete: () => {
          spr.destroy();
          this.scene.troops.spawnAt(home.x, home.y);
        },
      });
    }
  }
}
