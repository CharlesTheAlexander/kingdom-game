import Phaser from 'phaser';

// WanderingFactions.js — (Session-1 Phase 2) non-kingdom groups that roam the
// continent: merchant caravans (tradeable/raidable), nomadic tribes (befriend via
// envoy or turn hostile), and pilgrim groups (passive happiness/donations).
// All visuals are drawn with Phaser Graphics — no new sprites.

// One game-day = 300s = 24 game-hours → 1 game-hour = 12.5s.
const HOUR = 12.5;
const CARAVAN_SPEED = 1 / HOUR;   // 1 tile / game-hour
const TRIBE_SPEED = 0.5 / HOUR;   // 0.5 tile / game-hour
const PILGRIM_SPEED = 0.8 / HOUR;

export class WanderingFactions {
  scene: any;
  caravans: any[];
  tribes: any[];
  pilgrim: any;
  _pilgrimDay: number;
  [key: string]: any;

  constructor(scene: any) {
    this.scene = scene;
    this.caravans = [];
    this.tribes = [];
    this.pilgrim = null;
    this._pilgrimDay = 0;
    this.spawnCaravans();
    this.spawnTribes();
  }

  // --- caravans ------------------------------------------------------------
  spawnCaravans() {
    for (let i = 0; i < 2; i++) this.caravans.push(this.makeCaravan(i + 1));
  }
  makeCaravan(num) {
    const s = this.scene;
    const col = Phaser.Math.Between(60, 140), row = Phaser.Math.Between(60, 140);
    const { x, y } = s.tileCenter(col, row);
    const cont = s.add.container(x, y).setDepth(8);
    const g = s.add.graphics();
    this.paintCart(g);
    cont.add(g);
    const c = { kind: 'caravan', num, name: `Caravan #${num}`, col, row, x, y, sprite: cont, state: 'roam', respawnDay: 0, traded: false, target: null };
    this.pickCaravanTarget(c);
    return c;
  }
  paintCart(g) {
    g.clear();
    g.fillStyle(0x000000, 0.25); g.fillEllipse(0, 8, 24, 7); // shadow
    g.fillStyle(0x8a5a2a, 1); g.fillRect(-10, -6, 20, 9);    // cart body
    g.fillStyle(0x5c3a18, 1); g.fillRect(-10, -6, 20, 3);    // rim
    g.fillStyle(0x2b2b2b, 1); g.fillCircle(-6, 5, 3); g.fillCircle(6, 5, 3); // wheels
    g.fillStyle(0xf1c40f, 1); g.fillRect(-1, -16, 2, 10);    // flag pole
    g.fillStyle(0xf1c40f, 1); g.fillTriangle(1, -16, 1, -10, 10, -13); // flag
  }
  pickCaravanTarget(c) {
    const s = this.scene;
    const sites = (s.settlements && s.settlements.list) ? s.settlements.list : [];
    // Merchant rep 50+: head toward player territory; else a random settlement/wander.
    const rep = s.reputation ? s.reputation.scores.merchant : 0;
    const castle = s.buildings.castle;
    if (rep >= 50 && castle) { c.target = { col: castle.col + Phaser.Math.Between(-8, 8), row: castle.row + Phaser.Math.Between(-8, 8) }; return; }
    if (sites.length) { const t: any = Phaser.Utils.Array.GetRandom(sites); c.target = { col: t.col != null ? t.col : 100, row: t.row != null ? t.row : 100 }; return; }
    c.target = { col: Phaser.Math.Between(40, 160), row: Phaser.Math.Between(40, 160) };
  }

  // --- tribes --------------------------------------------------------------
  spawnTribes() {
    this.tribes.push(this.makeTribe('forest', 'Forest Tribe', 0x2e7d32));
    this.tribes.push(this.makeTribe('delta', 'Plains Tribe', 0xb5892a));
  }
  makeTribe(biome, name, color) {
    const s = this.scene;
    let col, row;
    if (biome === 'forest') { col = Phaser.Math.Between(60, 140); row = Phaser.Math.Between(8, 42); }
    else { col = Phaser.Math.Between(60, 140); row = Phaser.Math.Between(158, 192); }
    const { x, y } = s.tileCenter(col, row);
    const cont = s.add.container(x, y).setDepth(8);
    const g = s.add.graphics(); this.paintTents(g, color); cont.add(g);
    const t = { kind: 'tribe', biome, name, color, col, row, x, y, sprite: cont, relation: 'neutral', revealed: false, hostileUntil: 0, target: null };
    this.pickTribeTarget(t);
    return t;
  }
  paintTents(g, color) {
    g.clear();
    g.fillStyle(0x000000, 0.22); g.fillEllipse(0, 8, 34, 9);
    const tent = (x) => { g.fillStyle(color, 1); g.fillTriangle(x - 8, 8, x + 8, 8, x, -10); g.fillStyle(0x3a2a1a, 1); g.fillRect(x - 1, -2, 2, 10); };
    tent(-11); tent(11); tent(0);
  }
  pickTribeTarget(t) {
    if (t.biome === 'forest') t.target = { col: Phaser.Math.Between(55, 145), row: Phaser.Math.Between(6, 44) };
    else t.target = { col: Phaser.Math.Between(55, 145), row: Phaser.Math.Between(156, 194) };
  }

