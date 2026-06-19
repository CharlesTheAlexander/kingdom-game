import Phaser from 'phaser';

// Expedition system (Phase 2): send troops into the wilderness (off the right
// edge) to return later with resources. One expedition of each type at a time.

const DEFS = {
  scout: { name: 'Scout Party', cost: 2, time: 30, reward: '20-40 resources' },
  raid: { name: 'Raid Enemy Camp', cost: 5, time: 60, reward: '60-100 res · 30% lose 1' },
  campaign: { name: 'Major Campaign', cost: 10, time: 120, reward: '200+ res +50 gold · 50% lose 2-3' },
};

const WSCALE = 36 / 192;

export class ExpeditionManager {
  constructor(scene) {
    this.scene = scene;
    this.defs = DEFS;
    this.state = {
      scout: { active: false, timeLeft: 0 },
      raid: { active: false, timeLeft: 0 },
      campaign: { active: false, timeLeft: 0 },
    };
  }

  canSend(key) {
    return !this.state[key].active && this.scene.troops.count >= this.defs[key].cost;
  }

  send(key) {
    const def = this.defs[key];
    const st = this.state[key];
    if (st.active) return;
    if (this.scene.troops.count < def.cost) {
      this.scene.showToast('Not enough soldiers');
      return;
    }
    this.scene.troops.detach(def.cost); // warriors leave the muster
    this.marchOff(def.cost);
    st.active = true;
    st.timeLeft = def.time;
    this.scene.refreshPanel();
  }

  update(dt) {
    for (const key of Object.keys(this.state)) {
      const st = this.state[key];
      if (!st.active) continue;
      st.timeLeft -= dt;
      if (st.timeLeft <= 0) this.resolve(key);
    }
  }

  resolve(key) {
    const def = this.defs[key];
    const st = this.state[key];
    st.active = false;
    st.timeLeft = 0;

    let losses = 0;
    if (key === 'raid' && Math.random() < 0.3) losses = 1;
    if (key === 'campaign' && Math.random() < 0.5) losses = Phaser.Math.Between(2, 3);
    const survivors = Math.max(0, def.cost - losses);

    const types = ['wood', 'gold', 'stone'];
    const castle = this.scene.buildings.castle;
    const give = (type, amt) => {
      this.scene.resources.add(type, amt);
      const label = type[0].toUpperCase() + type.slice(1);
      if (castle) this.scene.floatText(castle.x + Phaser.Math.Between(-20, 20), castle.y - 30, `+${amt} ${label}!`, '#ffe066');
    };
    if (key === 'scout') give(Phaser.Utils.Array.GetRandom(types), Phaser.Math.Between(20, 40));
    else if (key === 'raid') give(Phaser.Utils.Array.GetRandom(types), Phaser.Math.Between(60, 100));
    else {
      give(Phaser.Utils.Array.GetRandom(types), Phaser.Math.Between(200, 260));
      give('gold', 50);
    }

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
        .setFlipX(false); // marching right
      if (this.scene.anims.exists('blue_warrior_run')) spr.play('blue_warrior_run');
      this.scene.tweens.add({ targets: spr, x: this.scene.scale.width + 80, duration: 1800 + i * 120, onComplete: () => spr.destroy() });
    }
  }

  marchIn(n) {
    const home = this.homePoint();
    for (let i = 0; i < n; i++) {
      const spr = this.scene.add
        .sprite(this.scene.scale.width + 60, home.y + Phaser.Math.Between(-10, 20), 'blue_warrior_run', 0)
        .setScale(WSCALE)
        .setDepth(7)
        .setFlipX(true); // marching left, back home
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
