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
    this.treaties = {}; // key -> { trade, alliance, vassal }
    this._days = {};
    this._coalitionPending = false;
    this._coalitionDay = 0;
    for (const k of scene.kingdoms) { this.rel[k.cfg.key] = 0; this._days[k.cfg.key] = 0; this.treaties[k.cfg.key] = { trade: false, alliance: false, vassal: false }; }
  }

  tr(key) { return this.treaties[key] || (this.treaties[key] = { trade: false, alliance: false, vassal: false }); }

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

  // ---- (Phase 6) treaties -------------------------------------------------
  proposeTrade(key) {
    if (this.get(key) < 30) { this.scene.showToast('Need +30 relations'); return; }
    this.tr(key).trade = true;
    this.scene.logEvent && this.scene.logEvent(`Trade agreement with ${this.kname(key)}`, 'green');
    this.scene.refreshPanel();
  }
  proposeAlliance(key) {
    if (this.get(key) < 60) { this.scene.showToast('Need +60 relations'); return; }
    if (!this.scene.resources.spend({ gold: 200 })) { this.scene.showToast('Need 200 gold'); return; }
    this.tr(key).alliance = true; this.nap[key] = true; this.ally[key] = true;
    this.scene.logEvent && this.scene.logEvent(`Military alliance with ${this.kname(key)}`, 'green');
    this.scene.refreshPanel();
  }
  demandVassal(key) {
    const rep = this.scene.reputation ? this.scene.reputation.scores.conqueror : 0;
    const r = this.get(key);
    if (rep < 50 || r < -20 || r > 20) { this.scene.showToast('Need Conqueror 50+ and neutral relations'); return; }
    const k = this.scene.kingdoms.find((x) => x.cfg.key === key);
    const stronger = !k || k.estimatedArmy() < (this.scene.troops ? this.scene.troops.count + 5 : 5);
    if (stronger) { this.tr(key).vassal = true; this.nap[key] = true; this.scene.logEvent && this.scene.logEvent(`${this.kname(key)} is now your vassal`, 'green'); }
    else { this.declareWar(key); this.scene.logEvent && this.scene.logEvent(`${this.kname(key)} refused vassalage — war!`, 'red'); }
    this.scene.refreshPanel();
  }
  breakTreaty(key) {
    const t = this.tr(key); t.trade = false; t.alliance = false; t.vassal = false; this.ally[key] = false;
    this.change(key, -10, 'broke a treaty');
    this.scene.refreshPanel();
  }
  kname(key) { const k = this.scene.kingdoms.find((x) => x.cfg.key === key); return k ? k.cfg.name : key; }

  // Multiplier on a kingdom's willingness to attack (0 = will not attack).
  attackModifier(k) {
    const key = k.cfg.key;
    if (this.nap[key] || this.ally[key] || this.tr(key).vassal) return 0;
    const r = this.get(key);
    return r <= -50 ? 1.3 : r >= 50 ? 0 : r >= 0 ? 0.7 : 1;
  }

  // (Phase 6) An ally sends reinforcements when the player is attacked.
  onPlayerAttacked() {
    const allied = this.scene.kingdoms.find((k) => this.tr(k.cfg.key).alliance);
    if (!allied) return;
    if (this.scene.troops && this.scene.troops.spawn) { const c = this.scene.buildings.castle; for (let i = 0; i < 5; i++) this.scene.troops.spawn(c); }
    this.scene.threatWarning && this.scene.threatWarning(`${allied.cfg.name} sends reinforcements!`, 0x7cfc7c, true);
  }

  onNewDay() {
    for (const k of this.scene.kingdoms) {
      const key = k.cfg.key; const t = this.tr(key);
      this._days[key] = (this._days[key] || 0) + 1;
      if (this._days[key] % 3 === 0 && !this.nap[key]) this.change(key, 1); // peace over time
      if (this.ally[key]) this.scene.resources.add('gold', 5);
      if (t.trade) { this.scene.resources.add('gold', 20); } // trade agreement income
      if (t.vassal) { this.scene.resources.add('gold', 50); } // vassal tribute
    }
    this.checkCoalition();
  }

  // (Phase 6) Coalition: 2+ kingdoms at -80 form a coordinated assault after 3 days.
  checkCoalition() {
    const hostiles = this.scene.kingdoms.filter((k) => k.castleAlive && this.get(k.cfg.key) <= -80 && !this.nap[k.cfg.key]);
    if (!this._coalitionPending && hostiles.length >= 2) {
      this._coalitionPending = true; this._coalitionDay = this.scene.gameDay + 3;
      this.scene.threatWarning && this.scene.threatWarning('A coalition is forming against your kingdom!', 0xff4d4d, true);
      this.scene.logEvent && this.scene.logEvent('A coalition is forming against you (3 days)', 'red');
    } else if (this._coalitionPending && hostiles.length < 2) {
      this._coalitionPending = false;
    } else if (this._coalitionPending && this.scene.gameDay >= this._coalitionDay) {
      this._coalitionPending = false;
      for (const k of hostiles) if (k.launchWave) k.launchWave();
      this.scene.threatWarning && this.scene.threatWarning('The coalition marches!', 0xff4d4d, true);
    }
  }

  serialize() { return { rel: { ...this.rel }, nap: { ...this.nap }, ally: { ...this.ally }, treaties: JSON.parse(JSON.stringify(this.treaties)), coalitionPending: this._coalitionPending, coalitionDay: this._coalitionDay }; }
  restore(d) { if (!d) return; Object.assign(this.rel, d.rel || {}); Object.assign(this.nap, d.nap || {}); Object.assign(this.ally, d.ally || {}); if (d.treaties) this.treaties = d.treaties; this._coalitionPending = !!d.coalitionPending; this._coalitionDay = d.coalitionDay || 0; }
}
