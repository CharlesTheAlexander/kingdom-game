// GreatCouncil.ts (Completion Phase 4) — the diplomatic endgame.
// Available once the player is at +60 relations with 2+ surviving kingdoms.
// Calling it (300g) opens a cinematic with 4 proposals; hosting grants +25 to all
// reputation tracks, +20 relations with participants, and unlocks the Grand Hall.
export class GreatCouncil {
  scene: any;
  held: boolean;          // council convened at least once → Grand Hall unlocked
  peaceUntil: number;     // Continental Peace expiry (game day)
  commonEnemy: any;       // { key, until } active coalition target
  tradeCompact: boolean;  // permanent trade compact established
  [key: string]: any;

  constructor(scene: any) {
    this.scene = scene;
    this.held = false;
    this.peaceUntil = 0;
    this.commonEnemy = null;
    this.tradeCompact = false;
  }

  participants() {
    const s = this.scene;
    if (!s.diplomacy) return [];
    return (s.kingdoms || []).filter((k: any) => k.castleAlive && s.diplomacy.get(k.cfg.key) >= 60);
  }
  canCall(): boolean { return this.participants().length >= 2; }

  // Faction hostile to the council (target for "Declare Common Enemy").
  commonEnemyCandidate() {
    const s = this.scene; const parts = this.participants();
    return (s.kingdoms || []).find((k: any) => k.castleAlive && !parts.includes(k)) || null;
  }

  call() {
    const s = this.scene;
    if (!this.canCall()) { s.showToast && s.showToast('Need +60 relations with 2+ kingdoms'); return; }
    if (!s.resources.spend({ gold: 300 })) { s.showToast && s.showToast('Need 300 gold'); return; }
    // (V2 Phase 2) Open the rendered Council hall scene instead of a flat panel.
    const parts = this.participants().map((k: any) => k.cfg.key);
    const highKing = !!(s.reputation && s.reputation.scores.conqueror >= 75);
    try { s.scene.launch('CouncilScene', { participants: parts, highKing }); s.scene.pause(); }
    catch (e) { this.openPanel(); } // fallback to the legacy panel
  }

  // ---- proposals ----------------------------------------------------------
  declareCommonEnemy() {
    const s = this.scene; const target = this.commonEnemyCandidate();
    if (!target) { s.showToast && s.showToast('No common enemy to name'); return this.aftermath('Declare Common Enemy'); }
    this.commonEnemy = { key: target.cfg.key, until: s.gameDay + 10 };
    if (s.diplomacy) s.diplomacy.declareWar(target.cfg.key);
    if (s.threatWarning) s.threatWarning(`The council marches on the ${target.cfg.name}!`, 0xff4d4d, true);
    this.aftermath('Declare Common Enemy');
  }
  continentalPeace() {
    const s = this.scene; this.peaceUntil = s.gameDay + 15; s._councilProdMult = 1.1;
    for (const k of this.participants()) s.diplomacy && s.diplomacy.change(k.cfg.key, 10, 'continental peace');
    if (s.logEvent) s.logEvent('Continental Peace declared — production +10% for 15 days', 'green');
    this.aftermath('Continental Peace');
  }
  tradeCompactProposal() {
    const s = this.scene; this.tradeCompact = true;
    for (const k of this.participants()) { if (s.diplomacy) { s.diplomacy.tr(k.cfg.key).trade = true; } }
    if (s.logEvent) s.logEvent('Trade Compact formed — +15 gold/day per partner', 'green');
    this.aftermath('Trade Compact');
  }
  crownHighKing() {
    const s = this.scene;
    const rep = s.reputation ? s.reputation.scores.conqueror : 0;
    if (rep < 75) { s.showToast && s.showToast('Requires Conqueror reputation 75+'); return; }
    for (const k of s.kingdoms || []) if (k.castleAlive && s.diplomacy) s.diplomacy.rel[k.cfg.key] = 90;
    this.aftermath('Crown High King');
    if (s.showEndScreen) s.showEndScreen(true, 'Diplomat'); // immediate diplomacy victory
  }

  aftermath(name: string) {
    const s = this.scene;
    this.held = true;
    if (s.reputation) for (const t of ['conqueror', 'merchant', 'protector', 'destroyer']) s.reputation.add(t, 25);
    for (const k of this.participants()) s.diplomacy && s.diplomacy.change(k.cfg.key, 20, 'great council');
    if (s.worldEvents && s.worldEvents.pushNews) s.worldEvents.pushNews('The Great Council has spoken. Its decree echoes across the continent.');
    if (s.logEvent) s.logEvent(`Great Council: ${name}. Grand Hall now buildable.`, 'gold');
    if (s.updateKingdomTitle) s.updateKingdomTitle();
    this.closePanel();
    if (s.refreshPanel) s.refreshPanel();
  }

