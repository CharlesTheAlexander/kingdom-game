// ============================================================================
// WinConsequences.ts — Phase 10 (Bannerlord rebuild) WIN CONSEQUENCE SYSTEM.
// ============================================================================
//
// "HOW you win shapes the ending, and your reputation shapes the living world."
//
// This module RE-HOMES the old per-settlement win checker (WinConditions.ts, which
// was written for the single-world IsometricScene) to the WORLD level, computing
// every condition from GameWorld state with no single-world assumptions. It also
// owns:
//   1. The four WORLD-LEVEL WIN CHECKS (Conquest / Diplomacy / Legacy / Empire),
//      run once per game-day from ContinentScene.onNewDay.
//   2. The ENDING VARIANT resolver — the won path × the dominant reputation track
//      (or the start trait, for Legacy) selects a distinct ending title + prose.
//   3. The WIN-SCREEN reputation profile builder — which track was highest, the
//      title earned, and 3–4 SPECIFIC events from THIS playthrough pulled from the
//      Chronicle (GameWorld.chronicle) / notification history.
//   4. The ONGOING WORLD REACTION — a per-day check that applies one tangible
//      effect based on the current highest reputation (a neutral settlement joins
//      for high Protector, tribute arrives for high Conqueror, surrender pleas for
//      high Destroyer, caravans/discounts for high Merchant) + the matching notify.
//
// DESIGN DECISIONS
// ----------------
// * STATELESS STATIC API (mirrors WorldDiplomacy / HeroWorld / LateGame): every
//   method operates on GameWorld so ANY scene OR the headless audit can drive it.
//   ALL persistent state lives on GameWorld and stays JSON-friendly for Phase 12.
// * Reputation is read from GameWorld.reputation (re-homed in Phase 10). The
//   ending also reads the player's chosen start TRAIT via GameWorld.trait().
// * The win CHECK is pure (no side effects) so it's testable; onNewDay() applies
//   the single trigger + records the won path. The end SCREEN is drawn by the
//   scene (ContinentScene.showWinScreen) from the data this module builds, so the
//   rendering layer and the logic layer stay cleanly separated.
// ============================================================================

import { GameWorld } from './GameWorld.js';

/** Conquest threshold: control ≥ this fraction of all ownable settlements. */
export const CONQUEST_FRACTION = 0.70;
/** Diplomacy threshold: every surviving AI faction at ≥ this relation (or allied). */
export const ALLY_RELATIONS = 80;
/** Legacy: home stage ≥ this (Large Castle territory). */
export const LEGACY_STAGE = 9;
/** Legacy: home population ≥ this. */
export const LEGACY_POPULATION = 40;
/** Legacy: completed research techs ≥ this. */
export const LEGACY_RESEARCH = 5;
/** Legacy: consecutive days at happiness ≥ 80 before the win fires. */
export const LEGACY_HAPPY_DAYS = 5;

/** The data the win screen renders. */
export interface EndingData {
  /** Which win path triggered: Conquest | Diplomacy | Legacy | Empire. */
  path: string;
  /** The dominant reputation track ('conqueror'|'merchant'|'protector'|'destroyer')
   *  or null when no track reached 50+. */
  topRep: string | null;
  /** The player's chosen start trait id (warlord/scholar/builder/…) or null. */
  trait: string | null;
  /** The full ending title ("A Conqueror Who Remembered…"). */
  title: string;
  /** The ending prose (2–4 sentences of flavour for the variant). */
  prose: string;
  /** The reputation "Title earned" line ("You were known as The Shield of …"). */
  repTitle: string;
  /** The full reputation profile: each track's score, highest first. */
  repProfile: Array<{ key: string; score: number; top: boolean }>;
  /** 3–4 SPECIFIC events from THIS playthrough (Chronicle / notifications). */
  events: string[];
  /** A dark-ending rebellion hook flag (Conquest + Destroyer). */
  rebellionHook: boolean;
}

export class WinConsequences {
  static readonly CONQUEST_FRACTION = CONQUEST_FRACTION;
  static readonly ALLY_RELATIONS = ALLY_RELATIONS;

