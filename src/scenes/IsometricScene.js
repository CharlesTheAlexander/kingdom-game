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
import * as SaveManager from '../systems/SaveManager.js';
import { Population } from '../systems/Population.js';
import { ArmyManager } from '../systems/ArmyManager.js';
import { WorldEvents } from '../systems/WorldEvents.js';
import { Reputation, TRAITS, defaultBonuses } from '../systems/Reputation.js';
import { Research } from '../systems/Research.js';
import { WinConditions } from '../systems/WinConditions.js';
import { Ruins } from '../systems/Ruins.js';
import { WanderingFactions } from '../systems/WanderingFactions.js';
import { BuildingTypes, BUILD_ORDER, formatCost } from '../data/BuildingTypes.js';

// ---- Isometric world constants -------------------------------------------
const N = 200;           // 200x200 tile grid (the huge continent)
const HW = 32;           // half tile width  (screenX step = col-row * 32)
const HH = 16;           // half tile height (screenY step = col+row * 16)
const OX = (N - 1) * HW; // origin offset so col-row = -(N-1) lands at x = 0
const OY = 120;          // origin offset (headroom for back-row building tops)
const WORLD_W = (N - 1) * HW * 2 + 128; // camera world bounds (~12864)
const WORLD_H = (N - 1) * HH * 2 + 260;  // (~6628)
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
export function fmtNum(n) {
  n = Math.floor(n || 0);
  if (n >= 100000) return Math.round(n / 1000) + 'k';
  if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return '' + n;
}

// (Polish) Clip an over-long name with an ellipsis so labels never overflow.
export function ellipsize(s, max) {
  s = '' + (s || '');
  return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s;
}

export class IsometricScene extends GameScene {
  constructor() {
    // NOTE: GameScene's constructor hardcodes super('GameScene') and ignores its
    // argument, so super('IsometricScene') would NOT take — both scenes would end
    // up keyed 'GameScene' and Phaser throws "duplicate key: GameScene" (black
    // screen). The key is set on this.sys.settings (already created by super())
    // before the SceneManager reads it, giving this scene its own unique key.
    super();
    this.sys.settings.key = 'IsometricScene';
  }

