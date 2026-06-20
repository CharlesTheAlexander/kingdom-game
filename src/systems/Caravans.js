import Phaser from 'phaser';
import { GAME_W } from '../scenes/GameScene.js';

// Caravans (Phase 5). Trade routes between your settlements (the main Castle +
// any conquered settlements). Once you own 2+ sites you can run up to 3 routes;
// each delivers its source settlement's specialty resource to the Castle once
// per day, scaled by distance, and can be raided en route (partial loss).

const MAX_ROUTES = 3;

export class Caravans {
  constructor(scene) {
    this.scene = scene;
    this.routes = []; // { from, to, resource, amount, progress }
  }

  // Owned sites: the main Castle plus conquered neutral settlements.
  sites() {
    const s = this.scene;
    const out = [];
    if (s.buildings.castle) out.push({ name: 'Castle', col: s.buildings.castle.col, row: s.buildings.castle.row, x: s.buildings.castle.x, y: s.buildings.castle.y, specialty: 'gold' });
    if (s.settlements) for (const st of s.settlements.list) if (st.owner === 'player') out.push({ name: st.name, col: st.col, row: st.row, x: st.x, y: st.y, specialty: st.specialty });
    return out;
  }

  canEstablish() { return this.sites().length >= 2 && this.routes.length < MAX_ROUTES; }

  establish(from, to) {
    if (this.routes.length >= MAX_ROUTES) { this.scene.showToast('Max 3 caravan routes'); return; }
    const dist = Phaser.Math.Distance.Between(from.col, from.row, to.col, to.row);
    this.routes.push({ from, to, resource: from.specialty, amount: 40, progress: 0, days: Math.max(1, Math.round(dist / 30)) });
    if (this.scene.showToast) this.scene.showToast(`Caravan route: ${from.name} → ${to.name}`);
    this.scene.refreshPanel();
  }

  onNewDay() {
    for (const r of this.routes) {
      r.progress += 1;
      if (r.progress >= r.days) {
        r.progress = 0;
        let amt = r.amount;
        if (Math.random() < 0.2) { amt = Math.round(amt * 0.5); if (this.scene.threatWarning) this.scene.threatWarning('A caravan was raided! Cargo halved.', 0xff8a80); }
        this.scene.resources.add(r.resource, amt);
        const c = this.scene.buildings.castle;
        if (c && this.scene.floatText) this.scene.floatText(c.x, c.y - 40, `Caravan: +${amt} ${r.resource}`, '#cfe0ff');
      }
    }
  }

  // Bottom-panel UI: list sites, establish routes, show active ones.
  renderPanel() {
    const s = this.scene;
    s.panel.add(s.add.rectangle(8, s.PANEL_Y + 8, GAME_W - 16, 130 - 16, 0x121a24, 0.96).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.7).setScrollFactor(0));
    s.panelText(16, s.PANEL_Y + 10, `CARAVANS  (${this.routes.length}/${MAX_ROUTES} routes)`, { bold: true, color: '#cfe0ff' });
    const sites = this.sites();
    s.panelText(16, s.PANEL_Y + 30, `Owned: ${sites.map((x) => x.name).join(', ')}`, { color: '#b9c6d6', size: '12px' });
    // Quick-establish buttons: each non-castle site → Castle.
    let x = 16;
    const castle = sites.find((z) => z.name === 'Castle');
    for (const site of sites) {
      if (site.name === 'Castle') continue;
      const exists = this.routes.some((r) => r.from.name === site.name);
      const can = this.canEstablish() && !exists;
      s.spriteButton(x, s.PANEL_Y + 50, 150, 34, `${site.name}→Castle`, `${site.specialty} 40/trip`, can, () => this.establish(site, castle));
      x += 156;
      if (x > GAME_W - 320) break;
    }
    // (Phase 6) Administrator toggles for conquered settlements.
    const owned = s.settlements ? s.settlements.owned() : [];
    let ax = 16;
    for (const st of owned) {
      s.spriteButton(ax, s.PANEL_Y + 88, 168, 28, `${st.name}: ${st.admin ? 'Admin ✓' : 'Direct'}`, st.admin ? '+30% tribute, -50g/day' : 'tap for Administrator', true, () => s.settlements.toggleAdmin(st), { active: st.admin });
      ax += 174;
      if (ax > GAME_W - 200) break;
    }
    if (!owned.length) s.panelText(16, s.PANEL_Y + 90, 'Conquer settlements to assign Administrators and run caravans.', { color: '#cfc1a6', size: '11px' });
    s.spriteButton(GAME_W - 88, s.PANEL_Y + 8, 78, 22, 'Back', '', true, () => { s.panelMode = 'build'; s.refreshPanel(); });
  }
}
