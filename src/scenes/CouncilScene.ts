import Phaser from 'phaser';
import { GAME_W, GAME_H } from './GameScene.js';
import { sfx } from '../audio/SoundEngine.js';

// CouncilScene (V2 Phase 2) — the Great Council is a rendered hall, not a panel.
// Launched by GreatCouncil.call() with the participating faction keys. It draws
// the hall (checkered marble floor, vaulted ceiling, chandelier, light shafts),
// seats the named leaders with framed portraits, lets the player choose a sealed
// proposal, plays a dramatic voting animation (portrait expand + glow, a pause on
// close votes, a unanimous flourish), then resolves — including a full kneeling
// ceremony if a High King is crowned — and records a continent-view aftermath.
const SEALS: Record<string, number> = { enemy: 0xc0392b, peace: 0x4a8a3a, trade: 0xc9a84c, highking: 0x9b7bd6 };

export class CouncilScene extends Phaser.Scene {
  [key: string]: any;
  constructor() { super('CouncilScene'); }

  init(data: any) { this.cfg = data || {}; }

  iso(): any { return this.scene.get('IsometricScene'); }

  create() {
    const iso = this.iso();
    this.participants = (this.cfg.participants || []).filter(Boolean);
    const stage = iso.currentStage ? iso.currentStage() : 7;
    this.drawHall(stage);
    this.seatLeaders(iso);
    this.cameras.main.fadeIn(500, 0, 0, 0);
    // Entrance → opening greeting → proposals.
    this.time.delayedCall(600, () => this.opening(iso));
  }

  // ---- the hall -----------------------------------------------------------
  drawHall(stage: number) {
    const marble = stage >= 9, dressed = stage >= 8;
    const floor = marble ? 0x2a2c34 : dressed ? 0x24262c : 0x202024;
    this.add.rectangle(0, 0, GAME_W, GAME_H, floor, 1).setOrigin(0, 0);

    const g = this.add.graphics().setDepth(1);
    // (V2 P2) Vaulted ceiling — ribs radiating from the centre-top apex.
    g.lineStyle(1, 0x3a3f4a, 0.5);
    for (let i = 0; i <= 10; i++) { g.beginPath(); g.moveTo((GAME_W / 10) * i, 0); g.lineTo(GAME_W / 2, 130); g.strokePath(); }
    g.lineStyle(1, 0x33373f, 0.35);
    for (let r = 30; r <= 120; r += 30) { g.beginPath(); g.arc(GAME_W / 2, 130, r, Math.PI, 0); g.strokePath(); } // vault arcs

    // (V2 P2) Light shafts — soft translucent beams from high windows.
    for (const sx of [GAME_W * 0.3, GAME_W * 0.7]) {
      g.fillStyle(0xfff2c0, 0.05); g.fillPoints([{ x: sx - 30, y: 130 }, { x: sx + 30, y: 130 }, { x: sx + 90, y: GAME_H }, { x: sx - 30, y: GAME_H }], true);
    }

    // (V2 P2) Checkered stone floor — alternating tiles with grout, in perspective.
    const dark = marble ? 0x23252e : 0x1c1e24, light = marble ? 0x32353f : 0x282b32;
    const ty0 = 200, tile = 48;
    for (let y = ty0, ry = 0; y < GAME_H; y += tile, ry++) {
      for (let x = 0, rx = 0; x < GAME_W; x += tile, rx++) {
        g.fillStyle((rx + ry) % 2 === 0 ? dark : light, 1); g.fillRect(x, y, tile, tile);
      }
    }
    g.lineStyle(1, 0x14151a, 0.6); // grout
    for (let y = ty0; y <= GAME_H; y += tile) { g.beginPath(); g.moveTo(0, y); g.lineTo(GAME_W, y); g.strokePath(); }
    for (let x = 0; x <= GAME_W; x += tile) { g.beginPath(); g.moveTo(x, ty0); g.lineTo(x, GAME_H); g.strokePath(); }

    // (V2 P2) Chandelier — a ring of candle dots hung from the apex, glowing.
    const chand = this.add.container(GAME_W / 2, 96).setDepth(3);
    const ring = this.add.graphics(); ring.lineStyle(3, 0x6a5a2a, 1); ring.strokeCircle(0, 0, 34); ring.lineStyle(2, 0x4a3a1a, 1); ring.lineBetween(0, -96, 0, -34);
    chand.add(ring);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; const fl = this.add.circle(Math.cos(a) * 34, Math.sin(a) * 34, 3.5, 0xffcf5a, 0.95); chand.add(fl); this.tweens.add({ targets: fl, alpha: 0.5, scale: 1.3, yoyo: true, repeat: -1, duration: 600 + k * 40 }); }
    const halo = this.add.circle(0, 0, 60, 0xffcf5a, 0.06); chand.add(halo);
    this.tweens.add({ targets: chand, y: 104, yoyo: true, repeat: -1, duration: 3200, ease: 'Sine.inOut' });