  // ---- Asset loading (iso terrain + buildings + Tiny Swords overlays) ------
  preload() {
    const ISO = 'assets/Isometric Strategy - Medieval Pixel Art Tiles';
    const IND = `${ISO}/individual`;
    const SH = `${ISO}/sprite_sheets`;
    const TS = 'assets/Tiny Swords (Free Pack)';
    const RED = `${TS}/Buildings/Red Buildings`;
    const UNITS = `${TS}/Units`;
    const TERR = `${TS}/Terrain`;
    const RES = `${TERR}/Resources`;
    const FX = `${TS}/Particle FX`;

    // --- Isometric terrain tiles (64x64) ---
    this.load.image('iso_grass', `${IND}/img_6.png`);       // clean grass (base)
    this.load.image('iso_grass2', `${IND}/img_7.png`);      // clean grass (variant)
    this.load.image('iso_water', `${IND}/img_71.png`);
    this.load.image('iso_water2', `${IND}/img_82.png`);
    this.load.image('iso_water3', `${IND}/img_85.png`);
    this.load.image('iso_rock', `${IND}/img_4.png`);   // boulder pile
    this.load.image('iso_mtn', `${IND}/img_5.png`);    // mountain
    // Forest tiles already have pine trees baked into the tile art.
    [174, 177, 180, 183, 186, 189, 192, 195].forEach((n, i) =>
      this.load.image(`iso_forest${i + 1}`, `${IND}/img_${n}.png`)
    );

    // --- Player buildings: texture key == building key (Buildings.js) ---
    // Distinct individual iso tiles for the smaller buildings:
    this.load.image('house', `${IND}/img_1.png`);       // cottage
    this.load.image('lumberyard', `${IND}/img_12.png`); // wood pile
    this.load.image('mine', `${IND}/img_2.png`);        // mine w/ scaffolding
    this.load.image('tower', `${IND}/img_137.png`);     // stone tower
    // Construction sheets — frame 13 = finished. Sliced into standalone textures
    // (castle / castle_town / castle_castle / barracks / farm) in create().
    this.load.spritesheet('village_sheet', `${SH}/village_sheet.png`, { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('wooden_fort_sheet', `${SH}/wooden_fort_sheet.png`, { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('stone_fort_sheet', `${SH}/stone_fort_sheet.png`, { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('wind_mill_sheet', `${SH}/wind_mill_sheet.png`, { frameWidth: 64, frameHeight: 64 });

    // --- AI red faction buildings (Tiny Swords overlays) ---
    this.load.image('enemy_castle', `${RED}/Castle.png`);
    this.load.image('ai_barracks', `${RED}/Barracks.png`);
    this.load.image('ai_tower', `${RED}/Tower.png`);
    this.load.image('ai_house', `${RED}/House1.png`);

    // --- Phase 6: Purple (NE) + Yellow (SE) AI kingdom buildings + warriors ---
    const PUR = `${TS}/Buildings/Purple Buildings`;
    const YEL = `${TS}/Buildings/Yellow Buildings`;
    this.load.image('purple_castle', `${PUR}/Castle.png`);
    this.load.image('purple_barracks', `${PUR}/Barracks.png`);
    this.load.image('purple_tower', `${PUR}/Tower.png`);
    this.load.image('purple_house', `${PUR}/House1.png`);
    this.load.image('yellow_castle', `${YEL}/Castle.png`);
    this.load.image('yellow_barracks', `${YEL}/Barracks.png`);
    this.load.image('yellow_tower', `${YEL}/Tower.png`);
    this.load.image('yellow_house', `${YEL}/House1.png`);
    this.load.spritesheet('purple_warrior_idle', `${UNITS}/Purple Units/Warrior/Warrior_Idle.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('purple_warrior_run', `${UNITS}/Purple Units/Warrior/Warrior_Run.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('yellow_warrior_idle', `${UNITS}/Yellow Units/Warrior/Warrior_Idle.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('yellow_warrior_run', `${UNITS}/Yellow Units/Warrior/Warrior_Run.png`, { frameWidth: 192, frameHeight: 192 });

    // --- Phase 2: Wildlife placeholders (tinted Tiny Swords sprites) ---
    // Wolves = red warrior; Goblins = black warrior; Boars = black pawn. Yellow
    // warrior is reused for expedition Mercenaries (Phase 5).
    this.load.spritesheet('goblin_idle', `${UNITS}/Black Units/Warrior/Warrior_Idle.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('goblin_run', `${UNITS}/Black Units/Warrior/Warrior_Run.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('boar_idle', `${UNITS}/Black Units/Pawn/Pawn_Idle.png`, { frameWidth: 192, frameHeight: 192 });

    // --- Units (Tiny Swords, 192px frames) — same keys the systems expect ---
    this.load.spritesheet('warrior_idle', `${UNITS}/Red Units/Warrior/Warrior_Idle.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('red_warrior_run', `${UNITS}/Red Units/Warrior/Warrior_Run.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('red_archer_idle', `${UNITS}/Red Units/Archer/Archer_Idle.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('pawn_idle', `${UNITS}/Blue Units/Pawn/Pawn_Idle.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('pawn_run', `${UNITS}/Blue Units/Pawn/Pawn_Run.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('pawn_run_wood', `${UNITS}/Blue Units/Pawn/Pawn_Run Wood.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('pawn_run_gold', `${UNITS}/Blue Units/Pawn/Pawn_Run Gold.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('pawn_run_meat', `${UNITS}/Blue Units/Pawn/Pawn_Run Meat.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('blue_warrior_idle', `${UNITS}/Blue Units/Warrior/Warrior_Idle.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('blue_warrior_run', `${UNITS}/Blue Units/Warrior/Warrior_Run.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('blue_archer_idle', `${UNITS}/Blue Units/Archer/Archer_Idle.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('monk_idle', `${UNITS}/Blue Units/Monk/Idle.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('heal_effect', `${UNITS}/Blue Units/Monk/Heal_Effect.png`, { frameWidth: 192, frameHeight: 192 });

    // --- (Polish Phase 1) Extra animation frames: attack / shoot / heal / tool work ---
    this.load.spritesheet('blue_warrior_attack', `${UNITS}/Blue Units/Warrior/Warrior_Attack1.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('red_warrior_attack', `${UNITS}/Red Units/Warrior/Warrior_Attack1.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('yellow_warrior_attack', `${UNITS}/Yellow Units/Warrior/Warrior_Attack1.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('purple_warrior_attack', `${UNITS}/Purple Units/Warrior/Warrior_Attack1.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('goblin_attack', `${UNITS}/Black Units/Warrior/Warrior_Attack1.png`, { frameWidth: 192, frameHeight: 192 });
    // Attack2 frames — the combined Attack1→Attack2 swing (see Animations.js).
    this.load.spritesheet('blue_warrior_attack2', `${UNITS}/Blue Units/Warrior/Warrior_Attack2.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('red_warrior_attack2', `${UNITS}/Red Units/Warrior/Warrior_Attack2.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('yellow_warrior_attack2', `${UNITS}/Yellow Units/Warrior/Warrior_Attack2.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('purple_warrior_attack2', `${UNITS}/Purple Units/Warrior/Warrior_Attack2.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('goblin_attack2', `${UNITS}/Black Units/Warrior/Warrior_Attack2.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('blue_archer_run', `${UNITS}/Blue Units/Archer/Archer_Run.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('blue_archer_shoot', `${UNITS}/Blue Units/Archer/Archer_Shoot.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('red_archer_shoot', `${UNITS}/Red Units/Archer/Archer_Shoot.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('monk_run', `${UNITS}/Blue Units/Monk/Run.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('monk_heal', `${UNITS}/Blue Units/Monk/Heal.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('pawn_run_axe', `${UNITS}/Blue Units/Pawn/Pawn_Run Axe.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('pawn_run_pickaxe', `${UNITS}/Blue Units/Pawn/Pawn_Run Pickaxe.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('pawn_interact_axe', `${UNITS}/Blue Units/Pawn/Pawn_Interact Axe.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('pawn_interact_pickaxe', `${UNITS}/Blue Units/Pawn/Pawn_Interact Pickaxe.png`, { frameWidth: 192, frameHeight: 192 });

    // --- Particle FX ---
    this.load.spritesheet('explosion', `${FX}/Explosion_01.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('dust', `${FX}/Dust_01.png`, { frameWidth: 64, frameHeight: 64 });

    // --- Resource node art ---
    this.load.spritesheet('tree1', `${RES}/Wood/Trees/Tree1.png`, { frameWidth: 128, frameHeight: 256 });
    this.load.spritesheet('tree2', `${RES}/Wood/Trees/Tree2.png`, { frameWidth: 128, frameHeight: 256 });
    this.load.image('rock1', `${TERR}/Decorations/Rocks/Rock1.png`);
    this.load.image('rock2', `${TERR}/Decorations/Rocks/Rock2.png`);
    this.load.image('rock3', `${TERR}/Decorations/Rocks/Rock3.png`);
    this.load.image('rock4', `${TERR}/Decorations/Rocks/Rock4.png`);
    this.load.image('gold_stone', `${RES}/Gold/Gold Stones/Gold Stone 1.png`);
    this.load.spritesheet('sheep_idle', `${RES}/Meat/Sheep/Sheep_Idle.png`, { frameWidth: 128, frameHeight: 128 });

    // --- Resource icons (HUD) ---
    this.load.image('icon_wood', `${RES}/Wood/Wood Resource/Wood Resource.png`);
    this.load.image('icon_gold', `${RES}/Gold/Gold Resource/Gold_Resource.png`);
    this.load.image('icon_food', `${RES}/Meat/Meat Resource/Meat Resource.png`);
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
      { name: 'Small Castle', stage: 7, maxBuildings: 32, cost: { gold: 1200, wood: 400, stone: 500, iron: 100 }, tex: 'castle_castle', castleScale: 1.6, wall: 'stone', moat: true, announce: 'Your town has become a Castle!' },
      { name: 'Medium Castle', stage: 8, maxBuildings: 36, cost: { gold: 1800, stone: 500, iron: 200 }, tex: 'castle_castle', castleScale: 1.8, wall: 'stone', moat: true, towers: true },
      { name: 'Large Castle', stage: 9, maxBuildings: 40, cost: { gold: 2500, stone: 600, iron: 300 }, tex: 'castle_castle', castleScale: 2.0, wall: 'stone', moat: true, towers: true, announce: 'Your kingdom stands as a mighty Castle!' },
    ];
    this.tierIndex = 0;

    this.resources = new Resources();
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
    let king = null; try { king = JSON.parse(localStorage.getItem('kg_king')); } catch (e) {}
    this.kingdomName = (king && king.kingdom) || 'Your Kingdom';
    this.rulerName = (king && king.ruler) || 'The King';
    this.kingTrait = (king && king.trait) || null;
    if (this.kingTrait) this.applyTraitBonuses(this.kingTrait);
    this.armyMgr = new ArmyManager(this); // (Expansion) armies on the map
    this.worldEvents = new WorldEvents(this); // (Expansion Phase 3) events + messenger
    this.research = new Research(this); // (Expansion Phase 5) research tree
    this.winConditions = new WinConditions(this); // (Audit FIX 2) victory paths
    this._eventLog = this._eventLog || [];
    this.panelMode = 'build';

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

    this.sliceBuildingTextures();
    this.createAnimations();
    this.drawGrid();
    this.scatterDecorations();
    this.nodes.spawnInitial();
    this.makeSkyGrade();
    this.makeVignette();
    this.createDayNightOverlay();
    this.createWeather(); // (Polish Phase 4) snow / rain particles

    this.buildings.place('castle', Math.floor(N / 2), Math.floor(N / 2));
    this.decorateBuilding(this.buildings.castle);

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

    // (Phase 6) Three independent AI kingdoms. The wave coordinator lets only
    // one attack at a time, with a cooldown between different kingdoms' waves.
    this.waveCoord = { holder: null, cooldown: 0 };
    this.ai = new AIKingdom(this, FACTIONS.red); // primary (kept for legacy refs)
    this.kingdoms = [this.ai, new AIKingdom(this, FACTIONS.purple), new AIKingdom(this, FACTIONS.yellow)];
    this.DAY_SECONDS = DAY_MS / 1000;
    this.diplomacy = new Diplomacy(this); // Phase 7: relationships with kingdoms
    this.caravans = new Caravans(this); // Phase 5: trade routes between settlements
    this.settlements = new SettlementManager(this); // Phase B: neutral settlements
    this.goblinCamps = new GoblinCampManager(this); // Phase B: goblin camps
    this.territory = new Territory(this); // Phase 4: territory + fog of war
    this.ruins = new Ruins(this); // (Session-1 Phase 1) ancient ruins
    this.factions = new WanderingFactions(this); // (Session-1 Phase 2) caravans/tribes/pilgrims
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
    // (Phase 4) First-ever start (no saved king) shows the creation screen; it
    // then opens the tutorial. Otherwise go straight to the tutorial.
    if (!this._noIntro) { let hasKing = false; try { hasKing = !!localStorage.getItem('kg_king'); } catch (e) {} if (!hasKing && !SaveManager.hasPending()) this.showKingCreation(); else this.showWelcomePanel(); }

    this.setupUICamera();

    // (Phase B) Tab toggles the continent overview (launched on top, this scene
    // pauses while it's open).
    this.input.keyboard.on('keydown-TAB', (e) => { if (e && e.preventDefault) e.preventDefault(); this.openContinent(); });
    // (Gameplay change 2) Escape cancels move/placement mode (or closes the menu).
    this.input.keyboard.on('keydown-ESC', () => {
      if (this._menuOpen) this.closeMenu();
      else if (this.movingBuilding) this.cancelMoveBuilding();
      else if (this.placementType) { this.placementType = null; this.clearGhost(); this.refreshPanel(); }
    });

    // (Save system) Menu button + shortcuts + auto-save infrastructure.
    this.gamePlayMs = this.gamePlayMs || 0;
    this._autoSaveEveryDays = 5;
    this.createMenuButton();
    this.createLogButton();   // (Expansion Phase 7) notifications log
    this.createPauseButton(); // (Expansion Phase 7) pause control
    this.setupHotkeys();      // (Expansion Phase 7) keyboard shortcuts
    this.input.keyboard.on('keydown-S', (e) => { if (this._typing) return; this.quickSave(); });
    this._beforeUnload = () => { try { SaveManager.save(this, 0); } catch (err) {} };
    window.addEventListener('beforeunload', this._beforeUnload);
    this.events.once('shutdown', () => window.removeEventListener('beforeunload', this._beforeUnload));

    // (Save system) If a load is pending (set by requestLoad → scene.restart),
    // reconstruct the saved state now that the fresh scene exists.
    if (SaveManager.hasPending()) {
      const data = SaveManager.consumePending();
      SaveManager.applySave(this, data);
      this.showLoadedBanner(this.gameDay);
    }
  }

  openContinent() {
    if (this.isGameOver || this._menuOpen) return;
    // (Bug 3) Guard double-launch and wrap the transition: if launching the
    // continent ever throws, make sure we don't end up paused with no scene up.
    if (this.scene.isActive('ContinentScene')) return;
    try { SaveManager.save(this, 0); } catch (e) {} // (Save system) auto-save before transition
    try {
      this.scene.launch('ContinentScene');
      this.scene.pause();
    } catch (e) {
      try { this.scene.resume(); } catch (e2) {}
    }
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
      const obj = list[i];
      if (obj._camRouted) continue;
      obj._camRouted = true;
      if (obj.scrollFactorX === 0) main.ignore(obj); // HUD -> uiCamera only
      else ui.ignore(obj); // world -> main camera only
    }
  }

  // The game-over overlay is built here, but update() returns early once game
  // over, so route its (screen-fixed) elements to the uiCamera immediately —
  // otherwise the main camera also renders them, zoomed (BUG 1 regression).
  triggerGameOver() {
    if (this.isGameOver) return;
    this.isGameOver = true; // (Audit FIX 2) richer defeat screen replaces the minimal one
    this.showEndScreen(false, 'Your castle has fallen');
    this.routeCameras();
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
    els.push(fix(this.add.text(GAME_W / 2, GAME_H / 2 - 210, victory ? 'VICTORY' : 'DEFEAT', { fontFamily: 'monospace', fontSize: '72px', color: victory ? '#ffd24a' : '#e74c3c', fontStyle: 'bold', stroke: '#000', strokeThickness: 8 }).setOrigin(0.5)));
    els.push(fix(this.add.text(GAME_W / 2, GAME_H / 2 - 150, victory ? `${subtitle} Victory` : subtitle, { fontFamily: 'monospace', fontSize: '22px', color: victory ? '#ffe9a8' : '#ffb0a8', fontStyle: 'bold', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5)));
    els.push(fix(this.add.text(GAME_W / 2, GAME_H / 2 - 112, `The Kingdom of ${this.kingdomName} under ${this.rulerName}`, { fontFamily: 'monospace', fontSize: '14px', color: '#cfc1a6' }).setOrigin(0.5)));
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
      mkBtn(GAME_W / 2 + 115, 'New Game', 0x5c1a1a, () => this.startNewGame());
    } else {
      mkBtn(GAME_W / 2, 'Try Again', 0x2d4a6b, () => this.scene.restart());
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
    const src = this.textures.get(srcKey).getSourceImage();
    const ct = this.textures.createCanvas(newKey, src.width, src.height);
    ct.getContext().drawImage(src, 0, 0);
    ct.refresh();
  }

  sliceFrame(sheetKey, idx, newKey) {
    if (this.textures.exists(newKey)) return;
    const src = this.textures.get(sheetKey).getSourceImage();
    const ct = this.textures.createCanvas(newKey, 64, 64);
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
    return !!def && (!def.stageUnlock || this.currentStage() >= def.stageUnlock);
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
  // regionAt() is the single source of truth, also read by ResourceNodes,
  // Wildlife, Territory and AIKingdom. The NE/SE corners fold into north/south
  // so the Purple (NE forest) and Yellow (SE plains) kingdoms sit in-theme.
  // Named biome for a tile. The huge map is banded: a flat START zone in the
  // centre, DEEP FOREST to the north, HIGHLAND MOUNTAINS east, RIVER DELTA south,
  // WESTERN WILDLANDS west, and transitional MIDDLE wilderness between them.
  biomeAt(c, r) {
    if (c < 0 || r < 0 || c >= N || r >= N) return 'middle';
    if (this.isBuildZone(c, r)) return 'start';
    if (c < 50) return 'wildlands';     // west (incl. NW/SW corners)
    if (c >= 150) return 'mountains';   // east (incl. NE/SE corners)
    if (r < 50) return 'forest';        // north band
    if (r >= 150) return 'delta';       // south band
    return 'middle';
  }

  // Compatibility shim: the older systems (Wildlife/ResourceNodes/Territory)
  // think in N/E/S/W "regions" — map the biomes onto those names.
  regionAt(c, r) {
    const b = this.biomeAt(c, r);
    if (b === 'start') return this.isBuildZone(c, r) ? 'settlement' : 'plain';
    return { forest: 'north', mountains: 'east', delta: 'south', wildlands: 'west', middle: 'plain' }[b];
  }

  // Build a single 64x64-cell canvas atlas containing every terrain tile, so the
  // whole 40,000-tile floor can be drawn by ONE Blitter (one batched draw call,
  // per-tile tint for fog/territory) instead of 40,000 separate images.
  buildTerrainAtlas() {
    this.TERRAIN_KEYS = ['iso_grass', 'iso_grass2', 'iso_water', 'iso_water2', 'iso_water3', 'iso_rock', 'iso_mtn',
      'iso_forest1', 'iso_forest2', 'iso_forest3', 'iso_forest4', 'iso_forest5', 'iso_forest6', 'iso_forest7', 'iso_forest8'];
    if (this.textures.exists('terrainAtlas')) return;
    const cols = 8, cell = 64;
    const rows = Math.ceil(this.TERRAIN_KEYS.length / cols);
    const tex = this.textures.createCanvas('terrainAtlas', cols * cell, rows * cell);
    const ctx = tex.getContext();
    this.TERRAIN_KEYS.forEach((k, i) => {
      const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
      ctx.drawImage(this.textures.get(k).getSourceImage(), 0, 0, 64, 64, x, y, cell, cell);
      tex.add(k, 0, x, y, cell, cell); // frame named by the original tile key
    });
    tex.refresh();
  }

  drawGrid() {
    this.buildTerrainAtlas();
    const waterKeys = ['iso_water', 'iso_water2', 'iso_water3'];
    const forestKeys = ['iso_forest1', 'iso_forest2', 'iso_forest3', 'iso_forest4', 'iso_forest5', 'iso_forest6', 'iso_forest7', 'iso_forest8'];

    const type = Array.from({ length: N }, () => Array(N).fill('grass'));
    const biome = Array.from({ length: N }, () => Array(N).fill('middle'));

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const b = this.biomeAt(c, r);
        biome[r][c] = b;
        let pForest = 0, pRock = 0;
        if (b === 'forest') { pForest = 0.62; pRock = 0.03; }
        else if (b === 'mountains') { pRock = 0.6; pForest = 0.04; }
        else if (b === 'wildlands') { pForest = 0.22; pRock = 0.16; }
        else if (b === 'delta') { pForest = 0.04; pRock = 0.02; }
        else if (b === 'middle') { pForest = 0.1; pRock = 0.07; }
        // start zone stays clean grass
        if (b !== 'start') {
          const roll = Math.random();
          if (roll < pForest) type[r][c] = 'forest';
          else if (roll < pForest + pRock) type[r][c] = 'rock';
        }
      }
    }

    // River: a continuous 3-4 tile east-west band across the south delta.
    for (let c = 0; c < N; c++) {
      const base = 172 + Math.round(3 * Math.sin(c * 0.05) + 1.5 * Math.sin(c * 0.21));
      const w = 3 + (Math.sin(c * 0.13) > 0.4 ? 1 : 0);
      for (let k = 0; k < w; k++) {
        const r = base + k;
        if (r >= 0 && r < N && !this.isBuildZone(c, r)) type[r][c] = 'water';
      }
    }
    this.riverRowAt = (c) => 172 + Math.round(3 * Math.sin(c * 0.05) + 1.5 * Math.sin(c * 0.21)) + 1;

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
        else key = Math.random() < 0.16 ? 'iso_grass2' : 'iso_grass';
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
    const BTINT = { market: 0xffe27a, blacksmith: 0xd08a4a, watchtower: 0xa9c6e6, tavern: 0xe0b070, wall: 0xb6b6b6, library: 0x8ab0e6 };
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
    const check = this.buildings.canPlace(typeKey, this.resources, this.maxBuildings());
    if (!check.ok) {
      this.showToast(check.reason);
      return;
    }
    this.resources.spend(def.cost);
    const b = this.buildings.place(typeKey, tile.col, tile.row);
    if (b) {
      this.decorateBuilding(b);
      this.placeFX(b);
      sfx.play('building_placed'); // (Polish Phase 2)
      this.territoryPulse(); // (Phase 8) always pulse so placement is felt
      if (typeKey === 'watchtower') this.revealAround(b.col, b.row, def.revealRadius || 8);
      if (this.territory) this.territory.recompute();
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
    const w = 184, h = 24, x = (GAME_W - w) / 2, y = 60;
    const bg = fix(this.add.rectangle(x, y, w, h, 0x10141c, 0.85).setOrigin(0, 0).setDepth(60).setStrokeStyle(1, 0x39455a, 0.9).setInteractive({ useHandCursor: true }));
    const popT = fix(this.add.text(x + 10, y + 6, 'Pop 10/14', { fontFamily: 'monospace', fontSize: '12px', color: '#dfe6ee', fontStyle: 'bold' }).setDepth(61));
    const faceG = fix(this.add.graphics().setDepth(61));
    const hapT = fix(this.add.text(x + w - 10, y + 6, '60%', { fontFamily: 'monospace', fontSize: '12px', color: '#dfe6ee', fontStyle: 'bold' }).setOrigin(1, 0).setDepth(61));
    this._popHud = { bg, popT, faceG, hapT, x, y, w, h };
    bg.on('pointerover', () => this.showTip(x + w / 2, y + h + 96, `Happiness ${this.population.happiness}%`, this.population.breakdown()));
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
    this._kingName = fix(this.add.text(56, 8, this.kingdomName, { fontFamily: 'monospace', fontSize: '14px', color: '#ffe9b0', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setDepth(60));
    this._kingTitle = fix(this.add.text(56, 26, '', { fontFamily: 'monospace', fontSize: '11px', color: '#c9a14a' }).setDepth(60));
    this.updateKingdomTitle();
  }

  updateKingdomTitle() {
    if (!this._kingName) return;
    this._kingName.setText(this.kingdomName);
    const title = this.reputation ? this.reputation.title(this.kingdomName) : null;
    this._kingTitle.setText(title || (this.kingTrait && TRAITS[this.kingTrait] ? TRAITS[this.kingTrait].name : ''));
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
    if (!this._noIntro) this.showWelcomePanel();
  }

  // ============================================================ SAVE / LOAD UI

  createMenuButton() {
    const fix = (o) => o.setScrollFactor(0);
    const bg = fix(this.add.rectangle(8, 8, 40, 28, 0x10141c, 0.9).setOrigin(0, 0).setDepth(60).setStrokeStyle(1, 0x39455a, 0.9).setInteractive({ useHandCursor: true }));
    const g = fix(this.add.graphics().setDepth(61));
    g.lineStyle(2.5, 0xdfe6ee, 1);
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(17, 15 + i * 5); g.lineTo(35, 15 + i * 5); g.strokePath(); }
    bg.on('pointerover', () => bg.setFillStyle(0x1c2330, 0.95));
    bg.on('pointerout', () => bg.setFillStyle(0x10141c, 0.9));
    bg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); sfx.play('ui_click'); this.openMenu(); });
  }

  // (Expansion Phase 7) Notifications log button — opens the last-50 event log.
  // A small red badge shows how many events arrived since it was last opened.
  createLogButton() {
    const fix = (o) => o.setScrollFactor(0);
    const bg = fix(this.add.rectangle(52, 8, 40, 28, 0x10141c, 0.9).setOrigin(0, 0).setDepth(60).setStrokeStyle(1, 0x39455a, 0.9).setInteractive({ useHandCursor: true }));
    fix(this.add.text(72, 22, '📜', { fontFamily: 'monospace', fontSize: '15px' }).setOrigin(0.5).setDepth(61));
    const badge = fix(this.add.text(86, 8, '', { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff', fontStyle: 'bold', backgroundColor: '#c0392b', padding: { x: 3, y: 1 } }).setOrigin(0.5, 0).setDepth(62)).setVisible(false);
    this._logBtnBadge = badge;
    this._logSeen = (this._eventLog || []).length;
    bg.on('pointerover', () => bg.setFillStyle(0x1c2330, 0.95));
    bg.on('pointerout', () => bg.setFillStyle(0x10141c, 0.9));
    bg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); sfx.play('ui_click'); this.toggleLog(); });
    this.updateLogBadge();
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
    els.push(fix(this.add.rectangle(px, py, panelW, panelH, 0x161b26, 0.99).setOrigin(0, 0).setDepth(101).setStrokeStyle(3, 0xc9a14a, 0.9)));
    els.push(fix(this.add.text(GAME_W / 2, py + 22, 'KINGDOM GAME', { fontFamily: 'monospace', fontSize: '26px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0).setDepth(102)));
    this._menuEls = els;

    const btn = (label, x, y, w, h, onClick, color) => {
      const b = fix(this.add.rectangle(x, y, w, h, color || 0x2d6cb0).setOrigin(0, 0).setDepth(102).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
      const t = fix(this.add.text(x + w / 2, y + h / 2, label, { fontFamily: 'monospace', fontSize: '15px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(103));
      b.on('pointerover', () => b.setFillStyle((color || 0x2d6cb0) + 0x111111));
      b.on('pointerout', () => b.setFillStyle(color || 0x2d6cb0));
      b.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); sfx.play('ui_click'); onClick(); });
      els.push(b, t);
      return b;
    };
    const text = (s, x, y, opts = {}) => { const t = fix(this.add.text(x, y, s, { fontFamily: 'monospace', fontSize: opts.size || '13px', color: opts.color || '#dfe6ee', fontStyle: opts.bold ? 'bold' : 'normal', wordWrap: opts.wrap ? { width: opts.wrap } : undefined }).setOrigin(opts.ox || 0, 0).setDepth(102)); els.push(t); return t; };

    if (screen === 'main') {
      const bx = px + 180, bw = 200; let y = py + 80;
      btn('Continue', bx, y, bw, 44, () => this.closeMenu()); y += 56;
      btn('Save Game', bx, y, bw, 44, () => this.renderMenu('save')); y += 56;
      btn('Load Game', bx, y, bw, 44, () => this.renderMenu('load')); y += 56;
      btn('Settings', bx, y, bw, 44, () => this.renderMenu('settings')); y += 56;
      btn('New Game', bx, y, bw, 44, () => this.renderMenu('newgame'), 0x8a3a3a);
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
    if (b._torch) { b._torch.destroy(); b._torch = null; }
    if (b._snowCap) { b._snowCap.destroy(); b._snowCap = null; }
    this.decorateBuilding(b);
    this.placeFX(b);
    if (this.territory) this.territory.recompute();
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
    if (b._torch) { b._torch.destroy(); b._torch = null; }
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

  upgradeTier() {
    if (this.tierIndex >= this.TIERS.length - 1) return;
    const next = this.TIERS[this.tierIndex + 1];
    if (!this.resources.spend(next.cost)) return;
    this.tierIndex += 1;
    sfx.play('tier_upgrade'); // (Polish Phase 2)

    const castle = this.buildings.castle;
    if (castle) {
      if (next.tex && this.textures.exists(next.tex)) castle.rect.setTexture(next.tex);
      castle.rect.setOrigin(0.5, 1.0).setScale(castle.baseScale * next.castleScale);
      castle.rect.clearTint();
      const by = castle.y - castle.baseScale * next.castleScale * 48;
      this.castleBarBg.y = by;
      this.castleBarFill.y = by;
      this.sparkleAt(castle.x, castle.y);
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
  drawWall(type, moat, towers) {
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
    const t = this.add
      .text(GAME_W / 2, TOP_BAR + 92, text, { fontFamily: 'monospace', fontSize: '13px', color: hex, fontStyle: 'bold', backgroundColor: '#160d0deb', padding: { x: 10, y: 5 }, align: 'center', stroke: '#000000', strokeThickness: 3, wordWrap: { width: GAME_W - 240 } })
      .setOrigin(0.5, 0)
      .setDepth(72)
      .setScrollFactor(0)
      .setAlpha(0);
    this._warnBanner = t;
    this.tweens.add({ targets: t, alpha: 1, duration: 180 });
    this._warnTimer = this.time.delayedCall(3000, () => {
      this.tweens.add({ targets: t, alpha: 0, duration: 400, onComplete: () => { t.destroy(); this._warnBanner = null; this._warnTimer = null; this._warnActive = false; this._warnActiveItem = null; this._warnLast = null; this._pumpWarnings(); } });
    });
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

    fix(this.add.rectangle(0, 0, GAME_W, 56, 0x10141c, 0.96).setOrigin(0, 0).setDepth(39));
    fix(this.add.rectangle(0, 56, GAME_W, 2, 0x000000, 0.6).setOrigin(0, 0).setDepth(39));
    const gfx = fix(this.add.graphics().setDepth(42));
    this.chips = {};

    // A chip = bg rect + icon (image or drawn shape) + value + label.
    const chip = (key, x, y, w, labelTxt, imgKey, draw) => {
      const bg = fix(this.add.rectangle(x, y, w, 25, 0x1c2330, 0.92).setOrigin(0, 0).setDepth(40).setStrokeStyle(1, 0x39455a, 0.9));
      const cx = x + 12, cy = y + 12;
      if (imgKey) fix(this.add.image(cx, cy, imgKey).setDisplaySize(18, 18).setDepth(42));
      else if (draw) draw(gfx, cx, cy);
      const value = fix(this.add.text(x + 23, y + 3, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', fontStyle: 'bold' }).setDepth(42));
      const label = fix(this.add.text(x + 23, y + 15, labelTxt, { fontFamily: 'monospace', fontSize: '8px', color: '#8893a3' }).setDepth(42));
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
    // Row 1 — economy.
    chip('wood', 6, 2, 86, 'WOOD', 'icon_wood'); chip('stone', 96, 2, 86, 'STONE', null, I.stone);
    chip('food', 186, 2, 86, 'FOOD', 'icon_food'); chip('gold', 276, 2, 86, 'GOLD', 'icon_gold');
    chip('iron', 366, 2, 86, 'IRON', null, I.iron);
    // Row 2 — military / time.
    chip('equipment', 6, 29, 86, 'EQUIP', null, I.equip);
    chip('workers', 96, 29, 104, 'WORKERS', null, I.workers);
    chip('soldiers', 204, 29, 104, 'SOLDIERS', null, I.soldiers);
    chip('day', 312, 29, 70, 'DAY', null, I.day);
    chip('season', 386, 29, 160, 'SEASON', null, null);
    this.seasonIcon = fix(this.add.ellipse(398, 41, 11, 11, 0x66cc66).setDepth(42));
    this.chips.season.value.setX(410);
    this.chips.season.label.setX(410);
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
        ch.bg.setFillStyle(val > prev ? 0x1e3a24 : 0x3a1e22, 0.95);
        this.time.delayedCall(300, () => { if (!ch._crit) ch.bg.setFillStyle(0x1c2330, 0.92); });
      }
      this._chipPrev[key] = val;
    };
    set('wood', Math.floor(r.wood)); set('stone', Math.floor(r.stone)); set('food', Math.floor(r.food));
    set('gold', Math.floor(r.gold)); set('iron', Math.floor(r.iron || 0)); set('equipment', Math.floor(r.equipment || 0));
    this.chips.workers.value.setText(`${this.buildings.workersUsed()}/${r.workersCap}`);
    const deployed = this.expeditions && this.expeditions.deployedSoldiers ? this.expeditions.deployedSoldiers() : 0; // (Bug 5) count expedition soldiers
    this.chips.soldiers.value.setText(`${this.troops.count + deployed}/${this.soldierCap()}`);
    this.chips.day.value.setText(`${this.gameDay}`);
    this.chips.season.value.setText(this.seasonHint(this.gameDay));
    if (this.seasonIcon) this.seasonIcon.setFillStyle(this.seasonColor(this.gameDay));
    this.critChip('food', r.food < 20);
    this.critChip('soldiers', this.troops.count === 0);
  }

  critChip(key, on) {
    const ch = this.chips[key]; if (!ch) return;
    if (on && !ch._crit) { ch._crit = true; ch.bg.setFillStyle(0x4a1e1e, 0.92); ch._critTween = this.tweens.add({ targets: ch.bg, alpha: { from: 0.92, to: 0.4 }, yoyo: true, repeat: -1, duration: 600 }); }
    else if (!on && ch._crit) { ch._crit = false; if (ch._critTween) ch._critTween.stop(); ch.bg.setAlpha(0.92).setFillStyle(0x1c2330, 0.92); }
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
    const a = Phaser.Utils.Array.GetRandom(pool);
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
    else this.renderDefaultPanel();
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
    this.panel.add(this.add.rectangle(4, this.PANEL_Y + 4, GAME_W - 8, PANEL_H - 8, 0x111c18, 0.96).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.7).setScrollFactor(0));
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
    this.spriteButton(GAME_W - 180, this.PANEL_Y + PANEL_H - 36, 168, 28, 'Form New Army', '', list.length < m.maxPlayerArmies, () => { this._armyFormSpec = { warrior: 0, archer: 0, monk: 0, knight: 0, mercenary: 0 }; this.panelMode = 'armyform'; this.refreshPanel(); }, { active: true });
  }

  renderArmyForm() {
    this.panel.add(this.add.rectangle(4, this.PANEL_Y + 4, GAME_W - 8, PANEL_H - 8, 0x111c18, 0.96).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.7).setScrollFactor(0));
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
    // (Gameplay change 2) Move + Demolish actions on every building but the Castle.
    if (b.typeKey !== 'castle') this.addBuildingActionButtons(b);
  }

  addBuildingActionButtons(b) {
    const x = GAME_W - 128, w = 120;
    this.diploButton(x, this.PANEL_Y + 10, w, 28, 'Move', 'free', 0x1f5b3a, 0x2e7d50, true, () => this.startMoveBuilding(b));
    this.diploButton(x, this.PANEL_Y + 42, w, 28, 'Demolish', '+50% refund', 0x5c1a1a, 0x8a2a2a, true, () => this.confirmDemolish(b));
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
    this.panel.add(this.add.rectangle(8, this.PANEL_Y + 8, GAME_W - 16, PANEL_H - 16, 0x241a0e, 0.95).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.7).setScrollFactor(0));
    this.panelText(20, this.PANEL_Y + 12, `Market  ·  ${b.workers > 0 ? 'open' : 'needs a worker'}`, { bold: true, color: '#ffe9b0', size: '16px' });
    this.workerControls(b, 20, this.PANEL_Y + 36);
    const trades = [
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
      const mult = (this.traitBonuses ? this.traitBonuses.marketMult : 1) + (this.reputation ? this.reputation.marketBonus() : 0) + ((this._researchMarketMult || 1) - 1);
      this.spriteButton(x, this.PANEL_Y + 30, 132, 40, label.split(' → ')[0] + '→', label.split(' → ')[1], can, () => {
        this.resources.spend(give); for (const [r, v] of Object.entries(get)) this.resources.add(r, Math.round(v * mult)); if (this.reputation) this.reputation.add('merchant', 3); this.refreshPanel();
      });
      x += 136;
    }
    this.spriteButton(GAME_W - 92, this.PANEL_Y + 88, 80, 30, 'Close', '', true, () => { this.selectedBuilding = null; this.clearSelection(); this.refreshPanel(); });
  }

  renderTavernPanel(b) {
    this.panel.add(this.add.rectangle(8, this.PANEL_Y + 8, 440, PANEL_H - 16, 0x241a0e, 0.95).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.7).setScrollFactor(0));
    this.panelText(20, this.PANEL_Y + 12, 'Tavern', { bold: true, color: '#ffe9b0', size: '18px' });
    this.panelText(20, this.PANEL_Y + 40, '+10 starting morale in battle while built.', { color: '#cfe0ff', size: '12px' });
    this.panelText(20, this.PANEL_Y + 60, b._recruitCd > 0 ? `Recruit ready in ${b._recruitCd} day(s)` : 'A mercenary is available to recruit.', { color: '#cfc1a6', size: '12px' });
    this.workerControls(b, 20, this.PANEL_Y + 80);
    const can = b.workers > 0 && (!b._recruitCd || b._recruitCd <= 0) && this.resources.gold >= 50;
    this.spriteButton(456, this.PANEL_Y + 30, 220, 52, 'Recruit Mercenary', '50 gold', can, () => { this.resources.spend({ gold: 50 }); this.troops.spawnMercenary(); b._recruitCd = 3; this.refreshPanel(); }, { gold: can });
    this.spriteButton(GAME_W - 120, this.PANEL_Y + 30, 104, 52, 'Close', '', true, () => { this.selectedBuilding = null; this.clearSelection(); this.refreshPanel(); });
  }

  // (Phase 5) Expeditions now return only special rewards; durations in days.
  renderExpeditionPanel() {
    this.panel.add(
      this.add.rectangle(4, this.PANEL_Y + 4, GAME_W - 8, PANEL_H - 8, 0x241a0e, 0.96).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.7).setScrollFactor(0)
    );
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
    this.panel.add(this.add.rectangle(4, this.PANEL_Y + 4, GAME_W - 8, PANEL_H - 8, 0x241a0e, 0.96).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.7).setScrollFactor(0));
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
    this.panel.add(
      this.add.rectangle(4, this.PANEL_Y + 4, GAME_W - 8, PANEL_H - 8, 0x241a0e, 0.96).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.7).setScrollFactor(0)
    );
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
    this._inBattle = true;
    try { SaveManager.save(this, 0); } catch (e) {} // (Save system) auto-save before BattleScene
    const enemyArmy = this.enemyArmyFrom(enemies);
    for (const e of enemies) e.destroy();
    this.troops.removeAll();
    this.deselectAllUnits();
    this.scene.launch('BattleScene', {
      playerArmy, enemyArmy, terrainType: this.battleTerrain(), enemyFaction: faction,
      context, playerDefending: !!(context && context.defending), taverMoraleBonus: this.hasTavern && this.hasTavern(),
      onComplete: (res) => this.onBattleComplete(res),
    });
    this.scene.pause();
    return true;
  }

  onBattleComplete(res) {
    this._inBattle = false;
    this.scene.resume();
    if (res && res.victory) { this._lastBattleWonDay = this.gameDay; this._battlesWon = (this._battlesWon || 0) + 1; } else this._lastBattleLostDay = this.gameDay; // (Phase 5) happiness; (Audit FIX 2) battle tally
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
    if (army.faction === 'player') {
      const t = army.attackTarget; army.attackTarget = null;
      if (!t) return;
      if (t.kind === 'settlement' && t.ref.owner === 'neutral') this.resolveSettlementAttack(army, t.ref);
      else if (t.kind === 'aicastle' && t.ref.castleAlive) this.resolveAICastleAttack(army, t.ref);
      else if (t.kind === 'army' && this.armyMgr.armies.includes(t.ref)) this.startArmyBattle(army, t.ref.units, { faction: t.ref.faction, enemyArmyRef: t.ref });
    } else {
      this.aiArmyAttacksPlayer(army);
    }
  }

  // Two opposing armies within 2 tiles → battle (interception in the wilderness).
  armiesOnInterceptCheck() {
    if (this._inBattle) return;
    const players = this.armyMgr.playerArmies();
    for (const ai of this.armyMgr.aiArmies()) {
      // 30-tile approach warning (once per AI army).
      const c = this.buildings.castle;
      if (c && !ai._warned && Phaser.Math.Distance.Between(ai.col, ai.row, c.col, c.row) <= 30) {
        ai._warned = true;
        this.threatWarning(`${ai.name} spotted! Approaching (~${this.armyMgr.etaDays(ai).toFixed(1)} days)`, 0xff8a80, true);
        this.logEvent(`${ai.name} is marching on your kingdom`, 'red');
      }
      for (const pa of players) {
        if (Phaser.Math.Distance.Between(ai.col, ai.row, pa.col, pa.row) <= 2) {
          this.startArmyBattle(pa, ai.units, { faction: ai.faction, enemyArmyRef: ai });
          return;
        }
      }
    }
  }

  startArmyBattle(playerArmy, enemyUnits, ctx) {
    if (this._inBattle) return;
    this._inBattle = true;
    try { SaveManager.save(this, 0); } catch (e) {}
    this._battleArmy = playerArmy;
    this.scene.launch('BattleScene', {
      playerArmy: playerArmy.units.map((u) => ({ type: u.type, count: u.count })),
      enemyArmy: enemyUnits.map((u) => ({ type: u.type, count: u.count })),
      terrainType: this.battleTerrain(), enemyFaction: ctx.faction || 'red',
      context: ctx, playerDefending: !!ctx.defending,
      onComplete: (res) => this.onArmyBattleComplete(playerArmy, res, ctx),
    });
    this.scene.pause();
  }

  onArmyBattleComplete(army, res, ctx) {
    this._inBattle = false; this.scene.resume();
    this.armyMgr.setUnitsFromBattle(army, res.army);
    if (res && res.victory) {
      this._lastBattleWonDay = this.gameDay;
      this._battlesWon = (this._battlesWon || 0) + 1; // (Audit FIX 2) battle tally
      this.armyMgr.addMorale(army, 15);
      if (res.loot) { this.resources.add('gold', res.loot.gold || 0); if (res.loot.iron) this.resources.add('iron', res.loot.iron); }
      if (this.reputation) this.reputation.add('conqueror', 10);
      if (ctx.kind === 'settlement' && ctx.ref) { for (const g of ctx.ref.guards) { g.alive = false; if (g.destroy) g.destroy(); } ctx.ref.guards = []; if (ctx.ref.owner === 'neutral') ctx.ref.conquer(); this.armyMgr.addMorale(army, 10); if (this.reputation) this.reputation.add('conqueror', 15); this.logEvent(`Conquered ${ctx.ref.name}`, 'green'); }
      if (ctx.kind === 'aicastle' && ctx.ref) { ctx.ref.regrouping = true; ctx.ref.rebuildTimer = 5 * this.DAY_SECONDS; this.logEvent(`Defeated ${ctx.ref.cfg.name}'s army`, 'green'); }
      if (ctx.enemyArmyRef && this.armyMgr.armies.includes(ctx.enemyArmyRef)) { this.armyMgr.removeArmy(ctx.enemyArmyRef); if (ctx.faction) { const k = this.kingdoms.find((x) => x.cfg.key === ctx.faction); if (k) { k.regrouping = true; k.rebuildTimer = 5 * this.DAY_SECONDS; } } }
      this.threatWarning('Your army was victorious!', 0x7cfc7c, true);
    } else {
      this._lastBattleLostDay = this.gameDay;
      this.armyMgr.addMorale(army, -25);
      const c = this.buildings.castle;
      if (c) this.armyMgr.marchTo(army, c.col + 2, c.row + 2, { returning: true });
      this.threatWarning('Your army was defeated.', 0xff6b6b, true);
    }
    if (this.armyMgr.totalUnits(army) === 0) this.armyMgr.disband(army);
    this.refreshPanel();
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

  // (Phase 2) AI launches a marching army from its castle toward the player.
  spawnAIArmyAttack(kingdom, unitCounts) {
    const a = this.armyMgr.spawnAIArmy(kingdom.cfg.key, kingdom.castleCol, kingdom.castleRow, unitCounts, `${kingdom.cfg.name} army`);
    if (a) { const c = this.buildings.castle; this.armyMgr.marchTo(a, c.col, c.row, { attackTarget: { kind: 'player' } }); }
    if (this.onKingdomAttack) this.onKingdomAttack(kingdom);
  }

  // AI army reached the player castle → defend with the home garrison (unassigned troops).
  aiArmyAttacksPlayer(aiArmy) {
    if (this._inBattle) return;
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
  }

  // Total estimated AI strength (used by the scouting intel reveal).
  armyEstimate() {
    return (this.kingdoms || []).reduce((s, k) => s + (k.castleAlive ? k.estimatedArmy() : 0), 0);
  }

  // (UI overhaul Phase 5) Persistent tabs on the top edge of the bottom panel
  // replace the old top-right openers: [Build][Expeditions][Kingdoms][Caravans].
  createKingdomsButton() {
    const fix = (o) => o.setScrollFactor(0);
    const defs = [['Build', 'build', 0x3a2f1a], ['Armies', 'armies', 0x2d5a4a], ['Expeditions', 'expedition', 0x1f4f33], ['Kingdoms', 'kingdoms', 0x432863], ['Caravans', 'caravans', 0x2d4a6b], ['Research', 'research', 0x2a3a5a]];
    this.panelTabs = [];
    const ty = this.PANEL_Y - 26, h = 26, w = 94, gap = 3;
    defs.forEach((t, i) => {
      const x = 8 + i * (w + gap);
      const bg = fix(this.add.rectangle(x, ty, w, h, t[2]).setOrigin(0, 0).setDepth(40).setStrokeStyle(2, 0xc9a14a, 0.5).setInteractive({ useHandCursor: true }));
      const txt = fix(this.add.text(x + w / 2, ty + h / 2, t[0], { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(41));
      bg.on('pointerover', () => { if (!this.tabActive(t[1])) bg.setFillStyle(0x5a4a2a); });
      bg.on('pointerout', () => this.highlightTabs());
      bg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.onTabClick(t[1]); });
      this.panelTabs.push({ mode: t[1], bg, txt, base: t[2] });
    });
    this.highlightTabs();
  }

  tabActive(mode) {
    if (mode === 'build') return !['expedition', 'artifacts', 'kingdoms', 'caravans', 'armies', 'armyform', 'research'].includes(this.panelMode) || !!this.selectedBuilding;
    if (mode === 'expedition') return this.panelMode === 'expedition' || this.panelMode === 'artifacts';
    if (mode === 'armies') return this.panelMode === 'armies' || this.panelMode === 'armyform';
    return this.panelMode === mode && !this.selectedBuilding;
  }

  highlightTabs() {
    if (!this.panelTabs) return;
    const caravanOk = this.caravans && this.caravans.sites().length >= 2;
    const researchOk = this.research && this.research.hasLibrary();
    for (const t of this.panelTabs) {
      const on = this.tabActive(t.mode);
      const dim = (t.mode === 'caravans' && !caravanOk) || (t.mode === 'research' && !researchOk);
      t.bg.setFillStyle(on ? 0xc9a14a : t.base, dim ? 0.5 : 1);
      t.txt.setColor(on ? '#1a140c' : dim ? '#8a8f99' : '#ffffff');
      t.bg.setStrokeStyle(2, 0xc9a14a, on ? 1 : 0.45);
    }
  }

  onTabClick(mode) {
    sfx.play('ui_click'); // (Polish Phase 2)
    this.selectedBuilding = null; this.clearSelection(); this.placementType = null; this.clearGhost(); this.hideTip();
    if (mode === 'caravans' && !(this.caravans && this.caravans.sites().length >= 2)) { this.showToast('Conquer a settlement first (need 2+ sites)'); return; }
    if (mode === 'research' && !(this.research && this.research.hasLibrary())) { this.showToast('Build a Library to research'); return; }
    this.panelMode = mode;
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
    this.panel.add(
      this.add.rectangle(4, this.PANEL_Y + 4, GAME_W - 8, PANEL_H - 8, 0x16101f, 0.96).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.7).setScrollFactor(0)
    );
    const scouted = this.intelActive();
    this.panelText(14, this.PANEL_Y + 6, `AI KINGDOMS — DIPLOMACY${scouted ? '   (scouted)' : ''}`, { bold: true, color: '#ffe9b0' });
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
        const reps = [['Conqueror', 'conqueror', 0xc0392b], ['Merchant', 'merchant', 0xf1c40f], ['Protector', 'protector', 0x3498db], ['Destroyer', 'destroyer', 0x8e44ad]];
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
      // Identity — kingdom name 16px bold white (Bug 7).
      this.panel.add(this.add.rectangle(16, y + 8, 16, 16, k.cfg.color).setOrigin(0, 0).setStrokeStyle(1, 0x000000, 0.6).setScrollFactor(0));
      this.panelText(40, y + 1, k.cfg.name, { bold: true, color: '#ffffff', size: '16px' });
      const n = k.estimatedArmy();
      const army = k.castleAlive ? `${scouted ? '' : '~'}${n} ${n === 1 ? 'Warrior' : 'Warriors'}` : 'defeated';
      this.panelText(40, y + 20, army, { color: '#b9c6d6', size: '11px' });
      // Status label — 14px bold, coloured (Bug 7).
      const rel = this.diplomacy ? this.diplomacy.get(key) : 0;
      const relStatus = this.diplomacy ? this.diplomacy.status(key) : 'Neutral';
      this.panelText(196, y + 9, relStatus, { color: this.diploColor(relStatus), size: '14px', bold: true });
      // Relationship bar: centre tick at neutral, red (hostile) / green (friendly).
      const bx = 330, bw = 150, cx = bx + bw / 2, barY = y + 20;
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
      // Slot 3 — break treaty if any active, else declare war.
      if (hasTreaty) {
        this.diploButton(702, y + 1, 116, 32, 'Break', '→ -10 rel', 0x5c4a1a, 0x8a722a, true, () => this.diplomacy.breakTreaty(key));
      } else {
        this.diploButton(702, y + 1, 116, 32, 'War', '→ -100 rel', 0x5c1a1a, 0x8a2a2a, !!this.diplomacy, () => this.diplomacy.declareWar(key));
      }
    });
    this.spriteButton(GAME_W - 84, this.PANEL_Y + 4, 76, 20, 'Back', '', true, () => { this.panelMode = 'build'; this.refreshPanel(); });
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
      this.commandUnits(target.castleX + 30, target.castleY, true, target);
      this.floatText(target.castleX, target.castleY - 30, 'Attack!', '#ff8a80');
      if (this.diplomacy && !target._playerAttacked) { target._playerAttacked = true; this.time.delayedCall(5000, () => (target._playerAttacked = false)); this.diplomacy.onPlayerAttack(target.cfg.key); }
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
  commandUnits(tx, ty, attackAI, castle) {
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

  // ---- Day / night cycle + day counter (new) -------------------------------

  createDayNightOverlay() {
    this.dnOverlay = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x0a1430, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(35);
    // (Phase 8) Subtle seasonal cast over the world (below the night overlay).
    this.seasonOverlay = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(34);
    // (Polish Phase 3) Sky bodies — stars, sun, moon — drawn above the overlay.
    this._stars = [];
    // (Audit FIX 7) More, brighter stars for a clearer night sky.
    for (let i = 0; i < 40; i++) this._stars.push({ x: Phaser.Math.Between(16, GAME_W - 16), y: Phaser.Math.Between(58, Math.round(GAME_H * 0.42)), r: Phaser.Math.FloatBetween(0.9, 2.4), ph: Math.random() * 6.28 });
    this.skyG = this.add.graphics().setScrollFactor(0).setDepth(36);
    this.updateSeason();
  }

  // (Polish Phase 3) Smooth atmosphere colour + darkness across the full day:
  // dawn (warm) → day (clear) → dusk (orange-purple) → night (deep navy).
  atmosphereAt(phase) {
    const KF = [
      [0.00, 0xff8a4a, 0.32], // dawn — warm orange-pink
      [0.10, 0xfff2d8, 0.00], // morning — clear
      [0.58, 0xfff2d8, 0.00], // day — clear
      [0.70, 0xffa64a, 0.15], // late afternoon — warming
      [0.80, 0x5a3f80, 0.36], // dusk — orange-purple (Audit FIX 7: darker)
      [0.88, 0x060e24, 0.60], // night onset — deep navy (Audit FIX 7: noticeably darker)
      [1.00, 0x060e24, 0.64], // deep night
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
    const map = {
      'Early Spring': [0x66ff88, 0.0], 'Late Spring': [0x66ff88, 0.0],
      Summer: [0xffd070, 0.07], 'Early Autumn': [0xd07a20, 0.09], 'Late Autumn': [0xc06010, 0.11], Winter: [0xbcd6f0, 0.20], // (Audit FIX 7) stronger white-blue winter cast
    };
    const [col, a] = map[s] || [0x000000, 0];
    this.seasonOverlay.fillColor = col;
    this.tweens.add({ targets: this.seasonOverlay, alpha: a, duration: 800 });
  }

  // ---- (Polish Phase 4) Seasonal weather: snow in Winter, rain in Spring/Autumn

  createWeather() {
    if (!this.textures.exists('wx_snow')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xffffff, 1); g.fillCircle(4, 4, 3); g.generateTexture('wx_snow', 8, 8); g.destroy();
    }
    if (!this.textures.exists('wx_rain')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xbfd4ec, 1); g.fillRect(0, 0, 2, 10); g.generateTexture('wx_rain', 2, 10); g.destroy();
    }
    // Screen-fixed emitters above the world but below the HUD; both start idle.
    // (Audit FIX 7) Denser, slightly larger snow for a clearly visible winter.
    this.snowEmitter = this.add.particles(0, 0, 'wx_snow', {
      x: { min: -20, max: GAME_W + 20 }, y: -12, lifespan: 6500,
      speedY: { min: 25, max: 55 }, speedX: { min: -18, max: 18 },
      scale: { min: 0.6, max: 1.5 }, alpha: { start: 0.95, end: 0.55 },
      quantity: 3, frequency: 70, maxParticles: 250,
    }).setScrollFactor(0).setDepth(38);
    this.rainEmitter = this.add.particles(0, 0, 'wx_rain', {
      x: { min: -40, max: GAME_W + 120 }, y: -12, lifespan: 1500,
      speedY: { min: 380, max: 470 }, speedX: { min: -130, max: -90 },
      scale: { min: 0.7, max: 1.0 }, alpha: { start: 0.5, end: 0.18 }, rotate: -16,
      quantity: 3, frequency: 35, maxParticles: 200,
    }).setScrollFactor(0).setDepth(38);
    this.snowEmitter.stop(); this.rainEmitter.stop();
    this.snowEmitter.setAlpha(0); this.rainEmitter.setAlpha(0);
    this._weather = 'clear';
  }

  weatherForSeason(season) {
    if (season === 'Winter') return 'snow';
    if (season.indexOf('Spring') >= 0 || season.indexOf('Autumn') >= 0) return 'rain';
    return 'clear';
  }

  updateWeather() {
    const want = this.weatherForSeason(this.seasonHint(this.gameDay));
    if (want === this._weather) return;
    this._weather = want;
    const fadeOut = (em) => { if (!em) return; this.tweens.add({ targets: em, alpha: 0, duration: 1200, onComplete: () => em.stop() }); };
    const fadeIn = (em) => { if (!em) return; em.start(); this.tweens.add({ targets: em, alpha: 1, duration: 1500 }); };
    if (want === 'snow') { fadeOut(this.rainEmitter); fadeIn(this.snowEmitter); sfx.stopAmbient('rain'); sfx.startAmbient('wind', 'wind', 0.16); } // (Audit FIX 7) louder winter wind
    else if (want === 'rain') { fadeOut(this.snowEmitter); fadeIn(this.rainEmitter); sfx.stopAmbient('wind'); sfx.startAmbient('rain', 'rain'); }
    else { fadeOut(this.snowEmitter); fadeOut(this.rainEmitter); sfx.stopAmbient('wind'); sfx.stopAmbient('rain'); }
    this.updateSnowCaps(want === 'snow');
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
    this.dayTimer += gdelta;
    if (this.dayTimer >= DAY_MS) {
      this.dayTimer -= DAY_MS;
      this.gameDay += 1;
      const eat = Math.round(this.troops.dailyUpkeep() * (this._seasonFoodUpkeepMult || 1) * (this.traitBonuses ? this.traitBonuses.foodMult : 1)); // (Phase 3 season + Phase 4 Warlord)
      this.resources.food = Math.max(0, this.resources.food - eat);
      this.onNewDay(eat);
    }
    const phase = this.dayTimer / DAY_MS;
    const atmo = this.atmosphereAt(phase);
    if (this.dnOverlay) { this.dnOverlay.fillColor = atmo.color; this.dnOverlay.setAlpha(atmo.alpha); }
    // Night-ness (stars/moon) spans dusk→dawn; torch-ness starts a little earlier.
    let night = phase >= 0.85 ? (phase - 0.85) / 0.10 : phase < 0.08 ? 1 - phase / 0.08 : 0;
    let torch = phase >= 0.78 ? (phase - 0.78) / 0.07 : phase < 0.10 ? 1 - phase / 0.10 : 0;
    night = Phaser.Math.Clamp(night, 0, 1);
    torch = Phaser.Math.Clamp(torch, 0, 1);
    this._nightness = night;
    this.drawSkyBodies(phase, night);
    this.updateTorches(torch, gdelta);
    if (this.hud && this.hud.day) this.hud.day.setText(`Day ${this.gameDay}`);
  }

  // Stars (twinkling), an arcing sun (east→west by day), and a night moon.
  drawSkyBodies(phase, night) {
    const g = this.skyG; if (!g) return;
    g.clear();
    if (night > 0.02) {
      for (const s of this._stars) {
        const tw = 0.7 + 0.3 * Math.sin(this.time.now * 0.004 + s.ph);
        // (Audit FIX 7) faint halo + brighter core so stars read clearly.
        g.fillStyle(0xbcd0ff, night * tw * 0.35);
        g.fillCircle(s.x, s.y, s.r + 1.4);
        g.fillStyle(0xffffff, night * tw);
        g.fillCircle(s.x, s.y, s.r);
      }
    }
    const sunA = Phaser.Math.Clamp(1 - night * 1.4, 0, 1);
    if (sunA > 0.02 && phase < 0.86) {
      const p = Phaser.Math.Clamp(phase / 0.85, 0, 1);
      const sx = GAME_W * (0.92 - p * 0.84), sy = 120 - Math.sin(Math.PI * p) * 72;
      g.fillStyle(0xfff3c0, sunA * 0.4); g.fillCircle(sx, sy, 20);
      g.fillStyle(0xffe07a, sunA); g.fillCircle(sx, sy, 13);
    }
    if (night > 0.05) {
      // (Audit FIX 7) Larger, brighter moon with a soft halo.
      const mx = GAME_W * 0.5, my = 78;
      g.fillStyle(0xdfe8ff, night * 0.22); g.fillCircle(mx, my, 28); // halo
      g.fillStyle(0xf2f6ff, night); g.fillCircle(mx, my, 16);
      g.fillStyle(this.atmosphereAt(phase).color, night); g.fillCircle(mx + 6, my - 4, 14); // carve crescent
    }
  }

  // (Polish Phase 3) Per-building torches: invisible by day, flickering warm at
  // night. Rendered screen-fixed ABOVE the night overlay (projected from the
  // building's world position) so they actually glow instead of being darkened.
  updateTorches(torch, gdelta) {
    this._torchFlick = (this._torchFlick || 0) + gdelta;
    const flick = this._torchFlick > 90;
    if (flick) this._torchFlick = 0;
    const cam = this.cameras.main;
    for (const b of this.buildings.buildings) {
      if (!b.alive) continue;
      if (!b._torch && torch > 0.01) this.addTorch(b);
      if (!b._torch) continue;
      if (torch <= 0.01) { b._torch.setVisible(false); continue; }
      // (Bug 1 fix) Project from the camera's actual visible top-left (worldView),
      // not scrollX/Y — those only match at zoom 1, so torches drifted on zoom.
      const view = cam.worldView;
      const sx = (b.x - view.x) * cam.zoom;
      const sy = (b._torchY - view.y) * cam.zoom;
      const on = sx > -20 && sx < GAME_W + 20 && sy > -20 && sy < GAME_H + 20;
      if (flick) b._torchF = Phaser.Math.FloatBetween(0.75, 1.0);
      b._torch.setVisible(on).setPosition(sx, sy).setScale(cam.zoom).setAlpha(torch * (b._torchF || 0.9));
    }
  }

  addTorch(b) {
    b._torchY = b.y - (14 + (b.baseScale || 1) * 34) + 8; // a little below the building's top
    b._torchF = 0.9;
    const t = this.add.container(0, 0).setScrollFactor(0).setDepth(37).setVisible(false);
    // (Audit FIX 7) Larger, brighter torch glow so night reads warmer.
    const glow = this.add.circle(0, 0, 20, 0xff7a1a, 0.7).setBlendMode(Phaser.BlendModes.ADD);
    const glow2 = this.add.circle(0, 0, 11, 0xffc24a, 0.85).setBlendMode(Phaser.BlendModes.ADD);
    const flame = this.add.ellipse(0, -2, 11, 18, 0xffb030);
    const core = this.add.ellipse(0, -1, 5.5, 11, 0xfff0b0);
    t.add([glow, glow2, flame, core]);
    b._torch = t;
  }

  onNewDay(eat) {
    sfx.play('day_start'); // (Polish Phase 2) dawn bell
    this.updateSeason();
    this.updateWeather(); // (Polish Phase 4) switch snow/rain on season change
    if (this.population) { this.population.onNewDay(); this.updatePopulationHud(); } // (Phase 5)
    if (this.armyMgr) this.armyMgr.onNewDay(); // (Expansion) army supply/morale
    if (this.worldEvents) this.worldEvents.onNewDay(); // (Expansion Phase 3) world events
    if (this.reputation) { this.reputation.onNewDay(); this.updateKingdomTitle(); } // (Phase 4)
    if (this.research) this.research.onNewDay(); // (Phase 5) research progress
    if (this.winConditions) this.winConditions.onNewDay(); // (Audit FIX 2) check victory paths
    if (this.factions) this.factions.onNewDay(); // (Session-1 Phase 2) wandering factions daily
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
    if (this.ruins) this.ruins.update(); // (Session-1 Phase 1) ruin discovery
    if (this.factions) this.factions.update(dt); // (Session-1 Phase 2) wandering factions

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
        else this.troops.spawn(b);
        finished = true;
      }
      if (finished) {
        sfx.play('unit_trained'); // (Polish Phase 2)
        b.slots = b.slots.filter((s) => s.timeLeft > 0);
        if (this.selectedBuilding === b) this.refreshPanel();
      }
    }

    for (const b of this.buildings.buildings) {
      if (!b.alive && b._floatIcon) { b._floatIcon.destroy(); b._floatIcon = null; this.hideBuildingName(b); } // (Phase 6) clean up icons of dying buildings
      if (!b.alive && b._torch) { b._torch.destroy(); b._torch = null; } // (Phase 3) clean up torches
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
