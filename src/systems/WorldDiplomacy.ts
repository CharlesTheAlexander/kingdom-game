// ============================================================================
// WorldDiplomacy.ts — Phase 7 (Bannerlord rebuild) DIPLOMATIC NARRATIVE.
// ============================================================================
//
// Phase 7 makes diplomacy PERSONAL and REMEMBERED at the CONTINENT/world level.
// The original `Diplomacy` (relation meters / treaties / NAP / alliance) and
// `FactionLeaders` (named rulers Valdris / Elowen / Krag with voices) were both
// neutered inside the now-per-settlement IsometricScene. This module RE-HOMES
// them to GameWorld (exactly as Phase 6 re-homed Heroes via a host adapter) and
// layers on:
//
//   1. RE-HOMING   — GameWorld.diplomacy (a real Diplomacy instance) + GameWorld
//                    .leaders (a real FactionLeaders instance), both backed by a
//                    tiny world-level host adapter (diploHost) on GameWorld so the
//                    EXISTING relation/treaty/leader logic keeps working unchanged.
//                    Banked Phase-5 caravan-raid deltas (GameWorld.relationDeltas)
//                    are applied into real relations on init.
//   2. LEADER MEMORY — per faction, a serializable record of the shared history
//                    (battles for/against, treaties held/betrayed, tributes, wars,
//                    alliance, first contact). Incremented from REAL world events.
//   3. HISTORY DIALOGUE — leaders speak differently depending on that memory; the
//                    escalating spec lines are surfaced as a leader-portrait speech
//                    popup (ContinentScene) and in the diplomacy panel.
//   4. MEMORY EVENTS — threshold-crossing one-shots with real effects (Valdris
//                    sends warriors, Elowen shares intel, Krag gifts an artifact).
//   5. BETRAYAL CONSEQUENCES — breaking a treaty: angry line + ALL factions −10 +
//                    a "cannot be trusted" event + merchant caravans avoid player
//                    territory for 5 days (a flag the AI / ExpeditionSystem reads).
//   6. HONOR — a tracked player honor score (treaties upheld vs betrayals) that
//                    makes leaders cheaper/dearer to deal with; surfaced in the UI.
//
// DESIGN DECISIONS
// ----------------
// * STATELESS STATIC API (like HeroWorld / ExpeditionSystem). Every method
//   operates on GameWorld so any scene OR the headless audit can drive it. All
//   persistent state (relations via Diplomacy.serialize, leader state via
//   FactionLeaders.serialize, leaderMemory, honor, flags) lives in GameWorld and
//   stays JSON-friendly for Phase 12's SaveManager.
// * The Diplomacy/FactionLeaders CLASSES are reused as-is (not rewritten). The
//   host adapter satisfies their scene contract: `kingdoms` (the 3 AI factions as
//   {cfg:{key,name,color}, castleAlive}), `resources` (spend/add → GameWorld.gold),
//   `gameDay`, `showToast`/`logEvent` (→ GameWorld.notify), `leaders`/`diplomacy`
//   cross-refs, and harmless no-ops for the per-settlement-only hooks.
// * MEMORY is the source of truth for DIALOGUE. memoryLine(faction) reads the
//   recorded history (battles you won, treaties betrayed, allied, tributes…) and
//   returns the most fitting escalating line from the spec.
// ============================================================================

import { GameWorld } from './GameWorld.js';

/** The three AI faction keys this phase tracks (red/purple/yellow). */
export const FACTIONS = ['red', 'purple', 'yellow'] as const;
export type FactionKey = typeof FACTIONS[number];

/** Days merchant caravans avoid player territory after a betrayal. */
export const CARAVAN_AVOID_DAYS = 5;
/** Days Elowen must be allied before she shares all intel for free. */
export const ELOWEN_ALLY_DAYS = 10;

/** Per-leader remembered history of the shared relationship. ALL plain JSON so
 *  Phase 12 can serialize it. Incremented ONLY from real world events. */