    // four pillars
    for (const px of [180, 360, GAME_W - 360, GAME_W - 180]) {
      this.add.rectangle(px, 130, 54, GAME_H - 130, 0x44474f).setOrigin(0.5, 0).setDepth(2);
      this.add.rectangle(px, 130, 64, 18, 0x55585f).setOrigin(0.5, 0).setDepth(2);
      const t = this.add.circle(px, 270, 12, 0xff9a3a, 0.85).setDepth(3);
      this.tweens.add({ targets: t, alpha: 0.5, scale: 1.2, yoyo: true, repeat: -1, duration: 700 });
    }
    // tapestries (faction + player colours)
    const cols = [0x2a4a9b, 0xc0392b, 0x8e44ad, 0xd6c04a];
    cols.forEach((c, i) => { const x = 100 + i * (GAME_W - 200) / 3; this.add.rectangle(x, 140, 44, 90, c, 0.85).setOrigin(0.5, 0).setDepth(2).setStrokeStyle(2, 0xc9a14a, 0.6); });
    // banquet table
    this.add.rectangle(GAME_W / 2, GAME_H * 0.58, 620, 120, 0x3a2a18).setDepth(4).setStrokeStyle(3, 0x5c3a1e, 1);
    // dais + throne at the far end
    this.add.rectangle(GAME_W / 2, 188, 200, 70, marble ? 0x3a3d48 : 0x2e3038).setDepth(3);
    this.add.rectangle(GAME_W / 2, 158, 60, 70, 0x6a5a2a).setDepth(4).setStrokeStyle(2, 0xc9a84c, 0.9);
    this.add.text(GAME_W / 2, 26, 'THE GREAT COUNCIL', { fontFamily: 'serif', fontSize: '34px', color: '#ffe9b0', fontStyle: 'bold', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5, 0).setDepth(20);
    // dust motes
    if (!this.textures.exists('council_dust')) { const dg = this.make.graphics({ x: 0, y: 0, add: false } as any); dg.fillStyle(0xffffff, 1); dg.fillCircle(2, 2, 2); dg.generateTexture('council_dust', 4, 4); dg.destroy(); }
    this.add.particles(0, 0, 'council_dust', { x: { min: 0, max: GAME_W }, y: { min: 130, max: GAME_H }, lifespan: 6000, speedY: { min: -6, max: 6 }, speedX: { min: -4, max: 4 }, scale: { min: 0.3, max: 0.8 }, alpha: { start: 0.18, end: 0 }, frequency: 200 }).setDepth(5);
  }

  // (V2 P2) Seat the leaders symmetrically behind the table with framed 80x100
  // portraits and a faction place-marker on the table in front of each.
  seatLeaders(iso: any) {
    this.reps = [];
    const n = this.participants.length;
    const y = GAME_H * 0.44;
    this.participants.forEach((fac: string, i: number) => {
      const x = GAME_W / 2 + (i - (n - 1) / 2) * 210;
      const pk = iso.leaders ? iso.leaders.portraitKey(fac) : null;
      const col = (iso.leaders && iso.leaders.def(fac) && iso.leaders.def(fac).color) || 0x888888;
      // gold frame + portrait (drawn larger, 80x100 feel)
      const frame = this.add.rectangle(x, y, 86, 106, 0x14110c, 0.96).setDepth(6).setStrokeStyle(3, 0xc9a14a, 0.95);
      const glow = this.add.rectangle(x, y, 96, 116, col, 0).setDepth(5); // approval/denial glow behind
      const face = pk && this.textures.exists(pk) ? this.add.image(x, y - 4, pk).setDisplaySize(78, 92).setDepth(7) : this.add.circle(x, y, 36, col).setDepth(7);
      // place-marker on the table
      this.add.rectangle(x, GAME_H * 0.56, 30, 14, col, 0.9).setDepth(5).setStrokeStyle(1, 0x1a1a1a, 0.6);
      const name = iso.leaders ? iso.leaders.name(fac) : fac;
      this.add.rectangle(x, y + 64, 120, 20, 0x14110c, 0.9).setDepth(7).setStrokeStyle(1, 0xc9a14a, 0.5);
      this.add.text(x, y + 64, name, { fontFamily: 'serif', fontSize: '13px', color: '#e7d6b0', fontStyle: 'bold' }).setOrigin(0.5).setDepth(8);
      this.reps.push({ fac, x, y: y - 4, face, frame, glow, baseScaleX: face.scaleX, baseScaleY: face.scaleY });
    });
  }

