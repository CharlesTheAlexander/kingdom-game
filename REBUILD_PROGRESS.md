# Bannerlord-Style Rebuild — Progress Tracker

Branch: `bannerlord-rebuild` (main stays on the deployed visual-overhaul build until this is merged).
World size: **1500×1500** (chunk math adjusted; target 30+ FPS via aggressive chunk load/unload).
Rule: every phase must `npm run build` clean + boot with ZERO console errors before the next starts.

- [x] P1 — World generation (1500×1500 Perlin, biomes, rivers, resources, factions, chunked rendering)
      Files: src/data/Biomes.ts, src/systems/WorldGenerator.ts, src/systems/ChunkManager.ts (+ DEV hook in main.ts).
      Decisions: TOP-DOWN (orthographic) continent render, NOT iso, at 1500×1500; 50×50-tile chunks => 900 chunks;
      4px/tile chunk textures (200x200px), <=36 resident (LRU + window cull), ~5.8 MB texture budget. Seeded mulberry32
      + seeded value-noise (3 uncorrelated perms). Radial falloff => single continent. Audit (seed 1337): all 12 biomes
      present, 535 river tiles / 4 rivers, 28 settlements (1 player castle, 3 AI, 9 neutral, 9 goblin, 6 ruin),
      player >=424 tiles from every AI, 12,242 resource nodes, FPS 49, zero console errors, deterministic.
- [x] P2 — ContinentScene as PRIMARY game loop (party movement, A*, time, supply)
      Files: src/scenes/ContinentScene.ts (full rewrite), src/systems/GameWorld.ts (shared state singleton),
      src/systems/ContinentPathfinder.ts (A*), src/scenes/KingCreationScene.ts (standalone creation),
      src/main.ts (scene array + DEV __gw hook), src/scenes/MainMenuScene.ts (new-game flow),
      src/systems/ChunkManager.ts (MAX_RESIDENT 36→320 + window-protected LRU so a 0.4× viewport's
      ~220-chunk window never self-evicts mid-render).
      Flow: MainMenu → KingCreationScene → (first-play) IntroCutsceneScene → ContinentScene. Continue/Load
      also land on ContinentScene. World stored in GameWorld (WorldState + player party/supply/gold/day +
      currentSettlementId + pendingBattle), structured for Phase-12 serialize (seed + mutable layer only;
      typed arrays rebuilt from seed).
      Continent: chunked top-down render via ChunkManager (pooled Images bound to visible texture keys),
      camera follow + right-drag pan + wheel zoom (0.2–1.5, default 0.4); player crown crest w/ army badge +
      supply dot (green/yellow/red); left-click A* move using per-biome movementCost, dotted route + ETA
      ("Arrives in ~X days"), right-click cancels; continuous time (1 day = 5 min / DAY_MS, never pauses)
      with onNewDay hook; supply drains in the field, resupplies at the player castle; 1–3 AI parties per
      AI faction moving to personality objectives (aggressive→player, merchant/expansionist→settlements)
      w/ hover tooltip, fog-gated; fog of war (coarse explored bitmap, lifts around player + home);
      settlement interaction (≤2 tiles → Enter? confirm → SAFE per-settlement overlay stand-in w/ Leave —
      real IsometricScene transition deferred to Phase 3 to stay boot-clean; id passed via GameWorld);
      battle trigger (≤3 tiles → "Enemy army approaching!" banner; collision → real BattleScene via existing
      launch contract, survivors/loot restored, drop back on continent at battle site); slim HUD top bar +
      whole-world minimap w/ player/settlement/AI dots + viewport rect.
      Audit (headless, full new-game flow): ContinentScene becomes active; party moved (A* path len 40-56);
      day 1→2; supply 10→9.2 while traveling; 6/6 AI parties moved; enter/leave round-trip OK; battle
      launch+return OK; right-click cancel OK; Continue→continent OK; FPS while panning 53-59 @0.4× (min 56
      sustained), resident chunks ~126 bounded; ZERO console errors. tsc clean, build clean.
      STUBBED for later: per-settlement view is a safe overlay (Phase 3 = real local IsometricScene);
      supply→desertion is a morale-erosion flag only; Continue/Load rebuild from king record, not a full
      slot restore (Phase 12 SaveManager); passive +5 gold/day is a placeholder economy.
