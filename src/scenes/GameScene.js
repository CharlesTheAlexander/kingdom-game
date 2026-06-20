/*
 * GameScene.js — Medieval Kingdom Builder (Phaser 3)
 * ===================================================================
 * SYSTEMS OVERVIEW (grouped by the build session / phase that added them):
 *
 *  FOUNDATION (session 1):
 *    - Resources (Resources.js): Wood / Stone / Food / Gold / Workers(pop cap)
 *      / Soldiers, with multi-resource + worker-operating building costs.
 *    - 7 building types (BuildingTypes.js / Buildings.js): Castle + House,
 *      Lumberyard, Mine, Farm, Barracks, Tower.
 *    - Settlement tiers (TIERS, upgradeTier): Village -> Town -> Castle, raising
 *      the build cap, adding a wall, scaling/tinting the castle.
 *    - Worker pawns (Pawns.js) + warrior troops (Troops.js).
 *    - Clean drawn UI (top bar w/ resource icons, panel, buttons, HP bars).
 *
 *  WORLD/STRATEGY SESSION (this round):
 *    - Phase 1 — World map (this file + ResourceNodes.js): center 12x9 build
 *      zone, darker wilderness + vignette, harvestable resource nodes (trees /
 *      gold stone / rock / sheep) that deplete + respawn; pawns walk to the
 *      matching node and carry the resource home.
 *    - Phase 2 — Expeditions (Expeditions.js): send soldiers off the right edge
 *      (Scout / Raid / Campaign) for timed resource returns.
 *    - Phase 3 — AI kingdom (AIKingdom.js): red faction on the far left that
 *      builds over time and drives the attack waves (melee + ranged archers);
 *      its 500-HP castle can be clicked to destroy, forcing a 60s rebuild.
 *    - Phase 4 — Unit variety (Troops.js): Archer (ranged) + Monk (healer)
 *      trained at the Barracks alongside the Warrior; all count as Soldiers.
 *    - Phase 5 — Game feel (this file): particle FX (place pop, explosions,
 *      dust, sparkles, float text), 30x22 scrolling map with right/middle-drag
 *      camera panning, bottom-right minimap, and a 1x/2x/3x speed control.
 *
 *  POLISH/REBALANCE SESSION (latest):
 *    - Camera: right/middle-DRAG always pans (÷zoom); right-TAP = unit move
 *      order; mouse-wheel zoom 0.5–1.5; clamped to world bounds (setupCamera).
 *    - WORKER ALLOCATION (Phase 2): workers are a manual pool. Production
 *      buildings have worker slots and produce only when staffed (workerRates
 *      by count). Selected building shows +/- worker controls; red "!"/green
 *      "✓" status icons; pawns reflect assignments. Houses give +2 cap each.
 *    - ECONOMY (Phase 3): start 80/20/60/150; soldiers cost gold+food and are
 *      capped at 5 per Barracks; food upkeep (1/soldier/10s) → desertion at 0.
 *      Barracks levels gate units/slots (Lv1 Warrior, Lv2 Archer, Lv3 Monk).
 *    - Settlement build cap shown as "Buildings: X/cap" and enforced per tier.
 *    - ONBOARDING (Phase 4): first-load welcome panel + one-time contextual hints.
 *    - Grid feel: 15% grid lines (zone only), placement ghost preview.
 *
 *  NOT YET IMPLEMENTED (deferred this session): multi-tile building footprints
 *  (Castle 3x3 / Barracks 2x2) and Phase-5 troop formations / path-around-
 *  buildings / combat-feel (attack frame, damage numbers, death fade, leash).
 *
 *  Coordinate note: GRID_W/GRID_H is the WORLD (1440x1056); GAME_W/GAME_H is the
 *  fixed VIEWPORT (960x900). All HUD is setScrollFactor(0) so it stays put while
 *  the camera pans.
 * ===================================================================
 */
import Phaser from 'phaser';
import { Resources } from '../systems/Resources.js';
import { BuildingManager } from '../systems/Buildings.js';
import { WaveManager } from '../systems/Waves.js';
import { PawnManager } from '../systems/Pawns.js';
import { TroopManager } from '../systems/Troops.js';
import { ResourceNodeManager } from '../systems/ResourceNodes.js';
import { ExpeditionManager } from '../systems/Expeditions.js';
import { AIKingdom } from '../systems/AIKingdom.js';
import { findPath } from '../systems/Pathfinding.js';
import { sfx } from '../audio/SoundEngine.js';
import { BuildingTypes, PLACEABLE, MAX_LEVEL, formatCost } from '../data/BuildingTypes.js';

const TILE = 48;
// Phase 5: the world map (30x22) is larger than the screen; a camera pans over it.
const COLS = 30;
const ROWS = 22;
const TOP_BAR = 50;
const PANEL_H = 130;
const GRID_W = COLS * TILE; // 1440 (world width)
const GRID_H = ROWS * TILE; // 1056 (world grid height)
// GAME_W/GAME_H are the fixed VIEWPORT (canvas) size — UI is anchored to this.
export const GAME_W = 960;
export const GAME_H = 900;

// Barracks unit training. All three count toward the Soldiers number.
// (Phase 3 rebalance) slower + more expensive, food now part of every cost.
const TRAIN_DEFS = {
  warrior: { label: 'Warrior', time: 30, cost: { gold: 30, food: 5 } },
  archer: { label: 'Archer', time: 40, cost: { gold: 40, food: 8 } },
  monk: { label: 'Monk', time: 50, cost: { gold: 50, food: 10, stone: 10 } },
  // (Phase 3) Knight — needs Barracks Lv2 + an operational Blacksmith + Equipment.
  knight: { label: 'Knight', time: 90, cost: { gold: 80, food: 30, equipment: 1 } },
};