  bubble(x: number, y: number, text: string, col = 0xc9a14a) {
    const w = 280;
    const els: any[] = [];
    els.push(this.add.rectangle(x, y, w, 50, 0x141019, 0.97).setOrigin(0.5, 1).setDepth(40).setStrokeStyle(2, col, 0.9));
    els.push(this.add.text(x, y - 42, text, { fontFamily: 'monospace', fontSize: '12px', color: '#f0e6d0', fontStyle: 'italic', wordWrap: { width: w - 20 }, align: 'center' }).setOrigin(0.5, 0).setDepth(41));
    this.time.delayedCall(2600, () => els.forEach((o) => o.destroy()));
  }

  opening(iso: any) {
    this.reps.forEach((r: any, i: number) => {
      this.time.delayedCall(i * 700, () => {
        const line = (iso.leaders && iso.leaders.def(r.fac) && (iso.leaders.def(r.fac).lines.council || [])[0]) || '...';
        this.bubble(r.x, r.y - 56, line, (iso.leaders.def(r.fac).color));
      });
    });
    this.time.delayedCall(this.reps.length * 700 + 800, () => this.showProposals(iso));
  }

  // ---- proposals (sealed letters) -----------------------------------------
  showProposals(iso: any) {
    const gc = iso.greatCouncil;
    const enemy = gc && gc.commonEnemyCandidate ? gc.commonEnemyCandidate() : null;
    this._enemyTargetKey = enemy ? enemy.cfg.key : null; // (V2 P2) remembered for the continent aftermath
    const props: any[] = [
      ['enemy', 'Declare Common Enemy', enemy ? `Unite against ${iso.leaders.name(enemy.cfg.key)}.` : 'No common foe — unavailable.', !!enemy, () => gc.declareCommonEnemy()],
      ['peace', 'Continental Peace', '+10% production, 15 days of calm.', true, () => gc.continentalPeace()],
      ['trade', 'Trade Compact', '+15 gold/day per partner, protected caravans.', true, () => gc.tradeCompactProposal()],
      ['highking', 'Crown a High King', this.cfg.highKing ? 'They name YOU High King. (Diplomacy win)' : 'Requires Conqueror 75+.', !!this.cfg.highKing, () => gc.crownHighKing()],
    ];
    this.add.rectangle(GAME_W / 2, GAME_H - 120, 760, 150, 0xe8dcc0, 0.96).setDepth(30).setStrokeStyle(3, 0x8a6a3a, 1);
    this.add.text(GAME_W / 2, GAME_H - 182, 'Choose your decree, Your Grace:', { fontFamily: 'serif', fontSize: '16px', color: '#3a2a18', fontStyle: 'bold' }).setOrigin(0.5).setDepth(31);
    const bw = 178, gap = 8, total = props.length * bw + (props.length - 1) * gap, x0 = (GAME_W - total) / 2;
    this._proposalEls = [];
    props.forEach((p, i) => {
      const [seal, title, desc, enabled, fn] = p;
      const x = x0 + i * (bw + gap);
      const letter = this.add.rectangle(x, GAME_H - 150, bw, 96, enabled ? 0xf2ead6 : 0xcfc6b2, 1).setOrigin(0, 0).setDepth(31).setStrokeStyle(2, 0x8a6a3a, enabled ? 1 : 0.4);
      this.add.circle(x + bw / 2, GAME_H - 150, 12, SEALS[seal], enabled ? 1 : 0.4).setDepth(32);
      this.add.text(x + bw / 2, GAME_H - 128, title, { fontFamily: 'monospace', fontSize: '12px', color: enabled ? '#2a1a0a' : '#7a6a55', fontStyle: 'bold', align: 'center', wordWrap: { width: bw - 12 } }).setOrigin(0.5, 0).setDepth(32);
      this.add.text(x + bw / 2, GAME_H - 92, desc, { fontFamily: 'monospace', fontSize: '9px', color: enabled ? '#5a4a30' : '#8a7a60', align: 'center', wordWrap: { width: bw - 14 } }).setOrigin(0.5, 0).setDepth(32);
      if (enabled) { letter.setInteractive({ useHandCursor: true }); letter.on('pointerover', () => letter.setFillStyle(0xfff6e2)); letter.on('pointerout', () => letter.setFillStyle(0xf2ead6)); letter.on('pointerdown', () => this.choose(iso, fn, title, seal)); }
    });
  }

