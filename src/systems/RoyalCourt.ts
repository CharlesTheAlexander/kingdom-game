// (V2 Phase 7) The Royal Court — a body of advisors with their own agendas.
//
// Each advisor has a role, a procedurally chosen name, and a loyalty score.
// Every 7 days the court issues reports: each advisor suggests an action. The
// player may Heed a suggestion (the advisor's loyalty rises and a small benefit
// applies) or ignore it (loyalty falls). An advisor whose loyalty collapses may
// defect to a rival faction, costing relations and intel.

interface AdvisorDef { role: string; title: string; icon: string; }
const ROLES: AdvisorDef[] = [
  { role: 'military', title: 'Marshal', icon: '⚔' },
  { role: 'trade', title: 'Chancellor', icon: '⚖' },
  { role: 'spymaster', title: 'Spymaster', icon: '🗡' },
];
const PRIEST: AdvisorDef = { role: 'priest', title: 'High Priest', icon: '✝' };

const NAMES = ['Aldous', 'Bertran', 'Cedric', 'Dorian', 'Edmund', 'Godfrey', 'Hugh', 'Lysander', 'Percival', 'Roland', 'Selwyn', 'Tristan', 'Wystan', 'Alaric', 'Benedict'];

export class RoyalCourt {
  scene: any;
  advisors: any[];
  [key: string]: any;

  constructor(scene: any) {
    this.scene = scene;
    this._lastReport = 0;
    this._pendingReturns = []; // [{ role, day }] advisors rejoining after a defection
    this.advisors = ROLES.map((d) => this.makeAdvisor(d));
  }

  makeAdvisor(d: AdvisorDef) {
    return { role: d.role, title: d.title, icon: d.icon, name: NAMES[Math.floor(Math.random() * NAMES.length)], loyalty: 60, suggestion: null };
  }

  // The High Priest only attends if a Grand Hall has been raised.
  ensurePriest() {
    const hasHall = this.scene.buildings && this.scene.buildings.buildings.some((b: any) => b.alive && b.typeKey === 'grandhall');
    const has = this.advisors.some((a) => a.role === 'priest');
    if (hasHall && !has) { this.advisors.push(this.makeAdvisor(PRIEST)); this.scene.logEvent('A High Priest joins your court', 'gold'); }
  }

  enemyFactions() {
    const ks = (this.scene.kingdoms || []).map((k: any) => k.cfg && k.cfg.key).filter(Boolean);
    return ks.length ? ks : ['red', 'purple', 'yellow'];
  }

  onNewDay() {
    const day = this.scene.gameDay;
    this.ensurePriest();
    // Returning advisors rejoin.
    for (const r of [...this._pendingReturns]) {
      if (day >= r.day) {
        const def = [...ROLES, PRIEST].find((d) => d.role === r.role);
        if (def && !this.advisors.some((a) => a.role === r.role)) { this.advisors.push(this.makeAdvisor(def)); this.scene.logEvent(`A new ${def.title} takes their seat at court`, 'info'); }
        this._pendingReturns = this._pendingReturns.filter((x) => x !== r);
      }
    }
    if (day - this._lastReport >= 7 && day > 1) { this._lastReport = day; this.weeklyReports(); }
  }

  suggestionFor(role: string) {
    const enemy = this.enemyFactions()[Math.floor(Math.random() * this.enemyFactions().length)];
    switch (role) {
      case 'military': return { kind: 'military', text: 'Our borders invite ambition — strengthen the host. Heed me and the armies will take heart.' };
      case 'trade': return { kind: 'trade', text: 'Coin wins wars without blood. Open the coffers and let me work the markets.' };
      case 'spymaster': return { kind: 'spymaster', text: `Knowledge is the sharper blade. Let me set eyes upon the ${enemy} court.`, target: enemy };
      case 'priest': return { kind: 'priest', text: 'The faithful look for unity. Bless an alliance and the people will thank you.' };
      default: return { kind: 'none', text: '' };
    }
  }

