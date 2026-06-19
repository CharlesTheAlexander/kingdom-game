import Phaser from 'phaser';

// Visual worker pawns (Phase 2 manual-allocation rewrite).
// Each pawn is either ASSIGNED to a building (matching that building's allocated
// worker count) or IDLE. Assigned pawns at a gathering building (Lumberyard /
// Mine / Farm) walk to the matching wilderness node and carry the resource home;
// assigned to a Tower/Barracks they mill around the building; idle pawns wander
// near the castle. Purely visual — production runs off the building worker count.

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
    this.assigned = null; // building this pawn works at (Phase 2)
    this._reassign = false;
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
    this.carryRes = null;
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
    this.carryRes = null;

    const b = this.assigned;
    if (b && b.alive) {
      const g = b.type.produces ? GATHER[b.type.produces] : null;
      const node = g && this.scene.nodes ? this.scene.nodes.nearestNode(g.node, this.x, this.y) : null;
      if (node) {
        // Gathering building → walk out to the resource node.
        this.targetNode = node;
        this.carryAnim = g.carry;
        this.carryRes = b.type.produces;
        this.setMove(node.x, node.y, 3 + Math.random(), 'pawn_run');
        this.state = 'toNode';
        return;
      }
      // Non-gathering building (Tower/Barracks) → mill around it.
      this.setMove(b.x + Phaser.Math.Between(-18, 18), b.y + Phaser.Math.Between(8, 26), 1.5 + Math.random(), 'pawn_run');
      this.state = 'wander';
      return;
    }

    // Idle: wander near the castle in a small radius.
    const a = Math.random() * Math.PI * 2;
    const r = 16 + Math.random() * 40;
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
    const ke = Phaser.Math.Easing.Sine.InOut(k); // (Phase 5) organic easing
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
          this.pickNewGoal();
        }
      } else {
        if (this.state === 'toCastle' && this.carryRes && this.scene.floatText) {
          const label = this.carryRes[0].toUpperCase() + this.carryRes.slice(1);
          this.scene.floatText(this.homeX + Phaser.Math.Between(-14, 14), this.homeY - 26, `+2 ${label}`, '#aee9ff');
          this.scene.tweens.add({ targets: this.spr, scaleX: SCALE * 1.25, scaleY: SCALE * 0.8, yoyo: true, duration: 120 });
        }
        this.pickNewGoal();
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

  // Match pawn assignments to each building's allocated worker count (Phase 2).
  reconcile() {
    // Drop assignments to dead / de-staffed buildings.
    for (const p of this.pawns) {
      if (p.assigned && (!p.assigned.alive || p.assigned.workers <= 0)) {
        p.assigned = null;
        p._reassign = true;
      }
    }
    const staffed = this.scene.buildings.buildings.filter((b) => b.alive && b.workers > 0);
    // Unassign over-allocated, then fill under-allocated from idle pawns.
    for (const b of staffed) {
      let have = this.pawns.filter((p) => p.assigned === b).length;
      while (have > b.workers) {
        const p = this.pawns.find((pp) => pp.assigned === b);
        p.assigned = null;
        p._reassign = true;
        have--;
      }
    }
    for (const b of staffed) {
      let have = this.pawns.filter((p) => p.assigned === b).length;
      while (have < b.workers) {
        const p = this.pawns.find((pp) => !pp.assigned);
        if (!p) break;
        p.assigned = b;
        p._reassign = true;
        have++;
      }
    }
    for (const p of this.pawns) {
      if (p._reassign) {
        p._reassign = false;
        p.pickNewGoal();
      }
    }
  }

  update(dt) {
    this.reconcile();
    for (const p of this.pawns) p.update(dt);
  }
}
