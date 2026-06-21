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
- [ ] P7 — Diplomatic narrative continuity (leader memory, honor)
- [ ] P8 — Late game content (stages 8–9, tournament, imperial)
- [ ] P9 — Battle fog of war + river system
- [ ] P10 — Win consequence system (reputation endings)
- [ ] P11 — Economy mid-game reinvestment (equipment, prestige, monuments)
- [ ] P12 — Full integration + save system update
