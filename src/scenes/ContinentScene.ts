import Phaser from 'phaser';
import { GAME_W, GAME_H } from './GameScene.js';
import { GameWorld } from '../systems/GameWorld.js';
import type { AIParty } from '../systems/GameWorld.js';
import { generateWorld } from '../systems/WorldGenerator.js';
import type { Settlement } from '../systems/WorldGenerator.js';
import { ChunkManager, PX_PER_TILE } from '../systems/ChunkManager.js';
import { ContinentPathfinder } from '../systems/ContinentPathfinder.js';
import type { PathStep } from '../systems/ContinentPathfinder.js';
import { biomeData } from '../data/Biomes.js';

// ============================================================================
// ContinentScene — Phase 2 (Bannerlord rebuild) PRIMARY game loop.
// ============================================================================
//
// This is the scene the player lives in: a TOP-DOWN (orthographic) render of the
// 1500×1500 chunked world from ChunkManager, with a roaming player party, A*
// movement, continuous time, supply, roaming AI parties, fog of war, settlement
// interaction, a battle trigger, a slim HUD, and a whole-world minimap.
//
// ============================================================================
// DESIGN DECISIONS
// ============================================================================
//
// * COORDINATE SPACE. ChunkManager renders chunks into world-PIXEL space where
//   1 tile = PX_PER_TILE (4) px. The camera lives in this pixel space; tiles are
//   converted via tile*PX_PER_TILE. Default zoom 0.4 shows a large slice while
//   the chunk budget (≤36 resident) holds 30+ FPS while panning.
//
// * CHUNK IMAGES. We keep a pool of reusable Phaser.Image objects (no per-frame
//   allocation). Each frame we ask ChunkManager.update(view) for the visible
//   texture keys, then bind images to those keys and position them. Images for
//   keys that left the view are hidden and returned to the pool. ChunkManager
//   owns texture lifecycle (load/evict); we own the sprite lifecycle.
//
// * TIME. Continuous: 1 game day = DAY_MS (300000 ms = 5 real min), matching the
//   legacy IsometricScene. The world never pauses; an onNewDay() hook fires once
//   per whole day for resources/AI/events. Travelling consumes supply daily.
//
// * MOVEMENT. Click a passable tile → A* (ContinentPathfinder) using per-biome
//   movementCost. The party advances along the path each frame, its pixels-per-
//   ms speed scaled by the current tile's movement cost (slower in forest/marsh).
//   A dotted planned-route line + an "Arrives in ~X days" ETA are drawn; right-
//   click cancels.
//
// * FOG OF WAR. A coarse explored bitmap (1 cell = FOG_CELL tiles) is lifted in
//   a radius around the player + player-owned settlements, drawn as a dark
//   overlay image in screen space (cheap; redrawn only when the set changes).
//
// * SETTLEMENT / BATTLE. Within ~2 tiles of a settlement → highlight + "Enter?"
//   confirm; entering launches IsometricScene as a per-settlement stand-in
//   (Phase 3 makes it real), passing the settlement id via GameWorld. Within ~3
//   tiles of an enemy party → "Enemy army approaching!" banner; on collision →
//   BattleScene with the player's army vs the enemy party, returning to the
//   continent at the battle location.
// ============================================================================

const DAY_MS = 300000;          // 1 game day = 5 real minutes (matches legacy)
const DEFAULT_ZOOM = 0.4;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.5;
const FOG_CELL = 8;             // tiles per fog cell
const FOG_REVEAL = 14;          // tiles of reveal radius around the player
const SETTLE_RANGE = 2;         // tiles: settlement interaction range
const ENEMY_WARN_RANGE = 3;     // tiles: "enemy approaching" banner
const ENEMY_FIGHT_RANGE = 1.2;  // tiles: collision → battle
// Base travel: tiles/sec on cost-1 terrain at full simulation. Tuned so a
// cross-region march of tens of tiles takes a believable handful of days.
const BASE_TILES_PER_DAY = 9;   // plains tiles covered per game day
const HUD_DEPTH = 1000;

export class ContinentScene extends Phaser.Scene {
  [key: string]: any;

  constructor() { super('ContinentScene'); }

