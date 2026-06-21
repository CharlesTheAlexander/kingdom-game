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
    this.spr.on('pointerover', () => { this._hover = true; if (this.alive) this.spr.setTint(0xffff66); }); // glow on hover
    this.spr.on('pointerout', () => { this._hover = false; this.spr.clearTint(); });

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
    if (this.scene.dustAt) this.scene.dustAt(this.x, this.y); // (Phase 7) dust puff on depletion
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
      if (this.scene.sparkleAt) this.scene.sparkleAt(this.x, this.y); // (Phase 7) respawn sparkle
    }
  }
}

export class ResourceNodeManager {
  constructor(scene) {
    this.scene = scene;
    this.nodes = [];
  }

  // (Save system) Remaining counts of live nodes.
  serialize() {
    return this.nodes.filter((n) => n.alive).map((n) => ({ type: n.type, count: n.count }));
  }

  // (Save system) Best-effort: apply saved remaining counts onto the freshly
  // spawned nodes by index (positions are random per session, so we don't try to
  // match exactly — this just preserves how depleted the world economy is).
  applyCounts(list) {
    if (!list) return;
    for (let i = 0; i < this.nodes.length && i < list.length; i++) {
      const n = this.nodes[i], d = list[i];
      if (d && d.count != null) {
        n.count = Math.max(0, Math.min(n.maxCount, d.count));
        if (n.label && n.def) n.label.setText(`${n.def.label} x${n.count}`);
        if (n.count <= 0 && n.deplete) n.deplete();
      }
    }
  }

  // (Phase B) 60-80 nodes across the continent. A small reachable cluster sits
  // just outside the build zone (so idle workers can bootstrap the economy),
  // while the rest are distributed into biome-appropriate zones for exploration.
  spawnInitial() {
    const used = new Set();
    const mid = Math.floor(this.scene.COLS / 2);
    const place = (type, x, y) => this.nodes.push(new ResourceNode(this.scene, type, x, y));

    // Reachable starter cluster (within ~12 tiles of the castle).
    const near = (type, n, dMin, dMax) => {
      for (let i = 0; i < n; i++) {
        for (let a = 0; a < 200; a++) {
          const col = Phaser.Math.Between(mid - dMax, mid + dMax);
          const row = Phaser.Math.Between(mid - dMax, mid + dMax);
          const d = Phaser.Math.Distance.Between(col, row, mid, mid);
          const key = `${col},${row}`;
          if (d < dMin || d > dMax || !this.scene.isWilderness(col, row) || used.has(key)) continue;
          used.add(key);
          const t = this.scene.tileCenter(col, row);
          place(type, t.x + Phaser.Math.Between(-14, 14), t.y + Phaser.Math.Between(-14, 14));
          break;
        }
      }
    };
    // (Phase 7) A couple of nodes right beside the castle so the player can see
    // resources to gather from the very first view.
    near('wood', 1, 3, 5);
    near('food', 1, 3, 5);
    near('wood', 2, 7, 12);
    near('stone', 2, 7, 12);
    near('food', 2, 7, 12);
    near('gold', 1, 9, 14);

    // Biome-distributed nodes (bounding box per biome).
    const BBOX = {
      forest: [50, 149, 4, 48], mountains: [152, 197, 4, 195],
      delta: [52, 148, 152, 195], wildlands: [4, 48, 4, 195], middle: [55, 145, 55, 145],
    };
    const inBiome = (type, n, biome) => {
      const [c0, c1, r0, r1] = BBOX[biome];
      for (let i = 0; i < n; i++) {
        for (let a = 0; a < 200; a++) {
          const col = Phaser.Math.Between(c0, c1);
          const row = Phaser.Math.Between(r0, r1);
          const key = `${col},${row}`;
          if (this.scene.biomeAt(col, row) !== biome || !this.scene.isWilderness(col, row) || used.has(key)) continue;
          used.add(key);
          const t = this.scene.tileCenter(col, row);
          place(type, t.x + Phaser.Math.Between(-14, 14), t.y + Phaser.Math.Between(-14, 14));
          break;
        }
      }
    };
    inBiome('wood', 18, 'forest');     // abundant wood in the deep forest
    inBiome('wood', 6, 'wildlands');
    inBiome('stone', 9, 'mountains');  // stone + gold in the highlands
    inBiome('gold', 7, 'mountains');
    inBiome('stone', 4, 'wildlands');
    inBiome('food', 11, 'delta');      // sheep + fish on the river plains
    inBiome('food', 5, 'middle');
    inBiome('gold', 2, 'middle');
  }

  nearestNode(type, x, y, filter) {
    let best = null;
    let bd = Infinity;
    for (const n of this.nodes) {
      if (!n.alive || n.type !== type) continue;
      if (filter && !filter(n)) continue;
      const d = Phaser.Math.Distance.Between(x, y, n.x, n.y);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  // (FIX 1) Nearest alive node of any (optionally filtered) type within maxDist
  // pixels — used by idle freelancing workers.
  nearestAnyNode(x, y, maxDist = Infinity, types = null) {
    let best = null;
    let bd = maxDist;
    for (const n of this.nodes) {
      if (!n.alive) continue;
      if (types && !types.includes(n.type)) continue;
      const d = Phaser.Math.Distance.Between(x, y, n.x, n.y);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  // (Phase 4 Decision 3) Add a small deposit at a tile (e.g. early-game stone).
  addSmallNode(type, col, row, count) {
    const { x, y } = this.scene.tileCenter(col, row);
    const n = new ResourceNode(this.scene, type, x, y);
    if (count) { n.maxCount = count; n.count = count; n.refreshLabel(); }
    this.nodes.push(n);
    return n;
  }

  update(dtMs) {
    for (const n of this.nodes) n.update(dtMs);
    this.updateLabelVisibility();
  }

  // (Audit FIX 6) Node quantity labels declutter the world when zoomed out:
  // hidden below 0.7 zoom, fading in from 0.7→0.8, fully shown at ≥0.8 — but a
  // hovered node always shows its label regardless of zoom.
  updateLabelVisibility() {
    const cam = this.scene.cameras && this.scene.cameras.main;
    if (!cam) return;
    const zoomAlpha = Phaser.Math.Clamp((cam.zoom - 0.7) / 0.1, 0, 1);
    for (const n of this.nodes) {
      if (!n.alive || !n.label) continue; // depleted nodes are faded out by their own tween
      n.label.setAlpha(n._hover ? 1 : zoomAlpha);
    }
  }
}
