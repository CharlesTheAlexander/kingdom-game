import Phaser from 'phaser';

// Visual worker pawns (Phase 3, updated in the Phase 1 world overhaul).
// Pawns now walk to the nearest WILDERNESS RESOURCE NODE matching the resource
// their building produces, harvest 1 unit, then carry it back to the castle
// using the matching Run sprite. With no production buildings or no reachable
// nodes, they wander near the castle. Still purely cosmetic — actual resource
// production stays on the building timers.

const SCALE = 32 / 192;

// produces-type -> { node type to harvest, sprite to carry it home with }
const GATHER = {
  wood: { node: 'wood', carry: 'pawn_run_wood' },
  stone: { node: 'stone', carry: 'pawn_run_gold' }, // no "carry stone" art; gold stand-in
  food: { node: 'food', carry: 'pawn_run_meat' },
};

class Pawn {
  constructor(scene, x, y) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.homeX = x;
    this.homeY = y;
    this.spr = scene.add.sprite(x, y, 'pawn_idle', 0).setScale(SCALE).setDepth(6);
    this.curAnim = null;
    this.state = 'idle';
    this.t = 0;
    this.dur = 1;
    this.sx = x;
    this.sy = y;
    this.tx = x;
    this.ty = y;
    this.workTimer = 0;
    this.targetNode = null;
    this.carryAnim = 'pawn_run_wood';
    this.play('pawn_idle');
    this.pickNewGoal();
  }

  play(key) {
    if (this.curAnim === key) return;
    this.curAnim = key;
    if (this.scene.anims.exists(key)) this.spr.play(key);
  }

  setMove(tx, ty, dur, anim) {
    this.sx = this.x;
    this.sy = this.y;
    this.tx = tx;
    this.ty = ty;
    this.t = 0;
    this.dur = dur;
    this.play(anim);
    this.spr.setFlipX(tx < this.x);
  }

  pickNewGoal() {
    const castle = this.scene.buildings.castle;
    this.homeX = castle ? castle.x : this.x;
    this.homeY = castle ? castle.y : this.y;

    const prod = this.scene.buildings.buildings.filter((b) => b.type.production && b.alive);
    if (prod.length > 0 && this.scene.nodes) {
      const b = Phaser.Utils.Array.GetRandom(prod);
      const g = GATHER[b.type.produces];
      const node = g ? this.scene.nodes.nearestNode(g.node, this.x, this.y) : null;
      if (node) {
        this.targetNode = node;
        this.carryAnim = g.carry;
        this.carryRes = b.type.produces;
        this.setMove(node.x, node.y, 3 + Math.random(), 'pawn_run'); // empty-handed out
        this.state = 'toNode';
        return;
      }
    }

    // Fallback: wander near the castle.
    const a = Math.random() * Math.PI * 2;
    const r = 20 + Math.random() * 50;
    this.setMove(this.homeX + Math.cos(a) * r, this.homeY + Math.sin(a) * r, 1.5 + Math.random(), 'pawn_run');
    this.state = 'wander';
  }

  update(dt) {
    if (this.state === 'gathering') {
      this.workTimer -= dt;
      if (this.workTimer <= 0) {
        this.setMove(this.homeX, this.homeY, 3 + Math.random(), this.carryAnim); // carry home
        this.state = 'toCastle';
      }
      this.sync();
      return;
    }

    this.t += dt;
    const k = Phaser.Math.Clamp(this.t / this.dur, 0, 1);
    // (Phase 5) ease-in-out instead of linear so movement feels organic.
    const ke = Phaser.Math.Easing.Sine.InOut(k);
    this.x = Phaser.Math.Linear(this.sx, this.tx, ke);
    this.y = Phaser.Math.Linear(this.sy, this.ty, ke);
    this.sync();

    if (k >= 1) {
      if (this.state === 'toNode') {
        if (this.targetNode && this.targetNode.alive) {
          this.targetNode.harvest();
          this.state = 'gathering';
          this.workTimer = 1.2;
          this.play('pawn_idle');
        } else {
          this.pickNewGoal(); // node gone — find another
        }
      } else {
        // Reached the castle carrying a resource — popup + a small delivery bounce.
        if (this.state === 'toCastle' && this.carryRes && this.scene.floatText) {
          const label = this.carryRes[0].toUpperCase() + this.carryRes.slice(1);
          this.scene.floatText(this.homeX + Phaser.Math.Between(-14, 14), this.homeY - 26, `+2 ${label}`, '#aee9ff');
          this.scene.tweens.add({ targets: this.spr, scaleX: SCALE * 1.25, scaleY: SCALE * 0.8, yoyo: true, duration: 120 });
        }
        this.pickNewGoal(); // reached castle or finished wandering
      }
    }
  }

  sync() {
    this.spr.x = this.x;
    this.spr.y = this.y;
  }

  destroy() {
    this.spr.destroy();
  }
}

export class PawnManager {
  constructor(scene) {
    this.scene = scene;
    this.pawns = [];
  }

  sync(targetCount) {
    while (this.pawns.length < targetCount) {
      const castle = this.scene.buildings.castle;
      const x = (castle ? castle.x : 480) + Phaser.Math.Between(-30, 30);
      const y = (castle ? castle.y : 400) + Phaser.Math.Between(-30, 30);
      this.pawns.push(new Pawn(this.scene, x, y));
    }
    while (this.pawns.length > targetCount) {
      this.pawns.pop().destroy();
    }
  }

  update(dt) {
    for (const p of this.pawns) p.update(dt);
  }
}