- [x] P3 — IsometricScene as PER-SETTLEMENT view (per-settlement state, enter/leave)
      Files: src/scenes/IsometricScene.ts (converted continent→local view), src/scenes/ContinentScene.ts
      (real enter/leave wiring), src/systems/GameWorld.ts (settlementStates map + settlementState() +
      notify()), src/systems/SettlementState.ts (NEW — JSON-friendly per-settlement save shape).
      STATE: SettlementState{ id, name, faction, tier, buildings[], tasks[] (resumable construction/training),
      workers, workerCap, resources{wood/stone/food/iron}, garrison[], population, happiness, lastVisitedDay,
      visited, hasAdministrator/administratorName, localMap{biome,seed,size,playerOwned} }. Stored in
      GameWorld.settlementStates keyed by settlement id; lazily created on first entry (makeSettlementState);
      home castle is one of these. serializable() now includes settlementStates (Phase-12 ready; no Phaser
      objects/typed arrays — local map regenerated from biome+seed, never stored per-tile).
      LOCAL MAP: IsometricScene N shrunk 200→40. buildLocalMapGrid() themes the 40×40 grid from the settlement's
      WORLD biome: plains→grass + river band; forest→dense trees ringing the clearing; mountain/highland→rocky +
      impassable peak backdrop (stone/iron); coast/ocean→beach + sea on the south edge; desert/scrub→sand, few
      trees; wetland/river→water band. Deterministic per-settlement PRNG (mulberry32 from localMap.seed) so a
      town always regenerates the same. biomeAt() reads the grid; existing AssetGenerator art + iso renderer reused.
      ENTER/LEAVE: ContinentScene.enterSettlement() fades, scene.launch('IsometricScene',{settlementId}) +
      scene.sleep() (state preserved). IsometricScene.init(data) resolves the id (data → GameWorld.currentSettlementId
      → home), loads SettlementState, restoreSettlementState() re-places saved buildings at their positions
      (ignoreStage) and resumes training slots. Persistent "Leave Settlement" button (top-right) + Map tab +
      Esc-less confirm → saveSettlementState() → fade → wake ContinentScene at the settlement's tile.
      ContinentScene WAKE/RESUME handler re-attaches chunk images + recentres + fades in.
      HUD: settlement-context top bar — LEFT name·faction·tier, CENTER local resources (wood/stone/food/iron/gold),
      RIGHT "Day X" (from GameWorld) + "You are in [Name]". NOTIFY: IsometricScene.notify(text,color) banner +
      static IsometricScene.notify(game,...) router + GameWorld.notify()/pendingNotifications queue (drained on entry).
      TIME CONTINUES: updateDayCycle() advances GameWorld.day by gdelta/DAY_MS every frame while inside (continent
      owns the master clock; the local view reads GameWorld.displayDay()); local production ticks as before.
      DISABLED/NEUTERED (world-scale, now owned by ContinentScene/GameWorld; see comments in create()):
      AIKingdom×3 + FACTIONS (hard-coded castle tiles at col/row 185 = out-of-bounds at N=40), WaveManager waves,
      ArmyManager on-map armies (typed stub _inertArmyMgr so soldierTotal() arithmetic still works), WanderingFactions,
      Caravans, SettlementManager (neutral settlements are continent objects now), GoblinCamps, Diplomacy, GreatCouncil,
      Espionage, Narrative, Succession, RoyalCourt, Banking, FactionLeaders, Heroes, Maintenance, PopulationClasses,
      Discovery, Roads, Ruins — all replaced with inert Proxy/stub objects (_inertSystem/_inertSettlements) so every
      legacy update()/HUD/panel call is a harmless no-op. KEPT per-settlement: building placement/UI, workers,
      local resources/production, troop training, garrison, population/happiness, research/library, Territory
      (local fog/reveal), Wildlife (local threats), weather visuals. Also removed: king-creation-on-boot (king
      comes from GameWorld), welcome/tutorial modal on entry, beforeunload + pending-load legacy auto-save, the
      TAB continent-overlay toggle. WeatherSys gameplay disabled but Weather() visuals kept.
      Audit (headless, full new-game flow): enter home (plains, biome 2) → IsometricScene active + castle@20,20 +
      40×40 localMap; placed 3 buildings; GameWorld.day advanced 1.00→1.81 while inside; Leave → ContinentScene
      active, player at settlement tile; SettlementState persisted (3 buildings, visited); re-entry restored
      house+farm; entered DIFFERENT-biome neutral (alpine forest, biome 9) → visibly distinct forest-ringed map;
      FPS 57-59 inside; screenshots p3_settlement_plains/p3_settlement_other confirm distinct maps + castle/buildings
      + HUD + Leave button; ZERO console errors; tsc clean; build clean.
      DEFERRED: garrison/population are stored but not yet richly simulated on the local map; administrator
      "while-you-were-away" diffing is a hook (lastVisitedDay) not yet computed (P5-7); the disabled world-scale
      systems need re-homing to the continent in later phases; SaveManager rewrite is P12.