  // ==========================================================================
  // CONQUEST accounting — count POLITICALLY OWNABLE holds (castles + neutral
  // towns; NOT goblin camps / ruins / mercenary camps). A hold counts as the
  // player's when its faction is 'player' (the home castle, player-founded towns,
  // or a conquered hold) OR when an AI castle has been marked fallen. Returns the
  // {owned, total} pair so the fraction is auditable.
  // ==========================================================================
  static ownableSettlements(): any[] {
    const w = GameWorld.world;
    if (!w) return [];
    return w.settlements.filter(s => s.kind === 'player_castle' || s.kind === 'ai_castle' || s.kind === 'neutral');
  }

  /** Has this AI castle fallen to the player? True when its faction was flipped to
   *  'player' OR it is tracked in GameWorld.reactionFlags.fallenCastles (a stable
   *  set the conquest mechanic / audit can populate without mutating world data). */
  static isFallen(s: any): boolean {
    if (s.faction === 'player') return true;
    const fallen = GameWorld.reactionFlags.fallenCastles;
    return !!(fallen && fallen[GameWorld.settlementId(s)]);
  }

  static conquestProgress(): { owned: number; total: number; fraction: number } {
    const list = this.ownableSettlements();
    const total = list.length;
    let owned = 0;
    for (const s of list) {
      if (s.kind === 'player_castle') { owned++; continue; }
      if (s.faction === 'player') { owned++; continue; }
      if (s.kind === 'ai_castle' && this.isFallen(s)) { owned++; continue; }
    }
    return { owned, total, fraction: total > 0 ? owned / total : 0 };
  }

  // ==========================================================================
  // LEGACY accounting — home stage + population + research + sustained happiness.
  // Research isn't tracked per-settlement at the world level yet, so we read a
  // research-techs count from the home state if present, else GameWorld flag.
  // ==========================================================================
  static homeResearchTechs(): number {
    const home = GameWorld.homeState() as any;
    if (home && typeof home.researchTechs === 'number') return home.researchTechs;
    if (typeof (GameWorld.lateGameFlags as any).researchTechs === 'number') return (GameWorld.lateGameFlags as any).researchTechs;
    return 0;
  }

  static homePopulation(): number {
    const home = GameWorld.homeState() as any;
    return home ? (home.population || 0) : 0;
  }

  static homeHappiness(): number {
    const home = GameWorld.homeState() as any;
    return home ? (home.happiness || 0) : 0;
  }

  // ==========================================================================
  // DIPLOMACY accounting — every surviving AI faction at very high relations or
  // allied (treaty / ally flag). At least one faction must survive.
  // ==========================================================================
  static allFactionsAllied(): boolean {
    const dip = GameWorld.diplomacy;
    if (!dip) return false;
    const keys = GameWorld.factionKeys();
    if (!keys.length) return false;
    return keys.every(k => dip.isAllied(k) || dip.get(k) >= ALLY_RELATIONS);
  }

  // ==========================================================================
  // THE WIN CHECK — pure (no side effects). Returns the won path name, or null.
  // Order: Empire (the secret 4th, takes precedence) → Conquest → Diplomacy →
  // Legacy. The Empire path is set by GameWorld.restoreEmpire() (wonPath ==='Empire').
  // ==========================================================================
  static check(): string | null {
    // 4th path: the restore-the-empire ritual already resolved.
    if (GameWorld.wonPath === 'Empire') return 'Empire';
    // Conquest: control ≥ 70% of ownable holds.
    if (this.conquestProgress().fraction >= CONQUEST_FRACTION) return 'Conquest';
    // Diplomacy: all surviving AI factions allied / at very high relations.
    if (this.allFactionsAllied()) return 'Diplomacy';
    // Legacy: stage 9 + population + research + sustained happiness.
    if (GameWorld.kingdomStage() >= LEGACY_STAGE &&
        this.homePopulation() >= LEGACY_POPULATION &&
        this.homeResearchTechs() >= LEGACY_RESEARCH &&
        GameWorld.legacyHappyDays >= LEGACY_HAPPY_DAYS) return 'Legacy';
    return null;
  }