  weeklyReports() {
    for (const a of this.advisors) a.suggestion = this.suggestionFor(a.role);
    this.scene.logEvent('Your court has issued its weekly reports', 'gold');
    if (this.scene.threatWarning) this.scene.threatWarning('The Royal Court awaits your counsel (select the Castle)', 0xc9a14a, false);
  }

  // Player heeds an advisor's suggestion: a small benefit + loyalty.
  heed(a: any) {
    if (!a.suggestion) return;
    const s = a.suggestion;
    if (s.kind === 'military') {
      if (this.scene.armyMgr) for (const army of this.scene.armyMgr.armies || []) this.scene.armyMgr.addMorale(army, 12);
      this.scene.logEvent(`${a.title} ${a.name}: the army's spirits are lifted`, 'green');
    } else if (s.kind === 'trade') {
      this.scene.resources.add('gold', 40);
      this.scene.logEvent(`${a.title} ${a.name} turns a profit (+40 gold)`, 'green');
    } else if (s.kind === 'spymaster') {
      const k = (this.scene.kingdoms || []).find((x: any) => x.cfg && x.cfg.key === s.target);
      const army = k ? (this.scene.armyMgr && this.scene.armyMgr.armies ? this.scene.armyMgr.armies.filter((ar: any) => ar.faction === s.target).length : 0) : 0;
      this.scene.logEvent(`${a.title} ${a.name}: the ${s.target} field roughly ${army || 'a few'} armies`, 'info');
      if (this.scene.leaders && this.scene.leaders.onTrade) {/* intel only */}
    } else if (s.kind === 'priest') {
      if (this.scene.diplomacy && this.scene.diplomacy.rel) {
        const best = this.enemyFactions().sort((x, y) => (this.scene.diplomacy.rel[y] || 0) - (this.scene.diplomacy.rel[x] || 0))[0];
        if (best) { this.scene.diplomacy.rel[best] = Math.min(100, (this.scene.diplomacy.rel[best] || 0) + 8); this.scene.logEvent(`${a.title} ${a.name} blesses ties with the ${best} (+8 relations)`, 'green'); }
      }
    }
    a.loyalty = Math.min(100, a.loyalty + 10);
    a.suggestion = null;
  }

  ignore(a: any) {
    if (!a.suggestion) return;
    a.loyalty = Math.max(0, a.loyalty - 8);
    a.suggestion = null;
    if (a.loyalty <= 25) this.scene.logEvent(`${a.title} ${a.name} grows resentful (loyalty ${a.loyalty})`, 'orange');
    this.checkDefection(a);
  }

  checkDefection(a: any) {
    if (a.loyalty > 15) return;
    if (Math.random() > 0.5) return;
    const enemy = this.enemyFactions()[Math.floor(Math.random() * this.enemyFactions().length)];
    this.advisors = this.advisors.filter((x) => x !== a);
    if (this.scene.diplomacy && this.scene.diplomacy.rel) this.scene.diplomacy.rel[enemy] = Math.max(-100, (this.scene.diplomacy.rel[enemy] || 0) - 15);
    this.scene.logEvent(`${a.title} ${a.name} has defected to the ${enemy}!`, 'red');
    if (this.scene.threatWarning) this.scene.threatWarning(`${a.title} ${a.name} betrayed your court!`, 0xc0392b, true);
    this._pendingReturns.push({ role: a.role, day: this.scene.gameDay + 6 });
  }

  serialize() {
    return { lastReport: this._lastReport, pending: this._pendingReturns, advisors: this.advisors.map((a) => ({ role: a.role, title: a.title, icon: a.icon, name: a.name, loyalty: a.loyalty, suggestion: a.suggestion })) };
  }
  restore(d: any) {
    if (!d) return;
    this._lastReport = d.lastReport || 0;
    this._pendingReturns = d.pending || [];
    if (Array.isArray(d.advisors)) this.advisors = d.advisors.map((a: any) => ({ ...a }));
  }
}
