// ============================================================================
// HeroWorld.ts — Phase 6 (Bannerlord rebuild) HERO WORLD INTEGRATION.
// ============================================================================
//
// Phase 6 makes the six named heroes REAL characters in the continent world.
// The Heroes roster itself (XP / levels / passives / arrival defs) lives in
// Heroes.ts and is now owned by GameWorld.heroes (re-homed from the inert
// per-settlement IsometricScene). THIS module is the world-level brain on top:
//
//   1. ARRIVALS   — tickArrivals() is called from ContinentScene.onNewDay. First
//                   hero (Aldric) ~day 8; the others via their own conditions.
//                   Heroes travel WITH the player party by default (rendered as
//                   portrait overlays on the party icon by ContinentScene).
//   2. STATIONING — station(id, settlementId) / recall(id): a stationed hero
//                   stays at a settlement (portrait on its continent icon), gives
//                   a passive defensive bonus, and can rejoin the party.
//   3. DIALOGUE   — a rich CONTEXTUAL line set (~20-30 per hero). trigger(event,
//                   ctx) fires the best matching line for a present hero, shown as
//                   a cheap auto-dismiss speech popup by ContinentScene. Throttled.
//   4. INTERACTIONS — when two specific heroes are both in the party, occasional
//                   hero-hero banter (Aldric+Ravel tension, Maren+Tomas, Caelan).
//   5. QUESTS     — one personal quest per hero: a notification, a continent
//                   target marker, travel there, resolve + reward. A clean small
//                   framework (startQuest / completeQuest) all six plug into.
//
// DESIGN DECISIONS
// ----------------
// * STATELESS STATIC API. Like ExpeditionSystem/PioneerSystem, everything is a
//   static method operating on GameWorld so any scene OR the headless audit can
//   drive it. All persistent state lives in GameWorld (heroStations / heroDialogue
//   / heroQuests / heroFlags) and stays JSON-friendly for Phase 12.
// * DIALOGUE is DATA. LINES is a per-hero map of category → string[]. trigger()
//   maps a world EVENT name to one or more categories, picks a present hero who
//   reacts, deterministically (or randomly) selects a line, and returns it for
//   ContinentScene to render. Unique story beats (e.g. "valdris_defeated") are
//   one-shot via heroDialogue.firedOnce so they never repeat.
// * THROTTLE. A global cooldown (DIALOGUE_COOLDOWN_DAYS game-days between popups)
//   plus the one-shot set keeps heroes from spamming. trigger() is a no-op while
//   cooling down EXCEPT for important one-shots (force=true).
// * QUESTS keep rewards modest but REAL: each grants a concrete GameWorld effect
//   (a garrison/caravan ally flag, a friendly village, a revealed 7th fortress,
//   the 4th win condition flag, maxed loyalty + a unique ability). Targets are
//   placed on real continent tiles (near a faction castle / in a biome) so the
//   marker is travelable.
// ============================================================================

import { GameWorld } from './GameWorld.js';
import type { Settlement } from './WorldGenerator.js';
import { Biome } from '../data/Biomes.js';

/** Game-days between dialogue popups (throttle so heroes don't spam). */
export const DIALOGUE_COOLDOWN_DAYS = 0.6;
/** Chance per eligible day-tick that a hero-hero interaction fires (occasional). */
export const INTERACTION_CHANCE = 0.18;

/** A dialogue line ready to render: who said it + the text + their portrait key. */
export interface HeroLine { heroId: string; name: string; text: string; portrait: string; }

/** A hero personal quest definition (the static blueprint; live state in GameWorld). */
interface QuestDef {
  hero: string;
  title: string;
  intro: string;
  /** Choose the target tile on the live world (faction territory / biome). */
  target: () => { col: number; row: number; name: string } | null;
  /** Apply the reward + flavour summary on completion. */
  reward: () => string;
  /** Day the quest becomes eligible to auto-trigger (hero must also be present). */
  triggerDay: number;
}

export class HeroWorld {
  static readonly DIALOGUE_COOLDOWN_DAYS = DIALOGUE_COOLDOWN_DAYS;