  // ==========================================================================
  // DAILY TICK — accrue the legacy happiness streak, run the ongoing reputation
  // reaction, then check for a win. Returns the won PATH the first day it fires
  // (so the scene can pop the end screen), else null. Idempotent after a win.
  // ==========================================================================
  static onNewDay(): string | null {
    // 1) Sustained-happiness streak for the Legacy path.
    if (this.homeHappiness() >= 80) GameWorld.legacyHappyDays += 1;
    else GameWorld.legacyHappyDays = 0;

    // 2) Ongoing world reaction to the dominant reputation (only while unwon).
    if (!GameWorld.winTriggered) this.tickReputationReaction();

    // 3) Win resolution (once).
    if (GameWorld.winTriggered) return null;
    const path = this.check();
    if (path) {
      GameWorld.winTriggered = true;
      if (!GameWorld.wonPath) GameWorld.wonPath = path;
      return path;
    }
    return null;
  }

  // ==========================================================================
  // ONGOING WORLD REACTION — based on the CURRENT highest reputation, apply one
  // tangible effect per day + the matching dialogue/notify. Each effect is gated
  // (cooldown / one-shot) so it stays a flavourful drip, not a flood.
  //   High Destroyer  → a neutral settlement pleads/surrenders.
  //   High Protector  → a neutral settlement offers to JOIN without combat.
  //   High Merchant   → a wandering caravan routes through your territory.
  //   High Conqueror  → a weaker faction sends pre-emptive tribute.
  // Returns a short description of the effect that fired (for the audit), or null.
  // ==========================================================================
  static tickReputationReaction(): string | null {
    const rep = GameWorld.reputation;
    const top = rep.highest(); // needs 50+ to earn a dominant track
    if (!top) return null;
    const flags = GameWorld.reactionFlags;
    const today = GameWorld.displayDay();
    // Global ~6-day cooldown so reactions feel like rare living-world beats.
    if (flags.lastReactionDay != null && today - flags.lastReactionDay < 6) return null;

    if (top === 'protector') return this.reactProtector(today);
    if (top === 'destroyer') return this.reactDestroyer(today);
    if (top === 'conqueror') return this.reactConqueror(today);
    if (top === 'merchant')  return this.reactMerchant(today);
    return null;
  }

  /** High Protector: the nearest unaligned neutral settlement asks to JOIN the
   *  realm peacefully — flip its faction to 'player'. A tangible, win-advancing
   *  effect (it also counts toward Conquest). One settlement per cooldown. */
  private static reactProtector(today: number): string | null {
    const w = GameWorld.world; if (!w) return null;
    const neutral = w.settlements.find(s => s.kind === 'neutral' && s.faction !== 'player');
    if (!neutral) return null;
    neutral.faction = 'player';
    const st = GameWorld.settlementState(GameWorld.settlementId(neutral));
    if (st) { st.faction = 'player'; (st as any).founded = true; }
    GameWorld.reactionFlags.lastReactionDay = today;
    GameWorld.notify(`${neutral.name} sees your mercy and asks to join your realm — no blood need be shed.`, 0x2a7a4f);
    GameWorld.recordChronicle(`Word of your protection spreads: ${neutral.name} joins the realm freely.`);
    GameWorld.addReputation('protector', 2);
    return `protector: ${neutral.name} joined peacefully`;
  }

  /** High Destroyer: a neutral settlement pleads for its life ("Please — we
   *  surrender."). Flavour (relations/morale) + a rare goblin acknowledgement. */
  private static reactDestroyer(today: number): string | null {
    const w = GameWorld.world; if (!w) return null;
    const neutral = w.settlements.find(s => s.kind === 'neutral' && s.faction !== 'player');
    GameWorld.reactionFlags.lastReactionDay = today;
    if (neutral) {
      GameWorld.notify(`A messenger from ${neutral.name} falls to their knees: "Please — we surrender. Spare us."`, 0x8c2b2b);
      GameWorld.recordChronicle(`Terrified of your wrath, ${neutral.name} sues for mercy unbidden.`);
    }
    // Rare goblin acknowledgement: the goblins give your lands a wide berth.
    if (Math.random() < 0.4) {
      GameWorld.notify('Even the goblins whisper your name in dread, and slink from your borders.', 0x6b8c2b);
    }
    return neutral ? `destroyer: ${neutral.name} pleaded surrender` : 'destroyer: goblins acknowledged you';
  }