export interface LeaderMemory {
  battlesAgainst: number;   // total battles fought against this faction
  battlesTheyWon: number;   // of those, the ones they won
  battlesYouWon: number;    // of those, the ones you won
  treatiesHeld: number;     // treaties currently/ever upheld over time
  treatiesBetrayed: number; // treaties you broke with them
  tributesPaid: number;     // tributes you sent them
  warsDeclared: number;     // wars you declared on them
  allied: boolean;          // currently allied
  firstContact: boolean;    // has the first-contact line fired yet
  alliedSinceDay: number;   // day the current alliance began (-1 = not allied)
  caravansRaided: number;   // (P5) caravans of theirs the player raided
}

/** A ready-to-render leader speech line: who + portrait + text. */
export interface LeaderLine { faction: string; name: string; portrait: string; text: string; }

function blankMemory(): LeaderMemory {
  return {
    battlesAgainst: 0, battlesTheyWon: 0, battlesYouWon: 0,
    treatiesHeld: 0, treatiesBetrayed: 0, tributesPaid: 0, warsDeclared: 0,
    allied: false, firstContact: false, alliedSinceDay: -1, caravansRaided: 0,
  };
}

export class WorldDiplomacy {
  static readonly FACTIONS = FACTIONS;
  static readonly CARAVAN_AVOID_DAYS = CARAVAN_AVOID_DAYS;
  static readonly ELOWEN_ALLY_DAYS = ELOWEN_ALLY_DAYS;

  // ==========================================================================
  // HISTORY-BASED LEADER DIALOGUE — the escalating lines from the spec.
  // memoryLine() picks the most fitting line from a faction's remembered history.
  // ==========================================================================
  /** The escalating spec lines, paraphrased/extended, per faction + situation.
   *  Keyed by a logical situation so the panel + popups can request a specific
   *  beat (firstContact / defeated1..3 / betrayed / allied / tribute / etc.). */
  static readonly LINES: Record<string, Record<string, string>> = {
    red: {
      firstContact: 'Another kingdom rises. We will see how long you last.',
      defeated1: 'You fight well. I will not make that mistake again.',
      defeated2: 'Twice now. I will not forget that.',
      defeated3: 'Three times. You have earned my respect, young crown.',
      betrayed: 'I knew you could not be trusted.',
      allied: 'Strange, to call you an ally. Not unwelcome.',
      tribute: 'Gold buys time. It does not buy my friendship.',
      war: 'So be it. Your walls will not save you.',
      council_hostile: 'I sit at this table only because steel grows dull unused.',
      council_respected: 'You have bled me thrice. For that, I will hear you out.',
      gift_warriors: 'Five of my best. Use them well — I will be watching.',
      neutral: 'We are not enemies today. Do not test tomorrow.',
    },
    purple: {
      firstContact: 'How interesting. A new power on the board. Wise of you to introduce yourself.',
      tradeAgreement: 'Our arrangement has been profitable. Long may it continue.',
      caughtSpying: 'I let your spies find it. Think about what that means.',
      betrayed: 'I expected this. The question is — did you prepare for what comes next?',
      marriage: 'Our houses are bound now. Try not to embarrass mine.',
      allied: 'An alliance of mutual interest. The most durable kind.',
      tribute: 'Generous. I do keep careful ledgers of such kindnesses.',
      war: 'A pity. We could have profited together.',
      council_allied: 'My ally arrives. Sit — I have already anticipated your proposals.',
      council: 'Welcome. Do try to keep up; I prepared remarks days ago.',
      share_intel: 'Ten days of trust. Here — everything I know of the others. Use it.',
      neutral: 'Information is the only currency that never depreciates.',
    },
    yellow: {
      firstContact: 'NEW KINGDOM! COME FIGHT KRAG!',
      defeated1: 'YOU WIN THIS TIME. KRAG REMEMBERS.',
      defeated2: 'Krag... respects you. Little.',
      defeated3: 'You are worthy enemy. Maybe worthy ally.',
      tribute: 'GOLD! Maybe Krag does not attack today.',
      caravanRaided: 'YOU TOOK KRAG\'S THINGS. Krag is impressed. Still angry.',
      betrayed: 'YOU LIE TO KRAG?! KRAG SMASH LIARS!',
      allied: 'Krag... fights BESIDE you now? Strange days. Krag likes strange.',
      war: 'WAR! Krag has been waiting for this!',
      council: 'KRAG BROUGHT SNACKS.',
      council_allied: 'KRAG BROUGHT SNACKS. For ALLY. Eat!',
      gift_artifact: 'Krag brings BIG axe. Old. Strong. For worthy enemy-friend.',
      neutral: 'Krag watches you. Krag always watches.',
    },
  };