export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  preload() {
    const BLUE = 'assets/Tiny Swords (Free Pack)/Buildings/Blue Buildings';
    const RED = 'assets/Tiny Swords (Free Pack)/Buildings/Red Buildings';
    const TERR = 'assets/Tiny Swords (Free Pack)/Terrain';
    const UNITS = 'assets/Tiny Swords (Free Pack)/Units';
    const RES = `${TERR}/Resources`;

    // --- Buildings (texture key == building key). Some are stand-ins since the
    //     free pack has no dedicated lumberyard/mine/farm art. ---
    this.load.image('castle', `${BLUE}/Castle.png`);
    this.load.image('house', `${BLUE}/House1.png`);
    this.load.image('farm', `${BLUE}/House2.png`);
    this.load.image('lumberyard', `${BLUE}/Archery.png`);
    this.load.image('mine', `${BLUE}/Monastery.png`);
    this.load.image('barracks', `${BLUE}/Barracks.png`);
    this.load.image('tower', `${BLUE}/Tower.png`);
    this.load.image('enemy_castle', `${RED}/Castle.png`); // AI kingdom castle (Phase 3)
    this.load.image('ai_barracks', `${RED}/Barracks.png`);
    this.load.image('ai_tower', `${RED}/Tower.png`);
    this.load.image('ai_house', `${RED}/House1.png`);

    // --- Terrain ---
    this.load.image('tileset', `${TERR}/Tileset/Tilemap_color1.png`);
    this.load.spritesheet('tree1', `${TERR}/Resources/Wood/Trees/Tree1.png`, { frameWidth: 128, frameHeight: 256 });
    this.load.spritesheet('tree2', `${TERR}/Resources/Wood/Trees/Tree2.png`, { frameWidth: 128, frameHeight: 256 });
    this.load.image('rock1', `${TERR}/Decorations/Rocks/Rock1.png`);
    this.load.image('rock2', `${TERR}/Decorations/Rocks/Rock2.png`);
    this.load.image('rock3', `${TERR}/Decorations/Rocks/Rock3.png`);
    this.load.image('rock4', `${TERR}/Decorations/Rocks/Rock4.png`);
    // Resource nodes (Phase 1 wilderness): gold-stone deposit + sheep (food).
    this.load.image('gold_stone', `${TERR}/Resources/Gold/Gold Stones/Gold Stone 1.png`);
    this.load.spritesheet('sheep_idle', `${TERR}/Resources/Meat/Sheep/Sheep_Idle.png`, { frameWidth: 128, frameHeight: 128 });
    // Particle FX (Phase 5 game feel).
    const FX = 'assets/Tiny Swords (Free Pack)/Particle FX';
    this.load.spritesheet('explosion', `${FX}/Explosion_01.png`, { frameWidth: 192, frameHeight: 192 });
    this.load.spritesheet('dust', `${FX}/Dust_01.png`, { frameWidth: 64, frameHeight: 64 });

    // --- Units (all 192x192 frames) ---
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

    // NOTE (legibility fix): the Tiny Swords paper/button/bar/banner art is
    // decorative bordered/scroll work that smears badly when stretched to UI
    // rectangles, making the HUD unreadable. We now draw panels, buttons and
    // health bars as clean solid shapes instead, and keep only the resource
    // icons below (which render crisply).

    // --- Resource icons ---
    this.load.image('icon_wood', `${RES}/Wood/Wood Resource/Wood Resource.png`);
    this.load.image('icon_gold', `${RES}/Gold/Gold Resource/Gold_Resource.png`);
    this.load.image('icon_food', `${RES}/Meat/Meat Resource/Meat Resource.png`);
  }

  create() {
    this.TILE = TILE;
    this.COLS = COLS;
    this.ROWS = ROWS;
    this.gridOriginY = TOP_BAR;
    this.PANEL_Y = GAME_H - PANEL_H; // 770 — bottom panel is screen-anchored

    // Buildable settlement zone: the center 12x9 tiles of the 30x22 world.
    // cols 9-20 (12 wide), rows 7-15 (9 tall). Everything else is wilderness.
    this.BZ = { c0: 9, c1: 20, r0: 7, r1: 15 };

    this.isGameOver = false;
    this.selectedBuilding = null;
    this.placementType = null; // building key the player is currently placing
    this.tickAccumulator = 0;
    this.gameSpeed = 1; // 1x / 2x / 3x (Phase 5)
    this.selectedUnits = []; // box-selected units (Phase 3)
    this.boxSel = null;
    this._prevRes = {}; // previous resource values for the flash effect (Phase 5)

    // Settlement tiers (Phase 2).
    this.TIERS = [
      { name: 'Village', maxBuildings: 8 },
      { name: 'Town', maxBuildings: 16, cost: { gold: 200, wood: 150, stone: 100 }, wall: 'wood', castleScale: 1.3, button: 'UPGRADE TO TOWN', announce: 'YOUR VILLAGE IS NOW A TOWN' },
      { name: 'Castle', maxBuildings: 24, cost: { gold: 500, wood: 300, stone: 400 }, wall: 'stone', castleScale: 1.6, button: 'UPGRADE TO CASTLE', announce: 'YOUR TOWN IS NOW A MIGHTY CASTLE' },
    ];
    this.tierIndex = 0;

    this.resources = new Resources();
    this.buildings = new BuildingManager(this, COLS, ROWS);
    this.waves = new WaveManager(this, 60);
    this.pawns = new PawnManager(this);
    this.troops = new TroopManager(this);
    this.nodes = new ResourceNodeManager(this);
    this.expeditions = new ExpeditionManager(this);
    this.panelMode = 'build'; // 'build' | 'expedition'

    this.createAnimations();
    this.drawGrid();
    this.scatterDecorations();
    this.nodes.spawnInitial();
    this.makeSkyGrade();
    this.makeVignette();

    this.buildings.place('castle', Math.floor(COLS / 2), Math.floor(ROWS / 2));

    this.buildHud();
    this.createCastleBar();
    this.ai = new AIKingdom(this); // Phase 3 enemy faction (drives the waves)
    this.setupInput();
    this.setupCamera();
    this.createMinimap();
    this.refreshPanel();

    // (Phase 4) First-load welcome panel; (Phase 2) follow-up worker tooltip.
    this.showWelcomePanel();
    this.time.delayedCall(900, () => this.fireHint('start', 'Assign workers to buildings to start producing resources'));
  }

  // ---- Camera (Phase 5): pan over the larger-than-screen map ---------------

  setupCamera() {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, GRID_W, this.gridOriginY + GRID_H); // clamps panning to the world
    const c = this.buildings.castle;
    cam.centerOn(c.x, c.y); // start centered on the player castle
    this._rightDrag = null;

    this.input.mouse.disableContextMenu();

    // Right/middle drag ALWAYS pans (divided by zoom so it feels consistent).
    this.input.on('pointermove', (p) => {
      if (p.rightButtonDown() || p.middleButtonDown()) {
        if (this._rightDrag && (Math.abs(p.x - this._rightDrag.sx) > 4 || Math.abs(p.y - this._rightDrag.sy) > 4)) {
          this._rightDrag.moved = true;
        }
        cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
        cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      }
    });

    // Track the right press so we can tell a pan-drag from a move-order click.
    this.input.on('pointerdown', (p) => {
      if (p.rightButtonDown()) this._rightDrag = { sx: p.x, sy: p.y, moved: false };
    });
    this.input.on('pointerup', (p) => {
      // A right-click WITHOUT a drag, with units selected, is a move order.
      const tapped = this._rightDrag && !this._rightDrag.moved;
      this._rightDrag = null;
      if (tapped && !this.isGameOver && !this.placementType && this.selectedUnits.length > 0) {
        if (p.y >= TOP_BAR && p.y <= GAME_H - PANEL_H) this.issueMoveCommand(p.worldX, p.worldY);
      }
    });

    // Mouse wheel = zoom (0.5–1.5), always available.
    this.input.on('wheel', (p, over, dx, dy) => {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom - dy * 0.001, 0.5, 1.5));
    });
  }

  // ---- World ---------------------------------------------------------------

  drawGrid() {
    this.textures.get('tileset').add('grass', 0, 55, 55, 64, 64);
    // Ground covers the whole world (scrolls with the camera).
    this.add.tileSprite(0, 0, GRID_W, this.gridOriginY + GRID_H, 'tileset', 'grass').setOrigin(0, 0).setDepth(-1);

    const z = this.BZ;

    // (Phase 4) Subtle per-tile brightness variation (~±5%) so the ground does
    // not read as a flat colour sheet.
    const variation = this.add.graphics().setDepth(-0.5);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const b = Phaser.Math.FloatBetween(-0.06, 0.06);
        variation.fillStyle(b >= 0 ? 0xffffff : 0x000000, Math.abs(b));
        variation.fillRect(c * TILE, this.gridOriginY + r * TILE, TILE, TILE);
      }
    }

    // (Phase 4) Wilderness tint, feathered near the build zone so the boundary
    // fades softly instead of a hard rectangular edge.
    const wild = this.add.graphics().setDepth(0);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.isBuildZone(c, r)) continue;
        const dist = Math.max(z.c0 - c, c - z.c1, z.r0 - r, r - z.r1, 0);
        const alpha = dist <= 1 ? 0.12 : dist === 2 ? 0.26 : 0.4;
        wild.fillStyle(0x123018, alpha);
        wild.fillRect(c * TILE, this.gridOriginY + r * TILE, TILE, TILE);
      }
    }

    // Very subtle grid lines (15% max), only inside the buildable zone; the
    // wilderness has none (Phase 3 grid-feel).
    const g = this.add.graphics().setDepth(0);
    g.lineStyle(1, 0x000000, 0.15);
    for (let r = z.r0; r <= z.r1; r++) {
      for (let c = z.c0; c <= z.c1; c++) {
        g.strokeRect(c * TILE, this.gridOriginY + r * TILE, TILE, TILE);
      }
    }
  }

  // The center settlement zone is buildable; everything else is wilderness.
  isBuildZone(col, row) {
    const z = this.BZ;
    return col >= z.c0 && col <= z.c1 && row >= z.r0 && row <= z.r1;
  }

  isWilderness(col, row) {
    return col >= 0 && row >= 0 && col < COLS && row < ROWS && !this.isBuildZone(col, row);
  }

  // (Phase 5) Subtle daylight grade: a soft blue-green vertical gradient over
  // the viewport, lighter/bluer at the top. Screen-fixed, very low alpha.
  makeSkyGrade() {
    const w = GAME_W;
    const h = GAME_H;
    if (!this.textures.exists('skygrade')) {
      const tex = this.textures.createCanvas('skygrade', w, h);
      const ctx = tex.getContext();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(150,200,210,0.16)');
      grad.addColorStop(0.5, 'rgba(120,170,160,0.07)');
      grad.addColorStop(1, 'rgba(30,60,45,0.10)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      tex.refresh();
    }
    this.add.image(0, 0, 'skygrade').setOrigin(0, 0).setDepth(33).setScrollFactor(0);
  }

  // Radial vignette darkening the map edges (drawn once into a canvas texture).
  makeVignette() {
    // Screen-fixed vignette over the viewport (darkens the visible edges).
    const w = GAME_W;
    const h = GAME_H;
    if (!this.textures.exists('vignette')) {
      const tex = this.textures.createCanvas('vignette', w, h);
      const ctx = tex.getContext();
      const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.4, w / 2, h / 2, Math.max(w, h) * 0.62);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      tex.refresh();
    }
    this.add.image(0, 0, 'vignette').setOrigin(0, 0).setDepth(34).setScrollFactor(0);
  }

  createAnimations() {
    const mk = (key, end, rate) => {
      if (this.anims.exists(key)) return;
      this.anims.create({ key, frames: this.anims.generateFrameNumbers(key, { start: 0, end }), frameRate: rate, repeat: -1 });
    };
    mk('warrior_idle', 7, 8); // red enemy
    mk('pawn_idle', 7, 8);
    mk('pawn_run', 5, 10);
    mk('pawn_run_wood', 5, 10);
    mk('pawn_run_gold', 5, 10);
    mk('pawn_run_meat', 5, 10);
    mk('blue_warrior_idle', 7, 8);
    mk('blue_warrior_run', 5, 10);
    mk('red_warrior_run', 5, 10);
    mk('red_archer_idle', 5, 8); // sheet has 6 frames (0-5); 7 logged "frame not found" warnings
    mk('blue_archer_idle', 5, 8);
    mk('monk_idle', 5, 7);
    mk('sheep_idle', 5, 6); // food resource node (6 frames)
    // One-shot effects (play once then the sprite is destroyed).
    const once = (key, end, rate) => {
      if (!this.anims.exists(key)) this.anims.create({ key, frames: this.anims.generateFrameNumbers(key, { start: 0, end }), frameRate: rate, repeat: 0 });
    };
    once('heal_effect', 10, 20);
    once('explosion', 7, 18);
    once('dust', 7, 16);
  }

  // A few non-interactive decorations in the wilderness (the harvestable
  // resource nodes are added separately by ResourceNodeManager).
  scatterDecorations() {
    const used = new Set();
    const pickTile = () => {
      for (let a = 0; a < 30; a++) {
        const c = Phaser.Math.Between(0, COLS - 1);
        const r = Phaser.Math.Between(0, ROWS - 1);
        const key = `${c},${r}`;
        if (this.isWilderness(c, r) && !used.has(key)) {
          used.add(key);
          return this.tileCenter(c, r);
        }
      }
      return null;
    };
    // (Phase 4) Random size variation so the environment feels natural.
    for (let i = 0; i < 7; i++) {
      const p = pickTile();
      if (!p) continue;
      const key = Phaser.Math.RND.pick(['tree1', 'tree2']);
      this.add.image(p.x + Phaser.Math.Between(-10, 10), p.y + Phaser.Math.Between(-6, 10), key, 0).setOrigin(0.5, 0.8).setScale(0.28 * Phaser.Math.FloatBetween(0.85, 1.15)).setDepth(2).setAlpha(0.85);
    }
    for (let i = 0; i < 5; i++) {
      const p = pickTile();
      if (!p) continue;
      const key = Phaser.Math.RND.pick(['rock1', 'rock2', 'rock3', 'rock4']);
      this.add.image(p.x + Phaser.Math.Between(-12, 12), p.y + Phaser.Math.Between(-8, 8), key).setOrigin(0.5, 0.6).setScale(0.6 * Phaser.Math.FloatBetween(0.85, 1.15)).setDepth(1).setAlpha(0.85);
    }
  }

  tileCenter(col, row) {
    return { x: col * TILE + TILE / 2, y: this.gridOriginY + row * TILE + TILE / 2 };
  }

  pointerToTile(px, py) {
    const col = Math.floor(px / TILE);
    const row = Math.floor((py - this.gridOriginY) / TILE);
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return null;
    return { col, row };
  }

  // ---- Enemy support -------------------------------------------------------

  edgeSpawnPoint(edge) {
    switch (edge) {
      case 0: return { x: Phaser.Math.Between(TILE, GRID_W - TILE), y: this.gridOriginY - 18 };
      case 1: return { x: GRID_W + 18, y: Phaser.Math.Between(this.gridOriginY + TILE, this.PANEL_Y - TILE) };
      case 2: return { x: Phaser.Math.Between(TILE, GRID_W - TILE), y: this.PANEL_Y + 18 };
      default: return { x: -18, y: Phaser.Math.Between(this.gridOriginY + TILE, this.PANEL_Y - TILE) };
    }
  }

  computeEnemyPath(enemy) {
    const castle = this.buildings.castle;
    if (!castle || !castle.alive) return null;
    const blocked = this.buildings.blockedGrid();
    const col = Phaser.Math.Clamp(Math.floor(enemy.x / TILE), 0, COLS - 1);
    const row = Phaser.Math.Clamp(Math.floor((enemy.y - this.gridOriginY) / TILE), 0, ROWS - 1);
    const path = findPath(blocked, { col, row }, { col: castle.col, row: castle.row });
    if (!path) return null;
    return path.slice(1).map((t) => this.tileCenter(t.col, t.row));
  }

  spawnShot(x1, y1, x2, y2) {
    const g = this.add.graphics().setDepth(9);
    g.lineStyle(2, 0xffe066, 1).lineBetween(x1, y1, x2, y2);
    this.tweens.add({ targets: g, alpha: 0, duration: 180, onComplete: () => g.destroy() });
  }

  // ---- Phase 5 visual feedback ---------------------------------------------

  explosionAt(x, y) {
    const e = this.add.sprite(x, y, 'explosion', 0).setScale(0.5).setDepth(20);
    if (this.anims.exists('explosion')) {
      e.play('explosion');
      e.once('animationcomplete', () => e.destroy());
    } else {
      this.time.delayedCall(400, () => e.destroy());
    }
  }

  dustAt(x, y) {
    const d = this.add.sprite(x, y, 'dust', 0).setScale(0.8).setDepth(8);
    if (this.anims.exists('dust')) {
      d.play('dust');
      d.once('animationcomplete', () => d.destroy());
    } else {
      this.time.delayedCall(300, () => d.destroy());
    }
  }

  // Brief star burst around a point (tier upgrades).
  sparkleAt(x, y) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const star = this.add.star(x, y, 5, 3, 7, 0xffe066).setDepth(91);
      this.tweens.add({
        targets: star,
        x: x + Math.cos(a) * Phaser.Math.Between(50, 110),
        y: y + Math.sin(a) * Phaser.Math.Between(50, 110),
        alpha: 0,
        scale: 0.2,
        duration: 900,
        ease: 'Cubic.out',
        onComplete: () => star.destroy(),
      });
    }
  }

  // White flash + scale pop when a building is placed.
  placeFX(b) {
    this.tweens.add({ targets: b.rect, scale: { from: b.baseScale * 1.4, to: b.baseScale }, duration: 220, ease: 'Back.out' });
    const flash = this.add.rectangle(b.x, b.y, 48, 48, 0xffffff, 0.7).setDepth(6);
    this.tweens.add({ targets: flash, alpha: 0, duration: 260, onComplete: () => flash.destroy() });
  }

  // Small yellow arrow projectile (AI archers, Phase 3).
  spawnArrow(x1, y1, x2, y2) {
    const arrow = this.add.rectangle(x1, y1, 8, 3, 0xffe066).setDepth(9).setRotation(Math.atan2(y2 - y1, x2 - x1));
    this.tweens.add({ targets: arrow, x: x2, y: y2, duration: 220, onComplete: () => arrow.destroy() });
  }

  onWaveStart(n) {
    const t = this.add
      .text(GAME_W / 2, 140, `WAVE ${n}!`, { fontFamily: 'monospace', fontSize: '40px', color: '#ff5555', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(50)
      .setScrollFactor(0);
    this.tweens.add({ targets: t, alpha: 0, y: t.y - 30, duration: 1400, onComplete: () => t.destroy() });
    this.fireHint('firstWave', 'Enemy attack incoming — select your warriors and right-click enemies to fight');
    // (Phase 5) shake the wave counter so the player notices the new wave.
    const wt = this.hud && this.hud.wave;
    if (wt) {
      const baseX = wt.x;
      this.tweens.add({ targets: wt, x: baseX + 5, yoyo: true, repeat: 5, duration: 45, onComplete: () => (wt.x = baseX) });
    }
  }

  // Barracks finished training a soldier -> spawn a visible warrior (Phase 4).
  onSoldierProduced(barracks) {
    this.troops.spawn(barracks);
  }

  // ---- Input ---------------------------------------------------------------

  setupInput() {
    const inBand = (p) => p.y >= TOP_BAR && p.y <= GAME_H - PANEL_H;

    // World zone: left-click on empty ground places a building (in place mode)
    // or begins a unit box-select drag.
    const zone = this.add.zone(0, this.gridOriginY, GRID_W, GRID_H).setOrigin(0, 0).setInteractive();
    zone.on('pointerdown', (p) => {
      if (this.isGameOver || !p.leftButtonDown() || !inBand(p)) return;
      if (this.placementType) {
        const tile = this.pointerToTile(p.worldX, p.worldY);
        if (tile && !this.buildings.isOccupied(tile.col, tile.row)) this.tryBuild(this.placementType, tile);
        return; // box-select disabled while placing
      }
      this.boxSel = { sx: p.worldX, sy: p.worldY, active: true };
    });

    // Drag → draw the selection rectangle.
    this.input.on('pointermove', (p) => {
      if (this.boxSel && this.boxSel.active && p.leftButtonDown()) this.drawBoxSelect(p.worldX, p.worldY);
    });

    // Release → finalize selection, or (tiny drag = click) deselect.
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
    // (Bug 1) Right-click move orders are handled in setupCamera() so that
    // right-DRAG always pans and a right-TAP issues the move command.

    // (Phase 3) Placement ghost: a translucent preview sprite + soft glow.
    this.input.on('pointermove', (p) => this.updatePlacementGhost(p));
  }

  updatePlacementGhost(p) {
    if (!this.placementType) {
      this.clearGhost();
      return;
    }
    const inBand = p.y >= TOP_BAR && p.y <= GAME_H - PANEL_H;
    const tile = inBand ? this.pointerToTile(p.worldX, p.worldY) : null;
    if (!tile) {
      this.clearGhost();
      return;
    }
    const { x, y } = this.tileCenter(tile.col, tile.row);
    const valid = this.isBuildZone(tile.col, tile.row) && !this.buildings.isOccupied(tile.col, tile.row);
    if (!this.ghost) {
      this.ghostGlow = this.add.ellipse(x, y + 14, 50, 22, 0x66ff88, 0.3).setDepth(32);
      this.ghost = this.add.image(x, y, this.placementType).setDepth(33).setAlpha(0.55);
    }
    if (this.ghost.texture.key !== this.placementType) this.ghost.setTexture(this.placementType);
    const src = this.ghost.texture.getSourceImage();
    this.ghost.setScale(46 / Math.max(src.width, src.height)).setPosition(x, y).setTint(valid ? 0xffffff : 0xff6666).setVisible(true);
    this.ghostGlow.setPosition(x, y + 14).setFillStyle(valid ? 0x66ff88 : 0xff6666, 0.3).setVisible(true);
  }

  clearGhost() {
    if (this.ghost) this.ghost.setVisible(false);
    if (this.ghostGlow) this.ghostGlow.setVisible(false);
  }

  // ---- Box-select + unit commands (Phase 3) --------------------------------

  drawBoxSelect(wx, wy) {
    if (!this.boxRect) this.boxRect = this.add.graphics().setDepth(36); // world-space
    const a = this.boxSel;
    const x = Math.min(a.sx, wx);
    const y = Math.min(a.sy, wy);
    this.boxRect.clear();
    this.boxRect.fillStyle(0x3399ff, 0.18).fillRect(x, y, Math.abs(wx - a.sx), Math.abs(wy - a.sy));
    this.boxRect.lineStyle(1.5, 0x66bbff, 0.9).strokeRect(x, y, Math.abs(wx - a.sx), Math.abs(wy - a.sy));
  }

  selectUnitsInBox(x1, y1, x2, y2) {
    const xa = Math.min(x1, x2);
    const xb = Math.max(x1, x2);
    const ya = Math.min(y1, y2);
    const yb = Math.max(y1, y2);
    this.selectUnits(this.troops.allUnits().filter((u) => u.x >= xa && u.x <= xb && u.y >= ya && u.y <= yb));
  }

  selectUnits(list) {
    this.deselectAllUnits();
    if (list && list.length) sfx.play('unit_select'); // (Polish Phase 2)
    this.selectedUnits = list;
    for (const u of list) {
      const ring = this.add.ellipse(u.x, u.y + 12, 24, 11, 0x2ecc71, 0.35).setDepth(6).setStrokeStyle(2, 0x2ecc71, 0.9);
      this.tweens.add({ targets: ring, scaleX: 1.3, scaleY: 1.3, alpha: 0.15, yoyo: true, repeat: -1, duration: 600 });
      u.selRing = ring;
    }
    this.updateSelBadge();
  }

  deselectAllUnits() {
    for (const u of this.selectedUnits) {
      if (u.selRing) {
        u.selRing.destroy();
        u.selRing = null;
      }
      u.playerCommanded = false; // (Bug 8) deselecting releases the hold → resume auto-defense
    }
    this.selectedUnits = [];
    this.updateSelBadge();
  }

  updateSelBadge() {
    if (!this.selBadge) return;
    const n = this.selectedUnits.length;
    this.selBadge.setText(n > 0 ? `${n} unit${n > 1 ? 's' : ''} selected` : '').setVisible(n > 0);
  }

  // Keep selection rings on their units and drop rings for the fallen.
  updateSelectionRings() {
    if (this.selectedUnits.length === 0) return;
    let changed = false;
    for (const u of this.selectedUnits) {
      if (!u.alive) {
        if (u.selRing) {
          u.selRing.destroy();
          u.selRing = null;
        }
        changed = true;
      } else if (u.selRing) {
        u.selRing.x = u.x;
        u.selRing.y = u.y + 12;
      }
    }
    if (changed) {
      this.selectedUnits = this.selectedUnits.filter((u) => u.alive);
      this.updateSelBadge();
    }
  }

  issueMoveCommand(wx, wy) {
    // Right-click the AI castle → march to attack it.
    if (this.ai.castleAlive && Phaser.Math.Distance.Between(wx, wy, this.ai.castleX, this.ai.castleY) < this.TILE * 1.2) {
      this.commandUnits(this.ai.castleX + 30, this.ai.castleY, true);
      this.floatText(this.ai.castleX, this.ai.castleY - 30, 'Attack!', '#ff8a80');
      return;
    }
    // Right-click a resource node → gather there.
    let node = null;
    let nd = Infinity;
    for (const n of this.nodes.nodes) {
      if (!n.alive) continue;
      const d = Phaser.Math.Distance.Between(wx, wy, n.x, n.y);
      if (d < this.TILE && d < nd) {
        nd = d;
        node = n;
      }
    }
    const tx = node ? node.x : wx;
    const ty = node ? node.y : wy;
    this.commandUnits(tx, ty, false);
    this.floatText(tx, ty, 'Move', '#aee9ff');
  }

  // Spread units slightly around the target so they don't stack on one pixel.
  commandUnits(tx, ty, attackAI) {
    const n = this.selectedUnits.length;
    this.selectedUnits.forEach((u, i) => {
      let ox = 0;
      let oy = 0;
      if (n > 1) {
        const ang = (i / n) * Math.PI * 2;
        const r = 12 + Math.floor(i / 8) * 18;
        ox = Math.cos(ang) * r;
        oy = Math.sin(ang) * r;
      }
      u.cmd = { x: tx + ox, y: ty + oy, attackAI };
    });
  }

  selectBuilding(b) {
    if (this.isGameOver) return;
    sfx.play('building_select'); // (Polish Phase 2)
    this.placementType = null;
    this.clearGhost();
    this.selectedBuilding = b;
    this.showSelection(b);
    this.refreshPanel();
  }

  showSelection(b) {
    this.clearSelection();
    const g = this.add.graphics().setDepth(4);
    g.lineStyle(3, 0xffffff, 0.9).strokeRect(b.x - 24, b.y - 24, 48, 48);
    if (b.type.attack) {
      const rng = b.type.range * TILE;
      g.fillStyle(0x2980b9, 0.12).fillCircle(b.x, b.y, rng);
      g.lineStyle(1, 0x5dade2, 0.6).strokeCircle(b.x, b.y, rng);
    }
    this.selectGfx = g;
  }

  clearSelection() {
    if (this.selectGfx) {
      this.selectGfx.destroy();
      this.selectGfx = null;
    }
  }

  // ---- Settlement tiers (Phase 2) ------------------------------------------

  maxBuildings() {
    return this.TIERS[this.tierIndex].maxBuildings;
  }

  canUpgradeTier() {
    return this.tierIndex < this.TIERS.length - 1 && this.resources.canAfford(this.TIERS[this.tierIndex + 1].cost);
  }

  upgradeTier() {
    if (this.tierIndex >= this.TIERS.length - 1) return;
    const next = this.TIERS[this.tierIndex + 1];
    if (!this.resources.spend(next.cost)) return;
    this.tierIndex += 1;

    const castle = this.buildings.castle;
    if (castle) {
      castle.rect.setScale(castle.baseScale * next.castleScale);
      castle.rect.setTint(0xffe6a0); // gold tint signals the upgrade
      const by = castle.y - 38 * next.castleScale;
      this.castleBarBg.y = by;
      this.castleBarFill.y = by;
    }
    if (next.wall) this.drawWall(next.wall);
    if (castle) this.sparkleAt(castle.x, castle.y); // Phase 5 celebration burst
    this.announce(next.announce);
    this.refreshPanel();
  }

  // Visual-only wall around the buildable area.
  drawWall(type) {
    if (this.wallGfx) this.wallGfx.destroy();
    const g = this.add.graphics().setDepth(3);
    const thick = type === 'stone' ? 12 : 6;
    const color = type === 'stone' ? 0x9a9a9a : 0x8b5a2b;
    const z = this.BZ;
    const pad = thick / 2 + 4;
    const x = z.c0 * TILE - pad;
    const y = this.gridOriginY + z.r0 * TILE - pad;
    const w = (z.c1 - z.c0 + 1) * TILE + pad * 2;
    const h = (z.r1 - z.r0 + 1) * TILE + pad * 2;
    g.lineStyle(thick, color, 1).strokeRect(x, y, w, h);
    this.wallGfx = g;
  }

  announce(text) {
    // Audit fix: clear any in-flight announcement so two close-together upgrades
    // don't overlap into garbled text / doubled white flashes.
    if (this._announceLabel && this._announceLabel.active) this._announceLabel.destroy();
    const flash = this.add.rectangle(0, 0, GAME_W, GAME_H, 0xffffff, 1).setOrigin(0, 0).setDepth(90).setScrollFactor(0);
    this.tweens.add({ targets: flash, alpha: 0, duration: 450, onComplete: () => flash.destroy() });
    const label = this.add
      .text(GAME_W / 2, GAME_H / 2, text, { fontFamily: 'monospace', fontSize: '40px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 6, align: 'center', wordWrap: { width: GAME_W - 120 } })
      .setOrigin(0.5)
      .setDepth(91)
      .setScrollFactor(0);
    this._announceLabel = label;
    this.time.delayedCall(3000, () => {
      if (!label.active) return;
      this.tweens.add({ targets: label, alpha: 0, duration: 500, onComplete: () => label.destroy() });
    });
  }

  // ---- HUD (Phase 5) -------------------------------------------------------

  buildHud() {
    this.hud = {};
    // Every HUD element is screen-anchored (scrollFactor 0) so it stays put
    // while the camera pans over the world (Phase 5).
    const fix = (o) => o.setScrollFactor(0);
    fix(this.add.rectangle(0, 0, GAME_W, TOP_BAR, 0x12161f, 0.92).setOrigin(0, 0).setDepth(40));
    fix(this.add.rectangle(0, TOP_BAR, GAME_W, 2, 0x000000, 0.6).setOrigin(0, 0).setDepth(40));

    const num = (x, color) => fix(this.add.text(x, 15, '', { fontFamily: 'monospace', fontSize: '18px', color, fontStyle: 'bold' }).setDepth(41));
    const icon = (x, key) => fix(this.add.image(x, 25, key).setDisplaySize(26, 26).setDepth(41));

    // Icon refs are stored so IsometricScene can re-lay the bar into two rows.
    this.hud.woodIcon = icon(24, 'icon_wood');
    this.hud.wood = num(40, '#e3c27a');
    this.hud.stone = num(118, '#cfd3d6');
    this.hud.foodIcon = icon(252, 'icon_food');
    this.hud.food = num(268, '#8fd14f');
    this.hud.goldIcon = icon(380, 'icon_gold');
    this.hud.gold = num(396, '#ffd23f');
    this.hud.workers = num(500, '#62d0f0');
    this.hud.soldiers = num(700, '#ffffff');

    this.hud.tier = fix(this.add.text(GAME_W - 14, 14, '', { fontFamily: 'monospace', fontSize: '17px', color: '#ffd700', fontStyle: 'bold' }).setOrigin(1, 0).setDepth(41));

    fix(this.add.rectangle(GAME_W - 120, TOP_BAR + 8, 110, 48, 0x12161f, 0.9).setOrigin(0, 0).setStrokeStyle(2, 0x000000, 0.5).setDepth(40));
    this.hud.wave = fix(this.add.text(GAME_W - 65, TOP_BAR + 14, '', { fontFamily: 'monospace', fontSize: '17px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(41));
    this.hud.waveTime = fix(this.add.text(GAME_W - 65, TOP_BAR + 37, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ffe066' }).setOrigin(0.5).setDepth(41));

    this.hud.aiStatus = fix(this.add.text(12, TOP_BAR + 8, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ff8a80', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 }).setDepth(41));
    // (Phase 3) Low-food warning, just under the AI status (top-left).
    this.hud.foodWarn = fix(this.add.text(12, TOP_BAR + 28, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ffd23f', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 }).setDepth(41)).setVisible(false);

    // Speed control (Phase 5): cycles 1x / 2x / 3x.
    const speedBtn = fix(this.add.rectangle(GAME_W - 120, TOP_BAR + 62, 110, 26, 0x2d6cb0).setOrigin(0, 0).setStrokeStyle(2, 0xf0e6c8, 0.7).setDepth(40).setInteractive({ useHandCursor: true }));
    this.hud.speed = fix(this.add.text(GAME_W - 65, TOP_BAR + 75, 'Speed 1x', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(41));
    speedBtn.on('pointerover', () => speedBtn.setFillStyle(0x3d83cf));
    speedBtn.on('pointerout', () => speedBtn.setFillStyle(0x2d6cb0));
    speedBtn.on('pointerdown', (p, lx, ly, ev) => {
      ev.stopPropagation();
      this.gameSpeed = this.gameSpeed >= 3 ? 1 : this.gameSpeed + 1;
      this.hud.speed.setText(`Speed ${this.gameSpeed}x`);
    });

    // Bottom panel: solid dark panel + dynamic content container.
    fix(this.add.rectangle(0, this.PANEL_Y, GAME_W, PANEL_H, 0x171009, 0.97).setOrigin(0, 0).setDepth(37));
    fix(this.add.rectangle(0, this.PANEL_Y, GAME_W, 3, 0x000000, 0.6).setOrigin(0, 0).setDepth(38));
    this.panel = this.add.container(0, 0).setDepth(42).setScrollFactor(0);

    // Selected-units badge (bottom-left, above the panel) — Phase 3.
    this.selBadge = fix(
      this.add.text(12, this.PANEL_Y - 26, '', { fontFamily: 'monospace', fontSize: '14px', color: '#aee9ff', fontStyle: 'bold', backgroundColor: '#000000aa', padding: { x: 8, y: 4 } }).setDepth(45)
    ).setVisible(false);

    this.updateHud();
  }

  // Minimap (Phase 5): bottom-right, fixed to the screen. Redrawn each frame.
  createMinimap() {
    // (FIX 5) Smaller minimap (120x80) tucked into the bottom-right corner.
    this.MM = { x: GAME_W - 132, y: this.PANEL_Y - 92, w: 120, h: 80 };
    const m = this.MM;
    this.add.rectangle(m.x - 2, m.y - 2, m.w + 4, m.h + 4, 0x000000, 0.7).setOrigin(0, 0).setDepth(44).setScrollFactor(0).setStrokeStyle(2, 0xc9a14a, 0.7);
    const bg = this.add.rectangle(m.x, m.y, m.w, m.h, 0x12281a, 0.92).setOrigin(0, 0).setDepth(44).setScrollFactor(0).setInteractive();
    bg.on('pointerdown', (p, lx, ly, ev) => ev.stopPropagation()); // swallow clicks
    this.minimapGfx = this.add.graphics().setDepth(45).setScrollFactor(0);
  }

  updateMinimap() {
    const g = this.minimapGfx;
    if (!g) return;
    const m = this.MM;
    const sx = m.w / GRID_W;
    const sy = m.h / GRID_H;
    const toX = (wx) => m.x + wx * sx;
    const toY = (wy) => m.y + (wy - this.gridOriginY) * sy;
    g.clear();
    g.fillStyle(0x4caf50, 1);
    for (const n of this.nodes.nodes) if (n.alive) g.fillRect(toX(n.x) - 1, toY(n.y) - 1, 2, 2);
    g.fillStyle(0xff5252, 1);
    for (const b of this.ai.buildings) g.fillRect(toX(b.sprite.x) - 1, toY(b.sprite.y) - 1, 3, 3);
    if (this.ai.castleAlive) {
      g.fillStyle(0xff1744, 1);
      g.fillRect(toX(this.ai.castleX) - 2, toY(this.ai.castleY) - 2, 5, 5);
    }
    g.fillStyle(0x42a5f5, 1);
    for (const b of this.buildings.buildings) {
      if (b.typeKey === 'castle') continue;
      g.fillRect(toX(b.x) - 1, toY(b.y) - 1, 3, 3);
    }
    const c = this.buildings.castle;
    if (c) {
      g.fillStyle(0x00e5ff, 1);
      g.fillRect(toX(c.x) - 2, toY(c.y) - 2, 5, 5);
    }
    // Camera viewport outline, clamped to the minimap rect.
    const v = this.cameras.main.worldView;
    const rx = Phaser.Math.Clamp(toX(v.x), m.x, m.x + m.w);
    const ry = Phaser.Math.Clamp(toY(v.y), m.y, m.y + m.h);
    const rx2 = Phaser.Math.Clamp(toX(v.x + v.width), m.x, m.x + m.w);
    const ry2 = Phaser.Math.Clamp(toY(v.y + v.height), m.y, m.y + m.h);
    g.lineStyle(1, 0xffffff, 0.9).strokeRect(rx, ry, rx2 - rx, ry2 - ry);
  }

  createCastleBar() {
    const c = this.buildings.castle;
    // Hide the castle's small rectangle bar in favour of a bigger, clearer one.
    c.hpBar.setVisible(false);
    c.hpBarBg.setVisible(false);
    this.castleBarW = 60;
    this.castleBarBg = this.add.rectangle(c.x, c.y - 38, this.castleBarW + 4, 10, 0x000000, 0.75).setDepth(11).setStrokeStyle(1, 0x000000, 0.8);
    this.castleBarFill = this.add.rectangle(c.x - this.castleBarW / 2, c.y - 38, this.castleBarW, 7, 0x2ecc71).setOrigin(0, 0.5).setDepth(12);
  }

  // (Phase 5) Set a resource readout and flash it green/red on a meaningful
  // change (small steady income is ignored so it doesn't strobe).
  flashRes(key, base, val, text) {
    const t = this.hud[key];
    t.setText(text);
    const prev = this._prevRes[key];
    if (prev !== undefined && Math.abs(val - prev) >= 4) {
      t.setColor(val > prev ? '#7CFC7C' : '#ff6b6b');
      this.tweens.add({ targets: t, scale: 1.28, yoyo: true, duration: 150 });
      this.time.delayedCall(240, () => t.setColor(base));
    }
    this._prevRes[key] = val;
  }

  updateHud() {
    const r = this.resources;
    this.flashRes('wood', '#e3c27a', Math.floor(r.wood), `${Math.floor(r.wood)}`);
    this.flashRes('stone', '#cfd3d6', Math.floor(r.stone), `Stone ${Math.floor(r.stone)}`);
    this.flashRes('food', '#8fd14f', Math.floor(r.food), `${Math.floor(r.food)}`);
    this.flashRes('gold', '#ffd23f', Math.floor(r.gold), `${Math.floor(r.gold)}`);
    this.hud.workers.setText(`Workers ${this.buildings.workersUsed()}/${r.workersCap}`);
    this.hud.soldiers.setText(`Soldiers ${this.troops.count}/${this.soldierCap()}`);
    this.hud.tier.setText(this.TIERS[this.tierIndex].name.toUpperCase());
    // (Phase 3) Low-food / desertion warning.
    if (this.hud.foodWarn) {
      const warn = this.troops.count > 0 && r.food < 20;
      this.hud.foodWarn.setText(r.food <= 0 ? '⚠ No food — soldiers deserting!' : '⚠ Low food — soldiers deserting soon').setVisible(warn);
    }
    if (this.ai) {
      this.hud.wave.setText(`W ${this.ai.waveNumber}`);
      this.hud.waveTime.setText(!this.ai.castleAlive ? 'down' : this.ai.regrouping ? `${Math.max(0, Math.ceil(this.ai.waveTimer))}s` : 'NOW');
      this.hud.aiStatus.setText(this.ai.status());
    }

    const c = this.buildings.castle;
    if (c && this.castleBarFill) {
      const pct = Phaser.Math.Clamp(c.hp / c.maxHp, 0, 1);
      this.castleBarFill.width = this.castleBarW * pct;
      this.castleBarFill.fillColor = pct > 0.5 ? 0x2ecc71 : pct > 0.25 ? 0xf1c40f : 0xe74c3c;
    }
  }

  // ---- Bottom panel --------------------------------------------------------

  refreshPanel() {
    this.panel.removeAll(true);
    if (this.selectedBuilding && this.selectedBuilding.alive) {
      this.renderSelectedPanel(this.selectedBuilding);
    } else if (this.panelMode === 'expedition') {
      this.renderExpeditionPanel();
    } else {
      this.renderDefaultPanel();
    }
  }

  panelText(x, y, text, opts = {}) {
    const t = this.add.text(x, y, text, {
      fontFamily: 'monospace',
      fontSize: opts.size || '14px',
      color: opts.color || '#ffffff',
      fontStyle: opts.bold ? 'bold' : 'normal',
      wordWrap: opts.wrap ? { width: opts.wrap } : undefined,
    });
    this.panel.add(t);
    return t;
  }

  // Clean drawn button (solid fill + border + crisp text) for legibility.
  spriteButton(x, y, w, h, title, subtitle, enabled, onClick, opts = {}) {
    let fill = 0x2d6cb0;
    let hover = 0x3d83cf;
    if (!enabled) {
      fill = 0x39393f;
    } else if (opts.gold) {
      fill = 0xb8860b;
      hover = 0xd4a017;
    } else if (opts.active) {
      fill = 0x2e8b57;
      hover = 0x3aa86a;
    }
    // NOTE: the panel is a scrollFactor(0) container, but a container child's
    // INPUT hit area uses the child's own scrollFactor — so the interactive bg
    // must also be scrollFactor(0), otherwise its clickable area drifts by the
    // camera scroll and the buttons stop responding once the camera pans.
    const bg = this.add
      .rectangle(x, y, w, h, fill)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setStrokeStyle(2, enabled ? 0xf0e6c8 : 0x666666, enabled ? 0.85 : 0.4);
    const t1 = this.add
      .text(x + w / 2, y + h / 2 - (subtitle ? 9 : 0), title, { fontFamily: 'monospace', fontSize: '14px', color: enabled ? '#ffffff' : '#9aa0a6', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setScrollFactor(0);
    this.panel.add([bg, t1]);
    if (subtitle) {
      const t2 = this.add
        .text(x + w / 2, y + h / 2 + 11, subtitle, { fontFamily: 'monospace', fontSize: '11px', color: enabled ? '#eaf2ff' : '#7d8389' })
        .setOrigin(0.5)
        .setScrollFactor(0);
      this.panel.add(t2);
    }
    if (enabled && onClick) {
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => bg.setFillStyle(hover));
      bg.on('pointerout', () => bg.setFillStyle(fill));
      bg.on('pointerdown', (p, lx, ly, ev) => {
        ev.stopPropagation();
        sfx.play('button_click'); // (Polish Phase 2)
        // Defer so we never rebuild/destroy this button mid input-dispatch.
        this.time.delayedCall(0, onClick);
      });
    }
    return bg;
  }

  renderDefaultPanel() {
    const status = this.placementType
      ? `Placing: ${BuildingTypes[this.placementType].name} — click an empty tile  (free workers: ${this.buildings.availableWorkers(this.resources)})`
      : 'Pick a building below, then click an empty tile. Click a building to inspect.';
    this.panelText(12, this.PANEL_Y + 8, status, { color: '#f1e3c0' });
    // (Bug 2) Building cap readout.
    this.panelText(GAME_W - 150, this.PANEL_Y + 8, `Buildings: ${this.buildings.placedCount()}/${this.maxBuildings()}`, { color: '#ffd23f', bold: true });

    const y = this.PANEL_Y + 30;
    const bw = 104;
    const h = 60;
    const gap = 4;
    let x = 6;
    for (const t of PLACEABLE) {
      const ok = this.buildings.canPlace(t.key, this.resources, this.maxBuildings()).ok;
      const sub = `${formatCost(t.cost)}${t.workerCost ? ` ${t.workerCost}w` : ''}`;
      const active = this.placementType === t.key;
      this.spriteButton(x, y, bw, h, t.name, sub, ok, () => {
        this.placementType = t.key;
        this.selectedBuilding = null;
        this.clearSelection();
        this.refreshPanel();
      }, { active });
      x += bw + gap;
    }

    // (FIX 5) The Expeditions opener moved to a dedicated top-right HUD button
    // (createKingdomsButton) so it no longer crowds the build palette.

    // Right side: cancel placement, or the settlement tier upgrade button.
    if (this.placementType) {
      this.spriteButton(GAME_W - 150, y, 140, h, 'Cancel', 'stop placing', true, () => {
        this.placementType = null;
        this.clearGhost();
        this.refreshPanel();
      });
    } else if (this.tierIndex < this.TIERS.length - 1) {
      const nt = this.TIERS[this.tierIndex + 1];
      const ok = this.canUpgradeTier();
      const btn = this.spriteButton(GAME_W - 184, y, 174, h, nt.button, formatCost(nt.cost), ok, ok ? () => this.upgradeTier() : null, { gold: ok });
      // (Phase 5) gentle pulse so the player notices an affordable upgrade.
      if (ok) this.tweens.add({ targets: btn, alpha: 0.7, yoyo: true, repeat: -1, duration: 700 });
    }
  }

  // Expedition panel (Phase 2). Uses a clean drawn panel (the Tiny Swords
  // SpecialPaper art smears when stretched — see the legibility note in preload).
  renderExpeditionPanel() {
    this.panel.add(
      this.add.rectangle(4, this.PANEL_Y + 4, GAME_W - 8, PANEL_H - 8, 0x241a0e, 0.96).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.7)
    );
    this.panelText(16, this.PANEL_Y + 8, `EXPEDITIONS   —   Soldiers available: ${this.troops.count}`, { bold: true, color: '#ffe9b0' });

    const keys = ['scout', 'raid', 'campaign'];
    const w = 296;
    const gap = 8;
    let x = 14;
    const by = this.PANEL_Y + 34;
    for (const key of keys) {
      const def = this.expeditions.defs[key];
      const st = this.expeditions.state[key];
      if (st.active) {
        this.spriteButton(x, by, w, 58, def.name, `Returns in: ${Math.ceil(st.timeLeft)}s`, false, null);
      } else {
        const can = this.expeditions.canSend(key);
        this.spriteButton(x, by, w, 58, `${def.name}  (${def.cost} sol)`, def.reward, can, () => this.expeditions.send(key));
      }
      x += w + gap;
    }

    this.spriteButton(GAME_W - 86, this.PANEL_Y + 6, 78, 22, 'Back', '', true, () => {
      this.panelMode = 'build';
      this.refreshPanel();
    });
  }

  renderSelectedPanel(b) {
    const t = b.type;
    this.panel.add(
      this.add.rectangle(8, this.PANEL_Y + 8, 440, PANEL_H - 16, 0x241a0e, 0.95).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.7)
    );

    let info = '';
    if (t.attack) info = `Damage ${b.currentOutput()} · Range ${t.range} tiles`;
    else if (t.produces) info = `+${b.currentOutput()} ${t.produces}${t.interval ? `/${t.interval}s` : '/s'}`;
    else if (t.capIncrease) info = `+${t.capIncrease} worker cap`;

    this.panelText(26, this.PANEL_Y + 14, `${t.name}  (Lv ${b.level}/${MAX_LEVEL})`, { bold: true, size: '18px', color: '#ffe9b0' });
    this.panelText(26, this.PANEL_Y + 42, `HP ${Math.ceil(b.hp)} / ${b.maxHp}`, { color: '#9fe0a0' });

    const closeBtnAt = (x, y, w, h) =>
      this.spriteButton(x, y, w, h, 'Close', '', true, () => {
        this.selectedBuilding = null;
        this.clearSelection();
        this.refreshPanel();
      });

    if (b.typeKey === 'barracks') {
      // (Bug 4) Slot status + level-gated training + upgrade.
      const maxSlots = b.level;
      const slotInfo = b.slots.length
        ? `Slots ${b.slots.length}/${maxSlots}: ${b.slots.map((s) => `${TRAIN_DEFS[s.type].label[0]}${Math.ceil(s.timeLeft)}s`).join(' ')}`
        : `Slots ${maxSlots} · idle`;
      this.panelText(26, this.PANEL_Y + 60, slotInfo, { color: '#ffd23f', size: '12px' });
      // Worker controls (workers set training speed; 0 = paused).
      this.workerControls(b, 26, this.PANEL_Y + 78);

      // Train buttons (top row), gated by level + free slots.
      let tx = 452;
      for (const type of ['warrior', 'archer', 'monk', 'knight']) {
        const def = TRAIN_DEFS[type];
        const need = this.unitUnlockLevel(type);
        const needSmith = type === 'knight';
        const smithOk = !needSmith || (this.hasBlacksmith && this.hasBlacksmith());
        const unlocked = b.level >= need && smithOk;
        const can = unlocked && b.slots.length < maxSlots && this.resources.canAfford(def.cost);
        const sub = b.level < need ? `Lv ${need} req` : needSmith && !smithOk ? 'Blacksmith req' : `${formatCost(def.cost)} · ${def.time}s`;
        this.spriteButton(tx, this.PANEL_Y + 8, 104, 52, `Train ${def.label}`, sub, can, () => this.trainUnit(b, type));
        tx += 108;
      }

      // Upgrade + Close (bottom row).
      if (b.level < MAX_LEVEL) {
        const cost = b.nextUpgradeCost();
        const afford = this.resources.gold >= cost;
        this.spriteButton(456, this.PANEL_Y + 66, 234, 52, `Upgrade to Lv ${b.level + 1}`, `${cost}G · +1 slot, unlock unit`, afford, () => {
          if (b.upgrade(this.resources)) {
            this.showSelection(b);
            this.refreshPanel();
          }
        }, { gold: afford });
      } else {
        this.spriteButton(456, this.PANEL_Y + 66, 234, 52, 'Max Level (3)', 'all units unlocked', false, null);
      }
      closeBtnAt(700, this.PANEL_Y + 66, 110, 52);
      return;
    }

    // (Phase 2) Worker-allocated production buildings (Lumberyard/Mine/Farm/Tower).
    if (b.type.maxWorkers > 0) {
      if (b.workers === 0) {
        this.panelText(26, this.PANEL_Y + 62, 'IDLE — assign a worker to activate', { color: '#ff8a80', bold: true });
      } else if (b.type.attack) {
        this.panelText(26, this.PANEL_Y + 62, `Active — firing (${b.workers}/${b.type.maxWorkers})`, { color: '#9fe0a0' });
      } else {
        this.panelText(26, this.PANEL_Y + 62, `Producing: ${b.currentOutput()} ${b.type.produces}/sec`, { color: '#9fe0a0' });
      }
      this.panelText(26, this.PANEL_Y + 84, t.desc, { color: '#cfc1a6', size: '11px', wrap: 410 });

      this.workerControls(b, 470, this.PANEL_Y + 10);

      const by2 = this.PANEL_Y + 34;
      if (b.level < MAX_LEVEL) {
        const cost = b.nextUpgradeCost();
        const afford = this.resources.gold >= cost;
        this.spriteButton(632, by2, 170, 60, 'Upgrade', `${cost}G · x2 output`, afford, () => {
          if (b.upgrade(this.resources)) {
            this.showSelection(b);
            this.refreshPanel();
          }
        });
      } else {
        this.spriteButton(632, by2, 170, 60, 'Max Level', '', false, null);
      }
      closeBtnAt(GAME_W - 120, by2, 104, 60);
      return;
    }

    this.panelText(26, this.PANEL_Y + 62, info, { color: '#ffd23f' });
    this.panelText(26, this.PANEL_Y + 84, t.desc, { color: '#cfc1a6', size: '11px', wrap: 400 });

    const by = this.PANEL_Y + 34;
    const closeBtn = () => closeBtnAt(GAME_W - 128, by, 110, 64);

    if (b.level < MAX_LEVEL) {
      const cost = b.nextUpgradeCost();
      const afford = this.resources.gold >= cost;
      this.spriteButton(GAME_W - 320, by, 180, 64, 'Upgrade', `${cost}G · x2 output`, afford, () => {
        if (b.upgrade(this.resources)) {
          this.showSelection(b);
          this.refreshPanel();
        }
      });
    } else {
      this.spriteButton(GAME_W - 320, by, 180, 64, 'Max Level', '', false, null);
    }
    closeBtn();
  }

  tryBuild(typeKey, tile) {
    if (this.buildings.isOccupied(tile.col, tile.row)) return;
    if (!this.isBuildZone(tile.col, tile.row)) {
      this.showToast('Can only build in the settlement zone');
      return;
    }
    const check = this.buildings.canPlace(typeKey, this.resources, this.maxBuildings());
    if (!check.ok) {
      this.showToast(check.reason);
      return;
    }
    this.resources.spend(BuildingTypes[typeKey].cost);
    const b = this.buildings.place(typeKey, tile.col, tile.row);
    if (b) this.placeFX(b); // white flash + pop (Phase 5)
    this.refreshPanel(); // affordability / worker availability changed
  }

  // ---- Worker allocation (Phase 2) -----------------------------------------

  freeWorkers() {
    return this.resources.workersCap - this.buildings.workersUsed();
  }

  addWorker(b) {
    if (b.type.maxWorkers <= 0 || b.workers >= b.type.maxWorkers) return;
    if (this.freeWorkers() <= 0) {
      this.showToast('No free workers — build a House');
      this.fireHint('noWorkers', 'No free workers — build another House to increase your workforce');
      return;
    }
    b.workers += 1;
    b.refreshWorkerIcon();
    this.refreshPanel();
  }

  removeWorker(b) {
    if (b.workers <= 0) return;
    b.workers -= 1;
    b.refreshWorkerIcon();
    this.refreshPanel();
  }

  // Draws "Workers X/max" with − / + buttons at (x, y).
  workerControls(b, x, y) {
    this.panelText(x, y, `Workers ${b.workers}/${b.type.maxWorkers}`, { bold: true, color: '#62d0f0' });
    this.spriteButton(x, y + 20, 38, 32, '−', '', b.workers > 0, () => this.removeWorker(b));
    this.spriteButton(x + 44, y + 20, 38, 32, '+', '', b.workers < b.type.maxWorkers && this.freeWorkers() > 0, () => this.addWorker(b));
    this.panelText(x + 92, y + 28, `${this.freeWorkers()} free`, { color: '#cfc1a6', size: '11px' });
    // (Expansion Phase 5) happiness production modifier on production buildings.
    if (this.population && b.type.produces && b.type.maxWorkers > 0) {
      const lbl = this.population.prodLabel();
      const col = this.population.prodMult >= 1.1 ? '#a6e22e' : this.population.prodMult < 1 ? '#ff8a5a' : '#cfc1a6';
      this.panelText(x, y + 44, `Production: ${lbl}`, { color: col, size: '11px', bold: true });
    }
  }

  // (Bug 4) Barracks level → training slots & unlocked unit types.
  // Lv1: Warrior, 1 slot.  Lv2: +Archer, 2 slots.  Lv3: +Monk, 3 slots.
  unitUnlockLevel(type) {
    return { warrior: 1, archer: 2, monk: 3, knight: 2 }[type];
  }

  // (Phase 3) Hard soldier cap = 5 per Barracks built.
  soldierCap() {
    return 5 * this.buildings.countOfType('barracks');
  }

  // Living soldiers + units in training + soldiers away on expeditions.
  soldierTotal() {
    let inTraining = 0;
    for (const b of this.buildings.buildings) if (b.typeKey === 'barracks') inTraining += b.slots.length;
    const deployed = this.expeditions && this.expeditions.deployedSoldiers ? this.expeditions.deployedSoldiers() : 0; // (Bug 5)
    return this.troops.count + inTraining + deployed;
  }

  trainUnit(barracks, type) {
    const need = this.unitUnlockLevel(type);
    if (barracks.level < need) {
      this.showToast(`${TRAIN_DEFS[type].label} unlocks at Barracks Lv ${need}`);
      return;
    }
    if (type === 'knight' && (!this.hasBlacksmith || !this.hasBlacksmith())) {
      this.showToast('Knights need an operational Blacksmith');
      return;
    }
    if (this.soldierTotal() >= this.soldierCap()) {
      this.showToast(`Soldier cap reached (${this.soldierCap()}) — build another Barracks`);
      return;
    }
    if (barracks.slots.length >= barracks.level) {
      this.showToast('All training slots busy');
      return;
    }
    const def = TRAIN_DEFS[type];
    if (!this.resources.canAfford(def.cost)) {
      this.showToast('Not enough resources');
      return;
    }
    this.resources.spend(def.cost);
    barracks.slots.push({ type, timeLeft: def.time, total: def.time });
    this.refreshPanel();
  }

  // Small rising/fading text popup (resource gains, etc.).
  floatText(x, y, text, color) {
    const t = this.add
      .text(x, y, text, { fontFamily: 'monospace', fontSize: '16px', color: color || '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(60);
    this.tweens.add({ targets: t, y: y - 34, alpha: 0, duration: 1500, onComplete: () => t.destroy() });
  }

  // (Phase 4) First-load welcome / onboarding panel. Modal until "Begin".
  showWelcomePanel() {
    const cx = GAME_W / 2;
    const cy = GAME_H / 2 - 20;
    const w = 640;
    const h = 330;
    const D = 120;
    const fix = (o) => o.setScrollFactor(0);
    const dim = fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.55).setOrigin(0, 0).setDepth(D).setInteractive());
    dim.on('pointerdown', (p, lx, ly, ev) => ev.stopPropagation());
    const bg = fix(this.add.rectangle(cx, cy, w, h, 0x241a0e, 0.98).setDepth(D + 1).setStrokeStyle(3, 0xc9a14a, 0.9));
    const title = fix(this.add.text(cx, cy - h / 2 + 26, 'Welcome to your Kingdom', { fontFamily: 'monospace', fontSize: '24px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5).setDepth(D + 2));
    const lines = [
      'Build Houses to get workers, then assign workers to Lumber yards and Mines to gather resources',
      'Build a Barracks and train Warriors to defend against enemy attacks',
      'Upgrade your settlement from Village → Town → Castle to unlock more buildings',
      'Right-click drag to move camera. Scroll to zoom. Left-drag to select troops.',
    ];
    const texts = lines.map((l, i) =>
      fix(this.add.text(cx - w / 2 + 30, cy - h / 2 + 66 + i * 52, `${i + 1}.  ${l}`, { fontFamily: 'monospace', fontSize: '14px', color: '#f0e6d0', wordWrap: { width: w - 60 }, lineSpacing: 2 }).setOrigin(0, 0).setDepth(D + 2))
    );
    const beginBg = fix(this.add.rectangle(cx, cy + h / 2 - 32, 170, 46, 0x2d6cb0).setDepth(D + 2).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
    const beginTx = fix(this.add.text(cx, cy + h / 2 - 32, 'Begin', { fontFamily: 'monospace', fontSize: '17px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(D + 3));
    const all = [dim, bg, title, ...texts, beginBg, beginTx];
    beginBg.on('pointerover', () => beginBg.setFillStyle(0x3d83cf));
    beginBg.on('pointerout', () => beginBg.setFillStyle(0x2d6cb0));
    beginBg.on('pointerdown', (p, lx, ly, ev) => {
      ev.stopPropagation();
      all.forEach((o) => o.destroy());
    });
  }

  // One-time contextual hint banner (Phase 2/4). Never repeats the same key,
  // never shows more than one at a time, fades after 5s.
  fireHint(key, msg) {
    this._firedHints = this._firedHints || {};
    if (this._firedHints[key]) return;
    this._firedHints[key] = true;
    if (this._hintBanner) this._hintBanner.destroy();
    const t = this.add
      .text(GAME_W / 2, TOP_BAR + 70, msg, { fontFamily: 'monospace', fontSize: '15px', color: '#ffffff', fontStyle: 'bold', backgroundColor: '#16263edd', padding: { x: 16, y: 9 }, align: 'center', wordWrap: { width: GAME_W - 160 } })
      .setOrigin(0.5, 0)
      .setDepth(70)
      .setScrollFactor(0);
    this._hintBanner = t;
    this.tweens.add({ targets: t, alpha: { from: 0, to: 1 }, duration: 200 });
    this.time.delayedCall(5000, () => {
      if (this._hintBanner !== t) return;
      this.tweens.add({ targets: t, alpha: 0, duration: 500, onComplete: () => { t.destroy(); if (this._hintBanner === t) this._hintBanner = null; } });
    });
  }

  showToast(msg) {
    const t = this.add
      .text(GAME_W / 2, 150, msg, { fontFamily: 'monospace', fontSize: '17px', color: '#ffffff', backgroundColor: '#000000aa', padding: { x: 10, y: 6 } })
      .setOrigin(0.5)
      .setDepth(60)
      .setScrollFactor(0);
    this.tweens.add({ targets: t, alpha: 0, y: t.y - 22, delay: 1000, duration: 600, onComplete: () => t.destroy() });
  }

  // ---- Game over -----------------------------------------------------------

  triggerGameOver() {
    if (this.isGameOver) return;
    this.isGameOver = true;
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.75).setOrigin(0, 0).setDepth(100).setScrollFactor(0);
    this.add.text(GAME_W / 2, GAME_H / 2 - 50, 'GAME OVER', { fontFamily: 'monospace', fontSize: '64px', color: '#e74c3c', fontStyle: 'bold' }).setOrigin(0.5).setDepth(101).setScrollFactor(0);
    this.add.text(GAME_W / 2, GAME_H / 2 + 20, `You reached Wave ${this.ai.waveNumber}`, { fontFamily: 'monospace', fontSize: '28px', color: '#ffffff' }).setOrigin(0.5).setDepth(101).setScrollFactor(0);
    const restart = this.add
      .text(GAME_W / 2, GAME_H / 2 + 80, '[ Click to play again ]', { fontFamily: 'monospace', fontSize: '20px', color: '#f1c40f' })
      .setOrigin(0.5)
      .setDepth(101)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    restart.on('pointerdown', () => this.scene.restart());
  }

  // ---- Main loop -----------------------------------------------------------

  update(time, delta) {
    if (this.isGameOver) return;
    const realDt = delta / 1000;
    // Game-speed scaled time (Phase 5): 1x / 2x / 3x affects all sim systems.
    const gdelta = delta * this.gameSpeed;
    const dt = realDt * this.gameSpeed;

    // Resource tick: once per scaled second.
    this.tickAccumulator += gdelta;
    while (this.tickAccumulator >= 1000) {
      this.tickAccumulator -= 1000;
      this.buildings.tick(this.resources, this);
    }

    // (Phase 3) Food upkeep: each soldier eats 1 food / 10s. At 0 food, soldiers
    // desert one at a time every 15s until food is positive again.
    this._upkeepAcc = (this._upkeepAcc || 0) + gdelta;
    while (this._upkeepAcc >= 10000) {
      this._upkeepAcc -= 10000;
      this.resources.food = Math.max(0, this.resources.food - this.troops.count);
    }
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
    if (this.troops.count > 0 && this.resources.food < 30) {
      this.fireHint('lowFood', 'Your people are hungry — build a Farm and assign workers');
    }
    if (this.canUpgradeTier()) {
      this.fireHint('canUpgrade', 'Your settlement can grow — check the upgrade button');
    }

    this.ai.update(dt); // AI kingdom builds + drives waves (Phase 3)
    this.waves.update(dt);
    this.buildings.updateTowers(dt, this.waves.enemies);
    this.nodes.update(gdelta); // resource node respawn timers (Phase 1)
    this.expeditions.update(dt); // expedition countdowns (Phase 2)

    // Keep the expedition panel / barracks training countdowns ticking live.
    const trainingOpen = this.selectedBuilding && this.selectedBuilding.typeKey === 'barracks' && this.selectedBuilding.slots.length > 0;
    if ((this.panelMode === 'expedition' && !this.selectedBuilding) || trainingOpen) {
      this._panelRefresh = (this._panelRefresh || 0) + dt;
      if (this._panelRefresh >= 0.5) {
        this._panelRefresh = 0;
        this.refreshPanel();
      }
    }

    // Phase 3 + 4 visual agents.
    this.pawns.sync(this.resources.workersCap);
    this.pawns.update(dt);
    this.troops.update(dt, this.waves.enemies);
    this.resources.soldiers = this.troops.count;

    // Barracks unit training — multiple slots (Bug 4); workers set speed (Phase 2).
    for (const b of this.buildings.buildings) {
      if (b.typeKey !== 'barracks' || b.slots.length === 0) continue;
      // 0 workers = no progress, 1 worker = 1x, 2 workers = 1.5x.
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

    this.updateSelectionRings(); // Phase 3 box-select
    this.updateHud();
    this.updateMinimap();
  }
}
