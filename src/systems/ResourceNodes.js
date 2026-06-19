import Phaser from 'phaser';

// Interactive resource nodes scattered in the wilderness (Phase 1, world map
// overhaul). Worker pawns walk to the nearest node matching the resource their
// building produces, harvest 1 per trip, and the node depletes then respawns.

// `labelDY` = pixels above the node's anchor to place the count label so it
// sits just over the visible art (the sprite frames have transparent padding,
// so a raw displayHeight offset looks detached).
const NODE_DEFS = {
  wood: { count: 40, label: 'Wood', textures: ['tree1', 'tree2'], scale: 0.3, oy: 0.82, labelDY: 56 },
  gold: { count: 30, label: 'Gold', textures: ['gold_stone'], scale: 0.42, oy: 0.7, labelDY: 34 },
  stone: { count: 30, label: 'Stone', textures: ['rock1', 'rock2'], scale: 0.78, oy: 0.6, labelDY: 30 },
  food: { count: 20, label: 'Food', textures: ['sheep_idle'], scale: 0.42, oy: 0.72, anim: 'sheep_idle', labelDY: 34 },
};
const RESPAWN_MS = 120000; // nodes respawn 120s after depletion

class ResourceNode {
  constructor(scene, type, x, y) {
    this.scene = scene;
    this.type = type;
    this.x = x;
    this.y = y;
    this.def = NODE_DEFS[type];
    this.maxCount = this.def.count;
    this.count = this.maxCount;
    this.alive = true;
    this.respawnTimer = 0;
    this.texKey = Phaser.Utils.Array.GetRandom(this.def.textures);

    this.spr = scene.add.sprite(x, y, this.texKey, 0).setOrigin(0.5, this.def.oy).setScale(this.def.scale).setDepth(2);
    if (this.def.anim && scene.anims.exists(this.def.anim)) this.spr.play(this.def.anim);
    this.spr.setInteractive();
    this.spr.on('pointerover', () => { if (this.alive) this.spr.setTint(0xffff66); }); // glow on hover
    this.spr.on('pointerout', () => this.spr.clearTint());

    // Centered directly above the node sprite. Scrolls WITH the world (default
    // scrollFactor 1); depth 35 keeps it above the screen-fixed vignette but
    // below the UI panels.
    this.label = scene.add
      .text(this.spr.x, this.spr.y - this.def.labelDY, '', {
        fontFamily: 'monospace', fontSize: '11px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(35);
    this.refreshLabel();
  }

  refreshLabel() {
    this.label.setText(`${this.def.label} x${this.count}`);
  }

  // A worker harvested one unit. Returns false if the node was already gone.
  harvest() {
    if (!this.alive) return false;
    this.count -= 1;
    this.refreshLabel();
    if (this.count <= 0) this.deplete();
    return true;
  }

  deplete() {
    this.alive = false;
    this.respawnTimer = RESPAWN_MS;
    this.spr.disableInteractive();
    this.spr.clearTint();
    this.scene.tweens.add({ targets: [this.spr, this.label], alpha: 0, duration: 600 });
  }

  update(dtMs) {
    if (this.alive) return;
    this.respawnTimer -= dtMs;
    if (this.respawnTimer <= 0) {
      this.alive = true;
      this.count = this.maxCount;
      this.refreshLabel();
      this.spr.setInteractive();
      this.scene.tweens.add({ targets: [this.spr, this.label], alpha: 1, duration: 600 });
    }
  }
}

export class ResourceNodeManager {
  constructor(scene) {
    this.scene = scene;
    this.nodes = [];
  }

  spawnInitial() {
    const plan = [['wood', 6], ['gold', 4], ['stone', 4], ['food', 3]];
    const used = new Set();
    const pick = () => {
      for (let a = 0; a < 80; a++) {
        const col = Phaser.Math.Between(0, this.scene.COLS - 1);
        const row = Phaser.Math.Between(0, this.scene.ROWS - 1);
        const key = `${col},${row}`;
        if (!this.scene.isWilderness(col, row) || used.has(key)) continue;
        used.add(key);
        // (Phase 4) Pixel-level scatter so nodes don't snap to tile centers.
        const t = this.scene.tileCenter(col, row);
        return { x: t.x + Phaser.Math.Between(-14, 14), y: t.y + Phaser.Math.Between(-14, 14) };
      }
      return null;
    };
    for (const [type, n] of plan) {
      for (let i = 0; i < n; i++) {
        const p = pick();
        if (p) this.nodes.push(new ResourceNode(this.scene, type, p.x, p.y));
      }
    }
  }

  nearestNode(type, x, y) {
    let best = null;
    let bd = Infinity;
    for (const n of this.nodes) {
      if (!n.alive || n.type !== type) continue;
      const d = Phaser.Math.Distance.Between(x, y, n.x, n.y);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  update(dtMs) {
    for (const n of this.nodes) n.update(dtMs);
  }
}