  /** Pick the single most fitting line for a faction GIVEN its remembered history.
   *  This is the heart of "leaders speak differently based on memory": the same
   *  request ('greet') yields escalating text as the relationship deepens. */
  static memoryLine(faction: string, situation = 'greet'): string {
    const lib = this.LINES[faction] || {};
    const m = this.memory(faction);
    const rel = this.relation(faction);
    const allied = this.isAllied(faction);

    // Explicit situations always win (caller knows the beat).
    if (situation !== 'greet' && lib[situation]) return lib[situation];

    // First contact is the very first thing any leader says.
    if (!m.firstContact && lib.firstContact) return lib.firstContact;

    // Greeting escalates with the remembered history, strongest beat first.
    if (allied) {
      if (faction === 'purple' && m.alliedSinceDay >= 0 &&
          (GameWorld.displayDay() - m.alliedSinceDay) >= ELOWEN_ALLY_DAYS && lib.share_intel) return lib.share_intel;
      return lib.allied || lib.neutral || '...';
    }
    if (m.treatiesBetrayed > 0 && lib.betrayed) return lib.betrayed;
    if (m.battlesYouWon >= 3 && lib.defeated3) return lib.defeated3;
    if (m.battlesYouWon === 2 && lib.defeated2) return lib.defeated2;
    if (m.battlesYouWon === 1 && lib.defeated1) return lib.defeated1;
    if (faction === 'yellow' && m.caravansRaided > 0 && lib.caravanRaided) return lib.caravanRaided;
    if (faction === 'purple' && this.treaties(faction).trade && lib.tradeAgreement) return lib.tradeAgreement;
    if (m.tributesPaid > 0 && lib.tribute) return lib.tribute;
    if (rel <= -50 && lib.war) return lib.war;
    return lib.neutral || '...';
  }

  /** The line a leader speaks at the Great Council, varying with the relationship
   *  (hostile vs respected for Valdris; allied for Elowen/Krag). */
  static councilLine(faction: string): string {
    const lib = this.LINES[faction] || {};
    const m = this.memory(faction);
    if (faction === 'red') return (m.battlesYouWon >= 3 && lib.council_respected) ? lib.council_respected : (lib.council_hostile || '...');
    if (this.isAllied(faction) && lib.council_allied) return lib.council_allied;
    return lib.council || '...';
  }

  /** Build a LeaderLine (with portrait key + leader name) for rendering. */
  static line(faction: string, situation = 'greet'): LeaderLine {
    const text = this.memoryLine(faction, situation);
    return { faction, name: this.leaderName(faction), portrait: 'portrait_' + faction, text };
  }

  // ==========================================================================
  // RE-HOMING — the world host adapter + accessors over GameWorld.diplomacy /
  // .leaders. ensure() lazily wires both instances and applies banked deltas.
  // ==========================================================================
  /** Lazily build (once) the Diplomacy + FactionLeaders instances on GameWorld,
   *  apply banked Phase-5 caravan-raid relation deltas, and seed leader memory.
   *  Safe to call repeatedly (idempotent). */
  static ensure(): void {
    if (!GameWorld.diplomacy) {
      // Imported lazily-as-needed by GameWorld.diploHost() wiring; here we just
      // construct via GameWorld's helper so the host adapter is consistent.
      GameWorld.initDiplomacy();
    }
    if (!GameWorld.leaderMemory || Object.keys(GameWorld.leaderMemory).length === 0) {
      GameWorld.leaderMemory = {};
      for (const k of FACTIONS) GameWorld.leaderMemory[k] = blankMemory();
    }
    // Apply any banked caravan-raid deltas exactly once (Phase 5 → Phase 7 bridge).
    if (!GameWorld.diploFlags.deltasApplied) {
      for (const k of Object.keys(GameWorld.relationDeltas || {})) {
        const d = GameWorld.relationDeltas[k];
        if (d && GameWorld.diplomacy) GameWorld.diplomacy.change(k, d, 'caravan raids');
        // A raided caravan is a remembered slight (esp. for Krag's special line).
        if (d < 0) { const m = this.memory(k); m.caravansRaided += 1; }
      }
      GameWorld.diploFlags.deltasApplied = true;
    }
  }