  /** High Conqueror: a weaker AI faction sends pre-emptive tribute ("We heard
   *  what happened to the others.") — gold into the purse + a relations bump. */
  private static reactConqueror(today: number): string | null {
    const dip = GameWorld.diplomacy;
    const keys = GameWorld.factionKeys();
    if (!keys.length) return null;
    // Pick the WEAKEST surviving faction (lowest relations toward you = most afraid).
    let target = keys[0];
    if (dip) { let lo = Infinity; for (const k of keys) { const r = dip.get(k); if (r < lo) { lo = r; target = k; } } }
    const f = GameWorld.world ? GameWorld.world.factions.find(x => x.key === target) : null;
    const name = f ? f.name : target;
    GameWorld.gold += 120;
    GameWorld.changeRelation(target, 8, 'pre-emptive tribute, fearing your conquests');
    GameWorld.reactionFlags.lastReactionDay = today;
    GameWorld.notify(`${name} sends tribute (+120 gold): "We heard what happened to the others."`, 0xd6c04a);
    GameWorld.recordChronicle(`${name} sends tribute unasked, hoping to be spared your conquering host.`);
    return `conqueror: tribute from ${name}`;
  }

  /** High Merchant: a wandering caravan routes through your territory + mercenary
   *  camps discount their contracts (flag the per-day income + a notify). */
  private static reactMerchant(today: number): string | null {
    GameWorld.gold += 60;
    GameWorld.reactionFlags.lastReactionDay = today;
    GameWorld.reactionFlags.mercDiscount = true; // read by mercenary-hire pricing if wired
    GameWorld.notify('A wealthy caravan reroutes through your lands, paying tolls (+60 gold). Sellswords offer you discounts.', 0xc9a14a);
    GameWorld.recordChronicle('Trade flows to your banner: caravans seek your roads and mercenaries cut their price.');
    return 'merchant: caravan toll + mercenary discount';
  }

  // ==========================================================================
  // ENDING VARIANT RESOLVER — won path × dominant reputation (or start trait, for
  // Legacy) → a distinct title + prose. Paraphrases/extends the Phase-10 spec.
  // ==========================================================================
  static endingData(): EndingData {
    const path = GameWorld.wonPath || this.check() || 'Conquest';
    const rep = GameWorld.reputation;
    const topRep = rep.highest();
    const trait = GameWorld.trait();
    const kingdom = GameWorld.king.kingdom;
    const ruler = GameWorld.king.ruler;

    let title = 'Victory';
    let prose = '';
    let rebellionHook = false;

    if (path === 'Empire') {
      // The unique 4th ending — single, regardless of reputation.
      title = 'The Old Empire Reborn';
      prose = `The vault is open. The forgotten machineries of the Old Empire wake at your touch, and a power not seen in a thousand years answers to the name of ${kingdom}. ${ruler} is no mere king now — you are the heir of an age the world had forgotten. What comes next, history has no word for.`;
    } else if (path === 'Conquest') {
      if (topRep === 'destroyer') {
        title = 'Conquered Through Fear and Fire';
        prose = `The continent is yours — what is left of it. You took every throne with sword and torch, and the silence in your conquered lands is the silence of the grave. They obey because they are afraid. ${ruler} rules an empire of ash, and even now, in the dark, the survivors are beginning to whisper of rebellion.`;
        rebellionHook = true;
      } else if (topRep === 'protector') {
        // The BEST variant — a unique final scene.
        title = 'A Conqueror Who Remembered You Were Also Human';
        prose = `You conquered the continent, yes — but you did it as one who never forgot the people beneath the banners. Towns you took, you healed; enemies you beat, you spared. They do not merely obey ${kingdom}. They believe in it. In the squares of a hundred cities, your name is spoken not with fear but with hope. This is the rarest victory of all: a conqueror beloved.`;
      } else {
        // Conqueror-highest (or no track) → honest battle.
        title = 'Proven in Honest Battle';
        prose = `Throne by throne, you proved your strength in fair and open war. No trickery, no terror — only the better army, the better plan, the steadier nerve. The continent bows to ${kingdom} because you earned it, blade against blade. The bards will sing of these campaigns for generations.`;
      }
    } else if (path === 'Diplomacy') {
      if (topRep === 'merchant') {
        title = 'You Bought the Peace';
        prose = `Not a sword was needed in the end. Where others spent armies, you spent gold — and found it the cheaper coin. Trade routes became treaties; treaties became alliance. The continent is at peace under ${kingdom} because every ruler found it more profitable to be your friend than your foe.`;
      } else if (topRep === 'protector') {
        title = 'Peace Through Trust';
        prose = `You won the world by never betraying it. Every promise ${ruler} made was kept; every ally you took, you defended. One by one the realms chose your friendship freely, for they had learned your word was iron. The continent is united under ${kingdom} not by conquest, but by trust earned a hundred times over.`;
      } else {
        title = 'The Great Concord';
        prose = `Through patient diplomacy, ${ruler} drew every realm of the continent into a single concord. Old enemies sit at one table now, and the banner of ${kingdom} flies beside theirs as an equal and a friend. Peace, hard-won at the council table, holds.`;
      }
    } else if (path === 'Legacy') {
      if (trait === 'scholar') {
        title = 'A New Age of Learning';
        prose = `The wars of your youth are footnotes now. What endures is the great library, the academies, the patient work of a thousand scholars you gathered to ${kingdom}. Historians already speak of the Age of ${ruler} — a new age of learning that bears your name, and will outlast every crown.`;
      } else if (trait === 'builder') {
        title = 'What You Built Will Be Studied';
        prose = `Stone by stone, you raised something that will outlive you by a thousand years. The walls, the aqueducts, the great works of ${kingdom} — future generations will not merely admire them. They will study them, and wonder how ${ruler} ever dreamed so large.`;
      } else {
        title = 'A Legacy in Stone and Song';
        prose = `You did not conquer the world, nor buy it. You built something lasting at its heart — a city so great, so prosperous and content, that ${kingdom} became the measure other realms aspire to. Long after you are gone, your legacy stands.`;
      }
    }

    return {
      path,
      topRep,
      trait,
      title,
      prose,
      repTitle: this.repTitleLine(),
      repProfile: this.reputationProfile(),
      events: this.keyEvents(4),
      rebellionHook,
    };
  }