  // ==========================================================================
  // DIALOGUE LIBRARY — ~20-30 contextual lines per hero, grouped by category.
  // Categories are matched to world EVENT names in EVENT_CATEGORIES below.
  // ==========================================================================
  static readonly LINES: Record<string, Record<string, string[]>> = {
    aldric: {
      battle: ['Good. I was getting restless.', 'Form ranks! We do this properly.', 'Steel decides what words cannot.'],
      victory: ['They fought well. Not well enough.', 'The field is ours. Tend the wounded.', 'Another banner falls before us.'],
      defeat: ['We live to fight again. Barely.', 'Fall back in order — no rout while I breathe.', 'A bitter day. We will answer it.'],
      ruins: ['These stones remember the old empire.', 'Men held these walls once. I feel it.', 'Honour the dead who built this place.'],
      low_supply: ['My men are hungry. We need to resupply.', 'An army marches on its stomach, my liege.', 'Empty packs make for empty courage.'],
      red_territory: ['Valdris. Do not underestimate him.', 'Red banners. Keep your sword loose.', 'This is Valdris’ land. Step carefully.'],
      valdris_defeated: ['A worthy enemy, fallen.', 'Valdris is broken. Let it be remembered.'],
      dragon: ['We cannot run from it.', 'A dragon. So be it. Form the line.'],
      mountain: ['High ground. I like a wall at my back.', 'These peaks have broken lesser armies.'],
      winter: ['Cold steel for a cold season. We endure.', 'Winter favours the disciplined. That is us.'],
      forest: ['Watch the treeline. Ambushes love the woods.'],
      morale_high: ['Now THIS is an army worth leading.', 'Look at them stand. Pride well earned.'],
      goblin: ['Goblins. Filthy work, but quick.', 'Cut them down before they swarm.'],
      arrival_territory: ['Enemy ground. Eyes open, blades ready.'],
    },
    maren: {
      battle: ['Must we? ...Then let it be swift.', 'I will pray for both sides tonight.'],
      soldier_died: ['Another soul lost.', 'I could not save them all. Forgive me.', 'Light guide them home.'],
      plague: ['Let me go to the sick.', 'Suffering is a summons I cannot refuse.', 'Boil the water; burn the dead. I will tend the rest.'],
      royal_marriage: ['Love as diplomacy. Strange but not wrong.', 'May it be more than a treaty in time.'],
      goblin: ['Must we fight? ...Yes.', 'Even cruelty was once afraid.'],
      ruins: ['There is sorrow in these stones.', 'So much hope, turned to dust.', 'I will say a prayer for what was lost here.'],
      great_council: ['For one day, they listened.', 'Words instead of swords. A small miracle.'],
      victory: ['Now, let us tend the fallen — both sides.', 'Victory is only the start of the mending.'],
      defeat: ['Grief is heavy. Carry it together.', 'Let me tend the wounded. That, I can do.'],
      forest: ['The trees are kind. They ask nothing.', 'Peace lives here, if we let it.'],
      winter: ['The cold takes the weak. Gather them close.', 'Share your cloak; share your warmth.'],
      low_supply: ['The hungry will sicken first. We must act.'],
      dragon: ['Even this was a creature once, before the fire.'],
      village_healed: ['They will live. That is enough for me.'],
    },
    caelan: {
      market_town: ['Now THIS is a settlement with potential.', 'Smell that? Opportunity, my liege.'],
      trade_agreement: ['Now we both prosper.', 'A deal struck is a war avoided.'],
      at_war: ['War is terrible for business.', 'Every battle is coin set alight.'],
      low_gold: ['We should address our finances. Urgently.', 'The coffers echo, my liege. That troubles me.', 'Spend less, or earn more — I recommend both.'],
      neutral_settlement: ['I could negotiate their allegiance.', 'A few coins here might buy us a friend.'],
      krag: ['That... creature is one of ours now?', 'I do not trust what cannot be bought.'],
      victory: ['Spoils, then ledgers. In that order.', 'Loot is just unbanked profit.'],
      defeat: ['A costly loss. I will recalculate.', 'We can recover — if we are clever with coin.'],
      ruins: ['Old treasure here, perhaps. Worth a look.'],
      caravan: ['A caravan! Let us not be greedy. ...Much.'],
      market_high: ['The numbers are beautiful today.'],
      morale_high: ['Confident men spend confidently. Good for trade.'],
      debt_settled: ['Debts paid. Reputation restored. Excellent.'],
    },
    mira: {
      forest: ['This is where I am most myself.', 'The wood remembers me. I remember it.', 'Quiet now. Let me listen to the trees.'],
      wolf: ['Wolves. Beautiful, in their way.', 'They hunt as we do. I respect that.'],
      fog_lifting: ['My eyes see further. Trust them.', 'The mist parts. I see what waits ahead.'],
      goblin_fortress: ['We waited too long.', 'That fortress should never have grown so bold.'],
      winter: ['The cold does not bother me.', 'Snow hides much. Not from me.'],
      ruins: ['I never dared enter.', 'I slept beneath stones like these for an age.'],
      battle: ['Mark the leaders. I’ll take them first.', 'Give me a clear line and it is done.'],
      victory: ['Clean. The way it should be.', 'One arrow each. They never closed the gap.'],
      mountain: ['High places. Good for arrows, bad for ambush.'],
      goblin: ['Hold still, little beasts.'],
      dragon: ['No arrow I have will pierce that.'],
      wolves_investigated: ['The wolves were fleeing something worse.'],
    },
    tomas: {
      research_done: ['The ancient texts were right.', 'Knowledge, hard-won. Use it well.'],
      ruins: ['this matches the old maps.', 'Astonishing. This predates the empire.', 'Careful — history is fragile here.'],
      fragment: ['The empire fell from within.', 'Another piece. The picture darkens.'],
      all_fragments: ['I know what happened now.', 'The whole truth, at last. We must not repeat it.'],
      library_built: ['A place to think properly.', 'Finally, somewhere to keep the truth safe.'],
      dragon: ['Fascinating. Terrifying.', 'I have read of these. I never believed.'],
      battle: ['Statistically, this favours discipline. Hold.'],
      victory: ['I will record this for those who follow.'],
      defeat: ['Even defeats teach — if we survive to learn.'],
      mountain: ['These strata are ancient. Older than kings.', 'The mountains keep records too, in stone.'],
      winter: ['The old chronicles called this the Long Cold.', 'Winters like this ended dynasties. Note it.'],
      forest: ['Sample these specimens — botany informs strategy.'],
      low_supply: ['Famine toppled the empire once. Mind the stores.'],
      seventh_ruin: ['THIS is the one. The last archive.'],
      neutral_settlement: ['Every town keeps a history worth reading.'],
    },
    ravel: {
      first_victory: ['You fight differently than Krag. Better.', 'So this is how a true lord wages war.'],
      yellow_territory: ['I know every patrol route here.', 'Careful — the Yellow King has eyes everywhere.'],
      krag: ['He’ll recognize me.', 'Krag and I have... unfinished business.'],
      krag_defeated: ['It had to be one of us.', 'Krag is finished. I feel nothing. ...Almost.'],
      battle_losing: ['We need to fall back. Now.', 'This is going wrong. Pull back while we can.'],
      morale_high: ['This is what a real army looks like.', 'I never had men like these. Not under Krag.'],
      battle: ['I’ve broken lines like theirs before.', 'Hit them where it hurts. I’ll show you.'],
      victory: ['Cleaner than anything Krag ever managed.'],
      defeat: ['We regroup. Krag would have run. We won’t.'],
      goblin: ['I used to lead worse than these.', 'Goblins respect only strength. Show them yours.'],
      family_freed: ['They’re free. I owe you everything.'],
      dragon: ['Even Krag feared the old fire.'],
      ruins: ['Krag’s lot would have looted this and burned the rest.'],
      forest: ['Good cover here. I’d have raided from these woods.'],
      mountain: ['High passes. Easy to hold, hard to take.'],
      low_supply: ['Hungry soldiers desert. I’ve seen it. Resupply.'],
    },
  };

