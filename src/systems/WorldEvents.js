import Phaser from 'phaser';
import { GAME_W, GAME_H } from '../scenes/GameScene.js';

// WorldEvents.js — (Expansion Phase 3) authored world events + a messenger.
// Fires ~1 event per 7 game-days and one seasonal event per season change.
// News events show a top banner; choice events queue at the messenger icon.

export class WorldEvents {
  constructor(scene) {
    this.scene = scene;
    this.queue = [];          // pending choice-events {def}
    this.lastFired = {};      // id -> day
    this.lastEventDay = 0;
    this.lastSeason = scene.seasonHint ? scene.seasonHint(scene.gameDay) : null;
    this.defs = this.buildDefs();
    this.createMessenger();
  }

  rngNeutralName() {
    const list = (this.scene.settlements && this.scene.settlements.list) || [];
    const neutral = list.filter((s) => s.owner === 'neutral');
    return (neutral.length ? Phaser.Utils.Array.GetRandom(neutral) : list[0] || { name: 'Millhaven' }).name;
  }
  rngKingdomName() {
    const k = (this.scene.kingdoms || []).filter((x) => x.castleAlive);
    return (k.length ? Phaser.Utils.Array.GetRandom(k).cfg : { name: 'a rival kingdom' }).name;
  }

  // ---- event table --------------------------------------------------------
  buildDefs() {
    const s = this.scene;
    return [
      // NEWS (banner, no choice)
      { id: 'purple_conquer', type: 'news', text: () => `The Purple Kingdom conquered ${this.rngNeutralName()}. Their territory expands.` },
      { id: 'harsh_winter', type: 'news', text: () => 'Harsh winter strikes the eastern mountains. Food is scarcer this season.', effect: () => { s._seasonFoodUpkeepMult = 1.2; } },
      { id: 'goblin_activity', type: 'news', text: () => 'Caravans report unusual goblin activity in the western wildlands.', effect: () => { s._lastGobDayBoost = true; } },
      { id: 'yellow_losses', type: 'news', text: () => "The Yellow Kingdom's army suffered heavy losses." },
      { id: 'ruin_rumor', type: 'news', text: () => 'Rumors spread of ancient ruins in the northern forests.', effect: () => this.revealRandomFog() },
      // CHOICE
      { id: 'deserter', type: 'choice', title: 'A Deserter Arrives', body: () => `A soldier from ${this.rngKingdomName()} offers information about their forces.`,
        choices: [
          { label: 'Accept (gain intel)', effect: () => { s.intelUntilDay = s.gameDay + 6; const k = this.firstKingdom(); if (k && s.diplomacy) s.diplomacy.change(k.cfg.key, -10); s.showToast && s.showToast('Enemy army sizes revealed'); } },
          { label: 'Refuse', effect: () => { const k = this.firstKingdom(); if (k && s.diplomacy) s.diplomacy.change(k.cfg.key, 5); } },
        ] },
      { id: 'noble', type: 'choice', title: 'Noble Family Seeks Refuge', body: () => `A noble family fleeing ${this.rngKingdomName()} requests shelter.`,
        choices: [
          { label: 'Accept (+3 pop, +happiness)', effect: () => { if (s.population) { s.population.count += 3; s.population.happiness = Math.min(100, s.population.happiness + 5); } const k = this.firstKingdom(); if (k && s.diplomacy) s.diplomacy.change(k.cfg.key, -15); if (s.reputation) s.reputation.add('protector', 5); } },
          { label: 'Refuse', effect: () => {} },
        ] },
      { id: 'merchant', type: 'choice', title: 'Traveling Merchant', body: () => 'A merchant offers rare goods from distant lands.',
        choices: [
          { label: 'Trade (100 gold → artifact)', enabled: () => s.resources.gold >= 100, effect: () => { s.resources.gold -= 100; this.grantRandomArtifact(); if (s.reputation) s.reputation.add('merchant', 5); } },
          { label: 'Pass', effect: () => {} },
        ] },
      { id: 'cache', type: 'choice', title: 'Abandoned Cache', body: () => 'Scouts found an abandoned supply cache in the forest.',
        choices: [{ label: 'Take it', effect: () => { const r = Phaser.Utils.Array.GetRandom(['wood', 'stone', 'food', 'iron']); const amt = Phaser.Math.Between(20, 50); s.resources.add(r, amt); s.showToast && s.showToast(`+${amt} ${r}`); } }] },
      { id: 'shaman', type: 'choice', title: 'Goblin Shaman Truce', body: () => 'A goblin shaman offers 5 days of peace in exchange for 50 food.',
        choices: [
          { label: 'Accept (50 food)', enabled: () => s.resources.food >= 50, effect: () => { s.resources.food -= 50; s._goblinTruceUntilDay = s.gameDay + 5; s.showToast && s.showToast('Goblins will not raid for 5 days'); } },
          { label: 'Refuse', effect: () => { if (s.wildlife && s.wildlife.spawnGoblinRaid) s.wildlife.spawnGoblinRaid(); } },
        ] },
      { id: 'mercs', type: 'choice', title: 'Mercenary Company', body: () => 'A company of fighters seeks employment.',
        choices: [
          { label: 'Hire (200 gold → 6 mercs)', enabled: () => s.resources.gold >= 200, effect: () => { s.resources.gold -= 200; for (let i = 0; i < 6; i++) if (s.troops.spawnMercenary) s.troops.spawnMercenary(); } },
          { label: 'Decline', effect: () => {} },
        ] },
      { id: 'spy', type: 'choice', title: 'Spy Caught', body: () => `Guards caught a spy from ${this.rngKingdomName()}.`,
        choices: [
          { label: 'Execute (relations -20, intel)', effect: () => { const k = this.firstKingdom(); if (k && s.diplomacy) s.diplomacy.change(k.cfg.key, -20); s.intelUntilDay = s.gameDay + 6; } },
          { label: 'Release (relations +10)', effect: () => { const k = this.firstKingdom(); if (k && s.diplomacy) s.diplomacy.change(k.cfg.key, 10); } },
        ] },
      { id: 'oldmap', type: 'choice', title: 'Old Map Found', body: () => 'A farmer found a map showing an unknown location.',
        choices: [{ label: 'Study it', effect: () => this.revealRandomFog() }] },
      { id: 'taxrevolt', type: 'choice', title: 'Tax Revolt Warning', cond: () => s.population && s.population.happiness < 40, body: () => 'Your tax collectors report growing resentment.',
        choices: [
          { label: 'Appease (lose 50 gold)', enabled: () => s.resources.gold >= 50, effect: () => { s.resources.gold -= 50; if (s.population) s.population.happiness = Math.min(100, s.population.happiness + 15); } },
          { label: 'Ignore', effect: () => { if (s.population) s.population.happiness = Math.max(0, s.population.happiness - 10); } },
        ] },
      { id: 'victory', type: 'choice', title: 'Victory Celebration', cond: () => (s.gameDay - (s._lastBattleWonDay ?? -99)) <= 3, body: () => 'Your people celebrate the recent victory!',
        choices: [{ label: 'Celebrate', effect: () => { if (s.population) s.population.happiness = Math.min(100, s.population.happiness + 20); } }] },
    ];
  }

