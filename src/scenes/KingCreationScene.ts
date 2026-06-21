import Phaser from 'phaser';
import { GAME_W, GAME_H } from './GameScene.js';
import { TRAITS } from '../systems/Reputation.js';

// ============================================================================
// KingCreationScene — Phase 2 (Bannerlord rebuild) standalone king-creation.
// ============================================================================
//
// The new-game flow is: MainMenu → KingCreation → (first-play) IntroCutscene →
// ContinentScene. The legacy creation UI lived deep inside IsometricScene's
// 5000-line create(), which we no longer boot to start a campaign. Rather than
// spin up that whole scene just to name a king, this is a small self-contained
// overlay that reuses the SAME trait table (Reputation.TRAITS) and writes the
// SAME `kg_king` localStorage shape, so nothing downstream changes.
//
// On "Begin" it stores the king, then either plays the intro (first play) or
// goes straight to ContinentScene — both via the launcher callback passed in
// `init`, so this scene owns no campaign logic.
// ============================================================================

interface KingCreationData {
  /** Called with { kingdom, ruler, trait } when the player confirms. */
  onComplete?: (info: { kingdom: string; ruler: string; trait: string }) => void;
}

export class KingCreationScene extends Phaser.Scene {
  [key: string]: any;

  constructor() { super('KingCreationScene'); }

  init(data: KingCreationData) {
    this._onComplete = (data && data.onComplete) || null;
    this._domInputs = [];
    this._chosen = null;
  }

  create() {
    const fix = (o: any) => o.setScrollFactor(0);

    // Warm dark backdrop.
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 1).setOrigin(0, 0);
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const r = Math.round(12 + t * 30), g = Math.round(16 + t * 22), bl = Math.round(30 + t * 18);
      this.add.rectangle(0, i * (GAME_H / 14), GAME_W, GAME_H / 14 + 1, Phaser.Display.Color.GetColor(r, g, bl), 1).setOrigin(0, 0);
    }

    const W = 700, H = 500, px = (GAME_W - W) / 2, py = (GAME_H - H) / 2;
    this.add.rectangle(px, py, W, H, 0x1a1410, 0.99).setOrigin(0, 0).setStrokeStyle(3, 0xc9a14a, 0.9);
    this.add.text(GAME_W / 2, py + 20, 'FOUND YOUR KINGDOM', { fontFamily: 'serif', fontSize: '28px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.add.text(px + 34, py + 64, 'Kingdom name', { fontFamily: 'monospace', fontSize: '13px', color: '#cfc1a6' });
    this.add.text(px + 34, py + 108, 'Ruler name', { fontFamily: 'monospace', fontSize: '13px', color: '#cfc1a6' });

    // DOM inputs centred horizontally (robust to canvas scaling).
    const mk = (topPx: number, ph: string) => {
      const el = document.createElement('input');
      el.type = 'text'; el.placeholder = ph;
      el.style.cssText = `position:fixed;left:50%;transform:translateX(-50%);top:${topPx}px;width:300px;padding:7px 9px;font-family:monospace;font-size:14px;z-index:9999;background:#0e1219;color:#fff;border:1px solid #c9a14a;border-radius:4px;`;
      document.body.appendChild(el);
      return el;
    };
    const inK = mk(window.innerHeight / 2 - 168, 'Your Kingdom');
    const inR = mk(window.innerHeight / 2 - 124, 'The King');
    this._domInputs = [inK, inR];

    // Trait cards (2 rows × 3) reusing the shared TRAITS table.
    const cards: Phaser.GameObjects.Rectangle[] = [];
    const ids = Object.keys(TRAITS);
    const begin = this.add.rectangle(GAME_W / 2, py + H - 40, 200, 42, 0x39393f).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true });
    const beginTxt = this.add.text(GAME_W / 2, py + H - 40, 'Begin →', { fontFamily: 'serif', fontSize: '17px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

    ids.forEach((id, i) => {
      const t = TRAITS[id];
      const cw = 200, ch = 104, gx = px + 34 + (i % 3) * (cw + 14), gy = py + 158 + Math.floor(i / 3) * (ch + 12);
      const card = this.add.rectangle(gx, gy, cw, ch, 0x241a0e, 0.98).setOrigin(0, 0).setStrokeStyle(2, 0x55473a, 0.9).setInteractive({ useHandCursor: true });
      const ic = this.add.graphics(); ic.fillStyle(t.color, 1).fillCircle(gx + 24, gy + 26, 12);
      this.add.text(gx + 46, gy + 14, t.name, { fontFamily: 'monospace', fontSize: '14px', color: '#ffe9b0', fontStyle: 'bold' });
      this.add.text(gx + 12, gy + 48, (t.desc || []).join('\n'), { fontFamily: 'monospace', fontSize: '10px', color: '#cfc1a6', lineSpacing: 2 });
      void ic;
      cards.push(card);
      card.on('pointerdown', () => {
        this._chosen = id;
        cards.forEach(c => c.setStrokeStyle(2, 0x55473a, 0.9));
        card.setStrokeStyle(3, 0xffe23f, 1);
        begin.setFillStyle(0x1f5b3a);
      });
    });

    begin.on('pointerover', () => begin.setFillStyle(this._chosen ? 0x2a7a4f : 0x4a4a52));
    begin.on('pointerout', () => begin.setFillStyle(this._chosen ? 0x1f5b3a : 0x39393f));
    begin.on('pointerdown', () => {
      if (!this._chosen) { this.flashHint(beginTxt); return; }
      this.finish(inK.value, inR.value, this._chosen);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanupInputs());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanupInputs());
    this.cameras.main.fadeIn(300, 0, 0, 0);

    void fix;
  }

  flashHint(txt: Phaser.GameObjects.Text) {
    txt.setText('Choose a trait!');
    this.tweens.add({ targets: txt, alpha: 0.2, yoyo: true, duration: 160, repeat: 2, onComplete: () => txt.setText('Begin →') });
  }

  finish(kingdom: string, ruler: string, trait: string) {
    const k = (kingdom && kingdom.trim()) || 'Your Kingdom';
    const r = (ruler && ruler.trim()) || 'The King';
    // Persist the same shape IsometricScene reads, so the stand-in view inherits it.
    try { localStorage.setItem('kg_king', JSON.stringify({ kingdom: k, ruler: r, trait })); } catch (e) { /* ignore */ }
    this.cleanupInputs();
    const cb = this._onComplete; this._onComplete = null;
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.time.delayedCall(280, () => {
      this.scene.stop();
      if (cb) { try { cb({ kingdom: k, ruler: r, trait }); } catch (e) { console.error('[KingCreation] onComplete failed', e); } }
    });
  }

  cleanupInputs() {
    if (this._domInputs) { this._domInputs.forEach((el: HTMLInputElement) => { try { el.remove(); } catch (e) { /* ignore */ } }); this._domInputs = []; }
  }
}
