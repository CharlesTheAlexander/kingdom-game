// (V2 Phase 8) Royal Marriages + Succession.
//
// The crown has a named heir whose trait is shaped by how they are raised. A
// royal marriage with a friendly faction (≥60 relations, 500g dowry) buys
// permanent peace, a research boost, and weds your heir into their line. When
// the ruler dies — slain in battle or by natural causes — the heir is crowned
// (inheriting their trait) and a new heir is named. With no heir, a succession
// crisis destabilises relations across the continent.

const HEIR_NAMES = ['Aldwin', 'Rowena', 'Cedric', 'Isolde', 'Tristan', 'Elara', 'Godwin', 'Mirabel', 'Leofric', 'Adela', 'Percy', 'Sabine'];
const UPBRINGINGS: Record<string, any> = {
  martial: { trait: 'warlord', label: 'Raised as a warrior', note: 'Trained in arms and command.' },
  courtly: { trait: 'diplomat', label: 'Raised at court', note: 'Schooled in diplomacy and intrigue.' },
  learned: { trait: 'scholar', label: 'Raised among scholars', note: 'Tutored in letters and lore.' },
};

export class Succession {
  scene: any;
  heir: any;
  marriedTo: string | null;
  [key: string]: any;

  constructor(scene: any) {
    this.scene = scene;
    this.marriedTo = null;
    this.spouseFaction = null;
    this._raisedAsked = false;
    this.heir = this.makeHeir(scene.kingTrait || null);
  }

  makeHeir(parentTrait: string | null) {
    return { name: HEIR_NAMES[Math.floor(Math.random() * HEIR_NAMES.length)], trait: parentTrait, raised: null };
  }

  // ---- royal marriage ---------------------------------------------------
  canMarry(key: string) {
    if (this.marriedTo) return false;
    const rel = this.scene.diplomacy ? this.scene.diplomacy.get(key) : 0;
    return rel >= 60;
  }

  arrangeMarriage(key: string) {
    if (!this.canMarry(key)) { if (this.scene.showToast) this.scene.showToast('Need +60 relations to wed'); return false; }
    if (this.scene.resources.gold < 500) { if (this.scene.showToast) this.scene.showToast('A royal dowry costs 500 gold'); return false; }
    this.scene.resources.gold -= 500;
    this.marriedTo = key;
    this.spouseFaction = key;
    // Permanent peace + alliance with the wedded faction.
    const D = this.scene.diplomacy;
    if (D) {
      if (D.rel) D.rel[key] = Math.min(100, (D.rel[key] || 0) + 20);
      if (D.ally) D.ally[key] = true;
      if (D.nap) D.nap[key] = true;
      if (D.tr) { const t = D.tr(key); t.alliance = true; t.married = true; }
    }
    // Shared research bonus (applied in Research.onNewDay).
    this.scene._marriageResearchMult = 1.15;
    const fname = this.factionName(key);
    if (this.scene.heir) {/* noop */}
    if (this.scene.logEvent) this.scene.logEvent(`Royal wedding! Heir ${this.heir.name} weds into the ${fname}. Permanent alliance sealed.`, 'gold');
    if (this.scene.weddingCeremony) this.scene.weddingCeremony(key);
    return true;
  }

  factionName(key: string) {
    const k = (this.scene.kingdoms || []).find((x: any) => x.cfg && x.cfg.key === key);
    return k && k.cfg ? k.cfg.name : key;
  }

  // ---- raising the heir -------------------------------------------------
  upbringingChoices() { return Object.entries(UPBRINGINGS).map(([k, v]) => ({ key: k, ...v })); }
  raiseHeir(choiceKey: string) {
    const u = UPBRINGINGS[choiceKey]; if (!u) return;
    this.heir.raised = choiceKey;
    this.heir.trait = u.trait;
    if (this.scene.logEvent) this.scene.logEvent(`Heir ${this.heir.name} ${u.label.toLowerCase()} — they will rule as a ${u.trait}`, 'info');
  }

  // ---- succession -------------------------------------------------------
  onRulerDeath(cause: string) {
    if (this._inSuccession) return;
    this._inSuccession = true;
    if (this.heir) {
      const newRuler = this.heir;
      this.scene.rulerName = (newRuler.trait === 'warlord' ? 'King ' : 'Queen ') + newRuler.name;
      this.scene.kingTrait = newRuler.trait || this.scene.kingTrait;
      if (newRuler.trait && this.scene.applyTraitBonuses) this.scene.applyTraitBonuses(newRuler.trait);
      if (this.scene.updateKingdomTitle) this.scene.updateKingdomTitle();
      if (this.scene.logEvent) this.scene.logEvent(`${this.scene.rulerName} is crowned, inheriting the throne (${cause})`, 'gold');
      if (this.scene.threatWarning) this.scene.threatWarning(`Long live ${this.scene.rulerName}!`, 0xc9a14a, true);
      // A new heir is named.
      this.heir = this.makeHeir(this.scene.kingTrait);
    } else {
      this.successionCrisis();
    }
    this._inSuccession = false;
  }

  successionCrisis() {
    const D = this.scene.diplomacy;
    if (D && D.rel) for (const key of Object.keys(D.rel)) D.rel[key] = Math.max(-100, (D.rel[key] || 0) - 20);
    if (this.scene.logEvent) this.scene.logEvent('No heir survives — a succession crisis grips the realm! Relations destabilise.', 'red');
    if (this.scene.threatWarning) this.scene.threatWarning('SUCCESSION CRISIS — the realm has no heir', 0xc0392b, true);
    // A pretender claims the throne: name a fresh heir from a noble house.
    this.heir = this.makeHeir(this.scene.kingTrait);
    if (this.scene.logEvent) this.scene.logEvent(`A noble house puts forward ${this.heir.name} as the new heir`, 'info');
  }

  // ---- daily: occasional natural death + one-time raising prompt ---------
  onNewDay() {
    const day = this.scene.gameDay;
    if (!this._raisedAsked && day >= 15) { this._raisedAsked = true; if (this.scene.openHeirRaising) this.scene.openHeirRaising(); }
    // Rare natural death once the realm is well established.
    if (day > 120 && Math.random() < 0.0015) { if (this.scene.logEvent) this.scene.logEvent(`${this.scene.rulerName} has died of natural causes`, 'red'); this.onRulerDeath('natural'); }
  }

  serialize() {
    return { marriedTo: this.marriedTo, spouseFaction: this.spouseFaction, raisedAsked: this._raisedAsked, heir: this.heir, ruler: { name: this.scene.rulerName, trait: this.scene.kingTrait } };
  }
  restore(d: any) {
    if (!d) return;
    this.marriedTo = d.marriedTo || null;
    this.spouseFaction = d.spouseFaction || null;
    this._raisedAsked = !!d.raisedAsked;
    if (d.heir) this.heir = d.heir;
    if (this.marriedTo) this.scene._marriageResearchMult = 1.15;
  }
}
