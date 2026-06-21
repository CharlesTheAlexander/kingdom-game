// Heroes.ts (V2 Phase 3) — named heroes join the kingdom, fight with armies,
// gain XP, and can fall permanently. Each arrives via a specific condition/event.
import { sfx } from '../audio/SoundEngine.js';

export interface HeroDef {
  id: string; name: string; title: string; backstory: string;
  type: 'warrior' | 'monk' | 'merchant' | 'ranger' | 'scholar' | 'renegade';
  hp: number; passive: string; active: string;
}

const DEFS: Record<string, HeroDef> = {
  aldric: { id: 'aldric', name: 'Aldric', title: 'The Unbroken', type: 'warrior', hp: 140, backstory: 'A knight who held a bridge alone against a hundred. He has never knelt, and never fled.', passive: 'Nearby warriors +15% battle morale', active: 'Last Stand — halt a rout, restore morale to 40' },
  maren: { id: 'maren', name: 'Sister Maren', title: 'of the Quiet Light', type: 'monk', hp: 90, backstory: 'A healer whose hands close wounds that should be fatal. She asks for nothing in return.', passive: 'All monks heal 50% faster', active: 'Field Hospital — 25% of the fallen return after battle' },
  caelan: { id: 'caelan', name: 'Lord Caelan', title: 'the Merchant Prince', type: 'merchant', hp: 80, backstory: 'He turned a single cart into a trading empire. Coin obeys him like a loyal hound.', passive: 'All market trades 25% better', active: 'Trade Deal — instant trade route with any faction' },
  mira: { id: 'mira', name: 'Mira Swiftarrow', title: 'of the Silver Bow', type: 'ranger', hp: 95, backstory: 'Found in stasis beneath a forest ruin, she woke as if no centuries had passed.', passive: 'Archers +20% range, fog reveals 40% faster', active: "Hunter's Mark — marked enemies take double damage" },
  tomas: { id: 'tomas', name: 'Elder Tomas', title: 'the Last Archivist', type: 'scholar', hp: 75, backstory: 'He remembers the empire that fell. He intends not to repeat its mistakes.', passive: 'All research 25% faster', active: 'Ancient Knowledge — instantly finish current research' },
  ravel: { id: 'ravel', name: 'Commander Ravel', title: 'the Renegade', type: 'renegade', hp: 120, backstory: 'Krag sent him as an insult. He stayed because, for the first time, he was given respect.', passive: 'Army morale never drops below 20', active: "Veteran's Rally — Elite units act again" },
};

const XP_THRESH = [0, 30, 80, 150, 250]; // index = level-1

export class Heroes {
  scene: any;
  roster: any[]; // joined heroes (living + fallen)
  offered: Record<string, boolean>;
  [key: string]: any;

  constructor(scene: any) {
    this.scene = scene;
    this.roster = [];
    this.offered = {};
  }

  living() { return this.roster.filter((h) => h.isAlive); }
  fallen() { return this.roster.filter((h) => !h.isAlive); }
  byId(id: string) { return this.roster.find((h) => h.id === id); }
  byArmy(armyId: string) { return this.roster.find((h) => h.isAlive && h.armyId === armyId); }
  def(id: string) { return DEFS[id]; }

  // ---- arrivals -----------------------------------------------------------
  // Checked daily; each hero is offered once when its condition is met.
  checkArrivals() {
    const s = this.scene, day = s.gameDay || 0;
    const has = (k: string) => s.buildings && s.buildings.countOfType(k) > 0;
    const rep = (k: string) => (s.reputation ? s.reputation.scores[k] || 0 : 0);
    const tryOffer = (id: string, cond: boolean) => { if (cond && !this.offered[id] && !this.byId(id)) this.offer(id); };
    tryOffer('aldric', day >= 8 && day <= 14);
    tryOffer('maren', has('monastery') || has('tavern')); // monastery stand-in
    tryOffer('caelan', rep('merchant') >= 50);
    tryOffer('tomas', has('library') && s.research && s.research.completed.size >= 4);
    tryOffer('ravel', !!(s.leaders && s.leaders.kragRespects && s.leaders.kragRespects()));
    // mira: offered when a forest ruin is explored (hooked from Ruins via offer()).
  }

  offer(id: string) {
    const d = DEFS[id]; if (!d || this.offered[id]) return; this.offered[id] = true;
    const s = this.scene;
    const ev = {
      id: 'hero_' + id, title: `${d.name}, ${d.title}`, body: () => `${d.backstory}\n\nPassive: ${d.passive}`,
      heroPortrait: 'hero_' + id,
      choices: [
        { label: 'Welcome them', effect: () => this.add(id) },
        { label: 'Send them away', effect: () => {} },
      ],
    };
    if (s.worldEvents) { s.worldEvents.queue.push(ev); s.worldEvents.refreshMessenger && s.worldEvents.refreshMessenger(); }
    else this.add(id); // no event system → auto-join
  }