  // Map a world EVENT name → the dialogue categories it can fire (first hero with a
  // matching, present category wins). Some events are one-shot story beats.
  static readonly EVENT_CATEGORIES: Record<string, { cats: string[]; once?: boolean }> = {
    battle: { cats: ['battle'] },
    battle_losing: { cats: ['battle_losing'] },
    victory: { cats: ['victory', 'first_victory'] },
    defeat: { cats: ['defeat'] },
    forest: { cats: ['forest'] },
    mountain: { cats: ['mountain'] },
    winter: { cats: ['winter'] },
    low_supply: { cats: ['low_supply', 'low_gold'] },
    low_gold: { cats: ['low_gold'] },
    ruins: { cats: ['ruins'] },
    goblin: { cats: ['goblin'] },
    goblin_fortress: { cats: ['goblin_fortress'] },
    wolf: { cats: ['wolf'] },
    fog_lifting: { cats: ['fog_lifting'] },
    dragon: { cats: ['dragon'] },
    market_town: { cats: ['market_town', 'market_high'] },
    neutral_settlement: { cats: ['neutral_settlement'] },
    trade_agreement: { cats: ['trade_agreement'] },
    at_war: { cats: ['at_war'] },
    soldier_died: { cats: ['soldier_died'] },
    plague: { cats: ['plague'] },
    morale_high: { cats: ['morale_high', 'market_high'] },
    research_done: { cats: ['research_done'] },
    library_built: { cats: ['library_built'] },
    caravan: { cats: ['caravan'] },
    krag: { cats: ['krag'] },
    // One-shot territory beats (faction-specific reactions).
    red_territory: { cats: ['red_territory', 'arrival_territory'] },
    yellow_territory: { cats: ['yellow_territory', 'arrival_territory'] },
    // One-shot story beats.
    valdris_defeated: { cats: ['valdris_defeated'], once: true },
    krag_defeated: { cats: ['krag_defeated'], once: true },
    great_council: { cats: ['great_council'], once: true },
    royal_marriage: { cats: ['royal_marriage'], once: true },
    fragment: { cats: ['fragment'] },
    all_fragments: { cats: ['all_fragments'], once: true },
  };