  choose(iso: any, applyFn: () => void, title: string, seal: string) {
    if (this._chosen) return; this._chosen = true;
    this._seal = seal;
    // deliberation dots
    const dots = this.reps.map((r: any) => this.add.text(r.x, r.y - 58, '', { fontFamily: 'monospace', fontSize: '18px', color: '#fff' }).setOrigin(0.5).setDepth(42));
    let d = 0; this.time.addEvent({ delay: 250, repeat: 8, callback: () => { d = (d + 1) % 4; dots.forEach((o: any) => o.setText('.'.repeat(d))); } });
    this.time.delayedCall(2400, () => {
      dots.forEach((o: any) => o.destroy());
      const iso2 = this.iso();
      // (V2 P2) Pre-compute votes so we can dramatise close/unanimous outcomes.
      const votes = this.reps.map((r: any) => {
        const rel = iso2.diplomacy ? iso2.diplomacy.get(r.fac) : 60;
        return rel >= 50 || Math.random() < 0.7;
      });
      const yes = votes.filter(Boolean).length, n = this.reps.length;
      const close = Math.abs(yes - (n - yes)) <= 1 && n >= 3; // a 2-1 split
      this.animateVotes(iso2, votes, close, () => {
        const passed = yes > n / 2;
        if (passed && yes === n) this.unanimousFlourish();
        this.time.delayedCall(passed && yes === n ? 900 : 300, () => this.resolve(iso2, applyFn, passed, title));
      });
    });
  }

