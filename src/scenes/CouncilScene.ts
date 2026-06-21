import Phaser from 'phaser';
import { GAME_W, GAME_H } from './GameScene.js';

// CouncilScene (V2 Phase 2) — the Great Council is a rendered hall, not a panel.
// Launched by GreatCouncil.call() with the participating faction keys. It draws
// the hall, seats the leaders, lets the player choose a sealed proposal, plays a
// voting animation, then calls back into GreatCouncil to apply the result.
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
    // ceiling perspective lines
    const g = this.add.graphics().setDepth(1);
    g.lineStyle(1, 0x3a3f4a, 0.5);
    for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo((GAME_W / 8) * i, 0); g.lineTo(GAME_W / 2, 120); g.strokePath(); }
    // flagstones
    g.lineStyle(1, marble ? 0x3a3d48 : 0x2c2e36, 0.7);
    for (let y = 200; y < GAME_H; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(GAME_W, y); g.strokePath(); }
    for (let x = 0; x < GAME_W; x += 64) { g.beginPath(); g.moveTo(x, 200); g.lineTo(x, GAME_H); g.strokePath(); }
    // four pillars
    for (const px of [180, 360, GAME_W - 360, GAME_W - 180]) {
      this.add.rectangle(px, 120, 54, GAME_H - 120, 0x44474f).setOrigin(0.5, 0).setDepth(2);
      this.add.rectangle(px, 120, 64, 18, 0x55585f).setOrigin(0.5, 0).setDepth(2); // capital
      // torch glow
      const t = this.add.circle(px, 260, 12, 0xff9a3a, 0.85).setDepth(3);
      this.tweens.add({ targets: t, alpha: 0.5, scale: 1.2, yoyo: true, repeat: -1, duration: 700 });
    }
    // tapestries (faction + player colours)
    const cols = [0x2a4a9b, 0xc0392b, 0x8e44ad, 0xd6c04a];
    cols.forEach((c, i) => { const x = 100 + i * (GAME_W - 200) / 3; this.add.rectangle(x, 130, 44, 90, c, 0.85).setOrigin(0.5, 0).setDepth(2).setStrokeStyle(2, 0xc9a14a, 0.6); });
    // banquet table
    this.add.rectangle(GAME_W / 2, GAME_H * 0.58, 620, 120, 0x3a2a18).setDepth(4).setStrokeStyle(3, 0x5c3a1e, 1);
    // dais + throne at the far end
    this.add.rectangle(GAME_W / 2, 180, 200, 70, marble ? 0x3a3d48 : 0x2e3038).setDepth(3);
    this.add.rectangle(GAME_W / 2, 150, 60, 70, 0x6a5a2a).setDepth(4).setStrokeStyle(2, 0xc9a84c, 0.9); // throne
    this.add.text(GAME_W / 2, 26, 'THE GREAT COUNCIL', { fontFamily: 'serif', fontSize: '34px', color: '#ffe9b0', fontStyle: 'bold', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5, 0).setDepth(20);
    // dust motes
    if (!this.textures.exists('council_dust')) { const dg = this.make.graphics({ x: 0, y: 0, add: false } as any); dg.fillStyle(0xffffff, 1); dg.fillCircle(2, 2, 2); dg.generateTexture('council_dust', 4, 4); dg.destroy(); }
    this.add.particles(0, 0, 'council_dust', { x: { min: 0, max: GAME_W }, y: { min: 120, max: GAME_H }, lifespan: 6000, speedY: { min: -6, max: 6 }, speedX: { min: -4, max: 4 }, scale: { min: 0.3, max: 0.8 }, alpha: { start: 0.18, end: 0 }, frequency: 200 }).setDepth(5);
  }

  seatLeaders(iso: any) {
    this.reps = [];
    const n = this.participants.length;
    this.participants.forEach((fac: string, i: number) => {
      const x = GAME_W / 2 - (n - 1) * 150 / 2 + i * 150;
      const side = i % 2 === 0 ? GAME_H * 0.5 : GAME_H * 0.66;
      const pk = iso.leaders ? iso.leaders.portraitKey(fac) : null;
      const col = (iso.leaders && iso.leaders.def(fac) && iso.leaders.def(fac).color) || 0x888888;
      this.add.rectangle(x, side + 26, 50, 56, col, 0.85).setDepth(6).setStrokeStyle(2, 0x1a1a1a, 0.6); // seated body
      const face = pk && this.textures.exists(pk) ? this.add.image(x, side - 14, pk).setDisplaySize(56, 56).setDepth(7) : this.add.circle(x, side - 14, 26, col).setDepth(7);
      const name = iso.leaders ? iso.leaders.name(fac) : fac;
      this.add.text(x, side + 56, name, { fontFamily: 'monospace', fontSize: '11px', color: '#e7d6b0', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(8);
      this.reps.push({ fac, x, y: side - 14, face });
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
    // each leader greets in turn, then the proposals unfurl
    this.reps.forEach((r: any, i: number) => {
      this.time.delayedCall(i * 700, () => {
        const line = (iso.leaders && iso.leaders.def(r.fac) && (iso.leaders.def(r.fac).lines.council || [])[0]) || '...';
        this.bubble(r.x, r.y - 34, line, (iso.leaders.def(r.fac).color));
      });
    });
    this.time.delayedCall(this.reps.length * 700 + 800, () => this.showProposals(iso));
  }

  // ---- proposals (sealed letters) -----------------------------------------
  showProposals(iso: any) {
    const gc = iso.greatCouncil;
    const enemy = gc && gc.commonEnemyCandidate ? gc.commonEnemyCandidate() : null;
    const props: any[] = [
      ['enemy', 'Declare Common Enemy', enemy ? `Unite against ${iso.leaders.name(enemy.cfg.key)}.` : 'No common foe — unavailable.', !!enemy, () => gc.declareCommonEnemy()],
      ['peace', 'Continental Peace', '+10% production, 15 days of calm.', true, () => gc.continentalPeace()],
      ['trade', 'Trade Compact', '+15 gold/day per partner, protected caravans.', true, () => gc.tradeCompactProposal()],
      ['highking', 'Crown a High King', this.cfg.highKing ? 'They name YOU High King. (Diplomacy win)' : 'Requires Conqueror 75+.', !!this.cfg.highKing, () => gc.crownHighKing()],
    ];
    // scroll backdrop
    this.add.rectangle(GAME_W / 2, GAME_H - 120, 760, 150, 0xe8dcc0, 0.96).setDepth(30).setStrokeStyle(3, 0x8a6a3a, 1);
    this.add.text(GAME_W / 2, GAME_H - 182, 'Choose your decree, Your Grace:', { fontFamily: 'serif', fontSize: '16px', color: '#3a2a18', fontStyle: 'bold' }).setOrigin(0.5).setDepth(31);
    const bw = 178, gap = 8, total = props.length * bw + (props.length - 1) * gap, x0 = (GAME_W - total) / 2;
    props.forEach((p, i) => {
      const [seal, title, desc, enabled, fn] = p;
      const x = x0 + i * (bw + gap);
      const letter = this.add.rectangle(x, GAME_H - 150, bw, 96, enabled ? 0xf2ead6 : 0xcfc6b2, 1).setOrigin(0, 0).setDepth(31).setStrokeStyle(2, 0x8a6a3a, enabled ? 1 : 0.4);
      this.add.circle(x + bw / 2, GAME_H - 150, 12, SEALS[seal], enabled ? 1 : 0.4).setDepth(32); // wax seal
      this.add.text(x + bw / 2, GAME_H - 128, title, { fontFamily: 'monospace', fontSize: '12px', color: enabled ? '#2a1a0a' : '#7a6a55', fontStyle: 'bold', align: 'center', wordWrap: { width: bw - 12 } }).setOrigin(0.5, 0).setDepth(32);
      this.add.text(x + bw / 2, GAME_H - 92, desc, { fontFamily: 'monospace', fontSize: '9px', color: enabled ? '#5a4a30' : '#8a7a60', align: 'center', wordWrap: { width: bw - 14 } }).setOrigin(0.5, 0).setDepth(32);
      if (enabled) { letter.setInteractive({ useHandCursor: true }); letter.on('pointerover', () => letter.setFillStyle(0xfff6e2)); letter.on('pointerout', () => letter.setFillStyle(0xf2ead6)); letter.on('pointerdown', () => this.choose(iso, fn, title)); }
    });
  }

  choose(iso: any, applyFn: () => void, title: string) {
    if (this._chosen) return; this._chosen = true;
    // deliberation dots
    const dots = this.reps.map((r: any) => this.add.text(r.x, r.y - 36, '', { fontFamily: 'monospace', fontSize: '16px', color: '#fff' }).setOrigin(0.5).setDepth(42));
    let d = 0; const dt = this.time.addEvent({ delay: 250, repeat: 8, callback: () => { d = (d + 1) % 4; dots.forEach((o: any) => o.setText('.'.repeat(d))); } });
    this.time.delayedCall(2400, () => {
      dots.forEach((o: any) => o.destroy());
      // voting
      const iso2 = this.iso();
      let yes = 0;
      this.reps.forEach((r: any, i: number) => {
        this.time.delayedCall(i * 500, () => {
          const rel = iso2.diplomacy ? iso2.diplomacy.get(r.fac) : 60;
          const vote = rel >= 50 || Math.random() < 0.7;
          if (vote) yes++; else if (iso2.diplomacy) iso2.diplomacy.change(r.fac, -10, 'voted against you');
          this.add.text(r.x, r.y - 36, vote ? '✓' : '✗', { fontFamily: 'monospace', fontSize: '22px', color: vote ? '#4ad66b' : '#d64a4a', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(42);
        });
      });
      this.time.delayedCall(this.reps.length * 500 + 700, () => this.resolve(iso2, applyFn, yes > this.reps.length / 2, title));
    });
  }

  resolve(iso: any, applyFn: () => void, passed: boolean, title: string) {
    const highKing = title.indexOf('High King') >= 0;
    if (passed) {
      try { applyFn(); } catch (e) { /* GreatCouncil applies effects + aftermath */ }
      const flash = this.add.rectangle(0, 0, GAME_W, GAME_H, 0xffe9a8, 0).setOrigin(0, 0).setDepth(50);
      this.tweens.add({ targets: flash, fillAlpha: 0.5, yoyo: true, duration: 600 });
      this.add.text(GAME_W / 2, GAME_H / 2 - 40, highKing ? 'LONG LIVE THE HIGH KING' : 'THE COUNCIL AGREES', { fontFamily: 'serif', fontSize: highKing ? 40 : 30, color: '#ffe9b0', fontStyle: 'bold', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5).setDepth(51);
      if (highKing) this.cameras.main.zoomTo(0.85, 1200);
    } else {
      this.add.text(GAME_W / 2, GAME_H / 2 - 40, 'THE COUNCIL REFUSES', { fontFamily: 'serif', fontSize: 30, color: '#d64a4a', fontStyle: 'bold', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5).setDepth(51);
    }
    this.time.delayedCall(2600, () => this.exit());
  }

  exit() {
    this.cameras.main.fadeOut(500, 0, 0, 0);
    this.time.delayedCall(550, () => { try { this.scene.resume('IsometricScene'); } catch (e) {} this.scene.stop(); });
  }
}