  // ------------------------------------------------------------------------
  create() {
    // --- Ensure a world exists (defensive: a direct boot should still work). --
    if (!GameWorld.world) {
      // No campaign started yet — generate a fresh deterministic world so the
      // scene always boots cleanly even if launched directly (e.g. headless).
      GameWorld.startNewCampaign(generateWorld());
    }
    this.world = GameWorld.world;
    const size = this.world.size;
    this.worldPxW = size * PX_PER_TILE;
    this.worldPxH = size * PX_PER_TILE;

    // --- Systems ----------------------------------------------------------
    this.chunks = new ChunkManager(this, this.world);
    this.pathfinder = new ContinentPathfinder(this.world);

    // --- Camera -----------------------------------------------------------
    this.cameras.main.setBounds(0, 0, this.worldPxW, this.worldPxH);
    this.cameras.main.setBackgroundColor(0x1c2a38); // ocean-ish behind chunks
    this.zoom = DEFAULT_ZOOM;
    this.cameras.main.setZoom(this.zoom);
    this.followParty = true;

    // --- Chunk image pool (terrain layer, depth 0) ------------------------
    // A 1×1 transparent placeholder so pooled (hidden) images never reference a
    // chunk texture that ChunkManager later evicts — referencing a removed
    // CanvasTexture frame would crash the canvas renderer's batchSprite.
    if (!this.textures.exists('continent_blank')) {
      const bt = this.textures.createCanvas('continent_blank', 1, 1);
      if (bt) bt.refresh();
    }
    this.chunkLayer = this.add.container(0, 0).setDepth(0);
    this.chunkPool = [];
    this.activeChunkImgs = new Map(); // key -> Image

    // --- Overlay graphics (route line, highlights) in world space ---------
    this.overlay = this.add.graphics().setDepth(20);

    // --- Party + AI icons in world space ----------------------------------
    this.iconLayer = this.add.container(0, 0).setDepth(30);
    this.partyIcon = this.add.container(0, 0).setDepth(40);
    this.buildPartyIcon();

    // --- Fog of war overlay (screen space image) --------------------------
    this.initFog();

    // --- HUD (screen space) -----------------------------------------------
    this.buildHud();
    this.buildMinimap();

    // --- Tooltip ----------------------------------------------------------
    this.tip = this.add.text(0, 0, '', {
      fontFamily: 'Georgia, serif', fontSize: '12px', color: '#2a1c0c',
      backgroundColor: '#efe2bcee', padding: { x: 7, y: 5 },
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(HUD_DEPTH + 20).setVisible(false);

    // --- Banner (enemy approaching / messages) ----------------------------
    this.banner = this.add.text(GAME_W / 2, 64, '', {
      fontFamily: 'Georgia, serif', fontSize: '20px', color: '#fff', fontStyle: 'bold',
      backgroundColor: '#8c2b2bdd', padding: { x: 16, y: 8 }, align: 'center',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(HUD_DEPTH + 30).setVisible(false);

    // --- Movement state ---------------------------------------------------
    this.path = [] as PathStep[];      // remaining tile steps
    this.pathTotal = [] as PathStep[]; // full planned path (for drawing)
    this.subProgress = 0;              // 0..1 progress into the current step
    this.lastNewDay = GameWorld.displayDay();
    this._closing = false;

    // --- Input ------------------------------------------------------------
    this.setupInput();

    // Centre on the player immediately, then start following.
    const pp = this.tileToPx(GameWorld.player.col, GameWorld.player.row);
    this.cameras.main.centerOn(pp.x, pp.y);

    // Initial visibility + draws.
    this.refreshChunks();
    this.revealAroundPlayer();
    this.rebuildFog();
    this.updateHud();

    this.cameras.main.fadeIn(300, 12, 18, 26);

    // First-time tutorial hint.
    this.showTutorialOnce();

    // Clean shutdown.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.onShutdown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.onShutdown());
  }

  // =========================================================================
  // Coordinate helpers
  // =========================================================================
  tileToPx(col: number, row: number): { x: number; y: number } {
    return { x: (col + 0.5) * PX_PER_TILE, y: (row + 0.5) * PX_PER_TILE };
  }
  pxToTile(x: number, y: number): { col: number; row: number } {
    return { col: Math.floor(x / PX_PER_TILE), row: Math.floor(y / PX_PER_TILE) };
  }

  // =========================================================================
  // Input
  // =========================================================================
  setupInput() {
    // Wheel zoom around the cursor.
    this.input.on('wheel', (_p: any, _go: any, _dx: number, dy: number) => {
      const factor = dy > 0 ? 0.88 : 1.14;
      this.setZoom(this.zoom * factor);
    });

    // Pointer down: left = move order (or UI), right = pan-start / cancel path.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) {
        this._dragging = true;
        this._dragX = p.x; this._dragY = p.y;
        this._dragMoved = false;
        this.followParty = false;
      }
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this._dragging) {
        const dx = (p.x - this._dragX) / this.zoom;
        const dy = (p.y - this._dragY) / this.zoom;
        if (Math.abs(p.x - this._dragX) + Math.abs(p.y - this._dragY) > 3) this._dragMoved = true;
        this.cameras.main.scrollX -= dx;
        this.cameras.main.scrollY -= dy;
        this._dragX = p.x; this._dragY = p.y;
      } else {
        this.onHover(p);
      }
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.button === 2 || this._dragging) {
        // Right-click without dragging = cancel current path.
        if (!this._dragMoved) this.cancelPath();
        this._dragging = false;
        return;
      }
    });