  // (V2 P2) Reveal votes one at a time with drama: the portrait swells, a green
  // glow for approval or a red shake for refusal. A close vote pauses before the
  // deciding ballot is cast.
  animateVotes(iso: any, votes: boolean[], close: boolean, done: () => void) {
    let i = 0;
    const step = () => {
      if (i >= this.reps.length) { done(); return; }
      const r = this.reps[i], approve = votes[i];
      if (!approve && iso.diplomacy) iso.diplomacy.change(r.fac, -10, 'voted against you');
      // dramatic pause before the final, deciding vote of a close council
      const isDecider = close && i === this.reps.length - 1;
      const delay = isDecider ? 2000 : 0;
      if (isDecider) {
        const susp = this.add.text(GAME_W / 2, GAME_H * 0.3, 'The deciding vote...', { fontFamily: 'serif', fontSize: '22px', color: '#ffe9b0', fontStyle: 'italic', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5).setDepth(46);
        this.tweens.add({ targets: susp, alpha: 0.3, yoyo: true, repeat: 3, duration: 250 });
        this.time.delayedCall(delay, () => susp.destroy());
      }
      this.time.delayedCall(delay, () => {
        // portrait swells
        this.tweens.add({ targets: r.face, scaleX: r.baseScaleX * 1.2, scaleY: r.baseScaleY * 1.2, yoyo: true, duration: 320, ease: 'Quad.out' });
        if (approve) {
          r.glow.setFillStyle(0x4ad66b, 0); this.tweens.add({ targets: r.glow, fillAlpha: 0.5, yoyo: true, duration: 500 });
        } else {
          r.glow.setFillStyle(0xd64a4a, 0); this.tweens.add({ targets: r.glow, fillAlpha: 0.5, yoyo: true, duration: 500 });
          this.tweens.add({ targets: r.face, angle: { from: -7, to: 7 }, yoyo: true, repeat: 2, duration: 90, onComplete: () => { r.face.angle = 0; } }); // shaking "no"
        }
        this.add.text(r.x, r.y - 58, approve ? '✓' : '✗', { fontFamily: 'monospace', fontSize: '26px', color: approve ? '#4ad66b' : '#d64a4a', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(43);
        sfx.play(approve ? 'unit_trained' : 'enemy_dies');
        i++; this.time.delayedCall(500, step);
      });
    };
    step();
  }

  // (V2 P2) Every leader approves — all portraits glow gold at once.
  unanimousFlourish() {
    for (const r of this.reps) { r.glow.setFillStyle(0xffe9a8, 0); this.tweens.add({ targets: r.glow, fillAlpha: 0.7, yoyo: true, duration: 700 }); this.tweens.add({ targets: r.face, scaleX: r.baseScaleX * 1.15, scaleY: r.baseScaleY * 1.15, yoyo: true, duration: 500 }); }
    sfx.play('victory');
  }

  resolve(iso: any, applyFn: () => void, passed: boolean, title: string) {
    const highKing = title.indexOf('High King') >= 0;
    if (passed) {
      try { applyFn(); } catch (e) { /* GreatCouncil applies effects + aftermath */ }
      this.recordContinentAftermath(iso); // (V2 P2)
      if (highKing) { this.highKingCeremony(iso); return; }
      const flash = this.add.rectangle(0, 0, GAME_W, GAME_H, 0xffe9a8, 0).setOrigin(0, 0).setDepth(50);
      this.tweens.add({ targets: flash, fillAlpha: 0.5, yoyo: true, duration: 600 });
      this.add.text(GAME_W / 2, GAME_H / 2 - 40, 'THE COUNCIL AGREES', { fontFamily: 'serif', fontSize: 30, color: '#ffe9b0', fontStyle: 'bold', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5).setDepth(51);
      this.time.delayedCall(2600, () => this.exit());
    } else {
      this.add.text(GAME_W / 2, GAME_H / 2 - 40, 'THE COUNCIL REFUSES', { fontFamily: 'serif', fontSize: 30, color: '#d64a4a', fontStyle: 'bold', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5).setDepth(51);
      this.time.delayedCall(2600, () => this.exit());
    }
  }

  // (V2 P2) The crowning of a High King — every leader kneels, gold rains, the
  // camera pulls back, and the hall proclaims your name.
  highKingCeremony(iso: any) {
    for (const r of this.reps) {
      this.tweens.add({ targets: r.face, y: r.face.y + 28, duration: 1100, ease: 'Quad.in' });
      this.tweens.add({ targets: r.face, angle: r.x < GAME_W / 2 ? 14 : -14, duration: 1100, ease: 'Quad.in' }); // bow toward the throne
    }
    // gold particles rain
    if (!this.textures.exists('council_gold')) { const cg = this.make.graphics({ x: 0, y: 0, add: false } as any); cg.fillStyle(0xffd24a, 1); cg.fillRect(0, 0, 4, 4); cg.generateTexture('council_gold', 4, 4); cg.destroy(); }
    this.add.particles(0, -10, 'council_gold', { x: { min: 0, max: GAME_W }, y: -10, lifespan: 3200, speedY: { min: 90, max: 200 }, speedX: { min: -30, max: 30 }, scale: { min: 0.8, max: 2 }, rotate: { min: 0, max: 360 }, tint: [0xffd24a, 0xffe9a8, 0xc9a84c], quantity: 4, frequency: 40, duration: 2600 }).setDepth(60);
    sfx.play('victory'); this.time.delayedCall(350, () => sfx.play('tier_upgrade')); // dramatic chord
    this.cameras.main.zoomTo(0.82, 1600);
    const kn = iso.kingdomName || 'your kingdom';
    this.add.text(GAME_W / 2, GAME_H / 2 - 50, 'LONG LIVE THE HIGH KING', { fontFamily: 'serif', fontSize: 42, color: '#ffe9b0', fontStyle: 'bold', stroke: '#000', strokeThickness: 7 }).setOrigin(0.5).setDepth(61).setScrollFactor(0);
    this.add.text(GAME_W / 2, GAME_H / 2 + 6, `All kingdoms bow before ${kn}`, { fontFamily: 'serif', fontSize: 20, color: '#f0e6d0', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5).setDepth(61).setScrollFactor(0);
    this.time.delayedCall(4200, () => this.exit());
  }

  // (V2 P2) Record what the continent view should show after this council.
  recordContinentAftermath(iso: any) {
    const type = this._seal; // enemy | peace | trade | highking
    iso._councilEffect = { type, participants: [...this.participants], target: this._enemyTargetKey, day: iso.gameDay || 0 };
  }

  exit() {
    this.cameras.main.fadeOut(500, 0, 0, 0);
    this.time.delayedCall(550, () => { try { this.scene.resume('IsometricScene'); } catch (e) {} this.scene.stop(); });
  }
}