- [x] P4 — Pioneer system (found settlements anywhere)
      Files: src/systems/PioneerSystem.ts (NEW — all send/found/specialty/ambush LOGIC, static class, state in
      GameWorld), src/systems/GameWorld.ts (PioneerParty type + pioneers[] + pioneerCounter, reset in
      startNewCampaign + serializable), src/systems/SettlementState.ts (added specialty/specialtyResource/founded),
      src/scenes/ContinentScene.ts (pioneer movement/icons/tooltip/guide/found-prompt + founded-flag icons + ambush
      tick), src/scenes/IsometricScene.ts (Send Pioneer Party button + confirm/dispatch + _specialtyMult +25% hook +
      founding-stockpile restore + nearestAliveTo stub fix), src/systems/Buildings.ts (apply _specialtyMult in
      produce()), src/main.ts (DEV __PioneerSystem hook).
      INTEGRATION: a PioneerParty is a THIRD continent-party flavour reusing the existing player/AI framework —
      plain data in GameWorld.pioneers[], advanced each frame by ContinentScene.updatePioneers() with the SAME A*
      (ContinentPathfinder) + per-biome BASE_TILES_PER_DAY budget as advanceParty/updateAIParties, drawn by
      layoutIcons() as a player-colour cart/wagon (HP pip) with a hover tooltip (purpose + dest + ETA). No new
      movement engine; only ARRIVAL behaviour differs ("offer to found" vs fight/patrol).
      SEND: IsometricScene "⚑ Send Pioneer Party" button (player towns only) → confirm modal showing cost
      (10 workers/200 wood/100 stone, keep ≥5 workers) → PioneerSystem.sendPioneer(fromId,dc,dr) deducts from the
      origin SettlementState, spawns the party at the origin tile, returns to the continent to guide it. Also a
      programmatic test entry point.
      GUIDE: click a pioneer to select (travelling) then click a tile to set its course (PioneerSystem.guidePioneer);
      arrived pioneer click → found prompt. Pioneers travel in real time.
      FOUND: on arrival, "Found Settlement Here?" + DOM name input. tryFound(id,name) validates passable + ≥15 tiles
      from any settlement + not within 12 tiles of an enemy hold → appends a kind:'player_castle' Settlement
      (founded:true) to WorldState.settlements (renders immediately as a planted-flag icon) AND creates its tier-1
      SettlementState (carried 10 pop + 200 wood/100 stone, local map themed by the destination biome via the P3
      system, empty founding camp) → player can Enter and build up.
      SPECIALTY by destination biome (stored on Settlement.specialty + SettlementState.specialty/specialtyResource,
      shown in continent tooltip, applied as +25% in Buildings.produce via scene._specialtyMult): highland/mountain→
      Iron Colony (+25% iron), forest→Lumber Camp (+25% wood), plains→Farmstead (+25% food), river/wetland→River Post
      (+25% fish), coast→Harbor Town (+25% fish, future naval).
      VULNERABILITY: PioneerSystem.tickAmbush(dayDelta) — each continent tick a goblin_camp within 10 tiles of a
      travelling pioneer deals 4 HP/game-day; pioneers have 20 HP; 0 → party destroyed, resources lost, "Pioneer
      party was ambushed!" notify (banner + GameWorld.notify). Optional escortStrength halves damage; no-escort never
      crashes.
      ICONS: founded settlements = planted-flag (player colour, distinct from conquered castle); pioneers = moving
      cart with HP pip; both also on the minimap. Notifications fire on found + ambush.
      Audit (headless, full new-game flow, /tmp/audit/p4_pioneer.mjs): sendPioneer → party exists + moving + costs
      deducted (wood 400→200, stone 200→100, pop 20→10); fast-forward → tryFound('Newhaven') → Settlement added
      (Farmstead, +25% food), SettlementState exists, founded flags set, materials deposited, empty camp (0 bldgs),
      pioneer removed; Enter → IsometricScene active, _specialtyMult{food:1.25}, only castle present; goblin ambush
      seed → HP 20→0, party wiped, ambush path runs frame-safe. Screenshots p4_continent_pioneer/p4_founded/
      p4_new_settlement. FPS 57-60; ZERO console errors; tsc clean; build clean. Also fixed a PRE-EXISTING
      crash: in-settlement goblin raid called goblinCamps.nearestAliveTo() (missing on the inert stub) → added it.
      REAL vs STUBBED: send/guide/found/specialty/ambush/icons/tooltips/notifications are all REAL. STUBBED/simple:
      ambush is a proximity-damage model (no pitched escort battle); the in-settlement Send button auto-picks a
      default founding tile (player re-guides on the continent); colony population growth uses the existing local
      Population system. DEFERRED: escort armies protecting pioneers (P5/P6), richer colony economy.
