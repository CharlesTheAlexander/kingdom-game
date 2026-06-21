// (V2 Phase 11) The Narrative Arc.
//
// The continent was once one empire that fell 200 years ago. Three story paths
// echo the three win conditions (Conquest/Diplomacy/Legacy), each firing
// one-time narrative beats as the player progresses. A secret fourth path — The
// Truth — opens once every ruin's fragment is recovered: the old empire's power
// still sleeps beneath the continent, and a ruinous final ritual can restore it
// for a unique victory (the 4th win condition).

export class Narrative {
  scene: any;
  beats: Set<string>;
  truthUnlocked: boolean;
  empireRestored: boolean;
  [key: string]: any;

  constructor(scene: any) {
    this.scene = scene;
    this.beats = new Set();
    this.truthUnlocked = false;
    this.empireRestored = false;
  }

  fire(id: string, text: string, color = 'gold') {
    if (this.beats.has(id)) return;
    this.beats.add(id);
    if (this.scene.logEvent) this.scene.logEvent(text, color);
    if (this.scene.threatWarning) this.scene.threatWarning(text, 0xc9a14a, false);
  }

  onNewDay() {
    const s = this.scene;
    const ks = s.kingdoms || [];
    // CONQUEST PATH — 5 beats: each fall, a first blood beat, halfway, total.
    const fallen = ks.filter((k: any) => !k.castleAlive);
    for (const k of fallen) this.fire('conquer_' + k.cfg.key, this.conquestBeat(k.cfg.key));
    if (fallen.length >= 1) this.fire('conquest_first', `The age of the Unifier begins — ${fallen[0].cfg.name} is the first to kneel.`);
    if (ks.length && fallen.length >= Math.ceil(ks.length / 2)) this.fire('conquest_half', 'Half the continent flies your banner. The other thrones tremble.');
    if (ks.length && fallen.length === ks.length) this.fire('conquer_all', 'The continent bows. You are The Unifier — found your Empire.', 'gold');
    // DIPLOMACY PATH — 5 beats: first ally, first trade, the council, all-allied.
    if (s.diplomacy) {
      const allies = ks.filter((k: any) => k.castleAlive && (s.diplomacy.isAllied ? s.diplomacy.isAllied(k.cfg.key) : s.diplomacy.get(k.cfg.key) >= 80));
      const traders = ks.filter((k: any) => s.diplomacy.tr && s.diplomacy.tr(k.cfg.key).trade);
      if (traders.length) this.fire('first_trade', `Caravans from ${traders[0].cfg.name} now route through your markets.`);
      if (allies.length) this.fire('first_alliance', 'Word spreads that a new kind of ruler has risen — one who unites by choice.');
      if (s.greatCouncil && s.greatCouncil.hasGrandHall && s.greatCouncil.hasGrandHall()) this.fire('council_held', 'The Great Council convened in your hall — the moment the world changed without a sword drawn.');
      const liveK = ks.filter((k: any) => k.castleAlive);
      if (liveK.length >= 1 && liveK.every((k: any) => (s.diplomacy.isAllied ? s.diplomacy.isAllied(k.cfg.key) : s.diplomacy.get(k.cfg.key) >= 80))) this.fire('all_allied', 'Every crown on the continent calls you friend. A confederation is born.', 'gold');
    }
    // LEGACY PATH — 5 beats: pop 50, pop 100, grand hall, stage 7, all research.
    const pop = s.population ? s.population.count : 0;
    if (pop >= 50) this.fire('pop50', 'Your village has become a true city — its name carried by every traveller.');
    if (pop >= 100) this.fire('pop100', 'Your city is spoken of in distant lands.');
    if (s.buildings && s.buildings.buildings.some((b: any) => b.alive && b.typeKey === 'grandhall')) this.fire('grandhall_built', 'Scholars and artists travel weeks to see your Grand Hall.');
    if (s.currentStage && s.currentStage() >= 7) this.fire('stage_castle', 'Your seat is a mighty castle now — a beacon of order in a fractured age.');
    if (s.research && s.research.completed && s.research.completed.size >= 9) this.fire('research_all', 'Your scholars have mastered every known art. The old empire would be envious.', 'gold');
    // THE TRUTH — ruin fragments.
    if (s.ruins) {
      const ex = s.ruins.list.filter((r: any) => r.explored);
      for (const r of ex) { const b = this.ruinBeat(r.name); if (b) this.fire('ruin_' + r.name, b, 'info'); }
      if (s.ruins.list.length > 0 && ex.length >= s.ruins.list.length && !this.truthUnlocked) this.unlockTruth();
    }
  }

  conquestBeat(key: string) {
    return (({ red: "Valdris's sword is yours now. His soldiers kneel.", purple: "The Countess's treasury opens to your kingdom.", yellow: 'The Free Company swears its banners to you.' }) as Record<string, string>)[key] || `The ${key} kingdom has fallen to you.`;
  }
  ruinBeat(name: string) {
    return (({ 'The Sunken Citadel': 'The Sunken Citadel: "Here fell the last emperor of the old world."', 'The Forge of Ages': 'The Forge of Ages: "Here they made weapons that could kill gods."', 'The Iron Throne': 'The Iron Throne: "Here the betrayal happened."' }) as Record<string, string>)[name] || null;
  }

  unlockTruth() {
    this.truthUnlocked = true;
    this.fire('truth', "THE TRUTH: the old empire's power was never destroyed — it sleeps beneath the continent. A final ritual could restore it, at ruinous cost.", 'gold');
    if (this.scene.refreshPanel) this.scene.refreshPanel();
  }

  // ---- 4th win condition: Restore the Old Empire ------------------------
  canRestoreEmpire() { return this.truthUnlocked && !this.empireRestored; }
  restoreEmpireCost() { return Math.max(1000, Math.floor((this.scene.resources.gold || 0) * 0.9)); }
  restoreEmpire() {
    if (!this.canRestoreEmpire()) return false;
    const cost = this.restoreEmpireCost();
    if ((this.scene.resources.gold || 0) < cost) { if (this.scene.showToast) this.scene.showToast('The ritual demands nearly all your gold'); return false; }
    this.scene.resources.gold -= cost;
    this.empireRestored = true;
    if (this.scene.logEvent) this.scene.logEvent("You pour the realm's wealth into the old empire's sleeping heart...", 'gold');
    if (this.scene.threatWarning) this.scene.threatWarning('THE OLD EMPIRE IS RESTORED — a new age begins under your crown', 0xffd24a, true);
    return true;
  }

  serialize() { return { beats: [...this.beats], truthUnlocked: this.truthUnlocked, empireRestored: this.empireRestored }; }
  restore(d: any) { if (!d) return; this.beats = new Set(d.beats || []); this.truthUnlocked = !!d.truthUnlocked; this.empireRestored = !!d.empireRestored; }
}