  // --- pilgrims ------------------------------------------------------------
  spawnPilgrim() {
    const s = this.scene;
    const edge = Phaser.Math.Between(0, 3);
    let col, row, tcol, trow;
    if (edge === 0) { col = 0; row = Phaser.Math.Between(20, 180); tcol = 199; trow = Phaser.Math.Between(20, 180); }
    else if (edge === 1) { col = 199; row = Phaser.Math.Between(20, 180); tcol = 0; trow = Phaser.Math.Between(20, 180); }
    else if (edge === 2) { col = Phaser.Math.Between(20, 180); row = 0; tcol = Phaser.Math.Between(20, 180); trow = 199; }
    else { col = Phaser.Math.Between(20, 180); row = 199; tcol = Phaser.Math.Between(20, 180); trow = 0; }
    const { x, y } = s.tileCenter(col, row);
    const cont = s.add.container(x, y).setDepth(8);
    const g = s.add.graphics();
    g.fillStyle(0x000000, 0.2); g.fillEllipse(0, 6, 26, 6);
    // four small pilgrim figures walking in a line
    for (let i = 0; i < 4; i++) { g.fillStyle(0xe8e0cc, 1); g.fillCircle(-9 + i * 6, 0, 2.4); g.fillStyle(0xb8b0a0, 1); g.fillRect(-10.2 + i * 6, 2, 2.4, 5); }
    cont.add(g);
    this.pilgrim = { kind: 'pilgrim', col, row, x, y, sprite: cont, target: { col: tcol, row: trow }, stopDays: 0 };
  }

  // --- per-frame movement + interaction ------------------------------------
  update(dt) {
    if (!dt) return;
    for (const c of this.caravans) this.moveCaravan(c, dt);
    for (const t of this.tribes) this.moveTribe(t, dt);
    if (this.pilgrim) this.movePilgrim(this.pilgrim, dt);
    this.checkProximity();
  }

  step(ent, speed, dt) {
    if (!ent.target) return false;
    const dc = ent.target.col - ent.col, dr = ent.target.row - ent.row;
    const d = Math.hypot(dc, dr);
    if (d < 0.6) return true; // arrived
    const m = speed * dt;
    ent.col += (dc / d) * m; ent.row += (dr / d) * m;
    // (BUG 6) Never let a roaming entity drift to NaN or off-map.
    const N = this.scene.COLS || 200;
    if (!isFinite(ent.col) || !isFinite(ent.row)) { ent.col = N / 2; ent.row = N / 2; }
    ent.col = Phaser.Math.Clamp(ent.col, 0, N - 1); ent.row = Phaser.Math.Clamp(ent.row, 0, N - 1);
    const { x, y } = this.scene.tileCenter(ent.col, ent.row);
    ent.x = x; ent.y = y; if (ent.sprite) ent.sprite.setPosition(x, y);
    return false;
  }

  moveCaravan(c, dt) {
    if (c.state === 'gone') return;
    if (c.state === 'stopped') return; // paused for trade/raid prompt
    if (this.step(c, CARAVAN_SPEED, dt)) { c.traded = false; this.pickCaravanTarget(c); }
  }
  moveTribe(t, dt) {
    if (this.step(t, TRIBE_SPEED, dt)) this.pickTribeTarget(t);
  }
  movePilgrim(p, dt) {
    if (p.stopDays > 0) return; // resting at a monastery
    if (this.step(p, PILGRIM_SPEED, dt)) { this.removePilgrim(); return; }
    // happiness bonus while crossing player territory
    if (this.scene.territory && this.scene.territory.playerLevel && this.scene.territory.playerLevel(Math.round(p.col), Math.round(p.row))) {
      if (!p._gaveHappy) { p._gaveHappy = true; if (this.scene.population) this.scene.population.addTempMod('Pilgrims passing', 5, 2); }
    }
  }
  removePilgrim() { if (this.pilgrim && this.pilgrim.sprite) this.pilgrim.sprite.destroy(); this.pilgrim = null; }