- [x] P5 — Living expedition system (parties on the continent)
      ExpeditionSystem.ts (static helpers, all state in GameWorld, serialization-friendly for P12) + ContinentScene/
      GameWorld hooks. Expeditions are now VISIBLE continent journeys, not timer buttons. The Phase-4 continent-party
      framework (A* + per-biome budget, advanced/rendered each frame by ContinentScene) is REUSED for the new worker
      party type — no new movement engine.
      1. RUINS EXPLORATION (REAL): walk the main party onto an unexplored ruin → "Explore?" prompt → ~1 game-day
         on-site dig (party parked, progress tracked) → reward granted on complete + ruin flagged explored (distinct
         archway icon). exploreRuin(id)/tickRuinExploration. Reward set = gold / resources / artifact / relic, chosen
         deterministically from the ruin id (save-stable); gold→campaign gold, bulk→nearest player town.
      2. GOBLIN CAMP RAIDS (REAL): march onto a camp → "Raid?" → real BattleScene (existing launch contract) vs a
         goblin army scaled per-camp (12–28). raidCamp(id); on win onCampRaidWon clears the camp (struck-skull icon),
         credits gold + iron/wood loot.
      3. WORKER EXPEDITION (REAL): sendWorkers(fromId, depositCol, depositRow) spawns a non-combat pickaxe party that
         travels to a deposit, mines ~2 days, auto-returns to the NEAREST player settlement and deposits the haul
         (120 units). Vulnerable like pioneers (HP + goblin-proximity damage, escort optional, never crashes without
         one).
      4. MERCENARY CAMPS (REAL): 4 merc camps appended to WorldState.settlements (kind:'mercenary', tent icon) at
         new-game. Travel there → hire veteran warriors straight into the field party at 35 gold/head (a good rate).
         hireMercenaries(campId, count).
      5. CARAVAN RAID (REAL, simplified resolve by design): merchant AI parties flagged as laden caravans
         (cargo wagon icon, lightly guarded). Intercept → quick odds-check skirmish (NOT BattleScene) → steal
         resources + bank a −20 relation delta in GameWorld.relationDeltas for P7. raidCaravan(id).
      6. EXPEDITION PANEL (REAL): "E" / button toggles a warm panel showing Active journeys (main/pioneer/worker +
         purpose + ETA), Discovered locations, and a Quick-travel button (50 gold → main party paths to a known site).
      VISIBLE PARTIES: crown=main, cart=pioneer, pickaxe=worker, tent=merc camp, wagon=caravan — all with tooltips +
      minimap dots. Notifications fire on arrive/deposit/clear/wipe via notifyExpedition; when inside a settlement the
      message is routed to IsometricScene.notify + queued with an "open the continent map" hint.
      Audit (headless full new-game flow, /tmp/audit/p5_expeditions.mjs): teleport onto ruin → exploreRuin → tick day
      → explored + gold 500→851; onto camp → raidCamp + startCampRaid → BattleScene launches → force-win → camp
      cleared; sendWorkers(home, iron) → worker exists+outbound → fastForwardWorker → home iron 0→120; hireMercenaries
      → army 80→90, gold 1000→650; raidCaravan → +239g/79w/69s/37i stolen + relationDeltas.purple=-20; panel opens
      (2 active, 6 discovered). Shots p5_expeditions + p5_parties. FPS 52-54; ZERO console errors; tsc clean; build
      clean. P4 pioneer + boot audits still green (no regression). DEFERRED (per spec): heroes (P6), diplomacy memory
      application (P7 reads relationDeltas), late-game (P8).
- [x] P6 — Hero world integration (dialogue, quests, stationing)
      RE-HOMED the 6-hero roster from the now-inert per-settlement IsometricScene to the CONTINENT. GameWorld now
      owns a real `Heroes` instance (`GameWorld.heroes`) backed by a tiny world-level host adapter (gameDay/notify/
      stats stubs) so existing XP/levels/passives keep working; arrivals auto-join (no per-settlement worldEvents).
      New system `src/systems/HeroWorld.ts` (static, GameWorld-backed, JSON-friendly) owns arrivals, dialogue,
      interactions, stationing, quests. ContinentScene wiring: bakes hero portrait textures; renders stacked portrait
      overlays on the party icon + on stationed settlements' icons; ticks arrivals/quests/interactions in onNewDay;
      fires biome/battle/victory/defeat/ruins/goblin dialogue; Heroes (H) panel for Station/Recall; gold-star quest
      markers. ARRIVALS: Aldric ~day 8, then Mira/Caelan/Maren/Tomas/Ravel via day/world conditions. DIALOGUE: ~20-32
      contextual lines/hero (aldric 32, maren 28, caelan 22, mira 21, tomas 24, ravel 24) across ~15 categories,
      throttled (0.6-day cooldown + one-shot story beats), shown as an auto-dismiss bottom-left speech popup. HERO-HERO:
      Aldric+Ravel tension, Maren+Tomas, Caelan+Aldric/Mira (occasional). STATIONING: station(id,settlementId) leaves
      the party + grants +12%/hero defence on the SettlementState + portrait on the town icon; recall() rejoins. QUESTS:
      all 6 real with travelable markers + real rewards — Aldric→garrison ally flag; Maren→friendly village; Caelan→
      caravan ally (−200g); Mira→reveals a real hidden 7th goblin fortress; Tomas→reveals a real 7th ruin + flags the
      4th win condition; Ravel→loyalty maxed + unique ability. Wrote relation/flag deltas into GameWorld.heroFlags for
      P7/P8. Also hardened a PRE-EXISTING crash in GameWorld.pickAIObjective (fractional candidate index → undefined).
      Audit (/tmp/audit/p6_heroes.mjs, headless new-game): add 2 heroes → 4 overlay objects on party icon (shot
      p6_party_heroes); fire 'forest' dialogue → speech popup shows (shot p6_dialogue); add Ravel → Aldric+Ravel "I
      don't trust you" tension; startQuest+completeQuest mira → marker + 7th fortress revealed (settlements 32→33); all
      6 quests start+complete clean; Tomas flags 4th win condition; station aldric → bonus 0.12 + portrait on town (shot
      p6_stationed); recall → back in party; arrival tick at day 9 → aldric joins; hero panel shot p6_hero_panel. 11/11
      asserts pass; FPS 50-57; ZERO console errors (3 consecutive runs); tsc clean; build clean. P5 expedition + iso-
      enter regressions still green. DEFERRED (per spec): diplomacy memory/honor (P7 consumes heroFlags/relationDeltas),
      late-game win-condition implementation (P8 reads fourthWinCondition), save wiring (P12 reads heroes serialize()).