  firstKingdom() { return (this.scene.kingdoms || []).find((k) => k.castleAlive) || null; }

  grantRandomArtifact() {
    const s = this.scene;
    const owned = s.artifacts || [];
    const pool = (s.ARTIFACT_DEFS || []).filter((a) => !owned.includes(a.key));
    if (!pool.length) { s.resources.add('gold', 100); return; }
    const a = Phaser.Utils.Array.GetRandom(pool);
    s.artifacts.push(a.key); a.apply(s);
    s.showToast && s.showToast(`Gained artifact: ${a.name}`);
    s.logEvent && s.logEvent(`Artifact acquired: ${a.name}`, 'green');
  }

  revealRandomFog() {
    const s = this.scene;
    const c = s.buildings.castle; if (!c) return;
    const col = Phaser.Math.Clamp(c.col + Phaser.Math.Between(-60, 60), 0, s.COLS - 1);
    const row = Phaser.Math.Clamp(c.row + Phaser.Math.Between(-60, 60), 0, s.ROWS - 1);
    if (s.revealAround) s.revealAround(col, row, 8);
    s.logEvent && s.logEvent('A new region was revealed on the map', 'yellow');
  }

  // ---- scheduling ---------------------------------------------------------
  onNewDay() {
    const s = this.scene;
    const season = s.seasonHint ? s.seasonHint(s.gameDay) : null;
    if (season && season !== this.lastSeason) { this.lastSeason = season; this.fireSeasonal(season); }
    if (s.gameDay - this.lastEventDay >= 7) { this.lastEventDay = s.gameDay; this.fireRandom(); }
  }