  // ==========================================================================
  // ARRIVALS
  // ==========================================================================
  /** Daily arrival tick (from ContinentScene.onNewDay). First hero ~day 8; the
   *  others via their existing conditions, evaluated at the WORLD level so they
   *  arrive while travelling with the party. Returns ids that joined this tick. */
  static tickArrivals(): string[] {
    const H = GameWorld.heroes;
    const day = GameWorld.displayDay();
    const joined: string[] = [];
    const offer = (id: string, cond: boolean) => {
      if (cond && !H.offered[id] && !H.byId(id)) { H.offer(id); joined.push(id); }
    };
    // Aldric — the first to arrive (~day 8). The spec's anchor.
    offer('aldric', day >= 8);
    // Mira — a forest ranger; arrives once a ruin has been explored OR by ~day 14.
    const ruinsExplored = Object.keys(GameWorld.exploredRuins).length > 0;
    offer('mira', ruinsExplored || day >= 14);
    // Caelan — the merchant prince; arrives once the realm has some coin/trade footing.
    offer('caelan', GameWorld.gold >= 700 || day >= 20);
    // Maren — the healer; arrives mid-campaign.
    offer('maren', day >= 26);
    // Tomas — the scholar; arrives once a few ruins are known (research footing).
    offer('tomas', Object.keys(GameWorld.exploredRuins).length >= 2 || day >= 32);
    // Ravel — the renegade defector; arrives later once the realm has proven itself.
    offer('ravel', day >= 38 || (GameWorld.heroFlags.battlesWon || 0) >= 3);
    return joined;
  }

  /** Heroes currently travelling WITH the player party (living + not stationed). */
  static partyHeroes(): any[] {
    return GameWorld.heroes.living().filter((h: any) => !GameWorld.heroStations[h.id]);
  }
  /** Heroes stationed at a given settlement id (for its continent icon). */
  static heroesStationedAt(settlementId: string): any[] {
    return GameWorld.heroes.living().filter((h: any) => GameWorld.heroStations[h.id] === settlementId);
  }
  static isStationed(id: string): boolean { return !!GameWorld.heroStations[id]; }

  // ==========================================================================
  // STATIONING
  // ==========================================================================
  /** Station a living hero at a settlement: they stay there, grant a defensive
   *  bonus to that settlement (banked in its SettlementState), and leave the party.
   *  Serialization-friendly (just records the settlement id in heroStations). */
  static station(id: string, settlementId: string): { ok: boolean; reason?: string } {
    const h = GameWorld.heroes.byId(id);
    if (!h || !h.isAlive) return { ok: false, reason: 'No such living hero.' };
    const s = GameWorld.settlementById(settlementId);
    if (!s) return { ok: false, reason: 'No such settlement.' };
    GameWorld.heroStations[id] = settlementId;
    h.armyId = null; // detach from any army when garrisoned
    this.applyStationBonus(settlementId);
    GameWorld.notify(`${h.name} is stationed at ${s.name}.`, 0x2a7a4f);
    return { ok: true };
  }

  /** Recall a stationed hero back into the player party. */
  static recall(id: string): { ok: boolean; reason?: string } {
    const h = GameWorld.heroes.byId(id);
    if (!h) return { ok: false, reason: 'No such hero.' };
    const where = GameWorld.heroStations[id];
    GameWorld.heroStations[id] = null;
    if (where) this.applyStationBonus(where); // recompute remaining garrison bonus
    GameWorld.notify(`${h.name} rejoins your host.`, 0xc9a14a);
    return { ok: true };
  }

  /** Recompute the defensive bonus for a settlement from its stationed heroes. A
   *  stationed hero adds a flat +defenseBonus; stored on the SettlementState so the
   *  per-settlement view / future siege logic (P7+) can read it. */
  static applyStationBonus(settlementId: string): void {
    const st = GameWorld.settlementState(settlementId);
    if (!st) return;
    const garrison = this.heroesStationedAt(settlementId);
    // +12% defence per stationed hero, +2% per hero level (modest but real).
    let bonus = 0;
    for (const h of garrison) bonus += 0.12 + (h.level - 1) * 0.02;
    (st as any).heroDefenseBonus = Math.round(bonus * 100) / 100;
    (st as any).garrisonHeroes = garrison.map((h: any) => h.id);
  }

