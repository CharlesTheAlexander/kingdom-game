import Phaser from 'phaser';

// Diplomacy (Phase 7). Each AI kingdom has a relationship value (-100..+100)
// with the player that drifts and reacts to actions, gating how aggressively
// they attack and unlocking pacts/alliances at high values.

const THRESH = (r) => (r <= -80 ? 'Coordinated' : r < -50 ? 'Hostile' : r < 0 ? 'Neutral' : r < 50 ? 'Cautious' : r < 80 ? 'Friendly' : 'Allied');

export class Diplomacy {
  constructor(scene) {
    this.scene = scene;
    this.rel = {};
    this.nap = {}; // non-aggression pact accepted
    this.ally = {};
    this._days = {};
    for (const k of scene.kingdoms) { this.rel[k.cfg.key] = 0; this._days[k.cfg.key] = 0; }
  }

  get(key) { return this.rel[key] || 0; }
  status(key) { return this.nap[key] ? (this.ally[key] ? 'Allied (pact)' : 'Non-aggression') : THRESH(this.get(key)); }
  change(key, d, reason) { this.rel[key] = Phaser.Math.Clamp((this.rel[key] || 0) + d, -100, 100); if (reason) this._last = `${key}: ${reason}`; }

  onPlayerAttack(key) { this.change(key, -15, 'you attacked them'); }
  onBuildingDestroyed(key) { this.change(key, -25, 'you destroyed a building'); }

  sendTribute(key) {
    if (!this.scene.resources.spend({ gold: 50 })) { this.scene.showToast('Need 50 gold'); return; }
    this.change(key, 20, 'tribute');
    this.scene.refreshPanel();
  }
  declareWar(key) {
    this.rel[key] = -100; this.nap[key] = false; this.ally[key] = false;
    const k = this.scene.kingdoms.find((x) => x.cfg.key === key);
    if (k) k.startDay = Math.min(k.startDay, this.scene.gameDay);
    this.scene.refreshPanel();
  }
  acceptPact(key) {
    if (this.get(key) < 50) return;
    const cost = this.get(key) >= 80 ? 200 : 100;
    if (!this.scene.resources.spend({ gold: cost })) { this.scene.showToast(`Need ${cost} gold`); return; }
    this.nap[key] = true;
    if (this.get(key) >= 80) this.ally[key] = true; // trade alliance
    this.scene.refreshPanel();
  }

  // Multiplier on a kingdom's willingness to attack (0 = will not attack).
  attackModifier(k) {
    const key = k.cfg.key;
    if (this.nap[key] || this.ally[key]) return 0;
    const r = this.get(key);
    return r <= -50 ? 1.3 : r >= 50 ? 0 : r >= 0 ? 0.7 : 1;
  }
  // Alliance gives a small resource bonus (applied as gold/day in onNewDay).
  onNewDay() {
    for (const k of this.scene.kingdoms) {
      const key = k.cfg.key;
      this._days[key] = (this._days[key] || 0) + 1;
      if (this._days[key] % 3 === 0 && !this.nap[key]) this.change(key, 1); // peace over time
      if (this.ally[key]) this.scene.resources.add('gold', 5); // +trade bonus
    }
  }
}