  fireRandom() {
    const s = this.scene;
    const eligible = this.defs.filter((d) => (!d.cond || d.cond()) && (s.gameDay - (this.lastFired[d.id] || -99) >= 20));
    if (!eligible.length) return;
    const def = Phaser.Utils.Array.GetRandom(eligible);
    this.lastFired[def.id] = s.gameDay;
    if (def.type === 'news') { if (def.effect) def.effect(); this.showBanner(def.text()); s.logEvent && s.logEvent(def.text(), 'info'); }
    else { this.queue.push(def); this.refreshMessenger(); }
  }

  fireSeasonal(season) {
    const s = this.scene;
    s._seasonFarmMult = 1; s._seasonFoodUpkeepMult = 1;
    let msg = '';
    if (season.indexOf('Spring') >= 0) { msg = 'The thaw brings fresh growth. Resource nodes regenerate faster.'; }
    else if (season === 'Summer') { msg = 'A long dry summer. Farm output dips but trade is brisk.'; s._seasonFarmMult = 0.9; }
    else if (season.indexOf('Autumn') >= 0) { msg = 'Harvest season! Farms produce +25% food.'; s._seasonFarmMult = 1.25; }
    else if (season === 'Winter') { msg = 'A bitter winter. Food consumption rises.'; s._seasonFoodUpkeepMult = 1.2; }
    if (msg) { this.showBanner(`${season}: ${msg}`); s.logEvent && s.logEvent(`Season — ${msg}`, 'yellow'); }
  }

  showBanner(text) {
    const s = this.scene;
    if (s.threatWarning) s.threatWarning('📜 ' + text, 0xffe9a8);
  }

  // (Session-1) Fire an ad-hoc news banner + log (used by Ruins discovery, etc.)
  pushNews(text) {
    this.showBanner(text);
    this.scene.logEvent && this.scene.logEvent(text, 'info');
  }

