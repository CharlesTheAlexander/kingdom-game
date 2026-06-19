import Phaser from 'phaser';

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
  scout: { name: 'Scouting Party', cost: 2, days: 0.5, maxSlots: 2, reward: 'Reveal enemy army · maybe an Artifact' },
  raid: { name: 'Raid Enemy Camp', cost: 5, days: 1, maxSlots: 2, reward: '20-40 Iron · maybe a Mercenary · 30% lose 1' },
  campaign: { name: 'Major Campaign', cost: 10, days: 2, maxSlots: 1, reward: '40-80 Iron · Artifact · maybe a Scroll · 50% lose 2-3' },
};

const WSCALE = 36 / 192;

export class ExpeditionManager {
  constructor(scene) {
    this.scene = scene;
    this.defs = DEFS;
    // Each type holds an array of active slots: [{ timeLeft }]. (FIX 3)
    this.state = { scout: [], raid: [], campaign: [] };
  }

  activeCount(key) { return this.state[key].length; }
  maxSlots(key) { return this.defs[key].maxSlots; }

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
    this.state[key].push({ timeLeft: def.days * SEC_PER_DAY });
    this.scene.refreshPanel();
  }

  update(dt) {
    for (const key of Object.keys(this.state)) {
      const slots = this.state[key];
      for (let i = slots.length - 1; i >= 0; i--) {
        slots[i].timeLeft -= dt;
        if (slots[i].timeLeft <= 0) {
          slots.splice(i, 1); // remove the finished slot, then resolve its rewards
          this.resolve(key);
        }
      }
    }
  }

  resolve(key) {
    const def = this.defs[key];

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

    if (key === 'scout') {
      s.grantIntel(2); // reveal enemy army size for 2 days
      if (Math.random() < 0.25) s.awardArtifact();
    } else if (key === 'raid') {
      give('iron', Phaser.Math.Between(20, 40));
      if (Math.random() < 0.4) s.troops.spawnMercenary(); // a mercenary joins
    } else {
      give('iron', Phaser.Math.Between(40, 80));
      s.awardArtifact(); // guaranteed
      if (Math.random() < 0.35) s.grantScroll(); // rare scroll
    }

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
    for (let i = 0; i < n; i++) {
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