    // Left click → move order or settlement interaction. Use the up event so a
    // click on the minimap/HUD (handled separately) doesn't also issue a move.
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.button !== 0) return;
      if (this._uiClick) { this._uiClick = false; return; }
      this.onLeftClick(p);
    });

    // Disable the browser context menu on right-click.
    this.input.mouse?.disableContextMenu();

    // Keyboard: F follow toggle; +/- zoom; Esc → menu (with confirm-less escape).
    this.input.keyboard?.on('keydown-F', () => { this.followParty = true; });
    this.input.keyboard?.on('keydown-M', () => this.toggleMinimap());
  }

  setZoom(z: number) {
    this.zoom = Phaser.Math.Clamp(z, MIN_ZOOM, MAX_ZOOM);
    this.cameras.main.setZoom(this.zoom);
  }

  onLeftClick(p: Phaser.Input.Pointer) {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    const t = this.pxToTile(wp.x, wp.y);
    if (t.col < 0 || t.row < 0 || t.col >= this.world.size || t.row >= this.world.size) return;

    // Settlement under/near the click within interaction range of the PARTY?
    const near = this.settlementNearParty();
    if (near) {
      const sp = this.tileToPx(near.col, near.row);
      const dpx = Phaser.Math.Distance.Between(wp.x, wp.y, sp.x, sp.y);
      if (dpx < 14 * PX_PER_TILE) { this.promptEnterSettlement(near); return; }
    }

    // Otherwise issue a move order.
    this.moveTo(t.col, t.row);
  }

  // =========================================================================
  // PUBLIC: issue a move order to a tile (also the headless test entry point).
  // Returns true if a path (full or partial) was found.
  // =========================================================================
  moveTo(col: number, row: number): boolean {
    col = Phaser.Math.Clamp(Math.round(col), 0, this.world.size - 1);
    row = Phaser.Math.Clamp(Math.round(row), 0, this.world.size - 1);
    const res = this.pathfinder.find(GameWorld.player.col, GameWorld.player.row, col, row);
    if (!res.path.length) { this.flashBanner('No route there.', 0x6b5a3a); return false; }
    this.path = res.path.slice();
    this.pathTotal = res.path.slice();
    this.subProgress = 0;
    this.pathCost = res.cost;
    this.drawRoute();
    return true;
  }

  cancelPath() {
    if (this.path.length) this.flashBanner('March halted.', 0x6b5a3a);
    this.path = [];
    this.pathTotal = [];
    this.subProgress = 0;
    this.overlay.clear();
    if (this.etaLabel) this.etaLabel.setVisible(false);
  }

  // =========================================================================
  // Per-frame update
  // =========================================================================
  update(_time: number, delta: number) {
    if (this._closing) return;

    // --- TIME: advance the continuous day clock (never pauses). -----------
    const dayDelta = delta / DAY_MS;
    GameWorld.day += dayDelta;

    // --- MOVEMENT ---------------------------------------------------------
    let travelledTiles = 0;
    if (this.path.length) {
      travelledTiles = this.advanceParty(delta);
    }

    // --- SUPPLY: -1 food / soldier-day while away from a held settlement. --
    // We model the party-level drain as 1 supply-day per game day spent in the
    // field (the "per soldier" scaling is folded into the day budget so a 10-day
    // supply lasts ~10 field days, matching the spec's "start ~10 days").
    if (travelledTiles > 0 || !this.atOwnedSettlement()) {
      GameWorld.player.supply = Math.max(0, GameWorld.player.supply - dayDelta);
      if (GameWorld.player.supply <= 0) {
        // Low/zero supply hook → morale erodes (desertion handled in later phases).
        GameWorld.player.morale = Math.max(0, GameWorld.player.morale - dayDelta * 6);
      }
    }

    // --- NEW DAY hook -----------------------------------------------------
    const d = GameWorld.displayDay();
    if (d > this.lastNewDay) {
      const days = d - this.lastNewDay;
      this.lastNewDay = d;
      for (let i = 0; i < days; i++) this.onNewDay();
    }

    // --- AI parties -------------------------------------------------------
    this.updateAIParties(delta);

    // --- Camera follow ----------------------------------------------------
    if (this.followParty) {
      const pp = this.tileToPx(GameWorld.player.col, GameWorld.player.row);
      const cam = this.cameras.main;
      cam.scrollX += (pp.x - (cam.scrollX + cam.width / 2 / this.zoom)) * 0.12;
      cam.scrollY += (pp.y - (cam.scrollY + cam.height / 2 / this.zoom)) * 0.12;
    }

    // --- Chunks + icons + fog + HUD --------------------------------------
    this.refreshChunks();
    this.layoutIcons();
    this.checkEnemyProximity();
    this.updateHud();
    this.updateMinimap();
    if (this._fogDirty) { this.rebuildFog(); this._fogDirty = false; }
  }

  // Advance the party along its path; returns tiles travelled this frame.
  advanceParty(delta: number): number {
    let travelled = 0;
    let budgetDays = (delta / DAY_MS); // game-days available this frame
    // Convert to a tile budget on cost-1 terrain.
    let tileBudget = budgetDays * BASE_TILES_PER_DAY;

    while (tileBudget > 0 && this.path.length) {
      const next = this.path[0];
      const cost = Math.max(0.5, this.pathfinder.tileCost(next.col, next.row));
      // Cost per tile relative to plains (cost 1). Higher cost = slower.
      const tileFraction = tileBudget / cost; // how much of this step we can do
      const remaining = 1 - this.subProgress;
      if (tileFraction >= remaining) {
        // Complete this step.
        tileBudget -= remaining * cost;
        GameWorld.player.col = next.col;
        GameWorld.player.row = next.row;
        this.subProgress = 0;
        this.path.shift();
        travelled += 1;
        this.revealAroundPlayer();
        if (!this.path.length) { this.cancelPath(); break; }
      } else {
        this.subProgress += tileFraction;
        tileBudget = 0;
      }
    }
    if (this.path.length) this.drawRoute();
    return travelled;
  }

  atOwnedSettlement(): boolean {
    // Player is resupplied while standing on/adjacent to a player-owned town.
    for (const s of this.world.settlements) {
      if (s.kind !== 'player_castle') continue;
      if (Phaser.Math.Distance.Between(GameWorld.player.col, GameWorld.player.row, s.col, s.row) <= 2) {
        // Resupply to full while parked at home.
        GameWorld.player.supply = 10;
        return true;
      }
    }
    return false;
  }

  // =========================================================================
  // onNewDay — the clean daily tick hook for resources/AI/events.
  // =========================================================================
  onNewDay() {
    // Passive economy: a small daily income (placeholder; real economy lives in
    // the per-settlement view, Phase 3+). Kept tiny so numbers stay legible.
    GameWorld.gold += 5;
    // AI parties re-evaluate objectives occasionally.
    for (const ai of GameWorld.aiParties) {
      if (Math.random() < 0.15) GameWorld.pickAIObjective(ai);
      if (ai.personality === 'aggressive') { ai.destCol = GameWorld.player.col; ai.destRow = GameWorld.player.row; }
    }
  }

  // =========================================================================
  // AI parties — move toward their objective tiles (cheap step-toward, fog-gated
  // for visibility).
  // =========================================================================
  updateAIParties(delta: number) {
    const tilesThisFrame = (delta / DAY_MS) * BASE_TILES_PER_DAY * 0.8; // a touch slower than the player
    for (const ai of GameWorld.aiParties) {
      const dc = ai.destCol - ai.col, dr = ai.destRow - ai.row;
      const dist = Math.hypot(dc, dr);
      if (dist < 1.0) {
        // Reached objective → pick a new one.
        GameWorld.pickAIObjective(ai);
        continue;
      }
      // Step toward the objective, but only onto passable tiles (slide along).
      const step = Math.min(tilesThisFrame, dist);
      let nc = ai.col + (dc / dist) * step;
      let nr = ai.row + (dr / dist) * step;
      if (!this.pathfinder.passable(Math.round(nc), Math.round(nr))) {
        // Try axis-aligned slides to avoid getting stuck on water/peaks.
        if (this.pathfinder.passable(Math.round(ai.col + (dc / dist) * step), Math.round(ai.row))) {
          nr = ai.row;
        } else if (this.pathfinder.passable(Math.round(ai.col), Math.round(ai.row + (dr / dist) * step))) {
          nc = ai.col;
        } else {
          // Stuck → re-pick objective next frame.
          GameWorld.pickAIObjective(ai);
          continue;
        }
      }
      ai.col = Phaser.Math.Clamp(nc, 1, this.world.size - 2);
      ai.row = Phaser.Math.Clamp(nr, 1, this.world.size - 2);
    }
  }

  // =========================================================================
  // CHUNK RENDER — bind pooled images to ChunkManager's visible texture keys.
  // =========================================================================
  refreshChunks() {
    const cam = this.cameras.main;
    const tileLeft = Math.floor(cam.scrollX / PX_PER_TILE);
    const tileTop = Math.floor(cam.scrollY / PX_PER_TILE);
    const tileWide = Math.ceil(cam.width / this.zoom / PX_PER_TILE);
    const tileHigh = Math.ceil(cam.height / this.zoom / PX_PER_TILE);
    const visibleKeys = this.chunks.update({ tileLeft, tileTop, tileWide, tileHigh });

    const wanted = new Set(visibleKeys);

    // Remove images whose key is no longer visible (return to pool). Rebind to
    // the permanent blank texture so a later texture eviction can't leave a
    // dangling frame reference under the canvas renderer.
    for (const [key, img] of this.activeChunkImgs) {
      if (!wanted.has(key)) {
        img.setVisible(false);
        img.setTexture('continent_blank');
        this.chunkPool.push(img);
        this.activeChunkImgs.delete(key);
      }
    }

    // Bind/position images for visible keys.
    for (const key of visibleKeys) {
      if (!this.textures.exists(key)) continue; // defensive: skip if not yet built
      let img = this.activeChunkImgs.get(key);
      if (!img) {
        img = this.chunkPool.pop();
        if (!img) {
          img = this.add.image(0, 0, key).setOrigin(0, 0);
          this.chunkLayer.add(img);
        }
        // Reset texture (texture might have been recreated) and show.
        img.setTexture(key);
        img.setVisible(true);
        this.activeChunkImgs.set(key, img);
      }
      // Parse chunk coords from the texture key (wgchunk_cx_cy).
      const m = key.match(/wgchunk_(\d+)_(\d+)/);
      if (m) {
        const cx = parseInt(m[1], 10), cy = parseInt(m[2], 10);
        const pos = this.chunks.chunkWorldPos(cx, cy);
        img.setPosition(pos.x, pos.y);
      }
    }
  }

  // =========================================================================
  // ICONS — player party + AI parties, laid out in world space each frame.
  // =========================================================================
  buildPartyIcon() {
    // A crown/castle crest in the player faction colour, with an army badge and
    // a supply dot. Drawn once with Graphics + Text; repositioned each frame.
    const c = this.partyIcon;
    const g = this.add.graphics();
    // Banner shield.
    g.fillStyle(0x1a120a, 0.5); g.fillEllipse(0, 16, 30, 10);     // shadow
    g.fillStyle(GameWorld.playerColor, 1);
    g.fillRoundedRect(-13, -14, 26, 30, 4);
    g.lineStyle(2, 0xf5ecd2, 0.95); g.strokeRoundedRect(-13, -14, 26, 30, 4);
    // Crown motif.
    g.fillStyle(0xffe08a, 1);
    g.fillTriangle(-9, -4, -5, -12, -1, -4);
    g.fillTriangle(-3, -4, 1, -14, 5, -4);
    g.fillTriangle(2, -4, 6, -12, 10, -4);
    g.fillRect(-9, -4, 19, 4);
    c.add(g);
    // Army-size badge.
    this.partyBadge = this.add.text(0, 18, '', {
      fontFamily: 'Georgia, serif', fontSize: '11px', color: '#fff', fontStyle: 'bold',
      backgroundColor: '#000000aa', padding: { x: 4, y: 1 },
    }).setOrigin(0.5, 0);
    c.add(this.partyBadge);
    // Supply dot.
    this.supplyDot = this.add.circle(13, -14, 4, 0x4ad06b).setStrokeStyle(1, 0x10160d, 0.8);
    c.add(this.supplyDot);
  }

  layoutIcons() {
    // Player party.
    const pp = this.tileToPx(GameWorld.player.col, GameWorld.player.row);
    this.partyIcon.setPosition(pp.x, pp.y);
    this.partyIcon.setScale(1 / this.zoom * 0.9 + 0.1); // keep readable at any zoom
    this.partyBadge.setText(`${GameWorld.armySize()}`);
    const st = GameWorld.supplyState();
    this.supplyDot.setFillStyle(st === 'green' ? 0x4ad06b : st === 'yellow' ? 0xe6c84a : 0xd64a4a);

    // AI parties (only where fog is lifted).
    this.iconLayer.removeAll(true);
    for (const ai of GameWorld.aiParties) {
      if (!this.fogLifted(Math.round(ai.col), Math.round(ai.row))) continue;
      const ap = this.tileToPx(ai.col, ai.row);
      const g = this.add.graphics();
      g.fillStyle(0x1a120a, 0.5); g.fillEllipse(0, 6, 18, 6);
      g.fillStyle(ai.color, 1); g.fillCircle(0, -2, 8);
      g.lineStyle(1.5, 0xf5ecd2, 0.85); g.strokeCircle(0, -2, 8);
      // sword tick
      g.lineStyle(1.5, 0xffffff, 0.9); g.lineBetween(0, -7, 0, 3);
      g.lineBetween(-3, -3, 3, -3);
      g.setPosition(ap.x, ap.y);
      g.setScale(1 / this.zoom * 0.9 + 0.1);
      this.iconLayer.add(g);
    }
  }

  // =========================================================================
  // ROUTE drawing — dotted planned line + ETA label.
  // =========================================================================
  drawRoute() {
    const g = this.overlay;
    g.clear();
    if (!this.pathTotal.length) { if (this.etaLabel) this.etaLabel.setVisible(false); return; }
    // Dotted line from the party through the remaining path.
    const start = this.tileToPx(GameWorld.player.col, GameWorld.player.row);
    const pts: Array<{ x: number; y: number }> = [start];
    for (const s of this.path) pts.push(this.tileToPx(s.col, s.row));
    g.lineStyle(Math.max(1, 2 / this.zoom), 0xffe08a, 0.9);
    for (let i = 0; i < pts.length - 1; i++) {
      this.dotted(g, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    }
    // Destination marker.
    const dest = pts[pts.length - 1];
    g.fillStyle(0xffe08a, 0.9); g.fillCircle(dest.x, dest.y, Math.max(2, 5 / this.zoom));
    g.lineStyle(Math.max(1, 1.5 / this.zoom), 0x6b4a16, 0.9); g.strokeCircle(dest.x, dest.y, Math.max(2, 5 / this.zoom));

    // ETA label near the destination (screen-space).
    const remainingCost = this.estimateRemainingCost();
    const days = remainingCost / BASE_TILES_PER_DAY;
    if (!this.etaLabel) {
      this.etaLabel = this.add.text(0, 0, '', {
        fontFamily: 'Georgia, serif', fontSize: '12px', color: '#3a2810', fontStyle: 'bold',
        backgroundColor: '#efe2bcee', padding: { x: 6, y: 3 },
      }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(HUD_DEPTH + 10);
    }
    const sc = this.worldToScreen(dest.x, dest.y);
    this.etaLabel.setText(`Arrives in ~${Math.max(1, Math.round(days))} day${Math.round(days) === 1 ? '' : 's'}`);
    this.etaLabel.setPosition(sc.x, sc.y - 10).setVisible(true);
  }

  estimateRemainingCost(): number {
    let c = (1 - this.subProgress) * (this.path.length ? Math.max(0.5, this.pathfinder.tileCost(this.path[0].col, this.path[0].row)) : 0);
    for (let i = 1; i < this.path.length; i++) {
      c += Math.max(0.5, this.pathfinder.tileCost(this.path[i].col, this.path[i].row));
    }
    return c;
  }

  dotted(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    const dash = 6 / this.zoom, gap = 5 / this.zoom;
    const ux = dx / len, uy = dy / len;
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(d + dash, len);
      g.lineBetween(x1 + ux * d, y1 + uy * d, x1 + ux * e, y1 + uy * e);
    }
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return { x: (wx - cam.scrollX) * this.zoom, y: (wy - cam.scrollY) * this.zoom };
  }

  // =========================================================================
  // FOG OF WAR
  // =========================================================================
  initFog() {
    const cells = Math.ceil(this.world.size / FOG_CELL);
    this.fogCells = cells;
    this.fogExplored = new Uint8Array(cells * cells);
    // A screen-space dark overlay image that we redraw when exploration changes.
    const key = 'continent_fog';
    if (this.textures.exists(key)) this.textures.remove(key);
    // The fog texture is the whole world at 1 px per fog-cell, scaled up under
    // the camera. We draw it as a world-space image so it pans with the map.
    const tex = this.textures.createCanvas(key, cells, cells);
    this.fogTex = tex;
    this.fogImg = this.add.image(0, 0, key).setOrigin(0, 0).setDepth(15);
    this.fogImg.setScale((this.world.size * PX_PER_TILE) / cells);
    this._fogDirty = true;
  }

  fogIndex(col: number, row: number): number {
    const cx = Math.floor(col / FOG_CELL), cy = Math.floor(row / FOG_CELL);
    return cy * this.fogCells + cx;
  }
  fogLifted(col: number, row: number): boolean {
    if (col < 0 || row < 0 || col >= this.world.size || row >= this.world.size) return false;
    return this.fogExplored[this.fogIndex(col, row)] === 1;
  }

  revealAroundPlayer() {
    this.revealCircle(GameWorld.player.col, GameWorld.player.row, FOG_REVEAL);
    // Reveal around player-owned settlements once.
    if (!this._revealedHome) {
      for (const s of this.world.settlements) {
        if (s.kind === 'player_castle') this.revealCircle(s.col, s.row, FOG_REVEAL + 4);
      }
      this._revealedHome = true;
    }
  }

  revealCircle(col: number, row: number, radiusTiles: number) {
    const cells = this.fogCells;
    const r = Math.ceil(radiusTiles / FOG_CELL) + 1;
    const ccx = Math.floor(col / FOG_CELL), ccy = Math.floor(row / FOG_CELL);
    let changed = false;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const fx = ccx + dx, fy = ccy + dy;
        if (fx < 0 || fy < 0 || fx >= cells || fy >= cells) continue;
        if (Math.hypot(dx, dy) > r) continue;
        const i = fy * cells + fx;
        if (this.fogExplored[i] === 0) { this.fogExplored[i] = 1; changed = true; }
      }
    }
    if (changed) this._fogDirty = true;
  }

  rebuildFog() {
    const ctx = this.fogTex.getContext();
    const cells = this.fogCells;
    ctx.clearRect(0, 0, cells, cells);
    const img = ctx.createImageData(cells, cells);
    for (let i = 0; i < this.fogExplored.length; i++) {
      const o = i * 4;
      if (this.fogExplored[i] === 1) {
        img.data[o + 3] = 0; // explored → transparent
      } else {
        img.data[o] = 8; img.data[o + 1] = 11; img.data[o + 2] = 18;
        img.data[o + 3] = 220; // unexplored → near-opaque dark
      }
    }
    ctx.putImageData(img, 0, 0);
    this.fogTex.refresh();
  }

  // =========================================================================
  // HUD
  // =========================================================================
  buildHud() {
    const fix = (o: any) => o.setScrollFactor(0).setDepth(HUD_DEPTH);
    // Top bar.
    this.hudBar = fix(this.add.rectangle(0, 0, GAME_W, 34, 0x2a1d0e, 0.92).setOrigin(0, 0));
    fix(this.add.rectangle(0, 34, GAME_W, 2, 0xc9a14a, 0.7).setOrigin(0, 0));

    this.hudLeft = fix(this.add.text(14, 8, '', {
      fontFamily: 'Georgia, serif', fontSize: '14px', color: '#ffe9b0', fontStyle: 'bold',
    }));
    this.hudCenter = fix(this.add.text(GAME_W / 2, 8, '', {
      fontFamily: 'Georgia, serif', fontSize: '14px', color: '#f0e6d0',
    }).setOrigin(0.5, 0));
    this.hudRight = fix(this.add.text(GAME_W - 14, 8, '', {
      fontFamily: 'Georgia, serif', fontSize: '14px', color: '#f0e6d0',
    }).setOrigin(1, 0));

    // "Return to Realm" / menu button (top-right under the bar).
    const by = 46;
    const btn = fix(this.add.rectangle(GAME_W - 70, by, 120, 26, 0x6b4a26).setStrokeStyle(2, 0xe9d6a4, 0.9).setInteractive({ useHandCursor: true }));
    fix(this.add.text(GAME_W - 70, by, 'Menu (Esc)', { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#f5ecd2', fontStyle: 'bold' }).setOrigin(0.5));
    btn.on('pointerover', () => btn.setFillStyle(0x82602f));
    btn.on('pointerout', () => btn.setFillStyle(0x6b4a26));
    btn.on('pointerdown', () => { this._uiClick = true; });
    btn.on('pointerup', () => { this._uiClick = true; this.toMainMenu(); });
    this.input.keyboard?.on('keydown-ESC', () => this.toMainMenu());
  }

  updateHud() {
    const settleCount = this.world.settlements.filter((s: Settlement) => s.kind === 'player_castle').length;
    this.hudLeft.setText(`${GameWorld.king.kingdom}   ·   ${settleCount} settlement${settleCount === 1 ? '' : 's'}`);
    const biome = biomeData(this.world.tileBiome[GameWorld.player.row * this.world.size + GameWorld.player.col]);
    this.hudCenter.setText(`Day ${GameWorld.displayDay()}  |  ${GameWorld.season()}  |  ${biome.displayName}`);
    const st = GameWorld.supplyState();
    const supplyTag = st === 'red' ? ' (!)' : '';
    this.hudRight.setText(`Supply ${Math.ceil(GameWorld.player.supply)}d${supplyTag}    Army ${GameWorld.armySize()}    Gold ${Math.floor(GameWorld.gold)}`);
  }

  // =========================================================================
  // MINIMAP — whole-world overview + dots (bottom-right).
  // =========================================================================
  buildMinimap() {
    const fix = (o: any) => o.setScrollFactor(0).setDepth(HUD_DEPTH + 5);
    const MM = 180; // minimap px size on screen
    this.mmSize = MM;
    this.mmX = GAME_W - MM - 12;
    this.mmY = GAME_H - MM - 12;
    this._mmVisible = true;

    // Build the overview texture once (whole world at 1 px/tile → 1500×1500),
    // displayed scaled down to MM×MM.
    const key = this.chunks.buildOverviewTexture('continent_overview', 1);
    this.mmFrame = fix(this.add.rectangle(this.mmX - 4, this.mmY - 4, MM + 8, MM + 8, 0x2a1d0e, 0.92).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.8));
    this.mmImg = fix(this.add.image(this.mmX, this.mmY, key).setOrigin(0, 0));
    this.mmImg.setDisplaySize(MM, MM);
    this.mmImg.setInteractive({ useHandCursor: true });
    this.mmImg.on('pointerdown', () => { this._uiClick = true; });
    this.mmImg.on('pointerup', (p: Phaser.Input.Pointer) => {
      this._uiClick = true;
      // Click the minimap → recentre the camera there.
      const lx = (p.x - this.mmX) / MM, ly = (p.y - this.mmY) / MM;
      const wx = lx * this.world.size * PX_PER_TILE, wy = ly * this.world.size * PX_PER_TILE;
      this.followParty = false;
      this.cameras.main.centerOn(wx, wy);
    });

    // Dots layer (redrawn each frame).
    this.mmDots = fix(this.add.graphics());
  }

  toggleMinimap() {
    this._mmVisible = !this._mmVisible;
    this.mmFrame.setVisible(this._mmVisible);
    this.mmImg.setVisible(this._mmVisible);
    this.mmDots.setVisible(this._mmVisible);
  }

  updateMinimap() {
    if (!this._mmVisible) return;
    const g = this.mmDots;
    g.clear();
    const MM = this.mmSize, size = this.world.size;
    const toMM = (col: number, row: number) => ({ x: this.mmX + (col / size) * MM, y: this.mmY + (row / size) * MM });
    // Known settlements.
    for (const s of this.world.settlements) {
      if (!this.fogLifted(s.col, s.row) && s.kind !== 'player_castle') continue;
      const p = toMM(s.col, s.row);
      let col = 0xfff3c4;
      if (s.kind === 'player_castle') col = this.colorOf(GameWorld.playerColor);
      else if (s.kind === 'ai_castle') col = 0xd64a4a;
      else if (s.kind === 'goblin_camp') col = 0x7cb342;
      g.fillStyle(col, 1); g.fillRect(p.x - 1, p.y - 1, 3, 3);
    }
    // AI parties (where fog lifted).
    for (const ai of GameWorld.aiParties) {
      if (!this.fogLifted(Math.round(ai.col), Math.round(ai.row))) continue;
      const p = toMM(ai.col, ai.row);
      g.fillStyle(ai.color, 1); g.fillCircle(p.x, p.y, 1.6);
    }
    // Player dot (pulses).
    const pp = toMM(GameWorld.player.col, GameWorld.player.row);
    g.fillStyle(0xffffff, 1); g.fillCircle(pp.x, pp.y, 3);
    g.fillStyle(this.colorOf(GameWorld.playerColor), 1); g.fillCircle(pp.x, pp.y, 2);
    // Camera viewport rectangle.
    const cam = this.cameras.main;
    const vx = this.mmX + (cam.scrollX / (size * PX_PER_TILE)) * MM;
    const vy = this.mmY + (cam.scrollY / (size * PX_PER_TILE)) * MM;
    const vw = ((cam.width / this.zoom) / (size * PX_PER_TILE)) * MM;
    const vh = ((cam.height / this.zoom) / (size * PX_PER_TILE)) * MM;
    g.lineStyle(1, 0xffffff, 0.7);
    g.strokeRect(vx, vy, vw, vh);
  }

  colorOf(rgb: number): number { return rgb & 0xffffff; }

  // =========================================================================
  // HOVER tooltips (settlements + AI parties).
  // =========================================================================
  onHover(p: Phaser.Input.Pointer) {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    const t = this.pxToTile(wp.x, wp.y);
    // AI party?
    for (const ai of GameWorld.aiParties) {
      if (!this.fogLifted(Math.round(ai.col), Math.round(ai.row))) continue;
      if (Phaser.Math.Distance.Between(t.col, t.row, ai.col, ai.row) <= 2) {
        const fac = this.world.factions.find((f: any) => f.key === ai.factionKey);
        this.showTip(p, `${fac ? fac.name : ai.factionKey}\nEst. army ${ai.armyEstimate}\n${ai.destLabel}`);
        return;
      }
    }
    // Settlement?
    for (const s of this.world.settlements) {
      if (!this.fogLifted(s.col, s.row) && s.kind !== 'player_castle') continue;
      if (Phaser.Math.Distance.Between(t.col, t.row, s.col, s.row) <= 2) {
        const status = s.kind === 'player_castle' ? 'Yours' : s.kind === 'ai_castle' ? 'Enemy hold' : s.kind === 'goblin_camp' ? 'Goblin camp' : s.kind === 'ruin' ? 'Ancient ruin' : 'Neutral';
        this.showTip(p, `${s.name}\n${status}`);
        // Highlight if within party interaction range.
        return;
      }
    }
    this.tip.setVisible(false);
  }

  showTip(p: Phaser.Input.Pointer, text: string) {
    this.tip.setText(text).setPosition(p.x, p.y - 8).setVisible(true);
  }

  // =========================================================================
  // SETTLEMENT interaction
  // =========================================================================
  settlementNearParty(): Settlement | null {
    let best: Settlement | null = null, bestD = Infinity;
    for (const s of this.world.settlements) {
      const d = Phaser.Math.Distance.Between(GameWorld.player.col, GameWorld.player.row, s.col, s.row);
      if (d <= SETTLE_RANGE && d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  promptEnterSettlement(s: Settlement) {
    if (this._modal) return;
    const fix = (o: any) => o.setScrollFactor(0).setDepth(HUD_DEPTH + 40);
    const els: any[] = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 0.55).setOrigin(0, 0).setInteractive()));
    const W = 380, H = 150, x = (GAME_W - W) / 2, y = (GAME_H - H) / 2;
    els.push(fix(this.add.rectangle(x, y, W, H, 0x1a1410, 0.99).setOrigin(0, 0).setStrokeStyle(3, 0xc9a14a, 0.9)));
    els.push(fix(this.add.text(GAME_W / 2, y + 22, `Enter ${s.name}?`, { fontFamily: 'Georgia, serif', fontSize: '18px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0)));
    const status = s.kind === 'player_castle' ? 'Your settlement' : s.kind === 'ai_castle' ? 'Enemy hold' : 'Neutral settlement';
    els.push(fix(this.add.text(GAME_W / 2, y + 52, status, { fontFamily: 'Georgia, serif', fontSize: '13px', color: '#cfc1a6' }).setOrigin(0.5, 0)));

    const yes = fix(this.add.rectangle(x + W / 2 - 90, y + H - 36, 150, 34, 0x1f5b3a).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
    els.push(yes, fix(this.add.text(x + W / 2 - 90, y + H - 36, 'Enter', { fontFamily: 'Georgia, serif', fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));
    const no = fix(this.add.rectangle(x + W / 2 + 90, y + H - 36, 150, 34, 0x6b3a26).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
    els.push(no, fix(this.add.text(x + W / 2 + 90, y + H - 36, 'Cancel', { fontFamily: 'Georgia, serif', fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));

    const closeModal = () => { els.forEach(o => o.destroy()); this._modal = null; };
    this._modal = closeModal;
    no.on('pointerdown', () => { this._uiClick = true; });
    no.on('pointerup', () => { this._uiClick = true; closeModal(); });
    yes.on('pointerdown', () => { this._uiClick = true; });
    yes.on('pointerup', () => { this._uiClick = true; closeModal(); this.enterSettlement(s); });
  }

  // Enter a settlement: store its id in shared state and launch the per-settlement
  // view (IsometricScene stand-in this phase). The stand-in's existing return path
  // (its menu/back) lands the player back on MainMenu→Continue; to guarantee a
  // clean RETURN to the continent we instead sleep this scene and resume on wake.
  enterSettlement(s: Settlement) {
    GameWorld.currentSettlementId = GameWorld.settlementId(s);
    // Prefer the real IsometricScene if it can boot clean; we launch it on top
    // and SLEEP the continent. A small Return overlay in the stand-in (or its own
    // exit) wakes us. To keep Phase 2 robustly boot-clean, we use a lightweight
    // in-scene overlay as the settlement view and a guaranteed Return button.
    this.openSettlementStandIn(s);
  }

  // A lightweight, guaranteed-boot-clean per-settlement overlay. (Phase 3 turns
  // this into a real local IsometricScene view; doing the full IsometricScene
  // boot here risks console errors mid-phase, so we ship the safe overlay that
  // still demonstrates the enter/leave round-trip via shared state.)
  openSettlementStandIn(s: Settlement) {
    if (this._settlementOverlay) return;
    const fix = (o: any) => o.setScrollFactor(0).setDepth(HUD_DEPTH + 60);
    const els: any[] = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x120c08, 1).setOrigin(0, 0).setInteractive()));
    // Simple illustrated "inside the settlement" panel.
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x1a1208, 1).setOrigin(0, 0)));
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      els.push(fix(this.add.rectangle(0, i * (GAME_H / 16), GAME_W, GAME_H / 16 + 1, Phaser.Display.Color.GetColor(Math.round(30 + t * 40), Math.round(22 + t * 28), Math.round(14 + t * 16)), 1).setOrigin(0, 0)));
    }
    els.push(fix(this.add.text(GAME_W / 2, GAME_H * 0.34, s.name, { fontFamily: 'serif', fontSize: '46px', color: '#e8c66a', fontStyle: 'bold', stroke: '#1a1206', strokeThickness: 8 }).setOrigin(0.5)));
    const status = s.kind === 'player_castle' ? 'Your settlement' : s.kind === 'ai_castle' ? 'An enemy stronghold' : 'A neutral settlement';
    els.push(fix(this.add.text(GAME_W / 2, GAME_H * 0.45, status, { fontFamily: 'Georgia, serif', fontSize: '18px', color: '#cfc1a6' }).setOrigin(0.5)));
    els.push(fix(this.add.text(GAME_W / 2, GAME_H * 0.52, 'Per-settlement view arrives in Phase 3.', { fontFamily: 'Georgia, serif', fontSize: '14px', color: '#9a8d72', fontStyle: 'italic' }).setOrigin(0.5)));

    const by = GAME_H * 0.66;
    const btn = fix(this.add.rectangle(GAME_W / 2, by, 240, 46, 0x6b4a26).setStrokeStyle(2, 0xe9d6a4, 0.9).setInteractive({ useHandCursor: true }));
    els.push(btn, fix(this.add.text(GAME_W / 2, by, 'Leave settlement', { fontFamily: 'Georgia, serif', fontSize: '16px', color: '#f5ecd2', fontStyle: 'bold' }).setOrigin(0.5)));
    btn.on('pointerover', () => btn.setFillStyle(0x82602f));
    btn.on('pointerout', () => btn.setFillStyle(0x6b4a26));
    const leave = () => {
      els.forEach(o => o.destroy());
      this._settlementOverlay = null;
      GameWorld.currentSettlementId = null;
    };
    btn.on('pointerdown', () => { this._uiClick = true; });
    btn.on('pointerup', () => { this._uiClick = true; leave(); });
    this._settlementOverlay = leave;
  }

  // PUBLIC test hook: programmatically leave any open settlement overlay.
  leaveSettlement() { if (this._settlementOverlay) this._settlementOverlay(); }

  // =========================================================================
  // BATTLE trigger
  // =========================================================================
  checkEnemyProximity() {
    let warn = false;
    for (const ai of GameWorld.aiParties) {
      const d = Phaser.Math.Distance.Between(GameWorld.player.col, GameWorld.player.row, ai.col, ai.row);
      if (d <= ENEMY_FIGHT_RANGE) { this.startBattle(ai); return; }
      if (d <= ENEMY_WARN_RANGE && this.fogLifted(Math.round(ai.col), Math.round(ai.row))) warn = true;
    }
    if (warn && !this._battleWarnShown) {
      this._battleWarnShown = true;
      this.flashBanner('Enemy army approaching!', 0x8c2b2b);
      this.time.delayedCall(2500, () => { this._battleWarnShown = false; });
    }
  }

  startBattle(ai: AIParty) {
    if (this._inBattle) return;
    this._inBattle = true;
    // Stop moving; remember where we are for the return drop.
    this.cancelPath();
    GameWorld.pendingBattle = {
      returnCol: GameWorld.player.col, returnRow: GameWorld.player.row,
      enemyPartyId: ai.id, enemyFaction: ai.factionKey,
    };
    // Build the enemy army from the AI estimate (mostly warriors + a few archers).
    const warriors = Math.max(1, Math.round(ai.armyEstimate * 0.7));
    const archers = Math.max(0, ai.armyEstimate - warriors);
    const enemyArmy = [{ type: 'warrior', count: warriors }];
    if (archers > 0) enemyArmy.push({ type: 'archer', count: archers });

    // Pause continent, launch BattleScene with the existing contract.
    this.scene.pause();
    this.scene.launch('BattleScene', {
      playerArmy: GameWorld.player.army.map(g => ({ type: g.type, count: g.count, battles: g.battles || 0 })),
      enemyArmy,
      terrainType: this.battleTerrain(),
      enemyFaction: ai.factionKey,
      onComplete: (res: any) => this.onBattleComplete(res, ai),
    });
  }

  battleTerrain(): string {
    const b = this.world.tileBiome[GameWorld.player.row * this.world.size + GameWorld.player.col];
    // Map biome → BattleScene terrain palette.
    switch (b) {
      case 7: case 9: return 'forest';      // LUSH/ALPINE FOREST
      case 8: case 10: return 'mountains';  // HIGHLAND/PEAK
      case 4: case 3: return 'wildlands';   // DESERT/SCRUBLAND
      default: return 'plains';
    }
  }

  onBattleComplete(res: any, ai: AIParty) {
    this._inBattle = false;
    try { this.scene.resume(); } catch (e) { /* ignore */ }
    // Restore survivors into the player party.
    if (res && Array.isArray(res.army)) {
      GameWorld.player.army = res.army.filter((g: any) => g.count > 0).map((g: any) => ({ type: g.type, count: g.count }));
      if (!GameWorld.player.army.length) GameWorld.player.army = [{ type: 'warrior', count: 1 }];
    }
    if (res && res.victory) {
      if (res.loot && res.loot.gold) GameWorld.gold += res.loot.gold;
      // Defeated enemy party leaves the map.
      const i = GameWorld.aiParties.indexOf(ai);
      if (i >= 0) GameWorld.aiParties.splice(i, 1);
      this.flashBanner('Victory! The enemy host is broken.', 0x2a7a4f);
    } else {
      // Push the player back home-ward a little on defeat.
      this.flashBanner('Your army was defeated.', 0x8c2b2b);
      // Move the enemy party off so it doesn't instantly re-trigger.
      ai.col = Phaser.Math.Clamp(ai.col + 6, 1, this.world.size - 2);
      GameWorld.pickAIObjective(ai);
    }
    GameWorld.pendingBattle = null;
    // Drop back on the continent at the battle location (already there).
    const pp = this.tileToPx(GameWorld.player.col, GameWorld.player.row);
    this.cameras.main.centerOn(pp.x, pp.y);
  }

  // =========================================================================
  // Banner / tutorial / menu
  // =========================================================================
  flashBanner(text: string, color: number) {
    this.banner.setText(text).setBackgroundColor('#' + (color & 0xffffff).toString(16).padStart(6, '0') + 'dd').setVisible(true).setAlpha(1);
    this.tweens.killTweensOf(this.banner);
    this.tweens.add({ targets: this.banner, alpha: 0, delay: 2000, duration: 700, onComplete: () => this.banner.setVisible(false) });
  }

  showTutorialOnce() {
    let seen = false;
    try { seen = !!localStorage.getItem('kg_continent_tut'); } catch (e) { /* ignore */ }
    if (seen) return;
    try { localStorage.setItem('kg_continent_tut', '1'); } catch (e) { /* ignore */ }
    this.time.delayedCall(600, () => {
      this.flashBanner('Left-click to march · right-drag to pan · wheel to zoom · click a town to enter', 0x6b4a26);
    });
  }

  toMainMenu() {
    if (this._closing) return;
    this._closing = true;
    // Detach every chunk Image from its texture BEFORE we tear textures down, so
    // no Image renders a removed CanvasTexture during the fade (canvas renderer
    // would crash on a null frame). update() is already short-circuited by
    // _closing, so nothing rebinds them.
    this.detachChunkImages();
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.time.delayedCall(280, () => {
      this.scene.start('MainMenuScene'); // SHUTDOWN handler (onShutdown) frees textures
    });
  }

  // Point all chunk images (active + pooled) at the permanent blank texture and
  // hide them, so they hold no reference to a chunk texture about to be removed.
  detachChunkImages() {
    if (this.activeChunkImgs) {
      for (const img of this.activeChunkImgs.values()) { try { img.setTexture('continent_blank').setVisible(false); } catch (e) { /* ignore */ } }
      this.activeChunkImgs.clear();
    }
    if (this.chunkPool) {
      for (const img of this.chunkPool) { try { img.setTexture('continent_blank').setVisible(false); } catch (e) { /* ignore */ } }
    }
    if (this.fogImg) { try { this.fogImg.setVisible(false); } catch (e) { /* ignore */ } }
  }

  onShutdown() {
    this._closing = true;
    this.detachChunkImages();
    try { this.chunks && this.chunks.destroy(); } catch (e) { /* ignore */ }
    if (this._modal) { try { this._modal(); } catch (e) { /* ignore */ } }
    if (this._settlementOverlay) { try { this._settlementOverlay(); } catch (e) { /* ignore */ } }
  }

  // The minimap dots are refreshed in update via updateMinimap, but update() does
  // a lot; keep the call here so it always runs after layout.
  postUpdate() { /* reserved */ }
}