  // ---- messenger UI -------------------------------------------------------
  createMessenger() {
    const s = this.scene;
    const fix = (o) => o.setScrollFactor(0);
    const x = 54, y = 8;
    this.msgBtn = fix(s.add.container(x + 14, y + 14).setDepth(62).setVisible(false));
    const g = s.add.graphics();
    g.fillStyle(0x2d6cb0, 1).fillCircle(0, 0, 13).lineStyle(2, 0xffffff, 0.9).strokeCircle(0, 0, 13);
    const ex = s.add.text(0, 0, '!', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
    this.badge = s.add.text(11, -11, '', { fontFamily: 'monospace', fontSize: '11px', color: '#fff', backgroundColor: '#c0392b', padding: { x: 3, y: 1 }, fontStyle: 'bold' }).setOrigin(0.5);
    this.msgBtn.add([g, ex, this.badge]);
    g.setInteractive(new Phaser.Geom.Circle(0, 0, 16), Phaser.Geom.Circle.Contains);
    g.on('pointerdown', (p, lx, ly, ev) => { if (ev) ev.stopPropagation(); this.openPanel(); });
    // gentle pulse
    s.tweens.add({ targets: this.msgBtn, scale: { from: 0.9, to: 1.1 }, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.inOut' });
  }

  refreshMessenger() {
    if (!this.msgBtn) return;
    const n = this.queue.length;
    this.msgBtn.setVisible(n > 0);
    this.badge.setText(n > 1 ? '' + n : '');
    this.scene.routeCameras && this.scene.routeCameras();
  }

  openPanel() {
    const def = this.queue[0]; if (!def) return;
    if (this._panel) this._panel.forEach((o) => o.destroy());
    const s = this.scene, fix = (o) => o.setScrollFactor(0);
    const W = 480, H = 230, x = (GAME_W - W) / 2, y = (GAME_H - H) / 2, els = [];
    els.push(fix(s.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 0.55).setOrigin(0, 0).setDepth(110).setInteractive()));
    els.push(fix(s.add.rectangle(x, y, W, H, 0x241a0e, 0.99).setOrigin(0, 0).setDepth(111).setStrokeStyle(3, 0xc9a14a, 0.9)));
    els.push(fix(s.add.text(x + W / 2, y + 22, def.title, { fontFamily: 'monospace', fontSize: '17px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0).setDepth(112)));
    els.push(fix(s.add.text(x + 24, y + 60, def.body(), { fontFamily: 'monospace', fontSize: '13px', color: '#f0e6d0', wordWrap: { width: W - 48 }, lineSpacing: 4 }).setDepth(112)));
    const choices = def.choices || [{ label: 'OK', effect: () => {} }];
    const bw = Math.min(220, (W - 48) / choices.length - 8);
    choices.forEach((ch, i) => {
      const en = !ch.enabled || ch.enabled();
      const bx = x + 24 + i * (bw + 12);
      const b = fix(s.add.rectangle(bx, y + H - 56, bw, 40, en ? 0x2d6cb0 : 0x39393f).setOrigin(0, 0).setDepth(112).setStrokeStyle(2, 0xf0e6c8, en ? 0.85 : 0.4));
      els.push(b);
      els.push(fix(s.add.text(bx + bw / 2, y + H - 36, ch.label, { fontFamily: 'monospace', fontSize: '12px', color: en ? '#fff' : '#9aa0a6', fontStyle: 'bold', align: 'center', wordWrap: { width: bw - 8 } }).setOrigin(0.5).setDepth(113)));
      if (en) { b.setInteractive({ useHandCursor: true }); b.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.resolve(ch); }); }
    });
    this._panel = els;
    s.routeCameras && s.routeCameras();
  }

  closePanel() { if (this._panel) { this._panel.forEach((o) => o.destroy()); this._panel = null; } }

  resolve(choice) {
    const def = this.queue.shift();
    this.closePanel();
    try { if (choice && choice.effect) choice.effect(); } catch (e) { console.error('[Event] effect failed', e); }
    if (def) this.scene.logEvent && this.scene.logEvent(`Event: ${def.title} → ${choice.label}`, 'info');
    this.refreshMessenger();
    if (this.scene.updateHud) this.scene.updateHud();
    if (this.queue.length) this.openPanel();
  }

  serialize() { return { lastFired: this.lastFired, lastEventDay: this.lastEventDay, lastSeason: this.lastSeason, queueIds: this.queue.map((d) => d.id) }; }
  restore(d) {
    if (!d) return;
    this.lastFired = d.lastFired || {}; this.lastEventDay = d.lastEventDay || 0; this.lastSeason = d.lastSeason || this.lastSeason;
    this.queue = (d.queueIds || []).map((id) => this.defs.find((x) => x.id === id)).filter(Boolean);
    this.refreshMessenger();
  }
}