  // ==========================================================================
  // DIALOGUE
  // ==========================================================================
  /** Fire the best contextual line for a world event, if any present hero reacts
   *  and the throttle allows. `ctx` may carry a forced hero id (only that hero may
   *  speak) or force=true (bypass cooldown, e.g. for important one-shots). Returns
   *  the chosen HeroLine for ContinentScene to render, or null. */
  static trigger(event: string, ctx: { heroId?: string; force?: boolean } = {}): HeroLine | null {
    const def = this.EVENT_CATEGORIES[event];
    if (!def) return null;
    const day = GameWorld.displayDay();
    const dl = GameWorld.heroDialogue;
    // One-shot story beats are keyed so they never repeat.
    const onceKey = def.once ? `evt:${event}` : null;
    if (onceKey && dl.firedOnce[onceKey]) return null;
    // Throttle: skip if we showed a line too recently (unless forced or a one-shot).
    const cooling = (GameWorld.day - dl.lastShownDay) < DIALOGUE_COOLDOWN_DAYS;
    if (cooling && !ctx.force && !def.once) return null;

    // Candidate heroes: those travelling with the party (or a forced single hero).
    let pool = this.partyHeroes();
    if (ctx.heroId) pool = pool.filter((h: any) => h.id === ctx.heroId);
    // Find the first hero (in roster order) who has a line for one of the categories.
    for (const h of pool) {
      const lib = this.LINES[h.id];
      if (!lib) continue;
      for (const cat of def.cats) {
        const lines = lib[cat];
        if (lines && lines.length) {
          const line = this.pickLine(h.id, event, cat, lines);
          dl.lastShownDay = GameWorld.day;
          if (onceKey) dl.firedOnce[onceKey] = true;
          return { heroId: h.id, name: h.name, text: line, portrait: 'hero_' + h.id };
        }
      }
    }
    return null;
  }

  /** Pick a line deterministically-ish from the day + ids so repeats are spread. */
  private static pickLine(heroId: string, event: string, cat: string, lines: string[]): string {
    let h = 2166136261 >>> 0;
    const seed = heroId + event + cat + Math.floor(GameWorld.day);
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return lines[h % lines.length];
  }

  /** Count of distinct dialogue lines a hero has (for coverage reporting). */
  static lineCount(heroId: string): number {
    const lib = this.LINES[heroId];
    if (!lib) return 0;
    let n = 0;
    for (const k of Object.keys(lib)) n += lib[k].length;
    return n;
  }

  // ==========================================================================
  // HERO-HERO INTERACTIONS — fire occasionally when a pair is both in the party.
  // ==========================================================================
  static readonly INTERACTIONS: Array<{ a: string; b: string; lines: Array<{ who: string; text: string }> }> = [
    { a: 'aldric', b: 'ravel', lines: [
      { who: 'aldric', text: 'I don’t trust you, Ravel.' },
      { who: 'ravel', text: 'You don’t have to. Just watch my back.' },
    ] },
    { a: 'maren', b: 'tomas', lines: [
      { who: 'tomas', text: 'Sister, your faith and my history agree more than you’d think.' },
      { who: 'maren', text: 'Then let us mend the world with both, Elder.' },
    ] },
    { a: 'caelan', b: 'aldric', lines: [
      { who: 'caelan', text: 'War is glorious, Aldric — and ruinously expensive.' },
      { who: 'aldric', text: 'Then earn the coin, merchant. I’ll earn the peace.' },
    ] },
    { a: 'caelan', b: 'mira', lines: [
      { who: 'caelan', text: 'Mira, those furs of yours would fetch a fortune.' },
      { who: 'mira', text: 'They’re not for sale, Caelan. Nothing wild is.' },
    ] },
  ];

  /** Try to fire a hero-hero interaction (occasional). Returns the two lines (as
   *  an ordered pair of HeroLine) if a present pair triggered, else null. */
  static tryInteraction(force = false): HeroLine[] | null {
    const present = new Set(this.partyHeroes().map((h: any) => h.id));
    const eligible = this.INTERACTIONS.filter(it => present.has(it.a) && present.has(it.b));
    if (!eligible.length) return null;
    if (!force) {
      const cooling = (GameWorld.day - GameWorld.heroDialogue.lastShownDay) < DIALOGUE_COOLDOWN_DAYS;
      if (cooling || Math.random() > INTERACTION_CHANCE) return null;
    }
    const it = eligible[Math.floor(Math.random() * eligible.length)];
    GameWorld.heroDialogue.lastShownDay = GameWorld.day;
    return it.lines.map(l => {
      const h = GameWorld.heroes.byId(l.who);
      return { heroId: l.who, name: h ? h.name : l.who, text: l.text, portrait: 'hero_' + l.who };
    });
  }

