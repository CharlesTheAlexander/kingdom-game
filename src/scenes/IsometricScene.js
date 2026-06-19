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
import { AIKingdom, FACTIONS } from '../systems/AIKingdom.js';
import { WildlifeManager } from '../systems/Wildlife.js';
import { Territory } from '../systems/Territory.js';
import { findPath } from '../systems/Pathfinding.js';
import { BuildingTypes } from '../data/BuildingTypes.js';

// ---- Isometric world constants -------------------------------------------
const N = 40;            // 40x40 tile grid
const HW = 32;           // half tile width  (screenX step = col-row * 32)
const HH = 16;           // half tile height (screenY step = col+row * 16)
const OX = 1248;         // origin offset so col-row = -39 lands at x = 0
const OY = 120;          // origin offset (headroom for back-row building tops)
const WORLD_W = 2600;    // camera world bounds
const WORLD_H = 1500;
const DMUL = 0.35;       // depth = (col+row) * DMUL, kept < 33 so the HUD stays on top
const TOP_BAR = 50;      // screen-space HUD band (matches GameScene)
const PANEL_H = 130;
const DAY_MS = 300000;   // one game day = 5 real minutes (scaled by game speed)

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

    // Center 15x15 buildable settlement zone of the 40x40 world (cols/rows 13-27).
    this.BZ = { c0: 13, c1: 27, r0: 13, r1: 27 };

    this.isGameOver = false;
    this.selectedBuilding = null;
    this.placementType = null;
    this.tickAccumulator = 0;
    this.gameSpeed = 1;
    this.selectedUnits = [];
    this.boxSel = null;
    this._prevRes = {};

    // Day cycle (new this rebuild).
    this.gameDay = 1;
    this.dayTimer = 0;

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

    this.TIERS = [
      { name: 'Village', maxBuildings: 8 },
      { name: 'Town', maxBuildings: 16, cost: { gold: 200, wood: 150, stone: 100 }, wall: 'wood', castleScale: 1.3, button: 'UPGRADE TO TOWN', announce: 'YOUR VILLAGE IS NOW A TOWN' },
      { name: 'Castle', maxBuildings: 24, cost: { gold: 500, wood: 300, stone: 400 }, wall: 'stone', castleScale: 1.6, button: 'UPGRADE TO CASTLE', announce: 'YOUR TOWN IS NOW A MIGHTY CASTLE' },
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

    this.buildings.place('castle', Math.floor(N / 2), Math.floor(N / 2));
    this.decorateBuilding(this.buildings.castle);

    this.buildHud();
    this.createIronHud(); // Phase 5: Iron readout in the resource bar
    this.createDayCounter();
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
    this.territory = new Territory(this); // Phase 4: territory + fog of war
    this.setupInput();
    this.setupCamera();
    this.createMinimap();
    this.createKingdomsButton(); // Phase 6: open the kingdom status panel
    this.wildlife.spawnInitial(); // Phase 2: wildlife present from day 1
    this.refreshPanel();

    if (this._startZoom) this.cameras.main.setZoom(Phaser.Math.Clamp(this._startZoom, 0.3, 2));
    if (this._noIntro) {
      this.time.delayedCall(900, () => this.fireHint('start', 'Assign workers to buildings to start producing resources'));
    } else {
      this.showWelcomePanel();
      this.time.delayedCall(900, () => this.fireHint('start', 'Assign workers to buildings to start producing resources'));
    }

    this.setupUICamera();
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
    super.triggerGameOver();
    this.routeCameras();
  }

  // Slice the "finished" frame out of each construction sheet into a standalone
  // texture keyed by building name (Buildings.js uses add.image(x, y, typeKey)).
  sliceBuildingTextures() {
    this.sliceFrame('village_sheet', 13, 'castle');
    this.sliceFrame('wooden_fort_sheet', 13, 'castle_town');
    this.sliceFrame('stone_fort_sheet', 13, 'castle_castle');
    this.sliceFrame('wooden_fort_sheet', 13, 'barracks');
    this.sliceFrame('wind_mill_sheet', 0, 'farm');
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

  // Multi-tile footprints (visual + occupancy). Castle 3x3, Barracks 2x2.
  footprintSize(typeKey) {
    return typeKey === 'castle' ? 3 : typeKey === 'barracks' ? 2 : 1;
  }

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
  regionAt(c, r) {
    if (c < 0 || r < 0 || c >= N || r >= N) return 'plain';
    if (this.isBuildZone(c, r)) return 'settlement';
    if (r <= 8) return c <= 8 ? 'west' : 'north';
    if (r >= 31) return c <= 8 ? 'west' : 'south';
    if (c <= 8) return 'west';
    if (c >= 31) return 'east';
    return 'plain'; // inner transition ring between the build zone and the bands
  }

  // 0..1 measure of how deep a tile sits inside its region (1 = world edge),
  // used to fade terrain density toward the centre for smooth transitions.
  regionDepth(reg, c, r) {
    if (reg === 'north') return Phaser.Math.Clamp((9 - r) / 9, 0, 1);
    if (reg === 'south') return Phaser.Math.Clamp((r - 30) / 9, 0, 1);
    if (reg === 'east') return Phaser.Math.Clamp((c - 30) / 9, 0, 1);
    if (reg === 'west') return Phaser.Math.Clamp(Math.max((9 - c) / 9, c <= 8 ? 0 : -1), 0, 1);
    return 0;
  }

  drawGrid() {
    const waterKeys = ['iso_water', 'iso_water2', 'iso_water3'];
    const forestKeys = ['iso_forest1', 'iso_forest2', 'iso_forest3', 'iso_forest4', 'iso_forest5', 'iso_forest6', 'iso_forest7', 'iso_forest8'];
    const rockKeys = ['iso_rock', 'iso_mtn'];

    const type = Array.from({ length: N }, () => Array(N).fill('grass'));
    const region = Array.from({ length: N }, () => Array(N).fill('plain'));

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const reg = this.regionAt(c, r);
        region[r][c] = reg;
        if (reg === 'settlement' || reg === 'plain') {
          // Light forest/rock bleed into the transition ring for a soft edge.
          const nf = this.regionAt(c, r - 2), sf = this.regionAt(c, r + 2);
          const wf = this.regionAt(c - 2, r), ef = this.regionAt(c + 2, r);
          if (reg === 'plain' && [nf, wf].includes('north') && Math.random() < 0.12) type[r][c] = 'forest';
          else if (reg === 'plain' && ef === 'east' && Math.random() < 0.1) type[r][c] = 'rock';
          continue;
        }
        const d = this.regionDepth(reg, c, r);
        let pForest = 0, pRock = 0;
        if (reg === 'north') { pForest = 0.3 + d * 0.62; pRock = 0.03; }
        else if (reg === 'east') { pRock = 0.28 + d * 0.55; pForest = 0.04; }
        else if (reg === 'south') { pForest = 0.05; pRock = 0.03; } // flat, open plains
        else if (reg === 'west') { pForest = 0.18; pRock = 0.12; }   // mixed
        const roll = Math.random();
        if (roll < pForest) type[r][c] = 'forest';
        else if (roll < pForest + pRock) type[r][c] = 'rock';
      }
    }

    // River: a 2-3 tile band along the bottom (south) edge with a gentle wobble.
    for (let c = 0; c < N; c++) {
      const w = 2 + (Math.sin(c * 0.45) > 0.3 ? 1 : 0);
      for (let k = 0; k < w; k++) {
        const r = N - 1 - k;
        if (!this.isBuildZone(c, r)) type[r][c] = 'water';
      }
    }

    this.terrainType = type;
    this.regionGrid = region;
    // Keep a reference to every ground tile so the Territory system can tint
    // them (territory wash / fog of war) without spawning extra overlay objects.
    this.terrainTiles = Array.from({ length: N }, () => Array(N).fill(null));

    // Render every tile back-to-front via depth = (col+row).
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const tl = this.tileTopLeft(c, r);
        const t = type[r][c];
        let key;
        if (t === 'water') key = Phaser.Utils.Array.GetRandom(waterKeys);
        else if (t === 'forest') key = Phaser.Utils.Array.GetRandom(forestKeys);
        else if (t === 'rock') key = Phaser.Utils.Array.GetRandom(rockKeys);
        else key = Math.random() < 0.16 ? 'iso_grass2' : 'iso_grass';
        this.terrainTiles[r][c] = this.add.image(tl.x, tl.y, key).setOrigin(0, 0).setDepth((c + r) * DMUL);
      }
    }
  }

  // (Phase 3) Scatter a few standalone decorative rocks in the open wilderness
  // (forest tiles already carry their own props) for visual variety.
  scatterDecorations() {
    const rockKeys = ['rock1', 'rock2', 'rock3', 'rock4'];
    let placed = 0;
    for (let a = 0; a < 120 && placed < 16; a++) {
      const c = Phaser.Math.Between(0, N - 1);
      const r = Phaser.Math.Between(0, N - 1);
      if (!this.isWilderness(c, r)) continue;
      if (this.terrainType[r][c] !== 'grass') continue;
      const reg = this.regionGrid[r][c];
      if (reg === 'north') continue; // forest fringe stays clear of loose rocks
      const ctr = this.tileCenter(c, r);
      this.add.image(ctr.x + Phaser.Math.Between(-10, 10), ctr.y + Phaser.Math.Between(-4, 8),
        Phaser.Utils.Array.GetRandom(rockKeys))
        .setOrigin(0.5, 0.7).setScale(0.5 * Phaser.Math.FloatBetween(0.8, 1.2))
        .setDepth((c + r) * DMUL + 0.03).setAlpha(0.9);
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
    // Mark the whole footprint as occupied / blocked (without spawning extra
    // buildings) so multi-tile structures reserve their iso footprint.
    b._cells = [];
    for (const cell of this.footprintCells(b.typeKey, b.col, b.row)) {
      if (cell.c < 0 || cell.r < 0 || cell.c >= this.COLS || cell.r >= this.ROWS) continue;
      if (!this.buildings.grid[cell.r][cell.c]) this.buildings.grid[cell.r][cell.c] = b;
      b._cells.push(cell);
    }

    const scale = fp === 3 ? 2.0 : fp === 2 ? 1.5 : 1.0;
    b.baseScale = scale;
    // BUG 2 FIX: anchor at the base (0.5, 1.0) so the building stands up from the
    // tile; positioned at the tile centre so its base sits on the diamond.
    b.rect.setOrigin(0.5, 1.0).setScale(scale).setAngle(0);
    b.rect.x = b.x;
    b.rect.y = b.y;
    if (b.shadow) b.shadow.setVisible(false);

    const topOff = 14 + scale * 34;
    if (b.hpBarBg) { b.hpBarBg.x = b.x; b.hpBarBg.y = b.y - topOff; }
    if (b.hpBar) { b.hpBar.x = b.x - (b.hpBarWidth || 40) / 2; b.hpBar.y = b.y - topOff; }
    if (b.levelText) b.levelText.setPosition(b.x + 18, b.y - topOff + 4);
    if (b.workerIcon) b.workerIcon.setPosition(b.x, b.y - topOff - 14);
  }

  // Re-sort everything that can move/spawn, every frame, by iso depth.
  applyIsoDepths() {
    const D = (wy) => this.worldDepth(wy);

    for (const b of this.buildings.buildings) {
      this.decorateBuilding(b);
      const f = b._fp || 1;
      const base = (b.col + b.row + (f - 1)) * DMUL;
      b.rect.setDepth(base + 0.05);
      if (b.hpBarBg) b.hpBarBg.setDepth(base + 0.07);
      if (b.hpBar) b.hpBar.setDepth(base + 0.08);
      if (b.levelText) b.levelText.setDepth(base + 0.08);
      if (b.workerIcon) b.workerIcon.setDepth(base + 0.08);
    }
    const c = this.buildings.castle;
    if (c && this.castleBarBg) {
      const base = (c.col + c.row + 2) * DMUL;
      this.castleBarBg.setDepth(base + 0.09);
      this.castleBarFill.setDepth(base + 0.1);
    }

    for (const p of this.pawns.pawns) p.spr.setDepth(D(p.spr.y) + 0.06);

    for (const u of this.troops.allUnits()) {
      u.spr.setDepth(D(u.spr.y) + 0.06);
      if (u.selRing) u.selRing.setDepth(D(u.y) + 0.07);
      if (u.label) u.label.setDepth(D(u.spr.y) + 0.09); // Mercenary tag (Phase 5)
    }

    for (const e of this.waves.enemies) {
      const s = e.rect || e.spr;
      if (!s) continue;
      const d = D(s.y);
      s.setDepth(d + 0.06);
      if (e.hpBarBg) e.hpBarBg.setDepth(d + 0.07);
      if (e.hpBarFill) e.hpBarFill.setDepth(d + 0.08);
    }

    for (const n of this.nodes.nodes) {
      if (n.spr) n.spr.setDepth(D(n.spr.y) + 0.04);
      if (n.label) n.label.setDepth(29); // always readable, above the world band
    }

    if (this.wildlife) {
      for (const w of this.wildlife.units) {
        if (!w.spr) continue;
        const d = D(w.spr.y);
        w.spr.setDepth(d + 0.06);
        if (w.hpBarBg) w.hpBarBg.setDepth(d + 0.07);
        if (w.hpBarFill) w.hpBarFill.setDepth(d + 0.08);
      }
    }

    for (const k of this.kingdoms || []) {
      for (const ab of k.buildings) if (ab.sprite) ab.sprite.setDepth(D(ab.sprite.y) + 0.05);
      if (k.castleSpr) {
        const d = D(k.castleY);
        k.castleSpr.setDepth(d + 0.05);
        if (k.castleBarBg) k.castleBarBg.setDepth(d + 0.09);
        if (k.castleBarFill) k.castleBarFill.setDepth(d + 0.1);
        if (k.castleLabel) k.castleLabel.setDepth(d + 0.11);
      }
    }
  }

  // Build with multi-tile footprint validation, then iso-decorate + place FX.
  tryBuild(typeKey, tile) {
    const cells = this.footprintCells(typeKey, tile.col, tile.row);
    for (const cell of cells) {
      if (cell.c < 0 || cell.r < 0 || cell.c >= this.COLS || cell.r >= this.ROWS || !this.isBuildZone(cell.c, cell.r)) {
        this.showToast('Can only build in the settlement zone');
        return;
      }
      if (this.buildings.isOccupied(cell.c, cell.r)) {
        this.showToast('Not enough room — needs a clear footprint');
        return;
      }
    }
    const check = this.buildings.canPlace(typeKey, this.resources, this.maxBuildings());
    if (!check.ok) {
      this.showToast(check.reason);
      return;
    }
    this.resources.spend(BuildingTypes[typeKey].cost);
    const b = this.buildings.place(typeKey, tile.col, tile.row);
    if (b) {
      this.decorateBuilding(b);
      this.placeFX(b);
      if (this.territory) this.territory.recompute(); // Phase 4: territory grows toward new builds
    }
    this.refreshPanel();
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
      if (tapped && !this.isGameOver && !this.placementType && this.selectedUnits.length > 0) {
        if (p.y >= TOP_BAR && p.y <= GAME_H - PANEL_H) this.issueMoveCommand(p.worldX, p.worldY);
      }
    });
    this.input.on('wheel', (p, over, dx, dy) => {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom - dy * 0.001, 0.5, 2));
    });
  }

  // ---- Input (left-click place / box-select; covers the whole iso world) ---

  setupInput() {
    const inBand = (p) => p.y >= TOP_BAR && p.y <= GAME_H - PANEL_H;

    const zone = this.add.zone(0, 0, WORLD_W, WORLD_H).setOrigin(0, 0).setInteractive();
    zone.on('pointerdown', (p) => {
      if (this.isGameOver || !p.leftButtonDown() || !inBand(p)) return;
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
    if (!this.placementType) { this.clearGhost(); return; }
    const inBand = p.y >= TOP_BAR && p.y <= GAME_H - PANEL_H;
    const tile = inBand ? this.pointerToTile(p.worldX, p.worldY) : null;
    if (!tile) { this.clearGhost(); return; }

    const fp = this.footprintSize(this.placementType);
    const half = Math.floor(fp / 2);
    const c0 = tile.col - half, c1 = c0 + fp - 1, r0 = tile.row - half, r1 = r0 + fp - 1;
    let valid = true;
    for (const cell of this.footprintCells(this.placementType, tile.col, tile.row)) {
      if (cell.c < 0 || cell.r < 0 || cell.c >= this.COLS || cell.r >= this.ROWS || !this.isBuildZone(cell.c, cell.r) || this.buildings.isOccupied(cell.c, cell.r)) {
        valid = false;
        break;
      }
    }

    if (!this.ghostG) {
      this.ghostG = this.add.graphics().setDepth(30);
      this.ghostImg = this.add.image(0, 0, this.placementType).setDepth(30.5).setAlpha(0.6).setOrigin(0.5, 1.0);
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

    const ctr = this.tileCenter(tile.col, tile.row);
    if (this.ghostImg.texture.key !== this.placementType) this.ghostImg.setTexture(this.placementType);
    const scale = fp === 3 ? 2.0 : fp === 2 ? 1.5 : 1.0;
    this.ghostImg.setScale(scale).setPosition(ctr.x, ctr.y).setTint(valid ? 0xffffff : 0xff6666).setVisible(true);
  }

  clearGhost() {
    if (this.ghostG) this.ghostG.setVisible(false);
    if (this.ghostImg) this.ghostImg.setVisible(false);
  }

  // ---- Selection outline (iso diamond around the footprint) ----------------

  showSelection(b) {
    this.clearSelection();
    const g = this.add.graphics().setDepth(30);
    const fp = this.footprintSize(b.typeKey);
    const half = Math.floor(fp / 2);
    const pts = this.regionDiamond(b.col - half, b.col - half + fp - 1, b.row - half, b.row - half + fp - 1);
    g.lineStyle(3, 0xffffff, 0.95);
    this.strokeDiamond(g, pts);
    g.strokePath();
    if (b.type.attack) {
      const rng = b.type.range * this.TILE;
      g.fillStyle(0x2980b9, 0.12).fillCircle(b.x, b.y, rng);
      g.lineStyle(1, 0x5dade2, 0.6).strokeCircle(b.x, b.y, rng);
    }
    this.selectGfx = g;
  }

  // ---- Settlement tiers (swap the castle to the matching iso fort) ---------

  upgradeTier() {
    if (this.tierIndex >= this.TIERS.length - 1) return;
    const next = this.TIERS[this.tierIndex + 1];
    if (!this.resources.spend(next.cost)) return;
    this.tierIndex += 1;

    const castle = this.buildings.castle;
    if (castle) {
      castle.rect.setTexture(this.tierIndex === 1 ? 'castle_town' : 'castle_castle');
      castle.rect.setOrigin(0.5, 1.0).setScale(castle.baseScale * next.castleScale);
      castle.rect.clearTint();
      const by = castle.y - castle.baseScale * next.castleScale * 48;
      this.castleBarBg.y = by;
      this.castleBarFill.y = by;
      this.sparkleAt(castle.x, castle.y);
    }
    if (next.wall) this.drawWall(next.wall);
    if (this.territory) this.territory.addTierBonus(); // Phase 4: +5 territory radius
    this.announce(next.announce);
    this.refreshPanel();
  }

  // Visual-only iso diamond wall around the build zone.
  drawWall(type) {
    if (this.wallGfx) this.wallGfx.destroy();
    const g = this.add.graphics().setDepth(28);
    const z = this.BZ;
    const pts = this.regionDiamond(z.c0, z.c1, z.r0, z.r1);
    const color = type === 'stone' ? 0x9a9a9a : 0x8b5a2b;
    const thick = type === 'stone' ? 5 : 3;
    g.lineStyle(thick, color, 0.95);
    this.strokeDiamond(g, pts);
    g.strokePath();
    this.wallGfx = g;
  }

  // ---- Enemy pathfinding in iso space --------------------------------------

  computeEnemyPath(enemy) {
    const castle = this.buildings.castle;
    if (!castle || !castle.alive) return null;
    const blocked = this.buildings.blockedGrid();
    const t = this.screenToTile(enemy.x, enemy.y);
    const col = Phaser.Math.Clamp(t.col, 0, this.COLS - 1);
    const row = Phaser.Math.Clamp(t.row, 0, this.ROWS - 1);
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

  // Top-of-screen threat banner (4s, then fades). Reused by wildlife spawns and
  // AI kingdom attacks (Phase 7). The newest warning replaces the previous one.
  threatWarning(text, color = 0xffd23f) {
    if (this._threatBanner && this._threatBanner.active) this._threatBanner.destroy();
    const hex = '#' + (color >>> 0).toString(16).padStart(6, '0');
    const t = this.add
      .text(GAME_W / 2, TOP_BAR + 110, text, { fontFamily: 'monospace', fontSize: '15px', color: hex, fontStyle: 'bold', backgroundColor: '#160d0deb', padding: { x: 14, y: 8 }, align: 'center', stroke: '#000000', strokeThickness: 3, wordWrap: { width: GAME_W - 160 } })
      .setOrigin(0.5, 0)
      .setDepth(72)
      .setScrollFactor(0);
    this._threatBanner = t;
    this.tweens.add({ targets: t, alpha: { from: 0, to: 1 }, duration: 200 });
    this.time.delayedCall(4000, () => {
      if (this._threatBanner !== t) return;
      this.tweens.add({ targets: t, alpha: 0, duration: 600, onComplete: () => { t.destroy(); if (this._threatBanner === t) this._threatBanner = null; } });
    });
  }

  // ---- Phase 5: Iron HUD + artifacts + intel + scrolls ---------------------

  // Iron readout in the resource bar (gray icon). Shifts Workers/Soldiers right
  // to make room (they were laid out by the base buildHud).
  createIronHud() {
    // Slot Iron into the empty gap between Food and Gold (the centered Day
    // counter sits over the gap further right, so keep clear of it).
    const fix = (o) => o.setScrollFactor(0);
    this.hud.ironIcon = fix(this.add.image(322, 25, 'icon_gold').setDisplaySize(20, 20).setTint(0x9aa0a6).setDepth(41));
    this.hud.iron = fix(this.add.text(336, 15, '0', { fontFamily: 'monospace', fontSize: '18px', color: '#c2c8ce', fontStyle: 'bold' }).setDepth(41));
  }

  updateHud() {
    super.updateHud();
    if (this.hud.iron) this.hud.iron.setText(`${Math.floor(this.resources.iron || 0)}`);
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
    if (this.selectedBuilding && this.selectedBuilding.alive) this.renderSelectedPanel(this.selectedBuilding);
    else if (this.panelMode === 'expedition') this.renderExpeditionPanel();
    else if (this.panelMode === 'artifacts') this.renderArtifactsPanel();
    else if (this.panelMode === 'kingdoms') this.renderKingdomsPanel();
    else this.renderDefaultPanel();
  }

  // (Phase 5) Expeditions now return only special rewards; durations in days.
  renderExpeditionPanel() {
    this.panel.add(
      this.add.rectangle(4, this.PANEL_Y + 4, GAME_W - 8, PANEL_H - 8, 0x241a0e, 0.96).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.7).setScrollFactor(0)
    );
    this.panelText(16, this.PANEL_Y + 8, `EXPEDITIONS — special rewards only.   Soldiers: ${this.troops.count}    Iron: ${Math.floor(this.resources.iron)}`, { bold: true, color: '#ffe9b0' });

    const keys = ['scout', 'raid', 'campaign'];
    const w = 296;
    const gap = 8;
    let x = 14;
    const by = this.PANEL_Y + 34;
    for (const key of keys) {
      const def = this.expeditions.defs[key];
      const st = this.expeditions.state[key];
      if (st.active) {
        this.spriteButton(x, by, w, 58, def.name, `Returns in ${this.expeditions.daysLeft(key).toFixed(1)} days`, false, null);
      } else {
        const can = this.expeditions.canSend(key);
        this.spriteButton(x, by, w, 58, `${def.name}  (${def.cost} sol · ${def.days}d)`, def.reward, can, () => this.expeditions.send(key));
      }
      x += w + gap;
    }

    this.spriteButton(GAME_W - 182, this.PANEL_Y + 6, 88, 22, `Artifacts (${this.artifacts.length})`, '', true, () => { this.panelMode = 'artifacts'; this.refreshPanel(); }, { gold: true });
    this.spriteButton(GAME_W - 88, this.PANEL_Y + 6, 78, 22, 'Back', '', true, () => { this.panelMode = 'build'; this.refreshPanel(); });
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

  // Wave banner when any kingdom launches an attack.
  onKingdomAttack(kingdom) {
    this.threatWarning(`${kingdom.cfg.name} is attacking!`, kingdom.cfg.color);
    const wt = this.hud && this.hud.wave;
    if (wt) { const x0 = wt.x; this.tweens.add({ targets: wt, x: x0 + 5, yoyo: true, repeat: 5, duration: 45, onComplete: () => (wt.x = x0) }); }
    this.fireHint('firstWave', 'Enemy attack incoming — select your warriors and right-click enemies to fight');
  }

  // Total estimated AI strength (used by the scouting intel reveal).
  armyEstimate() {
    return (this.kingdoms || []).reduce((s, k) => s + (k.castleAlive ? k.estimatedArmy() : 0), 0);
  }

  // Small HUD button (top-right) that toggles the kingdom status panel.
  createKingdomsButton() {
    const fix = (o) => o.setScrollFactor(0);
    const x = GAME_W - 238, y = TOP_BAR + 8, w = 108, h = 26;
    const btn = fix(this.add.rectangle(x, y, w, h, 0x4a2d6b).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.6).setDepth(40).setInteractive({ useHandCursor: true }));
    fix(this.add.text(x + w / 2, y + h / 2, 'Kingdoms', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(41));
    btn.on('pointerover', () => btn.setFillStyle(0x5d3a85));
    btn.on('pointerout', () => btn.setFillStyle(0x4a2d6b));
    btn.on('pointerdown', (p, lx, ly, ev) => {
      ev.stopPropagation();
      this.selectedBuilding = null;
      this.clearSelection();
      this.panelMode = this.panelMode === 'kingdoms' ? 'build' : 'kingdoms';
      this.refreshPanel();
    });
  }

  renderKingdomsPanel() {
    this.panel.add(
      this.add.rectangle(4, this.PANEL_Y + 4, GAME_W - 8, PANEL_H - 8, 0x16101f, 0.96).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.7).setScrollFactor(0)
    );
    const scouted = this.intelActive();
    this.panelText(16, this.PANEL_Y + 8, `AI KINGDOMS${scouted ? '   (scouted — army sizes revealed)' : ''}`, { bold: true, color: '#ffe9b0' });
    let y = this.PANEL_Y + 34;
    for (const k of this.kingdoms) {
      const sw = this.add.rectangle(20, y + 3, 16, 16, k.cfg.color).setOrigin(0, 0).setStrokeStyle(1, 0x000000, 0.6).setScrollFactor(0);
      this.panel.add(sw);
      const status = k.statusWord();
      const statusColor = status === 'Active' ? '#ff6b6b' : status === 'Destroyed' ? '#9aa0a6' : status === 'Building' ? '#cfe0ff' : '#9fe0a0';
      const army = k.castleAlive ? `${scouted ? '' : '~'}${k.estimatedArmy()} warriors` : '—';
      this.panelText(46, y, k.cfg.name, { bold: true, color: '#ffffff', size: '14px' });
      this.panelText(250, y, status, { color: statusColor, size: '13px' });
      this.panelText(380, y, `Army: ${army}`, { color: '#cfe0ff', size: '13px' });
      this.panelText(600, y, `attacks from day ${k.startDay}`, { color: '#cfc1a6', size: '12px' });
      y += 28;
    }
    this.spriteButton(GAME_W - 88, this.PANEL_Y + 6, 78, 22, 'Back', '', true, () => { this.panelMode = 'build'; this.refreshPanel(); });
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
    this.selectedUnits.forEach((u, i) => {
      let ox = 0, oy = 0;
      if (n > 1) {
        const ang = (i / n) * Math.PI * 2;
        const r = 12 + Math.floor(i / 8) * 18;
        ox = Math.cos(ang) * r;
        oy = Math.sin(ang) * r;
      }
      u.cmd = { x: tx + ox, y: ty + oy, attackAI, castle };
    });
  }

  // ---- Day / night cycle + day counter (new) -------------------------------

  createDayNightOverlay() {
    this.dnOverlay = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x0a1430, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(35);
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
      const eat = this.troops.dailyUpkeep(); // 2/soldier, 5/mercenary (Phase 5)
      this.resources.food = Math.max(0, this.resources.food - eat);
      this.onNewDay(eat);
    }
    const phase = this.dayTimer / DAY_MS;
    const bright = Math.sin(Math.PI * Phaser.Math.Clamp(phase, 0, 1)); // 1 at noon, 0 at dawn/dusk
    const dark = 1 - bright;
    if (this.dnOverlay) {
      this.dnOverlay.setAlpha(dark * 0.5);
      this.dnOverlay.fillColor = dark > 0.55 ? 0x0a1430 : 0x241a2e;
    }
    if (this.hud && this.hud.day) this.hud.day.setText(`Day ${this.gameDay}`);
  }

  onNewDay(eat) {
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
    if (this.troops.count > 0 && this.resources.food < 30) this.fireHint('lowFood', 'Your people are hungry — build a Farm and assign workers');
    if (this.canUpgradeTier()) this.fireHint('canUpgrade', 'Your settlement can grow — check the upgrade button');

    if (this.waveCoord.cooldown > 0) this.waveCoord.cooldown -= dt;
    for (const k of this.kingdoms) k.update(dt); // Phase 6: independent AI kingdoms
    this.reconcileEnemySpawns(); // mark new enemies (they already spawn at their castle)
    this.waves.update(dt);
    this.wildlife.update(dt); // Phase 2 wildlife threats
    // Player troops + towers fight AI enemies and wildlife with the same combat
    // code (wildlife flagged noWarriorMelee so only the player damages them).
    const threats = this.waves.enemies.concat(this.wildlife.units);
    this.buildings.updateTowers(dt, threats);
    this.nodes.update(gdelta);
    this.expeditions.update(dt);
    if (this.territory) this.territory.update(dt); // Phase 4: fog reveal around units

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

    for (const b of this.buildings.buildings) {
      if (b.typeKey !== 'barracks' || b.slots.length === 0) continue;
      const speed = b.workers >= 2 ? 1.5 : b.workers >= 1 ? 1 : 0;
      let finished = false;
      for (const slot of b.slots) slot.timeLeft -= dt * speed;
      for (const slot of b.slots.filter((s) => s.timeLeft <= 0)) {
        if (slot.type === 'archer') this.troops.spawnArcher(b);
        else if (slot.type === 'monk') this.troops.spawnMonk(b);
        else this.troops.spawn(b);
        finished = true;
      }
      if (finished) {
        b.slots = b.slots.filter((s) => s.timeLeft > 0);
        if (this.selectedBuilding === b) this.refreshPanel();
      }
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

    this.updateSelectionRings();
    this.updateHud();
    this.updateMinimap();
    this.applyIsoDepths();
    this.routeCameras(); // BUG 1: keep newly-created objects on the right camera
  }
}