  onNewDay() {
    const s = this.scene;
    // Coalition assault — chip the target's castle each day.
    if (this.commonEnemy) {
      const k = (s.kingdoms || []).find((x: any) => x.cfg.key === this.commonEnemy.key);
      if (k && k.castleAlive && k.damageCastle) k.damageCastle(75);
      if (s.gameDay >= this.commonEnemy.until || !(k && k.castleAlive)) this.commonEnemy = null;
    }
    // Continental peace production bonus expiry.
    if (this.peaceUntil) { if (s.gameDay < this.peaceUntil) s._councilProdMult = 1.1; else { this.peaceUntil = 0; s._councilProdMult = 1; } }
    // Trade compact income.
    if (this.tradeCompact) { const n = this.participants().length; if (n > 0) s.resources.add('gold', 15 * n); }
    // Grand Hall passives: +5 relations/day with all surviving kingdoms.
    if (this.hasGrandHall() && s.diplomacy) for (const k of s.kingdoms || []) if (k.castleAlive) s.diplomacy.change(k.cfg.key, 5);
  }

  hasGrandHall(): boolean { return this.scene.buildings && this.scene.buildings.countOfType('grandhall') > 0; }

  serialize() { return { held: this.held, peaceUntil: this.peaceUntil, commonEnemy: this.commonEnemy, tradeCompact: this.tradeCompact }; }
  restore(d: any) { if (!d) return; this.held = !!d.held; this.peaceUntil = d.peaceUntil || 0; this.commonEnemy = d.commonEnemy || null; this.tradeCompact = !!d.tradeCompact; if (this.peaceUntil > (this.scene.gameDay || 0)) this.scene._councilProdMult = 1.1; }

  // ---- cinematic panel ----------------------------------------------------
  closePanel() { if (this._panel) { this._panel.forEach((o: any) => o.destroy()); this._panel = null; } }
  openPanel() {
    const s = this.scene; this.closePanel();
    const fix = (o: any) => o.setScrollFactor(0).setDepth(130);
    const W = 620, H = 440, x = (s.constructor && 0) || (1440 - W) / 2, y = (900 - H) / 2, els: any[] = [];
    els.push(fix(s.add.rectangle(0, 0, 1440, 900, 0x05070b, 0.7).setOrigin(0, 0).setInteractive()));
    els.push(fix(s.add.rectangle(x, y, W, H, 0x1a1206, 0.99).setOrigin(0, 0).setStrokeStyle(3, 0xc9a14a, 0.95)));
    els.push(fix(s.add.text(x + W / 2, y + 18, 'THE GREAT COUNCIL', { fontFamily: 'serif', fontSize: '28px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0)));
    els.push(fix(s.add.text(x + W / 2, y + 54, 'The kingdoms of the continent gather at your invitation.', { fontFamily: 'monospace', fontSize: '13px', color: '#e7d6b0' }).setOrigin(0.5, 0)));
    // participant banners
    const parts = this.participants();
    parts.forEach((k: any, i: number) => fix(s.add.rectangle(x + W / 2 - (parts.length - 1) * 22 + i * 44, y + 84, 30, 18, k.cfg.color).setStrokeStyle(1, 0xffffff, 0.8)) && els.push(s.children.list[s.children.list.length - 1]));
    const hiKingOk = s.reputation && s.reputation.scores.conqueror >= 75;
    const enemy = this.commonEnemyCandidate();
    const proposals: any[] = [
      ['Declare Common Enemy', enemy ? `Unite against the ${enemy.cfg.name}. Combined armies besiege them for 10 days.` : 'No faction is hostile to all — unavailable.', !!enemy, () => this.declareCommonEnemy()],
      ['Establish Continental Peace', 'Lay down arms. +10% production for 15 days; peace-breakers lose 50 rep.', true, () => this.continentalPeace()],
      ['Form the Trade Compact', 'Commerce flows freely. +15 gold/day per partner; caravans protected.', true, () => this.tradeCompactProposal()],
      ['Crown a High King', hiKingOk ? 'Let one ruler guide all. Triggers the Diplomacy victory.' : 'Requires Conqueror reputation 75+.', hiKingOk, () => this.crownHighKing()],
    ];
    let by = y + 116;
    for (const [title, desc, enabled, fn] of proposals) {
      const card = fix(s.add.rectangle(x + 24, by, W - 48, 64, enabled ? 0x2a2012 : 0x1c160c).setOrigin(0, 0).setStrokeStyle(2, enabled ? 0xc9a14a : 0x5a4a2a, enabled ? 0.9 : 0.5));
      els.push(card);
      els.push(fix(s.add.text(x + 40, by + 10, title, { fontFamily: 'monospace', fontSize: '16px', color: enabled ? '#ffe9b0' : '#7a6a4a', fontStyle: 'bold' })));
      els.push(fix(s.add.text(x + 40, by + 34, desc, { fontFamily: 'monospace', fontSize: '11px', color: enabled ? '#cfc1a6' : '#6a5a3a', wordWrap: { width: W - 80 } })));
      if (enabled) { card.setInteractive({ useHandCursor: true }); card.on('pointerdown', (p: any, lx: number, ly: number, ev: any) => { if (ev) ev.stopPropagation(); fn(); }); }
      by += 72;
    }
    this._panel = els;
    if (s.routeCameras) s.routeCameras();
  }
}