  // ==========================================================================
  // HERO QUESTS — one personal quest per hero. Clean framework: each quest is a
  // QuestDef; startQuest places a travelable marker; completeQuest applies a real
  // (if modest) reward. tickQuests auto-starts eligible quests + auto-completes a
  // quest once the party reaches its target.
  // ==========================================================================
  private static QUESTS: Record<string, QuestDef> = {
    aldric: {
      hero: 'aldric', title: 'Aldric’s Old Commander', triggerDay: 12,
      intro: 'Aldric: My old commander is held in Red territory. I will not leave him to rot.',
      target: () => HeroWorld.tileNearFaction('red', 'the Red prison camp'),
      reward: () => {
        // Gains a garrison hero: a simple named NPC flagged for use by P7 sieges.
        GameWorld.heroFlags.garrisonAlly = { name: 'Captain Brandt', from: 'aldric' };
        return 'Captain Brandt, Aldric’s rescued commander, joins as a garrison hero.';
      },
    },
    maren: {
      hero: 'maren', title: 'Maren’s Plagued Village', triggerDay: 30,
      intro: 'Maren: A village to the south is dying of plague. Let me go to the sick.',
      target: () => HeroWorld.tileNearKind('neutral', 'the plagued village'),
      reward: () => {
        const id = GameWorld.heroFlags.marenVillageId;
        if (id != null) {
          GameWorld.heroFlags.friendlyVillages = GameWorld.heroFlags.friendlyVillages || {};
          GameWorld.heroFlags.friendlyVillages[id] = true;
        }
        HeroWorld.trigger('village_healed' as any, { force: true });
        return 'The village is healed and now a friendly neutral.';
      },
    },
    caelan: {
      hero: 'caelan', title: 'Caelan’s Old Debt', triggerDay: 24,
      intro: 'Caelan: An old creditor calls in a debt. Settle it (200 gold) and we gain a caravan ally for life.',
      target: () => HeroWorld.tileNearKind('mercenary', 'the creditor’s waystation') || HeroWorld.tileNearKind('neutral', 'the creditor’s waystation'),
      reward: () => {
        const cost = 200;
        if (GameWorld.gold >= cost) GameWorld.gold -= cost;
        GameWorld.heroFlags.caravanAlly = { name: 'The Goldroad Company', from: 'caelan' };
        HeroWorld.trigger('debt_settled' as any, { force: true });
        return 'Debt settled (200 gold). The Goldroad Company is now a permanent caravan ally.';
      },
    },
    mira: {
      hero: 'mira', title: 'Mira’s Northern Wolves', triggerDay: 20,
      intro: 'Mira: The wolves in the north are fleeing something. I must see what.',
      target: () => HeroWorld.tileInBiome([Biome.ALPINE_FOREST, Biome.TUNDRA, Biome.LUSH_FOREST], 'the northern wolf-range', true),
      reward: () => {
        // Reveals a hidden 7th goblin fortress on the map (a real new settlement).
        const f = HeroWorld.spawnHiddenFortress();
        GameWorld.heroFlags.hiddenFortressRevealed = true;
        HeroWorld.trigger('wolves_investigated' as any, { force: true });
        return f ? `A hidden 7th goblin fortress is revealed: ${f.name}.` : 'A hidden goblin fortress is revealed on the map.';
      },
    },
    tomas: {
      hero: 'tomas', title: 'Tomas’ Lost Archive', triggerDay: 36,
      intro: 'Tomas: There is a seventh ruin — the last archive. Its truth could change everything.',
      target: () => HeroWorld.spawnSeventhRuinTarget(),
      reward: () => {
        // Reveals the full narrative + flags the 4th win condition available (P8).
        GameWorld.heroFlags.fullNarrativeRevealed = true;
        GameWorld.heroFlags.fourthWinCondition = true;
        HeroWorld.trigger('seventh_ruin' as any, { force: true });
        HeroWorld.trigger('all_fragments' as any, { force: true });
        return 'The lost archive reveals the empire’s full story. The 4th victory path is now open.';
      },
    },
    ravel: {
      hero: 'ravel', title: 'Ravel’s Family', triggerDay: 42,
      intro: 'Ravel: My family is held in Yellow territory. Help me free them. I’ll never forget it.',
      target: () => HeroWorld.tileNearFaction('yellow', 'the Yellow holding'),
      reward: () => {
        const h = GameWorld.heroes.byId('ravel');
        if (h) {
          (h as any).loyalty = 100;            // loyalty maxed
          (h as any).uniqueAbility = 'Vengeance — once per battle, Ravel’s unit strikes twice';
        }
        GameWorld.heroFlags.ravelLoyaltyMaxed = true;
        HeroWorld.trigger('family_freed' as any, { force: true });
        return 'Ravel’s family is freed. His loyalty is maxed and he unlocks Vengeance.';
      },
    },
  };