  /** Per-faction memory record (lazily created). */
  static memory(faction: string): LeaderMemory {
    if (!GameWorld.leaderMemory[faction]) GameWorld.leaderMemory[faction] = blankMemory();
    return GameWorld.leaderMemory[faction];
  }

  static relation(faction: string): number { return GameWorld.diplomacy ? GameWorld.diplomacy.get(faction) : 0; }
  static treaties(faction: string): any { return GameWorld.diplomacy ? GameWorld.diplomacy.tr(faction) : { trade: false, alliance: false, vassal: false }; }
  static isAllied(faction: string): boolean { return GameWorld.diplomacy ? GameWorld.diplomacy.isAllied(faction) : false; }
  static status(faction: string): string { return GameWorld.diplomacy ? GameWorld.diplomacy.status(faction) : 'Neutral'; }
  static leaderName(faction: string): string { return GameWorld.leaders ? GameWorld.leaders.name(faction) : faction; }
  static factionName(faction: string): string {
    const f = GameWorld.world && GameWorld.world.factions.find(x => x.key === faction);
    return f ? f.name : faction;
  }

  // ==========================================================================
  // FIRST CONTACT — flag + first-contact line (fired the first time the player
  // meaningfully meets a faction: a battle, a treaty proposal, or entering the
  // panel). Returns a LeaderLine to render, or null if already met.
  // ==========================================================================
  static firstContact(faction: string): LeaderLine | null {
    this.ensure();
    const m = this.memory(faction);
    if (m.firstContact) return null;
    m.firstContact = true;
    return this.line(faction, 'firstContact');
  }

  // ==========================================================================
  // BATTLE MEMORY — called from continent / expedition battles vs a faction. The
  // single entry point Phase-7 verification drives ("record a win vs red 3×").
  // Returns any LeaderLine + memory event the result triggered, for the scene.
  // ==========================================================================
  static recordBattle(faction: string, playerWon: boolean): { line: LeaderLine | null; event: string | null } {
    this.ensure();
    if (!FACTIONS.includes(faction as FactionKey)) return { line: null, event: null };
    const m = this.memory(faction);
    m.battlesAgainst += 1;
    let line: LeaderLine | null = null;
    if (playerWon) {
      m.battlesYouWon += 1;
      // Escalating defeat lines (1/2/3). Krag + Valdris have full ladders.
      const sit = m.battlesYouWon === 1 ? 'defeated1' : m.battlesYouWon === 2 ? 'defeated2' : m.battlesYouWon >= 3 ? 'defeated3' : 'neutral';
      if (this.LINES[faction] && this.LINES[faction][sit]) line = this.line(faction, sit);
      // Winning bumps relations slightly toward grudging respect.
      if (GameWorld.diplomacy) GameWorld.diplomacy.change(faction, 5, 'you bested them in battle');
    } else {
      m.battlesTheyWon += 1;
      if (GameWorld.diplomacy) GameWorld.diplomacy.change(faction, -5, 'they bested you in battle');
    }
    const event = this.checkMemoryEvents(faction);
    return { line, event };
  }