  // Player units/armies near a caravan → stop it and raise the interaction prompt.
  checkProximity() {
    const s = this.scene;
    const reach = 3 * s.TILE;
    const units = [];
    if (s.armyMgr) for (const a of s.armyMgr.playerArmies()) units.push(s.tileCenter(a.col, a.row));
    if (s.troops) for (const u of s.troops.allUnits()) units.push({ x: u.x, y: u.y });
    let active = null;
    for (const c of this.caravans) {
      if (c.state === 'gone') continue;
      const near = units.some((u) => Math.hypot(u.x - c.x, u.y - c.y) <= reach);
      c.state = near ? 'stopped' : (c.state === 'stopped' ? 'roam' : c.state);
      if (near && !active) active = c;
    }
    // tribe discovery (within 5 tiles)
    const treach = 5 * s.TILE;
    for (const t of this.tribes) {
      if (t.revealed) continue;
      if (units.some((u) => Math.hypot(u.x - t.x, u.y - t.y) <= treach)) this.revealTribe(t);
    }
    // pilgrims vanish if an army gets too close (cannot be attacked)
    if (this.pilgrim) { const p = this.pilgrim; if (units.some((u) => Math.hypot(u.x - p.x, u.y - p.y) <= 2 * s.TILE)) this.removePilgrim(); }
    if (active !== this._active) { this._active = active; this.refreshPrompt(); }
  }