  /** All quest hero ids (for iteration / reporting). */
  static questHeroes(): string[] { return Object.keys(this.QUESTS); }
  static questDef(id: string): QuestDef | null { return this.QUESTS[id] || null; }

  /** Daily quest tick: auto-start any eligible quest (hero present + day reached),
   *  and auto-complete an active quest once the party reaches its marker. Returns
   *  events for ContinentScene to surface (intro / completion). */
  static tickQuests(): Array<{ type: 'started' | 'completed'; hero: string; title: string; text: string; col?: number; row?: number }> {
    const out: Array<{ type: 'started' | 'completed'; hero: string; title: string; text: string; col?: number; row?: number }> = [];
    const present = new Set(this.partyHeroes().map((h: any) => h.id));
    const day = GameWorld.displayDay();
    for (const id of Object.keys(this.QUESTS)) {
      const def = this.QUESTS[id];
      const q = GameWorld.heroQuests[id];
      // Auto-start when eligible.
      if (!q && present.has(id) && day >= def.triggerDay) {
        const ev = this.startQuest(id);
        if (ev) out.push({ type: 'started', hero: id, title: def.title, text: def.intro, col: ev.col, row: ev.row });
        continue;
      }
      // Auto-complete an active quest once the party stands on its marker.
      if (q && q.status === 'active') {
        const d = Math.hypot(GameWorld.player.col - q.col, GameWorld.player.row - q.row);
        if (d <= 2.5) {
          const text = this.completeQuest(id);
          out.push({ type: 'completed', hero: id, title: def.title, text });
        }
      }
    }
    return out;
  }

  /** Force-start a hero's quest (also the headless-test entry point). Places the
   *  travelable marker and returns its tile, or null if already started/no target. */
  static startQuest(id: string): { col: number; row: number; title: string; targetName: string } | null {
    const def = this.QUESTS[id];
    if (!def) return null;
    if (GameWorld.heroQuests[id] && GameWorld.heroQuests[id].status !== 'inactive') return GameWorld.heroQuests[id];
    const t = def.target();
    if (!t) return null;
    const state = { status: 'active' as const, col: t.col, row: t.row, title: def.title, targetName: t.name };
    GameWorld.heroQuests[id] = state;
    GameWorld.notify(`Hero Quest: ${def.title}`, 0xffe08a);
    return state;
  }

  /** Force-complete a hero's quest (also the headless-test entry point): apply the
   *  reward and flag it done. Returns the reward summary. */
  static completeQuest(id: string): string {
    const def = this.QUESTS[id];
    if (!def) return '';
    const summary = def.reward();
    const q = GameWorld.heroQuests[id] || { status: 'active', col: 0, row: 0, title: def.title, targetName: '' };
    q.status = 'done';
    GameWorld.heroQuests[id] = q;
    GameWorld.notify(`Quest complete — ${def.title}: ${summary}`, 0x2a7a4f);
    return summary;
  }

  /** All active quest markers (for ContinentScene to draw + report). */
  static activeQuestMarkers(): Array<{ hero: string; col: number; row: number; title: string; targetName: string }> {
    const out: Array<{ hero: string; col: number; row: number; title: string; targetName: string }> = [];
    for (const id of Object.keys(GameWorld.heroQuests)) {
      const q = GameWorld.heroQuests[id];
      if (q && q.status === 'active') out.push({ hero: id, col: q.col, row: q.row, title: q.title, targetName: q.targetName });
    }
    return out;
  }