  // ==========================================================================
  // TREATY / TRIBUTE / WAR — world-level actions wired to the Diplomacy instance,
  // each updating leader memory + honor and returning a LeaderLine to surface.
  // ==========================================================================
  /** Propose a treaty (trade / alliance) with a faction. Honor discounts the cost
   *  (≥+10 cheaper), low honor (≤−5) adds +50 per faction. Returns ok + line. */
  static proposeTreaty(faction: string, kind: 'trade' | 'alliance'): { ok: boolean; reason?: string; line: LeaderLine | null } {
    this.ensure();
    const d = GameWorld.diplomacy; if (!d) return { ok: false, reason: 'No diplomacy.', line: null };
    const rel = this.relation(faction);
    const minRel = kind === 'alliance' ? 40 : 20;
    if (rel < minRel) return { ok: false, reason: `Need +${minRel} relations with ${this.factionName(faction)}.`, line: null };
    const cost = this.treatyCost(faction, kind);
    if (GameWorld.gold < cost) return { ok: false, reason: `Need ${cost} gold.`, line: null };
    GameWorld.gold -= cost;
    const m = this.memory(faction);
    const t = d.tr(faction);
    if (kind === 'trade') { t.trade = true; d.change(faction, 10, 'trade treaty'); }
    else {
      t.alliance = true; d.nap[faction] = true; d.ally[faction] = true; d.change(faction, 15, 'alliance');
      m.allied = true; m.alliedSinceDay = GameWorld.displayDay();
    }
    m.treatiesHeld += 1;
    // Track which treaties are active for honor "uphold over time" accrual.
    GameWorld.diploFlags.activeTreatyDay = GameWorld.diploFlags.activeTreatyDay || {};
    GameWorld.diploFlags.activeTreatyDay[faction] = GameWorld.displayDay();
    const line = kind === 'alliance' ? this.line(faction, 'allied') : (this.LINES[faction] && this.LINES[faction].tradeAgreement ? this.line(faction, 'tradeAgreement') : this.line(faction, 'neutral'));
    return { ok: true, line };
  }

  /** Treaty gold cost, modified by player honor (the spec's honor effect). */
  static treatyCost(faction: string, kind: 'trade' | 'alliance'): number {
    let base = kind === 'alliance' ? 200 : 80;
    const honor = this.honor();
    if (honor >= 10) base = Math.round(base * 0.7);  // high honor → cheaper treaties
    if (honor <= -5) base += 50;                      // low honor → +50 per faction
    return base;
  }

  /** Send a tribute (gold) to a faction → relations up + memory + leader line. */
  static sendTribute(faction: string, amount = 50): { ok: boolean; reason?: string; line: LeaderLine | null } {
    this.ensure();
    if (GameWorld.gold < amount) return { ok: false, reason: `Need ${amount} gold.`, line: null };
    GameWorld.gold -= amount;
    const m = this.memory(faction);
    m.tributesPaid += 1;
    if (GameWorld.diplomacy) GameWorld.diplomacy.change(faction, 20, 'tribute');
    const line = this.line(faction, 'tribute');
    const event = this.checkMemoryEvents(faction);
    if (event) GameWorld.notify(event, 0xc9a14a);
    return { ok: true, line };
  }

  /** Declare war on a faction → relations bottom out + memory + leader line. */
  static declareWar(faction: string): { ok: boolean; line: LeaderLine | null } {
    this.ensure();
    const d = GameWorld.diplomacy;
    if (d) {
      d.rel[faction] = -100; d.nap[faction] = false; d.ally[faction] = false;
      const t = d.tr(faction); t.alliance = false; t.trade = false;
    }
    const m = this.memory(faction);
    m.warsDeclared += 1;
    m.allied = false; m.alliedSinceDay = -1;
    // (Phase 8) Record the war in the Chronicle of the Kingdom.
    GameWorld.recordChronicle(`War is declared upon ${this.factionName(faction)}.`);
    return { ok: true, line: this.line(faction, 'war') };
  }

  // ==========================================================================
  // BETRAYAL CONSEQUENCES — breaking a treaty is the heaviest diplomatic act.
  // ==========================================================================
  /** Break (betray) a standing treaty with a faction. Consequences (per spec):
   *   - that leader's angry line
   *   - ALL factions −10 relations
   *   - honor −3
   *   - a "Word spreads that [Kingdom] cannot be trusted" event
   *   - merchant caravans avoid player territory for 5 days (a readable flag).
   *  Returns the betrayed leader's line + the broadcast notify text. */
  static breakTreaty(faction: string): { ok: boolean; reason?: string; line: LeaderLine | null; notify: string } {
    this.ensure();
    const d = GameWorld.diplomacy; if (!d) return { ok: false, reason: 'No diplomacy.', line: null, notify: '' };
    const t = d.tr(faction);
    if (!t.trade && !t.alliance && !t.vassal) return { ok: false, reason: `No treaty with ${this.factionName(faction)} to break.`, line: null, notify: '' };
    // Break it.
    t.trade = false; t.alliance = false; t.vassal = false; d.ally[faction] = false; d.nap[faction] = false;
    d.change(faction, -40, 'you betrayed our treaty');
    const m = this.memory(faction);
    m.treatiesBetrayed += 1;
    m.allied = false; m.alliedSinceDay = -1;
    if (GameWorld.diploFlags.activeTreatyDay) delete GameWorld.diploFlags.activeTreatyDay[faction];
    // ALL factions lose 10 relations (word spreads).
    for (const k of FACTIONS) d.change(k, -10, 'word of your betrayal spreads');
    // Honor takes a heavy hit.
    this.addHonor(-3);
    // Merchant caravans avoid player territory for 5 days (AI/ExpeditionSystem flag).
    GameWorld.diploFlags.caravanAvoidUntilDay = GameWorld.displayDay() + CARAVAN_AVOID_DAYS;
    const kingdom = GameWorld.king ? GameWorld.king.kingdom : 'your kingdom';
    const notify = `Word spreads that ${kingdom} cannot be trusted.`;
    GameWorld.notify(notify, 0x8c2b2b);
    return { ok: true, line: this.line(faction, 'betrayed'), notify };
  }