  /** "You were known as [Title]." line, using the Reputation class's own title()
   *  (kingdom-name-aware) when a track reached 50+, else the start trait. */
  static repTitleLine(): string {
    const rep = GameWorld.reputation;
    const t = rep.title(GameWorld.king.kingdom);
    if (t) return t;
    const trait = GameWorld.trait();
    const TRAIT_TITLES: Record<string, string> = {
      warlord: 'The Warlord', merchant: 'The Merchant Prince', builder: 'The Great Builder',
      diplomat: 'The Peacemaker', explorer: 'The Pathfinder', scholar: 'The Scholar-King',
    };
    return (trait && TRAIT_TITLES[trait]) || `The Realm of ${GameWorld.king.kingdom}`;
  }

  /** The full reputation profile, highest first, flagging the dominant track. */
  static reputationProfile(): Array<{ key: string; score: number; top: boolean }> {
    const scores = GameWorld.reputation.scores;
    const top = GameWorld.reputation.highest();
    return Object.keys(scores)
      .map(key => ({ key, score: scores[key], top: key === top }))
      .sort((a, b) => b.score - a.score);
  }

  // ==========================================================================
  // KEY EVENTS — 3–4 SPECIFIC events from THIS playthrough for the win screen's
  // "Here is why:" bullet list. Source of truth: GameWorld.chronicle (the narrative
  // record), falling back to the notification history if the chronicle is sparse.
  // We pick the MOST RECENT distinct entries (the campaign's defining late beats).
  // ==========================================================================
  static keyEvents(n = 4): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    // Chronicle entries (newest first), formatted "Day X: text".
    const chron = GameWorld.chronicle.slice().reverse();
    for (const e of chron) {
      const line = `Day ${e.day}: ${e.text}`;
      if (seen.has(e.text)) continue;
      seen.add(e.text);
      out.push(line);
      if (out.length >= n) return out;
    }
    // Fallback: recent notifications (text only) if the chronicle was sparse.
    const notes = GameWorld.pendingNotifications.slice().reverse();
    for (const nt of notes) {
      if (seen.has(nt.text)) continue;
      seen.add(nt.text);
      out.push(nt.text);
      if (out.length >= n) return out;
    }
    // Final fallback so the screen never looks empty.
    if (!out.length) out.push(`Day ${GameWorld.displayDay()}: The reign of ${GameWorld.king.ruler} reaches its triumph.`);
    return out;
  }
}