- [x] P7 — Diplomatic narrative continuity (leader memory, honor)
      RE-HOMED diplomacy from the now-inert per-settlement IsometricScene to the CONTINENT/world level. GameWorld now
      owns a real `Diplomacy` instance (`GameWorld.diplomacy`, relation meters/treaties/NAP/alliance) + a real
      `FactionLeaders` instance (`GameWorld.leaders`, named rulers Valdris/Elowen/Krag), BOTH backed by a tiny
      world-level host adapter (`GameWorld.diploHost()`) that maps the 3 AI factions (red/purple/yellow) to the
      {cfg:{key,name,color},castleAlive} shape they expect, routes resources.spend/add to GameWorld.gold, and
      no-ops the per-settlement-only hooks. Banked Phase-5 caravan-raid deltas (`GameWorld.relationDeltas`) are
      applied into real relations once on init (deltasApplied guard). New system `src/systems/WorldDiplomacy.ts`
      (static, GameWorld-backed, JSON-friendly — same pattern as HeroWorld) is the brain on top: leader memory,
      history-based dialogue, memory events, betrayal consequences, honor.
      LEADER MEMORY: per faction `{battlesAgainst, battlesTheyWon, battlesYouWon, treatiesHeld, treatiesBetrayed,
      tributesPaid, warsDeclared, allied, firstContact, alliedSinceDay, caravansRaided}` in `GameWorld.leaderMemory`,
      incremented ONLY from real events (continent/expedition battles via ContinentScene.recordFactionBattle, treaty
      sign/break, tribute, war, alliance, applied caravan raids).
      HISTORY DIALOGUE: leaders speak differently by memory — memoryLine() escalates the same greeting through first
      contact → defeated1/2/3 → betrayed/allied/tribute. Full spec ladders for all three (Valdris/Elowen/Krag) +
      council variants (Valdris hostile vs respected, Elowen/Krag allied, "KRAG BROUGHT SNACKS"). Surfaced via a
      leader-portrait speech popup (bottom-right, distinct from the hero popup) + in the diplomacy panel.
      MEMORY EVENTS (one-shot, real effects): Valdris beaten 3× & rel≥0 → +5 warriors to the party; Elowen allied
      10+ days → shares all intel free (intelShared flag); Krag beaten 3× & rel≥-20 → unique artifact (Krag's
      Worldcleaver) + becomes ally.
      BETRAYAL: breaking a treaty → that leader's angry line + ALL factions −10 relations + honor −3 + a "Word spreads
      that [Kingdom] cannot be trusted" event + `diploFlags.caravanAvoidUntilDay` (5 days; WorldDiplomacy
      .caravansAvoidingPlayer() is the readable flag for AI/ExpeditionSystem).
      HONOR: `GameWorld.honor` (+1 per treaty upheld every 4 days, −3 per betrayal). ≥+10 → treaties 30% cheaper;
      ≤−5 → +50 gold/treaty. Surfaced at the top of the diplomacy panel with its current effect.
      PANEL: D key / "Diplomacy (D)" button on the continent → warm panel showing honor+gold, then per faction a
      leader portrait + name + relation bar (−100..+100) + treaty status + one-line memory recap + world-level
      actions (Tribute 50g / Trade / Ally / Betray / War) wired to WorldDiplomacy. Daily tick (onNewDay) accrues
      honor + drifts relations + fires time-based memory events. main.ts exposes __WorldDiplomacy for the audit.
      Audit (/tmp/audit/p7_diplomacy.mjs, headless new-game): banked purple −20 applied; Valdris first-contact +
      3 wins → battlesYouWon=3, "earned my respect" day-3 line, 5-warrior gift (army 34→39); sign+break purple
      alliance → all factions −10, honor −3, "cannot be trusted" notify, caravan-avoid flag set; tribute yellow →
      tributesPaid 0→1 + "GOLD!..." line; ally purple +11 days → Elowen 10-day intel event fires; honor cost
      modifiers (140/200/250 hi/mid/lo); diplomacy panel 53 objects render (shot p7_diplomacy); council variants
      (Valdris respected, Krag snacks). 21/21 asserts pass; FPS 55-56; ZERO console errors (2 runs); tsc clean;
      build clean. P5 expedition + P6 hero audits still green (no regression). DEFERRED (per spec): late-game
      stages (P8 reads diploFlags), battle fog/rivers (P9), win endings (P10 — diploFlags.uniqueArtifact/intelShared
      written for them), save wiring (P12 reads diplomacy/leaders serialize() + leaderMemory/honor/diploFlags).