  /** True while merchant caravans are avoiding the player after a betrayal. The
   *  AI party logic / ExpeditionSystem can read this to suppress caravan spawns
   *  or steer them clear of player land. */
  static caravansAvoidingPlayer(): boolean {
    return (GameWorld.diploFlags.caravanAvoidUntilDay || 0) > GameWorld.displayDay();
  }

  // ==========================================================================
  // HONOR SYSTEM — +1 per treaty upheld over time, −3 per betrayal. High honor
  // (≥+10) → cheaper treaties; low honor (≤−5) → +50 gold per treaty (see
  // treatyCost). Surfaced in the diplomacy panel.
  // ==========================================================================
  static honor(): number { return GameWorld.honor || 0; }
  static addHonor(d: number): void { GameWorld.honor = (GameWorld.honor || 0) + d; }

  // ==========================================================================
  // MEMORY EVENTS — fire ONCE when a threshold is crossed, with a real effect.
  //   • Valdris defeated 3× & neutral/allied → +5 warriors to the player party.
  //   • Elowen allied 10+ days → shares all current intel free.
  //   • Krag defeated 3× & relations improving → unique weapon artifact + ally.
  // Returns a human message if an event fired this call (else null).
  // ==========================================================================
  static checkMemoryEvents(faction: string): string | null {
    this.ensure();
    const fired = GameWorld.diploFlags.memoryEventsFired = GameWorld.diploFlags.memoryEventsFired || {};
    const m = this.memory(faction);
    const rel = this.relation(faction);

    // VALDRIS (red): beaten 3× and relations are neutral-or-better → he sends 5 warriors.
    if (faction === 'red' && !fired.valdrisWarriors && m.battlesYouWon >= 3 && rel >= 0) {
      fired.valdrisWarriors = true;
      this.addWarriorsToParty(5);
      GameWorld.diplomacy && GameWorld.diplomacy.change('red', 10, 'Valdris honours a worthy foe');
      const msg = `General Valdris sends 5 of his finest warriors to fight at your side. "${this.LINES.red.gift_warriors}"`;
      GameWorld.notify(msg, 0xc9a14a);
      return msg;
    }

    // ELOWEN (purple): allied 10+ days → shares all current intel free.
    if (faction === 'purple' && !fired.elowenIntel && this.isAllied('purple') &&
        m.alliedSinceDay >= 0 && (GameWorld.displayDay() - m.alliedSinceDay) >= ELOWEN_ALLY_DAYS) {
      fired.elowenIntel = true;
      GameWorld.diploFlags.intelShared = true; // espionage / fog hint flag for later phases
      const msg = `Countess Elowen shares all her intelligence freely. "${this.LINES.purple.share_intel}"`;
      GameWorld.notify(msg, 0x2a7a4f);
      return msg;
    }

    // KRAG (yellow): beaten 3× and relations improving (≥ -20) → artifact + alliance.
    if (faction === 'yellow' && !fired.kragArtifact && m.battlesYouWon >= 3 && rel >= -20) {
      fired.kragArtifact = true;
      GameWorld.diploFlags.uniqueArtifact = { name: "Krag's Worldcleaver", from: 'yellow', kind: 'weapon' };
      const d = GameWorld.diplomacy;
      if (d) { d.tr('yellow').alliance = true; d.nap.yellow = true; d.ally.yellow = true; d.change('yellow', 40, 'Krag becomes your ally'); }
      m.allied = true; m.alliedSinceDay = GameWorld.displayDay();
      const msg = `Warlord Krag arrives bearing a unique artifact and pledges his allegiance. "${this.LINES.yellow.gift_artifact}"`;
      GameWorld.notify(msg, 0xd6c04a);
      return msg;
    }
    return null;
  }