  // ==========================================================================
  // QUEST TARGET helpers — choose real, travelable continent tiles.
  // ==========================================================================
  /** A passable tile a few tiles from a faction's castle (its "territory"). */
  static tileNearFaction(factionKey: string, name: string): { col: number; row: number; name: string } | null {
    const w = GameWorld.world; if (!w) return null;
    const f = w.factions.find(x => x.key === factionKey);
    if (!f) return null;
    const t = this.nearestPassable(f.castleCol + 6, f.castleRow + 4);
    return t ? { col: t.col, row: t.row, name } : { col: f.castleCol, row: f.castleRow, name };
  }
  /** A passable tile near a settlement of a given kind (records its id for rewards). */
  static tileNearKind(kind: string, name: string): { col: number; row: number; name: string } | null {
    const w = GameWorld.world; if (!w) return null;
    const s = w.settlements.find(x => x.kind === kind);
    if (!s) return null;
    if (kind === 'neutral') GameWorld.heroFlags.marenVillageId = String(w.settlements.indexOf(s));
    return { col: s.col, row: s.row, name };
  }
  /** A passable tile in one of the given biomes, optionally biased toward the north. */
  static tileInBiome(biomes: number[], name: string, north = false): { col: number; row: number; name: string } | null {
    const w = GameWorld.world; if (!w) return null;
    const set = new Set(biomes);
    let best: { col: number; row: number } | null = null;
    // Deterministic scan from a seeded start so the target is stable per world.
    let a = ((w.seed ^ 0x40c0ffee) >>> 0);
    const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = 0; i < 6000; i++) {
      const col = Math.floor(rnd() * w.size);
      const row = north ? Math.floor(rnd() * (w.size * 0.4)) : Math.floor(rnd() * w.size);
      const b = w.tileBiome[row * w.size + col];
      if (set.has(b)) { best = { col, row }; break; }
    }
    if (!best) { const t = this.nearestPassable(Math.floor(w.size * 0.3), Math.floor(w.size * 0.25)); best = t || { col: Math.floor(w.size / 2), row: Math.floor(w.size / 3) }; }
    return { col: best.col, row: best.row, name };
  }

  /** Reveal a hidden 7th goblin fortress as a real settlement (Mira's reward). */
  static spawnHiddenFortress(): Settlement | null {
    const w = GameWorld.world; if (!w) return null;
    const q = GameWorld.heroQuests['mira'];
    const base = q ? { col: q.col, row: q.row } : this.tileInBiome([Biome.ALPINE_FOREST, Biome.TUNDRA], '', true);
    const spot = this.nearestPassable((base as any).col, (base as any).row) || { col: Math.floor(w.size / 3), row: Math.floor(w.size / 4) };
    const fort: Settlement = { kind: 'goblin_camp', name: 'The Hollow Fang Fortress', col: spot.col, row: spot.row, biome: w.tileBiome[spot.row * w.size + spot.col] as Biome };
    (fort as any).fortress = true; // a tougher, hidden fortress (flavour flag)
    w.settlements.push(fort);
    GameWorld.heroFlags.hiddenFortressId = String(w.settlements.indexOf(fort));
    return fort;
  }

  /** Place + return the target for Tomas' 7th ruin (a real new ruin settlement). */
  static spawnSeventhRuinTarget(): { col: number; row: number; name: string } | null {
    const w = GameWorld.world; if (!w) return null;
    // If already placed, reuse it.
    if (GameWorld.heroFlags.seventhRuinId != null) {
      const s = w.settlements[parseInt(GameWorld.heroFlags.seventhRuinId, 10)];
      if (s) return { col: s.col, row: s.row, name: s.name };
    }
    const base = this.tileInBiome([Biome.HIGHLAND, Biome.SCRUBLAND, Biome.PLAINS], '', false);
    const spot = this.nearestPassable((base as any).col, (base as any).row) || { col: Math.floor(w.size * 0.6), row: Math.floor(w.size * 0.6) };
    const ruin: Settlement = { kind: 'ruin', name: 'The Lost Archive', col: spot.col, row: spot.row, biome: w.tileBiome[spot.row * w.size + spot.col] as Biome };
    w.settlements.push(ruin);
    GameWorld.heroFlags.seventhRuinId = String(w.settlements.indexOf(ruin));
    return { col: ruin.col, row: ruin.row, name: ruin.name };
  }

  /** Nearest passable (non-ocean / non-peak) tile to a target, spiralling out. */
  static nearestPassable(col: number, row: number): { col: number; row: number } | null {
    const w = GameWorld.world; if (!w) return null;
    const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
    col = clamp(Math.round(col), w.size - 1); row = clamp(Math.round(row), w.size - 1);
    const passable = (c: number, r: number) => {
      const b = w.tileBiome[r * w.size + c];
      return b !== Biome.OCEAN && b !== Biome.MOUNTAIN_PEAK;
    };
    if (passable(col, row)) return { col, row };
    for (let rad = 1; rad < 40; rad++) {
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const c = clamp(col + dx, w.size - 1), r = clamp(row + dy, w.size - 1);
        if (passable(c, r)) return { col: c, row: r };
      }
    }
    return { col, row };
  }
}