  add(id: string) {
    const d = DEFS[id]; if (!d || this.byId(id)) return;
    const h: any = { id, name: d.name, title: d.title, backstory: d.backstory, type: d.type, hp: d.hp, maxHp: d.hp, xp: 0, level: 1, passive: d.passive, active: d.active, activeCooldown: 0, armyId: null, isAlive: true, battlesWon: 0, deathDay: null, deathLocation: null };
    this.roster.push(h);
    this.applyPassives();
    const s = this.scene;
    s.logEvent && s.logEvent(`${d.name} the ${d.title} has joined your kingdom!`, 'gold');
    s.showToast && s.showToast(`${d.name} joins you!`);
    sfx.play('hero_join'); // (V2 P4 #8) fanfare
    s.refreshPanel && s.refreshPanel();
  }

  // ---- leveling -----------------------------------------------------------
  grantXP(h: any, amount: number) {
    if (!h || !h.isAlive) return;
    h.xp += amount;
    while (h.level < 5 && h.xp >= XP_THRESH[h.level]) {
      h.level++;
      const mult = 1 + [0, 0.1, 0.2, 0.35, 0.5][h.level - 1];
      h.maxHp = Math.round(DEFS[h.id].hp * mult); h.hp = h.maxHp;
      this.scene.logEvent && this.scene.logEvent(`${h.name} reached level ${h.level}!`, 'green');
    }
  }
  xpForNext(h: any) { return h.level >= 5 ? h.xp : XP_THRESH[h.level]; }

  // Called after a battle for the hero attached to the army.
  onBattle(armyId: string, won: boolean, kills = 0) {
    const h = this.byArmy(armyId); if (!h) return;
    this.grantXP(h, 10 + kills * 5);
    if (won) h.battlesWon++;
  }

  // ---- death --------------------------------------------------------------
  kill(h: any, location = 'the field') {
    if (!h || !h.isAlive) return;
    h.isAlive = false; h.deathDay = this.scene.gameDay || 0; h.deathLocation = location; h.armyId = null;
    this.applyPassives();
    const s = this.scene;
    if (s.population) s.population.addTempMod(`Mourning ${h.name}`, -20, 3);
    s.logEvent && s.logEvent(`${h.name} the ${h.title} has fallen at ${location}. Day ${h.deathDay}.`, 'red');
    s.threatWarning && s.threatWarning(`${h.name} has fallen in battle`, 0xff4d4d, true);
    sfx.play('hero_death'); // (V2 P4 #8) somber tone
    s.refreshPanel && s.refreshPanel();
  }

  // ---- assignment + passives ---------------------------------------------
  assign(id: string, armyId: string | null) {
    const h = this.byId(id); if (!h || !h.isAlive) return;
    // one hero per army
    if (armyId) for (const o of this.roster) if (o !== h && o.armyId === armyId) o.armyId = null;
    h.armyId = armyId;
    this.scene.refreshPanel && this.scene.refreshPanel();
  }

  // Global passives are applied via scene flags; recomputed whenever the roster
  // changes so death cleanly removes a bonus.
  applyPassives() {
    const s = this.scene; const live = this.living();
    s._heroMarket = live.some((h) => h.type === 'merchant') ? 1.25 : 1;
    s._heroResearch = live.some((h) => h.type === 'scholar') ? 1.25 : 1;
    s._heroFog = live.some((h) => h.type === 'ranger') ? 1.4 : 1;
    s._heroMonkHeal = live.some((h) => h.type === 'monk') ? 1.5 : 1;
  }

  // Battle bonuses for an army carrying a hero (read by BattleScene).
  armyBattleMods(armyId: string) {
    const h = this.byArmy(armyId);
    if (!h) return null;
    return { id: h.id, name: h.name, type: h.type, level: h.level, moraleBonus: h.type === 'warrior' ? 0.15 : 0, moraleFloor: h.type === 'renegade' ? 20 : 0 };
  }

  // ---- Hall of Heroes -----------------------------------------------------
  hasHall() { return this.scene.buildings && this.scene.buildings.countOfType('hallofheroes') > 0; }
  // +5 battle morale per remembered fallen hero.
  fallenMoraleBonus() { return this.hasHall() ? this.fallen().length * 5 : 0; }

  serialize() { return { roster: this.roster, offered: this.offered }; }
  restore(d: any) { if (!d) return; this.roster = d.roster || []; this.offered = d.offered || {}; this.applyPassives(); }
}