- [x] P8 — Late game content (stages 8–9, tournament, imperial)
      DEFINED the "kingdom stage" = the player's HOME castle settlement `tier` + 1 (1..9). New helpers on GameWorld:
      `kingdomStage()` (reads home `SettlementState.tier`), `setKingdomStage(n)` (test hook), `homeSettlement()/
      homeState()`. New system `src/systems/LateGame.ts` (static, GameWorld-backed, JSON-friendly — same pattern as
      WorldDiplomacy/HeroWorld) ORCHESTRATES the per-day ticks, emissary movement, stage-transition events, the
      chronicle, and the stage-9 caps; the heavy ACTION methods live on GameWorld so the spec's `GameWorld.method()`
      contract holds with no circular import. ALL new state is plain JSON on GameWorld (serializable() extended) for P12.
      STAGE 8 (Medium Castle): (1) GRAND TOURNAMENT — `GameWorld.startTournament()` (300g + 50 food, ~3 days);
      `tickTournament()` (daily, in LateGame.onNewDay) finishes it → a faction CHAMPION joins the army (8-strong
      'champion' group), all factions +10 relations, home happiness +30/5d (tempHappy), +10 Protector rep
      (lateGameFlags.protectorRep). Festival GROUNDS (striped tents + pennant flag) render near the home castle on the
      continent (ContinentScene.layoutIcons) while active. (2) LEGENDARY FORGE — `buildLegendaryForge()` upgrades the
      home Blacksmith (200 iron + 100 stone), `tickLegendaryForge()` PRODUCES 1 `legendaryEquipment`/day into the home
      stockpile; `upgradeHeroWeapon(id)` consumes 1 → that hero +40% damage + uniqueVisual flag (heroFlags
      .legendaryWeapon; the equip economy is P11). (3) EXTRA ARMY SLOT — `GameWorld.armyCap` raised 1→2 at stage 8
      (LateGame.syncArmyCap). (4) EMISSARY SYSTEM — `sendEmissary(faction)` spawns a named scroll/envelope continent
      party (EmissaryParty, rendered + advanced toward the faction castle via LateGame.tickEmissaries from
      ContinentScene.update); on arrival → permanent EMBASSY (`establishEmbassy`, `embassies` map) → passive +2
      relations/day (`tickEmbassies`). Hostile target → ~60% CAPTURE (`captureEmissary`); `ransomEmissary(id)` frees
      for 200g. Embassy markers render at faction castles.
      STAGE 9 (Large Castle): (5) IMPERIAL PROCLAMATION — `declareImperial()` (1000g + 300 stone + 200 iron): allies
      celebrate (gold gift + relations up), neutrals −30, hostiles → war (rel −100). Sets `imperialProclaimed=true` +
      `imperialEndingUnlocked` for P10's unique ending. Confirmation modal + leader-reaction speech bubbles in
      ContinentScene. (6) CHRONICLE OF THE KINGDOM — `GameWorld.chronicle:[]` (+ `recordChronicle(text, once?)`),
      narrative entries appended by wired event sources (hero joins → ContinentScene.onNewDay; war declared →
      WorldDiplomacy.declareWar; settlement founded → PioneerSystem.tryFound; stage reached + all P8 actions). New
      `scribetower` building (stage-9 unlock, reuses Library art). Readable narrative panel ("Day N: …") in the new
      Realm panel. (7) CAPS — at stage 9 the HOME settlement population cap → 500 (Population.capacity reads scene
      `_popCapOverride`) and building cap → 50 (IsometricScene.maxBuildings, which this phase also ADDS — it was
      previously called but undefined). Single source of truth: LateGame.populationCap()/buildingCap() (0 below stage 9).
      TRANSITION EVENTS (one-shot, gated on highestStageSeen): stage 8 → "travellers come to marvel at your great
      castle" + neutral NPC flavour; stage 9 → each leader's message (Valdris/Elowen/Krag spec lines) + "the continent
      watches you with awe and fear", with leader-speech bubbles. Both also append to the Chronicle.
      UI: new "Realm (R)" continent HUD button + panel — the late-game hub (Grand Tournament, Legendary Forge +
      hero-weapon upgrade, per-faction Emissaries/Embassies, Imperial Proclamation) + the Chronicle scroll, gated by
      stage with costs/availability. main.ts exposes __LateGame for the audit.
      Audit (/tmp/audit/p8_lategame.mjs, headless new-game): kingdomStage 1→8 via setKingdomStage; tournament available
      → start → tick 3d → champion joined + all factions +10 + Protector rep +10; Legendary Forge built (200 iron + 100
      stone) → produces legendaryEquipment 1/day → hero weapon +40% flag; army cap 2; sendEmissary('purple') →
      continent party → arrival → embassy gives +2/day; hostile capture → ransom 200g; stage 9 → leader messages fire +
      caps 500/50; declareImperial → red at war, purple −30, ally yellow celebrates, imperialProclaimed + ending flag;
      chronicle entries appended; Realm/Chronicle panel renders (shot p8_chronicle); tournament grounds render (shot
      p8_tournament). 30/30 asserts pass; FPS 54-56; ZERO console errors (multiple runs); tsc clean; build clean.
      Boot + settlement-entry + stage-9 caps checks green (no regression; maxBuildings now defined). DEFERRED (per
      spec): win-ending TEXT (P10 reads imperialProclaimed/imperialEndingUnlocked); equip/prestige/monument/research
      economy (P11 reads legendaryEquipment + heroFlags.legendaryWeapon); save wiring (P12 — all P8 state in
      serializable()).
