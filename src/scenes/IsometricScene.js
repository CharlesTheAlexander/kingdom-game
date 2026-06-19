/*
 * IsometricScene.js — Medieval Kingdom Builder (Phaser 3) — ISOMETRIC REBUILD
 * ===================================================================
 * Replaces GameScene as the main scene. It EXTENDS GameScene so that all of the
 * coordinate-agnostic systems and UI are reused unchanged, and only the
 * rendering / coordinate / depth layer is rewritten for an isometric world.
 *
 * SYSTEMS WIRED IN (all from src/systems, unchanged):
 *   - Resources.js .......... wood / stone / food / gold / workers / soldiers
 *   - Buildings.js .......... placement grid, worker allocation, upgrades, towers
 *   - BuildingTypes.js ...... building definitions (texture key == building key)
 *   - Pawns.js .............. worker pawns walking to resource nodes (iso space)
 *   - Troops.js ............. warriors / archers / monks (Tiny Swords overlays)
 *   - ResourceNodes.js ...... trees / gold-stone / rock / sheep harvest nodes
 *   - Expeditions.js ........ send soldiers off-map for timed resource returns
 *   - AIKingdom.js + Waves.js  red enemy faction that drives the attack waves
 *   - Pathfinding.js ........ A* enemies path around buildings (iso tiles)
 *   - AudioManager.js ....... audio roadmap placeholder
 *
 * WHAT THIS FILE OVERRIDES FOR ISOMETRIC:
 *   - Coordinates: tileTopLeft / tileCenter / screenToTile / pointerToTile using
 *       screenX = (col-row)*32, screenY = (col+row)*16  (64x64 diamond tiles).
 *   - World: 40x40 grid, center 15x15 buildable settlement zone, procedural
 *       grass + variants, forest clusters, rock formations and a river edge.
 *   - Depth sorting: every tile/object depth = (col+row) so things draw back to
 *       front (applyIsoDepths re-sorts moving units / nodes / AI every frame).
 *   - Buildings: iso art (sliced from the iso sprite sheets / tiles), multi-tile
 *       footprints (Castle 3x3, Barracks 2x2), iso diamond placement preview.
 *   - Camera: right/middle-drag pan, wheel zoom 0.5–2, clamped to the iso world.
 *   - Minimap: top-down dots of the iso world.
 *   - NEW day counter: day cycle (sky shift), food consumed once per game day,
 *       brief sunrise animation when a new day starts.
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
import { AIKingdom } from '../systems/AIKingdom.js';
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
    super('IsometricScene');
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
    this.load.image('iso_grass_dirt', `${IND}/img_8.png`);  // grass w/ dirt patch
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
    this.panelMode = 'build';

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
    this.createDayCounter();
    this.createCastleBar();
    // Lift the castle HP bar above the (now larger) iso keep.
    const cb = this.buildings.castle;
    const cy = cb.y - cb.baseScale * 48;
    this.castleBarBg.y = cy;
    this.castleBarFill.y = cy;

    this.ai = new AIKingdom(this);
    this.setupInput();
    this.setupCamera();
    this.createMinimap();
    this.refreshPanel();

    this.showWelcomePanel();
    this.time.delayedCall(900, () => this.fireHint('start', 'Assign workers to buildings to start producing resources'));
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

  // ---- World generation + rendering ---------------------------------------

  drawGrid() {
    const waterKeys = ['iso_water', 'iso_water2', 'iso_water3'];
    const forestKeys = ['iso_forest1', 'iso_forest2', 'iso_forest3', 'iso_forest4', 'iso_forest5', 'iso_forest6', 'iso_forest7', 'iso_forest8'];
    const rockKeys = ['iso_rock', 'iso_mtn'];

    const type = Array.from({ length: N }, () => Array(N).fill('grass'));

    // River running across one edge (the back / top-right edge), with a wobble.
    for (let c = 0; c < N; c++) {
      const w = Math.sin(c * 0.5) > 0.5 ? 2 : 1;
      for (let r = 0; r <= w; r++) type[r][c] = 'water';
    }

    // Forest clusters in the outer wilderness (never the centre build zone).
    for (let i = 0; i < 8; i++) {
      const cc = Phaser.Math.Between(2, N - 3);
      const cr = Phaser.Math.Between(3, N - 3);
      const rad = Phaser.Math.Between(2, 4);
      for (let r = cr - rad; r <= cr + rad; r++) {
        for (let c = cc - rad; c <= cc + rad; c++) {
          if (r < 0 || c < 0 || r >= N || c >= N || this.isBuildZone(c, r) || type[r][c] !== 'grass') continue;
          const d = Math.hypot(c - cc, r - cr);
          if (d <= rad && Math.random() < 1 - d / (rad + 1)) type[r][c] = 'forest';
        }
      }
    }

    // Rock formations scattered in the wilderness.
    for (let i = 0; i < 5; i++) {
      const cc = Phaser.Math.Between(2, N - 3);
      const cr = Phaser.Math.Between(3, N - 3);
      const rad = Phaser.Math.Between(1, 2);
      for (let r = cr - rad; r <= cr + rad; r++) {
        for (let c = cc - rad; c <= cc + rad; c++) {
          if (r < 0 || c < 0 || r >= N || c >= N || this.isBuildZone(c, r) || type[r][c] !== 'grass') continue;
          if (Math.random() < 0.55) type[r][c] = 'rock';
        }
      }
    }

    this.terrainType = type;

    // Render every tile back-to-front via depth = (col+row).
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const tl = this.tileTopLeft(c, r);
        const t = type[r][c];
        let key;
        if (t === 'water') key = Phaser.Utils.Array.GetRandom(waterKeys);
        else if (t === 'forest') key = Phaser.Utils.Array.GetRandom(forestKeys);
        else if (t === 'rock') key = Phaser.Utils.Array.GetRandom(rockKeys);
        else {
          const rnd = Math.random();
          key = rnd < 0.14 ? 'iso_grass2' : rnd < 0.18 ? 'iso_grass_dirt' : 'iso_grass';
        }
        this.add.image(tl.x, tl.y, key).setOrigin(0, 0).setDepth((c + r) * DMUL);
      }
    }
  }

  // Forest/rock tiles already carry their own props; nothing extra to scatter.
  scatterDecorations() {}

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
    b.rect.setOrigin(0.5, 0.75).setScale(scale).setAngle(0);
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

    if (this.ai) {
      for (const ab of this.ai.buildings) if (ab.sprite) ab.sprite.setDepth(D(ab.sprite.y) + 0.05);
      if (this.ai.castleSpr) {
        const d = D(this.ai.castleY);
        this.ai.castleSpr.setDepth(d + 0.05);
        if (this.ai.castleBarBg) this.ai.castleBarBg.setDepth(d + 0.09);
        if (this.ai.castleBarFill) this.ai.castleBarFill.setDepth(d + 0.1);
        if (this.ai.castleLabel) this.ai.castleLabel.setDepth(d + 0.11);
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
      this.ghostImg = this.add.image(0, 0, this.placementType).setDepth(30.5).setAlpha(0.6).setOrigin(0.5, 0.75);
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
      castle.rect.setOrigin(0.5, 0.75).setScale(castle.baseScale * next.castleScale);
      castle.rect.clearTint();
      const by = castle.y - castle.baseScale * next.castleScale * 48;
      this.castleBarBg.y = by;
      this.castleBarFill.y = by;
      this.sparkleAt(castle.x, castle.y);
    }
    if (next.wall) this.drawWall(next.wall);
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
    g.fillStyle(0xff5252, 1);
    for (const b of this.ai.buildings) {
      const t = tileOf(b.sprite.x, b.sprite.y);
      g.fillRect(toX(t.col) - 1, toY(t.row) - 1, 3, 3);
    }
    if (this.ai.castleAlive) {
      const t = tileOf(this.ai.castleX, this.ai.castleY);
      g.fillStyle(0xff1744, 1);
      g.fillRect(toX(t.col) - 2, toY(t.row) - 2, 5, 5);
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
      const eat = this.troops.count * 2; // food consumed once per game day
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
    // Brief sunrise: a warm screen flash + a sun disc rising.
    const flash = this.add.rectangle(0, 0, GAME_W, GAME_H, 0xffd27f, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(80);
    this.tweens.add({ targets: flash, alpha: { from: 0.45, to: 0 }, duration: 1400, onComplete: () => flash.destroy() });
    const sun = this.add.circle(GAME_W * 0.5, GAME_H * 0.62, 28, 0xffe9a8, 0.95).setScrollFactor(0).setDepth(81);
    this.tweens.add({ targets: sun, y: GAME_H * 0.22, alpha: 0, duration: 1700, ease: 'Sine.out', onComplete: () => sun.destroy() });
    if (c) this.floatText(c.x, c.y - 54, eat > 0 ? `Day ${this.gameDay} — Food -${eat}` : `Day ${this.gameDay}`, '#ffd27f');
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

    this.ai.update(dt);
    this.waves.update(dt);
    this.buildings.updateTowers(dt, this.waves.enemies);
    this.nodes.update(gdelta);
    this.expeditions.update(dt);

    const trainingOpen = this.selectedBuilding && this.selectedBuilding.typeKey === 'barracks' && this.selectedBuilding.slots.length > 0;
    if ((this.panelMode === 'expedition' && !this.selectedBuilding) || trainingOpen) {
      this._panelRefresh = (this._panelRefresh || 0) + dt;
      if (this._panelRefresh >= 0.5) {
        this._panelRefresh = 0;
        this.refreshPanel();
      }
    }

    this.pawns.sync(this.resources.workersCap);
    this.pawns.update(dt);
    this.troops.update(dt, this.waves.enemies);
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
  }
}