  revealTribe(t) {
    t.revealed = true;
    const s = this.scene;
    if (!t.label) t.label = s.add.text(t.x, t.y - 26, t.name, { fontFamily: 'monospace', fontSize: '12px', color: '#ffd27f', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(9000);
    s.worldEvents && s.worldEvents.pushNews('A wandering tribe has noticed your kingdom.');
    s.showDiscovery && s.showDiscovery('tribe', t.name, t.biome === 'forest' ? 'A reclusive forest people who know every trail beneath the ancient canopy.' : 'Hardy plains-folk who follow the great river and its seasons.');
    s.logEvent && s.logEvent(`Discovered ${t.name}`, 'gold');
  }

  // --- caravan interaction UI ---------------------------------------------
  refreshPrompt() {
    const s = this.scene;
    if (this._promptEls) { this._promptEls.forEach((o) => o.destroy()); this._promptEls = null; }
    const c = this._active; if (!c) return;
    const fix = (o) => o.setScrollFactor(0).setDepth(95);
    const W = 300, px = (960 - W) / 2, py = 86, els = [];
    els.push(fix(s.add.rectangle(px, py, W, 56, 0x1a120a, 0.97).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.9)));
    els.push(fix(s.add.text(px + W / 2, py + 10, `${c.name} nearby`, { fontFamily: 'monospace', fontSize: '13px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0)));
    const mk = (bx, label, bg, fn) => {
      const b = fix(s.add.rectangle(bx, py + 30, 130, 20, bg).setOrigin(0, 0).setStrokeStyle(1, 0xf0e6c8, 0.8).setInteractive({ useHandCursor: true }));
      els.push(b);
      els.push(fix(s.add.text(bx + 65, py + 40, label, { fontFamily: 'monospace', fontSize: '12px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));
      b.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); fn(); });
    };
    mk(px + 12, c.traded ? 'Traded' : 'Trade', c.traded ? 0x444 : 0x1f5b3a, () => { if (!c.traded) this.openTrade(c); });
    mk(px + 158, 'Raid', 0x5c1a1a, () => this.raid(c));
    this._promptEls = els;
    s.routeCameras && s.routeCameras();
  }

  caravanTrades(c): any[] {
    const s = this.scene;
    const bonus = (s.reputation && s.reputation.scores.merchant >= 25) ? 1.15 : 1;
    return [
      ['15 wood → 20 gold', { wood: 15 }, { gold: Math.round(20 * bonus) }],
      ['15 stone → 22 gold', { stone: 15 }, { gold: Math.round(22 * bonus) }],
      ['10 gold → 20 wood', { gold: 10 }, { wood: Math.round(20 * bonus) }],
    ];
  }

  openTrade(c) {
    const s = this.scene, fix = (o) => o.setScrollFactor(0).setDepth(116);
    if (this._tradeEls) this._tradeEls.forEach((o) => o.destroy());
    const W = 420, H = 200, x = (960 - W) / 2, y = (900 - H) / 2, els = [];
    els.push(fix(s.add.rectangle(0, 0, 960, 900, 0x05070b, 0.5).setOrigin(0, 0).setInteractive()));
    els.push(fix(s.add.rectangle(x, y, W, H, 0x241a0e, 0.99).setOrigin(0, 0).setStrokeStyle(3, 0xc9a14a, 0.9)));
    els.push(fix(s.add.text(x + W / 2, y + 14, `${c.name} — Trade`, { fontFamily: 'monospace', fontSize: '16px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0)));
    els.push(fix(s.add.text(x + W / 2, y + 38, 'Better rates than your Market — one trade per encounter', { fontFamily: 'monospace', fontSize: '10px', color: '#cfc1a6' }).setOrigin(0.5, 0)));
    const close = () => { els.forEach((o) => o.destroy()); this._tradeEls = null; };
    this.caravanTrades(c).forEach(([label, give, get], i) => {
      const by = y + 64 + i * 36;
      const can = s.resources.canAfford(give) && !c.traded;
      const b = fix(s.add.rectangle(x + 20, by, W - 40, 30, can ? 0x2d6cb0 : 0x39393f).setOrigin(0, 0).setStrokeStyle(1, 0xf0e6c8, can ? 0.85 : 0.4));
      els.push(b);
      els.push(fix(s.add.text(x + W / 2, by + 15, label, { fontFamily: 'monospace', fontSize: '13px', color: can ? '#fff' : '#9aa0a6', fontStyle: 'bold' }).setOrigin(0.5)));
      if (can) { b.setInteractive({ useHandCursor: true }); b.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.doTrade(c, give, get); close(); }); }
    });
    this._tradeEls = els;
    s.routeCameras && s.routeCameras();
  }

  doTrade(c, give, get) {
    const s = this.scene;
    if (!s.resources.canAfford(give) || c.traded) return;
    s.resources.spend(give);
    for (const [r, v] of Object.entries(get)) s.resources.add(r, v);
    c.traded = true;
    if (s.reputation) s.reputation.add('merchant', 3);
    if (s.stats) s.stats.note('caravanTrades');
    s.showToast && s.showToast(`Traded with ${c.name}`);
    this.refreshPrompt();
  }

  raid(c) {
    const s = this.scene;
    const types = ['wood', 'stone', 'food', 'gold'];
    const r = Phaser.Utils.Array.GetRandom(types);
    const amt = Phaser.Math.Between(30, 80);
    s.resources.add(r, amt);
    if (s.reputation) s.reputation.add('merchant', -20);
    if (s.diplomacy) for (const k of s.kingdoms || []) s.diplomacy.change(k.cfg.key, -5);
    s.showToast && s.showToast(`Raided ${c.name}: +${amt} ${r} (merchants angered)`);
    s.logEvent && s.logEvent(`Raided ${c.name} (+${amt} ${r}, merchant rep -20)`, 'red');
    c.state = 'gone'; c.respawnDay = s.gameDay + 5;
    if (c.sprite) c.sprite.setVisible(false);
    this._active = null; this.refreshPrompt();
  }

  // --- tribe relations -----------------------------------------------------
  befriendTribe(key) {
    const s = this.scene;
    const t = this.tribes.find((x) => x.biome === key) || this.tribes.find((x) => x.name === key) || this.tribes[0];
    if (!t) return;
    t.relation = 'friendly'; t.revealed = true;
    this.revealBiome(t.biome);
    s.showToast && s.showToast(`${t.name} is now friendly`);
    s.logEvent && s.logEvent(`${t.name} became friendly — their lands are revealed`, 'green');
  }
  raidTribe(t) {
    t.relation = 'hostile'; t.hostileUntil = this.scene.gameDay + 10;
    this.scene.logEvent && this.scene.logEvent(`${t.name} turned hostile`, 'red');
  }
  revealBiome(biome) {
    const s = this.scene; if (!s.territory) return;
    const t = s.territory;
    for (let r = 0; r < s.ROWS; r++) for (let col = 0; col < s.COLS; col++) {
      if (s.biomeAt(col, r) === biome && !t.explored[r][col]) { t.explored[r][col] = true; const bob = s.terrainTiles[r] && s.terrainTiles[r][col]; if (bob) bob.setTint(t.tintFor(col, r)); }
    }
    s._fogDirty = true; // (BUG 7)
  }

  // --- daily ---------------------------------------------------------------
  onNewDay() {
    const s = this.scene;
    // caravan respawn
    for (const c of this.caravans) {
      if (c.state === 'gone' && s.gameDay >= c.respawnDay) { c.state = 'roam'; c.traded = false; const col = Phaser.Math.Between(60, 140), row = Phaser.Math.Between(60, 140); c.col = col; c.row = row; const p = s.tileCenter(col, row); c.x = p.x; c.y = p.y; c.sprite.setPosition(p.x, p.y).setVisible(true); this.pickCaravanTarget(c); }
    }
    // friendly tribe gifts / hostile decay
    for (const t of this.tribes) {
      if (t.relation === 'friendly' && Math.random() < 0.25) {
        if (t.biome === 'forest') { s.resources.add('wood', 20); s.logEvent && s.logEvent(`${t.name} sends timber: +20 wood`, 'green'); }
        else { s.resources.add('food', 30); s.logEvent && s.logEvent(`${t.name} sends food: +30 food`, 'green'); }
      }
      if (t.relation === 'hostile') {
        if (s.gameDay >= t.hostileUntil) { t.relation = 'neutral'; }
        else if (s.nodes && s.nodes.nodes) { // drain a couple nodes in their biome faster
          const inBiome = s.nodes.nodes.filter((n) => n.alive && s.biomeAt(Math.round(s.screenToTile(n.x, n.y).col), Math.round(s.screenToTile(n.x, n.y).row)) === t.biome);
          for (let i = 0; i < 2 && i < inBiome.length; i++) { const n = inBiome[i]; n.count = Math.max(0, n.count - 4); n.refreshLabel && n.refreshLabel(); }
        }
      }
    }
    // pilgrim every 10 days
    if (!this.pilgrim && s.gameDay - this._pilgrimDay >= 10) { this._pilgrimDay = s.gameDay; this.spawnPilgrim(); }
    // pilgrim donations at a monastery
    if (this.pilgrim && this.pilgrim.stopDays > 0) { this.pilgrim.stopDays -= 1; s.resources.add('gold', 15); if (this.pilgrim.stopDays <= 0) { /* resume */ } }
  }

  // --- continent dots ------------------------------------------------------
  continentDots() {
    const out: any[] = [];
    for (const c of this.caravans) if (c.state !== 'gone') out.push({ col: c.col, row: c.row, color: 0x8a5a2a });
    for (const t of this.tribes) out.push({ col: t.col, row: t.row, color: 0xe08a2a });
    if (this.pilgrim) out.push({ col: this.pilgrim.col, row: this.pilgrim.row, color: 0xffffff });
    return out;
  }

  // --- save ----------------------------------------------------------------
  serialize() {
    return {
      caravans: this.caravans.map((c) => ({ num: c.num, col: c.col, row: c.row, state: c.state, respawnDay: c.respawnDay, traded: c.traded })),
      tribes: this.tribes.map((t) => ({ biome: t.biome, col: t.col, row: t.row, relation: t.relation, revealed: t.revealed, hostileUntil: t.hostileUntil })),
      pilgrimDay: this._pilgrimDay,
    };
  }
  restore(d: any) {
    if (!d) return;
    if (d.caravans) d.caravans.forEach((cd, i) => { const c = this.caravans[i]; if (!c) return; Object.assign(c, { col: cd.col, row: cd.row, state: cd.state, respawnDay: cd.respawnDay, traded: cd.traded }); const p = this.scene.tileCenter(cd.col, cd.row); c.x = p.x; c.y = p.y; c.sprite.setPosition(p.x, p.y).setVisible(cd.state !== 'gone'); });
    if (d.tribes) d.tribes.forEach((td) => { const t = this.tribes.find((x) => x.biome === td.biome); if (!t) return; Object.assign(t, { col: td.col, row: td.row, relation: td.relation, revealed: td.revealed, hostileUntil: td.hostileUntil }); const p = this.scene.tileCenter(td.col, td.row); t.x = p.x; t.y = p.y; t.sprite.setPosition(p.x, p.y); if (td.revealed && !t.label) t.label = this.scene.add.text(p.x, p.y - 26, t.name, { fontFamily: 'monospace', fontSize: '12px', color: '#ffd27f', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(9000); });
    this._pilgrimDay = d.pilgrimDay || 0;
  }
}