- [x] P9 — Battle fog of war + river system
      A — BATTLE FOG OF WAR: a pre-battle info gate (overlay only, never touches combat/result/onComplete). `intel` cfg
      level computed at BOTH launch sites (ContinentScene.startBattle + startCampRaid → computeIntel): 'mira' if Mira
      Swiftarrow/ranger marches with the party; else 'full'/'basic' if fresh intel on the faction (GameWorld.intelOnFaction,
      ~5-day TTL — Espionage Gather-Intel now banks GameWorld.setIntelOnFaction); else 'none'. BattleScene.applyPreBattleIntel
      renders: none = dark blue-gray fog over the enemy half + count-only label ("Enemy force: ~N units"), enemy hidden,
      enemy morale bar hidden; basic = types visible but scrambled huddle (formation/markers/label hidden); full = full
      formation + scout note; mira = full + enemy morale bar + ability revealed, no fog. liftBattleFog() on startBattle()
      sweeps the fog off with a wipe + flash and fades the enemy in. New state serialization-friendly (intelFlags).
      B — RIVER SYSTEM: RIVER biome cost 2.6→2.5 (ford). ContinentPathfinder gained per-tile cost overrides; ContinentScene
      .syncRiverCrossings sets intact bridges ~1.0, ferry-dock river tiles ~1.5, destroyed bridges revert to ~2.5. Bridges
      got stable ids + riverIdx + destroyed flag; GameWorld.destroyBridge/rebuildBridge (5 days, 40 wood)/tickRivers + a
      bridge/broken-bridge/ferry icon layer + a river-tile tooltip (crossing cost). GameWorld.buildFerryDock (60 wood,
      river-bank, ~1.5×) + 'B'-key continent prompt + a Ferry Dock building type. GameWorld.riverControlledBy() exposes
      light river control. BattleScene draws a river ACROSS the field on river-tile battles (riverBattle cfg) reusing the
      −20% crossing-zone mul. All new state JSON for P12 (intelFlags/bridgeState/ferryDocks added to serializable()).
      VERIFY: tsc clean, build clean, headless 36/36 asserts pass, 0 console errors/warnings, FPS ~43. Shots: p9_fog_none/
      _lifted/_full/_basic/_mira, p9_river_battle, p9_continent_river. Deferred (per spec): full enemy-blocking river-control
      AI (flag only), ferry toll gold tick (stored hook), P10 endings / P11 economy / P12 save rewrite.
- [x] P10 — Win consequence system (reputation endings)
      A — REPUTATION RE-HOMED: `GameWorld.reputation` is a real Reputation instance driven by a tiny world host
      adapter (repHost — milestone log → notify; effects owned by WinConsequences). `addReputation()` is the single
      world entry point; the start TRAIT stays accessible via `GameWorld.trait()`/king.trait. The Grand Tournament's
      old lateGameFlags.protectorRep now also feeds the real tracker; a field-battle win adds conqueror rep, and
      wiping a faction's last party marks its castle fallen (reactionFlags.fallenCastles) + a bigger conqueror bump.
      Serializable() carries reputation/winTriggered/wonPath/legacyHappyDays/reactionFlags; reset on new campaign;
      rebindReputation() on continent (re)entry. Legacy WinConditions.ts retained for the per-settlement IsometricScene.
      B — WORLD-LEVEL WIN CHECKS (WinConsequences.ts, stateless static like LateGame/WorldDiplomacy, run from
      ContinentScene.onNewDay): CONQUEST = player-controlled ÷ ownable holds (player_castle+ai_castle+neutral, fallen
      AI castles counted) ≥ 70%; DIPLOMACY = every surviving AI faction allied / ≥80 relations; LEGACY = home stage ≥9
      + population ≥40 + research ≥5 + happiness ≥80 sustained 5 days; EMPIRE (4th) = heroFlags.fourthWinCondition +
      `GameWorld.restoreEmpire()` (spends 5000 gold → wonPath='Empire'). Win shows the end screen ONCE.
      C — ENDING VARIANTS (endingData, won path × dominant rep / trait): Conquest+Destroyer = dark "Conquered Through
      Fear and Fire" + rebellion hook; Conquest+Conqueror = "Proven in Honest Battle"; Conquest+Protector = unique best
      "A Conqueror Who Remembered You Were Also Human"; Diplomacy+Merchant = "You Bought the Peace"; Diplomacy+Protector
      = "Peace Through Trust"; Legacy+Scholar = "A New Age of Learning"; Legacy+Builder = "What You Built Will Be
      Studied"; Empire = single unique "The Old Empire Reborn" regardless of reputation.
      D — WIN SCREEN (ContinentScene.showWinScreen): VICTORY banner + variant title + prose, "You were known as
      [Title]. Here is why:" + full reputation profile bars (highest flagged) + 3–4 SPECIFIC deeds pulled from
      GameWorld.chronicle (fallback: notifications), Continue/Main Menu. Dark scorched theme for the destroyer variant.
      E — ONGOING WORLD REACTION (tickReputationReaction, ~6-day cooldown, by highest track): Protector → a neutral
      settlement JOINS peacefully (faction→player, counts toward conquest); Destroyer → neutral surrender plea + rare
      goblin acknowledgement; Conqueror → weakest faction sends pre-emptive tribute (+120g, +rel); Merchant → caravan
      toll (+60g) + mercenary discount flag.
      VERIFY: tsc clean, build clean, headless 0 console errors/0 warnings, FPS 50–53. Shots: p10_win_destroyer,
      p10_win_protector, p10_win_empire (+protector_detail). All 4 win paths + 7 ending variants asserted; protector-join
      & conqueror-tribute reactions fired. Deferred (per spec): P11 economy/prestige/monuments, P12 save rewrite.
