// FactionLeaders.ts (V2 Phase 1) — the three AI kingdoms get named rulers with
// personalities, voices and special behaviours. Keyed by faction ('red' /
// 'purple' / 'yellow'). Portraits are generated in AssetGenerator (portrait_<faction>).
export interface LeaderDef {
  faction: string;
  name: string;
  title: string;
  color: number;
  personality: string;
  lines: Record<string, string[]>;
}

const DEFS: Record<string, LeaderDef> = {
  red: {
    faction: 'red', name: 'General Valdris', title: 'General', color: 0xc0392b, personality: 'aggressive',
    lines: {
      war: ['Your walls will not save you.', 'Strength decides this. Nothing else.'],
      trade: ['Keep your coin. I want your banners in the dirt.'],
      ceasefire: ['A temporary mercy. Do not mistake it for weakness.'],
      council: ['Let us make this quick. I have a war to plan.'],
      winning: ['You should have knelt while you could.'],
      defeated: ['...A worthy blow. But the war is not over.'],
    },
  },
  purple: {
    faction: 'purple', name: 'Countess Elowen', title: 'Countess', color: 0x8e44ad, personality: 'calculating',
    lines: {
      war: ['A pity. We could have profited together.'],
      trade: ['Perhaps we can reach an arrangement.', 'Information is the only currency that matters.'],
      ceasefire: ['A wise choice. Wisdom is so rare these days.'],
      council: ['Welcome, Your Grace. I trust this meeting is worth the journey.'],
      gift: ['A small gift — consider it an investment in our friendship.'],
    },
  },
  yellow: {
    faction: 'yellow', name: 'Warlord Krag', title: 'Warlord', color: 0xd6c04a, personality: 'impulsive',
    lines: {
      war: ['Krag takes what Krag wants!'],
      trade: ['Your gold. Krag’s now.'],
      ceasefire: ['Krag stops fighting. For now. Maybe.'],
      council: ['Krag came! Where is the feast?!'],
      gift: ['Krag gives gift! Krag is generous!'],
      respect: ['You fight good. Krag... respects you. Bah!'],
    },
  },
};

export class FactionLeaders {
  scene: any;
  state: Record<string, any>; // per-faction mutable state
  [key: string]: any;

  constructor(scene: any) {
    this.scene = scene;
    this.state = {};
    for (const k of Object.keys(DEFS)) this.state[k] = { timesDefeated: 0, tradesWith: 0, respects: false, chaosUntil: 0, gaveIntel: false };
  }

  def(faction: string): LeaderDef | null { return DEFS[faction] || null; }
  name(faction: string): string { const d = DEFS[faction]; return d ? d.name : faction; }
  portraitKey(faction: string): string { return 'portrait_' + faction; }

  // Pick a personality-appropriate line and show it as a speech bubble.
  say(faction: string, kind: string) {
    const d = DEFS[faction]; if (!d) return;
    const pool = d.lines[kind] || d.lines.war || ['...'];
    const line = pool[Math.floor(Math.random() * pool.length)];
    if (this.scene.showLeaderSpeech) this.scene.showLeaderSpeech(faction, line);
  }

  // ---- special behaviours --------------------------------------------------
  // Valdris killed in battle → Red Kingdom in chaos (no attacks) for 5 days.
  onLeaderKilled(faction: string) {
    if (faction !== 'red') return;
    this.state.red.chaosUntil = (this.scene.gameDay || 0) + 5;
    this.scene.logEvent && this.scene.logEvent('General Valdris has fallen — the Red Kingdom descends into chaos.', 'gold');
  }
  inChaos(faction: string): boolean { const st = this.state[faction]; return !!(st && st.chaosUntil && (this.scene.gameDay || 0) < st.chaosUntil); }

  // Elowen: trade 5+ times → she gifts exclusive intel on the other leaders.
  onTrade(faction: string) {
    const st = this.state[faction]; if (!st) return;
    st.tradesWith = (st.tradesWith || 0) + 1;
    if (faction === 'purple' && st.tradesWith >= 5 && !st.gaveIntel) {
      st.gaveIntel = true;
      for (const k of this.scene.kingdoms || []) if (k.cfg.key !== 'purple') k._spyUntil = (this.scene.gameDay || 0) + 6;
      this.say('purple', 'gift');
      this.scene.logEvent && this.scene.logEvent('Countess Elowen shares intelligence on Valdris and Krag.', 'green');
    }
  }

  // Krag: defeated 3 times → permanent +20 base relations.
  onDefeatInBattle(faction: string) {
    const st = this.state[faction]; if (!st) return;
    st.timesDefeated = (st.timesDefeated || 0) + 1;
    if (faction === 'yellow' && st.timesDefeated >= 3 && !st.respects) {
      st.respects = true;
      if (this.scene.diplomacy) this.scene.diplomacy.change('yellow', 20, 'Krag respects you');
      this.say('yellow', 'respect');
      this.scene.logEvent && this.scene.logEvent('Warlord Krag now respects you (+20 relations).', 'gold');
    }
  }
  kragRespects(): boolean { return !!this.state.yellow.respects; }

  serialize() { return this.state; }
  restore(d: any) { if (!d) return; for (const k of Object.keys(this.state)) if (d[k]) Object.assign(this.state[k], d[k]); }
}
