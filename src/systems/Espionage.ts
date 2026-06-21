import { sfx } from '../audio/SoundEngine.js';
// (V2 Phase 9) Espionage Network.
//
// Requires a Spy Guild (Intelligence building). Spies are trained for 80 gold
// over 2 days, then sent against rival factions on one of five missions:
//   • Gather Intel  — reveals their strength for 5 days (always succeeds)
//   • Sabotage      — 50%: throws them into regrouping; fail loses the spy
//   • Incite Revolt — 60%: unrest halves their fielded army for 6 days
//   • Assassinate   — 30%: kills their leader (chaos); fail costs relations
//   • Plant Rumors  — always: sows unrest and turns a third faction your way

export const MISSIONS: Record<string, any> = {
  intel: { label: 'Gather Intel', chance: 1.0, desc: 'Reveal their strength for 5 days.' },
  sabotage: { label: 'Sabotage', chance: 0.5, desc: 'Wreck a building — they regroup. Fail loses the spy.' },
  incite: { label: 'Incite Revolt', chance: 0.6, desc: 'Unrest halves their army for 6 days.' },
  assassinate: { label: 'Assassinate', chance: 0.3, desc: 'Kill their leader. Fail costs relations.' },
  rumors: { label: 'Plant Rumors', chance: 1.0, desc: 'Sow discord; a rival warms to you.' },
};

export class Espionage {
  scene: any;
  spies: number;
  training: any[];
  [key: string]: any;

  constructor(scene: any) {
    this.scene = scene;
    this.spies = 0;
    this.training = []; // [{ daysLeft }]
  }

  hasGuild() {
    return this.scene.buildings && this.scene.buildings.buildings.some((b: any) => b.alive && b.typeKey === 'intelligence');
  }

  trainSpy() {
    if (!this.hasGuild()) { if (this.scene.showToast) this.scene.showToast('Build a Spy Guild first'); return false; }
    if (!this.scene.resources.spend({ gold: 80 })) { if (this.scene.showToast) this.scene.showToast('Need 80 gold'); return false; }
    this.training.push({ daysLeft: 2 });
    if (this.scene.showToast) this.scene.showToast('A spy is in training (2 days)');
    return true;
  }

  onNewDay() {
    if (!this.training.length) return;
    for (const t of this.training) t.daysLeft -= 1;
    const done = this.training.filter((t) => t.daysLeft <= 0).length;
    if (done) { this.spies += done; if (this.scene.logEvent) this.scene.logEvent(`${done} spy${done > 1 ? 'ies' : ''} ready for missions`, 'green'); }
    this.training = this.training.filter((t) => t.daysLeft > 0);
  }

  enemyFactions() {
    return (this.scene.kingdoms || []).map((k: any) => k.cfg && k.cfg.key).filter(Boolean);
  }
  kingdom(key: string) { return (this.scene.kingdoms || []).find((k: any) => k.cfg && k.cfg.key === key); }

  // Run a mission against `key`. Consumes one spy. Returns a result string.
  runMission(type: string, key: string) {
    const m = MISSIONS[type]; if (!m) return null;
    if (this.spies <= 0) { if (this.scene.showToast) this.scene.showToast('No trained spies'); return null; }
    this.spies -= 1;
    sfx.play('spy_mission'); // (V2 P4 #8) intrigue
    const k = this.kingdom(key);
    const name = k && k.cfg ? k.cfg.name : key;
    const day = this.scene.gameDay || 0;
    const success = Math.random() < m.chance;
    let msg = '';
    switch (type) {
      case 'intel':
        if (k) k._spyUntil = day + 5;
        msg = `Intel gathered on the ${name} — their strength is revealed for 5 days`;
        break;
      case 'sabotage':
        if (success) { if (k) { k.regrouping = true; k.rebuildTimer = Math.max(k.rebuildTimer || 0, 5 * (this.scene.DAY_SECONDS || 30)); } msg = `Sabotage successful — the ${name} are thrown into disarray`; }
        else { msg = `Sabotage failed — the spy was caught and lost`; if (this.scene.diplomacy) this.scene.diplomacy.change && this.scene.diplomacy.change(key, -10, 'caught spy'); }
        break;
      case 'incite':
        if (success) { if (k) k._unrestUntil = day + 6; msg = `Revolt incited — the ${name} are in unrest (army halved for 6 days)`; }
        else { msg = `The uprising fizzled — the spy was lost`; }
        break;
      case 'assassinate':
        if (success) {
          if (this.scene.leaders && this.scene.leaders.onLeaderKilled) this.scene.leaders.onLeaderKilled(key);
          if (k) { k.regrouping = true; }
          msg = `Assassination successful — the ${name}'s leader is dead, their court in chaos`;
        } else { msg = `Assassination failed — the spy was executed`; if (this.scene.diplomacy && this.scene.diplomacy.change) this.scene.diplomacy.change(key, -15, 'assassination attempt'); }
        break;
      case 'rumors': {
        if (k) k._unrestUntil = day + 6;
        const others = this.enemyFactions().filter((f: string) => f !== key);
        const ally = others[Math.floor(Math.random() * others.length)];
        if (ally && this.scene.diplomacy && this.scene.diplomacy.change) this.scene.diplomacy.change(ally, 8, 'shared rival');
        msg = `Rumors planted — the ${name} are distracted${ally ? `, and the ${this.kingdom(ally) && this.kingdom(ally).cfg ? this.kingdom(ally).cfg.name : ally} warm to you` : ''}`;
        break;
      }
    }
    if (this.scene.logEvent) this.scene.logEvent(msg, success ? 'green' : 'orange');
    if (this.scene.refreshPanel) this.scene.refreshPanel();
    return msg;
  }

  serialize() { return { spies: this.spies, training: this.training }; }
  restore(d: any) { if (!d) return; this.spies = d.spies || 0; this.training = d.training || []; }
}