- [x] P11 — Economy mid-game reinvestment (equipment, prestige, monuments)
      A — ARMY EQUIPMENT TIERS: `GameWorld.equipmentTier` 0..3 (Basic/Iron/Steel/Legendary), army-WIDE (not per-unit).
      `craftEquipment(tier)` (+ canCraftEquipment) spends from EQUIPMENT_RECIPES (Iron 40iron+60g; Steel 80iron+30planks
      +120g; Legendary 150iron+50planks+200g + 1 artifact OR 1 legendaryEquipment) — must craft in order; Iron/Steel
      need a home Blacksmith, Legendary reuses the Phase-8 Legendary Forge (not duplicated). EFFECT: equipmentDamageMult()
      = 1/1.15/1.30/1.50 folded into BattleScene.playerCmdMul() so every player strike gets +15/30/50%. VISUAL: applyEquipmentTint()
      gives player units a progressive armour sheen (Iron steel-grey / Steel silver / Legendary unique gold glow + additive
      aura ring); _equipTint reapplied after the hit-flash, aura follows in sync()/destroyed on die. Tier/mult/monumentMorale
      passed via cfg (GameWorld fallback) so headless tests can pin values.
      B — SETTLEMENT INVESTMENT: `invest(settlementId,kind)` (+ canInvest) from INVEST_DEFS — Infrastructure (200g →
      +10% all production, read via investProductionMult → Buildings.produce _investProdMult); Fortification (150g+50stone
      → +3 permanent garrison, +50% wall-HP flag); Population (100g+50food → +5 pop now + 10-day +50% growth window read by
      Population.onNewDay _investGrowthUntil); Trade (150g → +5 gold/day via ContinentScene.onNewDay investGoldPerDay,
      caravan +20% flag). Flags stored on SettlementState.invest{} + investGrowthUntil (serialize-friendly). UI: an "Invest"
      panel (IsometricScene renderInvestPanel, opened from the Castle category) + flush/pullWorldResources sync the live
      stockpile to the SettlementState the GameWorld cost checks read.
      C — PRESTIGE: `GameWorld.prestige` (monotonic) via the single addPrestige(n,reason,once) entry point. SOURCES wired:
      Grand Hall built +50 (IsometricScene placement), large battle win +10/+20 scaled (ContinentScene.onBattleComplete),
      Stage 9 +200 (LateGame.fireStage9), ruin explored +20 (ExpeditionSystem.grantRuinReward; artifact/relic also banks
      heroFlags.artifacts toward Legendary gear), hero Lv5 +30/hero (grantHeroBattleXP). EFFECTS: 50+ neutral prices +10%
      (prestigePriceBonus); 100+ "fame spreads" + 200+ "pilgrims" one-shot beats (checkPrestigeThresholds); 300+ releases
      the unique 7TH HERO "The Ancient" (Heroes DEFS: 200hp warrior, army +20% morale/never routs — releaseAncientHero
      offers→auto-joins the world roster); 500+ counts toward LEGACY (WinConsequences waives the happiness gate). Shown in
      the Realm panel + on the end screen.
      D — MONUMENTS (new building category, home settlement): Victory Arch (500g+100stone →+50 prestige), Great Statue
      (800g+150stone+50iron →+100 prestige +15 battle morale, monumentMoraleBonus seeds BattleScene morale), Imperial
      Palace (1500g+200stone+100planks →+200 prestige, lateGameFlags.imperialPalace + Imperial-path link). Added to
      BuildingTypes (monument:true, reuse hallofheroes/castle_castle art) + a Monuments panel; placement charges via
      GameWorld.buildMonument (purse gold + home stockpile) not local resources.spend. Stored in GameWorld.monuments[].
      E — RESEARCH IMPERIAL BRANCH (Research.ts branch 3, gated stageGate:7 via GameWorld.kingdomStage in available()):
      Imperial Roads (free roads — Roads.buildPath _researchFreeRoads + continent party movement +50% via
      lateGameFlags.imperialRoads in advanceParty), Imperial Treasury (Banking interest 2%→4% via _researchBankRate),
      Imperial Legion (Elite units +1 level → Troops.spawnElite +20% hp/dmg "Legion" via _researchEliteBonus). 4-column
      research panel with branch labels + stage-lock notes.
      All new state plain-JSON in serializable() (equipmentTier/prestige/prestigeFlags/monuments + per-settlement invest
      flags ride settlementStates) for P12; reset on new campaign.
      VERIFY: tsc clean, build clean, headless audit 40/40 pass, 0 console errors/0 warnings, FPS 51. Shots:
      p11_equipment_battle (tier-1 tint + +15% dmg), p11_invest, p11_prestige_panel, p11_monument, p11_monument_placed
      (full UI placement +50 prestige), p11_legendary_battle (tier-3 gold glow + aura). DEFERRED to P12: save rewrite;
      Imperial Palace literally swapping the live castle sprite (flag + own building sprite only for now).
- [ ] P12 — Full integration + save system update
