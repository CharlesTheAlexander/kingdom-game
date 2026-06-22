/*
 * IsometricScene.js — Medieval Kingdom Builder (Phaser 3) — ISOMETRIC REBUILD
 * ===================================================================
 * Replaces GameScene as the main scene. It EXTENDS GameScene so that all of the
 * coordinate-agnostic systems and UI are reused unchanged, and only the
 * rendering / coordinate / depth layer is rewritten for an isometric world.
 *
 * SYSTEMS WIRED IN (all from src/systems):
 *   - Resources.js .......... wood / stone / food / gold / IRON / workers / soldiers
 *   - Buildings.js .......... placement grid, worker allocation, upgrades, towers
 *   - BuildingTypes.js ...... building definitions (texture key == building key)
 *   - Pawns.js .............. worker pawns walking to resource nodes (iso space)
 *   - Troops.js ............. warriors / archers / monks / mercenaries
 *   - ResourceNodes.js ...... trees / gold-stone / rock / sheep harvest nodes
 *   - Expeditions.js ........ send soldiers off-map for SPECIAL rewards (Phase 5)
 *   - AIKingdom.js + Waves.js  Red/Purple/Yellow enemy factions + wave coordinator
 *   - Wildlife.js ........... wolves / goblins / boars (Phase 2 threat layer)
 *   - Territory.js .......... territory wash + soft border + basic fog of war
 *   - Pathfinding.js ........ A* enemies path around buildings (iso tiles)
 *   - AudioManager.js ....... audio roadmap placeholder
 *
 * WHAT THIS FILE OVERRIDES FOR ISOMETRIC:
 *   - Coordinates: tileTopLeft / tileCenter / screenToTile / pointerToTile using
 *       screenX = (col-row)*32, screenY = (col+row)*16  (64x64 diamond tiles).
 *   - World: 40x40 grid, center 15x15 buildable settlement zone.
 *   - Depth sorting: every tile/object depth = (col+row) so things draw back to
 *       front (applyIsoDepths re-sorts moving units / nodes / AI every frame).
 *   - Buildings: iso art, multi-tile footprints (Castle 3x3, Barracks 2x2).
 *   - Camera: right/middle-drag pan, wheel zoom 0.5–2, clamped to the iso world.
 *   - Minimap, day cycle, food upkeep, sunrise animation.
 *
 * PHASE B ADDITIONS (this session):
 *   - Phase 1: confirmed UI-camera / building-anchor / enemy-spawn fixes; fixed a
 *       stray red_archer_idle frame warning so the console is clean.
 *   - Phase 2: Wildlife.js layered threat system (wolves/goblins/boars) wired into
 *       the existing combat via a combined threat list; warriors auto-defend with
 *       a leash so they don't chase wildlife across the map.
 *   - Phase 3: four geographic regions (N forest / E highlands / S plains+river /
 *       W mixed) via regionAt(); region-biased resource nodes.
 *   - Phase 4: Territory.js — territory grows with buildings/tiers (tinted ground
 *       tiles + soft border + fog of war); raid-safe nodes, worker harvest range.
 *   - Phase 5: expeditions return only special rewards (Iron resource, 5 Artifact
 *       buffs, Scrolls, Mercenaries, Scout intel); day-based durations.
 *   - Phase 6: three independent AI kingdoms (Red W / Purple NE / Yellow SE) with
 *       a wave coordinator (one attacker at a time), per-faction territory tint,
 *       and a kingdom status panel.
 *   - Phase 7: day-transition banner + season + bread float, node deplete/respawn
 *       FX, combat hit-flash + death fade, threat banners, wall/castle tier evo.
 *
 *   Dev-only verification hooks (import.meta.env.DEV): ?nointro skips the welcome
 *   modal, ?zoom=0.5 starts zoomed out, ?day=N starts on a later day.
 * ===================================================================
 */
import Phaser from 'phaser';
import { GameScene, GAME_W, GAME_H } from './GameScene.js';
import { Resources } from '../systems/Resources.js';
import * as AssetGenerator from '../systems/AssetGenerator.js';
import { Banking } from '../systems/Banking.js';
import { GreatCouncil } from '../systems/GreatCouncil.js';
import { Roads } from '../systems/Roads.js';
import { FactionLeaders } from '../systems/FactionLeaders.js';
import { Heroes } from '../systems/Heroes.js';
import { Maintenance } from '../systems/Maintenance.js';
import { RoyalCourt } from '../systems/RoyalCourt.js';
import { Succession } from '../systems/Succession.js';
import { Espionage, MISSIONS } from '../systems/Espionage.js';
import { Narrative } from '../systems/Narrative.js';
import { Weather } from '../systems/Weather.js';
import { PopulationClasses } from '../systems/PopulationClasses.js';
import { BuildingManager } from '../systems/Buildings.js';
import { WaveManager } from '../systems/Waves.js';
import { PawnManager } from '../systems/Pawns.js';
import { TroopManager } from '../systems/Troops.js';
import { ResourceNodeManager } from '../systems/ResourceNodes.js';
import { ExpeditionManager } from '../systems/Expeditions.js';
import { AIKingdom, AIArcher, FACTIONS } from '../systems/AIKingdom.js';
import { WildlifeManager } from '../systems/Wildlife.js';
import { Territory } from '../systems/Territory.js';
import { SettlementManager } from '../systems/Settlements.js';
import { GoblinCampManager } from '../systems/GoblinCamps.js';
import { Diplomacy } from '../systems/Diplomacy.js';
import { Caravans } from '../systems/Caravans.js';
import { findPath } from '../systems/Pathfinding.js';
import { registerUnitAnimations } from '../systems/Animations.js';
import { sfx } from '../audio/SoundEngine.js';
import { showTransition } from './TransitionOverlay.js';
import * as SaveManager from '../systems/SaveManager.js';
import { Population } from '../systems/Population.js';
import { ArmyManager } from '../systems/ArmyManager.js';
import { WorldEvents } from '../systems/WorldEvents.js';
import { Reputation, TRAITS, defaultBonuses } from '../systems/Reputation.js';
import { Research } from '../systems/Research.js';
import { WinConditions } from '../systems/WinConditions.js';
import { Ruins } from '../systems/Ruins.js';
import { WanderingFactions } from '../systems/WanderingFactions.js';
import { Discovery } from '../systems/Discovery.js';
import { KingdomStats } from '../systems/KingdomStats.js';
import { BuildingTypes, BUILD_ORDER, formatCost } from '../data/BuildingTypes.js';
import { GameWorld } from '../systems/GameWorld.js';
import { LateGame } from '../systems/LateGame.js';
import { generateWorld } from '../systems/WorldGenerator.js';
import { Biome } from '../data/Biomes.js';
// (Phase 4 Pioneer) Aliased so the in-scene helpers read clearly as a reference
// to the shared static PioneerSystem (all state lives in GameWorld).
import { PioneerSystem as PioneerSystemRef } from '../systems/PioneerSystem.js';

// ---- Isometric world constants -------------------------------------------
// PHASE 3 (Bannerlord rebuild): IsometricScene is now a PER-SETTLEMENT view, so
// the grid is a small LOCAL map (~40×40) for ONE settlement rather than the old
// 200×200 continent — the continent now lives in ContinentScene + GameWorld. The
// art pipeline and isometric renderer are unchanged; only the SIZE and WHAT-map
// shrank. 40 tiles gives a ~20×20 buildable core plus a wilderness/resource ring.
const N = 40;            // 40x40 LOCAL settlement map (was the 200x200 continent)
const HW = 32;           // half tile width  (screenX step = col-row * 32)
const HH = 16;           // half tile height (screenY step = col+row * 16)
const OX = (N - 1) * HW; // origin offset so col-row = -(N-1) lands at x = 0
const OY = 120;          // origin offset (headroom for back-row building tops)
const WORLD_W = (N - 1) * HW * 2 + 128; // camera world bounds
const WORLD_H = (N - 1) * HH * 2 + 260;
// Depth = (col+row) * DMUL. With col+row up to 398 we keep DMUL small so the
// whole world band stays below ~24 and the HUD (28+) renders on top. Terrain is
// a single Blitter layer well below everything (TERRAIN_DEPTH), so only moving
// units/buildings need this fine-grained ordering.
const DMUL = 0.06;
const TERRAIN_DEPTH = -10;
const TOP_BAR = 50;      // screen-space HUD band (matches GameScene)
const PANEL_H = 130;
const DAY_MS = 300000;   // one game day = 5 real minutes (scaled by game speed)

// (Polish Phase 5) Compact a resource value so it never clips its HUD chip:
// up to 9999 shown in full, 10k–99.9k as "12.3k", 100k+ as "123k".
export function fmtNum(n: number): string {
  n = Math.floor(n || 0);
  if (n >= 100000) return Math.round(n / 1000) + 'k';
  if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return '' + n;
}

// (Polish) Clip an over-long name with an ellipsis so labels never overflow.
export function ellipsize(s: any, max: number): string {
  s = '' + (s || '');
  return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s;
}

export class IsometricScene extends GameScene {
  [key: string]: any;

  constructor() {
    // NOTE: GameScene's constructor hardcodes super('GameScene') and ignores its
    // argument, so super('IsometricScene') would NOT take — both scenes would end
    // up keyed 'GameScene' and Phaser throws "duplicate key: GameScene" (black
    // screen). The key is set on this.sys.settings (already created by super())
    // before the SceneManager reads it, giving this scene its own unique key.
    super();
    this.sys.settings.key = 'IsometricScene';
  }

  // ---- Per-settlement context (Phase 3) ------------------------------------
  // Phaser calls init(data) before create(). ContinentScene starts this scene
  // with { settlementId }; we also fall back to GameWorld.currentSettlementId.
  // We resolve the SettlementState here so create() can build the right LOCAL
  // map and restore saved buildings. A defensive default keeps a DIRECT boot
  // (e.g. headless smoke test) working even with no campaign in progress.
  init(data: any) {
    this._perSettlement = true; // this scene is ALWAYS a per-settlement view now
    this._leaving = false; this._left = false; // reset leave guards each entry
    let id: string | null = (data && data.settlementId != null) ? String(data.settlementId)
      : GameWorld.currentSettlementId;
    // Ensure a world + a current settlement exist for a clean direct boot (e.g.
    // a headless smoke test that starts IsometricScene without the continent).
    if (!GameWorld.world) {
      try { GameWorld.startNewCampaign(generateWorld()); } catch (e) { /* handled below */ }
    }
    if (id == null && GameWorld.world) {
      // Default to the player's home castle if nothing was passed.
      const home = GameWorld.world.settlements.find((s: any) => s.kind === 'player_castle');
      if (home) id = GameWorld.settlementId(home);
    }
    GameWorld.currentSettlementId = id;
    this._settlementId = id;
    // settlementState() lazily creates + caches the persisted state.
    this._settle = GameWorld.settlementState(id) || null;
    this._settleBiome = this._settle ? this._settle.localMap.biome : Biome.PLAINS;
    this._settlePlayerOwned = this._settle ? this._settle.localMap.playerOwned : true;
    this._settleSeed = this._settle ? this._settle.localMap.seed : 12345;
    // (Phase 8) Stage-9 population-cap raise (→500) for the home settlement. 0 =
    // no override (Population.capacity falls back to the per-house value). Set on
    // entry; LateGame.populationCap() returns 0 below stage 9 so it is inert until
    // the home castle reaches a Large Castle.
    this._popCapOverride = (this._settle && this._settle.faction === 'player') ? LateGame.populationCap() : 0;
  }

  // Deterministic per-settlement PRNG (mulberry32) seeded from the local map seed
  // so the SAME town always regenerates the SAME layout (no per-tile storage).
  _srand(): number {
    let t = (this._rngState = (this._rngState + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ---- Asset loading -------------------------------------------------------
  // (Assets Phase 8) The art packs are gone — EVERY texture is generated
  // procedurally in create() via AssetGenerator.generateAll(). preload() only
  // installs a missing-texture fallback so a stray key can never crash the game.
  preload() {
    AssetGenerator.installFallback(this);
  }

  // ---- Scene setup (mirrors GameScene.create with iso dimensions) ----------
  create() {
    // TILE here is the gameplay-distance metric used by combat ranges (kept at
    // 48 so balance matches the original); the *visual* iso tile is 64 wide.
    this.TILE = 48;
    this.COLS = N;
    this.ROWS = N;
    this.gridOriginY = 0;
    this.PANEL_Y = GAME_H - PANEL_H;

    // Center ~20x20 buildable settlement zone of the 200x200 world.
    const mid = Math.floor(N / 2);
    this.BZ = { c0: mid - 10, c1: mid + 10, r0: mid - 10, r1: mid + 10 };

    this.isGameOver = false;
    this.selectedBuilding = null;
    this.placementType = null;
    this.tickAccumulator = 0;
    this.gameSpeed = 1;
    this.selectedUnits = [];
    this.boxSel = null;
    this._prevRes = {};
    // (Save system) scene.restart() reuses this instance, so null stale HUD refs
    // whose display objects were destroyed by the restart — otherwise the first
    // updateHud() (run inside buildHud, before these are rebuilt) touches dead text.
    this.chips = null;
    this.panelTabs = null;
    this._chipPrev = {};
    this._menuOpen = false; this._menuEls = null; this._savingEls = null;
    this._confirmEls = null; this._tip = null; this._soundUI = null; this.movingBuilding = null;
    this._popHud = null; this._kingName = null; this._kingTitle = null; this._kingEls = null; this._logEls = null;
    this._logBtnBadge = null; this._logOpen = false; this._pauseBtn = null; this._paused = false; // (Phase 7) reset on restart
    this._endScreenEls = null; this._speedBeforeEnd = null; this._repExpanded = false; // (Audit FIX 2/5) reset on restart
    this._pioneerModal = null; this._leaveModal = null; // (Phase 4) reset transient pioneer/leave dialogs
    this._discEls = null; this._promptEls = null; this._taxText = null; this._statsEls = null; this._discQueue = []; this._discActive = []; // (Session-1) reset transient UI

    // Day cycle (new this rebuild).
    this.gameDay = 1;
    // (Critic #2 fix) Start mid-morning in bright daylight rather than at the dim
    // dawn (phase 0), so the player's first look at their kingdom is well-lit.
    this.dayTimer = DAY_MS * 0.22;

    // Dev-only verification hooks (?nointro skips the welcome modal, ?zoom=0.6
    // starts zoomed out, ?day=N starts on a later day to test AI/wildlife timing).
    this._noIntro = false;
    this._startZoom = null;
    if (import.meta.env && import.meta.env.DEV) {
      const q = new URLSearchParams(window.location.search);
      this._noIntro = q.has('nointro');
      this._startZoom = q.has('zoom') ? parseFloat(q.get('zoom')) : null;
      if (q.has('day')) this.gameDay = Math.max(1, parseInt(q.get('day'), 10) || 1);
    }

    // (Phase 4) Full 9-stage settlement progression. `stage` gates buildings;
    // `tex` selects the castle sprite; `wall` auto-draws a perimeter; `announce`
    // fires the big banner at the milestone stages.
    this.TIERS = [
      { name: 'Small Village', stage: 1, maxBuildings: 8, tex: 'castle', castleScale: 1.0 },
      { name: 'Medium Village', stage: 2, maxBuildings: 12, cost: { gold: 150, wood: 100 }, tex: 'castle', castleScale: 1.1 },
      { name: 'Large Village', stage: 3, maxBuildings: 16, cost: { gold: 250, wood: 150, stone: 50 }, tex: 'castle', castleScale: 1.2, wall: 'fence' },
      { name: 'Small Town', stage: 4, maxBuildings: 20, cost: { gold: 400, wood: 200, stone: 150 }, tex: 'castle_town', castleScale: 1.3, wall: 'wood', announce: 'Your village has grown into a Town!' },
      { name: 'Medium Town', stage: 5, maxBuildings: 24, cost: { gold: 600, wood: 250, stone: 200 }, tex: 'castle_town', castleScale: 1.4, wall: 'stonebase' },
      { name: 'Large Town', stage: 6, maxBuildings: 28, cost: { gold: 900, wood: 300, stone: 350, iron: 50 }, tex: 'castle_town', castleScale: 1.5, wall: 'stone' },
      { name: 'Small Castle', stage: 7, maxBuildings: 32, cost: { gold: 1200, wood: 400, stone: 500, iron: 100, cutStone: 20 }, tex: 'castle_castle', castleScale: 1.6, wall: 'stone', moat: true, announce: 'Your town has become a Castle!' },
      { name: 'Medium Castle', stage: 8, maxBuildings: 36, cost: { gold: 1800, stone: 500, iron: 200, cutStone: 20 }, tex: 'castle_castle', castleScale: 1.8, wall: 'stone', moat: true, towers: true },
      { name: 'Large Castle', stage: 9, maxBuildings: 40, cost: { gold: 2500, stone: 600, iron: 300, cutStone: 20 }, tex: 'castle_castle', castleScale: 2.0, wall: 'stone', moat: true, towers: true, announce: 'Your kingdom stands as a mighty Castle!' },
    ];
    this.tierIndex = 0;

    this.resources = new Resources();
    this.stats = new KingdomStats(this); // (Session-1 Phase 6) all-time stats (wraps resources.add)
    this.buildings = new BuildingManager(this, N, N);
    this.waves = new WaveManager(this, 60);
    this.pawns = new PawnManager(this);
    this.troops = new TroopManager(this);
    this.nodes = new ResourceNodeManager(this);
    this.expeditions = new ExpeditionManager(this);
    this.wildlife = new WildlifeManager(this); // Phase 2 wildlife threats
    this.population = new Population(this); // (Expansion Phase 5) population + happiness
    // (Expansion Phase 4) King identity + reputation. Trait bonuses must exist
    // before ArmyManager (it reads the army cap) and the economy hooks.
    this.traitBonuses = defaultBonuses();
    this.reputation = new Reputation(this);
    // (Phase 3) King identity comes from GameWorld now (the continent owns it),
    // falling back to legacy localStorage so a direct boot still has a name. The
    // king-creation-on-boot flow is removed — creation happens before ContinentScene.
    let king: any = GameWorld.king || null;
    if (!king) { try { king = JSON.parse(localStorage.getItem('kg_king')); } catch (e) {} }
    this.kingdomName = (king && king.kingdom) || 'Your Kingdom';
    this.rulerName = (king && (king.ruler || king.king)) || 'The King';
    this.kingTrait = (king && king.trait) || null;
    if (this.kingTrait) this.applyTraitBonuses(this.kingTrait);
    this.armyMgr = this._inertArmyMgr(); // (Phase 3) on-map continent armies disabled in the local view
    this.worldEvents = new WorldEvents(this); // (Expansion Phase 3) events + messenger
    this.research = new Research(this); // (Expansion Phase 5) research tree
    this.winConditions = new WinConditions(this); // (Audit FIX 2) victory paths
    this._eventLog = this._eventLog || [];
    this.panelMode = 'none'; // (Phase 3) K&C: no panel open by default — map fills the screen

    // (Phase 5) Expedition rewards: special resources + permanent artifact buffs.
    this.buffs = { warriorDamage: 1, troopSpeed: 1, monkHeal: 1, farmBonusPerDay: 0, mineBonusPerDay: 0 };
    this.artifacts = []; // owned artifact keys
    this.scrolls = 0;
    this.intelUntilDay = 0; // scouting reveals enemy army size until this day
    this.ARTIFACT_DEFS = [
      { key: 'whetstone', name: 'Ancient Whetstone', desc: 'Warriors deal +20% damage', apply: (s) => (s.buffs.warriorDamage *= 1.2) },
      { key: 'almanac', name: "Farmer's Almanac", desc: 'Farms produce +1 Wheat/day', apply: (s) => (s.buffs.farmBonusPerDay += 1) },
      { key: 'compass', name: "Miner's Compass", desc: 'Mine produces +1 Stone/day', apply: (s) => (s.buffs.mineBonusPerDay += 1) },
      { key: 'wardrum', name: 'War Drum', desc: 'All troops move 20% faster', apply: (s) => (s.buffs.troopSpeed *= 1.2) },
      { key: 'tome', name: "Healer's Tome", desc: 'Monks heal 50% more HP/sec', apply: (s) => (s.buffs.monkHeal *= 1.5) },
    ];

    // (Assets Phase 8) Generate the ENTIRE game's art before anything uses it.
    // Order matters only in that this must precede createAnimations()/drawGrid().
    AssetGenerator.generateAll(this);
    this.sliceBuildingTextures(); // legacy slice/alias calls now early-return (keys exist)
    this.createAnimations();
    this.drawGrid();
    this.scatterDecorations();
    this.nodes.spawnInitial();
    // (Phase 4 Decision 3) early-game stone near the castle is added after the
    // castle is placed (see spawnStartStone call below).
    this.makeSkyGrade();
    this.makeVignette();
    this.createDayNightOverlay();
    this.createWeather(); // (Polish Phase 4) snow / rain particles
    this.ensureFxTextures(); // (Visual P7) generate-once particle pixels for world VFX

    this.buildings.place('castle', Math.floor(N / 2), Math.floor(N / 2));
    this.decorateBuilding(this.buildings.castle);
    this.spawnStartStone(); // (Phase 4 Decision 3) early-game stone near the castle

    this.buildHud();
    this.createDayCounter();
    this.createIronHud(); // UI overhaul: chip-based resource bar (hides old day counter)
    this.createPopulationHud(); // (Expansion Phase 5) population + happiness indicator
    this.createKingdomNameHud(); // (Expansion Phase 4) kingdom name + reputation title
    this.createCastleBar();
    // Lift the castle HP bar above the (now larger) iso keep.
    const cb = this.buildings.castle;
    const cy = cb.y - cb.baseScale * 48;
    this.castleBarBg.y = cy;
    this.castleBarFill.y = cy;

    // ====================================================================
    // (Phase 3) WORLD-SCALE SYSTEMS — DISABLED in the per-settlement view.
    // ====================================================================
    // These belong to the CONTINENT (ContinentScene + GameWorld) now, not to a
    // single settlement. Several would also crash at the new 40×40 local size:
    //   * AIKingdom/FACTIONS hard-code castle tiles at col/row 185 (out of bounds
    //     at N=40) and run on-map enemy kingdoms — that is continent strategy.
    //   * WaveManager / WanderingFactions / Caravans / SettlementManager /
    //     GoblinCamps / ArmyManager all assume the 200×200 continent.
    //   * Diplomacy / GreatCouncil / Espionage / Narrative / Succession etc. are
    //     campaign/late-game concerns (Phases 6-8), not the local town view.
    // We replace them with inert stubs so every later call (update(), HUD,
    // panels) is a harmless no-op and the scene boots clean. Re-homing these to
    // the continent is future work for Phases 5-8.
    this.waveCoord = { holder: null, cooldown: 0 };
    this.ai = null;
    this.kingdoms = [];                       // no AI kingdoms on a local map
    this.DAY_SECONDS = DAY_MS / 1000;
    // (Phase 4 Pioneer) Specialty production bonus: a founded colony's biome-derived
    // specialty grants +25% output of its matching raw resource. Stored as a map
    // resource->multiplier that Buildings.produce() reads (like _seasonFarmMult).
    this._specialtyMult = {};
    if (this._settle && this._settle.specialtyResource) {
      this._specialtyMult[this._settle.specialtyResource] = 1.25;
    }
    this.diplomacy = this._inertSystem();     // continent-scale (P6)
    this.leaders = this._inertSystem();       // continent-scale (P6)
    this.heroes = this._inertSystem();        // hero system (P6)
    this.maintenance = this._inertSystem();   // building aging/disasters (P7 local later)
    this._plagueMult = 1;
    this.court = this._inertSystem();         // advisors (P7)
    this.succession = this._inertSystem();    // succession (P8)
    this.espionage = this._inertSystem();     // spy network (P6)
    this.narrative = this._inertSystem();     // story arc (P8)
    this.weatherSys = this._inertSystem();    // weather gameplay (keep visuals only)
    this.popClasses = this._inertSystem();    // social classes (later)
    this.banking = this._inertSystem();       // treasury/loans (campaign-scale)
    this.greatCouncil = { held: false, update() {} }; // buildingUnlocked() reads .held
    this.roads = this._inertSystem();         // player roads (continent-scale)
    this.caravans = this._inertSystem();      // trade routes (continent-scale, P5)
    this.settlements = this._inertSettlements(); // neutral settlements are on the continent now
    this.goblinCamps = this._inertSettlements(); // goblin camps are on the continent now
    this.factions = this._inertSystem();      // wandering factions (continent-scale)
    this.discovery = this._inertSystem();     // location histories (continent-scale)
    // KEPT per-settlement subsystems: Territory (local fog/reveal) + Ruins are
    // bounded to the local grid and safe at N=40.
    this.territory = new Territory(this); // Phase 4: local territory + fog of war
    this.ruins = this._inertSystem();     // ancient ruins are a continent feature now
    this.createFogOverlay(); // (BUG 7) opaque fog above world objects
    if (this.taxIndex == null) this.taxIndex = 1; this.applyTax(); // (Session-1 Phase 5) tax system
    // (Phase 7) Reveal a generous 20-tile starting radius around the castle.
    if (this.buildings.castle) this.revealAround(this.buildings.castle.col, this.buildings.castle.row, 20);
    this.setupInput();
    this.setupCamera();
    this.createMinimap();
    this.createKingdomsButton(); // Phase 6: open the kingdom status panel
    this.sfx = sfx; // expose for debugging / systems
    this.createSoundControl(); // (Polish Phase 2) master volume / mute
    // Browsers start the audio context suspended; unlock on the first gesture.
    this.input.once('pointerdown', () => sfx.unlock());
    this.input.keyboard.once('keydown', () => sfx.unlock());
    this.wildlife.spawnInitial(); // Phase 2: wildlife present from day 1
    this.createNPCs(); // Phase 8: decorative villagers
    this.refreshPanel();
    this.updateWeather(); // (Polish Phase 4) apply weather for the starting season

    if (this._startZoom) this.cameras.main.setZoom(Phaser.Math.Clamp(this._startZoom, 0.3, 2));
    // (Phase 3) King-creation-on-boot REMOVED — the king is chosen before the
    // continent loads. No welcome/tutorial modal on settlement entry either; the
    // player drops straight into the local town view.

    this.setupUICamera();

    // (Phase 3) Build the per-settlement HUD top bar + Leave button, restore any
    // saved buildings/tasks for THIS settlement, and start the local time ticker.
    this.buildSettlementHud();
    this.createLeaveButton();
    this.restoreSettlementState();
    this.startSettlementTime();

    // (Phase 3) TAB no longer opens a continent overlay on top — the continent is
    // a separate scene the player returns to via "Leave Settlement".
    // (Gameplay change 2) Escape cancels move/placement mode (or closes the menu).
    this.input.keyboard.on('keydown-ESC', () => {
      if (this._menuOpen) this.closeMenu();
      else if (this._roadMode) { this._roadMode = false; this._roadStart = null; this.showToast && this.showToast('Road cancelled'); }
      else if (this.movingBuilding) this.cancelMoveBuilding();
      else if (this.placementType) { this.placementType = null; this.clearGhost(); this.refreshPanel(); }
    });

    // (Save system) Menu button + shortcuts + auto-save infrastructure.
    this.gamePlayMs = this.gamePlayMs || 0;
    this._autoSaveEveryDays = 5;
    this.createMenuButton();
    this.createLogButton();   // (Expansion Phase 7) notifications log
    this.createStatsButton(); // (Session-1 Phase 6) statistics panel
    this.createPauseButton(); // (Expansion Phase 7) pause control
    this.createPioneerButton(); // (Phase 4) Send Pioneer Party action
    this.setupHotkeys();      // (Expansion Phase 7) keyboard shortcuts
    this.input.keyboard.on('keydown-S', (e) => { if (this._typing) return; this.quickSave(); });
    // (Phase 3) The old beforeunload auto-save wrote the LEGACY single-scene save
    // format. That format is the continent's concern (and is being rewritten in
    // Phase 12), so we no longer auto-save the old format on unload from the local
    // view. Per-settlement state is persisted into GameWorld on Leave instead.

    // (Visual P7) Catch heroes that join via an event popup mid-day (not just on
    // the daily tick). this.time events are auto-cleared on scene shutdown.
    this.time.addEvent({ delay: 1500, loop: true, callback: () => this.checkHeroFx() });

    // (Phase 3) Legacy pending-load reconstruction REMOVED here — loading a saved
    // campaign is handled by the continent + GameWorld (Phase 12 SaveManager).
  }

  // ====================================================================
  // (Phase 3) INERT SYSTEM STUBS — for world-scale subsystems disabled in the
  // per-settlement view. A Proxy answers ANY property access with a polymorphic
  // stub that is callable (every method → no-op), array-like (every method also
  // returns []/0 via valueOf), and yields an empty array when iterated. This lets
  // legacy update()/HUD/panel code call e.g. settlements.threats() / .update() /
  // .list / .total() without throwing, returning harmless empties. Cheap and
  // future-proof: re-homing these to the continent (P5-8) just replaces the stub.
  // ====================================================================
  _inertSystem(): any {
    const noop: any = () => [];
    // Property names that legacy code reads WITHOUT calling (and then iterates /
    // filters / .length) — these must answer with a real empty array.
    const ARRAY_PROPS = new Set(['list', 'units', 'enemies', 'pawns', 'tribes', 'fires', 'roster', 'sites', 'armies', 'buildings', 'available']);
    const handler: ProxyHandler<any> = {
      get(_t, prop) {
        if (prop === Symbol.iterator) return function* () { /* empty */ };
        if (prop === 'length') return 0;
        if (prop === 'then') return undefined; // never look thenable to await
        if (prop === 'valueOf') return () => 0;
        if (prop === 'toString') return () => '';
        if (typeof prop === 'string' && ARRAY_PROPS.has(prop)) return [];
        return new Proxy(noop, handler);
      },
      apply() { return new Proxy(noop, handler); },
    };
    return new Proxy(noop, handler);
  }

  // Neutral settlements + goblin camps are continent features now; provide a stub
  // with the exact numeric/array contract the HUD + update loop expect locally.
  _inertSettlements(): any {
    return {
      update() {}, collectDaily() {}, applyDepths() {},
      threats: () => [],
      // `list` is read as a PROPERTY (iterated/filtered) in several places, so it
      // must be an array, not a method.
      list: [],
      ownedCount: () => 0, total: () => 0,
      // (Phase 4) Wildlife.spawnGoblinRaid() asks goblinCamps.nearestAliveTo();
      // goblin camps live on the CONTINENT now, so the local stub returns null
      // (the raid code already falls back to a region point) — without this the
      // first in-settlement goblin raid threw a console error.
      nearestAliveTo: () => null,
    };
  }

  // The on-map continent army manager is disabled in the local view. soldierTotal()
  // and HUD code do arithmetic on its returns, so it needs a TYPED stub (numbers /
  // empty arrays), not the generic Proxy (whose returns can't coerce to a number).
  _inertArmyMgr(): any {
    return {
      armies: [], selected: null, maxPlayerArmies: 0,
      update() {}, onNewDay() {},
      playerArmies: () => [], aiArmies: () => [], aiArmiesFor: () => [],
      availableUnits: () => 0, totalUnits: () => 0, etaDays: () => 0,
      formArmy() {}, marchTo() {}, stopMarch() {}, selectArmy() {}, disband() {},
      removeArmy() {}, spawnAIArmy() {}, setUnitsFromBattle() {}, addMorale() {},
    };
  }

  // ====================================================================
  // (Phase 3) PER-SETTLEMENT HUD, ENTER/LEAVE & STATE PERSISTENCE
  // ====================================================================

  // Top context bar: LEFT settlement name + tier + faction, CENTER local
  // resources, RIGHT Day X (from GameWorld) + "You are in [Name]". Drawn above
  // the existing HUD; routed to the UI camera so it never zooms/pans.
  buildSettlementHud() {
    const fix = (o: any) => o.setScrollFactor(0);
    const D = 210; // above the legacy top bar (≤200) but below modals
    const st = this._settle;
    const name = st ? st.name : 'Settlement';
    const faction = st ? st.faction : 'player';
    // A slim parchment strip across the very top.
    this._sBarBg = fix(this.add.rectangle(0, 0, GAME_W, 26, 0x241a0e, 0.92).setOrigin(0, 0).setDepth(D));
    this._sBarLine = fix(this.add.rectangle(0, 26, GAME_W, 2, 0xc9a14a, 0.7).setOrigin(0, 0).setDepth(D));
    this._sBarLeft = fix(this.add.text(12, 5, '', {
      fontFamily: 'Georgia, serif', fontSize: '13px', color: '#ffe9b0', fontStyle: 'bold',
    }).setDepth(D + 1));
    this._sBarCenter = fix(this.add.text(GAME_W / 2, 5, '', {
      fontFamily: 'Georgia, serif', fontSize: '13px', color: '#f0e6d0',
    }).setOrigin(0.5, 0).setDepth(D + 1));
    this._sBarRight = fix(this.add.text(GAME_W - 150, 5, '', {
      fontFamily: 'Georgia, serif', fontSize: '13px', color: '#f0e6d0',
    }).setOrigin(1, 0).setDepth(D + 1));
    // A reusable notification banner (centre, just under the bar).
    this._sNote = fix(this.add.text(GAME_W / 2, 40, '', {
      fontFamily: 'Georgia, serif', fontSize: '16px', color: '#fff', fontStyle: 'bold',
      backgroundColor: '#6b4a26dd', padding: { x: 14, y: 7 }, align: 'center',
    }).setOrigin(0.5, 0).setDepth(D + 5).setVisible(false));
    this._sBarLeftStatic = `${name}  ·  ${this.factionLabel(faction)}`;
    this.updateSettlementHud();
    this.routeCameras && this.routeCameras();
  }

  factionLabel(faction: string): string {
    if (faction === 'player') return 'Your realm';
    if (faction === 'neutral' || !faction) return 'Free town';
    return faction.charAt(0).toUpperCase() + faction.slice(1);
  }

  updateSettlementHud() {
    if (!this._sBarLeft) return;
    const tierName = (this.TIERS[this.tierIndex] && this.TIERS[this.tierIndex].name) || 'Village';
    this._sBarLeft.setText(`${this._sBarLeftStatic}  ·  ${tierName}`);
    const r = this.resources;
    this._sBarCenter.setText(`Wood ${fmtNum(r.wood)}   Stone ${fmtNum(r.stone)}   Food ${fmtNum(r.food)}   Iron ${fmtNum(r.iron || 0)}   Gold ${fmtNum(GameWorld.gold)}`);
    const nm = this._settle ? this._settle.name : 'this place';
    this._sBarRight.setText(`Day ${GameWorld.displayDay()}   ·   You are in ${ellipsize(nm, 16)}`);
  }

  // Persistent "Leave Settlement" button, top-right (left of the Menu button).
  createLeaveButton() {
    const fix = (o: any) => o.setScrollFactor(0);
    const D = 212;
    const w = 150, h = 28, x = GAME_W - 46 - w - 8, y = 30;
    const bg = fix(this.add.rectangle(x, y, w, h, 0x6b3a26, 0.95).setOrigin(0, 0).setDepth(D).setStrokeStyle(2, 0xe9d6a4, 0.9).setInteractive({ useHandCursor: true }));
    const txt = fix(this.add.text(x + w / 2, y + h / 2, 'Leave Settlement', { fontFamily: 'Georgia, serif', fontSize: '13px', color: '#f5ecd2', fontStyle: 'bold' }).setOrigin(0.5).setDepth(D + 1));
    bg.on('pointerover', () => bg.setFillStyle(0x8a4a2f));
    bg.on('pointerout', () => bg.setFillStyle(0x6b3a26));
    bg.on('pointerup', () => this.confirmLeave());
    this._leaveBtn = bg; this._leaveTxt = txt;
    this.routeCameras && this.routeCameras();
  }

  // (Phase 4) "Send Pioneer Party" — only for player-owned settlements. Sits just
  // below the Leave button, top-right. Opens a confirm modal showing the cost
  // (10 workers + 200 wood + 100 stone, keep >=5 workers) before dispatching.
  createPioneerButton() {
    if (!this._settle || this._settle.faction !== 'player') return; // player towns only
    const fix = (o: any) => o.setScrollFactor(0);
    const D = 212;
    const w = 158, h = 26, x = GAME_W - 46 - w - 8, y = 62;
    const bg = fix(this.add.rectangle(x, y, w, h, 0x2f5b3a, 0.95).setOrigin(0, 0).setDepth(D).setStrokeStyle(2, 0xe9d6a4, 0.9).setInteractive({ useHandCursor: true }));
    const txt = fix(this.add.text(x + w / 2, y + h / 2, '⚑ Send Pioneer Party', { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#f5ecd2', fontStyle: 'bold' }).setOrigin(0.5).setDepth(D + 1));
    bg.on('pointerover', () => bg.setFillStyle(0x3a7049));
    bg.on('pointerout', () => bg.setFillStyle(0x2f5b3a));
    bg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); });
    bg.on('pointerup', () => this.confirmSendPioneer());
    this._pioneerBtn = bg; this._pioneerBtnTxt = txt;
    this.routeCameras && this.routeCameras();
  }

  // Confirm dialog → sendPioneer(). Shows cost + requirement status; on confirm,
  // deducts costs (mirrored from the live scene into the SettlementState first so
  // PioneerSystem reads the up-to-date stockpile), spawns the party on the
  // continent at this settlement, and returns the player to the continent to guide
  // it. (The player may keep building here; the pioneer travels in real time.)
  confirmSendPioneer() {
    if (this._pioneerModal || this._leaving) return;
    // Mirror live resources/population into the persisted state so the cost check
    // and deduction see current values (saveSettlementState normally does this on
    // Leave; we do a focused sync here).
    this.syncSettlementForPioneer();
    const sys = PioneerSystemRef;
    const st = this._settle;
    const haveWorkers = Math.max(st.workers || 0, st.population || 0);
    const haveWood = st.resources.wood || 0;
    const haveStone = st.resources.stone || 0;
    const okWorkers = haveWorkers - sys.PIONEER_WORKER_COST >= sys.PIONEER_MIN_REMAIN;
    const okWood = haveWood >= sys.PIONEER_WOOD_COST;
    const okStone = haveStone >= sys.PIONEER_STONE_COST;
    const canSend = okWorkers && okWood && okStone;

    const fix = (o: any) => o.setScrollFactor(0).setDepth(400);
    const els: any[] = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 0.6).setOrigin(0, 0).setInteractive()));
    const W = 440, H = 230, x = (GAME_W - W) / 2, y = (GAME_H - H) / 2;
    els.push(fix(this.add.rectangle(x, y, W, H, 0x1a1410, 0.99).setOrigin(0, 0).setStrokeStyle(3, 0xc9a14a, 0.9)));
    els.push(fix(this.add.text(GAME_W / 2, y + 18, 'Send Pioneer Party', { fontFamily: 'Georgia, serif', fontSize: '19px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0)));
    els.push(fix(this.add.text(GAME_W / 2, y + 48, 'Send colonists to found a new settlement on the continent.', { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#cfc1a6', align: 'center', wordWrap: { width: W - 40 } }).setOrigin(0.5, 0)));

    const row = (i: number, label: string, ok: boolean, have: string) => {
      const ry = y + 78 + i * 22;
      els.push(fix(this.add.text(x + 30, ry, (ok ? '✓ ' : '✗ ') + label, { fontFamily: 'Georgia, serif', fontSize: '13px', color: ok ? '#9fe6a4' : '#ff9a9a' })));
      els.push(fix(this.add.text(x + W - 30, ry, have, { fontFamily: 'Georgia, serif', fontSize: '13px', color: '#cfc1a6' }).setOrigin(1, 0)));
    };
    row(0, `${sys.PIONEER_WORKER_COST} population (keep ${sys.PIONEER_MIN_REMAIN})`, okWorkers, `have ${Math.floor(haveWorkers)}`);
    row(1, `${sys.PIONEER_WOOD_COST} wood`, okWood, `have ${Math.floor(haveWood)}`);
    row(2, `${sys.PIONEER_STONE_COST} stone`, okStone, `have ${Math.floor(haveStone)}`);

    const send = fix(this.add.rectangle(x + W / 2 - 100, y + H - 38, 170, 34, canSend ? 0x1f5b3a : 0x39393f).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: canSend }));
    els.push(send, fix(this.add.text(x + W / 2 - 100, y + H - 38, 'Send', { fontFamily: 'Georgia, serif', fontSize: '14px', color: canSend ? '#fff' : '#888', fontStyle: 'bold' }).setOrigin(0.5)));
    const cancel = fix(this.add.rectangle(x + W / 2 + 100, y + H - 38, 170, 34, 0x6b3a26).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
    els.push(cancel, fix(this.add.text(x + W / 2 + 100, y + H - 38, 'Cancel', { fontFamily: 'Georgia, serif', fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));

    const close = () => { els.forEach(o => o.destroy()); this._pioneerModal = null; };
    this._pioneerModal = close;
    cancel.on('pointerup', () => close());
    send.on('pointerup', () => {
      if (!canSend) return;
      close();
      this.dispatchPioneer();
    });
    this.routeCameras && this.routeCameras();
  }

  // Push the live scene's resources/population into the SettlementState so the
  // PioneerSystem cost check + deduction operate on current values.
  syncSettlementForPioneer() {
    const st = this._settle;
    if (!st || !this.resources) return;
    st.resources = st.resources || { wood: 0, stone: 0, food: 0, iron: 0 };
    st.resources.wood = Math.round(this.resources.wood);
    st.resources.stone = Math.round(this.resources.stone);
    st.resources.food = Math.round(this.resources.food);
    st.resources.iron = Math.round(this.resources.iron || 0);
    if (this.population) st.population = Math.round(this.population.count || st.population);
    st.workers = this.buildings ? this.buildings.workersUsed() : (st.workers || 0);
  }

  // Deduct via PioneerSystem, spawn the party at this settlement, mirror the new
  // (reduced) stockpile back into the LIVE scene, notify, then return to the
  // continent so the player can guide the pioneers to their founding site.
  dispatchPioneer() {
    const st = this._settle;
    if (!st) return;
    // Choose a default founding destination a moderate distance from this town on
    // passable ground (the player re-guides on the continent). Falls back to the
    // settlement tile if nothing better is found (still valid to re-guide later).
    const dest = this.pickDefaultPioneerDest();
    const res = PioneerSystemRef.sendPioneer(this._settlementId, dest.col, dest.row);
    if (!res.ok) { this.notify(res.reason || 'Cannot send pioneers.', 0x8c2b2b); return; }
    // Mirror the reduced stockpile/population back into the LIVE scene so the HUD
    // and economy reflect the cost immediately.
    this.resources.wood = st.resources.wood;
    this.resources.stone = st.resources.stone;
    if (this.population && typeof st.population === 'number') this.population.count = st.population;
    this.updateSettlementHud && this.updateSettlementHud();
    this.notify('Pioneer party dispatched — guide them on the continent!', 0x2a7a4f);
    if (this.logEvent) this.logEvent('Sent a pioneer party to found a new settlement', 'info');
    // Return to the continent to guide the pioneers.
    this.time.delayedCall(500, () => { if (!this._leaving) this.leaveToContinent(); });
  }

  // Pick a default founding tile: scan a ring of candidate offsets around this
  // settlement for a passable tile that satisfies the founding rules; else just
  // aim a bit away (the player can re-guide). Uses GameWorld directly (the
  // continent biome map) since the local scene has no continent pathfinder.
  pickDefaultPioneerDest(): { col: number; row: number } {
    const s = GameWorld.settlementById(this._settlementId);
    const w = GameWorld.world;
    if (!s || !w) return { col: 10, row: 10 };
    const sys = PioneerSystemRef;
    // Spiral out in rings beyond the min-distance and look for a valid spot.
    for (let r = sys.FOUND_MIN_DISTANCE + 2; r <= 40; r += 3) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const c = Math.round(s.col + Math.cos(ang) * r);
        const rr = Math.round(s.row + Math.sin(ang) * r);
        if (sys.canFoundAt(c, rr).ok) return { col: c, row: rr };
      }
    }
    // Fallback: a passable tile ~18 away in +x, or the settlement itself.
    for (const dx of [18, -18, 0]) for (const dy of [0, 18, -18]) {
      const c = Math.max(0, Math.min(w.size - 1, s.col + dx));
      const rr = Math.max(0, Math.min(w.size - 1, s.row + dy));
      if (sys.isPassable(c, rr)) return { col: c, row: rr };
    }
    return { col: s.col, row: s.row };
  }

  // Confirm dialog → leaveToContinent().
  confirmLeave() {
    if (this._leaveModal) return;
    const fix = (o: any) => o.setScrollFactor(0).setDepth(400);
    const els: any[] = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 0.55).setOrigin(0, 0).setInteractive()));
    const W = 400, H = 150, x = (GAME_W - W) / 2, y = (GAME_H - H) / 2;
    els.push(fix(this.add.rectangle(x, y, W, H, 0x1a1410, 0.99).setOrigin(0, 0).setStrokeStyle(3, 0xc9a14a, 0.9)));
    els.push(fix(this.add.text(GAME_W / 2, y + 24, 'Leave this settlement?', { fontFamily: 'Georgia, serif', fontSize: '18px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0)));
    els.push(fix(this.add.text(GAME_W / 2, y + 56, 'You will return to the continent at this location.', { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#cfc1a6' }).setOrigin(0.5, 0)));
    const yes = fix(this.add.rectangle(x + W / 2 - 95, y + H - 36, 160, 34, 0x6b3a26).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
    els.push(yes, fix(this.add.text(x + W / 2 - 95, y + H - 36, 'Leave', { fontFamily: 'Georgia, serif', fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));
    const no = fix(this.add.rectangle(x + W / 2 + 95, y + H - 36, 160, 34, 0x2f5b3a).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
    els.push(no, fix(this.add.text(x + W / 2 + 95, y + H - 36, 'Stay', { fontFamily: 'Georgia, serif', fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));
    const close = () => { els.forEach(o => o.destroy()); this._leaveModal = null; };
    this._leaveModal = close;
    no.on('pointerup', () => close());
    yes.on('pointerup', () => { close(); this.leaveToContinent(); });
    this.routeCameras && this.routeCameras();
  }

  // Save state, fade out, return to ContinentScene at this settlement's tile.
  leaveToContinent() {
    if (this._leaving) return;
    this._leaving = true;
    this.saveSettlementState();
    // Drop the player party onto the continent at this settlement's location.
    const s = GameWorld.settlementById(this._settlementId);
    if (s) { GameWorld.player.col = s.col; GameWorld.player.row = s.row; }
    GameWorld.currentSettlementId = null;
    this.cameras.main.fadeOut(280, 0, 0, 0);
    const finish = () => {
      if (this._left) return; // guard against double-fire (fade event + fallback)
      this._left = true;
      // ContinentScene was SLEPT on entry; wake it (resume() is for paused scenes).
      if (this.scene.isSleeping('ContinentScene')) this.scene.wake('ContinentScene');
      else if (this.scene.isPaused('ContinentScene')) this.scene.resume('ContinentScene');
      else if (!this.scene.isActive('ContinentScene')) this.scene.launch('ContinentScene');
      // Stop ourselves LAST so create() runs fresh on the next entry.
      this.scene.stop();
    };
    // Run on the camera-fade callback, with a delayedCall fallback in case the
    // fade is interrupted (e.g. the scene is paused during the fade).
    this.cameras.main.once('camerafadeoutcomplete', finish);
    this.time.delayedCall(360, finish);
  }

  // Mirror the live scene's buildings/resources/tier back into the persisted
  // SettlementState so the next visit resumes exactly where the player left off.
  saveSettlementState() {
    const st = this._settle;
    if (!st) return;
    st.tier = this.tierIndex;
    st.workers = this.buildings ? this.buildings.workersUsed() : 0;
    st.workerCap = this.resources ? this.resources.workersCap : st.workerCap;
    st.population = this.population ? Math.round(this.population.count || st.population) : st.population;
    st.happiness = this.population ? Math.round(this.population.happiness ?? st.happiness) : st.happiness;
    st.resources = {
      wood: Math.round(this.resources.wood), stone: Math.round(this.resources.stone),
      food: Math.round(this.resources.food), iron: Math.round(this.resources.iron || 0),
    };
    // Persist buildings (skip the castle — it is always re-placed at centre).
    st.buildings = [];
    st.tasks = [];
    for (const b of this.buildings.buildings) {
      if (!b.alive || b.typeKey === 'castle') continue;
      st.buildings.push({ typeKey: b.typeKey, col: b.col, row: b.row, level: b.level || 1, workers: b.workers || 0 });
      // Resume any in-progress training slots on a barracks.
      if (b.slots && b.slots.length) {
        for (const slot of b.slots) st.tasks.push({ kind: 'training', what: slot.type, col: b.col, row: b.row, timeLeft: slot.timeLeft });
      }
    }
    st.garrison = this.troops ? [{ type: 'warrior', count: this.troops.count || 0 }] : st.garrison;
    st.visited = true;
    st.lastVisitedDay = GameWorld.day;
  }

  // (Phase 11) Sync the live scene stockpile INTO this settlement's persisted
  // SettlementState.resources so GameWorld's monument/equipment cost checks (which
  // read the SettlementState) see current values. Mirrors the resource set the
  // home stockpile tracks (wood/stone/food/iron/planks/cutStone).
  flushResourcesToWorld() {
    const st = this._settle; if (!st) return;
    const r = this.resources;
    st.resources.wood = Math.round(r.wood || 0);
    st.resources.stone = Math.round(r.stone || 0);
    st.resources.food = Math.round(r.food || 0);
    st.resources.iron = Math.round(r.iron || 0);
    st.resources.planks = Math.round(r.planks || 0);
    st.resources.cutStone = Math.round(r.cutStone || 0);
  }

  // (Phase 11) Pull the SettlementState stockpile back into the live scene economy
  // after a GameWorld-level spend (monument / equipment craft), so the on-screen
  // resource bar reflects what was just deducted.
  pullWorldResources() {
    const st = this._settle; if (!st) return;
    const r = this.resources;
    r.wood = st.resources.wood || 0;
    r.stone = st.resources.stone || 0;
    r.food = st.resources.food || 0;
    r.iron = st.resources.iron || 0;
    if (st.resources.planks != null) r.planks = st.resources.planks;
    if (st.resources.cutStone != null) r.cutStone = st.resources.cutStone;
  }

  // Restore saved buildings/resources/tier on entry (after the castle is placed).
  // First visit just keeps the defaults set by makeSettlementState.
  restoreSettlementState() {
    const st = this._settle;
    if (!st) return;
    // Seed local resources from the persisted stockpile. We apply this on any
    // revisit (st.visited) AND on the FIRST entry into a player-FOUNDED colony,
    // so the founding materials carried by the pioneer party (200 wood / 100
    // stone, deposited into the SettlementState on founding) are present in the
    // new camp instead of the generic Resources() defaults.
    if ((st.visited || st.founded) && st.resources) {
      this.resources.wood = st.resources.wood;
      this.resources.stone = st.resources.stone;
      this.resources.food = st.resources.food;
      this.resources.iron = st.resources.iron || 0;
    }
    this.tierIndex = st.tier || 0;
    // Re-place persisted buildings at their saved positions (ignoreStage so a
    // resumed save is authoritative and never blocked by tier gating).
    for (const sb of (st.buildings || [])) {
      if (this.buildings.isOccupied(sb.col, sb.row)) continue;
      const b = this.buildings.place(sb.typeKey, sb.col, sb.row, { ignoreStage: true });
      if (b) {
        if (sb.level && sb.level > 1) b.level = sb.level;
        b.workers = sb.workers || 0;
        this.decorateBuilding(b);
      }
    }
    // Resume in-progress training tasks on the matching barracks.
    for (const t of (st.tasks || [])) {
      if (t.kind !== 'training') continue;
      const b = this.buildings.grid[t.row] && this.buildings.grid[t.row][t.col];
      if (b && b.slots) b.slots.push({ type: t.what, timeLeft: t.timeLeft });
    }
    // (Phase 11) Apply this settlement's INVEST flags to the live scene: the
    // Infrastructure +10% production multiplier the building producer reads, plus
    // the Population growth window (read by Population.onNewDay).
    this._investProdMult = GameWorld.investProductionMult(this._settlementId);
    this._investGrowthUntil = (this._settle && (this._settle as any).investGrowthUntil) || 0;
    this.refreshPanel && this.refreshPanel();
    this.updateSettlementHud();
  }

  // Start the local clock + production ticker and drain any pending notifications.
  startSettlementTime() {
    const st = this._settle;
    if (st) st.lastVisitedDay = GameWorld.day; // mark this visit
    // Local day display follows the GameWorld master clock.
    this.gameDay = GameWorld.displayDay();
    // Drain queued cross-world notifications so the player sees what happened.
    if (GameWorld.pendingNotifications && GameWorld.pendingNotifications.length) {
      const n = GameWorld.pendingNotifications.shift();
      if (n) this.notify(n.text, n.color);
    }
  }

  // (Phase 3 / hook for P5-7) Banner notification: "something happened" inside the
  // settlement. ContinentScene/GameWorld can push via GameWorld.notify(); we also
  // expose a static so other scenes can call IsometricScene.notify(...) when the
  // local view is active.
  notify(text: string, color: number = 0xc9a14a) {
    if (!this._sNote) return;
    const hex = '#' + (color & 0xffffff).toString(16).padStart(6, '0') + 'dd';
    this._sNote.setText(text).setBackgroundColor(hex).setVisible(true).setAlpha(1);
    this.tweens.killTweensOf(this._sNote);
    this.tweens.add({ targets: this._sNote, alpha: 0, delay: 2600, duration: 700, onComplete: () => this._sNote.setVisible(false) });
  }

  // Static convenience: route a notification to the live per-settlement view if
  // it is the active scene (otherwise it is queued in GameWorld for next entry).
  static notify(game: any, text: string, color: number = 0xc9a14a) {
    try {
      const s = game && game.scene && game.scene.keys && game.scene.keys.IsometricScene;
      if (s && s.scene && s.scene.isActive() && s.notify) { s.notify(text, color); return; }
    } catch (e) { /* fall through to queue */ }
    GameWorld.notify(text, color);
  }

  // (Polish Phase 10) Wrap an existing scene launch with a brief, skippable
  // loading card. The `doLaunch` closure is the EXACT original launch+pause logic
  // — semantics are unchanged; we only paint a card over the world first and run
  // the launch at the card's midpoint. The card lives on this (about-to-pause)
  // scene, so its fade-out timer won't fire while paused; instead we clean it up
  // on the next RESUME (when the target scene closes). Fully leak-safe: a one-shot
  // RESUME handler plus the overlay's own SHUTDOWN/DESTROY teardown.
  _launchWithTransition(title: string, subtitle: string, tint: number, doLaunch: () => void) {
    let launched = false;
    const fire = () => { if (launched) return; launched = true; try { doLaunch(); } catch (e) { try { this.scene.resume(); } catch (e2) {} } };
    let handle: any = null;
    const onResume = () => { try { handle && handle.cleanup(); } catch (e) {} };
    this.events.once(Phaser.Scenes.Events.RESUME, onResume);
    handle = showTransition(this, { title, subtitle, tint, hold: 850, onMid: fire });
  }

  // (Phase 3) The continent is now a SEPARATE scene we sleep on entry, not an
  // overlay launched on top. openContinent() therefore just leaves the settlement
  // (with confirm) — the old launch-on-top path would duplicate the slept scene.
  openContinent() {
    if (this.isGameOver || this._menuOpen) return;
    this.confirmLeave();
  }

  // ---- BUG 1 FIX: dedicated UI camera that never zooms/pans -----------------
  // scrollFactor(0) fixes an object against camera SCROLL, but the main camera's
  // ZOOM still scales it. So the HUD is rendered by a separate uiCamera (zoom 1,
  // no scroll): the main camera ignores all screen-fixed (scrollFactor 0) objects
  // and the uiCamera ignores all world objects. routeCameras() assigns each object
  // to exactly one camera (read after its scrollFactor has been set).
  setupUICamera() {
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCamera.setScroll(0, 0);
    this.routeCameras();
  }

  routeCameras() {
    if (!this.uiCamera) return;
    const main = this.cameras.main;
    const ui = this.uiCamera;
    const list = this.children.list;
    for (let i = 0; i < list.length; i++) {
      const obj: any = list[i];
      if (obj._camRouted) continue;
      obj._camRouted = true;
      if (obj.scrollFactorX === 0) main.ignore(obj); // HUD -> uiCamera only
      else ui.ignore(obj); // world -> main camera only
    }
  }

  // The game-over overlay is built here, but update() returns early once game
  // over, so route its (screen-fixed) elements to the uiCamera immediately —
  // otherwise the main camera also renders them, zoomed (BUG 1 regression).
  // (BUG 1) Soldiers in player armies also count toward the cap, so forming an
  // army no longer frees capacity to over-train.
  armySoldierCount() {
    if (!this.armyMgr) return 0;
    return this.armyMgr.playerArmies().reduce((s, a) => s + this.armyMgr.totalUnits(a), 0);
  }
  soldierTotal() { return super.soldierTotal() + this.armySoldierCount(); }
  soldierRoom() { return Math.max(0, this.soldierCap() - this.soldierTotal()); } // free capacity

  triggerGameOver() {
    if (this.isGameOver) return;
    this.isGameOver = true; // (Audit FIX 2) richer defeat screen replaces the minimal one
    this.showEndScreen(false, 'Your castle has fallen');
    this.routeCameras();
  }

  // (Session-1 Phase 5) Tax system: trades gold income against happiness.
  taxLevels() { return [
    { name: 'Low', gold: 0.7, happy: 10 },
    { name: 'Normal', gold: 1, happy: 0 },
    { name: 'High', gold: 1.3, happy: -15 },
    { name: 'Extortionate', gold: 1.6, happy: -40 },
  ]; }
  applyTax() {
    const t = this.taxLevels()[this.taxIndex != null ? this.taxIndex : 1];
    this._goldTaxMult = t.gold; this._taxHappiness = t.happy;
    this.updateTaxIndicator();
  }
  setTax(i) { this.taxIndex = Phaser.Math.Clamp(i, 0, 3); this.applyTax(); this.refreshPanel(); }
  updateTaxIndicator() {
    const t = this.taxLevels()[this.taxIndex != null ? this.taxIndex : 1];
    const pct = Math.round((t.gold - 1) * 100);
    const txt = `Tax: ${pct > 0 ? '+' : ''}${pct}%`;
    const col = pct > 0 ? '#ffd24a' : pct < 0 ? '#9ad0ff' : '#cfc1a6';
    if (!this._taxText) this._taxText = this.add.text(204, 40, '', { fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setScrollFactor(0).setDepth(60);
    this._taxText.setText(txt).setColor(col);
  }
  checkTaxRevolt() {
    const t = this.taxLevels()[this.taxIndex != null ? this.taxIndex : 1];
    if (t.name === 'Extortionate' && this.population && this.population.happiness < 20) this._revoltDays = (this._revoltDays || 0) + 1;
    else this._revoltDays = 0;
    if (this._revoltDays >= 3) { this._revoltDays = 0; this.doTaxRevolt(); }
  }
  doTaxRevolt() {
    this._strikeUntil = this.gameDay + 1; // workers strike for a day
    if (this.troops) { this.troops.removeRandom && this.troops.removeRandom(); this.troops.removeRandom && this.troops.removeRandom(); } // 2 defect
    if (this.population) this.population.addTempMod('Tax revolt', -10, 3);
    this.setTax(2); // forced down to High
    this.worldEvents && this.worldEvents.pushNews('Tax Revolt! Your people have had enough.');
    this.showToast('Your tax collectors have been driven out. Taxes reduced to High.');
    this.logEvent && this.logEvent('Tax revolt — workers struck, 2 soldiers defected', 'red');
  }

  // (BUG 13) Discovery toasts slide in from the bottom-right, small and queued
  // (max 2 visible), auto-dismiss after 4s, never blocking the build/resource bars.
  showDiscovery(type, name, history) {
    this.logEvent && this.logEvent(`Discovered: ${name}`, 'gold');
    this._discQueue = this._discQueue || [];
    this._discActive = this._discActive || [];
    this._discQueue.push({ type, name, history });
    this._pumpDiscovery();
  }
  _pumpDiscovery() {
    this._discActive = (this._discActive || []).filter((d) => d.alive);
    while (this._discActive.length < 2 && this._discQueue.length) {
      const d = this._discQueue.shift();
      this._discActive.push(this._spawnDiscovery(d));
      this._relayoutDiscovery();
    }
  }
  _spawnDiscovery(d) {
    const fix = (o) => o.setScrollFactor(0).setDepth(96);
    const W = 200, H = 56, x = GAME_W + 10, y = 0; // y set by relayout
    const cont = this.add.container(x, y).setScrollFactor(0).setDepth(96);
    const LETTER = { settlement: 'S', ruin: 'R', camp: 'G', castle: 'K', biome: 'B', tribe: 'T' };
    const icon = { settlement: 0x8ab0e6, ruin: 0xffe066, camp: 0xcc4444, castle: 0xd6a4ff, biome: 0x66cc88, tribe: 0xe08a2a }[d.type] || 0xffffff;
    cont.add(this.add.rectangle(0, 0, W, H, 0x16120a, 0.95).setOrigin(0, 0).setStrokeStyle(1, 0xc9a14a, 0.6));
    cont.add(this.add.circle(16, H / 2, 9, icon, 0.9));
    cont.add(this.add.text(16, H / 2, LETTER[d.type] || '*', { fontFamily: 'monospace', fontSize: '11px', color: '#1a1a1a', fontStyle: 'bold' }).setOrigin(0.5));
    cont.add(this.add.text(32, 7, name7(d.name), { fontFamily: 'monospace', fontSize: '11px', color: '#ffe9b0', fontStyle: 'bold' }));
    cont.add(this.add.text(32, 22, d.history, { fontFamily: 'monospace', fontSize: '8px', color: '#e8e0cc', wordWrap: { width: W - 40 }, lineSpacing: 1 }));
    function name7(n) { return n.length > 24 ? n.slice(0, 23) + '…' : n; }
    const rec = { cont, alive: true };
    this.tweens.add({ targets: cont, x: GAME_W - W - 12, duration: 320, ease: 'Cubic.out' });
    this.time.delayedCall(4000, () => {
      this.tweens.add({ targets: cont, alpha: 0, x: GAME_W + 10, duration: 350, onComplete: () => { cont.destroy(); rec.alive = false; this._pumpDiscovery(); } });
    });
    this.routeCameras && this.routeCameras();
    return rec;
  }
  _relayoutDiscovery() {
    const baseY = this.PANEL_Y - 70;
    (this._discActive || []).forEach((d, i) => { if (d.alive) d.cont.y = baseY - i * 64; });
  }

  // (Audit FIX 2) Shared VICTORY / DEFEAT overlay with a stats panel.
  // victory=true → gold "VICTORY" + path name + Continue/New Game.
  // victory=false → red "DEFEAT" + reason + Try Again.
  gatherEndStats() {
    const wc = this.winConditions;
    const title = (this.reputation && this.reputation.title(this.kingdomName)) || (this.kingTrait && TRAITS[this.kingTrait] ? TRAITS[this.kingTrait].name : '—');
    return [
      ['Days survived', String(this.gameDay)],
      ['Battles won', String(this._battlesWon || 0)],
      ['Settlements controlled', wc ? `${wc.playerControlled()} / ${wc.totalSettlements()}` : '—'],
      ['Population reached', String(this.population ? this.population.count : 0)],
      ['Research completed', String(this.research ? this.research.completed.size : 0)],
      ['Kingdom title', title],
    ];
  }

  showEndScreen(victory, subtitle) {
    if (this._endScreenEls) return; // already showing
    this._speedBeforeEnd = this.gameSpeed;
    this.gameSpeed = 0; // freeze all timers
    const fix = (o) => o.setScrollFactor(0).setDepth(200);
    const els = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, victory ? 0x06140a : 0x140606, 0.82).setOrigin(0, 0).setInteractive()));
    // (Visual P6) A grand manuscript page behind the result — illuminated gold
    // for victory, scorched/burned for defeat.
    const mW = 660, mH = 520, mx = (GAME_W - mW) / 2, my = GAME_H / 2 - 250;
    if (victory) {
      els.push(fix(this.parchmentPanel(mx, my, mW, mH, { radius: 8, seed: 9001 })));
      // Illuminated gold double border.
      const gb = fix(this.add.graphics());
      gb.lineStyle(6, 0xc9a14a, 0.95).strokeRoundedRect(mx + 8, my + 8, mW - 16, mH - 16, 6);
      gb.lineStyle(2, 0xffe9a8, 0.9).strokeRoundedRect(mx + 16, my + 16, mW - 32, mH - 32, 4);
      els.push(gb);
      els.push(fix(this.candleGlow(mx + 40, my + 40, 70, 0xffe6a8)));
      els.push(fix(this.candleGlow(mx + mW - 40, my + 40, 70, 0xffe6a8)));
      els.push(fix(this.waxSeal(mx + mW / 2, my + mH - 36, 22, 0x8c2f24)));
    } else {
      // Burned document — scorched parchment with charred edges.
      els.push(fix(this.parchmentPanel(mx, my, mW, mH, { radius: 8, seed: 6006 })));
      const burn = fix(this.add.graphics());
      const rnd = this._pp_rng(13);
      // Char overlay + ragged blackened border.
      burn.fillStyle(0x1a0e08, 0.5).fillRoundedRect(mx, my, mW, mH, 8);
      burn.lineStyle(10, 0x140a06, 0.95).strokeRoundedRect(mx + 5, my + 5, mW - 10, mH - 10, 8);
      burn.fillStyle(0x0a0604, 0.9);
      for (let i = 0; i < 70; i++) { const a = (i / 70) * Math.PI * 2; const rr = (Math.min(mW, mH) / 2) * (0.92 + rnd() * 0.12); burn.fillCircle(mx + mW / 2 + Math.cos(a) * (mW / 2) * 0.99, my + mH / 2 + Math.sin(a) * (mH / 2) * 0.99, 6 + rnd() * 16); }
      // Ember glow specks along the edge.
      for (let i = 0; i < 24; i++) { const a = rnd() * Math.PI * 2; burn.fillStyle(rnd() > 0.5 ? 0xff7a2a : 0xffb347, 0.4 + rnd() * 0.4).fillCircle(mx + mW / 2 + Math.cos(a) * (mW / 2) * 0.93, my + mH / 2 + Math.sin(a) * (mH / 2) * 0.93, 1 + rnd() * 2); }
      els.push(burn);
    }
    els.push(fix(this.add.text(GAME_W / 2, GAME_H / 2 - 210, victory ? 'VICTORY' : 'DEFEAT', { fontFamily: 'monospace', fontSize: '72px', color: victory ? '#9a6b14' : '#e74c3c', fontStyle: 'bold', stroke: '#000', strokeThickness: 8 }).setOrigin(0.5)));
    els.push(fix(this.add.text(GAME_W / 2, GAME_H / 2 - 150, victory ? `${subtitle} Victory` : subtitle, { fontFamily: 'monospace', fontSize: '22px', color: victory ? '#7a5410' : '#ffb0a8', fontStyle: 'bold', stroke: victory ? '#fff3d6' : '#000', strokeThickness: victory ? 2 : 4 }).setOrigin(0.5)));
    els.push(fix(this.add.text(GAME_W / 2, GAME_H / 2 - 112, `The Kingdom of ${this.kingdomName} under ${this.rulerName}`, { fontFamily: 'monospace', fontSize: '14px', color: victory ? '#5a4a2a' : '#cfc1a6', fontStyle: victory ? 'bold' : 'normal' }).setOrigin(0.5)));
    // Stats panel.
    const stats = this.gatherEndStats();
    const pw = 460, ph = 30 + stats.length * 26, pxx = GAME_W / 2 - pw / 2, pyy = GAME_H / 2 - 80;
    els.push(fix(this.add.rectangle(pxx, pyy, pw, ph, 0x12101a, 0.96).setOrigin(0, 0).setStrokeStyle(2, victory ? 0xc9a14a : 0x8a2a2a, 0.9)));
    stats.forEach(([k, v], i) => {
      const ry = pyy + 16 + i * 26;
      els.push(fix(this.add.text(pxx + 18, ry, k, { fontFamily: 'monospace', fontSize: '14px', color: '#cfc1a6' }).setOrigin(0, 0.5)));
      els.push(fix(this.add.text(pxx + pw - 18, ry, v, { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(1, 0.5)));
    });
    // Buttons.
    const mkBtn = (cx, label, bg, onClick) => {
      const w = 200, h = 44, x = cx - w / 2, y = GAME_H / 2 + ph - 20;
      const b = fix(this.add.rectangle(x, y, w, h, bg).setOrigin(0, 0).setStrokeStyle(2, 0xf0e6c8, 0.9).setInteractive({ useHandCursor: true }));
      els.push(b);
      els.push(fix(this.add.text(x + w / 2, y + h / 2, label, { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5)));
      b.on('pointerover', () => b.setFillStyle(Phaser.Display.Color.IntegerToColor(bg).lighten(12).color));
      b.on('pointerout', () => b.setFillStyle(bg));
      b.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); sfx.play('button_click'); onClick(); });
    };
    if (victory) {
      mkBtn(GAME_W / 2 - 115, 'Continue Playing', 0x1f5b3a, () => this.dismissEndScreen());
      mkBtn(GAME_W / 2 + 115, 'Main Menu', 0x5c1a1a, () => this.toMainMenu());
    } else {
      mkBtn(GAME_W / 2 - 115, 'Try Again', 0x2d4a6b, () => this.scene.restart());
      mkBtn(GAME_W / 2 + 115, 'Main Menu', 0x5c1a1a, () => this.toMainMenu());
    }
    this._endScreenEls = els;
    this.routeCameras && this.routeCameras();
  }

  dismissEndScreen() {
    if (this._endScreenEls) { this._endScreenEls.forEach((o) => o.destroy()); this._endScreenEls = null; }
    this.gameSpeed = this._speedBeforeEnd != null ? this._speedBeforeEnd : 1; // resume
    this._speedBeforeEnd = null;
  }

  startNewGame() {
    try { for (let i = 0; i < 3; i++) SaveManager.deleteSlot(i); localStorage.removeItem('kg_king'); localStorage.removeItem('kg_tut'); } catch (e) {}
    this.scene.restart();
  }

  // (Improvement) Return to the main menu — the hub for New Kingdom / Continue /
  // Load. Stops any side scenes so the menu starts clean.
  toMainMenu() {
    try { SaveManager.clearPending && SaveManager.clearPending(); } catch (e) {}
    try { if (this.scene.isActive('ContinentScene')) this.scene.stop('ContinentScene'); } catch (e) {}
    try { if (this.scene.isActive('BattleScene')) this.scene.stop('BattleScene'); } catch (e) {}
    this.scene.start('MainMenuScene');
  }

  // Slice the "finished" frame out of each construction sheet into a standalone
  // texture keyed by building name (Buildings.js uses add.image(x, y, typeKey)).
  sliceBuildingTextures() {
    this.sliceFrame('village_sheet', 13, 'castle');
    this.sliceFrame('wooden_fort_sheet', 13, 'castle_town');
    this.sliceFrame('stone_fort_sheet', 13, 'castle_castle');
    this.sliceFrame('wooden_fort_sheet', 13, 'barracks');
    this.sliceFrame('wind_mill_sheet', 0, 'farm');
    // (Phase 2) New buildings reuse the closest existing iso art (tinted in
    // decorateBuilding to read as distinct structures).
    this.aliasBuilding('market', 'farm');
    this.aliasBuilding('blacksmith', 'mine');
    this.aliasBuilding('watchtower', 'tower');
    this.aliasBuilding('tavern', 'house');
    this.aliasBuilding('wall', 'iso_rock');
  }

  aliasBuilding(newKey, srcKey) {
    if (this.textures.exists(newKey) || !this.textures.exists(srcKey)) return;
    const src: any = this.textures.get(srcKey).getSourceImage();
    const ct = this.textures.createCanvas(newKey, src.width, src.height) as Phaser.Textures.CanvasTexture;
    ct.getContext().drawImage(src, 0, 0);
    ct.refresh();
  }

  sliceFrame(sheetKey, idx, newKey) {
    if (this.textures.exists(newKey)) return;
    const src: any = this.textures.get(sheetKey).getSourceImage();
    const ct = this.textures.createCanvas(newKey, 64, 64) as Phaser.Textures.CanvasTexture;
    ct.getContext().drawImage(src, idx * 64, 0, 64, 64, 0, 0, 64, 64);
    ct.refresh();
  }

  // Register the base animations (GameScene) plus the new wildlife (Phase 2) and
  // Purple/Yellow faction (Phase 6) loops. Frame counts match the Tiny Swords
  // format already used (idle = 8 frames, run = 6 frames).
  createAnimations() {
    super.createAnimations();
    registerUnitAnimations(this); // (Polish Phase 1) attack / shoot / heal / tool anims
    const mk = (key, end, rate) => {
      if (this.anims.exists(key)) return;
      this.anims.create({ key, frames: this.anims.generateFrameNumbers(key, { start: 0, end }), frameRate: rate, repeat: -1 });
    };
    mk('goblin_idle', 7, 8);
    mk('goblin_run', 5, 10);
    mk('boar_idle', 7, 6);
    mk('purple_warrior_idle', 7, 8);
    mk('purple_warrior_run', 5, 10);
    mk('yellow_warrior_idle', 7, 8);
    mk('yellow_warrior_run', 5, 10);
  }

  // ---- Isometric coordinates ----------------------------------------------

  // Top-left of a tile's 64x64 cell (used to lay the diamond floor seamlessly).
  tileTopLeft(col, row) {
    return { x: (col - row) * HW + OX, y: (col + row) * HH + OY };
  }

  // Anchor where things "stand" on a tile = centre of the diamond top surface.
  tileCenter(col, row) {
    return { x: (col - row) * HW + OX + HW, y: (col + row) * HH + OY + HH };
  }

  // South corner (front/bottom point) of a tile's diamond — the correct anchor
  // for a building sprite with origin (0.5, 1.0) so it stands flush on the tile.
  tileSouthCorner(col, row) {
    return { x: (col - row) * HW + OX + HW, y: (col + row) * HH + OY + 2 * HH };
  }

  // Inverse of tileCenter — which tile a world point falls in.
  screenToTile(wx, wy) {
    const a = (wx - OX - HW) / HW;
    const b = (wy - OY - HH) / HH;
    return { col: Math.round((a + b) / 2), row: Math.round((b - a) / 2) };
  }

  pointerToTile(px, py) {
    const { col, row } = this.screenToTile(px, py);
    if (col < 0 || row < 0 || col >= N || row >= N) return null;
    return { col, row };
  }

  // Continuous depth for a world Y; equals (col+row)*DMUL at a tile centre, so
  // moving units interleave correctly with static tiles drawn back-to-front.
  worldDepth(wy) {
    return ((wy - OY - HH) / HH) * DMUL;
  }

  // Multi-tile footprints (visual + occupancy). Castle 3x3, Barracks/Market/
  // Blacksmith/Tavern 2x2, everything else 1x1.
  footprintSize(typeKey) {
    const t = BuildingTypes[typeKey];
    if (t && t.footprint) return t.footprint;
    return typeKey === 'castle' ? 3 : typeKey === 'barracks' ? 2 : 1;
  }

  buildingUnlocked(key) {
    const def = BuildingTypes[key];
    if (!def) return false;
    // (Completion Phase 4) Grand Hall only after the Great Council is hosted.
    if (def.councilUnlock && !(this.greatCouncil && this.greatCouncil.held)) return false;
    return !def.stageUnlock || this.currentStage() >= def.stageUnlock;
  }

  hasTavern() { return this.buildings.buildings.some((b) => b.typeKey === 'tavern' && b.alive); }
  hasBlacksmith() { return this.buildings.buildings.some((b) => b.typeKey === 'blacksmith' && b.alive && b.workers > 0); }

  footprintCells(typeKey, col, row) {
    const fp = this.footprintSize(typeKey);
    const half = Math.floor(fp / 2);
    const cells = [];
    for (let dr = 0; dr < fp; dr++) for (let dc = 0; dc < fp; dc++) cells.push({ c: col - half + dc, r: row - half + dr });
    return cells;
  }

  // The four screen-space corner points of a rectangular tile region (a big
  // diamond) — used for placement preview, selection outline and walls.
  regionDiamond(c0, c1, r0, r1) {
    const P = (c, r) => this.tileCenter(c, r);
    return [
      { x: P(c0, r0).x, y: P(c0, r0).y - HH }, // top
      { x: P(c1, r0).x + HW, y: P(c1, r0).y }, // right
      { x: P(c1, r1).x, y: P(c1, r1).y + HH }, // bottom
      { x: P(c0, r1).x - HW, y: P(c0, r1).y }, // left
    ];
  }

  strokeDiamond(g, pts) {
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
  }

  // Wilderness = anything outside the build zone that is not water (so resource
  // nodes never spawn in the river). Overrides GameScene (which used 30x22).
  isWilderness(col, row) {
    if (col < 0 || row < 0 || col >= this.COLS || row >= this.ROWS) return false;
    if (this.isBuildZone(col, row)) return false;
    if (this.terrainType && this.terrainType[row][col] === 'water') return false;
    return true;
  }

  // ---- World generation + rendering ----------------------------------------
  // (Phase 3) The 40x40 world is split into four distinct geographic regions of
  // wilderness around the centre settlement, each with its own terrain mix:
  //   NORTH (rows 0-8) ... dense forest (wolves, abundant wood)
  //   EAST  (cols 31+) ... rocky highlands (stone + gold)
  //   SOUTH (rows 31+) ... open plains + a river along the bottom edge (sheep)
  //   WEST  (cols 0-8) ... mixed wilderness (AI kingdoms, goblin raids)
  // (Phase 3) PER-SETTLEMENT LOCAL MAP. Each settlement's 40×40 map is generated
  // ONCE in buildLocalMapGrid() from its WORLD biome (plains / forest / mountain /
  // coast / desert / highland …) so every town FEELS different. biomeAt() now just
  // reads that precomputed `localBiomeGrid`; the named values it returns
  // ('start' | 'forest' | 'mountains' | 'delta' | 'wildlands' | 'middle') match
  // the legacy renderer + the systems (ResourceNodes/Wildlife/Territory) that
  // read regionAt(), so the existing art pipeline is reused unchanged.
  biomeAt(c, r) {
    if (c < 0 || r < 0 || c >= N || r >= N) return 'middle';
    if (this.isBuildZone(c, r)) return 'start';
    if (this.localBiomeGrid && this.localBiomeGrid[r]) return this.localBiomeGrid[r][c] || 'middle';
    return 'middle';
  }

  // Generate the local-biome grid for THIS settlement, themed by its world biome.
  // Returns a 2D array of legacy biome names so the renderer/systems are reused.
  // Layout: a flat buildable START core (BZ), then a themed wilderness ring whose
  // mix of forest/rock/water/plain differs per world biome:
  //   PLAINS    → open grass, sparse copses, a river along one edge (if any).
  //   FOREST    → dense trees ringing the clearing (wood-rich).
  //   MOUNTAIN  → rocky highland + impassable peaks at the back edge (stone/iron).
  //   COAST     → beach + open SEA on one side (the south/front edge).
  //   DESERT    → sandy scrub, very few trees.
  //   HIGHLAND  → rocky hills, scattered stone, a few trees.
  buildLocalMapGrid() {
    this._rngState = this._settleSeed | 0;
    const biome = this._settleBiome;
    const grid = Array.from({ length: N }, () => Array(N).fill('middle'));
    const mid = Math.floor(N / 2);

    // Theme weights per WORLD biome → probabilities used to paint wilderness.
    // theme: 'forest' (trees), 'mountains' (rock+peak), 'plain', 'delta' (water).
    const theme = (() => {
      switch (biome) {
        case Biome.LUSH_FOREST:
        case Biome.ALPINE_FOREST:
          return { base: 'forest', pForest: 0.6, pRock: 0.03, sea: null, peakEdge: false };
        case Biome.HIGHLAND:
          return { base: 'mountains', pForest: 0.12, pRock: 0.45, sea: null, peakEdge: true };
        case Biome.MOUNTAIN_PEAK:
          return { base: 'mountains', pForest: 0.05, pRock: 0.6, sea: null, peakEdge: true };
        case Biome.COAST:
          return { base: 'delta', pForest: 0.06, pRock: 0.02, sea: 'south', peakEdge: false };
        case Biome.OCEAN:
          return { base: 'delta', pForest: 0.02, pRock: 0.0, sea: 'south', peakEdge: false };
        case Biome.DESERT:
        case Biome.SCRUBLAND:
          return { base: 'wildlands', pForest: 0.03, pRock: 0.08, sea: null, peakEdge: false };
        case Biome.WETLAND:
          return { base: 'delta', pForest: 0.18, pRock: 0.01, sea: null, peakEdge: false, river: true };
        case Biome.TUNDRA:
          return { base: 'wildlands', pForest: 0.1, pRock: 0.12, sea: null, peakEdge: false };
        case Biome.RIVER:
          return { base: 'delta', pForest: 0.12, pRock: 0.02, sea: null, peakEdge: false, river: true };
        case Biome.PLAINS:
        default:
          return { base: 'middle', pForest: 0.1, pRock: 0.04, sea: null, peakEdge: false, river: true };
      }
    })();

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (this.isBuildZone(c, r)) { grid[r][c] = 'start'; continue; }
        // Distance-from-centre falloff so the theme thickens toward the edges.
        const edge = Math.max(Math.abs(c - mid), Math.abs(r - mid));
        const t = Math.min(1, (edge - 10) / (mid - 10)); // 0 at build edge → 1 at map edge
        const roll = this._srand();
        const fp = theme.pForest * (0.5 + t);
        const rp = theme.pRock * (0.5 + t);
        if (roll < fp) grid[r][c] = 'forest';
        else if (roll < fp + rp) grid[r][c] = 'mountains';
        else grid[r][c] = theme.base;
      }
    }

    // SEA edge (coast/ocean towns): flood the front (south) rows with water.
    if (theme.sea === 'south') {
      for (let r = N - 6; r < N; r++) {
        for (let c = 0; c < N; c++) {
          if (this.isBuildZone(c, r)) continue;
          if (r >= N - 4 || this._srand() < 0.6) grid[r][c] = 'delta_sea';
        }
      }
    }

    // PEAK backdrop (mountain/highland towns): impassable peaks along the far edge.
    if (theme.peakEdge) {
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < N; c++) {
          if (this.isBuildZone(c, r)) continue;
          if (r < 2 || this._srand() < 0.5) grid[r][c] = 'peak';
        }
      }
    }

    // RIVER (plains/wetland/river towns): a meandering band across one wilderness
    // strip just south of the build zone — a flavourful water feature.
    if (theme.river) {
      const z = this.BZ;
      const baseRow = z.r1 + 4;
      for (let c = 0; c < N; c++) {
        const rr = baseRow + Math.round(2 * Math.sin(c * 0.4 + (this._settleSeed % 7)));
        for (let k = 0; k < 2; k++) {
          const r = rr + k;
          if (r >= 0 && r < N && !this.isBuildZone(c, r)) grid[r][c] = 'river_band';
        }
      }
    }

    this.localBiomeGrid = grid;
    return grid;
  }

  // Compatibility shim: the older systems (Wildlife/ResourceNodes/Territory)
  // think in N/E/S/W "regions" — map the biomes onto those names.
  regionAt(c, r) {
    const b = this.biomeAt(c, r);
    if (b === 'start') return this.isBuildZone(c, r) ? 'settlement' : 'plain';
    return ({
      forest: 'north', mountains: 'east', delta: 'south', wildlands: 'west', middle: 'plain',
      delta_sea: 'south', river_band: 'south', peak: 'east',
    } as Record<string, string>)[b] || 'plain';
  }

  // Build a single 64x64-cell canvas atlas containing every terrain tile, so the
  // whole 40,000-tile floor can be drawn by ONE Blitter (one batched draw call,
  // per-tile tint for fog/territory) instead of 40,000 separate images.
  buildTerrainAtlas() {
    this.TERRAIN_KEYS = ['iso_grass', 'iso_grass2', 'iso_grass3', 'iso_water', 'iso_water2', 'iso_water3', 'iso_rock', 'iso_mtn',
      'iso_forest1', 'iso_forest2', 'iso_forest3', 'iso_forest4', 'iso_forest5', 'iso_forest6', 'iso_forest7', 'iso_forest8'];
    if (this.textures.exists('terrainAtlas')) return;
    const cols = 8, cell = 64;
    const rows = Math.ceil(this.TERRAIN_KEYS.length / cols);
    const tex = this.textures.createCanvas('terrainAtlas', cols * cell, rows * cell);
    const ctx = tex.getContext();
    this.TERRAIN_KEYS.forEach((k, i) => {
      const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
      ctx.drawImage(this.textures.get(k).getSourceImage() as any, 0, 0, 64, 64, x, y, cell, cell);
      tex.add(k, 0, x, y, cell, cell); // frame named by the original tile key
    });
    tex.refresh();
  }

  drawGrid() {
    this.buildTerrainAtlas();
    // (Phase 3) Build THIS settlement's local biome grid first (themed by the
    // settlement's world biome) — biomeAt() reads it below.
    this.buildLocalMapGrid();
    const waterKeys = ['iso_water', 'iso_water2', 'iso_water3'];
    const forestKeys = ['iso_forest1', 'iso_forest2', 'iso_forest3', 'iso_forest4', 'iso_forest5', 'iso_forest6', 'iso_forest7', 'iso_forest8'];

    const type = Array.from({ length: N }, () => Array(N).fill('grass'));
    const biome = Array.from({ length: N }, () => Array(N).fill('middle'));

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const b = this.biomeAt(c, r);
        biome[r][c] = b;
        // Hard terrain (water/peak) is decided by the local-map generator; the
        // remaining wilderness gets a per-theme forest/rock scatter for texture.
        if (b === 'delta_sea' || b === 'river_band') { type[r][c] = 'water'; continue; }
        if (b === 'peak') { type[r][c] = 'rock'; continue; }
        let pForest = 0, pRock = 0;
        if (b === 'forest') { pForest = 0.62; pRock = 0.03; }
        else if (b === 'mountains') { pRock = 0.6; pForest = 0.04; }
        else if (b === 'wildlands') { pForest = 0.22; pRock = 0.16; }
        else if (b === 'delta') { pForest = 0.04; pRock = 0.02; }
        else if (b === 'middle') { pForest = 0.1; pRock = 0.07; }
        // start zone stays clean grass
        if (b !== 'start') {
          const roll = this._srand();
          if (roll < pForest) type[r][c] = 'forest';
          else if (roll < pForest + pRock) type[r][c] = 'rock';
        }
      }
    }
    this.riverRowAt = (_c) => -1; // no continent-scale river on the local map

    this.terrainType = type;
    this.biomeGrid = biome;
    this.regionGrid = biome; // descriptive grid (continent view reads biomes)
    // One Bob per tile, created back-to-front (increasing col+row) so any baked
    // tree/rock props overlap correctly. Bobs are stored for fog/territory tint.
    this.terrainTiles = Array.from({ length: N }, () => Array(N).fill(null));
    const blitter = this.add.blitter(0, 0, 'terrainAtlas').setDepth(TERRAIN_DEPTH);
    this.terrainBlitter = blitter;
    for (let s = 0; s <= 2 * (N - 1); s++) {
      const cLo = Math.max(0, s - (N - 1));
      const cHi = Math.min(s, N - 1);
      for (let c = cLo; c <= cHi; c++) {
        const r = s - c;
        const tl = this.tileTopLeft(c, r);
        const t = type[r][c];
        let key;
        if (t === 'water') key = Phaser.Utils.Array.GetRandom(waterKeys);
        else if (t === 'forest') key = Phaser.Utils.Array.GetRandom(forestKeys);
        else if (t === 'rock') key = (this.biomeGrid[r][c] === 'mountains' || Math.random() < 0.5) ? 'iso_mtn' : 'iso_rock';
        else { const roll = Math.random(); key = roll < 0.12 ? 'iso_grass2' : roll < 0.18 ? 'iso_grass3' : 'iso_grass'; } // (Assets P1) occasional darker + flowered grass
        this.terrainTiles[r][c] = blitter.create(tl.x, tl.y, key);
      }
    }
  }

  // Decorative rocks scattered through the central/explored area for variety
  // (biome forest/rock tiles already carry their own props).
  scatterDecorations() {
    const rockKeys = ['rock1', 'rock2', 'rock3', 'rock4'];
    const mid = Math.floor(N / 2);
    let placed = 0;
    for (let a = 0; a < 400 && placed < 60; a++) {
      const c = Phaser.Math.Between(mid - 40, mid + 40);
      const r = Phaser.Math.Between(mid - 40, mid + 40);
      if (!this.isWilderness(c, r) || this.terrainType[r][c] !== 'grass') continue;
      const ctr = this.tileCenter(c, r);
      this.add.image(ctr.x + Phaser.Math.Between(-10, 10), ctr.y + Phaser.Math.Between(-4, 8),
        Phaser.Utils.Array.GetRandom(rockKeys))
        .setOrigin(0.5, 0.7).setScale(0.45 * Phaser.Math.FloatBetween(0.8, 1.2))
        .setDepth((c + r) * DMUL + 0.02).setAlpha(0.85);
      placed++;
    }
  }

  // ---- Buildings (iso art, footprints, depth) ------------------------------

  // Re-seat a Building (created by Buildings.js for top-down) into iso space:
  // iso scale + origin, footprint occupancy, and HP-bar / icon repositioning.
  decorateBuilding(b) {
    if (!b || b._isoDone) return;
    b._isoDone = true;

    const fp = this.footprintSize(b.typeKey);
    b._fp = fp;
    // Mark the whole footprint as occupied / blocked (every tile a building
    // covers — 4 for a Barracks, 9 for a Castle) and track the SOUTHERNMOST tile
    // (largest col+row), which the sprite anchors to and depth-sorts by.
    b._cells = [];
    let south = { c: b.col, r: b.row };
    for (const cell of this.footprintCells(b.typeKey, b.col, b.row)) {
      if (cell.c < 0 || cell.r < 0 || cell.c >= this.COLS || cell.r >= this.ROWS) continue;
      if (!this.buildings.grid[cell.r][cell.c]) this.buildings.grid[cell.r][cell.c] = b;
      b._cells.push(cell);
      if (cell.c + cell.r > south.c + south.r) south = { c: cell.c, r: cell.r };
    }
    b._southSum = south.c + south.r;

    const scale = fp === 3 ? 2.0 : fp === 2 ? 1.5 : 1.0;
    b.baseScale = scale;
    // FIX 1-3: anchor (0.5, 1.0) at the SOUTH corner of the southernmost tile so
    // the sprite stands flush over its whole footprint (no float / no sink).
    const sc = this.tileSouthCorner(south.c, south.r);
    b.x = sc.x;
    b.y = sc.y;
    b.rect.setOrigin(0.5, 1.0).setScale(scale).setAngle(0).setPosition(sc.x, sc.y);
    // (Assets Phase 2) Buildings now have distinct generated art, so the old
    // colour-coding tints are gone — show the real sprite colours.
    const BTINT: Record<string, number> = {};
    if (BTINT[b.typeKey]) b.rect.setTint(BTINT[b.typeKey]); else if (!b._tierTinted) b.rect.clearTint();
    if (b.shadow) b.shadow.setVisible(false);

    const topOff = 14 + scale * 34;
    if (b.hpBarBg) { b.hpBarBg.x = b.x; b.hpBarBg.y = b.y - topOff; }
    if (b.hpBar) { b.hpBar.x = b.x - (b.hpBarWidth || 40) / 2; b.hpBar.y = b.y - topOff; }
    if (b.levelText) b.levelText.setPosition(b.x + 18, b.y - topOff + 4);
    if (b.workerIcon) b.workerIcon.setPosition(b.x, b.y - topOff - 14);

    // (UI overhaul Phase 6) Floating identity icon + hover name label.
    this.addBuildingIcon(b, topOff);
    if (b.rect && !b._hoverWired) {
      b._hoverWired = true;
      b.rect.on('pointerover', () => this.showBuildingName(b));
      b.rect.on('pointerout', () => this.hideBuildingName(b));
    }
  }

  // (Phase 6) A small bobbing icon above buildings that reuse another sprite, so
  // their function reads at a glance. Hidden while the building is selected.
  addBuildingIcon(b, topOff) {
    if (b._floatIcon) return;
    const KIND = { market: 'coin', blacksmith: 'hammer', watchtower: 'eye', tavern: 'mug', library: 'book' };
    const kind = KIND[b.typeKey];
    if (!kind) return;
    const iy = b.y - topOff - 22;
    const g = this.add.graphics().setPosition(b.x, iy);
    this.drawBuildingGlyph(g, kind);
    g.setDepth((b._southSum != null ? b._southSum : b.col + b.row) * DMUL + 0.02);
    this.tweens.add({ targets: g, y: iy - 5, yoyo: true, repeat: -1, duration: 950, ease: 'Sine.easeInOut' });
    b._floatIcon = g;
  }

  drawBuildingGlyph(g, kind) {
    g.fillStyle(0x10141c, 0.6); g.fillCircle(0, 0, 12);
    g.lineStyle(1.5, 0x000000, 0.45); g.strokeCircle(0, 0, 12);
    if (kind === 'coin') { g.fillStyle(0xb8860b, 1).fillCircle(0, 0, 8); g.fillStyle(0xffd24a, 1).fillCircle(0, 0, 6); g.fillStyle(0xb8860b, 1).fillRect(-1, -4, 2, 8); }
    else if (kind === 'hammer') { g.fillStyle(0xb5793f, 1).fillRect(-1.6, -2, 3.2, 11); g.fillStyle(0xeef2f7, 1).fillRoundedRect(-8, -8, 16, 6, 1.5); g.fillStyle(0x9aa3ad, 1).fillRect(-8, -3, 16, 1.5); }
    else if (kind === 'eye') { g.fillStyle(0xffffff, 1).fillEllipse(0, 0, 18, 11); g.fillStyle(0x2a6cb0, 1).fillCircle(0, 0, 4.5); g.fillStyle(0x111111, 1).fillCircle(0, 0, 2.2); }
    else if (kind === 'mug') { g.fillStyle(0xf0c277, 1).fillRoundedRect(-6, -5, 11, 12, 2); g.lineStyle(2.5, 0xf0c277, 1).strokeCircle(7, 1, 4); g.fillStyle(0xfffbe8, 1).fillRoundedRect(-6, -8, 11, 4, 2); }
    else if (kind === 'book') { g.fillStyle(0xeef2f7, 1).fillRect(-7, -6, 14, 11); g.fillStyle(0x6a9ad6, 1).fillRect(-7, -6, 3, 11); g.lineStyle(1, 0x9aa3ad, 1); g.beginPath(); g.moveTo(0, -5); g.lineTo(0, 4); g.strokePath(); }
  }

  // (Phase 6) Outlined building name on hover; auto-fades after ~2s.
  showBuildingName(b) {
    if (!b || !b.alive) return;
    this.hideBuildingName(b);
    const name = ellipsize((BuildingTypes[b.typeKey] && BuildingTypes[b.typeKey].name) || b.typeKey, 18);
    const lbl = this.add.text(b.x, b.y - (14 + (b.baseScale || 1) * 34) - 40, name, { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5).setDepth(20);
    b._nameLbl = lbl;
    b._nameTimer = this.time.delayedCall(2000, () => this.hideBuildingName(b));
  }

  hideBuildingName(b) {
    if (b && b._nameTimer) { b._nameTimer.remove(false); b._nameTimer = null; }
    if (b && b._nameLbl) { b._nameLbl.destroy(); b._nameLbl = null; }
  }

  selectBuilding(b) {
    super.selectBuilding(b);
    if (this._iconHidden && this._iconHidden !== b && this._iconHidden._floatIcon) this._iconHidden._floatIcon.setVisible(true);
    if (b && b._floatIcon) { b._floatIcon.setVisible(false); this._iconHidden = b; }
    if (b && b.typeKey === 'treasury') this.openTreasuryPanel(); // (Completion Phase 3) banking UI
    else this.closeTreasuryPanel();
    if (b && b.typeKey === 'hallofheroes') this.openHeroPanel(); // (V2 Phase 3)
    else this.closeHeroPanel();
    if (b && b._onFire) this.openFirePanel(b); // (V2 Phase 6)
    else this.closeFirePanel();
    if (b && b.typeKey === 'castle') this.openCourtPanel(); // (V2 Phase 7) the seat of the court
    else this.closeCourtPanel();
    if (b && b.typeKey === 'intelligence') this.openSpyPanel(); // (V2 Phase 9)
    else this.closeSpyPanel();
  }

  // (V2 Phase 9) Spy Guild — train spies and dispatch covert missions.
  closeSpyPanel() { if (this._spyPanel) { this._spyPanel.forEach((o) => o.destroy()); this._spyPanel = null; } }
  openSpyPanel() {
    this.closeSpyPanel();
    const E = this.espionage; if (!E) return;
    const fix = (o) => o.setScrollFactor(0).setDepth(122);
    const factions = (this.kingdoms || []).filter((k) => k.castleAlive);
    const W = 580, ht = 150 + factions.length * 30, x = (GAME_W - W) / 2, y = (GAME_H - ht) / 2, els = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 0.55).setOrigin(0, 0).setInteractive()));
    els.push(fix(this.add.rectangle(x, y, W, ht, 0x131017, 0.99).setOrigin(0, 0).setStrokeStyle(3, 0x5a7c8a, 0.9)));
    els.push(fix(this.add.text(x + W / 2, y + 12, 'SPY GUILD', { fontFamily: 'monospace', fontSize: '20px', color: '#bfe0ee', fontStyle: 'bold' }).setOrigin(0.5, 0)));
    const close = fix(this.add.text(x + W - 14, y + 10, '✕', { fontFamily: 'monospace', fontSize: '18px', color: '#9fc4d2' }).setOrigin(1, 0).setInteractive({ useHandCursor: true }));
    close.on('pointerdown', () => this.closeSpyPanel()); els.push(close);
    const inTrain = E.training.length;
    els.push(fix(this.add.text(x + 20, y + 42, `Spies ready: ${E.spies}   ·   in training: ${inTrain}`, { fontFamily: 'monospace', fontSize: '13px', color: '#dfe9ee' })));
    const tb = fix(this.add.rectangle(x + W - 170, y + 38, 150, 24, 0x2a4a5c, 0.95).setOrigin(0, 0).setStrokeStyle(2, 0x6aa0c0, 0.9).setInteractive({ useHandCursor: true }));
    const tbt = fix(this.add.text(x + W - 95, y + 50, 'Train spy — 80g', { fontFamily: 'monospace', fontSize: '11px', color: '#dff0fa' }).setOrigin(0.5));
    tb.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.espionage.trainSpy(); this.openSpyPanel(); });
    els.push(tb, tbt);
    // Mission picker.
    els.push(fix(this.add.text(x + 20, y + 74, this._spyMission ? `Mission: ${MISSIONS[this._spyMission].label} — ${MISSIONS[this._spyMission].desc}` : 'Pick a mission, then a target faction below:', { fontFamily: 'monospace', fontSize: '10px', color: '#a9c0cc', wordWrap: { width: W - 40 } })));
    const mkeys = Object.keys(MISSIONS);
    const mw = (W - 40) / mkeys.length;
    mkeys.forEach((mk, i) => {
      const sel = this._spyMission === mk;
      const b = fix(this.add.rectangle(x + 20 + i * mw, y + 92, mw - 4, 24, sel ? 0x3a6a4a : 0x24303a, 0.95).setOrigin(0, 0).setStrokeStyle(1, sel ? 0x6ad68a : 0x456, 0.9).setInteractive({ useHandCursor: true }));
      const t = fix(this.add.text(x + 20 + i * mw + (mw - 4) / 2, y + 104, MISSIONS[mk].label.split(' ')[0], { fontFamily: 'monospace', fontSize: '9px', color: '#dfe9ee' }).setOrigin(0.5));
      b.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this._spyMission = mk; this.openSpyPanel(); });
      els.push(b, t);
    });
    let ry = y + 124;
    for (const k of factions) {
      const key = k.cfg.key;
      els.push(fix(this.add.text(x + 20, ry + 4, k.cfg.name, { fontFamily: 'monospace', fontSize: '12px', color: '#e7eef2' })));
      const canGo = E.spies > 0 && this._spyMission;
      const b = fix(this.add.rectangle(x + W - 150, ry, 130, 22, canGo ? 0x4a2e5c : 0x2a2a30, 0.95).setOrigin(0, 0).setStrokeStyle(1, canGo ? 0x9a6ac0 : 0x444, 0.9).setInteractive({ useHandCursor: canGo }));
      const t = fix(this.add.text(x + W - 85, ry + 11, this._spyMission ? `Send (${Math.round(MISSIONS[this._spyMission].chance * 100)}%)` : 'Pick mission', { fontFamily: 'monospace', fontSize: '10px', color: canGo ? '#e9d6fa' : '#888' }).setOrigin(0.5));
      if (canGo) b.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.espionage.runMission(this._spyMission, key); this.openSpyPanel(); });
      els.push(b, t);
      ry += 30;
    }
    this._spyPanel = els;
  }

  // (V2 Phase 7) Royal Court — advisors, loyalty, and weekly suggestions.
  closeCourtPanel() { if (this._courtPanel) { this._courtPanel.forEach((o) => o.destroy()); this._courtPanel = null; } }
  openCourtPanel() {
    this.closeCourtPanel();
    const C = this.court; if (!C) return;
    const fix = (o) => o.setScrollFactor(0).setDepth(122);
    const empire = !!(this.narrative && this.narrative.canRestoreEmpire());
    const W = 540, ht = 92 + C.advisors.length * 70 + (empire ? 40 : 0), x = (GAME_W - W) / 2, y = (GAME_H - ht) / 2, els = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 0.5).setOrigin(0, 0).setInteractive()));
    els.push(fix(this.add.rectangle(x, y, W, ht, 0x171320, 0.99).setOrigin(0, 0).setStrokeStyle(3, 0xc9a14a, 0.9)));
    els.push(fix(this.add.text(x + W / 2, y + 12, 'THE ROYAL COURT', { fontFamily: 'monospace', fontSize: '20px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0)));
    els.push(fix(this.add.text(x + W / 2, y + 36, 'Your advisors counsel you. Heed them to keep their loyalty.', { fontFamily: 'monospace', fontSize: '11px', color: '#b6a98c' }).setOrigin(0.5, 0)));
    const close = fix(this.add.text(x + W - 14, y + 10, '✕', { fontFamily: 'monospace', fontSize: '18px', color: '#cbb787' }).setOrigin(1, 0).setInteractive({ useHandCursor: true }));
    close.on('pointerdown', () => this.closeCourtPanel()); els.push(close);
    let ry = y + 62;
    for (const a of C.advisors) {
      els.push(fix(this.add.text(x + 18, ry + 6, a.icon, { fontFamily: 'monospace', fontSize: '22px' }).setOrigin(0.5, 0)));
      els.push(fix(this.add.text(x + 44, ry, `${a.title} ${a.name}`, { fontFamily: 'monospace', fontSize: '14px', color: '#ffe9b0', fontStyle: 'bold' })));
      // loyalty bar
      const lc = a.loyalty >= 60 ? 0x4ad66b : a.loyalty >= 30 ? 0xd6c04a : 0xd64a4a;
      els.push(fix(this.add.rectangle(x + 44, ry + 19, 120, 7, 0x000000, 0.6).setOrigin(0, 0)));
      els.push(fix(this.add.rectangle(x + 44, ry + 19, 120 * a.loyalty / 100, 7, lc).setOrigin(0, 0)));
      els.push(fix(this.add.text(x + 170, ry + 16, `loyalty ${a.loyalty}`, { fontFamily: 'monospace', fontSize: '10px', color: '#cfc1a6' })));
      if (a.suggestion) {
        els.push(fix(this.add.text(x + 44, ry + 32, '"' + a.suggestion.text + '"', { fontFamily: 'monospace', fontSize: '9px', color: '#c9bfa6', fontStyle: 'italic', wordWrap: { width: 300 } })));
        const heed = fix(this.add.rectangle(x + W - 120, ry + 6, 64, 22, 0x2e5a3a, 0.95).setOrigin(0, 0).setStrokeStyle(1, 0x4ad66b, 0.9).setInteractive({ useHandCursor: true }));
        const heedT = fix(this.add.text(x + W - 88, ry + 17, 'Heed', { fontFamily: 'monospace', fontSize: '11px', color: '#cfeecb' }).setOrigin(0.5));
        const ign = fix(this.add.rectangle(x + W - 120, ry + 32, 64, 22, 0x5a2e2e, 0.95).setOrigin(0, 0).setStrokeStyle(1, 0xd64a4a, 0.9).setInteractive({ useHandCursor: true }));
        const ignT = fix(this.add.text(x + W - 88, ry + 43, 'Ignore', { fontFamily: 'monospace', fontSize: '11px', color: '#eecbcb' }).setOrigin(0.5));
        heed.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.court.heed(a); this.openCourtPanel(); });
        ign.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.court.ignore(a); this.openCourtPanel(); });
        els.push(heed, heedT, ign, ignT);
      } else {
        els.push(fix(this.add.text(x + 44, ry + 34, 'No counsel pending. Reports arrive weekly.', { fontFamily: 'monospace', fontSize: '10px', color: '#7d7768', fontStyle: 'italic' })));
      }
      ry += 70;
    }
    // (V2 Phase 11) The secret fourth path — restore the old empire.
    if (this.narrative && this.narrative.canRestoreEmpire()) {
      const cost = this.narrative.restoreEmpireCost();
      const eb = fix(this.add.rectangle(x + 20, y + ht - 38, W - 40, 28, 0x4a3a1a, 0.97).setOrigin(0, 0).setStrokeStyle(2, 0xffd24a, 0.95).setInteractive({ useHandCursor: true }));
      const et = fix(this.add.text(x + W / 2, y + ht - 24, `⟡ Restore the Old Empire — ${cost} gold (a final victory)`, { fontFamily: 'monospace', fontSize: '12px', color: '#ffe9a8', fontStyle: 'bold' }).setOrigin(0.5));
      eb.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); if (this.narrative.restoreEmpire()) this.closeCourtPanel(); });
      els.push(eb, et);
    }
    this._courtPanel = els;
  }

  // (V2 Phase 8) A brief wedding celebration in the great hall.
  weddingCeremony(key) {
    const fix = (o) => o.setScrollFactor(0).setDepth(160);
    const els = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x1a0f1a, 0.82).setOrigin(0, 0).setInteractive()));
    els.push(fix(this.add.text(GAME_W / 2, GAME_H / 2 - 60, '♥', { fontFamily: 'monospace', fontSize: '64px', color: '#ff9ad6' }).setOrigin(0.5)));
    const fname = this.succession ? this.succession.factionName(key) : key;
    els.push(fix(this.add.text(GAME_W / 2, GAME_H / 2 + 10, 'A ROYAL WEDDING', { fontFamily: 'monospace', fontSize: '30px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5)));
    els.push(fix(this.add.text(GAME_W / 2, GAME_H / 2 + 48, `Heir ${this.succession.heir.name} weds into the ${fname}.\nThe crowns are united in lasting alliance.`, { fontFamily: 'monospace', fontSize: '14px', color: '#e7d6c0', align: 'center' }).setOrigin(0.5)));
    sfx.play && sfx.play('victory');
    this.tweens.add({ targets: els[1], scale: { from: 0.4, to: 1 }, duration: 500, ease: 'Back.out' });
    this.time.delayedCall(2600, () => els.forEach((o) => o.destroy()));
  }

  // (V2 Phase 8) One-time prompt: how shall the heir be raised? Shapes their trait.
  openHeirRaising() {
    if (this._heirPanel || !this.succession) return;
    const fix = (o) => o.setScrollFactor(0).setDepth(124);
    const choices = this.succession.upbringingChoices();
    const W = 460, ht = 150 + choices.length * 56, x = (GAME_W - W) / 2, y = (GAME_H - ht) / 2, els = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 0.6).setOrigin(0, 0).setInteractive()));
    els.push(fix(this.add.rectangle(x, y, W, ht, 0x18141f, 0.99).setOrigin(0, 0).setStrokeStyle(3, 0xc9a14a, 0.9)));
    els.push(fix(this.add.text(x + W / 2, y + 14, 'RAISING THE HEIR', { fontFamily: 'monospace', fontSize: '20px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0)));
    els.push(fix(this.add.text(x + W / 2, y + 42, `Young ${this.succession.heir.name} comes of age. How shall they be raised?\nIt will shape the realm they one day inherit.`, { fontFamily: 'monospace', fontSize: '11px', color: '#c9bfa6', align: 'center' }).setOrigin(0.5, 0)));
    let ry = y + 92;
    for (const c of choices) {
      const btn = fix(this.add.rectangle(x + 30, ry, W - 60, 46, 0x2a2436, 0.95).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.7).setInteractive({ useHandCursor: true }));
      const t1 = fix(this.add.text(x + 44, ry + 7, c.label, { fontFamily: 'monospace', fontSize: '13px', color: '#ffe9b0', fontStyle: 'bold' }));
      const t2 = fix(this.add.text(x + 44, ry + 25, `${c.note}  (rules as ${c.trait})`, { fontFamily: 'monospace', fontSize: '10px', color: '#bcae90' }));
      btn.on('pointerover', () => btn.setFillStyle(0x3a3248, 0.97));
      btn.on('pointerout', () => btn.setFillStyle(0x2a2436, 0.95));
      btn.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.succession.raiseHeir(c.key); this.closeHeirRaising(); });
      els.push(btn, t1, t2);
      ry += 56;
    }
    this._heirPanel = els;
  }
  closeHeirRaising() { if (this._heirPanel) { this._heirPanel.forEach((o) => o.destroy()); this._heirPanel = null; } }

  // (V2 Phase 6) Quick response panel for a burning building.
  closeFirePanel() { if (this._firePanel) { this._firePanel.forEach((o) => o.destroy()); this._firePanel = null; } }
  openFirePanel(b) {
    this.closeFirePanel();
    const fix = (o) => o.setScrollFactor(0).setDepth(122);
    const W = 320, ht = 130, x = (GAME_W - W) / 2, y = 90, els = [];
    els.push(fix(this.add.rectangle(x, y, W, ht, 0x241410, 0.98).setOrigin(0, 0).setStrokeStyle(3, 0xff8c3a, 0.95)));
    els.push(fix(this.add.text(x + W / 2, y + 12, `🔥 ${b.type.name} is on fire!`, { fontFamily: 'monospace', fontSize: '15px', color: '#ffb066', fontStyle: 'bold' }).setOrigin(0.5, 0)));
    els.push(fix(this.add.text(x + W / 2, y + 38, 'It will burn down in 2 days and may\nspread to nearby buildings.', { fontFamily: 'monospace', fontSize: '11px', color: '#e7c9b0', align: 'center' }).setOrigin(0.5, 0)));
    const btn = fix(this.add.rectangle(x + W / 2, y + 92, 220, 30, 0x8a3a2a, 0.95).setStrokeStyle(2, 0xffb066, 0.9).setInteractive({ useHandCursor: true }));
    const bt = fix(this.add.text(x + W / 2, y + 92, 'Send workers — 20 gold', { fontFamily: 'monospace', fontSize: '12px', color: '#ffe9d0', fontStyle: 'bold' }).setOrigin(0.5));
    btn.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); if (this.maintenance.extinguishFire(b)) { this.closeFirePanel(); this.refreshPanel(); } });
    els.push(btn, bt);
    this._firePanel = els;
  }

  // (V2 Phase 3) Hall of Heroes — living heroes (assign to army) + fallen.
  closeHeroPanel() { if (this._heroPanel) { this._heroPanel.forEach((o) => o.destroy()); this._heroPanel = null; } }
  openHeroPanel() {
    this.closeHeroPanel();
    const H = this.heroes; if (!H) return;
    const fix = (o) => o.setScrollFactor(0).setDepth(120);
    const W = 560, ht = 360, x = (GAME_W - W) / 2, y = (GAME_H - ht) / 2, els = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 0.55).setOrigin(0, 0).setInteractive()));
    els.push(fix(this.add.rectangle(x, y, W, ht, 0x161b26, 0.99).setOrigin(0, 0).setStrokeStyle(3, 0xc9a14a, 0.9)));
    els.push(fix(this.add.text(x + W / 2, y + 12, 'HALL OF HEROES', { fontFamily: 'monospace', fontSize: '20px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0)));
    const close = fix(this.add.text(x + W - 14, y + 12, '✕', { fontFamily: 'monospace', fontSize: '18px', color: '#cbb787' }).setOrigin(1, 0).setInteractive({ useHandCursor: true }));
    close.on('pointerdown', () => this.closeHeroPanel()); els.push(close);
    const live = H.living(), fall = H.fallen();
    if (!live.length && !fall.length) els.push(fix(this.add.text(x + 24, y + 48, 'No heroes yet. They arrive through world events.', { fontFamily: 'monospace', fontSize: '13px', color: '#9aa0a6' })));
    let ry = y + 44;
    for (const h of live) {
      const pk = 'hero_' + h.id;
      if (this.textures.exists(pk)) els.push(fix(this.add.image(x + 18, ry, pk).setOrigin(0, 0).setDisplaySize(48, 48)));
      els.push(fix(this.add.text(x + 74, ry, `${h.name}, ${h.title}`, { fontFamily: 'monospace', fontSize: '13px', color: '#ffe9b0', fontStyle: 'bold' })));
      els.push(fix(this.add.text(x + 74, ry + 16, `Lv ${h.level}  ·  ${h.passive}`, { fontFamily: 'monospace', fontSize: '10px', color: '#cfc1a6', wordWrap: { width: 320 } })));
      els.push(fix(this.add.rectangle(x + 74, ry + 38, 200, 5, 0x000000, 0.5).setOrigin(0, 0)));
      els.push(fix(this.add.rectangle(x + 74, ry + 38, 200 * Phaser.Math.Clamp(h.xp / Math.max(1, H.xpForNext(h)), 0, 1), 5, 0x66ddff).setOrigin(0, 0)));
      const armies = this.armyMgr ? this.armyMgr.playerArmies() : [];
      const cur = armies.find((a) => a.id === h.armyId);
      const lbl = cur ? `In: ${cur.name}` : (armies.length ? 'Assign →' : 'No army');
      const ab = fix(this.add.rectangle(x + W - 116, ry + 6, 100, 26, armies.length ? 0x2d6cb0 : 0x39393f).setOrigin(0, 0).setStrokeStyle(1, 0xf0e6c8, 0.8));
      els.push(ab); els.push(fix(this.add.text(x + W - 66, ry + 19, lbl, { fontFamily: 'monospace', fontSize: '11px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));
      if (armies.length) ab.setInteractive({ useHandCursor: true }).on('pointerdown', () => { const idx = cur ? (armies.findIndex((a) => a.id === h.armyId) + 1) : 0; const next = armies[idx]; H.assign(h.id, next ? next.id : null); this.openHeroPanel(); });
      ry += 58;
    }
    if (fall.length) { els.push(fix(this.add.text(x + 24, ry + 2, 'FALLEN — fighting in their memory (+5 morale each)', { fontFamily: 'monospace', fontSize: '11px', color: '#9aa6b6' }))); ry += 22; }
    for (const h of fall) { els.push(fix(this.add.text(x + 28, ry, `† ${h.name} the ${h.title} — fell day ${h.deathDay} at ${h.deathLocation}`, { fontFamily: 'monospace', fontSize: '11px', color: '#7d8389' }))); ry += 18; }
    this._heroPanel = els;
    if (this.routeCameras) this.routeCameras();
  }

  // (Completion Phase 3) Treasury banking panel — reserves, interest, loans.
  closeTreasuryPanel() { if (this._treasuryPanel) { this._treasuryPanel.forEach((o) => o.destroy()); this._treasuryPanel = null; } }
  openTreasuryPanel() {
    this.closeTreasuryPanel();
    const bk = this.banking; if (!bk) return;
    const fix = (o) => o.setScrollFactor(0).setDepth(120);
    const W = 460, H = 330, x = (GAME_W - W) / 2, y = (GAME_H - H) / 2, els = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 0.5).setOrigin(0, 0).setInteractive()));
    els.push(fix(this.add.rectangle(x, y, W, H, 0x161b26, 0.99).setOrigin(0, 0).setStrokeStyle(3, 0xc9a14a, 0.9)));
    els.push(fix(this.add.text(x + W / 2, y + 14, 'TREASURY', { fontFamily: 'monospace', fontSize: '20px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0)));
    const close = fix(this.add.text(x + W - 14, y + 12, '✕', { fontFamily: 'monospace', fontSize: '18px', color: '#cbb787' }).setOrigin(1, 0).setInteractive({ useHandCursor: true }));
    close.on('pointerdown', () => this.closeTreasuryPanel()); els.push(close);
    const line = (ty, txt, col = '#dfe6ee', size = '13px') => els.push(fix(this.add.text(x + 24, ty, txt, { fontFamily: 'monospace', fontSize: size, color: col })));
    line(y + 48, `Gold on hand: ${Math.floor(this.resources.gold)}`);
    line(y + 70, `Reserves: ${Math.floor(bk.reserves)}g   ·   Interest: +${bk.weeklyInterest()}/week`, '#9be88a');
    if (bk.loan) line(y + 92, `Loan: owe ${bk.loan.owed}g, due day ${bk.loan.due}${bk.loan.overdue ? ` (OVERDUE ${bk.loan.overdue}d)` : ''}`, '#ff8a80');
    else line(y + 92, 'No active loan', '#b9c6d6');
    // Action buttons.
    const btn = (bx, by, w, label, fn, col = 0x2d6cb0) => {
      const b = fix(this.add.rectangle(bx, by, w, 30, col).setOrigin(0, 0).setStrokeStyle(1, 0xf0e6c8, 0.8).setInteractive({ useHandCursor: true }));
      els.push(b); els.push(fix(this.add.text(bx + w / 2, by + 15, label, { fontFamily: 'monospace', fontSize: '12px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));
      b.on('pointerdown', (p, lx, ly, ev) => { if (ev) ev.stopPropagation(); fn(); });
    };
    let by = y + 122;
    btn(x + 24, by, 130, 'Deposit 50', () => bk.deposit(50)); btn(x + 164, by, 130, 'Deposit 200', () => bk.deposit(200)); btn(x + 304, by, 132, 'Withdraw All', () => bk.withdraw(bk.reserves), 0x3a6a8a);
    by += 40;
    btn(x + 24, by, 130, 'Loan 100', () => bk.takeLoan(100), 0x8a6a2a); btn(x + 164, by, 130, 'Loan 300', () => bk.takeLoan(300), 0x8a6a2a); btn(x + 304, by, 132, 'Loan 500', () => bk.takeLoan(500), 0x8a6a2a);
    by += 40;
    btn(x + 24, by, 200, bk.loan ? `Repay (${bk.loan.owed}g)` : 'No loan to repay', () => bk.repayLoan(), bk.loan ? 0x2e8b57 : 0x39393f);
    // History.
    line(by + 44, 'Recent:', '#cbb787', '12px');
    (bk.history || []).slice(0, 4).forEach((h, i) => line(by + 62 + i * 16, `· ${h.text} (day ${h.day})`, '#9aa6b6', '11px'));
    this._treasuryPanel = els;
    if (this.routeCameras) this.routeCameras();
  }

  clearSelection() {
    super.clearSelection();
    if (this._iconHidden && this._iconHidden._floatIcon) { this._iconHidden._floatIcon.setVisible(true); this._iconHidden = null; }
  }

  // Re-sort everything that can move/spawn, every frame, by iso depth.
  // Depth ordering. Terrain is a single Blitter below everything (TERRAIN_DEPTH);
  // these objects sort among themselves by (col+row)*DMUL with tiny sub-tile
  // layer offsets (all < DMUL so the ordering within a tile is stable). The whole
  // band stays < ~24, below the HUD at 28+.
  applyIsoDepths() {
    const D = (wy) => this.worldDepth(wy);
    const BODY = 0.006, UNIT = 0.008, RING = 0.010, BARB = 0.012, BARF = 0.014, LBL = 0.016, NODE = 0.004;

    for (const b of this.buildings.buildings) {
      this.decorateBuilding(b);
      // Depth from the SOUTHERNMOST occupied tile (largest col+row) so multi-tile
      // buildings sort by their front edge. Scaled by DMUL to stay below the HUD.
      const base = (b._southSum != null ? b._southSum : b.col + b.row + ((b._fp || 1) - 1)) * DMUL;
      b.rect.setDepth(base + BODY);
      if (b.hpBarBg) b.hpBarBg.setDepth(base + BARB);
      if (b.hpBar) b.hpBar.setDepth(base + BARF);
      if (b.levelText) b.levelText.setDepth(base + BARF);
      if (b.workerIcon) b.workerIcon.setDepth(base + LBL);
    }
    const c = this.buildings.castle;
    if (c && this.castleBarBg) {
      const base = (c.col + c.row + 2) * DMUL;
      this.castleBarBg.setDepth(base + BARB);
      this.castleBarFill.setDepth(base + BARF);
    }

    for (const p of this.pawns.pawns) p.spr.setDepth(D(p.spr.y) + UNIT);
    if (this.npcs) for (const n of this.npcs) if (n.spr.active) n.spr.setDepth(D(n.spr.y) + UNIT - 0.001);

    for (const u of this.troops.allUnits()) {
      u.spr.setDepth(D(u.spr.y) + UNIT);
      if (u.selRing) u.selRing.setDepth(D(u.y) + RING);
      if (u.label) u.label.setDepth(D(u.spr.y) + LBL); // Mercenary tag (Phase 5)
    }

    for (const e of this.waves.enemies) {
      const s = e.rect || e.spr;
      if (!s) continue;
      const d = D(s.y);
      s.setDepth(d + UNIT);
      if (e.hpBarBg) e.hpBarBg.setDepth(d + BARB);
      if (e.hpBarFill) e.hpBarFill.setDepth(d + BARF);
    }

    for (const n of this.nodes.nodes) {
      if (n.spr) n.spr.setDepth(D(n.spr.y) + NODE);
      if (n.label) n.label.setDepth(D(n.spr.y) + LBL); // just above its node
    }

    if (this.wildlife) {
      for (const w of this.wildlife.units) {
        if (!w.spr) continue;
        const d = D(w.spr.y);
        w.spr.setDepth(d + UNIT);
        if (w.hpBarBg) w.hpBarBg.setDepth(d + BARB);
        if (w.hpBarFill) w.hpBarFill.setDepth(d + BARF);
      }
    }
    if (this.settlements) this.settlements.applyDepths(D, BODY, BARB, BARF, LBL);
    if (this.goblinCamps) this.goblinCamps.applyDepths(D, BODY, BARB, BARF);

    for (const k of this.kingdoms || []) {
      for (const ab of k.buildings) if (ab.sprite) ab.sprite.setDepth(D(ab.sprite.y) + BODY);
      if (k.castleSpr) {
        const d = D(k.castleY);
        k.castleSpr.setDepth(d + BODY);
        if (k.castleBarBg) k.castleBarBg.setDepth(d + BARB);
        if (k.castleBarFill) k.castleBarFill.setDepth(d + BARF);
        if (k.castleLabel) k.castleLabel.setDepth(d + LBL);
      }
    }
  }

  // (Bug 6) Is this tile a legal spot for `typeKey`? Normal buildings must be in
  // the build zone; walls (def.anywhere) get a 2-tile buffer past the zone border
  // but can NO LONGER be placed arbitrarily far out. Used by BOTH the hover ghost
  // and the placement click so they always agree.
  withinBuildArea(typeKey, c, r) {
    if (this.isBuildZone(c, r)) return true;
    const def = BuildingTypes[typeKey];
    if (def && def.anywhere) {
      const z = this.BZ, B = 2;
      return c >= z.c0 - B && c <= z.c1 + B && r >= z.r0 - B && r <= z.r1 + B;
    }
    return false;
  }

  // Build with multi-tile footprint validation, then iso-decorate + place FX.
  tryBuild(typeKey, tile) {
    const def = BuildingTypes[typeKey];
    if (def && def.stageUnlock && this.currentStage() < def.stageUnlock) {
      this.showToast(`${def.name} unlocks at a later settlement stage`);
      return;
    }
    const cells = this.footprintCells(typeKey, tile.col, tile.row);
    for (const cell of cells) {
      // (Bug 6) Re-validate the build area on the placement CLICK using the same
      // rule the hover ghost uses — walls get a 2-tile buffer past the zone but
      // are no longer allowed anywhere on the map.
      if (cell.c < 0 || cell.r < 0 || cell.c >= this.COLS || cell.r >= this.ROWS || !this.withinBuildArea(typeKey, cell.c, cell.r)) {
        this.showToast('Build within your territory');
        return;
      }
      if (this.buildings.isOccupied(cell.c, cell.r) || (this.terrainType && this.terrainType[cell.r][cell.c] === 'water')) {
        this.showToast('Not enough room — needs a clear footprint');
        return;
      }
    }
    // (Phase 11) MONUMENTS charge via GameWorld (gold from the campaign purse +
    // materials from the home stockpile) and apply their prestige/morale effects
    // there — so they bypass the local resources.spend + canPlace cost check.
    if (def.monument) {
      this.flushResourcesToWorld(); // make sure GameWorld sees current home stockpile
      const can = GameWorld.canBuildMonument(typeKey);
      if (!can.ok) { this.showToast(can.reason || 'Cannot build that here'); return; }
      const res = GameWorld.buildMonument(typeKey);
      if (!res.ok) { this.showToast(res.reason || 'Cannot build that here'); return; }
      this.pullWorldResources(); // reflect the spent stockpile back into the live scene
    } else {
      const check = this.buildings.canPlace(typeKey, this.resources, this.maxBuildings());
      if (!check.ok) {
        this.showToast(check.reason);
        return;
      }
      this.resources.spend(def.cost);
    }
    const b = this.buildings.place(typeKey, tile.col, tile.row);
    if (b) {
      this.decorateBuilding(b);
      this.placeFX(b);
      sfx.play('building_placed'); // (Polish Phase 2)
      this.territoryPulse(); // (Phase 8) always pulse so placement is felt
      if (typeKey === 'watchtower') this.revealAround(b.col, b.row, def.revealRadius || 8);
      if (this.territory) this.territory.recompute();
      // (Phase 11) Building a Grand Hall is a prestige source (+50, once).
      if (typeKey === 'grandhall') GameWorld.addPrestige(50, 'a Grand Hall now graces your seat', 'prestige_grandhall');
      if (def.monument) this.showToast(`${def.name} raised — +${GameWorld.MONUMENT_DEFS[typeKey]?.prestige || 0} prestige`);
      this.placementType = null; // (Phase 5) auto-exit placement mode after placing
      this.clearGhost();
      if (this._weather === 'snow') this.updateSnowCaps(true); // (Phase 4) snow-cap new winter builds
      this.time.delayedCall(450, () => this.showTutorial(2)); // Phase 2: stage 2 after first building
    }
    this.refreshPanel();
  }

  // (Phase 8) A few decorative villagers wandering the settlement (purely
  // visual — they speed up while a raid/battle is active).
  createNPCs() {
    this.npcs = [];
    const c = this.buildings.castle;
    for (let i = 0; i < 3; i++) {
      const spr = this.add.sprite(c.x + Phaser.Math.Between(-50, 50), c.y + Phaser.Math.Between(-30, 40), 'pawn_idle', 0).setScale(30 / 192).setDepth(2).setAlpha(0.92);
      if (this.anims.exists('pawn_idle')) spr.play('pawn_idle');
      const npc = { spr, wander: () => {
        if (!spr.active) return;
        const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 70;
        const tx = c.x + Math.cos(a) * r, ty = c.y + Math.sin(a) * r * 0.7;
        spr.setFlipX(tx < spr.x);
        const fast = this.waves.enemies.length > 0 || this._inBattle;
        this.tweens.add({ targets: spr, x: tx, y: ty, duration: fast ? 800 : 2400 + Math.random() * 1600, onComplete: () => npc.wander() });
      } };
      npc.wander();
      this.npcs.push(npc);
    }
  }

  // ---- (UI overhaul Phase 2) Interactive staged tutorial -------------------

  // Stage 1 replaces the old static welcome modal.
  showWelcomePanel() { this.showTutorial(1); }

  tutorialSeen() { try { return JSON.parse(localStorage.getItem('kg_tut') || '{}'); } catch (e) { return {}; } }

  showTutorial(stage) {
    const TUT = {
      1: { title: 'Your Kingdom Awaits', body: 'You start with nothing. Idle workers automatically gather nearby resources — you do not need to assign them. Build buildings to produce faster, and grow your settlement to unlock new buildings and units.', btn: "I'm ready →" },
      2: { title: 'Boost Production', body: 'Your first building is placed. Assign a worker with the + button in its panel — workers staffed in a building gather MUCH faster than idle workers.', btn: 'Got it →' },
      3: { title: 'Command Your Army', body: 'Warriors defend your kingdom automatically. Drag a box around them to select, then right-click to command them. Press Tab to see the whole continent.', btn: 'Got it →' },
      4: { title: 'The Continent', body: 'This is your continent. Your territory glows blue. Enemy kingdoms sit in the far corners. Neutral settlements can be conquered. Click anywhere to return.', btn: 'Got it →' },
      5: { title: 'Under Attack!', body: 'Your kingdom is under attack! Select your warriors and right-click enemies to fight. When the armies are large enough, a full battle begins.', btn: 'Fight! →' },
    };
    const seen = this.tutorialSeen();
    if (seen[stage] || !TUT[stage]) return;
    seen[stage] = true;
    try { localStorage.setItem('kg_tut', JSON.stringify(seen)); } catch (e) {}
    const t = TUT[stage];
    if (this._tutPanel) this._tutPanel.forEach((o) => o.destroy());
    const fix = (o) => o.setScrollFactor(0).setDepth(78);
    const W = 540, H = 120, cx = GAME_W / 2, top = this.PANEL_Y - H - 40;
    const els = [];
    els.push(fix(this.add.rectangle(cx, top + H / 2, W, H, 0x1a140c, 0.97).setStrokeStyle(2, 0xc9a14a, 0.95)));
    els.push(fix(this.add.rectangle(cx - W / 2 + 3, top + H / 2, 4, H - 6, 0xc9a14a, 0.9)));
    els.push(fix(this.add.text(cx - W / 2 + 18, top + 12, `📜 ${t.title}`, { fontFamily: 'monospace', fontSize: '16px', color: '#ffe9b0', fontStyle: 'bold' })));
    els.push(fix(this.add.text(cx - W / 2 + 18, top + 36, t.body, { fontFamily: 'monospace', fontSize: '12px', color: '#f0e6d0', wordWrap: { width: W - 36 }, lineSpacing: 3 })));
    const bg = fix(this.add.rectangle(cx + W / 2 - 80, top + H - 22, 130, 28, 0x2d6cb0).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
    els.push(bg);
    els.push(fix(this.add.text(cx + W / 2 - 80, top + H - 22, t.btn, { fontFamily: 'monospace', fontSize: '13px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));
    const close = () => { els.forEach((o) => o.destroy()); this._tutPanel = null; };
    bg.on('pointerover', () => bg.setFillStyle(0x3d83cf));
    bg.on('pointerout', () => bg.setFillStyle(0x2d6cb0));
    bg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); close(); });
    this._tutPanel = els;
    this.routeCameras && this.routeCameras();
  }

  // (Phase 8) A ring pulse from the castle whenever a building is placed.
  territoryPulse() {
    const c = this.buildings.castle;
    if (!c) return;
    const ring = this.add.circle(c.x, c.y, 20, 0x6fdcff, 0).setStrokeStyle(3, 0x6fdcff, 0.8).setDepth(27.5);
    this.tweens.add({ targets: ring, radius: 200, alpha: 0, duration: 700, ease: 'Cubic.out', onComplete: () => ring.destroy() });
  }

  // Permanently reveal fog within `rad` tiles of (col,row) — Watchtower / vision.
  revealAround(col, row, rad) {
    if (!this.territory) return;
    this._fogDirty = true; // (BUG 7) refresh the fog overlay
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      const nc = col + dc, nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= this.COLS || nr >= this.ROWS || dc * dc + dr * dr > rad * rad) continue;
      if (!this.territory.explored[nr][nc]) { this.territory.explored[nr][nc] = true; const bob = this.terrainTiles[nr][nc]; if (bob) bob.setTint(this.territory.tintFor(nc, nr)); }
    }
  }

  // ---- Camera (iso world pan + zoom) --------------------------------------

  setupCamera() {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H);
    const c = this.buildings.castle;
    cam.centerOn(c.x, c.y);
    this._rightDrag = null;
    this.input.mouse.disableContextMenu();

    this.input.on('pointermove', (p) => {
      if (p.rightButtonDown() || p.middleButtonDown()) {
        if (this._rightDrag && (Math.abs(p.x - this._rightDrag.sx) > 4 || Math.abs(p.y - this._rightDrag.sy) > 4)) this._rightDrag.moved = true;
        cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
        cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      }
    });
    this.input.on('pointerdown', (p) => {
      if (p.rightButtonDown()) this._rightDrag = { sx: p.x, sy: p.y, moved: false };
    });
    this.input.on('pointerup', (p) => {
      // (Completion Phase 5) Road mode: left-tap a start tile, then an end tile.
      if (this._roadMode && p.button === 0 && p.y >= TOP_BAR && p.y <= GAME_H - PANEL_H) {
        const t = this.pointerToTile(p.worldX, p.worldY); if (!t) return;
        if (!this._roadStart) { this._roadStart = t; this.showToast && this.showToast('Now click the road end point (Esc to cancel)'); }
        else { this.roads.buildPath(this._roadStart.col, this._roadStart.row, t.col, t.row); this._roadMode = false; this._roadStart = null; this.refreshPanel(); }
        return;
      }
      const tapped = this._rightDrag && !this._rightDrag.moved;
      this._rightDrag = null;
      if (!tapped || this.isGameOver || this.placementType) return;
      if (p.y < TOP_BAR || p.y > GAME_H - PANEL_H) return;
      // (Expansion) A selected army marches/attacks where you right-click.
      if (this.armyMgr && this.armyMgr.selected && this.armyMgr.selected.faction === 'player') {
        this.commandArmy(this.armyMgr.selected, p.worldX, p.worldY);
        return;
      }
      if (this.selectedUnits.length > 0) this.issueMoveCommand(p.worldX, p.worldY);
    });
    this.input.on('wheel', (p, over, dx, dy) => {
      if (this._overSound) return; // (Polish Phase 2) scroll over the speaker adjusts volume, not zoom
      cam.setZoom(Phaser.Math.Clamp(cam.zoom - dy * 0.001, 0.3, 2));
    });
  }

  // (Polish Phase 2) Top-right speaker control: click to mute, scroll to set volume.
  createSoundControl() {
    const fix = (o) => o.setScrollFactor(0);
    const x = GAME_W - 92, y = 60, w = 84, h = 22;
    const bg = fix(this.add.rectangle(x, y, w, h, 0x10141c, 0.85).setOrigin(0, 0).setDepth(60).setStrokeStyle(1, 0x39455a, 0.9).setInteractive({ useHandCursor: true }));
    const g = fix(this.add.graphics().setDepth(61));
    this._soundUI = { bg, g, x, y, w, h };
    this.drawSoundControl();
    bg.on('pointerover', () => { this._overSound = true; });
    bg.on('pointerout', () => { this._overSound = false; });
    bg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); sfx.unlock(); sfx.toggleMute(); this.drawSoundControl(); });
    bg.on('wheel', (p, dx, dy) => { sfx.unlock(); sfx.setVolume(sfx.volume - Math.sign(dy) * 0.1); if (sfx.muted && sfx.volume > 0) sfx.toggleMute(); this.drawSoundControl(); });
  }

  drawSoundControl() {
    const u = this._soundUI; if (!u) return;
    const g = u.g; g.clear();
    const ix = u.x + 12, iy = u.y + u.h / 2;
    // Speaker body (drawn).
    g.fillStyle(0xdfe6ee, 1);
    g.fillRect(ix - 8, iy - 4, 4, 8);
    g.beginPath(); g.moveTo(ix - 4, iy - 4); g.lineTo(ix + 2, iy - 9); g.lineTo(ix + 2, iy + 9); g.lineTo(ix - 4, iy + 4); g.closePath(); g.fillPath();
    if (sfx.muted || sfx.volume <= 0) {
      g.lineStyle(2, 0xff6b6b, 1); g.beginPath(); g.moveTo(ix + 6, iy - 6); g.lineTo(ix + 14, iy + 6); g.strokePath(); g.beginPath(); g.moveTo(ix + 14, iy - 6); g.lineTo(ix + 6, iy + 6); g.strokePath();
    } else {
      // Volume bars (5 segments fill by volume).
      const segs = 5, fillN = Math.round(sfx.volume * segs);
      for (let i = 0; i < segs; i++) {
        g.fillStyle(i < fillN ? 0x6ad0ff : 0x39455a, 1);
        g.fillRect(u.x + 30 + i * 9, iy - 1 - i, 6, 3 + i * 2);
      }
    }
  }

  // ====================================================== POPULATION / HAPPINESS

  createPopulationHud() {
    const fix = (o) => o.setScrollFactor(0);
    const w = 184, h = 22, x = 10, y = 34; // (Phase 3) top-left identity area
    const bg = fix(this.add.rectangle(x, y, w, h, 0x10141c, 0.85).setOrigin(0, 0).setDepth(60).setStrokeStyle(1, 0x39455a, 0.9).setInteractive({ useHandCursor: true }));
    const popT = fix(this.add.text(x + 10, y + 6, 'Pop 10/14', { fontFamily: 'monospace', fontSize: '12px', color: '#dfe6ee', fontStyle: 'bold' }).setDepth(61));
    const faceG = fix(this.add.graphics().setDepth(61));
    const hapT = fix(this.add.text(x + w - 10, y + 6, '60%', { fontFamily: 'monospace', fontSize: '12px', color: '#dfe6ee', fontStyle: 'bold' }).setOrigin(1, 0).setDepth(61));
    this._popHud = { bg, popT, faceG, hapT, x, y, w, h };
    bg.on('pointerover', () => this.showTip(x + w / 2, y + h + 96, `Happiness ${this.population.happiness}%`, this.population.breakdown() + (this.popClasses ? '\n\nClasses: ' + this.popClasses.summary() : ''))); // (V2 P13)
    bg.on('pointerout', () => this.hideTip());
    this.updatePopulationHud();
  }

  updatePopulationHud() {
    const u = this._popHud; if (!u || !this.population) return;
    const p = this.population;
    u.popT.setText(`Pop ${p.count}/${p.capacity()}`);
    u.hapT.setText(`${p.happiness}%`);
    const fx = u.x + u.w / 2 + 8, fy = u.y + u.h / 2;
    const col = p.happiness >= 80 ? 0x4ad66b : p.happiness >= 50 ? 0xe6c84a : p.happiness >= 30 ? 0xe09040 : 0xd64a4a;
    const g = u.faceG; g.clear();
    g.fillStyle(col, 1).fillCircle(fx, fy, 8);
    g.fillStyle(0x10141c, 1).fillCircle(fx - 3, fy - 2, 1.5).fillCircle(fx + 3, fy - 2, 1.5);
    g.lineStyle(1.5, 0x10141c, 1);
    if (p.happiness >= 50) { g.beginPath(); g.arc(fx, fy + 1, 4, 0.15 * Math.PI, 0.85 * Math.PI); g.strokePath(); }
    else if (p.happiness >= 30) { g.beginPath(); g.moveTo(fx - 4, fy + 3); g.lineTo(fx + 4, fy + 3); g.strokePath(); }
    else { g.beginPath(); g.arc(fx, fy + 6, 4, 1.15 * Math.PI, 1.85 * Math.PI); g.strokePath(); }
  }

  // ====================================================== KING IDENTITY / TRAITS

  applyTraitBonuses(traitId) {
    const t = TRAITS[traitId]; if (!t) return;
    Object.assign(this.traitBonuses, t.bonuses || {});
    if (this.armyMgr) this.armyMgr.maxPlayerArmies = this.traitBonuses.armyCap;
  }

  // (Phase 4 Decision 3) Three small stone deposits within 8 tiles of the castle
  // so early-game stone isn't a wall; they run out (20 each) so the player expands.
  spawnStartStone() {
    const c = this.buildings.castle; if (!c || !this.nodes) return;
    let placed = 0;
    const offsets = [[5, 3], [-4, 5], [6, -4], [-5, -3], [3, 6], [-6, 2]];
    for (const [dc, dr] of offsets) {
      if (placed >= 3) break;
      const col = c.col + dc, row = c.row + dr;
      if (col < 0 || row < 0 || col >= N || row >= N) continue;
      if (this.terrainType && this.terrainType[row] && this.terrainType[row][col] === 'water') continue;
      if (this.buildings.isOccupied(col, row)) continue;
      this.nodes.addSmallNode('stone', col, row, 20);
      placed++;
    }
  }

  // Library spawn for the Scholar trait (Phase 5 building; no-op if absent).
  spawnStartingLibrary() {
    if (!BuildingTypes.library) return;
    const c = this.buildings.castle; if (!c) return;
    for (let dc = 3; dc <= 8; dc++) {
      const b = this.buildings.place('library', c.col + dc, c.row - 2, { ignoreStage: true }); // Scholar gift bypasses gating
      if (b) { this.decorateBuilding(b); break; }
    }
  }

  createKingdomNameHud() {
    const fix = (o) => o.setScrollFactor(0);
    // (Visual P6) Top-left kingdom identity = a small carved-wood herald board
    // with a faction-colour banner stripe down the left edge and iron studs.
    const accent = this.factionColor();
    const board = fix(this.add.graphics().setDepth(58));
    const bx = 6, by = 1, bw = 300, bh = 50;
    board.fillStyle(0x000000, 0.4).fillRoundedRect(bx + 2, by + 2, bw, bh, 5);
    // Wood face + grain.
    board.fillStyle(0x3a2817, 0.95).fillRoundedRect(bx, by, bw, bh, 5);
    board.fillStyle(0x4a3520, 0.95).fillRoundedRect(bx, by, bw, 4, 5);
    board.lineStyle(1, 0x271a0e, 0.4);
    for (let gy = by + 6; gy < by + bh - 2; gy += 4) { board.beginPath(); board.moveTo(bx + 10, gy); board.lineTo(bx + bw - 4, gy); board.strokePath(); }
    // Faction banner stripe on the left.
    board.fillStyle(accent, 0.95).fillRect(bx, by, 7, bh);
    board.fillStyle(0xffffff, 0.18).fillRect(bx, by, 7, 3);
    // Accent border + iron studs.
    board.lineStyle(2, accent, 0.7).strokeRoundedRect(bx + 1, by + 1, bw - 2, bh - 2, 5);
    [[bx + bw - 8, by + 8], [bx + bw - 8, by + bh - 8]].forEach(([sx, sy]) => { board.fillStyle(0x53595f, 1).fillCircle(sx, sy, 2.2); board.fillStyle(0x80868c, 0.9).fillCircle(sx - 0.6, sy - 0.6, 0.9); });
    this._idBoard = board;
    // Invisible hit area on top (kept so the click-to-Diplomacy still works).
    this._idBg = fix(this.add.rectangle(6, 1, 300, 50, 0x000000, 0.001).setOrigin(0, 0).setDepth(59).setInteractive({ useHandCursor: true }));
    this._idBg.on('pointerover', () => this._idBg.setFillStyle(0xffe9b0, 0.12));
    this._idBg.on('pointerout', () => this._idBg.setFillStyle(0x000000, 0.001));
    this._idBg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.panelMode = 'kingdoms'; this.refreshPanel(); });
    this._kingName = fix(this.add.text(18, 4, this.kingdomName, { fontFamily: 'monospace', fontSize: '15px', color: '#ffe9b0', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setDepth(60));
    this._kingTitle = fix(this.add.text(18, 22, '', { fontFamily: 'monospace', fontSize: '10px', color: '#d8c79c', fontStyle: 'italic' }).setDepth(60));
    this.updateKingdomTitle();
  }

  updateKingdomTitle() {
    if (!this._kingName) return;
    this._kingName.setText(this.kingdomName);
    const title = (this.reputation && this.reputation.title(this.kingdomName)) || (this.kingTrait && TRAITS[this.kingTrait] ? TRAITS[this.kingTrait].name : '');
    const stage = this.TIERS && this.TIERS[this.tierIndex] ? this.TIERS[this.tierIndex].name : '';
    this._kingTitle.setText(`${this.rulerName}${title ? ' — ' + title : ''}${stage ? '  ·  ' + stage : ''}`);
  }

  // One-time kingdom creation screen (names + starting trait).
  showKingCreation() {
    // (Audit FIX 1) Freeze the whole simulation while the player reads/chooses —
    // no gold accrues, no days pass, no enemies move during creation.
    this._speedBeforeCreation = this.gameSpeed;
    this.gameSpeed = 0;
    const fix = (o) => o.setScrollFactor(0);
    const els = []; const W = 640, H = 460, px = (GAME_W - W) / 2, py = (GAME_H - H) / 2;
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 0.9).setOrigin(0, 0).setDepth(150).setInteractive()));
    els.push(fix(this.add.rectangle(px, py, W, H, 0x1a1410, 0.99).setOrigin(0, 0).setDepth(151).setStrokeStyle(3, 0xc9a14a, 0.9)));
    els.push(fix(this.add.text(GAME_W / 2, py + 16, 'FOUND YOUR KINGDOM', { fontFamily: 'monospace', fontSize: '22px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0).setDepth(152)));
    els.push(fix(this.add.text(px + 30, py + 52, 'Kingdom name:', { fontFamily: 'monospace', fontSize: '13px', color: '#f0e6d0' }).setDepth(152)));
    els.push(fix(this.add.text(px + 30, py + 84, 'Ruler name:', { fontFamily: 'monospace', fontSize: '13px', color: '#f0e6d0' }).setDepth(152)));
    // DOM inputs (fixed-position, centred horizontally — robust to canvas scaling).
    const mk = (top, ph) => { const el = document.createElement('input'); el.type = 'text'; el.placeholder = ph; el.style.cssText = `position:fixed;left:50%;transform:translateX(-50%);top:${top}px;width:280px;padding:6px 8px;font-family:monospace;font-size:14px;z-index:9999;background:#0e1219;color:#fff;border:1px solid #c9a14a;border-radius:4px;`; document.body.appendChild(el); return el; };
    const inK = mk(window.innerHeight / 2 - 150, 'Your Kingdom');
    const inR = mk(window.innerHeight / 2 - 110, 'The King');
    this._kingInputs = [inK, inR];
    this._typing = true;
    inK.addEventListener('focus', () => (this._typing = true)); inR.addEventListener('focus', () => (this._typing = true));
    // Trait cards (2x3).
    let chosen = null; const cards = [];
    const ids = Object.keys(TRAITS);
    ids.forEach((id, i) => {
      const t = TRAITS[id];
      const cw = 190, ch = 96, gx = px + 30 + (i % 3) * (cw + 14), gy = py + 150 + Math.floor(i / 3) * (ch + 12);
      const card = fix(this.add.rectangle(gx, gy, cw, ch, 0x241a0e, 0.98).setOrigin(0, 0).setDepth(152).setStrokeStyle(2, 0x55473a, 0.9).setInteractive({ useHandCursor: true }));
      const ic = fix(this.add.graphics().setDepth(153)); ic.fillStyle(t.color, 1).fillCircle(gx + 22, gy + 24, 12);
      const nm = fix(this.add.text(gx + 42, gy + 12, t.name, { fontFamily: 'monospace', fontSize: '14px', color: '#ffe9b0', fontStyle: 'bold' }).setDepth(153));
      const ds = fix(this.add.text(gx + 10, gy + 44, t.desc.join('\n'), { fontFamily: 'monospace', fontSize: '10px', color: '#cfc1a6', lineSpacing: 2 }).setDepth(153));
      els.push(card, ic, nm, ds); cards.push(card);
      card.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); chosen = id; cards.forEach((c) => c.setStrokeStyle(2, 0x55473a, 0.9)); card.setStrokeStyle(3, 0xffe23f, 1); begin.setFillStyle(0x1f5b3a); });
    });
    const begin = fix(this.add.rectangle(GAME_W / 2 - 90, py + H - 48, 180, 38, 0x39393f).setOrigin(0, 0).setDepth(152).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
    els.push(begin);
    els.push(fix(this.add.text(GAME_W / 2, py + H - 29, 'Begin →', { fontFamily: 'monospace', fontSize: '15px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(153)));
    begin.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); if (!chosen) { this.showToast('Choose a trait'); return; } this.finishKingCreation(inK.value, inR.value, chosen, els); });
    this._kingEls = els;
    this.routeCameras && this.routeCameras();
  }

  finishKingCreation(kingdom, ruler, trait, els) {
    this.kingdomName = (kingdom && kingdom.trim()) || 'Your Kingdom';
    this.rulerName = (ruler && ruler.trim()) || 'The King';
    this.kingTrait = trait;
    try { localStorage.setItem('kg_king', JSON.stringify({ kingdom: this.kingdomName, ruler: this.rulerName, trait })); } catch (e) {}
    this.applyTraitBonuses(trait);
    const t = TRAITS[trait]; if (t && t.oneTime) try { t.oneTime(this); } catch (e) { console.error('[Trait] oneTime failed', e); }
    if (this._kingInputs) { this._kingInputs.forEach((el) => el.remove()); this._kingInputs = null; }
    this._typing = false;
    // (Audit FIX 1) Resume the simulation at the previous speed (default 1x).
    this.gameSpeed = this._speedBeforeCreation != null ? this._speedBeforeCreation : 1;
    this._speedBeforeCreation = null;
    els.forEach((o) => o.destroy()); this._kingEls = null;
    this.updateKingdomTitle();
    this.logEvent && this.logEvent(`${this.kingdomName} founded under ${this.rulerName} (${t ? t.name : '—'})`, 'green');
    // (Phase 11) First-play intro cutscene. On the very first new game (the
    // 'kingdom_intro_seen' flag unset) play the illustrated intro, then show the
    // welcome panel when it finishes. On every later play, the welcome panel
    // shows immediately exactly as before.
    if (!this._noIntro) {
      let seen = true;
      try { seen = !!localStorage.getItem('kingdom_intro_seen'); } catch (e) {}
      if (!seen) {
        this.scene.launch('IntroCutsceneScene', {
          kingdomName: this.kingdomName,
          onComplete: () => { if (this.scene && this.scene.isActive()) this.showWelcomePanel(); },
        });
      } else {
        this.showWelcomePanel();
      }
    }
  }

  // ============================================================ SAVE / LOAD UI

  createMenuButton() {
    const fix = (o) => o.setScrollFactor(0);
    const mx = GAME_W - 46; // (Phase 3) top-right
    const bg = fix(this.add.rectangle(mx, 8, 40, 28, 0x10141c, 0.9).setOrigin(0, 0).setDepth(60).setStrokeStyle(1, 0x39455a, 0.9).setInteractive({ useHandCursor: true }));
    const g = fix(this.add.graphics().setDepth(61));
    g.lineStyle(2.5, 0xdfe6ee, 1);
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(mx + 9, 15 + i * 5); g.lineTo(mx + 27, 15 + i * 5); g.strokePath(); }
    bg.on('pointerover', () => bg.setFillStyle(0x1c2330, 0.95));
    bg.on('pointerout', () => bg.setFillStyle(0x10141c, 0.9));
    bg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); sfx.play('ui_click'); this.openMenu(); });
  }

  // (Expansion Phase 7) Notifications log button — opens the last-50 event log.
  // A small red badge shows how many events arrived since it was last opened.
  createLogButton() {
    const fix = (o) => o.setScrollFactor(0);
    const lx = GAME_W - 90; // (Phase 3) top-right
    const bg = fix(this.add.rectangle(lx, 8, 40, 28, 0x10141c, 0.9).setOrigin(0, 0).setDepth(60).setStrokeStyle(1, 0x39455a, 0.9).setInteractive({ useHandCursor: true }));
    fix(this.add.text(lx + 20, 22, '📜', { fontFamily: 'monospace', fontSize: '15px' }).setOrigin(0.5).setDepth(61));
    const badge = fix(this.add.text(lx + 34, 8, '', { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff', fontStyle: 'bold', backgroundColor: '#c0392b', padding: { x: 3, y: 1 } }).setOrigin(0.5, 0).setDepth(62)).setVisible(false);
    this._logBtnBadge = badge;
    this._logSeen = (this._eventLog || []).length;
    bg.on('pointerover', () => bg.setFillStyle(0x1c2330, 0.95));
    bg.on('pointerout', () => bg.setFillStyle(0x10141c, 0.9));
    bg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); sfx.play('ui_click'); this.toggleLog(); });
    this.updateLogBadge();
  }

  // (Session-1 Phase 6) Stats button (top-left, beside the log) + full overlay.
  createStatsButton() {
    const fix = (o) => o.setScrollFactor(0);
    const sx = GAME_W - 134; // (Phase 3) top-right
    const bg = fix(this.add.rectangle(sx, 8, 40, 28, 0x10141c, 0.9).setOrigin(0, 0).setDepth(60).setStrokeStyle(1, 0x39455a, 0.9).setInteractive({ useHandCursor: true }));
    const g = fix(this.add.graphics().setDepth(61));
    g.fillStyle(0x8ab0e6, 1); g.fillRect(sx + 8, 24, 4, 8); g.fillRect(sx + 14, 20, 4, 12); g.fillRect(sx + 20, 16, 4, 16); g.fillRect(sx + 26, 22, 4, 10);
    bg.on('pointerover', () => bg.setFillStyle(0x1c2330, 0.95));
    bg.on('pointerout', () => bg.setFillStyle(0x10141c, 0.9));
    bg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); sfx.play('ui_click'); this.toggleStats(); });
  }
  toggleStats() { if (this._statsEls) this.closeStats(); else this.openStats(); }
  closeStats() { if (this._statsEls) { this._statsEls.forEach((o) => o.destroy()); this._statsEls = null; } }
  openStats() {
    this.closeStats();
    const fix = (o) => o.setScrollFactor(0).setDepth(118);
    const st = this.stats ? this.stats.s : null;
    const els = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 0.78).setOrigin(0, 0).setInteractive()));
    const W = 760, H = 680, x = (GAME_W - W) / 2, y = (GAME_H - H) / 2;
    // (Visual P6) A carved stone tablet of records, framed in wood.
    els.push(fix(this.stonePanel(x, y, W, H, { seed: 4242 })));
    els.push(fix(this.woodFrame(x, y, W, H, { thickness: 9 })));
    els.push(fix(this.candleGlow(x + 30, y + 30, 60, 0xffdf9e)));
    els.push(fix(this.candleGlow(x + W - 30, y + 30, 60, 0xffdf9e)));
    els.push(fix(this.add.text(x + 20, y + 14, 'KINGDOM STATISTICS', { fontFamily: 'monospace', fontSize: '20px', color: '#ffe9b0', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 })));
    const closeBg = fix(this.add.rectangle(x + W - 32, y + 14, 24, 24, 0x5c1a1a, 0.95).setOrigin(0, 0).setStrokeStyle(1, 0xf0e6c8, 0.6).setInteractive({ useHandCursor: true }));
    els.push(closeBg, fix(this.add.text(x + W - 20, y + 26, 'X', { fontFamily: 'monospace', fontSize: '13px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));
    closeBg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.closeStats(); });

    const sect = (cx, cy, title, rows) => {
      els.push(fix(this.add.text(cx, cy, title, { fontFamily: 'monospace', fontSize: '14px', color: '#ffd24a', fontStyle: 'bold' })));
      rows.forEach((r, i) => {
        const ry = cy + 20 + i * 17;
        els.push(fix(this.add.text(cx, ry, r[0], { fontFamily: 'monospace', fontSize: '12px', color: '#cfc1a6' })));
        els.push(fix(this.add.text(cx + 220, ry, String(r[1]), { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0, 0)));
      });
    };
    const title = (this.reputation && this.reputation.title(this.kingdomName)) || (this.kingTrait && TRAITS[this.kingTrait] ? TRAITS[this.kingTrait].name : '—');
    const g = st ? st.gathered : { wood: 0, stone: 0, food: 0, gold: 0, iron: 0 };
    const settleOwned = this.settlements ? this.settlements.ownedCount() : 0;
    const settleTotal = this.settlements ? this.settlements.total() : 0;
    const techDone = this.research ? this.research.completed.size : 0;
    const L = x + 24, Rc = x + 400; let ly = y + 56;
    sect(L, ly, 'YOUR KINGDOM', [
      ['Kingdom', this.kingdomName], ['Ruler', this.rulerName], ['Title', title],
      ['Days survived', this.gameDay], ['Settlement stage', `${this.currentStage()}/9`],
      ['Population', `${this.population ? this.population.count : 0} (peak ${this.population ? this.population.peak : 0})`],
    ]);
    sect(Rc, ly, 'MILITARY', [
      ['Battles won', st ? st.battlesWon : 0], ['Battles lost', st ? st.battlesLost : 0],
      ['Soldiers trained', st ? st.soldiersTrained : 0], ['Enemies defeated', st ? st.enemiesDefeated : 0],
      ['Settlements conquered', `${settleOwned}/${settleTotal}`],
    ]);
    ly = y + 200;
    sect(L, ly, 'ECONOMY', [
      ['Wood gathered', Math.round(g.wood)], ['Stone gathered', Math.round(g.stone)],
      ['Food gathered', Math.round(g.food)], ['Gold gathered', Math.round(g.gold)], ['Iron gathered', Math.round(g.iron)],
      ['Market trades', st ? st.marketTrades : 0], ['Caravan trades', st ? st.caravanTrades : 0],
      ['Caravans delivered', st ? st.caravansDelivered : 0], ['Expeditions', st ? st.expeditions : 0],
    ]);
    sect(Rc, ly, 'RESEARCH', [
      ['Technologies', `${techDone}/9`],
      ...(this.research ? this.research.techs().filter((t) => this.research.completed.has(t.id)).map((t) => ['  ✓ ' + t.name, '']) : []),
    ]);
    ly = y + 400;
    sect(L, ly, 'DIPLOMACY', (this.kingdoms || []).map((k) => [k.cfg.name, `${this.diplomacy ? this.diplomacy.get(k.cfg.key) : 0}  ${this.diplomacy && this.diplomacy.tr(k.cfg.key).alliance ? '(ally)' : this.diplomacy && this.diplomacy.tr(k.cfg.key).vassal ? '(vassal)' : this.diplomacy && this.diplomacy.tr(k.cfg.key).trade ? '(trade)' : ''}`]));
    sect(Rc, ly, 'DISCOVERIES', [
      ['Ruins explored', `${this.ruins ? this.ruins.exploredCount() : 0}/${this.ruins ? this.ruins.list.length : 0}`],
      ['Settlements found', `${this.discovery ? this.discovery.settlementsDiscovered() : 0}/${settleTotal}`],
      ['Biomes explored', `${this.discovery ? this.discovery.biomesExplored() : 0}/4`],
    ]);
    // (V2 P4 #10) LEGENDS — records from the new V2 systems.
    ly = y + 472;
    sect(L, ly, 'LEGENDS', [
      ['Heroes recruited', st ? st.heroesRecruited : 0], ['Heroes lost', st ? st.heroesLost : 0],
      ['Spies sent', st ? st.spiesSent : 0], ['Spies caught', st ? st.spiesCaught : 0],
    ]);
    sect(Rc, ly, 'LEGACY', [
      ['Buildings burned', st ? st.buildingsBurned : 0], ['Dragons faced', st ? st.dragonsEncountered : 0],
      ['Royal marriages', st ? st.marriagesArranged : 0], ['Advisors defected', st ? st.advisorsDefected : 0],
    ]);
    // Reputation bars at the bottom
    if (this.reputation) {
      const reps: any[] = [['Conqueror', 'conqueror', 0xc0392b], ['Merchant', 'merchant', 0xf1c40f], ['Protector', 'protector', 0x3498db], ['Destroyer', 'destroyer', 0x8e44ad]];
      reps.forEach(([lbl, key, col], i) => {
        const rx = x + 24 + (i % 4) * 180, ry = y + H - 40;
        els.push(fix(this.add.text(rx, ry - 12, lbl, { fontFamily: 'monospace', fontSize: '10px', color: '#cfc1a6' })));
        els.push(fix(this.add.rectangle(rx, ry, 150, 8, 0x000000, 0.5).setOrigin(0, 0)));
        els.push(fix(this.add.rectangle(rx, ry, 150 * Phaser.Math.Clamp(this.reputation.scores[key] / 100, 0, 1), 8, col).setOrigin(0, 0)));
      });
    }
    this._statsEls = els;
    this.routeCameras && this.routeCameras();
  }

  updateLogBadge() {
    if (!this._logBtnBadge) return;
    const unseen = Math.max(0, (this._eventLog || []).length - (this._logSeen || 0));
    this._logBtnBadge.setVisible(unseen > 0 && !this._logOpen).setText(unseen > 9 ? '9+' : String(unseen));
  }

  toggleLog() { if (this._logOpen) this.closeLog(); else this.openLog(); }

  closeLog() { this._logOpen = false; if (this._logEls) { this._logEls.forEach((o) => o.destroy()); this._logEls = null; } this.updateLogBadge(); }

  openLog() {
    this.closeLog();
    this._logOpen = true;
    this._logSeen = (this._eventLog || []).length; // mark all read
    const fix = (o) => o.setScrollFactor(0).setDepth(118);
    const W = 460, H = 420, x = (GAME_W - W) / 2, y = 70;
    const els = [];
    const dim = fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.45).setOrigin(0, 0).setInteractive());
    dim.on('pointerdown', (p, lx, ly, evd) => { evd.stopPropagation(); this.closeLog(); });
    els.push(dim);
    const body = fix(this.add.rectangle(x, y, W, H, 0x12101a, 0.99).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.9).setInteractive());
    body.on('pointerdown', (p, lx, ly, evb) => evb.stopPropagation());
    els.push(body);
    els.push(fix(this.add.text(x + 16, y + 12, '📜 Notifications', { fontFamily: 'monospace', fontSize: '17px', color: '#ffe9b0', fontStyle: 'bold' })));
    const closeBg = fix(this.add.rectangle(x + W - 30, y + 12, 22, 22, 0x5c1a1a, 0.95).setOrigin(0, 0).setStrokeStyle(1, 0xf0e6c8, 0.6).setInteractive({ useHandCursor: true }));
    els.push(closeBg);
    els.push(fix(this.add.text(x + W - 19, y + 23, '✕', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5)));
    closeBg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.closeLog(); });
    const COL = { green: '#7cfc7c', red: '#ff7b7b', info: '#bcd6f0', gold: '#ffe066' };
    const recent = (this._eventLog || []).slice(-50).reverse();
    if (!recent.length) els.push(fix(this.add.text(x + 20, y + 50, 'No events yet.', { fontFamily: 'monospace', fontSize: '13px', color: '#8893a3' })));
    let ly2 = y + 46;
    for (const e of recent) {
      if (ly2 > y + H - 22) break;
      const c = COL[e.kind] || COL.info;
      els.push(fix(this.add.text(x + 16, ly2, `Day ${e.day}`, { fontFamily: 'monospace', fontSize: '11px', color: '#8893a3' })));
      els.push(fix(this.add.text(x + 78, ly2, e.text, { fontFamily: 'monospace', fontSize: '12px', color: c, wordWrap: { width: W - 96 } })));
      ly2 += 22;
    }
    this._logEls = els;
    this.routeCameras && this.routeCameras();
  }

  // (Expansion Phase 7) Pause button — freezes the simulation (gameSpeed 0).
  createPauseButton() {
    const fix = (o) => o.setScrollFactor(0);
    const x = GAME_W - 120 - 34, y = TOP_BAR + 62;
    const bg = fix(this.add.rectangle(x, y, 30, 26, 0x3a2f1a, 0.95).setOrigin(0, 0).setStrokeStyle(2, 0xf0e6c8, 0.7).setDepth(40).setInteractive({ useHandCursor: true }));
    const t = fix(this.add.text(x + 15, y + 13, this._paused ? '▶' : '⏸', { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff' }).setOrigin(0.5).setDepth(41));
    this._pauseBtn = { bg, t };
    bg.on('pointerover', () => bg.setFillStyle(0x5a4a2a, 0.95));
    bg.on('pointerout', () => bg.setFillStyle(this._paused ? 0x6a2a2a : 0x3a2f1a, 0.95));
    bg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.togglePause(); });
  }

  togglePause() {
    this._paused = !this._paused;
    if (this._paused) { this._speedBeforePause = this.gameSpeed || 1; this.gameSpeed = 0; }
    else { this.gameSpeed = this._speedBeforePause || 1; }
    if (this._pauseBtn) { this._pauseBtn.t.setText(this._paused ? '▶' : '⏸'); this._pauseBtn.bg.setFillStyle(this._paused ? 0x6a2a2a : 0x3a2f1a, 0.95); }
    this.showToast(this._paused ? '⏸ Paused' : '▶ Resumed');
  }

  // (Expansion Phase 7) Keyboard shortcuts. Suppressed while typing (king name)
  // or while the pause menu is open (except Escape/M which manage the menu).
  setupHotkeys() {
    const kb = this.input.keyboard;
    const tab = (mode) => { if (this._typing || this._menuOpen) return; if (this.panelMode === mode) return; this.onTabClick(mode); };
    kb.on('keydown-SPACE', (e) => { if (this._typing || this._menuOpen) return; if (e && e.preventDefault) e.preventDefault(); this.togglePause(); });
    kb.on('keydown-B', () => tab('build'));
    kb.on('keydown-E', () => tab('expedition'));
    kb.on('keydown-K', () => tab('kingdoms'));
    kb.on('keydown-A', () => tab('armies'));
    kb.on('keydown-R', () => tab('research'));
    kb.on('keydown-L', () => { if (this._typing) return; this.toggleLog(); });
    kb.on('keydown-M', () => { if (this._typing) return; if (this._menuOpen) this.closeMenu(); else this.openMenu(); });
    kb.on('keydown-ONE', () => this.quickSelectArmy(0));
    kb.on('keydown-TWO', () => this.quickSelectArmy(1));
    kb.on('keydown-THREE', () => this.quickSelectArmy(2));
  }

  // (Expansion Phase 7) Number keys 1-3 select a player army and pan to it.
  quickSelectArmy(idx) {
    if (this._typing || this._menuOpen || !this.armyMgr) return;
    const a = this.armyMgr.playerArmies()[idx];
    if (!a) { this.showToast(`No army #${idx + 1}`); return; }
    this.armyMgr.selectArmy(a);
    const { x, y } = this.tileCenter(Math.round(a.col), Math.round(a.row));
    this.cameras.main.pan(x, y, 350, 'Sine.easeInOut');
    this.panelMode = 'armies';
    this.refreshPanel();
  }

  showSavingIndicator() {
    const fix = (o) => o.setScrollFactor(0).setDepth(120);
    if (this._savingEls) this._savingEls.forEach((o) => o.destroy());
    const x = GAME_W - 120, y = 90;
    const bg = fix(this.add.rectangle(x, y, 108, 26, 0x10300f, 0.95).setOrigin(0, 0).setStrokeStyle(1, 0x4ad66b, 0.8));
    const t = fix(this.add.text(x + 54, y + 13, 'Saving…', { fontFamily: 'monospace', fontSize: '13px', color: '#bdf0c4', fontStyle: 'bold' }).setOrigin(0.5));
    this._savingEls = [bg, t];
    this.routeCameras && this.routeCameras();
    this.time.delayedCall(1000, () => { if (this._savingEls) { this._savingEls.forEach((o) => o.destroy()); this._savingEls = null; } });
  }

  showLoadedBanner(day) {
    const fix = (o) => o.setScrollFactor(0).setDepth(120);
    const t = fix(this.add.text(GAME_W / 2, 120, `Kingdom Loaded — Day ${day}`, { fontFamily: 'monospace', fontSize: '22px', color: '#ffe9a8', fontStyle: 'bold', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5));
    this.routeCameras && this.routeCameras();
    this.tweens.add({ targets: t, alpha: 0, delay: 1500, duration: 600, onComplete: () => t.destroy() });
  }

  autoSave() {
    const res = SaveManager.save(this, 0);
    if (res.ok) this.showSavingIndicator();
    else this.showToast(res.error || 'Auto-save failed');
  }

  quickSave() {
    const res = SaveManager.save(this, 1);
    if (res.ok) { this.showSavingIndicator(); this.showToast('Saved to slot 1'); }
    else this.showToast(res.error || 'Save failed');
  }

  saveSlot(slot) { return SaveManager.save(this, slot); }
  loadSlot(slot) { return SaveManager.requestLoad(this, slot); }

  openMenu() { this._menuOpen = true; this.gameSpeedBeforeMenu = this.gameSpeed; this.gameSpeed = 0; this.renderMenu('main'); }
  closeMenu() {
    this._menuOpen = false;
    if (this.gameSpeedBeforeMenu != null) this.gameSpeed = this.gameSpeedBeforeMenu;
    if (this._menuEls) this._menuEls.forEach((o) => o.destroy());
    this._menuEls = null;
  }

  renderMenu(screen) {
    if (this._menuEls) this._menuEls.forEach((o) => o.destroy());
    const fix = (o) => o.setScrollFactor(0);
    const els = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 0.82).setOrigin(0, 0).setDepth(100).setInteractive()));
    const panelW = 560, panelH = 440, px = (GAME_W - panelW) / 2, py = (GAME_H - panelH) / 2;
    // (Visual P6) The menu (and Win Progress) is a wood-framed ledger object.
    els.push(fix(this.leatherPanel(px, py, panelW, panelH, { radius: 6, seed: 555 }).setDepth(101)));
    els.push(fix(this.woodFrame(px, py, panelW, panelH, { thickness: 8 }).setDepth(101)));
    els.push(fix(this.candleGlow(px + 28, py + 28, 56, 0xffdf9e).setDepth(101)));
    els.push(fix(this.candleGlow(px + panelW - 28, py + 28, 56, 0xffdf9e).setDepth(101)));
    els.push(fix(this.add.text(GAME_W / 2, py + 22, 'KINGDOM GAME', { fontFamily: 'monospace', fontSize: '26px', color: '#ffe9b0', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(102)));
    this._menuEls = els;

    const btn = (label: any, x: number, y: number, w: number, h: number, onClick: any, color?: number) => {
      const b = fix(this.add.rectangle(x, y, w, h, color || 0x2d6cb0).setOrigin(0, 0).setDepth(102).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
      const t = fix(this.add.text(x + w / 2, y + h / 2, label, { fontFamily: 'monospace', fontSize: '15px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(103));
      b.on('pointerover', () => b.setFillStyle((color || 0x2d6cb0) + 0x111111));
      b.on('pointerout', () => b.setFillStyle(color || 0x2d6cb0));
      b.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); sfx.play('ui_click'); onClick(); });
      els.push(b, t);
      return b;
    };
    const text = (s: any, x: number, y: number, opts: any = {}) => { const t = fix(this.add.text(x, y, s, { fontFamily: 'monospace', fontSize: opts.size || '13px', color: opts.color || '#dfe6ee', fontStyle: opts.bold ? 'bold' : 'normal', wordWrap: opts.wrap ? { width: opts.wrap } : undefined }).setOrigin(opts.ox || 0, 0).setDepth(102)); els.push(t); return t; };

    if (screen === 'main') {
      const bx = px + 180, bw = 200; let y = py + 80;
      btn('Continue', bx, y, bw, 44, () => this.closeMenu()); y += 50;
      btn('Win Progress', bx, y, bw, 44, () => this.renderMenu('winprogress')); y += 50; // (Completion Phase 11)
      btn('Save Game', bx, y, bw, 44, () => this.renderMenu('save')); y += 50;
      btn('Load Game', bx, y, bw, 44, () => this.renderMenu('load')); y += 50;
      btn('Settings', bx, y, bw, 44, () => this.renderMenu('settings')); y += 50;
      btn('New Game', bx, y, bw, 44, () => this.renderMenu('newgame'), 0x8a3a3a);
    } else if (screen === 'winprogress') {
      // (Completion Phase 11) Progress toward all three victory paths.
      text('PATHS TO VICTORY', GAME_W / 2, py + 56, { ox: 0.5, bold: true, size: '18px', color: '#ffe9b0' });
      const wc = this.winConditions;
      const have = wc ? wc.playerControlled() : 0, total = wc ? wc.totalSettlements() : 0, need = Math.ceil(total * 0.75);
      const aliveK = (this.kingdoms || []).filter((k) => k.castleAlive);
      const allied = this.diplomacy ? aliveK.filter((k) => this.diplomacy.get(k.cfg.key) >= 80).length : 0;
      const stage = this.currentStage(), pop = this.population ? this.population.count : 0, techs = this.research ? this.research.completed.size : 0, happyDays = wc ? wc.legacyHappyDays : 0;
      const card = (y, title, lines, done) => {
        els.push(fix(this.add.rectangle(px + 24, y, panelW - 48, 96, 0x0e1219, 0.95).setOrigin(0, 0).setDepth(102).setStrokeStyle(2, done ? 0x4ad66b : 0x39455a, 0.9)));
        text(title, px + 38, y + 8, { bold: true, color: done ? '#9af0a0' : '#ffe9b0', size: '15px' });
        lines.forEach((ln, i) => text(ln, px + 38, y + 32 + i * 18, { color: '#cfc1a6', size: '12px' }));
      };
      card(py + 84, '⚔ Conquest', [`Settlements: ${have}/${total}  (need ${need} = 75%)`, have >= need ? 'ACHIEVED — you rule the continent!' : `${need - have} more to claim victory`], total > 0 && have >= need);
      card(py + 186, '🕊 Diplomacy', [`Alliances (+80): ${allied}/${Math.max(1, aliveK.length)} surviving kingdoms`, allied >= aliveK.length && aliveK.length >= 1 ? 'ACHIEVED — the continent is united!' : 'Ally with every surviving kingdom'], allied >= aliveK.length && aliveK.length >= 1);
      card(py + 288, '👑 Legacy', [`Stage ${stage}/7 · Pop ${pop}/50 · Techs ${techs}/5`, `Happy days ${happyDays}/5 in a row`], stage >= 7 && pop >= 50 && techs >= 5 && happyDays >= 5);
      btn('Back', px + panelW / 2 - 60, py + panelH - 44, 120, 36, () => this.renderMenu('main'));
    } else if (screen === 'save' || screen === 'load') {
      text(screen === 'save' ? 'SAVE GAME' : 'LOAD GAME', GAME_W / 2, py + 56, { ox: 0.5, bold: true, size: '16px', color: '#ffe9b0' });
      const slots = SaveManager.listSlots();
      slots.forEach((s, i) => {
        const sy = py + 88 + i * 88, sx = px + 24, sw = panelW - 48;
        els.push(fix(this.add.rectangle(sx, sy, sw, 78, 0x0e1219, 0.9).setOrigin(0, 0).setDepth(102).setStrokeStyle(1, 0x39455a, 0.9)));
        const label = i === 0 ? 'Slot 0 — Auto-save' : `Slot ${i}`;
        text(label, sx + 12, sy + 8, { bold: true, color: '#cfe0ff' });
        if (s.empty) text('Empty Slot', sx + 12, sy + 32, { color: '#8893a3' });
        else if (s.corrupted) text('⚠ Corrupted save', sx + 12, sy + 32, { color: '#ff8a80' });
        else {
          text(`${s.tier} · Day ${s.day}`, sx + 12, sy + 30, { color: '#f0e6d0' });
          const when = new Date(s.timestamp).toLocaleString();
          text(`${when}  ·  ${s.playMin || 0} min played`, sx + 12, sy + 50, { color: '#9aa0a6', size: '11px' });
        }
        if (screen === 'save' && i !== 0) {
          btn('Save Here', sx + sw - 220, sy + 24, 104, 30, () => { const r = SaveManager.save(this, i); if (r.ok) { this.showToast('Saved to slot ' + i); this.renderMenu('save'); } else this.showToast(r.error); }, 0x1f5b3a);
        }
        if (screen === 'load' && !s.empty && !s.corrupted) {
          btn('Load', sx + sw - 220, sy + 24, 104, 30, () => this.confirmAction(`Load slot ${i}? Current progress will be lost.`, () => { this.closeMenu(); SaveManager.requestLoad(this, i); }), 0x2d6cb0);
        }
        if (!s.empty) btn('Delete', sx + sw - 108, sy + 24, 92, 30, () => this.confirmAction(`Delete slot ${i}?`, () => { SaveManager.deleteSlot(i); this.renderMenu(screen); }), 0x6a2a2a);
      });
      btn('Back', px + panelW / 2 - 60, py + panelH - 48, 120, 36, () => this.renderMenu('main'));
    } else if (screen === 'settings') {
      text('SETTINGS', GAME_W / 2, py + 56, { ox: 0.5, bold: true, size: '16px', color: '#ffe9b0' });
      let y = py + 96;
      text(`Master Volume: ${Math.round(sfx.volume * 100)}%`, px + 40, y, { bold: true }); els[els.length - 1].setName('volLabel');
      btn('–', px + 320, y - 4, 40, 26, () => { sfx.setVolume(sfx.volume - 0.1); this.renderMenu('settings'); });
      btn('+', px + 370, y - 4, 40, 26, () => { sfx.setVolume(sfx.volume + 0.1); this.renderMenu('settings'); });
      y += 50;
      btn(sfx.muted ? 'Sound: OFF' : 'Sound: ON', px + 40, y - 4, 200, 30, () => { sfx.toggleMute(); this.drawSoundControl(); this.renderMenu('settings'); }, sfx.muted ? 0x6a2a2a : 0x1f5b3a);
      y += 50;
      const freq = this._autoSaveEveryDays;
      text(`Auto-save: ${freq === 0 ? 'Off' : 'Every ' + freq + ' days'}`, px + 40, y, { bold: true });
      const cycle = () => { const opts = [3, 5, 10, 0]; this._autoSaveEveryDays = opts[(opts.indexOf(freq) + 1) % opts.length]; this.renderMenu('settings'); };
      btn('Change', px + 320, y - 4, 90, 26, cycle);
      y += 50;
      text(`Tooltips: ${this._tooltipsOff ? 'Off' : 'On'}`, px + 40, y, { bold: true });
      btn('Toggle', px + 320, y - 4, 90, 26, () => { this._tooltipsOff = !this._tooltipsOff; this.renderMenu('settings'); });
      btn('Back', px + panelW / 2 - 60, py + panelH - 48, 120, 36, () => this.renderMenu('main'));
    } else if (screen === 'newgame') {
      text('Start a new game?', GAME_W / 2, py + 140, { ox: 0.5, bold: true, size: '18px', color: '#ffe9b0' });
      text('All unsaved progress will be lost.', GAME_W / 2, py + 175, { ox: 0.5, color: '#f0e6d0' });
      btn('Yes, New Game', px + 90, py + 240, 170, 44, () => { this.closeMenu(); SaveManager.consumePending(); this.scene.restart(); }, 0x8a3a3a);
      btn('Cancel', px + 300, py + 240, 170, 44, () => this.renderMenu('main'));
    }
    this.routeCameras && this.routeCameras();
  }

  // Small in-menu confirmation dialog.
  confirmAction(msg, onYes) {
    const fix = (o) => o.setScrollFactor(0);
    const els = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.5).setOrigin(0, 0).setDepth(130).setInteractive()));
    const W = 440, H = 150, x = (GAME_W - W) / 2, y = (GAME_H - H) / 2;
    els.push(fix(this.add.rectangle(x, y, W, H, 0x1a120a, 0.99).setOrigin(0, 0).setDepth(131).setStrokeStyle(2, 0xc9a14a, 0.95)));
    els.push(fix(this.add.text(GAME_W / 2, y + 30, msg, { fontFamily: 'monospace', fontSize: '14px', color: '#f0e6d0', align: 'center', wordWrap: { width: W - 40 } }).setOrigin(0.5, 0).setDepth(132)));
    const close = () => els.forEach((o) => o.destroy());
    const mk = (label, bx, color, fn) => {
      const b = fix(this.add.rectangle(bx, y + H - 46, 160, 34, color).setOrigin(0, 0).setDepth(132).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
      const t = fix(this.add.text(bx + 80, y + H - 29, label, { fontFamily: 'monospace', fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(133));
      b.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); close(); fn(); });
      els.push(b, t);
    };
    mk('Confirm', x + 30, 0x1f5b3a, onYes);
    mk('Cancel', x + W - 190, 0x2d4a6b, () => {});
    this.routeCameras && this.routeCameras();
  }

  // ---- Input (left-click place / box-select; covers the whole iso world) ---

  setupInput() {
    const inBand = (p) => p.y >= TOP_BAR && p.y <= GAME_H - PANEL_H;

    const zone = this.add.zone(0, 0, WORLD_W, WORLD_H).setOrigin(0, 0).setInteractive();
    zone.on('pointerdown', (p) => {
      if (this.isGameOver || !p.leftButtonDown() || !inBand(p)) return;
      if (this.movingBuilding) { // (Gameplay change 2) drop the building being moved
        const tile = this.pointerToTile(p.worldX, p.worldY);
        if (tile) this.confirmMoveBuilding(tile);
        return;
      }
      if (this.placementType) {
        const tile = this.pointerToTile(p.worldX, p.worldY);
        if (tile) this.tryBuild(this.placementType, tile);
        return;
      }
      this.boxSel = { sx: p.worldX, sy: p.worldY, active: true };
    });

    this.input.on('pointermove', (p) => {
      if (this.boxSel && this.boxSel.active && p.leftButtonDown()) this.drawBoxSelect(p.worldX, p.worldY);
    });
    this.input.on('pointerup', (p) => {
      if (!this.boxSel || !this.boxSel.active) return;
      const a = this.boxSel;
      this.boxSel.active = false;
      if (this.boxRect) this.boxRect.clear();
      if (Phaser.Math.Distance.Between(a.sx, a.sy, p.worldX, p.worldY) < 8) {
        this.deselectAllUnits();
        if (this.selectedBuilding) {
          this.selectedBuilding = null;
          this.clearSelection();
          this.refreshPanel();
        }
      } else {
        this.selectUnitsInBox(a.sx, a.sy, p.worldX, p.worldY);
      }
    });

    this.input.on('pointermove', (p) => this.updatePlacementGhost(p));
  }

  // ---- Placement ghost (iso diamond footprint + translucent building) ------

  updatePlacementGhost(p) {
    // (Gameplay change 2) The ghost also drives "move building" mode.
    const type = this.placementType || (this.movingBuilding && this.movingBuilding.typeKey);
    if (!type) { this.clearGhost(); return; }
    const inBand = p.y >= TOP_BAR && p.y <= GAME_H - PANEL_H;
    const tile = inBand ? this.pointerToTile(p.worldX, p.worldY) : null;
    if (!tile) { this.clearGhost(); return; }

    const fp = this.footprintSize(type);
    const half = Math.floor(fp / 2);
    const c0 = tile.col - half, c1 = c0 + fp - 1, r0 = tile.row - half, r1 = r0 + fp - 1;
    let valid = true;
    for (const cell of this.footprintCells(type, tile.col, tile.row)) {
      // When moving, a tile occupied by the building being moved is fine.
      const occ = this.buildings.isOccupied(cell.c, cell.r) && !(this.movingBuilding && this.buildings.grid[cell.r] && this.buildings.grid[cell.r][cell.c] === this.movingBuilding);
      if (cell.c < 0 || cell.r < 0 || cell.c >= this.COLS || cell.r >= this.ROWS || !this.withinBuildArea(type, cell.c, cell.r) || occ) {
        valid = false;
        break;
      }
    }

    if (!this.ghostG) {
      this.ghostG = this.add.graphics().setDepth(30);
      this.ghostImg = this.add.image(0, 0, type).setDepth(30.5).setAlpha(0.6).setOrigin(0.5, 1.0);
    }
    const color = valid ? 0x66ff88 : 0xff6666;
    const pts = this.regionDiamond(c0, c1, r0, r1);
    this.ghostG.clear();
    this.ghostG.fillStyle(color, 0.22);
    this.strokeDiamond(this.ghostG, pts);
    this.ghostG.fillPath();
    this.ghostG.lineStyle(2, color, 0.9);
    this.strokeDiamond(this.ghostG, pts);
    this.ghostG.strokePath();
    this.ghostG.setVisible(true);

    // Anchor the preview sprite where the building will actually land: the south
    // corner of the southernmost footprint tile (matches decorateBuilding).
    let south = { c: tile.col, r: tile.row };
    for (const cell of this.footprintCells(type, tile.col, tile.row)) {
      if (cell.c + cell.r > south.c + south.r) south = { c: cell.c, r: cell.r };
    }
    const sc = this.tileSouthCorner(south.c, south.r);
    if (this.ghostImg.texture.key !== type) this.ghostImg.setTexture(type);
    const scale = fp === 3 ? 2.0 : fp === 2 ? 1.5 : 1.0;
    this.ghostImg.setScale(scale).setPosition(sc.x, sc.y).setTint(valid ? 0xffffff : 0xff6666).setVisible(true);
  }

  clearGhost() {
    if (this.ghostG) this.ghostG.setVisible(false);
    if (this.ghostImg) this.ghostImg.setVisible(false);
  }

  // ---- (Gameplay change 2) Move + demolish placed buildings -----------------

  startMoveBuilding(b) {
    if (!b || b.typeKey === 'castle') return;
    this.movingBuilding = b;
    this.placementType = null;
    b.rect.setAlpha(0.5);
    if (b._floatIcon) b._floatIcon.setVisible(false);
    this.selectedBuilding = null;
    this.clearSelection();
    this.refreshPanel();
    this.showToast('Move mode — click a green tile to place, Esc to cancel');
  }

  cancelMoveBuilding() {
    const b = this.movingBuilding;
    if (!b) return;
    this.movingBuilding = null;
    if (b.rect) b.rect.setAlpha(1);
    if (b._floatIcon) b._floatIcon.setVisible(true);
    this.clearGhost();
    this.refreshPanel();
  }

  confirmMoveBuilding(tile) {
    const b = this.movingBuilding;
    if (!b) return;
    // Validate the whole footprint at the drop location (ignoring the building's
    // own current cells), using the same rules as placement.
    for (const cell of this.footprintCells(b.typeKey, tile.col, tile.row)) {
      const occupiedByOther = this.buildings.isOccupied(cell.c, cell.r) && this.buildings.grid[cell.r] && this.buildings.grid[cell.r][cell.c] !== b;
      const water = this.terrainType && this.terrainType[cell.r] && this.terrainType[cell.r][cell.c] === 'water';
      if (cell.c < 0 || cell.r < 0 || cell.c >= this.COLS || cell.r >= this.ROWS || !this.withinBuildArea(b.typeKey, cell.c, cell.r) || occupiedByOther || water) {
        this.showToast('Cannot move there');
        return;
      }
    }
    this.relocateBuilding(b, tile.col, tile.row);
    this.movingBuilding = null;
    this.clearGhost();
    if (b.rect) b.rect.setAlpha(1);
    sfx.play('building_placed');
    this.selectBuilding(b); // reselect so the panel (with Move/Demolish) returns
  }

  // Re-place a building on new tiles, reusing the existing anchor/footprint math
  // (decorateBuilding). Frees the old footprint cells first; workers are untouched.
  relocateBuilding(b, col, row) {
    for (const cell of (b._cells || [])) if (this.buildings.grid[cell.r] && this.buildings.grid[cell.r][cell.c] === b) this.buildings.grid[cell.r][cell.c] = null;
    b.col = col; b.row = row;
    b._isoDone = false; // force decorateBuilding to recompute anchor + cells + regrid
    if (b._floatIcon) { b._floatIcon.destroy(); b._floatIcon = null; }
    if (b._snowCap) { b._snowCap.destroy(); b._snowCap = null; }
    this.decorateBuilding(b);
    this.placeFX(b);
    if (this.territory) this.territory.recompute();
  }

  // (V2 Phase 6) Destroy a building lost to fire or disaster — no refund, with
  // a smoke puff. Mirrors demolishBuilding's footprint cleanup.
  razeBuilding(b) {
    if (!b || b.typeKey === 'castle') return;
    if (b._fireFx) { b._fireFx.destroy(); b._fireFx = null; }
    for (const cell of (b._cells || [])) if (this.buildings.grid[cell.r] && this.buildings.grid[cell.r][cell.c] === b) this.buildings.grid[cell.r][cell.c] = null;
    if (this.buildings.grid[b.row] && this.buildings.grid[b.row][b.col] === b) this.buildings.grid[b.row][b.col] = null; // anchor (covers 1×1 without _cells)
    if (b._floatIcon) { b._floatIcon.destroy(); b._floatIcon = null; }
    if (b._snowCap) { b._snowCap.destroy(); b._snowCap = null; }
    this.hideBuildingName && this.hideBuildingName(b);
    if (this.floatText) this.floatText(b.x, b.y - 30, '💨 rubble', '#9a8f80');
    this.razeFxAt(b.x, b.y); // (Visual P7) flame burst + chips + smoke at the raze site
    b.destroy();
    if (this.selectedBuilding === b) { this.selectedBuilding = null; this.clearSelection(); }
    if (this.territory) this.territory.recompute();
    this.refreshPanel();
  }

  demolishBuilding(b) {
    if (!b || b.typeKey === 'castle') return;
    const def = BuildingTypes[b.typeKey];
    // Refund 50% of the build cost (rounded down).
    if (def && def.cost) {
      for (const [r, v] of Object.entries(def.cost)) if (v > 0) this.resources.add(r, Math.floor(v * 0.5));
    }
    if (this.floatText) this.floatText(b.x, b.y - 40, `Demolished ${def ? def.name : ''} (+50%)`, '#ffd23f');
    // Free the WHOLE footprint (Buildings.remove only frees the anchor cell).
    for (const cell of (b._cells || [])) if (this.buildings.grid[cell.r] && this.buildings.grid[cell.r][cell.c] === b) this.buildings.grid[cell.r][cell.c] = null;
    if (b._floatIcon) { b._floatIcon.destroy(); b._floatIcon = null; }
    if (b._snowCap) { b._snowCap.destroy(); b._snowCap = null; }
    this.hideBuildingName && this.hideBuildingName(b);
    b.destroy(); // sprites + alive=false; reap() then drops it from the array & lowers the worker cap (Houses)
    this.selectedBuilding = null;
    this.clearSelection();
    if (this.territory) this.territory.recompute();
    this.refreshPanel();
  }

  // ---- Selection outline (iso diamond around the footprint) ----------------

  // (FIX 5) Selection highlight = a bright diamond on each tile the building
  // occupies, sitting on the tile surface (not a floating rectangle).
  showSelection(b) {
    this.clearSelection();
    const g = this.add.graphics().setDepth(30);
    const cells = b._cells && b._cells.length ? b._cells : this.footprintCells(b.typeKey, b.col, b.row);
    for (const cell of cells) {
      const pts = this.regionDiamond(cell.c, cell.c, cell.r, cell.r);
      g.fillStyle(0xffe23f, 0.14);
      this.strokeDiamond(g, pts);
      g.fillPath();
      g.lineStyle(2.5, 0xffe23f, 0.95);
      this.strokeDiamond(g, pts);
      g.strokePath();
    }
    if (b.type.attack) {
      const rng = b.type.range * this.TILE;
      g.fillStyle(0x2980b9, 0.12).fillCircle(b.x, b.y, rng);
      g.lineStyle(1, 0x5dade2, 0.6).strokeCircle(b.x, b.y, rng);
    }
    this.selectGfx = g;
  }

  // ---- Settlement tiers (swap the castle to the matching iso fort) ---------

  currentStage() { return this.TIERS[this.tierIndex].stage; }

  // (Phase 8) Building cap = the tier's maxBuildings, OVERRIDDEN to 50 at stage 9
  // for the home settlement (LateGame.buildingCap()). For non-home / lower-stage
  // settlements we use the per-tier value. This is the single place the build
  // panel + canPlace() read the cap, so the stage-9 raise applies everywhere.
  maxBuildings() {
    const tierMax = (this.TIERS[this.tierIndex] && this.TIERS[this.tierIndex].maxBuildings) || 8;
    // Only the player's home castle benefits from the stage-9 raise.
    if (this._settle && this._settle.faction === 'player') {
      const override = LateGame.buildingCap(); // 0 below stage 9
      if (override > 0) return Math.max(tierMax, override);
    }
    return tierMax;
  }

  upgradeTier() {
    if (this.tierIndex >= this.TIERS.length - 1) return;
    const next = this.TIERS[this.tierIndex + 1];
    if (!this.resources.spend(next.cost)) return;
    this.tierIndex += 1;
    sfx.play('tier_upgrade'); // (Polish Phase 2)
    try { sfx.play('settlement_upgrade'); } catch (e) {} // (Polish Phase 10) triumphant horn over the chime
    this.cameras.main.shake(380, 0.008); // (Feel pass) dramatic settlement-upgrade shake

    const castle = this.buildings.castle;
    if (castle) {
      if (next.tex && this.textures.exists(next.tex)) castle.rect.setTexture(next.tex);
      castle.rect.setOrigin(0.5, 1.0).setScale(castle.baseScale * next.castleScale);
      castle.rect.clearTint();
      const by = castle.y - castle.baseScale * next.castleScale * 48;
      this.castleBarBg.y = by;
      this.castleBarFill.y = by;
      this.tierUpFx(castle.x, castle.y); // (Visual P7) showpiece gold burst + confetti + flash
    }
    if (next.wall) this.drawWall(next.wall, next.moat, next.towers);
    if (this.territory) this.territory.addTierBonus();
    if (next.announce) this.announce(next.announce);
    this.refreshPanel();
  }

  // (Save system) Apply a tier's visuals without spending — used on load.
  restoreTier(tierIndex) {
    this.tierIndex = Math.max(0, Math.min(this.TIERS.length - 1, tierIndex));
    const t = this.TIERS[this.tierIndex];
    const castle = this.buildings.castle;
    if (castle) {
      if (t.tex && this.textures.exists(t.tex)) castle.rect.setTexture(t.tex);
      castle.rect.setOrigin(0.5, 1.0).setScale(castle.baseScale * (t.castleScale || 1)).clearTint();
      const by = castle.y - castle.baseScale * (t.castleScale || 1) * 48;
      if (this.castleBarBg) this.castleBarBg.y = by;
      if (this.castleBarFill) this.castleBarFill.y = by;
    }
    if (t.wall) this.drawWall(t.wall, t.moat, t.towers);
    if (this.territory) for (let i = 0; i < this.tierIndex; i++) this.territory.addTierBonus();
  }

  // Visual-only iso diamond perimeter around the build zone, styled per stage
  // (fence → wood → stone), with an optional moat and corner towers.
  drawWall(type: any, moat?: any, towers?: any) {
    if (this.wallGfx) this.wallGfx.destroy();
    const g = this.add.graphics().setDepth(28);
    const z = this.BZ;
    const pts = this.regionDiamond(z.c0, z.c1, z.r0, z.r1);
    if (moat) { // outer blue ring
      const mp = this.regionDiamond(z.c0 - 1, z.c1 + 1, z.r0 - 1, z.r1 + 1);
      g.lineStyle(7, 0x3f6fa0, 0.55); this.strokeDiamond(g, mp); g.strokePath();
    }
    const style = { fence: [0x8b5a2b, 2], wood: [0x8b5a2b, 3], stonebase: [0x8a7a5a, 4], stone: [0x9a9a9a, 5] }[type] || [0x9a9a9a, 4];
    g.lineStyle(style[1], style[0], type === 'fence' ? 0.7 : 0.95);
    this.strokeDiamond(g, pts);
    g.strokePath();
    if (towers) { for (const p of pts) { g.fillStyle(0x9a9a9a, 0.95).fillCircle(p.x, p.y, 4); g.lineStyle(1, 0x5a5a5a, 1).strokeCircle(p.x, p.y, 4); } }
    this.wallGfx = g;
  }

  // ---- Enemy pathfinding in iso space --------------------------------------

  computeEnemyPath(enemy) {
    const castle = this.buildings.castle;
    if (!castle || !castle.alive) return null;
    const t = this.screenToTile(enemy.x, enemy.y);
    const col = Phaser.Math.Clamp(t.col, 0, this.COLS - 1);
    const row = Phaser.Math.Clamp(t.row, 0, this.ROWS - 1);
    // (Phase B) On the huge map, only run A* once the enemy is near the base
    // (the wilderness is open) — long-distance A* would be far too expensive.
    if (Phaser.Math.Distance.Between(col, row, castle.col, castle.row) > 28) return null; // march straight
    const blocked = this.buildings.blockedGrid();
    const path = findPath(blocked, { col, row }, { col: castle.col, row: castle.row });
    if (!path) return null;
    return path.slice(1).map((tt) => this.tileCenter(tt.col, tt.row));
  }

  edgeSpawnPoint(edge) {
    const map = { 0: [N / 2, 0], 1: [N - 1, N / 2], 2: [N / 2, N - 1], 3: [0, N / 2] };
    const [c, r] = map[edge] || [0, 0];
    return this.tileCenter(Math.floor(c), Math.floor(r));
  }

  // BUG 3 / Phase 6: enemies now spawn AT their own faction's castle inside
  // AIKingdom.launchWave(), so this just marks each new enemy once and primes a
  // fresh A* path toward the player castle (no repositioning — that would drag
  // Purple/Yellow troops to the Red castle).
  reconcileEnemySpawns() {
    for (const e of this.waves.enemies) {
      if (e._spawnPinned) continue;
      e._spawnPinned = true;
      e.path = null;
      e.pathIdx = 0;
    }
  }

  // ---- Minimap (iso world shown as a top-down grid of dots) ----------------

  updateMinimap() {
    const g = this.minimapGfx;
    if (!g) return;
    const m = this.MM;
    const toX = (col) => m.x + (col / (N - 1)) * m.w;
    const toY = (row) => m.y + (row / (N - 1)) * m.h;
    const tileOf = (wx, wy) => this.screenToTile(wx, wy);
    g.clear();

    g.fillStyle(0x4caf50, 1);
    for (const n of this.nodes.nodes) {
      if (!n.alive) continue;
      const t = tileOf(n.x, n.y);
      g.fillRect(toX(t.col) - 1, toY(t.row) - 1, 2, 2);
    }
    for (const k of this.kingdoms || []) {
      g.fillStyle(k.cfg.color, 1);
      for (const b of k.buildings) {
        const t = tileOf(b.sprite.x, b.sprite.y);
        g.fillRect(toX(t.col) - 1, toY(t.row) - 1, 3, 3);
      }
      if (k.castleAlive) {
        const t = tileOf(k.castleX, k.castleY);
        g.fillRect(toX(t.col) - 2, toY(t.row) - 2, 5, 5);
      }
    }
    g.fillStyle(0x42a5f5, 1);
    for (const b of this.buildings.buildings) {
      if (b.typeKey === 'castle') continue;
      g.fillRect(toX(b.col) - 1, toY(b.row) - 1, 3, 3);
    }
    const c = this.buildings.castle;
    if (c) {
      g.fillStyle(0x00e5ff, 1);
      g.fillRect(toX(c.col) - 2, toY(c.row) - 2, 5, 5);
    }

    // (V2 P4 #7) Goblin camps — colour by escalation tier (green→orange→red).
    if (this.goblinCamps) {
      for (const cmp of this.goblinCamps.list) {
        if (!cmp.alive || !cmp.discovered) continue;
        g.fillStyle([0, 0x6cff8a, 0xffa53a, 0xff3a3a][cmp.tier] || 0x6cff8a, 1);
        g.fillRect(toX(cmp.col) - 1, toY(cmp.row) - 1, 3, 3);
      }
    }
    // (V2 P4 #7) Buildings on fire — orange dots.
    if (this.maintenance && this.maintenance.fires) {
      g.fillStyle(0xff8c1a, 1);
      for (const b of this.maintenance.fires) { if (b.alive) g.fillRect(toX(b.col) - 1, toY(b.row) - 1, 3, 3); }
    }
    // (V2 P4 #7) Heroes assigned to armies — small gold stars at the army.
    if (this.heroes && this.armyMgr) {
      g.fillStyle(0xffd24a, 1);
      for (const h of this.heroes.living()) {
        if (!h.armyId) continue;
        const army = this.armyMgr.armies.find((a: any) => a.id === h.armyId);
        if (army) { const x = toX(army.col), y = toY(army.row); g.fillRect(x - 2, y - 2, 4, 4); g.fillRect(x - 3, y, 8, 1); g.fillRect(x, y - 3, 1, 8); }
      }
    }

    // Camera viewport outline (map its corners through screen->tile).
    const v = this.cameras.main.worldView;
    const corners = [tileOf(v.x, v.y), tileOf(v.x + v.width, v.y), tileOf(v.x + v.width, v.y + v.height), tileOf(v.x, v.y + v.height)];
    g.lineStyle(1, 0xffffff, 0.85);
    g.beginPath();
    corners.forEach((t, i) => {
      const x = Phaser.Math.Clamp(toX(t.col), m.x, m.x + m.w);
      const y = Phaser.Math.Clamp(toY(t.row), m.y, m.y + m.h);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.closePath();
    g.strokePath();
  }

  // ---- FX overrides: keep effects above the (taller) iso world depth band ---

  explosionAt(x, y) {
    const e = this.add.sprite(x, y, 'explosion', 0).setScale(0.5).setDepth(31);
    if (this.anims.exists('explosion')) { e.play('explosion'); e.once('animationcomplete', () => e.destroy()); }
    else this.time.delayedCall(400, () => e.destroy());
  }

  dustAt(x, y) {
    const d = this.add.sprite(x, y, 'dust', 0).setScale(0.8).setDepth(30);
    if (this.anims.exists('dust')) { d.play('dust'); d.once('animationcomplete', () => d.destroy()); }
    else this.time.delayedCall(300, () => d.destroy());
  }

  // ---- (Visual P7) Generate-once particle pixels for world VFX -------------
  ensureFxTextures() {
    if (!this.textures.exists('wfx_px')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false } as any);
      g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 3, 3); g.generateTexture('wfx_px', 3, 3); g.destroy();
    }
    if (!this.textures.exists('wfx_soft')) {
      const tex = this.textures.createCanvas('wfx_soft', 14, 14) as any;
      if (tex) {
        const ctx = tex.getContext();
        const grad = ctx.createRadialGradient(7, 7, 0, 7, 7, 7);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.4, 'rgba(255,255,255,0.65)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad; ctx.fillRect(0, 0, 14, 14); tex.refresh();
      }
    }
  }

  // ---- (Visual P7) World event VFX ----------------------------------------

  // Burning building: a flickering flame cluster + rising smoke + drifting embers.
  // Used by razeFxAt (and safe to call standalone). Returns nothing — all
  // emitters self-destruct so there are no leaks.
  fireFxAt(x, y) {
    if (!this.textures.exists('wfx_soft')) this.ensureFxTextures();
    // Flame cluster: warm motes licking upward.
    const flame = this.add.particles(x, y - 4, 'wfx_soft', {
      lifespan: 480, speedY: { min: -70, max: -34 }, speedX: { min: -16, max: 16 },
      scale: { start: 0.9, end: 0 }, alpha: { start: 0.95, end: 0 },
      tint: [0xffd24a, 0xff8a2a, 0xff5a2a], quantity: 5, frequency: 40,
      blendMode: 'ADD', maxParticles: 70,
    }).setDepth(34);
    // Rising smoke.
    const smoke = this.add.particles(x, y - 10, 'wfx_soft', {
      lifespan: 1100, speedY: { min: -50, max: -24 }, speedX: { min: -20, max: 20 },
      scale: { start: 0.5, end: 2.0 }, alpha: { start: 0.4, end: 0 },
      tint: [0x4a4038, 0x6a6058], quantity: 2, frequency: 90, maxParticles: 40,
    }).setDepth(33);
    // A few embers popping out.
    const embers = this.add.particles(x, y - 4, 'wfx_px', {
      lifespan: 700, speed: { min: 30, max: 90 }, angle: { min: 230, max: 310 },
      scale: { start: 1, end: 0 }, alpha: { start: 1, end: 0 },
      tint: [0xffd24a, 0xff8a2a], quantity: 3, frequency: 110, gravityY: 60,
      blendMode: 'ADD', maxParticles: 30,
    }).setDepth(35);
    // Burn for ~900ms then stop emitting and clean up after the tail clears.
    this.time.delayedCall(900, () => { flame.stop(); smoke.stop(); embers.stop(); });
    this.time.delayedCall(2200, () => { flame.destroy(); smoke.destroy(); embers.destroy(); });
  }

  // Building destruction/raze: a quick flame burst + smoke puff + embers + dust.
  razeFxAt(x, y) {
    if (!this.textures.exists('wfx_soft')) this.ensureFxTextures();
    this.dustAt(x, y + 6);
    // Brief flame flash.
    const flash = this.add.particles(x, y, 'wfx_soft', {
      lifespan: 420, speed: { min: 40, max: 130 }, angle: { min: 200, max: 340 },
      scale: { start: 1.1, end: 0 }, alpha: { start: 1, end: 0 },
      tint: [0xffd24a, 0xff7a2a, 0xff5a2a], quantity: 14, blendMode: 'ADD', emitting: false,
    }).setDepth(34);
    flash.explode(14, x, y);
    // Wood/stone chips flying out.
    const chips = this.add.particles(x, y, 'wfx_px', {
      lifespan: 620, speed: { min: 60, max: 170 }, angle: { min: 0, max: 360 },
      scale: { start: 1.4, end: 0.4 }, alpha: { start: 1, end: 0 },
      tint: [0x8a6a44, 0x6a5030, 0xa8a098, 0x7c746c], quantity: 12, gravityY: 240, emitting: false,
    }).setDepth(33);
    chips.explode(12, x, y);
    // Rising smoke puff.
    const smoke = this.add.particles(x, y - 6, 'wfx_soft', {
      lifespan: 1000, speedY: { min: -46, max: -20 }, speedX: { min: -18, max: 18 },
      scale: { start: 0.6, end: 2.2 }, alpha: { start: 0.5, end: 0 },
      tint: [0x4a4038, 0x6a6058], quantity: 8, emitting: false,
    }).setDepth(32);
    smoke.explode(8, x, y - 6);
    this.time.delayedCall(1300, () => { flash.destroy(); chips.destroy(); smoke.destroy(); });
  }

  // Hero arrival: a warm light column rising from the castle + settling sparkles.
  heroArrivalFx(x, y) {
    if (!this.textures.exists('wfx_soft')) this.ensureFxTextures();
    // Warm light column.
    const col = this.add.rectangle(x, y - 60, 26, 130, 0xffe9a8, 0).setOrigin(0.5, 1).setDepth(36).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: col, fillAlpha: { from: 0, to: 0.55 }, scaleX: { from: 0.4, to: 1 }, duration: 280, yoyo: true, hold: 240, ease: 'Sine.out', onComplete: () => col.destroy() });
    // Settling sparkles falling into place around the arrival point.
    const motes = this.add.particles(x, y - 70, 'wfx_soft', {
      lifespan: 900, speedY: { min: 30, max: 70 }, speedX: { min: -28, max: 28 },
      scale: { start: 0.7, end: 0 }, alpha: { start: 0.95, end: 0 },
      tint: [0xfff3c0, 0xffd24a, 0xffe066], quantity: 3, frequency: 50,
      blendMode: 'ADD', maxParticles: 40,
    }).setDepth(37);
    this.time.delayedCall(500, () => motes.stop());
    this.time.delayedCall(1500, () => motes.destroy());
    // Reuse the existing celebratory star burst.
    if (this.sparkleAt) this.sparkleAt(x, y);
  }

  // Hero death: a larger blue-white soul wisp rising + a brief desaturation pulse.
  heroDeathFx(x, y) {
    if (!this.textures.exists('wfx_soft')) this.ensureFxTextures();
    const wisp = this.add.particles(x, y, 'wfx_soft', {
      lifespan: 1300, speedY: { min: -64, max: -34 }, speedX: { min: -18, max: 18 },
      scale: { start: 1.0, end: 0 }, alpha: { start: 0.7, end: 0 },
      tint: [0xbfe0ff, 0xeaf3ff, 0xcfd8ff], quantity: 6, frequency: 70,
      blendMode: 'ADD', maxParticles: 50,
    }).setDepth(37);
    this.time.delayedCall(700, () => wisp.stop());
    this.time.delayedCall(2100, () => wisp.destroy());
    // Brief desaturation/grief pulse over the screen.
    const pulse = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x6a7280, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(95);
    this.tweens.add({ targets: pulse, fillAlpha: { from: 0, to: 0.22 }, duration: 320, yoyo: true, hold: 180, ease: 'Sine.inOut', onComplete: () => pulse.destroy() });
  }

  // Settlement tier-up showpiece: escalating gold burst + confetti + warm flash.
  tierUpFx(x, y) {
    if (!this.textures.exists('wfx_soft')) this.ensureFxTextures();
    // Warm screen flash.
    const flash = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0xffe9a8, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(94).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: flash, fillAlpha: { from: 0.35, to: 0 }, duration: 420, ease: 'Cubic.out', onComplete: () => flash.destroy() });
    // Big gold burst from the keep.
    const burst = this.add.particles(x, y - 20, 'wfx_soft', {
      lifespan: 900, speed: { min: 80, max: 260 }, angle: { min: 200, max: 340 },
      scale: { start: 1.1, end: 0 }, alpha: { start: 1, end: 0 },
      tint: [0xfff3c0, 0xffd24a, 0xffae42], quantity: 26, gravityY: 160, blendMode: 'ADD', emitting: false,
    }).setDepth(38);
    burst.explode(26, x, y - 20);
    // Confetti rain that settles around the settlement.
    const confetti = this.add.particles(x, y - 90, 'wfx_px', {
      lifespan: 1500, speedY: { min: 40, max: 130 }, speedX: { min: -90, max: 90 },
      scale: { start: 1.6, end: 0.6 }, alpha: { start: 1, end: 0 }, rotate: { min: 0, max: 360 },
      tint: [0xffd24a, 0x4ad66b, 0x66ddff, 0xff6b6b, 0xffffff], quantity: 6, frequency: 40, maxParticles: 90,
    }).setDepth(37);
    this.time.delayedCall(700, () => confetti.stop());
    // A couple of escalating firework pops above the keep.
    for (let i = 0; i < 2; i++) {
      this.time.delayedCall(220 + i * 260, () => {
        const fx = x + Phaser.Math.Between(-50, 50), fy = y - 110 - i * 26;
        const pop = this.add.particles(fx, fy, 'wfx_soft', {
          lifespan: 700, speed: { min: 60, max: 150 }, angle: { min: 0, max: 360 },
          scale: { start: 0.8, end: 0 }, alpha: { start: 1, end: 0 },
          tint: [0xffd24a, 0x66ddff, 0xff6b6b, 0xffffff][i % 4], quantity: 18, gravityY: 90, blendMode: 'ADD', emitting: false,
        }).setDepth(38);
        pop.explode(18, fx, fy);
        this.time.delayedCall(760, () => pop.destroy());
      });
    }
    this.time.delayedCall(1600, () => { burst.destroy(); confetti.destroy(); });
    if (this.sparkleAt) this.sparkleAt(x, y);
  }

  // (Visual P7) Detect roster changes (heroes join via an event popup, or fall in
  // battle) and play the matching FX at the castle. Purely visual — reads counts,
  // changes no game state. Polled daily and on a slow timer so popup-accepts catch.
  checkHeroFx() {
    if (!this.heroes || !this.heroes.roster) return;
    const live = this.heroes.roster.filter((h: any) => h.isAlive).length;
    const fallen = this.heroes.roster.filter((h: any) => !h.isAlive).length;
    if (this._heroLiveCount === undefined) { this._heroLiveCount = live; this._heroFallenCount = fallen; return; }
    const c = this.buildings && this.buildings.castle;
    if (live > this._heroLiveCount && c) this.heroArrivalFx(c.x, c.y);
    if (fallen > this._heroFallenCount && c) this.heroDeathFx(c.x, c.y);
    this._heroLiveCount = live;
    this._heroFallenCount = fallen;
  }

  spawnShot(x1, y1, x2, y2) {
    const g = this.add.graphics().setDepth(30);
    g.lineStyle(2, 0xffe066, 1).lineBetween(x1, y1, x2, y2);
    this.tweens.add({ targets: g, alpha: 0, duration: 180, onComplete: () => g.destroy() });
  }

  spawnArrow(x1, y1, x2, y2) {
    const arrow = this.add.rectangle(x1, y1, 8, 3, 0xffe066).setDepth(30).setRotation(Math.atan2(y2 - y1, x2 - x1));
    this.tweens.add({ targets: arrow, x: x2, y: y2, duration: 220, onComplete: () => arrow.destroy() });
    sfx.playThrottled('arrow_shoot', 90); // (Polish Phase 2)
  }

  placeFX(b) {
    this.tweens.add({ targets: b.rect, scale: { from: b.baseScale * 1.3, to: b.baseScale }, duration: 220, ease: 'Back.out' });
    const flash = this.add.rectangle(b.x, b.y, 44, 44, 0xffffff, 0.7).setDepth(30);
    this.tweens.add({ targets: flash, alpha: 0, duration: 260, onComplete: () => flash.destroy() });
    this.dustAt(b.x, b.y + 10);
    // (Visual P7) Construction burst: wood/stone chips fly out, then a settling gold sparkle.
    if (!this.textures.exists('wfx_soft')) this.ensureFxTextures();
    const chips = this.add.particles(b.x, b.y + 4, 'wfx_px', {
      lifespan: 520, speed: { min: 50, max: 140 }, angle: { min: 0, max: 360 },
      scale: { start: 1.4, end: 0.4 }, alpha: { start: 1, end: 0 },
      tint: [0x8a6a44, 0x6a5030, 0xa8a098, 0xc8b48c], quantity: 10, gravityY: 240, emitting: false,
    }).setDepth(33);
    chips.explode(10, b.x, b.y + 4);
    const settle = this.add.particles(b.x, b.y - 14, 'wfx_soft', {
      lifespan: 700, speedY: { min: 14, max: 40 }, speedX: { min: -22, max: 22 },
      scale: { start: 0.7, end: 0 }, alpha: { start: 0.95, end: 0 },
      tint: [0xfff3c0, 0xffd24a, 0xffe066], quantity: 8, blendMode: 'ADD', emitting: false,
    }).setDepth(34);
    settle.explode(8, b.x, b.y - 14);
    this.time.delayedCall(820, () => { chips.destroy(); settle.destroy(); });
  }

  // ---- Phase 2 / 7: wildlife hooks + threat warning banners ----------------

  // A wolf reached a worker pawn: the pawn bolts home and 1 Wood/Meat is stolen.
  wolfCatchPawn(pawn) {
    if (!pawn || !this.pawns.pawns.includes(pawn)) return;
    const c = this.buildings.castle;
    if (c) {
      pawn.assigned = null; // drop its job so it actually flees (reconcile re-staffs later)
      pawn.setMove(c.x + Phaser.Math.Between(-24, 24), c.y + Phaser.Math.Between(-6, 22), 1.1, 'pawn_run');
      pawn.state = 'wander';
    }
    const res = Math.random() < 0.5 ? 'wood' : 'food';
    this.resources[res] = Math.max(0, this.resources[res] - 1);
    const label = res === 'food' ? 'Meat' : 'Wood';
    this.floatText(pawn.x, pawn.y - 22, `Wolf stole 1 ${label}!`, '#ff8a80');
    // Throttled "near your workers" warning (at most once every 8s).
    const now = this.time.now;
    if (!this._lastWolfWarn || now - this._lastWolfWarn > 8000) {
      this._lastWolfWarn = now;
      this.threatWarning('⚠ Wolves spotted near your workers', 0xff8a80);
    }
  }

  // (FIX 5) Threat banners are queued and shown ONE AT A TIME for 3s each.
  // (Audit fix) `priority` banners — AI kingdom attacks — jump the queue and
  // show immediately, interrupting (then re-queueing) any lower banner showing.
  threatWarning(text, color = 0xffd23f, priority = false) {
    this._warnQueue = this._warnQueue || [];
    if (this._warnLast === text || this._warnQueue.some((w) => w.text === text)) return; // dedupe
    if (priority) {
      this._warnQueue.unshift({ text, color }); // to the front of the line
      if (this._warnActive) {
        if (this._warnActiveItem) this._warnQueue.splice(1, 0, this._warnActiveItem); // resume the interrupted one after
        this._cancelActiveWarning();
      }
      this._pumpWarnings();
      return;
    }
    if (this._warnQueue.length >= 3) this._warnQueue.shift(); // bound the backlog
    this._warnQueue.push({ text, color });
    this._pumpWarnings();
  }

  _cancelActiveWarning() {
    if (this._warnTimer) { this._warnTimer.remove(false); this._warnTimer = null; }
    if (this._warnBanner) { this._warnBanner.destroy(); this._warnBanner = null; }
    if (this._warnScroll) { this._warnScroll.destroy(); this._warnScroll = null; }
    this._warnActive = false;
    this._warnLast = null;
    this._warnActiveItem = null;
  }

  _pumpWarnings() {
    if (this._warnActive || !this._warnQueue || this._warnQueue.length === 0) return;
    const item = this._warnQueue.shift();
    const { text, color } = item;
    this._warnActive = true;
    this._warnActiveItem = item;
    this._warnLast = text;
    const hex = '#' + (color >>> 0).toString(16).padStart(6, '0');
    // (Visual P6) Unfurling-scroll parchment banner. Text sits on a parchment
    // sheet with rolled wooden ends; both fade together.
    const t = this.add
      .text(GAME_W / 2, TOP_BAR + 92, text, { fontFamily: 'monospace', fontSize: '13px', color: hex, fontStyle: 'bold', padding: { x: 14, y: 7 }, align: 'center', stroke: '#000000', strokeThickness: 3, wordWrap: { width: GAME_W - 280 } })
      .setOrigin(0.5, 0)
      .setDepth(73)
      .setScrollFactor(0)
      .setAlpha(0);
    const bw = t.width + 56, bh = t.height + 4, bx = GAME_W / 2 - bw / 2, by = TOP_BAR + 92 - 2;
    const scroll = this.add.graphics().setScrollFactor(0).setDepth(72).setAlpha(0);
    // Parchment body.
    scroll.fillStyle(0x000000, 0.35).fillRoundedRect(bx + 2, by + 3, bw, bh, 4);
    scroll.fillStyle(0xd8c08a, 1).fillRoundedRect(bx, by, bw, bh, 4);
    scroll.fillStyle(0xf3e6c4, 1).fillRoundedRect(bx + 4, by + 3, bw - 8, bh - 6, 3);
    scroll.fillStyle(0xb89a60, 0.18).fillRoundedRect(bx + 4, by + bh - 8, bw - 8, 5, 3);
    // Rolled wooden ends (left & right cylinders) — the unfurled scroll look.
    const roll = (rx) => { scroll.fillStyle(0x4a3520, 1).fillRoundedRect(rx - 9, by - 4, 18, bh + 8, 6); scroll.fillStyle(0x6a4a2a, 1).fillRoundedRect(rx - 6, by - 4, 6, bh + 8, 3); scroll.fillStyle(0x271a0e, 1).fillRoundedRect(rx + 3, by - 4, 4, bh + 8, 2); };
    roll(bx); roll(bx + bw);
    // Accent ink line under the text.
    scroll.lineStyle(1, color, 0.7); scroll.beginPath(); scroll.moveTo(bx + 14, by + bh - 5); scroll.lineTo(bx + bw - 14, by + bh - 5); scroll.strokePath();
    this._warnBanner = t;
    this._warnScroll = scroll;
    // Unfurl feel: the parchment fades + drops in slightly ahead of the text.
    scroll.setAlpha(0).y = -8;
    this.tweens.add({ targets: scroll, alpha: { from: 0, to: 1 }, y: { from: -8, to: 0 }, duration: 220, ease: 'Back.out' });
    this.tweens.add({ targets: t, alpha: { from: 0, to: 1 }, duration: 200, delay: 100 });
    const finish = () => { if (this._warnScroll) { this._warnScroll.destroy(); this._warnScroll = null; } t.destroy(); this._warnBanner = null; this._warnTimer = null; this._warnActive = false; this._warnActiveItem = null; this._warnLast = null; this._pumpWarnings(); };
    this._warnTimer = this.time.delayedCall(3000, () => {
      this.tweens.add({ targets: [t, scroll], alpha: 0, duration: 400, onComplete: finish });
    });
  }

  // ==== (Visual P6) Physical-object panel painters ==========================
  // Reusable procedural painters that make every panel feel like a tangible
  // medieval object — aged parchment, carved wood, warm stone — drawn entirely
  // with Phaser Graphics (no external assets). Each returns the Graphics object
  // so callers can add it to a container / depth it / destroy it like any other
  // game object. Warm top-left light is implied throughout (lighter top edges,
  // darker bottom-right). NOTHING is pure gray or white.

  // Deterministic tiny PRNG so painted grain/fibers/stains stay stable per-call.
  _pp_rng(seed) { let s = (seed | 0) || 1; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

  // Aged parchment sheet: warm cream centre, toasted edges, faint fibers, ink
  // dots, and a subtle torn/curled edge highlight. Optional rounded corners.
  parchmentPanel(x, y, w, h, opts: any = {}) {
    const r = opts.radius != null ? opts.radius : 6;
    const g = this.add.graphics().setScrollFactor(0);
    const rand = this._pp_rng(opts.seed != null ? opts.seed : (x * 31 + y * 17 + w));
    // Drop the warm shadow first so it sits behind the sheet.
    g.fillStyle(0x000000, 0.28).fillRoundedRect(x + 3, y + 4, w, h, r);
    // Toasted edge base.
    g.fillStyle(0xd8c08a, 1).fillRoundedRect(x, y, w, h, r);
    // Cream interior inset a few px so the toasted band shows as the aged edge.
    const m = 5;
    g.fillStyle(0xf3e6c4, 1).fillRoundedRect(x + m, y + m, w - m * 2, h - m * 2, Math.max(1, r - 2));
    // Warm top-left light wash.
    g.fillStyle(0xfff4d8, 0.18).fillRoundedRect(x + m, y + m, w - m * 2, (h - m * 2) * 0.45, Math.max(1, r - 2));
    // Faint horizontal fiber lines.
    g.lineStyle(1, 0xd9c79b, 0.35);
    for (let i = 0; i < h - m * 2; i += 9) { const yy = y + m + i + (rand() * 3 - 1.5); g.beginPath(); g.moveTo(x + m + 2, yy); g.lineTo(x + w - m - 2, yy); g.strokePath(); }
    // Ink-stain dots, kept away from the very edges.
    const dots = Math.max(3, Math.floor((w * h) / 9000));
    for (let i = 0; i < dots; i++) {
      const dx = x + m + 6 + rand() * (w - m * 2 - 12);
      const dy = y + m + 6 + rand() * (h - m * 2 - 12);
      g.fillStyle(0x6b5836, 0.10 + rand() * 0.10).fillCircle(dx, dy, 1 + rand() * 2.2);
    }
    // Inner toasted vignette along the bottom-right (light from top-left).
    g.fillStyle(0xb89a60, 0.16).fillRoundedRect(x + m, y + h - m - (h - m * 2) * 0.3, w - m * 2, (h - m * 2) * 0.3, Math.max(1, r - 2));
    return g;
  }

  // Dark aged-parchment / oiled-leather sheet: a warm dark backing so the
  // existing light HUD text stays legible, yet still reads as an aged physical
  // surface (fibers, stains, warm top-left light, toasted edge). Used for the
  // bottom panels which carry pre-existing pale text.
  leatherPanel(x, y, w, h, opts: any = {}) {
    const r = opts.radius != null ? opts.radius : 5;
    const g = this.add.graphics().setScrollFactor(0);
    const rand = this._pp_rng(opts.seed != null ? opts.seed : (x * 19 + y * 11 + w));
    g.fillStyle(0x000000, 0.3).fillRoundedRect(x + 3, y + 4, w, h, r);
    // Toasted darker edge then warm dark interior.
    g.fillStyle(0x231811, 1).fillRoundedRect(x, y, w, h, r);
    const m = 5;
    g.fillStyle(0x352617, 1).fillRoundedRect(x + m, y + m, w - m * 2, h - m * 2, Math.max(1, r - 2));
    // Warm top-left light wash.
    g.fillStyle(0x6a4f2e, 0.22).fillRoundedRect(x + m, y + m, w - m * 2, (h - m * 2) * 0.4, Math.max(1, r - 2));
    // Faint fiber lines.
    g.lineStyle(1, 0x4a3620, 0.3);
    for (let i = 0; i < h - m * 2; i += 10) { const yy = y + m + i + (rand() * 3 - 1.5); g.beginPath(); g.moveTo(x + m + 2, yy); g.lineTo(x + w - m - 2, yy); g.strokePath(); }
    // Dark mottling stains.
    for (let i = 0; i < Math.max(4, Math.floor((w * h) / 11000)); i++) {
      const dx = x + m + 6 + rand() * (w - m * 2 - 12), dy = y + m + 6 + rand() * (h - m * 2 - 12);
      g.fillStyle(rand() > 0.5 ? 0x271b10 : 0x46341d, 0.18).fillCircle(dx, dy, 2 + rand() * 4);
    }
    // Bottom-right shadow vignette.
    g.fillStyle(0x1c130b, 0.3).fillRoundedRect(x + m, y + h - m - (h - m * 2) * 0.28, w - m * 2, (h - m * 2) * 0.28, Math.max(1, r - 2));
    return g;
  }

  // Dark carved-wood frame drawn AROUND a region (does not fill the interior).
  // Plank grain + iron corner brackets with rivets. `t` = frame thickness.
  woodFrame(x, y, w, h, opts: any = {}) {
    const t = opts.thickness != null ? opts.thickness : 7;
    const accent = opts.accent != null ? opts.accent : 0xc9a14a; // faction/gold accent line
    const g = this.add.graphics().setScrollFactor(0);
    const rand = this._pp_rng(x * 13 + y * 7 + 3);
    // Outer wood border as four planks (top/bottom lighter via top-left light).
    const plank = (px, py, pw, ph, top) => {
      g.fillStyle(top ? 0x4a3520 : 0x3a2817, 1).fillRect(px, py, pw, ph);
      // grain streaks
      g.lineStyle(1, 0x271a0e, 0.5);
      const horiz = pw >= ph;
      const n = Math.floor((horiz ? ph : pw) / 3);
      for (let i = 0; i < n; i++) {
        if (horiz) { const gy = py + 2 + i * 3 + rand() * 1.5; g.beginPath(); g.moveTo(px + 1, gy); g.lineTo(px + pw - 1, gy); g.strokePath(); }
        else { const gx = px + 2 + i * 3 + rand() * 1.5; g.beginPath(); g.moveTo(gx, py + 1); g.lineTo(gx, py + ph - 1); g.strokePath(); }
      }
    };
    plank(x, y, w, t, true);            // top (lit)
    plank(x, y + h - t, w, t, false);   // bottom
    plank(x, y, t, h, true);            // left (lit)
    plank(x + w - t, y, t, h, false);   // right
    // Thin warm accent line just inside the wood.
    g.lineStyle(1.5, accent, 0.7).strokeRect(x + t - 1, y + t - 1, w - (t - 1) * 2, h - (t - 1) * 2);
    // Iron corner brackets + rivets.
    const bs = Math.max(12, t + 8);
    const bracket = (cx, cy, sx, sy) => {
      g.fillStyle(0x2b2f36, 1);
      g.fillRect(cx, cy, sx * bs, sy * 4);
      g.fillRect(cx, cy, sx * 4, sy * bs);
      g.fillStyle(0x53595f, 0.9).fillCircle(cx + sx * 3, cy + sy * 3, 2);
      g.fillStyle(0x71777d, 0.9).fillCircle(cx + sx * (bs - 4), cy + sy * 3, 1.6);
      g.fillStyle(0x71777d, 0.9).fillCircle(cx + sx * 3, cy + sy * (bs - 4), 1.6);
    };
    bracket(x + 1, y + 1, 1, 1);
    bracket(x + w - 1, y + 1, -1, 1);
    bracket(x + 1, y + h - 1, 1, -1);
    bracket(x + w - 1, y + h - 1, -1, -1);
    return g;
  }

  // Carved warm-stone slab: chiseled inset, mortar lines, lit top-left bevel.
  stonePanel(x, y, w, h, opts: any = {}) {
    const g = this.add.graphics().setScrollFactor(0);
    const rand = this._pp_rng(opts.seed != null ? opts.seed : (x * 7 + y * 23 + w));
    g.fillStyle(0x000000, 0.30).fillRect(x + 3, y + 4, w, h);
    // Base stone.
    g.fillStyle(0x6b5f51, 1).fillRect(x, y, w, h);
    // Lit top-left bevel + dark bottom-right bevel.
    g.fillStyle(0x8d8071, 0.9).fillRect(x, y, w, 3);
    g.fillStyle(0x8d8071, 0.7).fillRect(x, y, 3, h);
    g.fillStyle(0x39312a, 0.8).fillRect(x, y + h - 3, w, 3);
    g.fillStyle(0x39312a, 0.6).fillRect(x + w - 3, y, 3, h);
    // Chiseled inset face (warm stone, slightly lighter).
    const m = 6;
    g.fillStyle(0x7d7163, 1).fillRect(x + m, y + m, w - m * 2, h - m * 2);
    g.fillStyle(0x564a3e, 0.9).fillRect(x + m, y + m, w - m * 2, 2); // inset top shadow
    g.fillStyle(0x564a3e, 0.7).fillRect(x + m, y + m, 2, h - m * 2);
    g.fillStyle(0x968874, 0.6).fillRect(x + m, y + h - m - 2, w - m * 2, 2); // inset bottom light
    // Mortar lines: a couple of irregular horizontal courses + a vertical break.
    g.lineStyle(2, 0x4c4136, 0.55);
    const courses = Math.max(1, Math.floor((h - m * 2) / 34));
    for (let i = 1; i <= courses; i++) {
      const cy = y + m + (i * (h - m * 2)) / (courses + 1) + (rand() * 4 - 2);
      g.beginPath(); g.moveTo(x + m + 2, cy); g.lineTo(x + w - m - 2, cy); g.strokePath();
      const bx = x + m + (0.3 + rand() * 0.4) * (w - m * 2);
      g.beginPath(); g.moveTo(bx, cy); g.lineTo(bx, cy + (h - m * 2) / (courses + 1)); g.strokePath();
    }
    // Faint speckle.
    for (let i = 0; i < Math.floor((w * h) / 4000); i++) {
      g.fillStyle(rand() > 0.5 ? 0x8d8071 : 0x564a3e, 0.25).fillCircle(x + m + rand() * (w - m * 2), y + m + rand() * (h - m * 2), 0.8 + rand());
    }
    return g;
  }

  // Wax seal: a glossy blob with a stamped emboss ring. Returns Graphics.
  waxSeal(cx, cy, radius, color = 0x8c2f24) {
    const g = this.add.graphics().setScrollFactor(0);
    g.fillStyle(0x000000, 0.3).fillCircle(cx + 1.5, cy + 2, radius);
    // Irregular wax rim — a ring of small lobes.
    g.fillStyle(color, 1);
    const lobes = 11;
    for (let i = 0; i < lobes; i++) { const a = (i / lobes) * Math.PI * 2; g.fillCircle(cx + Math.cos(a) * radius * 0.82, cy + Math.sin(a) * radius * 0.82, radius * 0.34); }
    g.fillCircle(cx, cy, radius * 0.92);
    // Top-left sheen.
    g.fillStyle(0xffffff, 0.18).fillCircle(cx - radius * 0.28, cy - radius * 0.3, radius * 0.42);
    // Darker stamped centre + emboss ring.
    const dk = Phaser.Display.Color.IntegerToColor(color).darken(28).color;
    g.fillStyle(dk, 1).fillCircle(cx, cy, radius * 0.62);
    g.lineStyle(1.5, Phaser.Display.Color.IntegerToColor(color).lighten(18).color, 0.8).strokeCircle(cx, cy, radius * 0.62);
    return g;
  }

  // Warm candle-glow blob (for panel corners). Returns Graphics.
  candleGlow(cx, cy, radius, color = 0xffdf9e) {
    const g = this.add.graphics().setScrollFactor(0);
    g.fillStyle(color, 0.12).fillCircle(cx, cy, radius);
    g.fillStyle(color, 0.14).fillCircle(cx, cy, radius * 0.6);
    g.fillStyle(color, 0.2).fillCircle(cx, cy, radius * 0.3);
    return g;
  }

  // Convenience: a full bottom-panel "object" — parchment sheet inside a wood
  // frame, with corner candle glows. Adds all pieces to `this.panel` (the
  // scrollFactor-0 panel container) BEHIND existing contents. Call this first
  // inside a render* method instead of the old single rectangle.
  paintBottomPanel(opts: any = {}) {
    const x = 4, y = this.PANEL_Y + 4, w = GAME_W - 8, h = PANEL_H - 8;
    const accent = opts.accent != null ? opts.accent : this.factionColor();
    if (opts.stone) this.panel.add(this.stonePanel(x, y, w, h, { seed: y }));
    else this.panel.add(this.leatherPanel(x, y, w, h, { radius: 5, seed: y }));
    this.panel.add(this.woodFrame(x, y, w, h, { thickness: 7, accent }));
    this.panel.add(this.candleGlow(x + 22, y + 22, 40, 0xffdf9e));
    this.panel.add(this.candleGlow(x + w - 22, y + 22, 40, 0xffdf9e));
  }

  // ---- Phase 5: Iron HUD + artifacts + intel + scrolls ---------------------

  // Iron readout in the resource bar (gray icon). Shifts Workers/Soldiers right
  // to make room (they were laid out by the base buildHud).
  // (FIX 5) Re-lay the resource bar into two tidy rows within the top bar:
  //   Row 1: Wood | Stone | Food | Gold      Row 2: Iron | Workers | Soldiers
  // (UI overhaul Phase 1) Consistent resource bar: every resource is a chip with
  // the SAME format — distinct icon + value + label. Replaces the old mix of
  // icon-only / label-only / ambiguous-dot readouts.
  createIronHud() {
    const fix = (o) => o.setScrollFactor(0);
    // Retire the old single-style readouts (kept by GameScene.buildHud but now
    // hidden; their hidden updates are harmless).
    ['woodIcon', 'foodIcon', 'goldIcon', 'wood', 'stone', 'food', 'gold', 'workers', 'soldiers'].forEach((k) => this.hud[k] && this.hud[k].setVisible(false));
    if (this.hud.day) this.hud.day.setVisible(false);

    // (Visual P6) The whole resource bar is a carved warm-stone & wood ledger.
    // A stone band fills the strip; resources sit in recessed chiseled slots.
    fix(this.add.rectangle(0, 0, GAME_W, 56, 0x000000, 0.45).setOrigin(0, 0).setDepth(38));
    fix(this.stonePanel(-8, -8, GAME_W + 16, 64, { seed: 777 }).setDepth(39));
    // Heavy wood rails top & bottom of the ledger.
    const railG = fix(this.add.graphics().setDepth(39));
    railG.fillStyle(0x3a2817, 1).fillRect(0, 54, GAME_W, 3);
    railG.fillStyle(0x4a3520, 1).fillRect(0, 0, GAME_W, 2);
    railG.fillStyle(0x000000, 0.55).fillRect(0, 57, GAME_W, 2);
    const slotG = fix(this.add.graphics().setDepth(39.5)); // recessed slot painter
    const gfx = fix(this.add.graphics().setDepth(42));
    this.chips = {};

    // A chip = recessed carved slot + bg rect + icon + inscribed value + label.
    const chip = (key: any, x: number, y: number, w: number, labelTxt: string, imgKey: any, draw?: any) => {
      // Carved recessed slot behind the chip (dark inset with lit lower-right lip).
      slotG.fillStyle(0x000000, 0.42).fillRoundedRect(x - 2, y - 1, w + 4, 27, 4);
      slotG.lineStyle(1, 0x2a221a, 0.9).strokeRoundedRect(x - 2, y - 1, w + 4, 27, 4);
      slotG.lineStyle(1, 0x9c8a64, 0.35); slotG.beginPath(); slotG.moveTo(x - 2, y + 25); slotG.lineTo(x + w + 2, y + 25); slotG.strokePath();
      const bg = fix(this.add.rectangle(x, y, w, 25, 0x1c2330, 0.55).setOrigin(0, 0).setDepth(40).setStrokeStyle(1, 0x6b5a3c, 0.7));
      const cx = x + 12, cy = y + 12;
      if (imgKey) fix(this.add.image(cx, cy, imgKey).setDisplaySize(18, 18).setDepth(42));
      else if (draw) draw(gfx, cx, cy);
      const value = fix(this.add.text(x + 23, y + 3, '', { fontFamily: 'monospace', fontSize: '13px', color: '#fdf2d4', fontStyle: 'bold', stroke: '#1a120a', strokeThickness: 3 }).setDepth(42));
      const label = fix(this.add.text(x + 23, y + 15, labelTxt, { fontFamily: 'monospace', fontSize: '8px', color: '#cbb487' }).setDepth(42));
      this.chips[key] = { bg, value, label };
    };
    // Distinct drawn icons (shapes differ for colourblind readability).
    const I = {
      stone: (g, x, y) => g.fillStyle(0xaab1ba, 1).fillRoundedRect(x - 7, y - 5, 14, 11, 3),
      iron: (g, x, y) => { g.fillStyle(0x6b7686, 1); g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 6, y); g.lineTo(x, y + 7); g.lineTo(x - 6, y); g.closePath(); g.fillPath(); },
      equip: (g, x, y) => { g.fillStyle(0xd2d9e2, 1).fillRect(x - 1.5, y - 8, 3, 11); g.fillRect(x - 5, y + 1, 10, 2.5); g.fillStyle(0x9a6a3a, 1).fillRect(x - 1.5, y + 3, 3, 4); },
      workers: (g, x, y) => { g.fillStyle(0x62d0f0, 1).fillCircle(x, y - 4, 3.4); g.fillRoundedRect(x - 4, y - 1, 8, 8, 2); },
      soldiers: (g, x, y) => { g.fillStyle(0xc9d3df, 1); g.beginPath(); g.moveTo(x - 6, y - 6); g.lineTo(x + 6, y - 6); g.lineTo(x + 6, y + 1); g.lineTo(x, y + 7); g.lineTo(x - 6, y + 1); g.closePath(); g.fillPath(); },
      day: (g, x, y) => g.fillStyle(0xffe9a8, 1).fillCircle(x, y, 5),
    };
    // (Phase 3) Centre the resource bar — top-left is the kingdom identity, the
    // top-right is day/season/speed/menu. CHX shifts the whole block to centre.
    const CHX = 430;
    // Row 1 — economy.
    chip('wood', CHX + 6, 2, 86, 'WOOD', 'icon_wood'); chip('stone', CHX + 96, 2, 86, 'STONE', null, I.stone);
    chip('food', CHX + 186, 2, 86, 'FOOD', 'icon_food'); chip('gold', CHX + 276, 2, 86, 'GOLD', 'icon_gold');
    chip('iron', CHX + 366, 2, 86, 'IRON', null, I.iron);
    // (Completion Phase 2) refined goods
    chip('planks', CHX + 456, 2, 96, 'PLANKS', 'icon_planks');
    chip('cutStone', CHX + 556, 2, 110, 'CUT STONE', 'icon_cutstone');
    // Row 2 — military / time.
    chip('equipment', CHX + 6, 29, 86, 'EQUIP', null, I.equip);
    chip('workers', CHX + 96, 29, 104, 'WORKERS', null, I.workers);
    chip('soldiers', CHX + 204, 29, 104, 'SOLDIERS', null, I.soldiers);
    chip('day', CHX + 312, 29, 70, 'DAY', null, I.day);
    chip('season', CHX + 386, 29, 160, 'SEASON', null, null);
    this.seasonIcon = fix(this.add.ellipse(CHX + 398, 41, 11, 11, 0x66cc66).setDepth(42));
    this.chips.season.value.setX(CHX + 410);
    this.chips.season.label.setX(CHX + 410);
    // (Phase 3) Clicking a resource chip shows its production/consumption breakdown.
    for (const key of ['wood', 'stone', 'food', 'gold', 'iron']) {
      const ch = this.chips[key]; if (!ch) continue;
      ch.bg.setInteractive({ useHandCursor: true });
      ch.bg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.showResourceBreakdown(key, ch.bg.x + ch.bg.width / 2); });
    }
  }

  // (Phase 3) Resource breakdown tooltip: rough production/consumption per day.
  showResourceBreakdown(key, cx) {
    const r = this.resources;
    const perDay = {
      wood: this.buildings.buildings.filter((b) => b.typeKey === 'lumberyard' && b.alive).reduce((s, b) => s + (b.currentOutput() || 0), 0),
      stone: this.buildings.buildings.filter((b) => b.typeKey === 'mine' && b.alive).reduce((s, b) => s + (b.currentOutput() || 0), 0),
      food: this.buildings.buildings.filter((b) => b.typeKey === 'farm' && b.alive).reduce((s, b) => s + (b.currentOutput() || 0), 0),
      gold: (this.buildings.castle ? (this.buildings.castle.currentOutput() || 0) : 0) * (this._goldTaxMult || 1),
      iron: 0,
    };
    const upkeep = key === 'food' ? (this.troops.dailyUpkeep ? this.troops.dailyUpkeep() : 0) : 0;
    const net = Math.round(((perDay[key] || 0) - upkeep) * 10) / 10;
    const lines = [`Have: ${Math.floor(r[key] || 0)}`, `Production: ~${Math.round((perDay[key] || 0) * 10) / 10}/tick`];
    if (upkeep) lines.push(`Upkeep: -${upkeep}/day`);
    this.showTip(cx, TOP_BAR + 8, key.toUpperCase(), lines.join('\n'));
    this.time.delayedCall(2500, () => this.hideTip());
  }

  // (Completion Phase 11) Hover tooltip for an army icon: composition, morale,
  // supply and current order.
  showArmyTip(army) {
    if (!army) return;
    const units = (army.units || []).map((u) => `${u.type} x${u.count}`).join(', ') || 'empty';
    const mood = army.morale >= 60 ? 'Good' : army.morale >= 30 ? 'Shaky' : 'Breaking';
    const order = army.marchTargetCol != null ? `Marching (~${this.armyMgr.etaDays(army).toFixed(1)}d)` : (army.state || 'idle');
    const p = this.tileCenter(army.col, army.row), cam = this.cameras.main;
    const sx = (p.x - cam.scrollX) * cam.zoom, sy = (p.y - cam.scrollY) * cam.zoom;
    this.showTip(Phaser.Math.Clamp(sx, 120, GAME_W - 120), Phaser.Math.Clamp(sy - 44, 50, GAME_H - 120), army.name, `${units}\nMorale: ${Math.round(army.morale)} (${mood}) · Supply: ${army.supplyDays}d\nOrder: ${order}`);
  }

  seasonColor(day) {
    return { 'Early Spring': 0x66cc66, 'Late Spring': 0x66cc66, Summer: 0xffd24a, 'Early Autumn': 0xd2772a, 'Late Autumn': 0xc06010, Winter: 0x7fa8d8 }[this.seasonHint(day)] || 0x66cc66;
  }

  updateChips() {
    if (!this.chips) return;
    const r = this.resources;
    this._chipPrev = this._chipPrev || {};
    const set = (key, val) => {
      const ch = this.chips[key]; if (!ch) return;
      ch.value.setText(fmtNum(val)); // (Polish Phase 5) abbreviate big numbers so they don't clip
      const prev = this._chipPrev[key];
      if (prev !== undefined && Math.abs(val - prev) >= 2 && !ch._crit) {
        ch.bg.setFillStyle(val > prev ? 0x2e6a36 : 0x6a2426, 0.9);
        this.time.delayedCall(300, () => { if (!ch._crit) ch.bg.setFillStyle(0x1c2330, 0.55); });
      }
      this._chipPrev[key] = val;
    };
    set('wood', Math.floor(r.wood)); set('stone', Math.floor(r.stone)); set('food', Math.floor(r.food));
    set('gold', Math.floor(r.gold)); set('iron', Math.floor(r.iron || 0)); set('equipment', Math.floor(r.equipment || 0));
    set('planks', Math.floor(r.planks || 0)); set('cutStone', Math.floor(r.cutStone || 0)); // (Completion P2)
    this.chips.workers.value.setText(`${this.buildings.workersUsed()}/${r.workersCap}`);
    // (BUG 1) Show the true total (pool + training + expeditions + armies) vs cap.
    this.chips.soldiers.value.setText(`${this.soldierTotal()}/${this.soldierCap()}`);
    this.chips.day.value.setText(`${this.gameDay}`);
    this.chips.season.value.setText(this.seasonHint(this.gameDay));
    if (this.seasonIcon) this.seasonIcon.setFillStyle(this.seasonColor(this.gameDay));
    this.critChip('food', r.food < 20);
    this.critChip('soldiers', this.troops.count === 0);
  }

  critChip(key, on) {
    const ch = this.chips[key]; if (!ch) return;
    if (on && !ch._crit) { ch._crit = true; ch.bg.setFillStyle(0x6a2020, 0.9); ch._critTween = this.tweens.add({ targets: ch.bg, alpha: { from: 0.9, to: 0.35 }, yoyo: true, repeat: -1, duration: 600 }); }
    else if (!on && ch._crit) { ch._crit = false; if (ch._critTween) ch._critTween.stop(); ch.bg.setAlpha(0.55).setFillStyle(0x1c2330, 0.55); }
  }

  updateHud() {
    super.updateHud();
    this.updateChips();
    this.updatePopulationHud(); // (Phase 5)
    // (Phase 6) Top-bar threat readout reflects whichever kingdom is attacking.
    if (this.kingdoms && this.hud.aiStatus) {
      const atk = this.waveCoord.holder;
      this.hud.aiStatus.setText(atk ? atk.status() : 'The kingdoms watch from the borders').setColor(atk ? atk.cfg.labelColor : '#ffd1a8');
      const totalWaves = this.kingdoms.reduce((s, k) => s + k.waveNumber, 0);
      if (this.hud.wave) this.hud.wave.setText(`W ${totalWaves}`);
      if (this.hud.waveTime) this.hud.waveTime.setText(atk ? 'NOW' : this.waveCoord.cooldown > 0 ? `${Math.ceil(this.waveCoord.cooldown)}s` : '...');
    }
  }

  intelActive() { return this.gameDay < this.intelUntilDay; }

  grantIntel(days) {
    this.intelUntilDay = this.gameDay + days;
    const n = this.armyEstimate ? this.armyEstimate() : this.waves.enemies.length;
    this.artifactPopup('Scouts Report', `Enemy army size revealed for ${days} days (~${n} units)`);
  }

  grantScroll() {
    this.scrolls += 1;
    this.artifactPopup('Rare Scroll Found', `Ancient knowledge recovered (${this.scrolls} total)`);
  }

  // Award a random unowned artifact (or +25 Iron once all five are found),
  // apply its permanent buff, and show the popup.
  awardArtifact() {
    const owned = new Set(this.artifacts);
    const pool = this.ARTIFACT_DEFS.filter((a) => !owned.has(a.key));
    if (pool.length === 0) {
      this.resources.add('iron', 25);
      this.artifactPopup('All Artifacts Found', '+25 Iron instead');
      return;
    }
    const a: any = Phaser.Utils.Array.GetRandom(pool);
    this.artifacts.push(a.key);
    a.apply(this);
    this.artifactPopup('Artifact Found: ' + a.name, a.desc);
  }

  artifactPopup(title, desc) {
    const cx = GAME_W / 2;
    const cy = 200;
    const fix = (o) => o.setScrollFactor(0);
    const bg = fix(this.add.rectangle(cx, cy, 440, 82, 0x241a0e, 0.97).setStrokeStyle(2, 0xffd23f, 0.9).setDepth(85));
    const t1 = fix(this.add.text(cx, cy - 16, title, { fontFamily: 'monospace', fontSize: '18px', color: '#ffe9b0', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5).setDepth(86));
    const t2 = fix(this.add.text(cx, cy + 14, desc, { fontFamily: 'monospace', fontSize: '13px', color: '#f0e6d0', align: 'center', wordWrap: { width: 420 } }).setOrigin(0.5).setDepth(86));
    const all = [bg, t1, t2];
    all.forEach((o) => (o.alpha = 0));
    this.tweens.add({ targets: all, alpha: 1, duration: 200, yoyo: false });
    this.time.delayedCall(3200, () => this.tweens.add({ targets: all, alpha: 0, duration: 500, onComplete: () => all.forEach((o) => o.destroy()) }));
  }

  // ---- Panel routing (adds Expedition / Artifacts / Kingdoms views) ---------

  refreshPanel() {
    this.panel.removeAll(true);
    this.hideTip();
    if (this._confirmEls) { this._confirmEls.forEach((o) => o.destroy()); this._confirmEls = null; } // (Gameplay change 2) clear stale demolish dialog
    this.highlightTabs();
    if (this.selectedBuilding && this.selectedBuilding.alive) this.renderSelectedPanel(this.selectedBuilding);
    else if (this.panelMode === 'expedition') this.renderExpeditionPanel();
    else if (this.panelMode === 'artifacts') this.renderArtifactsPanel();
    else if (this.panelMode === 'ruins' && this.ruins) this.renderRuinsPanel();
    else if (this.panelMode === 'kingdoms') this.renderKingdomsPanel();
    else if (this.panelMode === 'caravans' && this.caravans) this.caravans.renderPanel();
    else if (this.panelMode === 'armies') this.renderArmiesPanel();
    else if (this.panelMode === 'armyform') this.renderArmyForm();
    else if (this.panelMode === 'research' && this.research) this.research.renderPanel();
    // (Phase 3) K&C category panels.
    else if (this.panelMode === 'cat_castle') this.renderCastlePanel();
    else if (this.panelMode === 'cat_food') this.renderCategoryBuild('FOOD', ['farm', 'tavern', 'house']);
    else if (this.panelMode === 'cat_industry') this.renderCategoryBuild('INDUSTRY', ['lumberyard', 'mine', 'sawmill', 'stonecutter', 'blacksmith', 'market', 'library', 'watchtower', 'treasury', 'siegeworkshop', 'hallofheroes', 'grandhall']);
    else if (this.panelMode === 'cat_military') this.renderMilitaryPanel();
    else if (this.panelMode === 'cat_invest') this.renderInvestPanel(); // (Phase 11)
    else if (this.panelMode === 'cat_monuments') this.renderMonumentsPanel(); // (Phase 11)
    else if (this.panelMode === 'build') this.renderDefaultPanel();
    // (Phase 3) 'none' → no panel (just the category bar). Map filled the screen.
  }

  // ==========================================================================
  // (Phase 11) INVEST PANEL — army equipment tiers + per-settlement investment.
  // Shown from the Castle category's "Invest" button. All gold/material spends +
  // effects funnel through GameWorld (craftEquipment / invest) so the headless
  // audit and the UI drive the same code; the bottom resource bar shows GameWorld
  // gold, so investment costs read live. Monuments get their own panel button.
  // ==========================================================================
  renderInvestPanel() {
    this.paintBottomPanel({ stone: true });
    this.flushResourcesToWorld(); // GameWorld cost checks read the SettlementState stockpile
    const sid = this._settlementId;
    const isHome = !!(this._settle && this._settle.faction === 'player');
    this.panelText(14, this.PANEL_Y + 8, `INVEST — ${this._settle ? this._settle.name : 'Settlement'}   ·   Gold ${fmtNum(GameWorld.gold)}   ·   Prestige ${GameWorld.prestige}`, { color: '#c9a84c', bold: true });

    // --- ARMY EQUIPMENT TIERS (home only — crafted at the Blacksmith/Forge) ---
    let y = this.PANEL_Y + 30;
    this.panelText(14, y, `Army Equipment: ${GameWorld.equipmentTierName()} (+${Math.round((GameWorld.equipmentDamageMult() - 1) * 100)}% damage)`, { color: '#e8e0cc', size: '12px' });
    if (isHome) {
      const next = GameWorld.equipmentTier + 1;
      const r = GameWorld.equipmentRecipe(next);
      if (r) {
        const can = GameWorld.canCraftEquipment(next);
        const costParts = [`${r.iron} iron`];
        if (r.planks) costParts.push(`${r.planks} planks`);
        costParts.push(`${r.gold}g`);
        if (r.artifact) costParts.push('1 artifact');
        const label = `Forge ${r.name}`;
        this.spriteButton(14, y + 18, 200, 34, label, costParts.join(' · '), can.ok, () => {
          const res = GameWorld.craftEquipment(next);
          if (res.ok) { this.pullWorldResources(); this.showToast(`Army re-equipped: ${GameWorld.equipmentTierName()} (+${Math.round((GameWorld.equipmentDamageMult() - 1) * 100)}% dmg)`); }
          else this.showToast(res.reason || 'Cannot craft');
          this.refreshPanel();
        }, { gold: can.ok });
        if (!can.ok && can.reason) this.panelText(224, y + 28, can.reason, { color: '#ff9a8a', size: '10px' });
      } else {
        this.panelText(14, y + 18, 'Army fully equipped — Legendary gear forged.', { color: '#ffe08a', size: '11px' });
      }
    } else {
      this.panelText(14, y + 18, 'Equipment is forged at your home castle Blacksmith.', { color: '#9aa0a6', size: '11px' });
    }

    // --- SETTLEMENT INVESTMENT (any settlement the player can act in) ----------
    y = this.PANEL_Y + 78;
    this.panelText(14, y, 'Settlement Investment (permanent):', { color: '#e8e0cc', size: '12px' });
    const kinds = ['infrastructure', 'fortification', 'population', 'trade'];
    const bw = 168, gap = 8;
    kinds.forEach((k, i) => {
      const def = GameWorld.INVEST_DEFS[k];
      if (!def) return;
      const x = 14 + i * (bw + gap);
      const has = GameWorld.hasInvestment(sid, k);
      const can = GameWorld.canInvest(sid, k);
      const costParts = [`${def.gold}g`];
      if (def.stone) costParts.push(`${def.stone} stone`);
      if (def.food) costParts.push(`${def.food} food`);
      const label = has ? `✓ ${def.name}` : def.name;
      this.spriteButton(x, y + 18, bw, 50, label, has ? 'built' : costParts.join(' · '), !has && can.ok, () => {
        const res = GameWorld.invest(sid, k);
        if (res.ok) { this.pullWorldResources(); this.syncInvestEffects(); this.showToast(`${def.name} built in ${this._settle ? this._settle.name : 'settlement'}`); }
        else this.showToast(res.reason || 'Cannot invest');
        this.refreshPanel();
      }, { gold: !has && can.ok, active: has });
      this.panelText(x, y + 70, def.desc, { color: '#aeb9c6', size: '9px' });
    });

    // Monuments shortcut (home only).
    if (isHome) this.spriteButton(GAME_W - 150, this.PANEL_Y + 30, 138, 30, 'Monuments →', '', true, () => { this.panelMode = 'cat_monuments'; this.refreshPanel(); });
  }

  // (Phase 11) Apply a just-taken investment's effects to the LIVE scene where
  // they show immediately (population pop count, happiness already on state).
  syncInvestEffects() {
    const st = this._settle as any; if (!st) return;
    this._investProdMult = GameWorld.investProductionMult(this._settlementId); // Infrastructure +10%
    this._investGrowthUntil = st.investGrowthUntil || 0; // Population +50% growth window
    if (this.population && typeof st.population === 'number') this.population.count = Math.max(this.population.count || 0, st.population);
    this.updatePopulationHud && this.updatePopulationHud();
  }

  // ==========================================================================
  // (Phase 11) MONUMENTS PANEL — late-game gold sinks raised at the home castle.
  // Each "Build" enters placement mode (the standard placement flow charges via
  // GameWorld.buildMonument + applies prestige). Shows cost, prestige, and which
  // are already raised.
  // ==========================================================================
  renderMonumentsPanel() {
    this.paintBottomPanel({ stone: true });
    this.flushResourcesToWorld();
    const isHome = !!(this._settle && this._settle.faction === 'player');
    this.panelText(14, this.PANEL_Y + 8, `MONUMENTS — Prestige ${GameWorld.prestige}   ·   Gold ${fmtNum(GameWorld.gold)}`, { color: '#c9a84c', bold: true });
    if (!isHome) {
      this.panelText(14, this.PANEL_Y + 34, 'Monuments are raised only at your home castle.', { color: '#9aa0a6' });
      this.spriteButton(GAME_W - 150, this.PANEL_Y + 8, 138, 26, '← Back', '', true, () => { this.panelMode = 'cat_invest'; this.refreshPanel(); });
      return;
    }
    const keys = ['victoryarch', 'greatstatue', 'imperialpalace'];
    const bw = 220, gap = 10;
    keys.forEach((k, i) => {
      const def = GameWorld.MONUMENT_DEFS[k];
      const x = 14 + i * (bw + gap), y = this.PANEL_Y + 30;
      const has = GameWorld.hasMonument(k);
      const can = GameWorld.canBuildMonument(k);
      const costParts = [`${def.gold}g`];
      if (def.stone) costParts.push(`${def.stone} stone`);
      if (def.iron) costParts.push(`${def.iron} iron`);
      if (def.planks) costParts.push(`${def.planks} planks`);
      const sub = has ? 'raised' : `${costParts.join(' · ')}  → +${def.prestige} prestige${def.morale ? `, +${def.morale} morale` : ''}`;
      const label = has ? `✓ ${def.name}` : (this.placementType === k ? `Placing ${def.name}…` : def.name);
      this.spriteButton(x, y, bw, 50, label, sub, !has && can.ok, () => {
        this.placementType = k; this.selectedBuilding = null; this.clearSelection(); this.hideTip();
        this.showToast(`Place ${def.name} — click a tile in your castle`);
        this.refreshPanel();
      }, { gold: !has && can.ok, active: has || this.placementType === k });
      if (!has && !can.ok && can.reason) this.panelText(x, y + 54, can.reason, { color: '#ff9a8a', size: '9px' });
    });
    this.spriteButton(GAME_W - 150, this.PANEL_Y + 8, 138, 26, '← Back', '', true, () => { this.placementType = null; this.clearGhost(); this.panelMode = 'cat_invest'; this.refreshPanel(); });
  }

  // (Expansion) March/attack a selected army toward a right-clicked point.
  commandArmy(army, wx, wy) {
    const tile = this.pointerToTile(wx, wy);
    if (!tile) return;
    if (army.marchTargetCol != null && Math.abs(army.marchTargetCol - tile.col) < 1 && Math.abs(army.marchTargetRow - tile.row) < 1) { this.armyMgr.stopMarch(army); return; }
    // (Phase 2) detect a hostile/settlement target under the click.
    const target = this.armyTargetAt ? this.armyTargetAt(tile.col, tile.row) : null;
    if (target) this.armyMgr.marchTo(army, target.col, target.row, { attackTarget: target });
    else this.armyMgr.marchTo(army, tile.col, tile.row);
    sfx.play('unit_command');
    this.floatText && this.floatText(this.tileCenter(tile.col, tile.row).x, this.tileCenter(tile.col, tile.row).y, target ? 'Attack!' : 'March', target ? '#ff8a80' : '#aee9ff');
  }

  // ---- Armies tab ----------------------------------------------------------
  renderArmiesPanel() {
    this.paintBottomPanel({ stone: true });
    const m = this.armyMgr; const list = m.playerArmies();
    this.panelText(14, this.PANEL_Y + 6, `ARMIES  (${list.length}/${m.maxPlayerArmies})`, { bold: true, color: '#bdf0d4' });
    if (!list.length) this.panelText(16, this.PANEL_Y + 32, 'No armies yet. Form one from your trained troops →', { color: '#9aa0a6' });
    list.forEach((a, i) => {
      const y = this.PANEL_Y + 28 + i * 30;
      this.panelText(16, y, a.name, { bold: true, color: '#ffffff', size: '13px' });
      this.panelText(150, y, `${m.totalUnits(a)} units · ${a.state} · morale ${a.morale} · supply ${a.supplyDays}d`, { color: '#bcd0c6', size: '11px' });
      this.spriteButton(540, y - 2, 86, 24, 'Select', '', true, () => { m.selectArmy(a); this.cameras.main.centerOn(this.tileCenter(a.col, a.row).x, this.tileCenter(a.col, a.row).y); });
      this.spriteButton(630, y - 2, 96, 24, 'Supplies', '', true, () => { m.sendSupplies(a); this.refreshPanel(); }, { gold: true });
      this.spriteButton(730, y - 2, 92, 24, 'Disband', '', true, () => { m.disband(a); this.refreshPanel(); });
    });
    this.spriteButton(GAME_W - 180, this.PANEL_Y + PANEL_H - 36, 168, 28, 'Form New Army', '', list.length < m.maxPlayerArmies, () => { this._armyFormSpec = { warrior: 0, archer: 0, monk: 0, knight: 0, mercenary: 0, siege: 0, spearmen: 0, cavalry: 0 }; this.panelMode = 'armyform'; this.refreshPanel(); }, { active: true });
    // (Phase 3) Diplomacy + Caravans live under the Armies category.
    this.spriteButton(GAME_W - 180, this.PANEL_Y + 6, 80, 24, 'Diplomacy', '', true, () => { this.panelMode = 'kingdoms'; this.refreshPanel(); });
    this.spriteButton(GAME_W - 96, this.PANEL_Y + 6, 84, 24, 'Caravans', '', !!(this.caravans && this.caravans.sites().length >= 2), () => { this.panelMode = 'caravans'; this.refreshPanel(); });
  }

  renderArmyForm() {
    this.paintBottomPanel({ stone: true });
    this.panelText(14, this.PANEL_Y + 6, 'FORM NEW ARMY — add units, then Form Army', { bold: true, color: '#bdf0d4' });
    const avail = this.armyMgr.availableUnits();
    const spec = this._armyFormSpec || (this._armyFormSpec = { warrior: 0, archer: 0, monk: 0, knight: 0, mercenary: 0 });
    const types = ['warrior', 'archer', 'monk', 'knight', 'mercenary'];
    let total = 0;
    types.forEach((t, i) => {
      const x = 16 + (i % 3) * 300, y = this.PANEL_Y + 30 + Math.floor(i / 3) * 36;
      this.panelText(x, y, `${t[0].toUpperCase() + t.slice(1)}: ${spec[t]}/${avail[t]}`, { color: avail[t] ? '#ffffff' : '#7d8389', size: '12px', bold: true });
      this.spriteButton(x + 150, y - 4, 30, 24, '−', '', spec[t] > 0, () => { spec[t]--; this.refreshPanel(); });
      this.spriteButton(x + 184, y - 4, 30, 24, '+', '', spec[t] < avail[t], () => { spec[t]++; this.refreshPanel(); });
      total += spec[t];
    });
    this.spriteButton(GAME_W - 300, this.PANEL_Y + PANEL_H - 36, 130, 28, 'Form Army', `${total} units`, total > 0, () => {
      const a = this.armyMgr.formArmy({ ...spec }); if (a) { this.panelMode = 'armies'; this.refreshPanel(); }
    }, { active: total > 0 });
    this.spriteButton(GAME_W - 160, this.PANEL_Y + PANEL_H - 36, 100, 28, 'Cancel', '', true, () => { this.panelMode = 'armies'; this.refreshPanel(); });
  }

  // (Phase 2/4) Build palette shows only stage-unlocked buildings (compact grid),
  // plus the 9-stage upgrade button with the next stage's requirements.
  renderDefaultPanel() {
    const status = this.placementType
      ? `Placing: ${BuildingTypes[this.placementType].name} — click a tile`
      : `${this.TIERS[this.tierIndex].name}  ·  pick a building, then click a tile`;
    this.panelText(12, this.PANEL_Y + 6, status, { color: '#f1e3c0' });
    this.panelText(GAME_W - 150, this.PANEL_Y + 6, `Buildings: ${this.buildings.placedCount()}/${this.maxBuildings()}`, { color: '#ffd23f', bold: true });

    const unlocked = BUILD_ORDER.filter((k) => this.buildingUnlocked(k));
    const bw = 88, h = 44, gap = 4, perRow = 7;
    unlocked.forEach((k, i) => {
      const col = i % perRow, rowi = Math.floor(i / perRow);
      const x = 6 + col * (bw + gap), y = this.PANEL_Y + 24 + rowi * (h + 6);
      const ok = this.buildingUnlocked(k) && this.buildings.canPlace(k, this.resources, this.maxBuildings()).ok;
      this.buildPaletteButton(x, y, bw, h, k, ok);
    });

    // Right side: cancel placement, or the settlement upgrade button.
    const uy = this.PANEL_Y + 26;
    if (this.placementType) {
      this.spriteButton(GAME_W - 150, uy, 140, 56, 'Cancel', 'stop placing', true, () => { this.placementType = null; this.clearGhost(); this.refreshPanel(); });
    } else if (this.tierIndex < this.TIERS.length - 1) {
      const nt = this.TIERS[this.tierIndex + 1];
      const ok = this.canUpgradeTier();
      const missing = Object.entries(nt.cost).filter(([r, v]) => (this.resources[r] || 0) < v).map(([r]) => r);
      const sub = ok ? formatCost(nt.cost) : `need ${missing.join(', ')}`;
      const btn = this.spriteButton(GAME_W - 196, uy, 186, 56, `→ ${nt.name}`, sub, ok, ok ? () => this.upgradeTier() : null, { gold: ok });
      if (ok) this.tweens.add({ targets: btn, alpha: 0.7, yoyo: true, repeat: -1, duration: 700 });
    } else {
      this.spriteButton(GAME_W - 150, uy, 140, 56, 'Large Castle', 'max stage', false, null);
    }
  }

  // (Phase 3) A category build panel — filtered build buttons for one category.
  renderCategoryBuild(title, keys) {
    this.paintBottomPanel();
    const status = this.placementType ? `Placing: ${BuildingTypes[this.placementType].name} — click a tile (Esc to cancel)` : `${title} — pick a building, then click a tile`;
    this.panelText(14, this.PANEL_Y + 8, status, { color: '#c9a84c', bold: true });
    this.panelText(GAME_W - 160, this.PANEL_Y + 8, `Buildings: ${this.buildings.placedCount()}/${this.maxBuildings()}`, { color: '#c9a84c', bold: true });
    const list = keys.filter((k) => BuildingTypes[k] && this.buildingUnlocked(k));
    const locked = keys.filter((k) => BuildingTypes[k] && !this.buildingUnlocked(k));
    const bw = 92, h = 46, gap = 6;
    list.forEach((k, i) => {
      const x = 14 + i * (bw + gap), y = this.PANEL_Y + 30;
      const ok = this.buildings.canPlace(k, this.resources, this.maxBuildings()).ok;
      this.buildPaletteButton(x, y, bw, h, k, ok);
    });
    // (Completion Phase 5) Build Road tool in the Industry category.
    if (title === 'INDUSTRY') {
      const rx = 14 + list.length * (bw + gap), ry = this.PANEL_Y + 30;
      this.spriteButton(rx, ry, bw, h, 'Road', '5 wood/tile', true, () => { this._roadMode = true; this._roadStart = null; this.placementType = null; this.clearGhost && this.clearGhost(); this.showToast && this.showToast('Build Road: click a start tile, then an end tile'); }, { active: this._roadMode });
    }
    if (locked.length) this.panelText(14, this.PANEL_Y + PANEL_H - 22, `Locked (later stage): ${locked.map((k) => BuildingTypes[k].name).join(', ')}`, { color: '#7d8389', size: '10px' });
  }

  // (Phase 3) Castle category — castle HP/upgrade, tier info, House build.
  renderCastlePanel() {
    this.paintBottomPanel({ stone: true });
    const c = this.buildings.castle;
    this.panelText(14, this.PANEL_Y + 8, `CASTLE — ${this.TIERS[this.tierIndex].name} (stage ${this.currentStage()}/9)`, { color: '#c9a84c', bold: true });
    if (c) {
      this.panelText(14, this.PANEL_Y + 30, `Keep HP: ${Math.round(c.hp)}/${c.maxHp}`, { color: '#ffffff' });
      this.panel.add(this.add.rectangle(14, this.PANEL_Y + 48, 240, 10, 0x000000, 0.5).setOrigin(0, 0).setScrollFactor(0));
      this.panel.add(this.add.rectangle(14, this.PANEL_Y + 48, 240 * Phaser.Math.Clamp(c.hp / c.maxHp, 0, 1), 10, 0x4ad66b).setOrigin(0, 0).setScrollFactor(0));
    }
    // House build button (population housing lives under the kingdom core).
    if (this.buildingUnlocked('house')) this.buildPaletteButton(14, this.PANEL_Y + 64, 92, 44, 'house', this.buildings.canPlace('house', this.resources, this.maxBuildings()).ok);
    // (Phase 11) Invest panel — army equipment, settlement investment, monuments.
    this.spriteButton(114, this.PANEL_Y + 64, 110, 44, 'Invest', 'equip · upgrade · monuments', true, () => { this.panelMode = 'cat_invest'; this.refreshPanel(); }, { gold: true });
    // (Completion Phase 8) Reinforce the castle (+50 max HP, up to 5 times).
    if (c) {
      const f = c._fortify || 0;
      this.panelText(280, this.PANEL_Y + 30, `Fortifications: ${f}/5`, { color: '#cfc1a6', size: '12px' });
      this.spriteButton(280, this.PANEL_Y + 48, 150, 30, f < 5 ? 'Reinforce Castle' : 'Fully Fortified', '100g → +50 max HP', f < 5 && this.resources.gold >= 100, () => this.reinforceCastle(), { gold: f < 5 });
    }
    // Upgrade to next tier.
    const uy = this.PANEL_Y + 26;
    if (this.tierIndex < this.TIERS.length - 1) {
      const nt = this.TIERS[this.tierIndex + 1];
      const ok = this.canUpgradeTier();
      const missing = Object.entries(nt.cost).filter(([r, v]) => (this.resources[r] || 0) < v).map(([r]) => r);
      const sub = ok ? formatCost(nt.cost) : `need ${missing.join(', ')}`;
      const btn = this.spriteButton(GAME_W - 220, uy, 200, 56, `Upgrade → ${nt.name}`, sub, ok, ok ? () => this.upgradeTier() : null, { gold: ok });
      if (ok) this.tweens.add({ targets: btn, alpha: 0.7, yoyo: true, repeat: -1, duration: 700 });
    } else {
      this.spriteButton(GAME_W - 220, uy, 200, 56, 'Large Castle', 'max stage reached', false, null);
    }
  }

  // (Completion Phase 8) Permanently raise the keep's max HP (5× max).
  reinforceCastle() {
    const c = this.buildings.castle; if (!c) return;
    if ((c._fortify || 0) >= 5) { this.showToast('Castle fully fortified'); return; }
    if (!this.resources.spend({ gold: 100 })) { this.showToast('Need 100 gold'); return; }
    c._fortify = (c._fortify || 0) + 1; c.maxHp += 50; c.hp += 50;
    if (c.refreshHpBar) c.refreshHpBar();
    this.showToast(`Castle reinforced (+50 HP) — ${c._fortify}/5`); this.refreshPanel();
  }

  // (Phase 3) Military category — barracks/tower build, training, expeditions.
  renderMilitaryPanel() {
    this.paintBottomPanel({ stone: true });
    this.panelText(14, this.PANEL_Y + 8, `MILITARY — Soldiers ${this.soldierTotal()}/${this.soldierCap()}`, { color: '#c9a84c', bold: true });
    // Build barracks / tower.
    ['barracks', 'tower'].filter((k) => this.buildingUnlocked(k)).forEach((k, i) => {
      this.buildPaletteButton(14 + i * 98, this.PANEL_Y + 28, 92, 44, k, this.buildings.canPlace(k, this.resources, this.maxBuildings()).ok);
    });
    // Castle Defense roster (unassigned units — Phase 4 Decision 2).
    const snap = this.troops.snapshot();
    const defTxt = snap.length ? snap.map((g) => `${g.type} x${g.count}`).join('  ') : 'none';
    this.panelText(14, this.PANEL_Y + 80, `Castle Defense: ${defTxt}`, { color: '#b9c6d6', size: '11px' });
    // Train buttons (need a barracks selected normally; here quick-train at first barracks).
    const bar = this.buildings.buildings.find((b) => b.typeKey === 'barracks' && b.alive);
    const tx = 230;
    if (bar) {
      // (Feature #3) Champion unlocks at Barracks L5 (1 max). Warriors trained at
      // an L4+ barracks arrive as Elites (+50% stats) automatically.
      // (V2 Phase 4) counter hints teach the rock-paper-scissors without a tutorial.
      const types = [['warrior', 1, 'beats Spear'], ['archer', 2, 'beats Warrior'], ['spearmen', 2, 'beats Cavalry'], ['cavalry', 3, 'beats Archer'], ['monk', 3, 'support'], ['knight', 2, 'no weakness'], ['champion', 5, 'Lv5·1max']];
      types.forEach(([t, lvl, hint]: any, i) => {
        let can = bar.level >= lvl && this.soldierRoom() > 0 && ((t !== 'knight' && t !== 'cavalry') || (this.hasBlacksmith && this.hasBlacksmith()));
        if (t === 'champion' && this.troops.championCount && this.troops.championCount() > 0) can = false; // 1 max
        const label = t === 'warrior' && bar.level >= 4 ? 'Elite' : t.charAt(0).toUpperCase() + t.slice(1);
        this.spriteButton(tx + i * 86, this.PANEL_Y + 28, 80, 30, label, hint, can, () => this.trainUnit(bar, t));
      });
      this.panelText(tx, this.PANEL_Y + 64, `Barracks Lv ${bar.level}/5${bar.level >= 4 ? ' — trains Elites' : ''}${bar.level >= 5 ? ' + Champion' : ''}`, { color: '#cfc1a6', size: '11px' });
    } else {
      this.panelText(tx, this.PANEL_Y + 34, 'Build a Barracks to train soldiers.', { color: '#9aa0a6', size: '11px' });
    }
    // Expeditions + Ruins access.
    this.spriteButton(GAME_W - 230, this.PANEL_Y + 28, 100, 28, 'Expeditions', '', true, () => { this.panelMode = 'expedition'; this.refreshPanel(); });
    this.spriteButton(GAME_W - 120, this.PANEL_Y + 28, 100, 28, 'Ruins', '', !!(this.ruins && this.ruins.list.some((r) => r.discovered)), () => { this.panelMode = 'ruins'; this.refreshPanel(); });
    // (Completion Phase 8) Gold sinks — emergency levy + mercenary hire.
    const day = this.gameDay || 0;
    const levyReady = day - (this._lastLevyDay ?? -99) >= 5;
    this.spriteButton(GAME_W - 348, this.PANEL_Y + 70, 158, 28, levyReady ? 'Emergency Levy' : 'Levy (on cooldown)', '200g → 3 warriors', levyReady && this.resources.gold >= 200 && this.soldierRoom() >= 1, () => this.emergencyLevy(), { gold: true });
    const mercs = this.troops.warriors.filter((w) => w.mercenary).length;
    this.spriteButton(GAME_W - 184, this.PANEL_Y + 70, 164, 28, 'Hire Mercenary', `80g  (${mercs}/5)`, mercs < 5 && this.resources.gold >= 80 && this.soldierRoom() > 0, () => this.hireMercenary(), { gold: true });
  }

  // (Completion Phase 8) Instantly raise 3 warriors (once per 5 days).
  emergencyLevy() {
    if ((this.gameDay || 0) - (this._lastLevyDay ?? -99) < 5) { this.showToast('Levy on cooldown'); return; }
    if (!this.resources.spend({ gold: 200 })) { this.showToast('Need 200 gold'); return; }
    const c = this.buildings.castle;
    for (let i = 0; i < 3; i++) this.troops.spawnAt(c.x + Phaser.Math.Between(-30, 30), c.y + Phaser.Math.Between(20, 40));
    this._lastLevyDay = this.gameDay; this.showToast('Emergency levy — 3 warriors raised'); this.refreshPanel();
  }
  hireMercenary() {
    const mercs = this.troops.warriors.filter((w) => w.mercenary).length;
    if (mercs >= 5) { this.showToast('Max 5 mercenaries'); return; }
    if (this.soldierRoom() <= 0) { this.showToast('No soldier capacity'); return; }
    if (!this.resources.spend({ gold: 80 })) { this.showToast('Need 80 gold'); return; }
    this.troops.spawnMercenary(); this.refreshPanel();
  }
  // (Completion Phase 8) +30 happiness for 150 gold (once per 10 days).
  distributeWealth() {
    if ((this.gameDay || 0) - (this._lastTributeDay ?? -99) < 10) { this.showToast('Already distributed recently'); return; }
    if (!this.resources.spend({ gold: 150 })) { this.showToast('Need 150 gold'); return; }
    if (this.population) this.population.happiness = Math.min(100, this.population.happiness + 30);
    this._lastTributeDay = this.gameDay; this.showToast('Wealth distributed — happiness +30'); this.updatePopulationHud && this.updatePopulationHud(); this.refreshPanel();
  }
  // (V2 Phase 1) A leader speaks — portrait + speech bubble, bottom-left.
  showLeaderSpeech(faction, text) {
    if (this._leaderSpeech) { this._leaderSpeech.forEach((o) => o.destroy()); this._leaderSpeech = null; }
    const L = this.leaders; if (!L) return;
    const fix = (o) => o.setScrollFactor(0).setDepth(96);
    const px = 16, py = GAME_H - PANEL_H - 120, els = [];
    const pk = L.portraitKey(faction);
    if (this.textures.exists(pk)) els.push(fix(this.add.image(px, py, pk).setOrigin(0, 0).setDisplaySize(72, 72)));
    els.push(fix(this.add.rectangle(px + 80, py + 6, 360, 60, 0x141019, 0.97).setOrigin(0, 0).setStrokeStyle(2, (L.def(faction) && L.def(faction).color) || 0xc9a14a, 0.9)));
    els.push(fix(this.add.text(px + 90, py + 12, L.name(faction), { fontFamily: 'monospace', fontSize: '12px', color: '#ffe9b0', fontStyle: 'bold' })));
    els.push(fix(this.add.text(px + 90, py + 30, text, { fontFamily: 'monospace', fontSize: '13px', color: '#f0e6d0', wordWrap: { width: 340 }, fontStyle: 'italic' })));
    this._leaderSpeech = els;
    if (this.routeCameras) this.routeCameras();
    this.time.delayedCall(5200, () => { if (this._leaderSpeech === els) { els.forEach((o) => o.destroy()); this._leaderSpeech = null; } });
  }

  // (Completion Phase 11) One-time intro card the first time a system appears.
  introCard(key, title, body) {
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem('kg_intro') || '{}'); } catch (e) {}
    if (seen[key]) return; seen[key] = true;
    try { localStorage.setItem('kg_intro', JSON.stringify(seen)); } catch (e) {}
    const fix = (o) => o.setScrollFactor(0).setDepth(98);
    const W = 520, H = 92, cx = GAME_W / 2, top = this.PANEL_Y - H - 16, els = [];
    els.push(fix(this.add.rectangle(cx, top + H / 2, W, H, 0x1a140c, 0.98).setStrokeStyle(2, 0xc9a14a, 0.95)));
    els.push(fix(this.add.text(cx - W / 2 + 16, top + 10, '★ ' + title, { fontFamily: 'monospace', fontSize: '15px', color: '#ffe9b0', fontStyle: 'bold' })));
    els.push(fix(this.add.text(cx - W / 2 + 16, top + 34, body, { fontFamily: 'monospace', fontSize: '12px', color: '#f0e6d0', wordWrap: { width: W - 120 }, lineSpacing: 3 })));
    const b = fix(this.add.rectangle(cx + W / 2 - 56, top + H - 24, 92, 26, 0x2d6cb0).setStrokeStyle(1, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
    els.push(b); els.push(fix(this.add.text(cx + W / 2 - 56, top + H - 24, 'Got it', { fontFamily: 'monospace', fontSize: '12px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));
    const close = () => els.forEach((o) => o.destroy());
    b.on('pointerdown', (p, lx, ly, ev) => { if (ev) ev.stopPropagation(); close(); });
    this.time.delayedCall(13000, close);
    if (this.routeCameras) this.routeCameras();
  }

  // (Completion Phase 8) Buy detailed intel on one faction for 5 days.
  spyOn(key) {
    if (!this.resources.spend({ gold: 75 })) { this.showToast('Need 75 gold'); return; }
    const k = (this.kingdoms || []).find((x) => x.cfg.key === key); if (k) k._spyUntil = (this.gameDay || 0) + 5;
    this.showToast('Spies dispatched — intel for 5 days'); this.refreshPanel();
  }

  // (Phase 5) A build-palette button: name on top, cost as icon+number pairs,
  // a hover tooltip (name + description), and auto-deselect handled in tryBuild.
  buildPaletteButton(x, y, w, h, key, ok) {
    const t = BuildingTypes[key];
    const active = this.placementType === key;
    const fill = !ok ? 0x39393f : active ? 0x2e8b57 : 0x2d6cb0;
    const bg = this.add.rectangle(x, y, w, h, fill).setOrigin(0, 0).setScrollFactor(0).setStrokeStyle(2, ok ? 0xf0e6c8 : 0x666666, ok ? 0.85 : 0.4).setInteractive({ useHandCursor: ok });
    this.panel.add(bg);
    this.panel.add(this.add.text(x + w / 2, y + 7, t.name, { fontFamily: 'monospace', fontSize: '11px', color: ok ? '#ffffff' : '#9aa0a6', fontStyle: 'bold' }).setOrigin(0.5, 0).setScrollFactor(0));
    this.drawCostRow(x, y + h - 12, w, t.cost, ok);
    bg.on('pointerover', () => { if (ok && !active) bg.setFillStyle(0x3d83cf); this.showTip(x + w / 2, y, t.name, t.desc || ''); });
    bg.on('pointerout', () => { if (ok && !active) bg.setFillStyle(fill); this.hideTip(); });
    if (ok) bg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.placementType = key; this.selectedBuilding = null; this.clearSelection(); this.hideTip(); this.time.delayedCall(0, () => this.refreshPanel()); });
  }

  // Lays out a building cost as small resource icon + amount pairs, centred in w.
  drawCostRow(x, cy, w, cost, ok) {
    const entries = Object.entries(cost || {});
    if (!entries.length) {
      this.panel.add(this.add.text(x + w / 2, cy - 5, 'Free', { fontFamily: 'monospace', fontSize: '10px', color: '#bfe6c0' }).setOrigin(0.5, 0).setScrollFactor(0));
      return;
    }
    const g = this.add.graphics().setScrollFactor(0); this.panel.add(g);
    const itemW = (v) => 13 + 1 + `${v}`.length * 6 + 7;
    const total = entries.reduce((s, [, v]) => s + itemW(v), 0);
    let cx = x + (w - total) / 2 + 6;
    for (const [k, v] of entries) {
      this.resGlyph(g, cx, cy, k);
      this.panel.add(this.add.text(cx + 8, cy, `${v}`, { fontFamily: 'monospace', fontSize: '11px', color: ok ? '#ffe9b0' : '#9aa0a6', fontStyle: 'bold' }).setOrigin(0, 0.5).setScrollFactor(0));
      cx += itemW(v);
    }
  }

  // A ~13px resource icon: image for wood/food/gold, drawn shape otherwise.
  resGlyph(g, cx, cy, key) {
    if (key === 'wood' || key === 'food' || key === 'gold') {
      this.panel.add(this.add.image(cx, cy, `icon_${key}`).setDisplaySize(14, 14).setScrollFactor(0));
      return;
    }
    if (key === 'stone') g.fillStyle(0xaab1ba, 1).fillRoundedRect(cx - 6, cy - 4, 12, 9, 2);
    else if (key === 'iron') { g.fillStyle(0x6b7686, 1); g.beginPath(); g.moveTo(cx, cy - 6); g.lineTo(cx + 5, cy); g.lineTo(cx, cy + 6); g.lineTo(cx - 5, cy); g.closePath(); g.fillPath(); }
    else if (key === 'equipment') { g.fillStyle(0xd2d9e2, 1).fillRect(cx - 1.4, cy - 6, 2.8, 9); g.fillRect(cx - 4, cy + 1, 8, 2.2); g.fillStyle(0x9a6a3a, 1).fillRect(cx - 1.4, cy + 3, 2.8, 3); }
    else g.fillStyle(0xcfc1a6, 1).fillCircle(cx, cy, 5);
  }

  // (Phase 2) Market / Tavern get custom panels; everything else uses the base.
  renderSelectedPanel(b) {
    if (b.typeKey === 'market') this.renderMarketPanel(b);
    else if (b.typeKey === 'tavern') this.renderTavernPanel(b);
    else super.renderSelectedPanel(b);
    if (b.typeKey === 'siegeworkshop') this.addSiegeTrainButton(b); // (Completion Phase 7)
    // (Gameplay change 2) Move + Demolish actions on every building but the Castle.
    if (b.typeKey !== 'castle') this.addBuildingActionButtons(b);
  }

  // (Completion Phase 7) Train a siege engine at the Siege Workshop (4 days).
  addSiegeTrainButton(b) {
    if (b._siegeDays > 0) { this.panelText(GAME_W / 2 - 110, this.PANEL_Y + 40, `Building siege engine: ${b._siegeDays}d left`, { color: '#c9a86a', bold: true }); return; }
    const cost = { gold: 100, planks: 20, iron: 10 };
    const can = this.resources.canAfford(cost);
    this.spriteButton(GAME_W / 2 - 100, this.PANEL_Y + 36, 200, 40, 'Train Siege Unit', '100g · 20 planks · 10 iron · 4d', can, () => { if (this.resources.spend(cost)) { b._siegeDays = 4; this.refreshPanel(); } }, { gold: can });
  }

  addBuildingActionButtons(b) {
    const x = GAME_W - 128, w = 120;
    this.diploButton(x, this.PANEL_Y + 10, w, 28, 'Move', 'free', 0x1f5b3a, 0x2e7d50, true, () => this.startMoveBuilding(b));
    this.diploButton(x, this.PANEL_Y + 42, w, 28, 'Demolish', '+50% refund', 0x5c1a1a, 0x8a2a2a, true, () => this.confirmDemolish(b));
    // (Completion Phase 6) Mines near an iron deposit can toggle Stone/Iron.
    if (b.typeKey === 'mine' && this.ironNodeNear(b)) {
      const lbl = b._mineIron ? 'Mining: Iron' : 'Mining: Stone';
      this.diploButton(x - 132, this.PANEL_Y + 10, w, 28, lbl, 'tap to switch', 0x4a4030, 0x6a5a40, true, () => { b._mineIron = !b._mineIron; this.showToast && this.showToast(b._mineIron ? 'Now mining Iron' : 'Now mining Stone'); this.refreshPanel(); });
    }
  }

  // (Completion Phase 6) Nearest live iron deposit within 8 tiles of a building.
  ironNodeNear(b) {
    if (!this.nodes || !this.nodes.nearestAnyNode) return null;
    return this.nodes.nearestAnyNode(b.x, b.y, 8 * this.TILE, ['iron']);
  }

  confirmDemolish(b) {
    this.hideTip();
    if (this._confirmEls) this._confirmEls.forEach((o) => o.destroy());
    const def = BuildingTypes[b.typeKey];
    const W = 460, H = 100, cx = GAME_W / 2, top = this.PANEL_Y - H - 14;
    const fix = (o) => o.setScrollFactor(0).setDepth(82);
    const els = [];
    els.push(fix(this.add.rectangle(cx, top + H / 2, W, H, 0x1a120a, 0.98).setStrokeStyle(2, 0xc9a14a, 0.95)));
    els.push(fix(this.add.text(cx, top + 14, `Demolish ${def ? def.name : 'building'}?`, { fontFamily: 'monospace', fontSize: '16px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0)));
    els.push(fix(this.add.text(cx, top + 40, 'You will receive 50% of resources back.', { fontFamily: 'monospace', fontSize: '12px', color: '#f0e6d0' }).setOrigin(0.5, 0)));
    const close = () => { els.forEach((o) => o.destroy()); this._confirmEls = null; };
    const conf = fix(this.add.rectangle(cx - 86, top + H - 24, 150, 32, 0x5c1a1a).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
    els.push(conf);
    els.push(fix(this.add.text(cx - 86, top + H - 24, 'Confirm', { fontFamily: 'monospace', fontSize: '13px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));
    conf.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); close(); this.demolishBuilding(b); });
    const can = fix(this.add.rectangle(cx + 86, top + H - 24, 150, 32, 0x2d4a6b).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
    els.push(can);
    els.push(fix(this.add.text(cx + 86, top + H - 24, 'Cancel', { fontFamily: 'monospace', fontSize: '13px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));
    can.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); close(); });
    this._confirmEls = els;
    this.routeCameras && this.routeCameras();
  }

  renderMarketPanel(b) {
    this.panel.add(this.leatherPanel(8, this.PANEL_Y + 8, GAME_W - 16, PANEL_H - 16, { radius: 5, seed: this.PANEL_Y + 1 }));
    this.panel.add(this.woodFrame(8, this.PANEL_Y + 8, GAME_W - 16, PANEL_H - 16, { thickness: 6 }));
    this.panelText(20, this.PANEL_Y + 12, `Market  ·  ${b.workers > 0 ? 'open' : 'needs a worker'}`, { bold: true, color: '#ffe9b0', size: '16px' });
    this.workerControls(b, 20, this.PANEL_Y + 36);
    const trades: any[] = [
      ['20 Wood → 10 Gold', { wood: 20 }, { gold: 10 }],
      ['20 Stone → 10 Gold', { stone: 20 }, { gold: 10 }],
      ['10 Gold → 15 Wood', { gold: 10 }, { wood: 15 }],
      ['10 Gold → 15 Stone', { gold: 10 }, { stone: 15 }],
      ['15 Food → 10 Gold', { food: 15 }, { gold: 10 }],
    ];
    let x = 150;
    for (const [label, give, get] of trades) {
      // (Gameplay change 1) No daily limit — trade as long as resources allow.
      const can = b.workers > 0 && this.resources.canAfford(give);
      // (Phase 4) Merchant trait + reputation improve what you receive.
      const mult = (this.traitBonuses ? this.traitBonuses.marketMult : 1) + (this.reputation ? this.reputation.marketBonus() : 0) + ((this._researchMarketMult || 1) - 1) + ((this._heroMarket || 1) - 1) + ((this._weatherTradeMult || 1) - 1); // (V2 P3) Caelan; (V2 P12) drought scarcity
      this.spriteButton(x, this.PANEL_Y + 30, 132, 40, label.split(' → ')[0] + '→', label.split(' → ')[1], can, () => {
        this.resources.spend(give); for (const [r, v] of Object.entries(get) as [string, number][]) this.resources.add(r, Math.round(v * mult)); if (this.reputation) this.reputation.add('merchant', 3); if (this.stats) this.stats.note('marketTrades'); this.refreshPanel();
      });
      x += 136;
    }
    this.spriteButton(GAME_W - 92, this.PANEL_Y + 88, 80, 30, 'Close', '', true, () => { this.selectedBuilding = null; this.clearSelection(); this.refreshPanel(); });
  }

  renderTavernPanel(b) {
    this.panel.add(this.leatherPanel(8, this.PANEL_Y + 8, 440, PANEL_H - 16, { radius: 5, seed: this.PANEL_Y + 2 }));
    this.panel.add(this.woodFrame(8, this.PANEL_Y + 8, 440, PANEL_H - 16, { thickness: 6 }));
    this.panelText(20, this.PANEL_Y + 12, 'Tavern', { bold: true, color: '#ffe9b0', size: '18px' });
    this.panelText(20, this.PANEL_Y + 40, '+10 starting morale in battle while built.', { color: '#cfe0ff', size: '12px' });
    this.panelText(20, this.PANEL_Y + 60, b._recruitCd > 0 ? `Recruit ready in ${b._recruitCd} day(s)` : 'A mercenary is available to recruit.', { color: '#cfc1a6', size: '12px' });
    this.workerControls(b, 20, this.PANEL_Y + 80);
    const can = b.workers > 0 && (!b._recruitCd || b._recruitCd <= 0) && this.resources.gold >= 50 && this.soldierRoom() > 0; // (BUG 1) mercenaries count toward the cap
    this.spriteButton(456, this.PANEL_Y + 30, 220, 52, 'Recruit Mercenary', this.soldierRoom() > 0 ? '50 gold' : 'Cap reached', can, () => { this.resources.spend({ gold: 50 }); this.troops.spawnMercenary(); b._recruitCd = 3; this.refreshPanel(); }, { gold: can });
    this.spriteButton(GAME_W - 120, this.PANEL_Y + 30, 104, 52, 'Close', '', true, () => { this.selectedBuilding = null; this.clearSelection(); this.refreshPanel(); });
  }

  // (Phase 5) Expeditions now return only special rewards; durations in days.
  renderExpeditionPanel() {
    this.paintBottomPanel();
    this.panelText(16, this.PANEL_Y + 8, `EXPEDITIONS — special rewards only.   Soldiers: ${this.troops.count}    Iron: ${Math.floor(this.resources.iron)}`, { bold: true, color: '#ffe9b0' });

    // (FIX 3) Each type can have several slots running at once; the button
    // sends another party while free, and active slots show their own countdown.
    // (Phase 5) Three evenly-spaced cards that fit the panel without clipping;
    // disabled cards (too few soldiers) show a tooltip explaining why.
    const keys = ['scout', 'raid', 'campaign'];
    const gap = 12, x0 = 14;
    const w = Math.floor((GAME_W - 28 - gap * (keys.length - 1)) / keys.length);
    const by = this.PANEL_Y + 30;
    keys.forEach((key, i) => {
      const x = x0 + i * (w + gap);
      const def = this.expeditions.defs[key];
      const active = this.expeditions.activeCount(key);
      const can = this.expeditions.canSend(key);
      const btn = this.spriteButton(x, by, w, 42, `${def.name}  (${def.cost} sol · ${def.days}d)`, def.reward, can, () => this.expeditions.send(key));
      if (!can) {
        const why = this.troops.count < def.cost ? `Need ${def.cost} soldiers — you have ${this.troops.count}.` : active >= def.maxSlots ? `All ${def.maxSlots} parties already out.` : 'Cannot send right now.';
        btn.setInteractive({ useHandCursor: false });
        btn.on('pointerover', () => this.showTip(x + w / 2, by, def.name, `${why}\nReward: ${def.reward}`));
        btn.on('pointerout', () => this.hideTip());
      }
      const days = this.expeditions.slotDays(key);
      const slotTxt = `Out ${active}/${def.maxSlots}` + (days.length ? '   ' + days.map((d) => `[${d.toFixed(1)}d]`).join(' ') : '');
      this.panelText(x + 2, by + 46, slotTxt, { size: '12px', color: active > 0 ? '#ffe066' : '#9aa0a6' });
    });

    this.spriteButton(GAME_W - 110, this.PANEL_Y + 6, 100, 22, `Artifacts (${this.artifacts.length})`, '', true, () => { this.panelMode = 'artifacts'; this.refreshPanel(); }, { gold: true });
    // (Session-1 Phase 1) Ruins sub-panel — shows discovered ruins to explore.
    if (this.ruins) {
      const disc = this.ruins.list.filter((r) => r.discovered).length;
      this.spriteButton(GAME_W - 224, this.PANEL_Y + 6, 108, 22, `Ruins (${this.ruins.exploredCount()}/${this.ruins.list.length})`, '', disc > 0, () => { this.panelMode = 'ruins'; this.refreshPanel(); }, { gold: disc > 0 });
    }
    // (Session-1 Phase 2) Send Envoy to revealed, not-yet-friendly tribes.
    if (this.factions) {
      const tribes = this.factions.tribes.filter((t) => t.revealed && t.relation !== 'friendly');
      tribes.forEach((t, i) => {
        const can = this.resources.gold >= 50 && this.expeditions.state.envoy.length < this.expeditions.defs.envoy.maxSlots;
        this.spriteButton(14 + i * 320, this.PANEL_Y + PANEL_H - 30, 300, 24, `Send Envoy: ${t.name}`, '50 gold · 1 day → friendly', can, () => this.expeditions.sendEnvoy(t.biome), { gold: can });
      });
    }
  }

  // (Session-1 Phase 1) Discovered ruins, each explorable once.
  renderRuinsPanel() {
    this.paintBottomPanel();
    this.panelText(16, this.PANEL_Y + 8, `ANCIENT RUINS — explore for unique rewards   (Soldiers: ${this.troops.count})`, { bold: true, color: '#ffe9b0' });
    const avail = this.ruins.available();
    const out = this.ruins.list.filter((r) => r.explored);
    if (!this.ruins.list.some((r) => r.discovered)) {
      this.panelText(16, this.PANEL_Y + 42, 'No ruins discovered yet. Move units through the wilderness to find them.', { color: '#cfc1a6' });
    }
    const def = this.expeditions.defs.exploreRuin;
    avail.forEach((r, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = 16 + col * 470, y = this.PANEL_Y + 30 + row * 30;
      const can = this.troops.count >= def.cost && this.expeditions.state.exploreRuin.length < def.maxSlots;
      this.spriteButton(x, y, 300, 26, `Explore: ${r.name}`, `${def.cost} soldiers · ${def.days} days`, can, () => { this.expeditions.sendRuin(r.name); });
    });
    // Show in-progress + explored status on the right.
    const outX = 640; let oy = this.PANEL_Y + 30;
    this.expeditions.state.exploreRuin.forEach((slot) => { this.panelText(outX, oy, `Exploring ${slot.target} [${(slot.timeLeft / 300).toFixed(1)}d]`, { color: '#ffe066', size: '11px' }); oy += 16; });
    out.forEach((r) => { this.panelText(outX, oy, `✓ ${r.name} (explored)`, { color: '#7cfc7c', size: '11px' }); oy += 16; });
    this.spriteButton(GAME_W - 88, this.PANEL_Y + PANEL_H - 30, 78, 22, 'Back', '', true, () => { this.panelMode = 'expedition'; this.refreshPanel(); });
  }

  // (Phase 5) Owned artifacts + scroll / iron tallies.
  renderArtifactsPanel() {
    this.paintBottomPanel();
    this.panelText(16, this.PANEL_Y + 8, `ARTIFACTS (${this.artifacts.length}/${this.ARTIFACT_DEFS.length})    Scrolls: ${this.scrolls}    Iron: ${Math.floor(this.resources.iron)}`, { bold: true, color: '#ffe9b0' });
    if (this.artifacts.length === 0) {
      this.panelText(16, this.PANEL_Y + 42, 'No artifacts yet — a Major Campaign returns one for certain; scouting has a small chance.', { color: '#cfc1a6' });
    } else {
      const owned = this.ARTIFACT_DEFS.filter((a) => this.artifacts.includes(a.key));
      owned.forEach((a, i) => {
        const col = i % 2;
        const cx = 16 + col * 470;
        const cy = this.PANEL_Y + 36 + Math.floor(i / 2) * 28;
        this.panelText(cx, cy, `✦ ${a.name}`, { color: '#ffd23f', bold: true, size: '13px' });
        this.panelText(cx + 186, cy, a.desc, { color: '#cfe0ff', size: '12px' });
      });
    }
    this.spriteButton(GAME_W - 88, this.PANEL_Y + 6, 78, 22, 'Back', '', true, () => { this.panelMode = 'expedition'; this.refreshPanel(); });
  }

  // ---- Phase 6: multiple AI kingdoms --------------------------------------

  // Wave banner when any kingdom launches an attack — always shows immediately
  // (priority), jumping ahead of any wildlife-spawn warnings in the queue.
  onKingdomAttack(kingdom) {
    sfx.play('enemy_attack_warning'); // (Polish Phase 2) war horn
    this._lastAttackDay = this.gameDay; // (Phase 5) happiness: recent attack
    // (Phase 6) Allied kingdoms send reinforcements when we're attacked.
    if (this.diplomacy && this.diplomacy.onPlayerAttacked) this.diplomacy.onPlayerAttacked();
    // (Bug 8) A new wave releases any held units so they resume auto-defense.
    if (this.troops) for (const u of this.troops.allUnits()) u.playerCommanded = false;
    this.threatWarning(`${kingdom.cfg.name} is attacking!`, kingdom.cfg.color, true);
    const wt = this.hud && this.hud.wave;
    if (wt) { const x0 = wt.x; this.tweens.add({ targets: wt, x: x0 + 5, yoyo: true, repeat: 5, duration: 45, onComplete: () => (wt.x = x0) }); }
    // (Phase 1) Large engagements (10+ combined units) resolve in the BattleScene.
    const enemies = this.waves.enemies.filter((e) => e.faction === kingdom);
    const battled = this.maybeTriggerBattle(enemies, kingdom.cfg.key, { type: 'wave', kingdom, defending: true });
    if (!battled) this.showTutorial(5); // Phase 2: stage 5 on first small attack (battles have their own UI)
  }

  // ---- Phase 1: BattleScene trigger + outcome -----------------------------

  battleTerrain() {
    const c = this.buildings.castle;
    const b = c ? this.biomeAt(c.col, c.row) : 'start';
    return { forest: 'forest', mountains: 'mountains', wildlands: 'wildlands' }[b] || 'plains';
  }

  enemyArmyFrom(enemies) {
    const c = {};
    for (const e of enemies) {
      const t = e.kind === 'goblin' ? 'goblin' : e instanceof AIArcher || e.range > 2 * this.TILE ? 'archer' : 'warrior';
      c[t] = (c[t] || 0) + 1;
    }
    return Object.entries(c).map(([type, count]) => ({ type, count }));
  }

  // Launch the BattleScene if the combined unit count is 10+. Returns true if a
  // battle started. The player's army + the given enemies leave the world and
  // survivors are restored when the battle resolves.
  maybeTriggerBattle(enemies, faction, context) {
    if (this._inBattle || this.isGameOver) return false;
    const playerArmy = this.troops.snapshot();
    const pTotal = playerArmy.reduce((s, g) => s + g.count, 0);
    if (pTotal + enemies.length < 10) return false;
    this._lastEnemyCount = enemies.length; // (Phase 6) stats
    this._inBattle = true;
    try { SaveManager.save(this, 0); } catch (e) {} // (Save system) auto-save before BattleScene
    const enemyArmy = this.enemyArmyFrom(enemies);
    for (const e of enemies) e.destroy();
    this.troops.removeAll();
    this.deselectAllUnits();
    this._launchWithTransition('TO BATTLE', 'Marshalling the host…', 0xd06a4a, () => {
      this.scene.launch('BattleScene', {
        playerArmy, enemyArmy, terrainType: this.battleTerrain(), enemyFaction: faction,
        context, playerDefending: !!(context && context.defending), taverMoraleBonus: this.hasTavern && this.hasTavern(),
        defenderWalls: !!(context && !context.defending && (context.kind === 'settlement' || context.kind === 'castle')), // (Phase 7)
        onComplete: (res) => this.onBattleComplete(res),
      });
      this.scene.pause();
    });
    return true;
  }

  onBattleComplete(res) {
    this._inBattle = false;
    this.scene.resume();
    if (res && res.victory) { this._lastBattleWonDay = this.gameDay; this._battlesWon = (this._battlesWon || 0) + 1; if (this.stats) { this.stats.note('battlesWon'); this.stats.note('enemiesDefeated', (this._lastEnemyCount || 0)); } } else { this._lastBattleLostDay = this.gameDay; if (this.stats) this.stats.note('battlesLost'); } // (Phase 5) happiness; (Audit FIX 2) battle tally; (Phase 6) stats
    const c = this.buildings.castle;
    if (c) {
      for (const grp of res.army || []) {
        for (let i = 0; i < grp.count; i++) {
          if (grp.type === 'archer') this.troops.spawnArcher(c);
          else if (grp.type === 'monk') this.troops.spawnMonk(c);
          else if (grp.type === 'mercenary') this.troops.spawnMercenary();
          else if (grp.type === 'knight' && this.troops.spawnKnight) this.troops.spawnKnight(c);
          else this.troops.spawnAt(c.x + Phaser.Math.Between(-40, 40), c.y + Phaser.Math.Between(24, 56));
        }
      }
    }
    if (res.victory) {
      if (res.loot) { this.resources.add('gold', res.loot.gold || 0); if (res.loot.iron) this.resources.add('iron', res.loot.iron); }
      if (c) this.floatText(c.x, c.y - 50, `Victory! +${(res.loot && res.loot.gold) || 0} gold`, '#7CFC7C');
      this.threatWarning('You won the battle!', 0x7cfc7c, true);
    } else {
      if (c && res.context && res.context.defending) c.takeDamage(100); // base took losses
      this.threatWarning(res.retreated ? 'Your army retreated.' : 'You lost the battle.', 0xff6b6b, true);
    }
    this.refreshPanel();
  }

  // ============================================ (Phase 2) ARMY COMBAT INTEGRATION

  // What hostile/conquerable thing sits under a clicked tile (for army orders)?
  armyTargetAt(col, row) {
    for (const a of this.armyMgr.aiArmies()) if (Math.abs(a.col - col) <= 2 && Math.abs(a.row - row) <= 2) return { kind: 'army', ref: a, col: Math.round(a.col), row: Math.round(a.row), faction: a.faction };
    if (this.settlements) for (const st of this.settlements.list) if (st.owner === 'neutral' && Math.abs(st.col - col) <= 2 && Math.abs(st.row - row) <= 2) return { kind: 'settlement', ref: st, col: st.col, row: st.row };
    for (const k of this.kingdoms || []) if (k.castleAlive && Math.abs(k.castleCol - col) <= 3 && Math.abs(k.castleRow - row) <= 3) return { kind: 'aicastle', ref: k, col: k.castleCol, row: k.castleRow, faction: k.cfg.key };
    return null;
  }

  // A player army reached its destination; resolve any attack target. An AI army
  // reaching the player castle attacks.
  onArmyArrive(army) {
    if (this._inBattle) return;
    if (this._loadGraceUntil && this.time.now < this._loadGraceUntil) return; // (BUG 5) settle after load
    // (BUG 3) An empty army never fights — it disbands on arrival.
    if (this.armyMgr.totalUnits(army) <= 0) { this.armyMgr.removeArmy(army); return; }
    if (army.faction === 'player') {
      const t = army.attackTarget; army.attackTarget = null;
      if (!t) return;
      if (t.kind === 'settlement' && t.ref.owner === 'neutral') this.resolveSettlementAttack(army, t.ref);
      else if (t.kind === 'aicastle' && t.ref.castleAlive) this.resolveAICastleAttack(army, t.ref);
      else if (t.kind === 'army' && this.armyMgr.armies.includes(t.ref) && this.armyMgr.totalUnits(t.ref) > 0) this.startArmyBattle(army, t.ref.units, { faction: t.ref.faction, enemyArmyRef: t.ref });
    } else {
      this.aiArmyAttacksPlayer(army);
    }
  }

  // Two opposing armies within 2 tiles → battle (interception in the wilderness).
  armiesOnInterceptCheck() {
    if (this._inBattle) return;
    if (this._loadGraceUntil && this.time.now < this._loadGraceUntil) return; // (BUG 5)
    const players = this.armyMgr.playerArmies();
    for (const ai of this.armyMgr.aiArmies()) {
      // 30-tile approach warning (once per AI army).
      const c = this.buildings.castle;
      if (c && !ai._warned && Phaser.Math.Distance.Between(ai.col, ai.row, c.col, c.row) <= 30) {
        ai._warned = true;
        this.threatWarning(`${ai.name} spotted! Approaching (~${this.armyMgr.etaDays(ai).toFixed(1)} days)`, 0xff8a80, true);
        this.logEvent(`${ai.name} is marching on your kingdom`, 'red');
      }
      if (this.armyMgr.totalUnits(ai) <= 0) { this.armyMgr.removeArmy(ai); continue; } // (BUG 3) skip empty AI armies
      for (const pa of players) {
        if (this.armyMgr.totalUnits(pa) <= 0) continue;
        if (Phaser.Math.Distance.Between(ai.col, ai.row, pa.col, pa.row) <= 2) {
          this.startArmyBattle(pa, ai.units, { faction: ai.faction, enemyArmyRef: ai });
          return;
        }
      }
    }
  }

  startArmyBattle(playerArmy, enemyUnits, ctx) {
    if (this._inBattle) return;
    if (this._loadGraceUntil && this.time.now < this._loadGraceUntil) return; // (BUG 5) no battle right after a load
    ctx = ctx || {};
    ctx.enemyCount = (enemyUnits || []).reduce((s, u) => s + (u.count || 0), 0); // (Phase 6) stats
    // (BUG 3) Never launch a battle with no enemy units.
    if (ctx.enemyCount <= 0) { if (ctx.enemyArmyRef && this.armyMgr.armies.includes(ctx.enemyArmyRef)) this.armyMgr.removeArmy(ctx.enemyArmyRef); return; }
    this._inBattle = true;
    try { SaveManager.save(this, 0); } catch (e) {}
    this._battleArmy = playerArmy;
    this._launchWithTransition('TO BATTLE', 'Marshalling the host…', 0xd06a4a, () => {
      this.scene.launch('BattleScene', {
        playerArmy: playerArmy.units.map((u) => ({ type: u.type, count: u.count, battles: u.battles || 0 })),
        enemyArmy: enemyUnits.map((u) => ({ type: u.type, count: u.count })),
        terrainType: this.battleTerrain(), enemyFaction: ctx.faction || 'red',
        commander: { name: this.rulerName, trait: this.kingTrait }, // (V2 P5) King/Queen leads in person
        weather: this._weather || 'clear', // (V2 P4 #4) carry the weather onto the battlefield
        context: ctx, playerDefending: !!ctx.defending,
        defenderWalls: !!(ctx && !ctx.defending && (ctx.kind === 'settlement' || ctx.kind === 'castle')), // (Phase 7)
        onComplete: (res) => this.onArmyBattleComplete(playerArmy, res, ctx),
      });
      this.scene.pause();
    });
  }

  onArmyBattleComplete(army, res, ctx) {
    this._inBattle = false; this.scene.resume();
    if (this.heroes) this.heroes.onBattle(army.id, !!(res && res.victory), (ctx && ctx.enemyCount) || 0); // (V2 Phase 3) hero XP
    const oldBattles = {}; for (const gg of army.units) oldBattles[gg.type] = gg.battles || 0; // (V2 P4) keep veterancy
    this.armyMgr.setUnitsFromBattle(army, res.army);
    for (const gg of army.units) gg.battles = (oldBattles[gg.type] || 0) + 1; // survived a battle → +1 veterancy
    if (res && res.victory) {
      this._lastBattleWonDay = this.gameDay;
      this._battlesWon = (this._battlesWon || 0) + 1; // (Audit FIX 2) battle tally
      if (this.stats) { this.stats.note('battlesWon'); this.stats.note('enemiesDefeated', (ctx && ctx.enemyCount) || 0); }
      this.armyMgr.addMorale(army, 15);
      if (res.loot) { this.resources.add('gold', res.loot.gold || 0); if (res.loot.iron) this.resources.add('iron', res.loot.iron); }
      if (this.reputation) this.reputation.add('conqueror', 10);
      if (ctx.kind === 'settlement' && ctx.ref) { for (const g of ctx.ref.guards) { g.alive = false; if (g.destroy) g.destroy(); } ctx.ref.guards = []; if (ctx.ref.owner === 'neutral') ctx.ref.conquer(); this.armyMgr.addMorale(army, 10); if (this.reputation) this.reputation.add('conqueror', 15); this.logEvent(`Conquered ${ctx.ref.name}`, 'green'); }
      if (ctx.kind === 'aicastle' && ctx.ref) { ctx.ref.regrouping = true; ctx.ref.rebuildTimer = 5 * this.DAY_SECONDS; this.logEvent(`Defeated ${ctx.ref.cfg.name}'s army`, 'green'); }
      if (ctx.enemyArmyRef && this.armyMgr.armies.includes(ctx.enemyArmyRef)) { this.armyMgr.removeArmy(ctx.enemyArmyRef); if (ctx.faction) { const k = this.kingdoms.find((x) => x.cfg.key === ctx.faction); if (k) { k.regrouping = true; k.rebuildTimer = 5 * this.DAY_SECONDS; } } }
      this.threatWarning('Your army was victorious!', 0x7cfc7c, true);
      if (this.leaders && ctx.faction) this.leaders.say(ctx.faction, 'defeated'); // (V2 P4 #2) beaten foe reacts
    } else {
      this._lastBattleLostDay = this.gameDay;
      this.armyMgr.addMorale(army, -25);
      const c = this.buildings.castle;
      if (c) this.armyMgr.marchTo(army, c.col + 2, c.row + 2, { returning: true });
      this.threatWarning('Your army was defeated.', 0xff6b6b, true);
      if (this.leaders && ctx.faction) this.leaders.say(ctx.faction, 'losing'); // (V2 P4 #2) victor taunts
    }
    if (this.armyMgr.totalUnits(army) === 0) this.armyMgr.disband(army);
    if (res && res.commanderDied) this.onCommanderFell(ctx); // (V2 P5)
    this.refreshPanel();
  }

  // (V2 Phase 5) The King/Queen was slain leading the host. Dramatic fallout
  // here; the succession crisis itself is handled by Phase 8 if present.
  onCommanderFell(_ctx) {
    this.logEvent(`${this.rulerName} has fallen in battle!`, 'red');
    this.threatWarning(`${this.rulerName} has fallen in battle!`, 0xe74c3c, true);
    if (this.succession && this.succession.onRulerDeath) this.succession.onRulerDeath('battle');
  }

  resolveSettlementAttack(army, st) {
    const garrison = st.guards.filter((g) => g.alive).length;
    if (garrison === 0) { if (st.owner === 'neutral') st.conquer(); this.armyMgr.addMorale(army, 10); if (this.reputation) this.reputation.add('conqueror', 15); this.logEvent(`Conquered ${st.name}`, 'green'); return; }
    this.startArmyBattle(army, [{ type: 'warrior', count: garrison }], { kind: 'settlement', ref: st, faction: 'neutral' });
  }

  resolveAICastleAttack(army, k) {
    if (this.diplomacy) this.diplomacy.declareWar(k.cfg.key);
    const n = Math.max(2, k.estimatedArmy());
    this.startArmyBattle(army, [{ type: 'warrior', count: n }], { kind: 'aicastle', ref: k, faction: k.cfg.key });
  }

  // (BUG 2) Turn around / dismiss a faction's marching armies (alliance/ceasefire).
  recallFactionArmies(key) {
    if (!this.armyMgr) return;
    const k = this.kingdoms.find((x) => x.cfg.key === key);
    for (const a of this.armyMgr.aiArmiesFor(key)) {
      a.attackTarget = null;
      if (k) this.armyMgr.marchTo(a, k.castleCol, k.castleRow, {});
      else this.armyMgr.removeArmy(a);
    }
  }

  // (Phase 2) AI launches a marching army from its castle toward the player.
  spawnAIArmyAttack(kingdom, unitCounts) {
    const a = this.armyMgr.spawnAIArmy(kingdom.cfg.key, kingdom.castleCol, kingdom.castleRow, unitCounts, `${kingdom.cfg.name} army`);
    if (a) { const c = this.buildings.castle; this.armyMgr.marchTo(a, c.col, c.row, { attackTarget: { kind: 'player' } }); }
    if (this.onKingdomAttack) this.onKingdomAttack(kingdom);
  }

  // AI army reached the player castle → defend with the home garrison (unassigned troops).
  hasWalls() { return (this.currentStage ? this.currentStage() : 0) >= 3; } // (Phase 4) auto-walls exist from Large Village

  aiArmyAttacksPlayer(aiArmy) {
    if (this._inBattle) return;
    if (this.armyMgr.totalUnits(aiArmy) <= 0) { this.armyMgr.removeArmy(aiArmy); return; } // (BUG 3) empty army can't attack
    // (Phase 4 Decision 1) Walls delay the first breach by 5s.
    if (this.hasWalls() && !aiArmy._breached) {
      aiArmy._breached = true;
      this.threatWarning(`${aiArmy.name} is breaching the walls...`, 0xffd24a, true);
      this.time.delayedCall(5000, () => { if (this.armyMgr.armies.includes(aiArmy)) this.aiArmyAttacksPlayer(aiArmy); });
      return;
    }
    const defenders = this.troops.snapshot();
    const defTotal = defenders.reduce((s, g) => s + g.count, 0);
    if (defTotal === 0) {
      // No defenders → castle takes the hit; AI army withdraws.
      const c = this.buildings.castle; if (c) c.takeDamage(120);
      this.threatWarning(`${aiArmy.name} raided your undefended castle!`, 0xff6b6b, true);
      this.armyMgr.removeArmy(aiArmy);
      return;
    }
    this._inBattle = true;
    try { SaveManager.save(this, 0); } catch (e) {}
    this.troops.removeAll();
    this._launchWithTransition('DEFEND THE REALM', 'To the walls!', 0xd06a4a, () => {
      this.scene.launch('BattleScene', {
        playerArmy: defenders, enemyArmy: aiArmy.units.map((u) => ({ type: u.type, count: u.count })),
        terrainType: this.battleTerrain(), enemyFaction: aiArmy.faction, context: { defending: true },
        playerDefending: true, taverMoraleBonus: this.hasTavern && this.hasTavern(),
        onComplete: (res) => {
          this.onBattleComplete(res); // restores player survivors to the troop pool
          if (res && res.victory) {
            if (this.armyMgr.armies.includes(aiArmy)) this.armyMgr.removeArmy(aiArmy);
            const k = this.kingdoms.find((x) => x.cfg.key === aiArmy.faction);
            if (k) { k.regrouping = true; k.rebuildTimer = 5 * this.DAY_SECONDS; }
            if (this.reputation) this.reputation.add('protector', 10);
            this.logEvent(`Repelled ${aiArmy.name}`, 'green');
          } else {
            // Survivors of the AI army retreat to their own castle.
            const kk = this.kingdoms.find((x) => x.cfg.key === aiArmy.faction);
            if (kk && this.armyMgr.armies.includes(aiArmy)) this.armyMgr.marchTo(aiArmy, kk.castleCol, kk.castleRow, {});
          }
        },
      });
      this.scene.pause();
    });
  }

  // Total estimated AI strength (used by the scouting intel reveal).
  armyEstimate() {
    return (this.kingdoms || []).reduce((s, k) => s + (k.castleAlive ? k.estimatedArmy() : 0), 0);
  }

  // (UI overhaul Phase 5) Persistent tabs on the top edge of the bottom panel
  // replace the old top-right openers: [Build][Expeditions][Kingdoms][Caravans].
  // (Phase 3) K&C-style slim category bar at the very bottom. Icon + label
  // buttons; clicking opens that category's panel above the bar, clicking the
  // active one again closes it. Only one panel open at a time.
  createKingdomsButton() {
    const fix = (o) => o.setScrollFactor(0);
    // [label, mode, icon-draw]
    this.catDefs = [
      ['Castle', 'cat_castle', 'castle'], ['Food', 'cat_food', 'food'], ['Industry', 'cat_industry', 'industry'],
      ['Military', 'cat_military', 'military'], ['Research', 'research', 'research'], ['Armies', 'armies', 'armies'], ['Map', 'map', 'map'],
    ];
    this.panelTabs = [];
    const bx0 = 8, by = this.PANEL_Y - 30, h = 28, w = 92, gap = 3;
    // (Visual P6) A heavy wooden plank runs behind the category plaques, studded
    // with iron nail-heads at each seam. Faction accent colour tints the rivets.
    const accent = (this.factionColor && this.factionColor()) || 0xc9a14a;
    const plankW = this.catDefs.length * (w + gap) + 8;
    const plank = fix(this.add.graphics().setDepth(39));
    plank.fillStyle(0x000000, 0.45).fillRect(bx0 - 4, by - 4, plankW, h + 8);
    // plank face with grain
    plank.fillStyle(0x3a2817, 1).fillRect(bx0 - 4, by - 4, plankW, h + 8);
    plank.fillStyle(0x4a3520, 1).fillRect(bx0 - 4, by - 4, plankW, 3); // lit top
    plank.fillStyle(0x271a0e, 1).fillRect(bx0 - 4, by + h + 1, plankW, 3); // dark bottom
    plank.lineStyle(1, 0x271a0e, 0.45);
    for (let gy = by - 1; gy < by + h + 2; gy += 4) { plank.beginPath(); plank.moveTo(bx0 - 4, gy); plank.lineTo(bx0 - 4 + plankW, gy); plank.strokePath(); }
    // iron nail-heads at each plaque seam
    this.catDefs.forEach((_t, i) => {
      const nx = bx0 + i * (w + gap) - 2;
      plank.fillStyle(0x53595f, 1).fillCircle(nx, by - 1, 2.2);
      plank.fillStyle(0x80868c, 0.9).fillCircle(nx - 0.6, by - 1.6, 0.9);
      plank.fillStyle(0x53595f, 1).fillCircle(nx, by + h - 1, 2.2);
      plank.fillStyle(0x80868c, 0.9).fillCircle(nx - 0.6, by + h - 1.6, 0.9);
    });
    const lastX = bx0 + this.catDefs.length * (w + gap) - 2;
    plank.fillStyle(0x53595f, 1).fillCircle(lastX, by - 1, 2.2).fillCircle(lastX, by + h - 1, 2.2);
    this.catDefs.forEach((t, i) => {
      const x = bx0 + i * (w + gap);
      // Raised wooden plaque shadow behind each tab.
      const plaque = fix(this.add.graphics().setDepth(39.5));
      plaque.fillStyle(0x000000, 0.4).fillRoundedRect(x + 1, by + 2, w, h, 4);
      const bg = fix(this.add.rectangle(x, by, w, h, 0x6a4a2a, 0.96).setOrigin(0, 0).setDepth(40).setStrokeStyle(2, accent, 0.55).setInteractive({ useHandCursor: true }));
      const txt = fix(this.add.text(x + w / 2, by + h / 2, t[0], { fontFamily: 'monospace', fontSize: '12px', color: '#f3e4c0', fontStyle: 'bold', stroke: '#1a120a', strokeThickness: 2 }).setOrigin(0.5).setDepth(41));
      bg.on('pointerover', () => { if (this.panelMode !== t[1]) bg.setFillStyle(0x87623a, 0.98); });
      bg.on('pointerout', () => this.highlightTabs());
      bg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.onTabClick(t[1]); });
      this.panelTabs.push({ mode: t[1], bg, txt });
    });
    this.highlightTabs();
  }

  // (Visual P6) Faction accent colour for HUD/frame trim. Falls back to gold.
  factionColor() {
    try {
      const c = this.kingTrait && TRAITS[this.kingTrait] ? TRAITS[this.kingTrait].color : null;
      return (typeof c === 'number') ? c : 0xc9a14a;
    } catch (e) { return 0xc9a14a; }
  }

  tabActive(mode) {
    if (mode === 'cat_military') return ['cat_military', 'expedition', 'artifacts', 'ruins'].includes(this.panelMode);
    if (mode === 'armies') return ['armies', 'armyform', 'kingdoms', 'caravans'].includes(this.panelMode);
    if (mode === 'cat_castle') return ['cat_castle', 'cat_invest', 'cat_monuments'].includes(this.panelMode); // (Phase 11)
    return this.panelMode === mode && !this.selectedBuilding;
  }

  highlightTabs() {
    if (!this.panelTabs) return;
    const researchOk = this.research && this.research.hasLibrary();
    const accent = this.factionColor();
    for (const t of this.panelTabs) {
      const on = this.tabActive(t.mode) && !this.selectedBuilding;
      const dim = (t.mode === 'research' && !researchOk);
      // Active = pressed/darker carved plaque (faction accent border lit).
      // Inactive = raised wood. Disabled (research) = greyed wood.
      t.bg.setFillStyle(on ? 0x3a2817 : dim ? 0x4a3e30 : 0x6a4a2a, on ? 1 : 0.96);
      t.txt.setColor(on ? '#ffe9b0' : dim ? '#8a7f6a' : '#f3e4c0');
      t.bg.setStrokeStyle(2, on ? accent : 0x2a1d10, on ? 1 : 0.7);
    }
  }

  // (Phase 3) Category click — toggles its panel; "Map" now LEAVES the settlement
  // back to the continent (the continent is a separate scene we slept on entry).
  onTabClick(mode) {
    sfx.play('ui_click');
    if (mode === 'map') { this.confirmLeave(); return; }
    this.selectedBuilding = null; this.clearSelection(); this.placementType = null; this.clearGhost(); this.hideTip();
    if (mode === 'research' && !(this.research && this.research.hasLibrary())) { this.showToast('Build a Library (Industry) to research'); return; }
    // Toggle closed if the same category is already open.
    this.panelMode = (this.panelMode === mode) ? 'none' : mode;
    this.refreshPanel();
  }

  // ---- (Phase 5) Hover tooltip shared by the build palette + expeditions -----
  showTip(cx, topY, title, body) {
    this.hideTip();
    const W = 250;
    const bodyText = this.add.text(0, 0, body || '', { fontFamily: 'monospace', fontSize: '11px', color: '#e8e0cc', wordWrap: { width: W - 20 }, lineSpacing: 2 }).setScrollFactor(0).setDepth(81);
    const H = 26 + bodyText.height + 8;
    const px = Phaser.Math.Clamp(cx - W / 2, 6, GAME_W - W - 6);
    const py = topY - H - 8;
    const bg = this.add.rectangle(px, py, W, H, 0x16120a, 0.98).setOrigin(0, 0).setScrollFactor(0).setStrokeStyle(2, 0xc9a14a, 0.9).setDepth(80);
    const tt = this.add.text(px + 10, py + 7, title, { fontFamily: 'monospace', fontSize: '13px', color: '#ffe9b0', fontStyle: 'bold' }).setScrollFactor(0).setDepth(81);
    bodyText.setPosition(px + 10, py + 26);
    this._tip = [bg, tt, bodyText];
  }

  hideTip() { if (this._tip) { this._tip.forEach((o) => o.destroy()); this._tip = null; } }

  // (UI overhaul Phase 4) Status label -> colour.
  diploColor(s) {
    if (s.includes('Allied')) return '#7CFC7C';
    if (s.includes('Non-aggression') || s.includes('Pact')) return '#9ad0ff';
    if (s.includes('Friendly')) return '#a6e22e';
    if (s.includes('Cautious')) return '#e6c84a';
    if (s.includes('Neutral')) return '#cfc1a6';
    if (s.includes('Coordinated')) return '#ff4d4d';
    return '#ff8a5a'; // Hostile
  }

  // (Bug 7) A high-contrast diplomacy button: white bold label on a dark colour,
  // 32px tall, with the effect on a second line. Far more readable than the
  // generic blue panel button it replaces.
  diploButton(x, y, w, h, label, sub, bgHex, hoverHex, enabled, onClick) {
    const fill = enabled ? bgHex : 0x3a3a40;
    const bg = this.add.rectangle(x, y, w, h, fill).setOrigin(0, 0).setScrollFactor(0).setStrokeStyle(2, enabled ? 0xf0e6c8 : 0x666666, enabled ? 0.85 : 0.4);
    this.panel.add(bg);
    this.panel.add(this.add.text(x + w / 2, y + (sub ? h / 2 - 8 : h / 2), label, { fontFamily: 'monospace', fontSize: '13px', color: enabled ? '#ffffff' : '#9aa0a6', fontStyle: 'bold' }).setOrigin(0.5).setScrollFactor(0));
    if (sub) this.panel.add(this.add.text(x + w / 2, y + h / 2 + 9, sub, { fontFamily: 'monospace', fontSize: '10px', color: enabled ? '#eaf2ff' : '#7d8389', fontStyle: 'bold' }).setOrigin(0.5).setScrollFactor(0));
    if (enabled && onClick) {
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => bg.setFillStyle(hoverHex));
      bg.on('pointerout', () => bg.setFillStyle(fill));
      bg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); sfx.play('button_click'); this.time.delayedCall(0, onClick); });
    }
    return bg;
  }

  renderKingdomsPanel() {
    // (Visual P6) A diplomatic treaty on aged parchment, sealed with wax.
    this.panel.add(this.leatherPanel(4, this.PANEL_Y + 4, GAME_W - 8, PANEL_H - 8, { radius: 5, seed: this.PANEL_Y + 9 }));
    this.panel.add(this.woodFrame(4, this.PANEL_Y + 4, GAME_W - 8, PANEL_H - 8, { thickness: 7 }));
    // Wax seal in the bottom-right corner of the treaty.
    this.panel.add(this.waxSeal(GAME_W - 34, this.PANEL_Y + PANEL_H - 30, 16, 0x8c2f24));
    const scouted = this.intelActive();
    this.panelText(14, this.PANEL_Y + 6, `AI KINGDOMS — DIPLOMACY${scouted ? '   (scouted)' : ''}`, { bold: true, color: '#ffe9b0' });
    // (Pre-loop audit) Conquest-victory progress so the win path is legible.
    if (this.winConditions) {
      const have = this.winConditions.playerControlled(), total = this.winConditions.totalSettlements();
      const need = Math.ceil(total * 0.75);
      this.panelText(196, this.PANEL_Y + 6, `Conquest: ${have}/${total} (need ${need} to win)`, { color: have >= need ? '#7cfc7c' : '#cfc1a6', size: '11px' });
    }
    // (Session-1 Phase 5) Tax slider — 4 segments, current highlighted.
    this.panelText(486, this.PANEL_Y + 6, 'Tax:', { color: '#cfc1a6', size: '11px' });
    this.taxLevels().forEach((t, i) => {
      const bx = 516 + i * 76, on = (this.taxIndex || 1) === i;
      const b = this.add.rectangle(bx, this.PANEL_Y + 4, 72, 16, on ? 0x6c5a1a : 0x2a2030, 0.95).setOrigin(0, 0).setScrollFactor(0).setStrokeStyle(1, on ? 0xffe23f : 0x55473a, on ? 1 : 0.6).setInteractive({ useHandCursor: true });
      this.panel.add(b);
      this.panel.add(this.add.text(bx + 36, this.PANEL_Y + 12, t.name.length > 8 ? 'Extort.' : t.name, { fontFamily: 'monospace', fontSize: '9px', color: on ? '#fff' : '#aeb9c6', fontStyle: 'bold' }).setOrigin(0.5).setScrollFactor(0));
      b.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.setTax(i); });
    });
    // (Completion Phase 4) Call the Great Council when +60 with 2+ kingdoms.
    if (this.greatCouncil && this.greatCouncil.canCall()) {
      this.introCard('council', 'Great Council', 'You can now unite friendly kingdoms under your leadership. Call the council for powerful continent-wide decrees.');
      const cx = 834, cw = 200;
      const cb = this.add.rectangle(cx, this.PANEL_Y + 4, cw, 16, 0x6a4aa0, 0.98).setOrigin(0, 0).setScrollFactor(0).setStrokeStyle(1, 0xffe23f, 0.95).setInteractive({ useHandCursor: true });
      this.panel.add(cb);
      this.panel.add(this.add.text(cx + cw / 2, this.PANEL_Y + 12, '★ Call Great Council (300g)', { fontFamily: 'monospace', fontSize: '10px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setScrollFactor(0));
      cb.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.greatCouncil.call(); });
    }
    // (Audit FIX 5) Reputation moved out of the header into a collapsible section
    // so the bars no longer overlap the first kingdom row. Collapsed by default;
    // when expanded it floats in a clean box above the panel.
    if (this.reputation) {
      const tx = 300, ty = this.PANEL_Y + 5;
      const tog = this.add.rectangle(tx, ty, 172, 16, 0x2a2030, 0.95).setOrigin(0, 0).setScrollFactor(0).setStrokeStyle(1, 0xc9a14a, 0.6).setInteractive({ useHandCursor: true });
      this.panel.add(tog);
      this.panel.add(this.add.text(tx + 8, ty + 2, `${this._repExpanded ? '▾' : '▸'} Your Reputation`, { fontFamily: 'monospace', fontSize: '11px', color: '#ffe9b0', fontStyle: 'bold' }).setScrollFactor(0));
      tog.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this._repExpanded = !this._repExpanded; this.refreshPanel(); });
      if (this._repExpanded) {
        const reps: any[] = [['Conqueror', 'conqueror', 0xc0392b], ['Merchant', 'merchant', 0xf1c40f], ['Protector', 'protector', 0x3498db], ['Destroyer', 'destroyer', 0x8e44ad]];
        const bw = 308, bh = 86, bx = GAME_W - bw - 12, by = this.PANEL_Y - bh - 8;
        this.panel.add(this.add.rectangle(bx, by, bw, bh, 0x12101a, 0.98).setOrigin(0, 0).setScrollFactor(0).setStrokeStyle(2, 0xc9a14a, 0.9));
        this.panel.add(this.add.text(bx + 10, by + 6, 'YOUR REPUTATION', { fontFamily: 'monospace', fontSize: '12px', color: '#ffe9b0', fontStyle: 'bold' }).setScrollFactor(0));
        reps.forEach(([lbl, key, col], i) => {
          const rx = bx + 12 + (i % 2) * 150, ry = by + 28 + Math.floor(i / 2) * 27;
          this.panel.add(this.add.text(rx, ry, lbl, { fontFamily: 'monospace', fontSize: '10px', color: '#cfc1a6' }).setScrollFactor(0));
          this.panel.add(this.add.rectangle(rx, ry + 13, 132, 7, 0x000000, 0.5).setOrigin(0, 0).setScrollFactor(0));
          this.panel.add(this.add.rectangle(rx, ry + 13, 132 * Phaser.Math.Clamp(this.reputation.scores[key] / 100, 0, 1), 7, col).setOrigin(0, 0).setScrollFactor(0));
        });
      }
    }
    const base = this.PANEL_Y + 24, rowH = 34;
    this.kingdoms.forEach((k, idx) => {
      const key = k.cfg.key;
      const y = base + idx * rowH;
      // Identity — leader portrait + kingdom name (V2 P1). Leader name + army
      // strength share line 2 (set just below, replacing the old army line).
      const pk = this.leaders ? this.leaders.portraitKey(key) : null;
      if (pk && this.textures.exists(pk)) this.panel.add(this.add.image(16, y + 2, pk).setOrigin(0, 0).setDisplaySize(30, 30).setScrollFactor(0));
      else this.panel.add(this.add.rectangle(16, y + 8, 16, 16, k.cfg.color).setOrigin(0, 0).setStrokeStyle(1, 0x000000, 0.6).setScrollFactor(0));
      this.panelText(50, y + 1, k.cfg.name, { bold: true, color: '#ffffff', size: '15px' });
      const n = k.estimatedArmy();
      const spied = k._spyUntil && (this.gameDay || 0) < k._spyUntil; // (Completion Phase 8)
      const army = k.castleAlive ? `${scouted || spied ? '' : '~'}${n} ${n === 1 ? 'Warrior' : 'Warriors'}` : 'defeated';
      const leaderNm = this.leaders ? this.leaders.name(key) : '';
      this.panelText(50, y + 19, `${leaderNm}${leaderNm ? ' · ' : ''}${army}`, { color: spied ? '#9af0a0' : '#b9c6d6', size: '10px' }); // (V2 P1) leader + strength
      // Status label — 14px bold, coloured (Bug 7).
      const rel = this.diplomacy ? this.diplomacy.get(key) : 0;
      const relStatus = this.diplomacy ? this.diplomacy.status(key) : 'Neutral';
      this.panelText(196, y + 9, relStatus, { color: this.diploColor(relStatus), size: '14px', bold: true });
      // Relationship bar: centre tick at neutral, red (hostile) / green (friendly).
      // (Visual P6) Carved temperature-gauge track recessed into the parchment.
      const bx = 330, bw = 150, cx = bx + bw / 2, barY = y + 20;
      this.panel.add(this.add.rectangle(bx - 1, barY - 1, bw + 2, 13, 0x1a120a, 0.9).setOrigin(0, 0).setScrollFactor(0).setStrokeStyle(1, 0x6b5a3c, 0.8));
      this.panel.add(this.add.rectangle(bx, barY, bw, 11, 0x000000, 0.55).setOrigin(0, 0).setScrollFactor(0));
      this.panel.add(this.add.rectangle(bx, barY, bw / 2, 11, 0x3a1418, 0.7).setOrigin(0, 0).setScrollFactor(0));
      this.panel.add(this.add.rectangle(cx, barY, bw / 2, 11, 0x123a1a, 0.7).setOrigin(0, 0).setScrollFactor(0));
      if (rel >= 0) this.panel.add(this.add.rectangle(cx, barY, (bw / 2) * (rel / 100), 11, 0x4ad66b).setOrigin(0, 0).setScrollFactor(0));
      else this.panel.add(this.add.rectangle(cx, barY, (bw / 2) * (-rel / 100), 11, 0xd64a4a).setOrigin(1, 0).setScrollFactor(0));
      this.panel.add(this.add.rectangle(cx, barY - 3, 2, 17, 0xffffff, 0.9).setOrigin(0.5, 0).setScrollFactor(0));
      this.panelText(cx, y + 4, `${rel > 0 ? '+' : ''}${rel}`, { color: rel < 0 ? '#ff9a8a' : rel > 0 ? '#9af0a0' : '#dcd2bf', size: '11px', bold: true }).setOrigin(0.5, 0).setScrollFactor(0);
      // (Phase 6) Active-treaty badges under the status label.
      const tr = this.diplomacy ? this.diplomacy.tr(key) : {};
      const badges = [];
      if (tr.trade) badges.push(['Trade', 0xf1c40f]);
      if (tr.alliance) badges.push(['Ally', 0x4ad66b]);
      if (tr.vassal) badges.push(['Vassal', 0x9b59b6]);
      badges.forEach(([lbl, col], bi) => {
        const bxx = 196 + bi * 56;
        this.panel.add(this.add.rectangle(bxx, y + 25, 52, 12, col, 0.85).setOrigin(0, 0).setStrokeStyle(1, 0x000000, 0.5).setScrollFactor(0));
        this.panel.add(this.add.text(bxx + 26, y + 25, lbl, { fontFamily: 'monospace', fontSize: '9px', color: '#1a1a1a', fontStyle: 'bold' }).setOrigin(0.5, 0).setScrollFactor(0));
      });
      // Action buttons — three slots, 116px wide each (Phase 6 treaties).
      const hasTreaty = tr.trade || tr.alliance || tr.vassal;
      const canTribute = this.diplomacy && this.resources.gold >= 50;
      this.diploButton(458, y + 1, 116, 32, 'Tribute', '50g → +20', 0x1a5c2a, 0x278a3f, !!canTribute, () => this.diplomacy.sendTribute(key));
      // Slot 2 — best available treaty upgrade.
      const rep = this.reputation ? this.reputation.scores.conqueror : 0;
      if (tr.alliance) {
        this.diploButton(580, y + 1, 116, 32, 'Allied', 'at war = aid', 0x1a2e5c, 0x1a2e5c, false, null);
      } else if (rel >= 60) {
        this.diploButton(580, y + 1, 116, 32, 'Alliance', '200g → ally', 0x1a3a6c, 0x274488, this.resources.gold >= 200, () => this.diplomacy.proposeAlliance(key));
      } else if (rel >= 30 && !tr.trade) {
        this.diploButton(580, y + 1, 116, 32, 'Trade', '→ +20g/day', 0x6c5a1a, 0x8a7522, true, () => this.diplomacy.proposeTrade(key));
      } else if (rep >= 50 && rel >= -20 && rel <= 20 && !tr.vassal) {
        this.diploButton(580, y + 1, 116, 32, 'Vassalize', 'Conqueror 50+', 0x4a2a6c, 0x6a3a9c, true, () => this.diplomacy.demandVassal(key));
      } else if (tr.trade) {
        this.diploButton(580, y + 1, 116, 32, 'Trading', '+20g/day', 0x4a3f1a, 0x4a3f1a, false, null);
      } else {
        this.diploButton(580, y + 1, 116, 32, '—', 'no treaty', 0x33333a, 0x33333a, false, null);
      }
      // Slot 3 — context: ceasefire if at war, break alliance if allied, else break treaty / declare war.
      if (this.diplomacy.atWar(key)) {
        this.diploButton(702, y + 1, 116, 32, 'Ceasefire', '100g → end war', 0x1a4a5c, 0x2a6a8a, this.resources.gold >= 100, () => this.diplomacy.offerCeasefire(key)); // (BUG 10)
      } else if (tr.alliance) {
        this.diploButton(702, y + 1, 116, 32, 'Break Ally', '→ -20 rel', 0x5c4a1a, 0x8a722a, true, () => this.diplomacy.breakAlliance(key)); // (BUG 2)
      } else if (hasTreaty) {
        this.diploButton(702, y + 1, 116, 32, 'Break', '→ -10 rel', 0x5c4a1a, 0x8a722a, true, () => this.diplomacy.breakTreaty(key));
      } else {
        this.diploButton(702, y + 1, 116, 32, 'War', '→ -100 rel', 0x5c1a1a, 0x8a2a2a, !!this.diplomacy, () => this.diplomacy.declareWar(key));
      }
      // (Completion Phase 8) Espionage — 75g buys 5 days of detailed intel.
      if (spied) {
        this.panelText(826, y + 2, `INTEL (${Math.max(0, Math.ceil(k._spyUntil - (this.gameDay || 0)))}d)`, { color: '#9af0a0', size: '10px', bold: true });
        this.panelText(826, y + 16, `~${Math.round((k.barracksCount || 1) * 120 + 200)}g · ${k.regrouping ? 'regrouping' : 'mustering'}`, { color: '#cfc1a6', size: '10px' });
      } else if (this.succession && this.succession.marriedTo === key) {
        this.panelText(826, y + 9, '♥ United Crowns', { color: '#ff9ad6', size: '12px', bold: true }); // (V2 P8)
      } else if (this.succession && this.succession.canMarry(key) && !this.succession.marriedTo) {
        this.diploButton(826, y + 1, 96, 32, 'Marry', '500g · alliance', 0x6c2a5a, 0x9c3a8a, this.resources.gold >= 500, () => { this.succession.arrangeMarriage(key); this.refreshPanel(); }); // (V2 P8)
      } else {
        this.diploButton(826, y + 1, 96, 32, 'Spy', '75g · 5d', 0x2a4a5c, 0x3a6a7c, this.resources.gold >= 75, () => this.spyOn(key));
      }
    });
    this.spriteButton(GAME_W - 84, this.PANEL_Y + 4, 76, 20, 'Back', '', true, () => { this.panelMode = 'armies'; this.refreshPanel(); });
    // (Completion Phase 8) Distribute Wealth — +30 happiness (once per 10 days).
    const tribReady = (this.gameDay || 0) - (this._lastTributeDay ?? -99) >= 10;
    this.spriteButton(GAME_W - 250, this.PANEL_Y + PANEL_H - 26, 160, 22, tribReady ? 'Distribute Wealth' : 'Wealth (cooldown)', '150g → +30 happy', tribReady && this.resources.gold >= 150, () => this.distributeWealth(), { gold: tribReady });
  }

  // Right-click attacks the nearest enemy castle (any faction), else move/gather.
  issueMoveCommand(wx, wy) {
    let target = null, td = Infinity;
    for (const k of this.kingdoms) {
      if (!k.castleAlive) continue;
      const d = Phaser.Math.Distance.Between(wx, wy, k.castleX, k.castleY);
      if (d < td) { td = d; target = k; }
    }
    if (target && td < this.TILE * 1.4) {
      // (Phase 4 Decision 2) Unassigned units are DEFENDERS — they cannot march
      // out to attack. Offensive action requires forming an Army.
      this.floatText(target.castleX, target.castleY - 30, 'Form an army to attack', '#ffd24a');
      this.showToast('Unassigned units defend the castle — form an Army (bottom bar) to attack');
      return;
    }
    let node = null, nd = Infinity;
    for (const n of this.nodes.nodes) {
      if (!n.alive) continue;
      const d = Phaser.Math.Distance.Between(wx, wy, n.x, n.y);
      if (d < this.TILE && d < nd) { nd = d; node = n; }
    }
    const tx = node ? node.x : wx;
    const ty = node ? node.y : wy;
    this.commandUnits(tx, ty, false, null);
    this.floatText(tx, ty, 'Move', '#aee9ff');
  }

  // Spread units around the target; carry the target castle for attack orders.
  commandUnits(tx: any, ty: any, attackAI?: any, castle?: any) {
    const n = this.selectedUnits.length;
    if (n > 0) sfx.play('unit_command'); // (Polish Phase 2)
    this.selectedUnits.forEach((u, i) => {
      let ox = 0, oy = 0;
      if (n > 1) {
        const ang = (i / n) * Math.PI * 2;
        const r = 12 + Math.floor(i / 8) * 18;
        ox = Math.cos(ang) * r;
        oy = Math.sin(ang) * r;
      }
      u.cmd = { x: tx + ox, y: ty + oy, attackAI, castle };
      u.playerCommanded = true; // (Bug 4/8) ignore the home leash + hold at the destination
    });
  }

  // (BUG 9) Explicitly recall units to the castle — the only player action that
  // clears the hold so they resume auto-defense around home.
  returnUnitsToCastle(units) {
    const list = units || (this.troops ? this.troops.allUnits() : []);
    for (const u of list) { u.playerCommanded = false; u.cmd = null; u.target = null; }
    this.showToast && this.showToast('Units returning to castle');
  }

  // (BUG 7) Opaque fog overlay drawn ABOVE all world objects (depth 99998, just
  // under the HUD's uiCamera). Unexplored tiles show nothing behind them. Bounded
  // to the camera viewport and only redrawn when the view or fog changes.
  createFogOverlay() {
    this.fogG = this.add.graphics().setDepth(99998); // world space (main camera)
    this._fogKey = null; this._fogDirty = true;
  }
  updateFogOverlay() {
    if (!this.territory || !this.fogG) return;
    const cam = this.cameras.main;
    const key = `${Math.round(cam.scrollX)},${Math.round(cam.scrollY)},${cam.zoom.toFixed(2)}`;
    if (key === this._fogKey && !this._fogDirty) return;
    this._fogKey = key; this._fogDirty = false;
    const g = this.fogG; g.clear();
    const view = cam.worldView;
    const corners = [this.screenToTile(view.x, view.y), this.screenToTile(view.right, view.y), this.screenToTile(view.x, view.bottom), this.screenToTile(view.right, view.bottom)];
    let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity;
    for (const t of corners) { c0 = Math.min(c0, t.col); c1 = Math.max(c1, t.col); r0 = Math.min(r0, t.row); r1 = Math.max(r1, t.row); }
    c0 = Math.max(0, c0 - 3); r0 = Math.max(0, r0 - 3); c1 = Math.min(N - 1, c1 + 3); r1 = Math.min(N - 1, r1 + 3);
    const expl = this.territory.explored;
    g.fillStyle(0x05070d, 1); // fully opaque fog
    const w = HW + 1, h = HH + 1; // slight inflate to avoid hairline seams
    for (let r = r0; r <= r1; r++) {
      const row = expl[r]; if (!row) continue;
      for (let c = c0; c <= c1; c++) {
        if (row[c]) continue;
        const cx = (c - r) * HW + OX + HW, cy = (c + r) * HH + OY + HH;
        g.beginPath(); g.moveTo(cx, cy - h); g.lineTo(cx + w, cy); g.lineTo(cx, cy + h); g.lineTo(cx - w, cy); g.closePath(); g.fillPath();
      }
    }
  }

  // ---- Day / night cycle + day counter (new) -------------------------------

  createDayNightOverlay() {
    // (Visual P5) Layered atmospheric sky. The whole screen-fixed stack renders
    // on the UI camera (above the world), so the sky reads as a dramatic gradient
    // band across the top "headroom" that fades to a translucent wash over the
    // world below — giving a true horizon without hiding the terrain.
    // --- Sky gradient band (behind the day/night tint) ---
    // Confined to the upper "headroom" so it reads as sky above the horizon and
    // fades fully to transparent before the play field (no hard seam, no wash).
    this._skyHorizon = Math.round(GAME_H * 0.30); // where the painted sky fades to 0
    this.skyGradG = this.add.graphics().setScrollFactor(0).setDepth(31);
    this._skyPhaseBucket = -1; // redraw the gradient only when the phase bucket changes
    this._skySeasonKey = '';
    // --- Global day/night colour tint (above the world, below the HUD) ---
    this.dnOverlay = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x0a1430, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(35);
    // (Phase 8) Subtle seasonal cast over the world (below the night overlay).
    this.seasonOverlay = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(34);
    // (Polish Phase 3 / Visual P5) Sky bodies — stars, sun, moon, clouds, god-rays.
    this._stars = [];
    // (Visual P5) ~56 twinkling stars of varied size, kept within the sky band.
    for (let i = 0; i < 56; i++) this._stars.push({ x: Phaser.Math.Between(12, GAME_W - 12), y: Phaser.Math.Between(34, Math.round(GAME_H * 0.27)), r: Phaser.Math.FloatBetween(0.7, 2.6), ph: Math.random() * 6.28, sp: Phaser.Math.FloatBetween(0.0025, 0.006) });
    // (Visual P5) Subtle nebula wisps for the deep-night sky.
    this._nebula = [];
    for (let i = 0; i < 3; i++) this._nebula.push({ x: Phaser.Math.Between(120, GAME_W - 120), y: Phaser.Math.Between(50, Math.round(GAME_H * 0.22)), r: Phaser.Math.Between(110, 180), col: [0x3a4a8a, 0x5a3a7a, 0x2a5a7a][i % 3] });
    // (Visual P5) A few slow-drifting cumulus clouds for the daytime sky.
    this._clouds = [];
    for (let i = 0; i < 4; i++) this._clouds.push({ x: Phaser.Math.Between(0, GAME_W), y: Phaser.Math.Between(46, Math.round(GAME_H * 0.18)), s: Phaser.Math.FloatBetween(0.7, 1.4), v: Phaser.Math.FloatBetween(3, 8) });
    this.skyG = this.add.graphics().setScrollFactor(0).setDepth(36);
    this.createAmbientParticles(); // (Visual P5) subtle always-on ambient life
    this.createNightGlow(); // (Polish Phase 10) warm window-light glow at night
    this.updateSeason();
  }

  // (Polish Phase 10) Night settlement warmth: a soft additive amber glow that
  // pools around each building once dusk falls, as if windows and hearths are lit.
  // Purely cosmetic — it reads `this._nightness` and the existing building list; it
  // never touches placement, grid, or building logic. World-space (pans with the
  // camera), depth 4.5 so it sits just under the building sprite (depth 5) and over
  // the shadow (depth 4). Glow images are pooled and only rebuilt when the building
  // count changes, and alpha is only rewritten when night-ness shifts noticeably.
  createNightGlow() {
    if (!this.textures.exists('night_glow')) {
      const tex = this.textures.createCanvas('night_glow', 96, 96);
      const ctx = tex.getContext();
      const grad = ctx.createRadialGradient(48, 48, 4, 48, 48, 48);
      grad.addColorStop(0, 'rgba(255,196,110,0.85)');
      grad.addColorStop(0.45, 'rgba(255,168,72,0.4)');
      grad.addColorStop(1, 'rgba(255,150,50,0)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, 96, 96); tex.refresh();
    }
    this._nightGlowLayer = this.add.container(0, 0).setDepth(4.5).setAlpha(0);
    this._nightGlowLayer.setBlendMode(Phaser.BlendModes.ADD as any);
    this._nightGlowPool = [];
    this._nightGlowCount = -1;
    this._nightGlowAlpha = -1;
  }

  updateNightGlow(night: number) {
    const layer = this._nightGlowLayer; if (!layer) return;
    // Fully off in daylight — skip all work (the common case).
    if (night <= 0.02) { if (this._nightGlowAlpha !== 0) { layer.setAlpha(0); this._nightGlowAlpha = 0; } return; }
    const alive = (this.buildings && this.buildings.buildings ? this.buildings.buildings : []).filter((b: any) => b && b.alive);
    // Rebuild the glow images only when the alive-building count actually changes.
    if (alive.length !== this._nightGlowCount) {
      this._nightGlowCount = alive.length;
      const pool = this._nightGlowPool;
      while (pool.length < alive.length) {
        const im = this.add.image(0, 0, 'night_glow').setBlendMode(Phaser.BlendModes.ADD as any);
        layer.add(im); pool.push(im);
      }
      for (let i = 0; i < pool.length; i++) {
        const im = pool[i]; const b = alive[i];
        if (b) {
          const scale = b.typeKey === 'castle' ? 1.9 : 1.0;
          im.setVisible(true).setPosition(b.x, b.y + 6).setScale(scale);
        } else { im.setVisible(false); }
      }
    } else {
      // Same count, keep positions fresh (cheap; buildings rarely move but castle
      // can rescale on tier-up). Only sync if we actually have glows.
      const pool = this._nightGlowPool;
      for (let i = 0; i < alive.length && i < pool.length; i++) { pool[i].setPosition(alive[i].x, alive[i].y + 6); }
    }
    // Modulate the whole layer's alpha with night-ness; only rewrite on change.
    const a = Math.round(night * 0.55 * 100) / 100;
    if (a !== this._nightGlowAlpha) { layer.setAlpha(a); this._nightGlowAlpha = a; }
  }

  // (Polish Phase 3) Smooth atmosphere colour + darkness across the full day:
  // dawn (warm) → day (clear) → dusk (orange-purple) → night (deep navy).
  atmosphereAt(phase) {
    // (Visual P5) Global lighting tint keyframes, tuned to Northgard-style targets:
    // dawn warm orange ~rgba(255,150,50,.18) · day none · dusk warm orange
    // ~rgba(255,100,30,.28) · night deep blue ~rgba(10,20,60,.5). Smoothly blended.
    const KF = [
      [0.00, 0xff9632, 0.18], // dawn — warm orange (255,150,50)
      [0.06, 0xffb060, 0.12], // sunrise glow
      [0.12, 0xfff2d8, 0.00], // morning — clear
      [0.56, 0xfff2d8, 0.00], // day — clear
      [0.68, 0xffa64a, 0.13], // late afternoon — warming
      [0.78, 0xff641e, 0.28], // dusk — warm orange (255,100,30)
      [0.85, 0x3a2456, 0.46], // dusk-purple transition
      [0.90, 0x081030, 0.60], // night onset — deep blue, distinctly dark
      [1.00, 0x060c26, 0.64], // deep night
    ];
    let a = KF[0], b = KF[KF.length - 1];
    for (let i = 0; i < KF.length - 1; i++) { if (phase >= KF[i][0] && phase <= KF[i + 1][0]) { a = KF[i]; b = KF[i + 1]; break; } }
    const t = (phase - a[0]) / Math.max(1e-6, b[0] - a[0]);
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(Phaser.Display.Color.IntegerToColor(a[1]), Phaser.Display.Color.IntegerToColor(b[1]), 100, Math.round(t * 100));
    return { color: Phaser.Display.Color.GetColor(c.r, c.g, c.b), alpha: a[2] + (b[2] - a[2]) * t };
  }

  // (Phase 8) Seasonal terrain tint: spring (none), summer (warm), autumn
  // (orange), winter (blue-gray). Matches the seasonHint() ranges.
  updateSeason() {
    if (!this.seasonOverlay) return;
    const s = this.seasonHint(this.gameDay);
    // (Visual P5) Seasonal colour grading: spring brighter/green, summer warm/yellow,
    // autumn desaturated orange, winter blue-cold. Layered lightly over the world.
    const map = {
      'Early Spring': [0x7affa0, 0.05], 'Late Spring': [0x88ffb0, 0.06], // spring — fresh green
      Summer: [0xffd060, 0.08], 'Early Autumn': [0xd08838, 0.09], 'Late Autumn': [0xc06822, 0.11], Winter: [0xbcd6f0, 0.20], // (Audit FIX 7) stronger white-blue winter cast
    };
    const [col, a] = map[s] || [0x000000, 0];
    this.seasonOverlay.fillColor = col;
    this.tweens.add({ targets: this.seasonOverlay, alpha: a, duration: 800 });
    // (Feel pass) A brief full-screen colour wash when the season actually changes.
    if (s !== this._lastSeasonWash) {
      this._lastSeasonWash = s;
      if (this._seasonWashDone) {
        const wash = this.add.rectangle(0, 0, GAME_W, GAME_H, col, 0.35).setOrigin(0, 0).setScrollFactor(0).setDepth(95);
        this.tweens.add({ targets: wash, alpha: 0, duration: 1800, onComplete: () => wash.destroy() });
        try { sfx.play('season_change'); } catch (e) {} // (Polish Phase 10) airy season-turn chime
      }
      this._seasonWashDone = true; // skip the very first call (initial season)
    }
  }

  // ---- (Polish Phase 4) Seasonal weather: snow in Winter, rain in Spring/Autumn

  createWeather() {
    if (!this.textures.exists('wx_snow')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false } as any);
      g.fillStyle(0xffffff, 0.5); g.fillCircle(5, 5, 4); g.fillStyle(0xffffff, 1); g.fillCircle(5, 5, 2.6); g.generateTexture('wx_snow', 10, 10); g.destroy();
    }
    if (!this.textures.exists('wx_rain')) {
      // (Visual P5) A soft diagonal streak reads as a fast raindrop.
      const g = this.make.graphics({ x: 0, y: 0, add: false } as any);
      g.fillStyle(0xcfe0f4, 0.85); g.fillRect(0, 0, 2, 14); g.fillStyle(0xeaf3ff, 1); g.fillRect(0, 0, 1, 14); g.generateTexture('wx_rain', 2, 14); g.destroy();
    }
    // Screen-fixed emitters above the world but below the HUD; both start idle.
    // (Visual P5) Snow: drifting flakes in 3 sizes (scale spread) with gentle wind sway.
    this.snowEmitter = this.add.particles(0, 0, 'wx_snow', {
      x: { min: -20, max: GAME_W + 20 }, y: -14, lifespan: 7000,
      speedY: { min: 22, max: 60 }, speedX: { min: -22, max: 22 },
      scale: { min: 0.45, max: 1.55 }, alpha: { start: 0.95, end: 0.5 },
      rotate: { min: -20, max: 20 },
      quantity: 3, frequency: 65, maxParticles: 260,
    }).setScrollFactor(0).setDepth(38);
    // (Visual P5) Rain: steeper diagonal streaks angled with the wind.
    this.rainEmitter = this.add.particles(0, 0, 'wx_rain', {
      x: { min: -60, max: GAME_W + 160 }, y: -14, lifespan: 1400,
      speedY: { min: 420, max: 540 }, speedX: { min: -160, max: -110 },
      scale: { min: 0.7, max: 1.15 }, alpha: { start: 0.55, end: 0.15 }, rotate: -18,
      quantity: 4, frequency: 26, maxParticles: 260,
    }).setScrollFactor(0).setDepth(38);
    this.snowEmitter.stop(); this.rainEmitter.stop();
    this.snowEmitter.setAlpha(0); this.rainEmitter.setAlpha(0);
    // (Visual P5) Drifting fog: two soft horizontal bands that ease in/out by alpha.
    if (!this.textures.exists('wx_fog')) {
      const tex = this.textures.createCanvas('wx_fog', 256, 96);
      const ctx = tex.getContext();
      const grad = ctx.createLinearGradient(0, 0, 0, 96);
      grad.addColorStop(0, 'rgba(210,220,228,0)');
      grad.addColorStop(0.5, 'rgba(210,220,228,0.6)');
      grad.addColorStop(1, 'rgba(210,220,228,0)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, 256, 96); tex.refresh();
    }
    this.fogLayer = this.add.container(0, 0).setScrollFactor(0).setDepth(33).setAlpha(0);
    this._fogTiles = [];
    for (let i = 0; i < 4; i++) {
      const ti = this.add.image((i % 2) * 720 + (i < 2 ? 0 : 360), GAME_H * (0.45 + 0.13 * Math.floor(i / 2)), 'wx_fog')
        .setOrigin(0, 0.5).setDisplaySize(820, 150).setAlpha(0.5);
      ti.setData('v', Phaser.Math.FloatBetween(4, 10) * (i % 2 ? 1 : -1));
      this.fogLayer.add(ti); this._fogTiles.push(ti);
    }
    // (Visual P5) Lightning graphics (forked bolt) + a screen flash, both idle.
    this.lightningG = this.add.graphics().setScrollFactor(0).setDepth(39).setAlpha(0);
    this.lightningFlash = this.add.rectangle(0, 0, GAME_W, GAME_H, 0xdfe8ff, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(39);
    this._weather = 'clear';
    // (Visual P5) Dev/test hook: force a weather visual without changing season logic.
    this._forceWeather = (w) => this._applyWeatherVisual(w, true);
    this._triggerLightning = () => this._strikeLightning();
  }

  weatherForSeason(season) {
    if (season === 'Winter') return 'snow';
    if (season.indexOf('Spring') >= 0 || season.indexOf('Autumn') >= 0) return 'rain';
    return 'clear';
  }

  // (Visual P5) Apply the *visual* state for a weather type. updateWeather() keeps
  // the season→weather mapping (logic); this only swaps the emitters/fog/sound.
  _applyWeatherVisual(want, force?) {
    if (!force && want === this._weather) return;
    this._weather = want;
    const fadeOut = (em) => { if (!em) return; this.tweens.add({ targets: em, alpha: 0, duration: 1200, onComplete: () => em.stop() }); };
    const fadeIn = (em) => { if (!em) return; em.start(); this.tweens.add({ targets: em, alpha: 1, duration: 1500 }); };
    const fogTo = (a) => { if (this.fogLayer) this.tweens.add({ targets: this.fogLayer, alpha: a, duration: 1500 }); };
    if (want === 'snow') { fadeOut(this.rainEmitter); fadeIn(this.snowEmitter); fogTo(0); sfx.stopAmbient('rain'); sfx.startAmbient('wind', 'wind', 0.16); } // (Audit FIX 7) louder winter wind
    else if (want === 'rain') { fadeOut(this.snowEmitter); fadeIn(this.rainEmitter); fogTo(0); sfx.stopAmbient('wind'); sfx.startAmbient('rain', 'rain'); }
    else if (want === 'fog') { fadeOut(this.snowEmitter); fadeOut(this.rainEmitter); fogTo(0.75); sfx.stopAmbient('rain'); sfx.startAmbient('wind', 'wind', 0.1); }
    else { fadeOut(this.snowEmitter); fadeOut(this.rainEmitter); fogTo(0); sfx.stopAmbient('wind'); sfx.stopAmbient('rain'); }
    this.updateSnowCaps(want === 'snow');
  }

  updateWeather() {
    // (Logic unchanged) Season decides which weather we want; visual swap delegated.
    const want = this.weatherForSeason(this.seasonHint(this.gameDay));
    if (want === this._weather) return;
    this._applyWeatherVisual(want);
  }

  // (Visual P5) A brief forked lightning bolt + screen flash (rain only, rare).
  _strikeLightning() {
    if (!this.lightningG) return;
    const g = this.lightningG; g.clear();
    let x = Phaser.Math.Between(GAME_W * 0.2, GAME_W * 0.8), y = 0;
    g.lineStyle(2.5, 0xeaf3ff, 1);
    g.beginPath(); g.moveTo(x, y);
    const segs = 7, step = (GAME_H * 0.55) / segs;
    for (let i = 0; i < segs; i++) {
      x += Phaser.Math.Between(-40, 40); y += step;
      g.lineTo(x, y);
      if (Math.random() < 0.4) { // small fork
        g.lineTo(x + Phaser.Math.Between(-30, 30), y + step * 0.6);
        g.moveTo(x, y);
      }
    }
    g.strokePath();
    g.setAlpha(1);
    this.tweens.add({ targets: g, alpha: 0, duration: 260, ease: 'Quad.in' });
    if (this.lightningFlash) { this.lightningFlash.setAlpha(0.5); this.tweens.add({ targets: this.lightningFlash, alpha: 0, duration: 320 }); }
    try { sfx.play && sfx.play('thunder'); } catch (e) {}
  }

  // White snow caps on building roofs during Winter (visual accumulation).
  updateSnowCaps(on) {
    for (const b of this.buildings.buildings) {
      if (!b.alive) continue;
      if (on && !b._snowCap) {
        const cy = b.y - (b.baseScale || 1) * 40;
        // (Audit FIX 7) Thicker, brighter roof snow stripe.
        const cap = this.add.ellipse(b.x, cy, (b.baseScale || 1) * 34, (b.baseScale || 1) * 17, 0xffffff, 0.97).setDepth(4);
        cap.setData('owner', b);
        b._snowCap = cap;
      } else if (!on && b._snowCap) { b._snowCap.destroy(); b._snowCap = null; }
    }
  }

  createDayCounter() {
    this.hud.day = this.add
      .text(GAME_W / 2, 12, `Day ${this.gameDay}`, { fontFamily: 'monospace', fontSize: '18px', color: '#ffe9a8', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(43);
  }

  updateDayCycle(gdelta) {
    // (Phase 3) TIME NEVER STOPS. The continent owns the master clock; while the
    // player is inside a settlement, this local ticker keeps GameWorld.day moving
    // (so the campaign clock advances) and the local view READS that day for its
    // own day cycle. DAY_MS matches the continent (1 day = 5 real minutes).
    GameWorld.day += gdelta / DAY_MS;
    this.dayTimer += gdelta;
    if (this.dayTimer >= DAY_MS) {
      this.dayTimer -= DAY_MS;
      this.gameDay = GameWorld.displayDay();
      // (Loop 3, Feature #3) Farm L5 auto-feeds the army from its stockpile → halves upkeep.
      const autoFeed = this.buildings.buildings.some((b) => b.typeKey === 'farm' && b.alive && b.level >= 5) ? 0.5 : 1;
      const eat = Math.round(this.troops.dailyUpkeep() * (this._seasonFoodUpkeepMult || 1) * (this._weatherFoodMult || 1) * (this.traitBonuses ? this.traitBonuses.foodMult : 1) * autoFeed); // (Phase 3 season + Phase 4 Warlord + Loop 3 farm L5 + V2 P12 winter)
      this.resources.food = Math.max(0, this.resources.food - eat);
      this.onNewDay(eat);
    }
    const phase = this.dayTimer / DAY_MS;
    const atmo = this.atmosphereAt(phase);
    if (this.dnOverlay) { this.dnOverlay.fillColor = atmo.color; this.dnOverlay.setAlpha(atmo.alpha); }
    // Night-ness (stars/moon) spans dusk→dawn. (BUG 8) Torches removed entirely —
    // the day/night sky shift is sufficient atmosphere.
    let night = phase >= 0.84 ? (phase - 0.84) / 0.10 : phase < 0.08 ? 1 - phase / 0.08 : 0;
    night = Phaser.Math.Clamp(night, 0, 1);
    this._nightness = night;
    this.drawSkyGradient(phase, night); // (Visual P5) layered sky band (bucketed)
    this.drawSkyBodies(phase, night);
    this.updateNightGlow(night); // (Polish Phase 10) warm building glow at night
    this.updateAtmosphereFx(phase, night); // (Visual P5) fog drift, lightning, ambient
    if (this.hud && this.hud.day) this.hud.day.setText(`Day ${this.gameDay}`);
  }

  // (Visual P5) Per-frame atmosphere extras: drifting fog, rare rain lightning,
  // and ambient particle layer keyed to season/time. Kept cheap and self-gating.
  updateAtmosphereFx(phase, night) {
    const now = this.time.now;
    const dt = this._lastFxNow ? Math.min(80, now - this._lastFxNow) : 16;
    this._lastFxNow = now;
    // --- Fog drift (only when the fog layer is visible) ---
    if (this.fogLayer && this.fogLayer.alpha > 0.01 && this._fogTiles) {
      for (const ti of this._fogTiles) {
        ti.x += (ti.getData('v') || 5) * dt * 0.001;
        if (ti.x > GAME_W) ti.x = -ti.displayWidth;
        else if (ti.x < -ti.displayWidth) ti.x = GAME_W;
      }
    }
    // --- Rare lightning during rain ---
    if (this._weather === 'rain') {
      this._lightAcc = (this._lightAcc || 0) + dt;
      if (this._lightAcc >= (this._nextLight || 9000)) {
        this._lightAcc = 0;
        this._nextLight = Phaser.Math.Between(12000, 28000); // next strike window
        if (Math.random() < 0.6) this._strikeLightning();
      }
    } else { this._lightAcc = 0; }
    // --- Ambient particles: pick the layer that fits season + time ---
    this.updateAmbientParticles(phase, night);
  }

  // (Visual P5) Subtle always-on ambient life. One screen-fixed emitter, retargeted
  // by season/time: day dust motes, autumn leaves, spring pollen, night fireflies.
  createAmbientParticles() {
    if (!this.textures.exists('amb_dot')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false } as any);
      g.fillStyle(0xffffff, 0.45); g.fillCircle(4, 4, 4); g.fillStyle(0xffffff, 1); g.fillCircle(4, 4, 2); g.generateTexture('amb_dot', 8, 8); g.destroy();
    }
    if (!this.textures.exists('amb_leaf')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false } as any);
      g.fillStyle(0xffffff, 1); g.fillEllipse(5, 4, 9, 5); g.generateTexture('amb_leaf', 10, 8); g.destroy();
    }
    // Low count for performance; screen-fixed so it reads as floating atmosphere.
    this.ambientEmitter = this.add.particles(0, 0, 'amb_dot', {
      x: { min: 0, max: GAME_W }, y: { min: TOP_BAR + 20, max: GAME_H - PANEL_H },
      lifespan: 6000, speedX: { min: -10, max: 10 }, speedY: { min: -6, max: 6 },
      scale: { min: 0.4, max: 1.0 }, alpha: { start: 0, end: 0 },
      tint: 0xfff2c8, quantity: 1, frequency: 600, maxParticles: 26,
    }).setScrollFactor(0).setDepth(37);
    this.ambientEmitter.stop();
    this._ambientKind = 'none';
  }

  updateAmbientParticles(phase, night) {
    const em = this.ambientEmitter; if (!em) return;
    const season = this.seasonHint(this.gameDay);
    // Decide the ambient kind. (Visual only — no gameplay coupling.)
    let kind = 'dust';
    if (night > 0.6) kind = 'firefly';
    else if (season.indexOf('Autumn') >= 0) kind = 'leaf';
    else if (season.indexOf('Spring') >= 0) kind = 'pollen';
    if (kind === this._ambientKind) return; // only reconfigure on change (cheap)
    this._ambientKind = kind;
    // Reconfigure via the documented emitter setters (Phaser 3.90). Alpha pulses
    // in/out over each particle's life via the onUpdate (p,k,t) signature.
    const cfg = {
      firefly: { tex: 'amb_dot', tint: 0xbfff8a, freq: 700, peak: 0.85, sx: 6, sy: 6 },
      leaf:    { tex: 'amb_leaf', tint: 0xd08a30, freq: 900, peak: 0.7, sx: -16, sy: 24 },
      pollen:  { tex: 'amb_dot', tint: 0xfff0a0, freq: 700, peak: 0.6, sx: 8, sy: 4 },
      dust:    { tex: 'amb_dot', tint: 0xfff2c8, freq: 600, peak: 0.45, sx: 6, sy: 4 },
    }[kind];
    em.setTexture(cfg.tex);
    em.setParticleTint(cfg.tint);
    em.setFrequency(cfg.freq);
    em.setParticleSpeed(cfg.sx, cfg.sy);
    em.setParticleAlpha((p, k, t) => cfg.peak * Math.sin(Math.PI * t));
    if (!em.emitting) em.start();
  }

  // (Visual P5) Interpolate a 3-stop sky palette (top / middle / horizon) for the
  // given day phase. Dawn warm-pink, day blue, dusk orange-purple, night near-black.
  skyPaletteAt(phase) {
    // [phase, topColor, midColor, horizonColor]
    const KF = [
      [0.00, 0x2a1f4a, 0x7a3a6a, 0xff9a5a], // dawn — deep blue → purple-pink → warm orange horizon
      [0.10, 0x4a78b8, 0x88b0d8, 0xd8e6f0], // morning — pale blue
      [0.50, 0x2f5fa8, 0x6fa0d8, 0xbcd8ee], // day — blue, pale horizon
      [0.68, 0x355f9a, 0x9a7aa8, 0xffc878], // late afternoon — warming horizon
      [0.78, 0x3a2456, 0x8a3a5a, 0xff5a22], // dusk — purple → orange-red horizon
      [0.86, 0x140e34, 0x33214e, 0x6a2a4a], // dusk fade
      [0.92, 0x05081c, 0x0a1030, 0x12183a], // night — very deep blue → near-black
      [1.00, 0x04061a, 0x080d28, 0x0e1430], // deep night
    ];
    let a = KF[0], b = KF[KF.length - 1];
    for (let i = 0; i < KF.length - 1; i++) { if (phase >= KF[i][0] && phase <= KF[i + 1][0]) { a = KF[i]; b = KF[i + 1]; break; } }
    const t = Phaser.Math.Clamp((phase - a[0]) / Math.max(1e-6, b[0] - a[0]), 0, 1);
    const lerp = (ca, cb) => { const c = Phaser.Display.Color.Interpolate.ColorWithColor(Phaser.Display.Color.IntegerToColor(ca), Phaser.Display.Color.IntegerToColor(cb), 100, Math.round(t * 100)); return `rgb(${c.r},${c.g},${c.b})`; };
    return { top: lerp(a[1], b[1]), mid: lerp(a[2], b[2]), horizon: lerp(a[3], b[3]) };
  }

  // (Visual P5) Paint the layered sky band into a canvas texture, then show it as
  // a screen-fixed image. Redrawn only when the phase bucket changes (cheap).
  drawSkyGradient(phase, night) {
    const bucket = Math.round(phase * 60); // ~60 buckets across a day → smooth, rare redraws
    const seasonKey = this.seasonHint(this.gameDay);
    if (bucket === this._skyPhaseBucket && seasonKey === this._skySeasonKey) return;
    this._skyPhaseBucket = bucket; this._skySeasonKey = seasonKey;
    const g = this.skyGradG; if (!g) return;
    const pal = this.skyPaletteAt(phase);
    const h = this._skyHorizon, w = GAME_W;
    // (Visual P5) seasonal grading nudges the horizon warmth/coolness slightly.
    g.clear();
    // Vertical gradient: opaque at the very top, fading to transparent at horizon.
    const toRGB = (s) => { const m = s.match(/\d+/g); return [+m[0], +m[1], +m[2]]; };
    const [tr, tg, tb] = toRGB(pal.top), [mr, mg, mb] = toRGB(pal.mid), [hr, hg, hb] = toRGB(pal.horizon);
    const bands = 30;
    for (let i = 0; i < bands; i++) {
      const f = i / (bands - 1);
      let r, gg, bb;
      if (f < 0.5) { const k = f / 0.5; r = tr + (mr - tr) * k; gg = tg + (mg - tg) * k; bb = tb + (mb - tb) * k; }
      else { const k = (f - 0.5) / 0.5; r = mr + (hr - mr) * k; gg = mg + (hg - mg) * k; bb = mb + (hb - mb) * k; }
      // Opaque sky at the top, easing to fully transparent at the horizon so the
      // play field below is governed only by the global tint (no band seam).
      const al = Math.pow(1 - f, 1.6) * 0.96;
      g.fillStyle(Phaser.Display.Color.GetColor(Math.round(r), Math.round(gg), Math.round(bb)), Phaser.Math.Clamp(al, 0, 1));
      g.fillRect(0, Math.floor(h * f), w, Math.ceil(h / bands) + 1);
    }
    // Warm horizon glow at dawn/dusk: a soft bloom around the horizon line that
    // also fades out (centred near the bottom of the sky band, never a hard edge).
    const warm = (phase < 0.14) ? (1 - phase / 0.14) : (phase > 0.70 && phase < 0.86) ? (1 - Math.abs(phase - 0.78) / 0.08) : 0;
    if (warm > 0.02) {
      const gy = Math.floor(h * 0.80), gh = Math.ceil(h * 0.22);
      const steps = 8;
      for (let i = 0; i < steps; i++) {
        const k = i / (steps - 1);
        const a = warm * 0.32 * (1 - Math.abs(k - 0.5) * 2);
        g.fillStyle(Phaser.Display.Color.GetColor(hr, hg, hb), Phaser.Math.Clamp(a, 0, 1));
        g.fillRect(0, gy + Math.floor(gh * k), w, Math.ceil(gh / steps) + 1);
      }
    }
  }

  // Stars (twinkling), nebula wisps, clouds, an arcing sun w/ glow + god-rays, moon.
  drawSkyBodies(phase, night) {
    const g = this.skyG; if (!g) return;
    g.clear();
    const now = this.time.now;
    // --- Nebula wisps (deep night only) ---
    if (night > 0.4) {
      const na = (night - 0.4) / 0.6 * 0.06;
      for (const n of this._nebula) {
        g.fillStyle(n.col, na);
        g.fillCircle(n.x, n.y, n.r);
        g.fillStyle(n.col, na * 0.8);
        g.fillCircle(n.x + n.r * 0.4, n.y + n.r * 0.2, n.r * 0.6);
      }
    }
    // --- Stars (twinkling, varied size) ---
    if (night > 0.02) {
      for (const s of this._stars) {
        const tw = 0.7 + 0.3 * Math.sin(now * s.sp + s.ph);
        g.fillStyle(0xbcd0ff, night * tw * 0.4);
        g.fillCircle(s.x, s.y, s.r + 1.6);
        g.fillStyle(0xffffff, night * tw);
        g.fillCircle(s.x, s.y, s.r);
      }
    }
    // --- Daytime cumulus clouds (drift slowly across the sky band) ---
    const dayAmt = Phaser.Math.Clamp(1 - night * 1.6, 0, 1);
    if (dayAmt > 0.05) {
      const dt = this._lastSkyNow ? Math.min(80, now - this._lastSkyNow) : 16;
      for (const cl of this._clouds) {
        cl.x += cl.v * dt * 0.001;
        if (cl.x - 90 * cl.s > GAME_W) cl.x = -90 * cl.s;
        const ca = dayAmt * 0.5;
        g.fillStyle(0xffffff, ca);
        const x = cl.x, y = cl.y, s = cl.s;
        g.fillCircle(x, y, 22 * s);
        g.fillCircle(x + 26 * s, y + 4 * s, 28 * s);
        g.fillCircle(x + 54 * s, y, 20 * s);
        g.fillCircle(x + 28 * s, y - 12 * s, 20 * s);
        g.fillStyle(0xdfe8f4, ca * 0.6);
        g.fillEllipse(x + 26 * s, y + 12 * s, 90 * s, 18 * s);
      }
    }
    this._lastSkyNow = now;
    // --- Sun: arcs east→west, soft warm glow; god-ray shafts at dusk ---
    const sunA = Phaser.Math.Clamp(1 - night * 1.4, 0, 1);
    if (sunA > 0.02 && phase < 0.88) {
      const p = Phaser.Math.Clamp(phase / 0.86, 0, 1);
      const sx = GAME_W * (0.90 - p * 0.80), sy = 130 - Math.sin(Math.PI * p) * 86;
      const dusk = Phaser.Math.Clamp((phase - 0.66) / 0.16, 0, 1); // god-rays ramp at dusk
      const dawn = Phaser.Math.Clamp((0.12 - phase) / 0.12, 0, 1);
      const rim = Math.max(dusk, dawn);
      // God-ray shafts (cheap: a few translucent triangles fanning down from the sun).
      if (rim > 0.05) {
        const rayCol = phase > 0.5 ? 0xff8a40 : 0xffd27a;
        for (let i = -3; i <= 3; i++) {
          const spread = i * 60;
          g.fillStyle(rayCol, rim * 0.05 * sunA);
          g.beginPath();
          g.moveTo(sx, sy);
          g.lineTo(sx + spread - 36, sy + 320);
          g.lineTo(sx + spread + 36, sy + 320);
          g.closePath(); g.fillPath();
        }
      }
      const warmGlow = phase > 0.5 ? 0xff9a4a : phase < 0.13 ? 0xffb060 : 0xfff3c0;
      g.fillStyle(warmGlow, sunA * 0.18); g.fillCircle(sx, sy, 46);
      g.fillStyle(warmGlow, sunA * 0.35); g.fillCircle(sx, sy, 26);
      g.fillStyle(0xfff3c0, sunA * 0.5); g.fillCircle(sx, sy, 16);
      g.fillStyle(0xffe890, sunA); g.fillCircle(sx, sy, 11);
    }
    // --- Moon: soft halo + crescent carve ---
    if (night > 0.05) {
      const mx = GAME_W * 0.52, my = 84;
      g.fillStyle(0xdfe8ff, night * 0.10); g.fillCircle(mx, my, 40);
      g.fillStyle(0xdfe8ff, night * 0.22); g.fillCircle(mx, my, 28);
      g.fillStyle(0xf2f6ff, night); g.fillCircle(mx, my, 16);
      g.fillStyle(0x05081c, night); g.fillCircle(mx + 7, my - 4, 14); // carve crescent w/ near-black night sky
    }
  }

  // (BUG 8) Torches removed entirely — the day/night sky shift is the atmosphere.

  onNewDay(eat) {
    sfx.play('day_start'); // (Polish Phase 2) dawn bell
    this.updateSeason();
    this.updateWeather(); // (Polish Phase 4) switch snow/rain on season change
    if (this.weatherSys) this.weatherSys.onNewDay(); // (V2 Phase 12) weather gameplay effects
    if (this.population) { this.population.onNewDay(); this.updatePopulationHud(); } // (Phase 5)
    if (this.armyMgr) this.armyMgr.onNewDay(); // (Expansion) army supply/morale
    if (this.worldEvents) this.worldEvents.onNewDay(); // (Expansion Phase 3) world events
    if (this.reputation) { this.reputation.onNewDay(); this.updateKingdomTitle(); } // (Phase 4)
    if (this.research) this.research.onNewDay(); // (Phase 5) research progress
    if (this.banking) this.banking.onNewDay(); // (Completion Phase 3) interest + loan handling
    if (this.greatCouncil) this.greatCouncil.onNewDay(); // (Completion Phase 4) council effects
    if (this.heroes) this.heroes.checkArrivals(); // (V2 Phase 3) hero arrivals
    this.checkHeroFx(); // (Visual P7) celebrate arrivals / mourn deaths visually (no logic change)
    if (this.maintenance) this.maintenance.onNewDay(); // (V2 Phase 6) aging + disasters
    if (this.court) this.court.onNewDay(); // (V2 Phase 7) royal court weekly reports
    if (this.succession) this.succession.onNewDay(); // (V2 Phase 8) heir raising + natural death
    if (this.espionage) this.espionage.onNewDay(); // (V2 Phase 9) spy training
    if (this.wildlife && this.wildlife.onNewDay) this.wildlife.onNewDay(); // (V2 Phase 10) ecosystem + goblin camp growth
    if (this.narrative) this.narrative.onNewDay(); // (V2 Phase 11) story beats + Truth path
    if (this.popClasses) this.popClasses.onNewDay(); // (V2 Phase 13) class economic bonuses
    // (Completion Phase 7) Advance Siege Workshop training.
    for (const b of this.buildings.buildings) { if (b.typeKey === 'siegeworkshop' && b._siegeDays > 0) { b._siegeDays -= 1; if (b._siegeDays <= 0) this.troops.spawnSiege(b); } }
    if (this.winConditions) this.winConditions.onNewDay(); // (Audit FIX 2) check victory paths
    if (this.factions) this.factions.onNewDay(); // (Session-1 Phase 2) wandering factions daily
    this.checkTaxRevolt(); // (Session-1 Phase 5) tax revolt check
    // (Session-1 Phase 3) Expire temporary world-event modifiers.
    if (this._eventFarmUntil && this.gameDay >= this._eventFarmUntil) { this._eventFarmMult = 1; this._eventFarmUntil = 0; }
    if (this._tempWorkerUntil && this.gameDay >= this._tempWorkerUntil) { this.resources.workersCap = Math.max(0, this.resources.workersCap - (this._tempWorkerBonus || 0)); this._tempWorkerBonus = 0; this._tempWorkerUntil = 0; }
    // (Save system) Auto-save to slot 0 every N days.
    const freq = this._autoSaveEveryDays || 5;
    if (freq > 0 && this.gameDay > 1 && this.gameDay % freq === 0) this.autoSave();
    const c = this.buildings.castle;
    // (Phase 5) Artifact daily yields: Farmer's Almanac (+food/farm),
    // Miner's Compass (+stone/mine).
    if (this.buffs) {
      if (this.buffs.farmBonusPerDay) {
        const n = this.buildings.countOfType('farm');
        if (n) this.resources.add('food', this.buffs.farmBonusPerDay * n);
      }
      if (this.buffs.mineBonusPerDay) {
        const n = this.buildings.countOfType('mine');
        if (n) this.resources.add('stone', this.buffs.mineBonusPerDay * n);
      }
    }
    // (Phase B) Passive income from conquered neutral settlements.
    if (this.settlements) this.settlements.collectDaily();
    // (Phase 2) Daily building effects: Blacksmith crafts Equipment, Market /
    // Tavern action cooldowns reset, Caravans depart, Administrators pay tribute.
    for (const b of this.buildings.buildings) {
      if (b.typeKey === 'blacksmith' && b.workers > 0) this.resources.add('equipment', b.workers);
      if (b.typeKey === 'tavern' && b._recruitCd > 0) b._recruitCd -= 1;
    }
    if (this.caravans) this.caravans.onNewDay();
    if (this.diplomacy) this.diplomacy.onNewDay();
    this.updateSeason(); // (Phase 8) seasonal terrain cast
    if (this.npcs) this.npcs.forEach((n) => n.refresh && n.refresh());
    // Brief sunrise: a warm screen flash + a sun disc rising.
    const flash = this.add.rectangle(0, 0, GAME_W, GAME_H, 0xffd27f, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(80);
    this.tweens.add({ targets: flash, alpha: { from: 0.45, to: 0 }, duration: 1400, onComplete: () => flash.destroy() });
    const sun = this.add.circle(GAME_W * 0.5, GAME_H * 0.62, 28, 0xffe9a8, 0.95).setScrollFactor(0).setDepth(81);
    this.tweens.add({ targets: sun, y: GAME_H * 0.22, alpha: 0, duration: 1700, ease: 'Sine.out', onComplete: () => sun.destroy() });

    // (Phase 7) Centered "Day X — Season" banner for ~2s.
    const banner = this.add
      .text(GAME_W / 2, 150, `Day ${this.gameDay} — ${this.seasonHint(this.gameDay)}`, { fontFamily: 'monospace', fontSize: '26px', color: '#ffe9a8', fontStyle: 'bold', stroke: '#3a2a10', strokeThickness: 5 })
      .setOrigin(0.5).setScrollFactor(0).setDepth(82).setAlpha(0);
    this.tweens.add({ targets: banner, alpha: 1, y: 140, duration: 350, hold: 1300, yoyo: true, onComplete: () => banner.destroy() });

    // (Phase 7) A loaf floats up from the stockpile when food is consumed.
    if (c && eat > 0) {
      const bread = this.add.image(c.x, c.y - 30, 'icon_food').setDisplaySize(20, 20).setDepth(60);
      this.tweens.add({ targets: bread, y: c.y - 72, alpha: 0, duration: 1500, onComplete: () => bread.destroy() });
      this.floatText(c.x + 22, c.y - 40, `-${eat}`, '#ffd27f');
    }
  }

  // Day 1-10 = Early Spring, then a 60-day seasonal cycle.
  seasonHint(day) {
    const seasons = ['Early Spring', 'Late Spring', 'Summer', 'Early Autumn', 'Late Autumn', 'Winter'];
    return seasons[Math.floor((day - 1) / 10) % seasons.length];
  }

  // ---- Main loop (mirrors GameScene.update; food is now per-day) -----------

  update(time, delta) {
    if (this.isGameOver) return;
    this.gamePlayMs = (this.gamePlayMs || 0) + delta; // (Save system) real playtime
    if (this._menuOpen) return; // menu pauses the sim
    const realDt = delta / 1000;
    const gdelta = delta * this.gameSpeed;
    const dt = realDt * this.gameSpeed;

    this.tickAccumulator += gdelta;
    while (this.tickAccumulator >= 1000) {
      this.tickAccumulator -= 1000;
      this.buildings.tick(this.resources, this);
    }

    this.updateDayCycle(gdelta);

    // Desertion if food hits zero (kept from GameScene).
    if (this.resources.food <= 0 && this.troops.count > 0) {
      this._desertAcc = (this._desertAcc || 0) + gdelta;
      if (this._desertAcc >= 15000) {
        this._desertAcc = 0;
        if (this.troops.removeRandom()) {
          const c = this.buildings.castle;
          if (c) this.floatText(c.x, c.y - 40, 'A soldier deserted!', '#ff8a80');
        }
      }
    } else {
      this._desertAcc = 0;
    }
    if (this.resources.food < 30) this.fireHint('lowFood', 'Food is running low — build a Farm so your people keep eating');
    if (this.resources.workersCap > 0 && this.buildings.workersUsed() >= this.resources.workersCap) this.fireHint('workerCap', 'All workers are busy — build more Houses to grow your workforce');
    if (this.canUpgradeTier()) this.fireHint('canUpgrade', 'Your settlement can grow — use the Grow button at the bottom-right');
    if (this.troops.count >= 5) this.fireHint('army5', 'You have an army — send an Expedition (bottom panel) for rare rewards');

    if (this.waveCoord.cooldown > 0) this.waveCoord.cooldown -= dt;
    for (const k of this.kingdoms) k.update(dt); // Phase 6: independent AI kingdoms
    this.reconcileEnemySpawns(); // mark new enemies (they already spawn at their castle)
    this.waves.update(dt);
    this.wildlife.update(dt); // Phase 2 wildlife threats
    this.settlements.update(dt); // Phase B: neutral settlements
    this.goblinCamps.update(dt); // Phase B: goblin camps
    // Player troops + towers fight AI enemies, wildlife, and the garrisons of
    // neutral settlements / goblin camps with the same combat code.
    const threats = this.waves.enemies.concat(this.wildlife.units, this.settlements.threats(), this.goblinCamps.threats());
    this.buildings.updateTowers(dt, threats);
    this.nodes.update(gdelta);
    this.expeditions.update(dt);
    if (this.territory) this.territory.update(dt); // Phase 4: fog reveal around units
    if (this.updateFogOverlay) this.updateFogOverlay(); // (BUG 7) opaque fog overlay
    if (this.ruins) this.ruins.update(); // (Session-1 Phase 1) ruin discovery
    if (this.factions) this.factions.update(dt); // (Session-1 Phase 2) wandering factions
    if (this.discovery) this.discovery.update(); // (Session-1 Phase 4) location discovery

    const trainingOpen = this.selectedBuilding && this.selectedBuilding.typeKey === 'barracks' && this.selectedBuilding.slots.length > 0;
    if (((this.panelMode === 'expedition' || this.panelMode === 'kingdoms') && !this.selectedBuilding) || trainingOpen) {
      this._panelRefresh = (this._panelRefresh || 0) + dt;
      if (this._panelRefresh >= 0.5) {
        this._panelRefresh = 0;
        this.refreshPanel();
      }
    }

    this.pawns.sync(this.resources.workersCap);
    this.pawns.update(dt);
    this.troops.update(dt, threats);
    this.resources.soldiers = this.troops.count;
    if (this.troops.count > 0) this.showTutorial(3); // Phase 2: stage 3 after first warrior

    for (const b of this.buildings.buildings) {
      if (b.typeKey !== 'barracks' || b.slots.length === 0) continue;
      const speed = b.workers >= 2 ? 1.5 : b.workers >= 1 ? 1 : 0;
      let finished = false;
      for (const slot of b.slots) slot.timeLeft -= dt * speed;
      for (const slot of b.slots.filter((s) => s.timeLeft <= 0)) {
        if (slot.type === 'archer') this.troops.spawnArcher(b);
        else if (slot.type === 'monk') this.troops.spawnMonk(b);
        else if (slot.type === 'knight') this.troops.spawnKnight(b);
        else if (slot.type === 'champion') this.troops.spawnChampion(); // (Feature #3) Barracks L5
        else if (slot.type === 'spearmen') this.troops.spawnSpearman(b); // (V2 P4)
        else if (slot.type === 'cavalry') this.troops.spawnCavalry(b); // (V2 P4)
        else if (b.level >= 4 && this.troops.spawnElite) this.troops.spawnElite(b); // (Feature #3) L4 → Elite
        else this.troops.spawn(b);
        finished = true;
        if (this.stats) this.stats.note('soldiersTrained'); // (Phase 6)
      }
      if (finished) {
        sfx.play('unit_trained'); // (Polish Phase 2)
        b.slots = b.slots.filter((s) => s.timeLeft > 0);
        if (this.selectedBuilding === b) this.refreshPanel();
      }
    }

    for (const b of this.buildings.buildings) {
      if (!b.alive && b._floatIcon) { b._floatIcon.destroy(); b._floatIcon = null; this.hideBuildingName(b); } // (Phase 6) clean up icons of dying buildings
      if (!b.alive && b._snowCap) { b._snowCap.destroy(); b._snowCap = null; } // (Phase 4) clean up snow caps
    }
    if (this.buildings.reap()) {
      if (this.selectedBuilding && !this.selectedBuilding.alive) {
        this.selectedBuilding = null;
        this.clearSelection();
      }
      this.refreshPanel();
    }

    if (!this.buildings.castle || !this.buildings.castle.alive) {
      this.triggerGameOver();
      return;
    }

    if (this.armyMgr) this.armyMgr.update(gdelta); // (Expansion) march armies
    this.updateSelectionRings();
    this.updateHud();
    this.updateSettlementHud(); // (Phase 3) settlement-context top bar (day/resources)
    this.updateMinimap();
    this.applyIsoDepths();
    this.routeCameras(); // BUG 1: keep newly-created objects on the right camera
  }

  // (Expansion Phase 7) Append a notification-log entry (kind: info/red/green/yellow).
  logEvent(text, kind = 'info') {
    if (!this._eventLog) this._eventLog = [];
    this._eventLog.push({ day: this.gameDay, text, kind });
    if (this._eventLog.length > 50) this._eventLog.shift();
    if (this._logBtnBadge) this.updateLogBadge();
  }
}