  /** Add N warriors into the player party (merging into an existing warrior group). */
  static addWarriorsToParty(n: number): void {
    const army = GameWorld.player.army;
    const w = army.find(g => g.type === 'warrior');
    if (w) w.count += n; else army.push({ type: 'warrior', count: n });
  }

  // ==========================================================================
  // DAILY TICK — from ContinentScene.onNewDay. Accrues honor for treaties held
  // over time, ticks Diplomacy's own drift/income, and re-checks time-based memory
  // events (Elowen's 10-day intel). Cheap + idempotent.
  // ==========================================================================
  static onNewDay(): void {
    this.ensure();
    const d = GameWorld.diplomacy; if (!d) return;
    // Diplomacy's own daily drift + treaty income (peace-over-time, alliance gold…).
    try { d.onNewDay(); } catch (e) { /* host stubs keep this safe */ }
    // HONOR: +1 per faction whose treaty has been upheld for a full accrual window
    //        (every 4 days a standing treaty survives = +1 honor; modest but real).
    const at = GameWorld.diploFlags.activeTreatyDay || {};
    for (const k of FACTIONS) {
      const t = d.tr(k);
      if ((t.trade || t.alliance || t.vassal) && at[k] != null) {
        if ((GameWorld.displayDay() - at[k]) >= 4) { this.addHonor(1); at[k] = GameWorld.displayDay(); this.memory(k).treatiesHeld += 1; }
      }
    }
    GameWorld.diploFlags.activeTreatyDay = at;
    // Keep memory.allied in sync with live treaties (e.g. AI-broken alliances).
    for (const k of FACTIONS) {
      const m = this.memory(k);
      const allied = this.isAllied(k);
      if (allied && !m.allied) { m.allied = true; m.alliedSinceDay = GameWorld.displayDay(); }
      if (!allied && m.allied) { m.allied = false; m.alliedSinceDay = -1; }
    }
    // Time-based memory events (Elowen's 10-day intel can fire on a quiet day).
    for (const k of FACTIONS) { const ev = this.checkMemoryEvents(k); if (ev) { /* already notified */ } }
  }

  // ==========================================================================
  // PANEL SUMMARY — compact per-faction summary for the diplomacy panel.
  // ==========================================================================
  static summary(faction: string): {
    faction: string; factionName: string; leader: string; portrait: string;
    relation: number; status: string; allied: boolean; treaties: any; memory: LeaderMemory; line: string;
  } {
    this.ensure();
    return {
      faction,
      factionName: this.factionName(faction),
      leader: this.leaderName(faction),
      portrait: 'portrait_' + faction,
      relation: this.relation(faction),
      status: this.status(faction),
      allied: this.isAllied(faction),
      treaties: this.treaties(faction),
      memory: this.memory(faction),
      line: this.memoryLine(faction, 'greet'),
    };
  }

  /** One-line memory recap for the panel ("Battles 3 (you 3) · Tributes 1 · …"). */
  static memoryRecap(faction: string): string {
    const m = this.memory(faction);
    const bits: string[] = [];
    bits.push(`Battles ${m.battlesAgainst} (you ${m.battlesYouWon}/them ${m.battlesTheyWon})`);
    if (m.tributesPaid) bits.push(`Tributes ${m.tributesPaid}`);
    if (m.treatiesHeld) bits.push(`Treaties kept ${m.treatiesHeld}`);
    if (m.treatiesBetrayed) bits.push(`Betrayals ${m.treatiesBetrayed}`);
    if (m.warsDeclared) bits.push(`Wars ${m.warsDeclared}`);
    if (m.caravansRaided) bits.push(`Caravans raided ${m.caravansRaided}`);
    return bits.join(' · ');
  }
}
