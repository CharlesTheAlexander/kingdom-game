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
import { PioneerSystem } from '../systems/PioneerSystem.js';
import type { PioneerParty, WorkerParty, AIParty as AIPartyT } from '../systems/GameWorld.js';
import { ExpeditionSystem } from '../systems/ExpeditionSystem.js';
import { HeroWorld } from '../systems/HeroWorld.js';
import { WorldDiplomacy } from '../systems/WorldDiplomacy.js';
import type { LeaderLine } from '../systems/WorldDiplomacy.js';
import { LateGame } from '../systems/LateGame.js';
import type { EmissaryParty } from '../systems/GameWorld.js';
import { generateHeroPortraits, generatePortraits } from '../systems/AssetGenerator.js';

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

    // (Phase 9) Bridge / broken-bridge / ferry-dock icons drawn on the river
    // lines, below the moving-party icons. Re-laid each frame in layoutIcons().
    this.bridgeLayer = this.add.container(0, 0).setDepth(28);
    // --- Party + AI icons in world space ----------------------------------
    this.iconLayer = this.add.container(0, 0).setDepth(30);
    this.partyIcon = this.add.container(0, 0).setDepth(40);
    this.buildPartyIcon();

    // (Phase 6) Hero portrait textures (hero_aldric…) are normally only baked by
    // the per-settlement scene's generateAll(); the continent draws everything
    // procedurally, so bake JUST the hero portraits here so we can stamp them as
    // small overlay icons on the party / settlement icons + in dialogue popups.
    if (!this.textures.exists('hero_aldric')) {
      try { generateHeroPortraits(this); } catch (e) { /* portraits optional */ }
    }
    // Hero portrait overlay icons (stacked on the player party icon), laid out
    // each frame in layoutIcons(). A separate container above the AI icon layer.
    this.heroOverlay = this.add.container(0, 0).setDepth(45);
    // (Phase 6) Re-bind the hero roster to a fresh world host so it never points
    // at a stale per-settlement scene, and so passives recompute against GameWorld.
    GameWorld.rebindHeroes();
    GameWorld.heroes.applyPassives();

    // (Phase 7) Bake the three leader portraits (portrait_red/purple/yellow) for
    // the diplomacy panel + leader speech popups, re-home diplomacy/leaders to a
    // fresh world host, and wire the speech / panel-refresh hooks so the world-level
    // Diplomacy + FactionLeaders can surface lines on the continent.
    if (!this.textures.exists('portrait_red')) {
      try { generatePortraits(this); } catch (e) { /* portraits optional */ }
    }
    GameWorld.initDiplomacy();
    GameWorld.rebindDiplomacy();
    WorldDiplomacy.ensure(); // apply banked caravan-raid deltas + seed memory
    GameWorld._leaderSpeechHook = (faction: string, line: string) =>
      this.showLeaderSpeech({ faction, name: WorldDiplomacy.leaderName(faction), portrait: 'portrait_' + faction, text: line });
    GameWorld._diploPanelHook = () => { if (this._diploPanel) this.openDiplomacyPanel(); };

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

    // --- Pioneer movement state (Phase 4) ---------------------------------
    // Per-pioneer A* path cache (keyed by pioneer id). Each entry holds the
    // remaining tile steps + sub-step progress + the destination it was planned
    // for, so we only re-path when a pioneer's destination changes.
    this._pioneerPaths = new Map();
    this._pioneerIcons = new Map(); // id -> { container, badge }

    // --- Worker movement state (Phase 5) — same per-id A* cache as pioneers. --
    this._workerPaths = new Map();
    // (Phase 5) Turn ~1 in 2 of the existing merchant AI parties into raidable
    // laden caravans so the player has caravan targets from the start.
    this.seedCaravans();

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
    // (Phase 9) Apply bridge/ferry crossing costs to the pathfinder so routes
    // prefer bridges over slow fords from the very first click.
    this.syncRiverCrossings();

    this.cameras.main.fadeIn(300, 12, 18, 26);

    // First-time tutorial hint.
    this.showTutorialOnce();

    // Clean shutdown.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.onShutdown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.onShutdown());

    // (Phase 3) Resume cleanly when the player leaves a settlement (we slept on
    // entry). on() not once() because the player may enter/leave many times.
    this.events.on(Phaser.Scenes.Events.WAKE, () => this.onWake());
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.onWake());
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

    // (Phase 4) Clicked a pioneer party? Arrived → found prompt; travelling →
    // select it so the next click GUIDES it to a new destination tile.
    for (const pio of GameWorld.pioneers) {
      if (pio.status === 'founded' || pio.status === 'lost') continue;
      if (Phaser.Math.Distance.Between(t.col, t.row, pio.col, pio.row) <= 2) {
        if (pio.status === 'arrived') { this.promptFound(pio); }
        else { this._selectedPioneerId = pio.id; this.flashBanner('Pioneer selected — click a tile to set their course.', 0x6b4a26); }
        return;
      }
    }

    // (Phase 4) A pioneer is selected → this click GUIDES it to the chosen tile.
    if (this._selectedPioneerId) {
      const sel = GameWorld.pioneers.find((x: PioneerParty) => x.id === this._selectedPioneerId);
      this._selectedPioneerId = null;
      if (sel && sel.status !== 'founded' && sel.status !== 'lost') {
        PioneerSystem.guidePioneer(sel.id, t.col, t.row);
        this.flashBanner('Pioneers set out for their new home.', 0x2a7a4f);
        return;
      }
    }

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

    // --- Pioneer parties (Phase 4): real-time travel + goblin ambush -------
    this.updatePioneers(delta);

    // --- Worker parties (Phase 5): travel → mine → return + ruin digs ------
    this.updateWorkers(delta);
    this.tickRuinDigs(dayDelta);

    // --- Emissary parties (Phase 8): travel toward a faction → embassy/capture
    const emBanners = LateGame.tickEmissaries(dayDelta);
    for (const b of emBanners) this.flashBanner(b.text, b.color);

    // --- (Phase 6) Biome-entry hero dialogue -----------------------------
    // When the party crosses into a biome a hero reacts to (forest/mountain/
    // winter-by-season), fire a contextual line (throttled inside HeroWorld).
    this.checkBiomeDialogue();

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

    // --- (Phase 6) HERO daily ticks --------------------------------------
    // 1. Arrivals (first hero ~day 8, others via their conditions). Heroes that
    //    join travel WITH the party; surface a welcome banner + dialogue.
    const joined = HeroWorld.tickArrivals();
    for (const id of joined) {
      const h = GameWorld.heroes.byId(id);
      if (h) {
        this.flashBanner(`${h.name}, ${h.title}, has joined your host!`, 0xc9a14a);
        LateGame.chronicleHeroJoined(h.name, h.title); // (Phase 8) record the event
      }
    }
    // 2. Hero quests: auto-start eligible quests (notification + travelable marker)
    //    and auto-complete any whose marker the party reached.
    const qev = HeroWorld.tickQuests();
    for (const e of qev) {
      if (e.type === 'started') { this.flashBanner(`Hero Quest — ${e.title}`, 0xffe08a); this._fogDirty = true; }
      else this.flashBanner(`Quest complete: ${e.title}`, 0x2a7a4f);
    }
    // 3. Occasional hero-hero banter when a pair travels together.
    const inter = HeroWorld.tryInteraction();
    if (inter) this.showHeroConversation(inter);
    // 4. Contextual low-supply / low-gold remarks (throttled by HeroWorld).
    if (GameWorld.player.supply <= 3) this.fireHeroDialogue('low_supply');
    else if (GameWorld.gold < 80) this.fireHeroDialogue('low_gold');

    // --- (Phase 7) DIPLOMACY daily tick ----------------------------------
    // Accrue honor for treaties upheld over time, drift relations, surface any
    // time-based memory event (e.g. Elowen's 10-day intel share), and refresh an
    // open diplomacy panel.
    WorldDiplomacy.onNewDay();
    if (this._diploPanel) this.openDiplomacyPanel();

    // --- (Phase 8) LATE-GAME daily tick ----------------------------------
    // Resolve a finished tournament, run the Legendary Forge, warm embassies,
    // fire any stage-transition events (8/9), and keep the army cap synced.
    // Surface every resulting beat as a banner (+leader bubbles at stage 9).
    const lgBanners = LateGame.onNewDay();
    for (const b of lgBanners) this.flashBanner(b.text, b.color);

    // --- (Phase 9) RIVER daily tick: complete any 5-day bridge rebuilds, then
    // re-sync the pathfinder's per-tile crossing costs + bridge icons.
    GameWorld.tickRivers();
    this.syncRiverCrossings();
    // At the stage-9 message beat, also pop the three leader speech bubbles.
    if (GameWorld.lateGameFlags._stage9SpeechPending) {
      GameWorld.lateGameFlags._stage9SpeechPending = false;
      this.popStage9LeaderSpeech();
    }
    if (this._realmPanel) this.openRealmPanel(); // refresh an open Realm/Chronicle panel
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
  // PIONEER parties (Phase 4) — advance each along an A* path using the SAME
  // per-biome movement budget as the player party, then run the goblin ambush
  // proximity model. Pioneers that reach their destination flip to 'arrived'.
  // =========================================================================
  updatePioneers(delta: number) {
    const dayDelta = delta / DAY_MS;
    // Drop cached paths/icons for pioneers that no longer exist (founded/lost).
    const live = new Set<string>(GameWorld.pioneers.map(p => p.id));
    for (const id of Array.from(this._pioneerPaths.keys()) as string[]) if (!live.has(id)) this._pioneerPaths.delete(id);

    for (const p of GameWorld.pioneers) {
      if (p.status !== 'travelling') continue;
      // (Re)plan if we have no cached path, or the destination changed.
      let pc = this._pioneerPaths.get(p.id);
      if (!pc || pc.destCol !== p.destCol || pc.destRow !== p.destRow) {
        const startC = Math.round(p.col), startR = Math.round(p.row);
        const res = this.pathfinder.find(startC, startR, p.destCol, p.destRow);
        pc = { path: res.path.slice(), sub: 0, destCol: p.destCol, destRow: p.destRow };
        this._pioneerPaths.set(p.id, pc);
        // Snap onto the integer start tile so motion is consistent.
        p.col = startC; p.row = startR;
      }
      // No path (already there, or unreachable) → mark arrived if at destination.
      if (!pc.path.length) {
        if (Math.hypot(p.destCol - p.col, p.destRow - p.row) <= 1.5) p.status = 'arrived';
        continue;
      }
      // Advance along the path on the same tile budget as the player party.
      let tileBudget = dayDelta * BASE_TILES_PER_DAY * 0.85; // slightly slower (laden carts)
      while (tileBudget > 0 && pc.path.length) {
        const next = pc.path[0];
        const cost = Math.max(0.5, this.pathfinder.tileCost(next.col, next.row));
        const tileFraction = tileBudget / cost;
        const remaining = 1 - pc.sub;
        if (tileFraction >= remaining) {
          tileBudget -= remaining * cost;
          p.col = next.col; p.row = next.row;
          pc.sub = 0;
          pc.path.shift();
          if (!pc.path.length) { p.status = 'arrived'; break; }
        } else {
          pc.sub += tileFraction;
          tileBudget = 0;
        }
      }
    }

    // Goblin ambush proximity model (documented in PioneerSystem.tickAmbush).
    const lost = PioneerSystem.tickAmbush(dayDelta);
    if (lost.length) {
      this.flashBanner('Pioneer party was ambushed!', 0x8c2b2b);
      for (const p of lost) { this._pioneerPaths.delete(p.id); this.removePioneerIcon(p.id); }
    }
  }

  // PUBLIC test hook: instantly fast-forward a pioneer to its destination tile and
  // mark it 'arrived' (so headless tests don't need to simulate minutes of travel).
  fastForwardPioneer(id: string): boolean {
    const p = GameWorld.pioneers.find((x: PioneerParty) => x.id === id);
    if (!p || p.status === 'founded' || p.status === 'lost') return false;
    p.col = p.destCol; p.row = p.destRow; p.status = 'arrived';
    this._pioneerPaths.delete(id);
    return true;
  }

  removePioneerIcon(id: string) {
    const ic = this._pioneerIcons.get(id);
    if (ic) { try { ic.container.destroy(); } catch (e) { /* ignore */ } this._pioneerIcons.delete(id); }
  }

  // =========================================================================
  // WORKER parties (Phase 5) — reuse the EXACT pioneer movement framework: an
  // A* path per worker, advanced on the per-biome tile budget, then hand the
  // AT-DESTINATION state machine (mine / return / deposit) + goblin-proximity
  // damage to ExpeditionSystem.tickWorkers. Workers have NO combat (vulnerable).
  // =========================================================================
  updateWorkers(delta: number) {
    const dayDelta = delta / DAY_MS;
    // Drop cached paths for workers that no longer exist (done/lost).
    const live = new Set<string>(GameWorld.workers.map((p: WorkerParty) => p.id));
    for (const id of Array.from(this._workerPaths.keys()) as string[]) if (!live.has(id)) this._workerPaths.delete(id);

    for (const p of GameWorld.workers) {
      // Only MOVING states path-find; 'mining' parks on the deposit tile.
      if (p.status !== 'outbound' && p.status !== 'returning') continue;
      let pc = this._workerPaths.get(p.id);
      if (!pc || pc.destCol !== p.destCol || pc.destRow !== p.destRow) {
        const startC = Math.round(p.col), startR = Math.round(p.row);
        const res = this.pathfinder.find(startC, startR, p.destCol, p.destRow);
        pc = { path: res.path.slice(), sub: 0, destCol: p.destCol, destRow: p.destRow };
        this._workerPaths.set(p.id, pc);
        p.col = startC; p.row = startR;
      }
      if (pc.path.length) {
        let tileBudget = dayDelta * BASE_TILES_PER_DAY * 0.8; // laden miners, a touch slow
        while (tileBudget > 0 && pc.path.length) {
          const next = pc.path[0];
          const cost = Math.max(0.5, this.pathfinder.tileCost(next.col, next.row));
          const tileFraction = tileBudget / cost;
          const remaining = 1 - pc.sub;
          if (tileFraction >= remaining) {
            tileBudget -= remaining * cost;
            p.col = next.col; p.row = next.row;
            pc.sub = 0; pc.path.shift();
          } else { pc.sub += tileFraction; tileBudget = 0; }
        }
      }
    }

    // State machine (arrive→mine→return→deposit) + ambush, in ExpeditionSystem.
    const events = ExpeditionSystem.tickWorkers(dayDelta);
    for (const e of events) {
      if (e.type === 'arrived') this.notifyExpedition(`Workers reached the ${e.worker.resource} deposit.`, 0x6b7a3a, e.worker.col, e.worker.row);
      else if (e.type === 'deposited') this.notifyExpedition(`Workers delivered ${e.worker.carrying} ${e.worker.resource} home!`, 0x2a7a4f, e.worker.col, e.worker.row);
      else if (e.type === 'lost') { this.notifyExpedition('A worker party was wiped out by goblins!', 0x8c2b2b, e.worker.col, e.worker.row); this._workerPaths.delete(e.worker.id); }
    }
  }

  // PUBLIC test hook: fast-forward a worker through its WHOLE lifecycle (travel →
  // mine → return → deposit) so headless tests need not simulate minutes of time.
  fastForwardWorker(id: string): boolean {
    const p = GameWorld.workers.find((x: WorkerParty) => x.id === id);
    if (!p) return false;
    // Snap to deposit, mine instantly, snap home, deposit instantly.
    p.col = p.depositCol; p.row = p.depositRow;
    p.status = 'mining'; p.mineDaysLeft = 0;
    this._workerPaths.delete(id);
    ExpeditionSystem.tickWorkers(0.0001); // arrive→mining handled; complete mine
    // After mining completes it is 'returning'; snap it home and deposit.
    const w2 = GameWorld.workers.find((x: WorkerParty) => x.id === id);
    if (w2 && w2.status === 'returning') {
      w2.col = w2.destCol; w2.row = w2.destRow;
      this._workerPaths.delete(id);
      ExpeditionSystem.tickWorkers(0.0001);
    }
    return true;
  }

  // (Phase 5) Advance any in-flight ruin digs; on completion fire a reward notice.
  tickRuinDigs(dayDelta: number) {
    const done = ExpeditionSystem.tickRuinExploration(dayDelta);
    for (const d of done) {
      this.notifyExpedition(`${d.ruin.name}: ${d.reward.summary}`, 0xc9a14a, d.ruin.col, d.ruin.row);
    }
  }

  // =========================================================================
  // CARAVANS (Phase 5) — flag a slice of merchant AI parties as laden caravans.
  // =========================================================================
  seedCaravans() {
    let n = 0;
    for (const ai of GameWorld.aiParties as AIPartyT[]) {
      if (ai.isCaravan) { n++; continue; }
      if (ai.personality === 'merchant' && (n < 3)) { ExpeditionSystem.makeCaravan(ai); n++; }
    }
    // Guarantee at least one caravan exists even with no merchant factions, by
    // converting the first non-aggressive party.
    if (n === 0) {
      const cand = (GameWorld.aiParties as AIPartyT[]).find(a => a.personality !== 'aggressive');
      if (cand) ExpeditionSystem.makeCaravan(cand);
    }
  }

  // =========================================================================
  // EXPEDITION proximity prompts (ruins / goblin camps / mercenary camps).
  // =========================================================================
  checkExpeditionProximity() {
    if (this._modal || this._inBattle) return;
    for (const s of this.world.settlements) {
      const d = Phaser.Math.Distance.Between(GameWorld.player.col, GameWorld.player.row, s.col, s.row);
      if (d > 1.6) continue;
      const id = GameWorld.settlementId(s);
      if (s.kind === 'ruin' && !GameWorld.exploredRuins[id] && !ExpeditionSystem.isExploring(id)) {
        ExpeditionSystem.discover('ruin', s.name, s.col, s.row);
        if (this._expoPromptId !== id) { this._expoPromptId = id; this.promptExploreRuin(s); }
        return;
      }
      if (s.kind === 'goblin_camp' && !GameWorld.clearedCamps[id]) {
        ExpeditionSystem.discover('goblin_camp', s.name, s.col, s.row);
        if (this._expoPromptId !== id) { this._expoPromptId = id; this.promptRaidCamp(s); }
        return;
      }
      if (s.kind === 'mercenary') {
        ExpeditionSystem.discover('mercenary', s.name, s.col, s.row);
        if (this._expoPromptId !== id) { this._expoPromptId = id; this.promptHireMercs(s); }
        return;
      }
    }
    // Out of range of everything → allow the next prompt to fire again.
    this._expoPromptId = null;
  }

  // --- Modal: explore a ruin ----------------------------------------------
  promptExploreRuin(ruin: Settlement) {
    const id = GameWorld.settlementId(ruin);
    // (Phase 6) A hero reacts to arriving at ruins. The 7th ruin (Tomas' quest)
    // gets a special beat handled by the quest reward, so a plain ruins line here.
    this.fireHeroDialogue('ruins');
    this.openChoiceModal(`Explore ${ruin.name}?`, 'An ancient ruin lies before you. Exploring takes ~1 day.', 'Explore', () => {
      const res = ExpeditionSystem.exploreRuin(id);
      if (res.ok) this.flashBanner(`Exploring ${ruin.name}… (~${res.etaDays} day)`, 0xc9a14a);
      else this.flashBanner(res.reason || 'Cannot explore.', 0x8c2b2b);
    });
  }

  // --- Modal: raid a goblin camp (launches BattleScene) -------------------
  promptRaidCamp(camp: Settlement) {
    const id = GameWorld.settlementId(camp);
    // (Phase 6) Hero reaction to goblins; a fortress (Mira's hidden 7th) is graver.
    this.fireHeroDialogue((camp as any).fortress ? 'goblin_fortress' : 'goblin');
    this.openChoiceModal(`Raid ${camp.name}?`, 'A goblin warband holds this camp. Defeat them to clear it and take their loot.', 'Attack', () => {
      this.startCampRaid(camp);
    });
  }

  startCampRaid(camp: Settlement) {
    if (this._inBattle) return;
    const id = GameWorld.settlementId(camp);
    const res = ExpeditionSystem.raidCamp(id);
    if (!res.ok || !res.goblinArmy) { this.flashBanner(res.reason || 'Cannot raid.', 0x8c2b2b); return; }
    this._inBattle = true;
    this.cancelPath();
    GameWorld.pendingBattle = {
      returnCol: GameWorld.player.col, returnRow: GameWorld.player.row,
      enemyPartyId: null, enemyFaction: 'goblin',
    };
    // Reuse the existing BattleScene launch contract (same as startBattle).
    this.scene.pause();
    this.scene.launch('BattleScene', {
      playerArmy: GameWorld.player.army.map(g => ({ type: g.type, count: g.count, battles: g.battles || 0 })),
      enemyArmy: res.goblinArmy,
      terrainType: this.battleTerrain(),
      enemyFaction: 'goblin',
      intel: this.computeIntel('goblin'),           // (Phase 9) pre-battle fog level
      riverBattle: this.battleOnRiver(),            // (Phase 9) river runs across the field
      onComplete: (br: any) => this.onCampRaidComplete(br, id, camp),
    });
  }

  onCampRaidComplete(res: any, campId: string, camp: Settlement) {
    this._inBattle = false;
    try { this.scene.resume(); } catch (e) { /* ignore */ }
    if (res && Array.isArray(res.army)) {
      GameWorld.player.army = res.army.filter((g: any) => g.count > 0).map((g: any) => ({ type: g.type, count: g.count }));
      if (!GameWorld.player.army.length) GameWorld.player.army = [{ type: 'warrior', count: 1 }];
    }
    if (res && res.victory) {
      const loot = ExpeditionSystem.onCampRaidWon(campId, res.loot || null);
      this.notifyExpedition(`${camp.name} cleared! Plundered ${loot.gold} gold, ${loot.iron} iron.`, 0x2a7a4f, camp.col, camp.row);
    } else {
      this.flashBanner('The goblins held the camp.', 0x8c2b2b);
    }
    GameWorld.pendingBattle = null;
    const pp = this.tileToPx(GameWorld.player.col, GameWorld.player.row);
    this.cameras.main.centerOn(pp.x, pp.y);
  }

  // --- Modal: hire mercenaries --------------------------------------------
  promptHireMercs(camp: Settlement) {
    const id = GameWorld.settlementId(camp);
    const rate = ExpeditionSystem.MERC_COST_PER_HEAD;
    const batch = Math.min(ExpeditionSystem.MERC_MAX_HIRE, Math.max(1, Math.floor(GameWorld.gold / rate)), 10);
    this.openChoiceModal(`${camp.name}`, `Sellswords for hire — ${rate} gold each.\nHire ${batch} veteran warrior${batch === 1 ? '' : 's'} for ${batch * rate} gold?`, `Hire ${batch}`, () => {
      const res = ExpeditionSystem.hireMercenaries(id, batch);
      if (res.ok) this.notifyExpedition(`Hired ${res.hired} mercenaries for ${res.cost} gold.`, 0x2a7a4f, camp.col, camp.row);
      else this.flashBanner(res.reason || 'Cannot hire.', 0x8c2b2b);
    });
  }

  // --- Modal: raid a caravan (simple resolve) -----------------------------
  promptCaravanRaid(caravan: AIPartyT) {
    if (this._modal || this._inBattle) return;
    if (this._caravanPromptId === caravan.id) return;
    this._caravanPromptId = caravan.id;
    const fac = this.world.factions.find((f: any) => f.key === caravan.factionKey);
    this.openChoiceModal('Raid Enemy Caravan?', `A ${fac ? fac.name : caravan.factionKey} supply train! Raiding steals its goods but sours relations (-20).`, 'Raid', () => {
      const res = ExpeditionSystem.raidCaravan(caravan.id);
      this._caravanPromptId = null;
      if (!res.ok) { this.flashBanner(res.reason || 'Cannot raid.', 0x8c2b2b); return; }
      if (res.victory && res.loot) {
        this.notifyExpedition(`Caravan raided! +${res.loot.gold}g +${res.loot.wood}w +${res.loot.stone}s +${res.loot.iron}i (-20 ${res.faction})`, 0x2a7a4f, GameWorld.player.col, GameWorld.player.row);
      } else {
        this.flashBanner('The caravan guard drove you off.', 0x8c2b2b);
      }
    }, () => { this._caravanPromptId = null; });
  }

  // Generic two-button confirm modal (warm UI, matches promptEnterSettlement).
  openChoiceModal(title: string, body: string, confirmLabel: string, onConfirm: () => void, onCancel?: () => void) {
    if (this._modal) return;
    const fix = (o: any) => o.setScrollFactor(0).setDepth(HUD_DEPTH + 40);
    const els: any[] = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 0.55).setOrigin(0, 0).setInteractive()));
    const W = 420, H = 178, x = (GAME_W - W) / 2, y = (GAME_H - H) / 2;
    els.push(fix(this.add.rectangle(x, y, W, H, 0x1a1410, 0.99).setOrigin(0, 0).setStrokeStyle(3, 0xc9a14a, 0.9)));
    els.push(fix(this.add.text(GAME_W / 2, y + 20, title, { fontFamily: 'Georgia, serif', fontSize: '18px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0)));
    els.push(fix(this.add.text(GAME_W / 2, y + 56, body, { fontFamily: 'Georgia, serif', fontSize: '13px', color: '#cfc1a6', align: 'center', wordWrap: { width: W - 44 } }).setOrigin(0.5, 0)));
    const yes = fix(this.add.rectangle(x + W / 2 - 95, y + H - 38, 160, 34, 0x1f5b3a).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
    els.push(yes, fix(this.add.text(x + W / 2 - 95, y + H - 38, confirmLabel, { fontFamily: 'Georgia, serif', fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));
    const no = fix(this.add.rectangle(x + W / 2 + 95, y + H - 38, 160, 34, 0x6b3a26).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
    els.push(no, fix(this.add.text(x + W / 2 + 95, y + H - 38, 'Not now', { fontFamily: 'Georgia, serif', fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));
    const close = () => { els.forEach(o => o.destroy()); this._modal = null; };
    this._modal = close;
    no.on('pointerdown', () => { this._uiClick = true; });
    no.on('pointerup', () => { this._uiClick = true; close(); if (onCancel) onCancel(); });
    yes.on('pointerdown', () => { this._uiClick = true; });
    yes.on('pointerup', () => { this._uiClick = true; close(); onConfirm(); });
  }

  // (Phase 5) Notification that ALSO surfaces inside a settlement view (if the
  // player is in a town) via the GameWorld/IsometricScene notify hook, and on the
  // continent as a flash banner. Offers a continent-switch when inside a town.
  notifyExpedition(text: string, color: number, _col?: number, _row?: number) {
    this.flashBanner(text, color);
    // If the player is currently INSIDE a settlement, route the message to the
    // per-settlement view (which appends "(open the map)") and queue it too.
    if (GameWorld.currentSettlementId != null) {
      GameWorld.notify(text + '  ·  (open the continent map)', color);
      try {
        const iso: any = this.scene.get('IsometricScene');
        if (iso && this.scene.isActive('IsometricScene') && iso.notify) iso.notify(text + '  ·  (open the map)', color);
      } catch (e) { /* ignore */ }
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

    // (Phase 4) Founded-settlement flag icons. The chunk overview texture was
    // baked at world-gen, so settlements created AFTER (player-founded camps) are
    // not in it — we draw a distinct planted-flag marker for them here, in the
    // player colour, so they appear on the continent the instant they are founded.
    const sc = 1 / this.zoom * 0.9 + 0.1;
    for (const s of this.world.settlements) {
      if (!(s as any).founded) continue; // only player-founded camps
      const sp = this.tileToPx(s.col, s.row);
      const fg = this.add.graphics();
      fg.fillStyle(0x1a120a, 0.5); fg.fillEllipse(0, 8, 16, 6);   // shadow
      fg.lineStyle(2, 0x4a3318, 1); fg.lineBetween(0, 9, 0, -14); // flag pole
      fg.fillStyle(GameWorld.playerColor, 1);                     // pennant in player colour
      fg.fillTriangle(0, -14, 0, -4, 13, -9);
      fg.lineStyle(1.2, 0xf5ecd2, 0.9); fg.strokeTriangle(0, -14, 0, -4, 13, -9);
      fg.setPosition(sp.x, sp.y);
      fg.setScale(sc);
      this.iconLayer.add(fg);
    }

    // (Phase 4) Pioneer cart/wagon icons (always visible — they are the player's
    // own parties). A wagon body + wheels + a small HP pip, in the player colour.
    for (const p of GameWorld.pioneers) {
      if (p.status === 'founded' || p.status === 'lost') continue;
      const wp = this.tileToPx(p.col, p.row);
      const g = this.add.graphics();
      g.fillStyle(0x1a120a, 0.5); g.fillEllipse(0, 7, 22, 6);     // shadow
      // wagon canopy
      g.fillStyle(0xf2e8cf, 1);
      g.fillRoundedRect(-9, -10, 18, 9, 3);
      g.lineStyle(1.2, 0x6b4a26, 0.95); g.strokeRoundedRect(-9, -10, 18, 9, 3);
      // wagon bed in player colour
      g.fillStyle(GameWorld.playerColor, 1); g.fillRect(-10, -1, 20, 4);
      g.lineStyle(1, 0x2a1c0c, 0.8); g.strokeRect(-10, -1, 20, 4);
      // wheels
      g.fillStyle(0x2a1c0c, 1); g.fillCircle(-6, 4, 2.6); g.fillCircle(6, 4, 2.6);
      // HP pip (green→red) above the cart
      const hpFrac = Math.max(0, Math.min(1, p.hp / p.maxHp));
      const hpCol = hpFrac > 0.5 ? 0x4ad06b : hpFrac > 0.25 ? 0xe6c84a : 0xd64a4a;
      g.fillStyle(0x000000, 0.5); g.fillRect(-9, -16, 18, 3);
      g.fillStyle(hpCol, 1); g.fillRect(-9, -16, 18 * hpFrac, 3);
      g.setPosition(wp.x, wp.y);
      g.setScale(sc);
      this.iconLayer.add(g);
    }

    // (Phase 5) WORKER party icons — a pickaxe disc in the player colour with an
    // HP pip. Distinct from the pioneer cart so the three player party types
    // (crown / cart / pickaxe) read apart at a glance.
    for (const p of GameWorld.workers as WorkerParty[]) {
      if (p.status === 'done' || p.status === 'lost') continue;
      const wp = this.tileToPx(p.col, p.row);
      const g = this.add.graphics();
      g.fillStyle(0x1a120a, 0.5); g.fillEllipse(0, 7, 18, 6);          // shadow
      g.fillStyle(GameWorld.playerColor, 1); g.fillCircle(0, -2, 8);   // disc
      g.lineStyle(1.5, 0xf5ecd2, 0.9); g.strokeCircle(0, -2, 8);
      // pickaxe motif: a haft + a curved head (two short strokes).
      g.lineStyle(1.6, 0xfff0c8, 0.95);
      g.lineBetween(-4, 2, 4, -6);            // haft
      g.lineBetween(2, -7, 6, -4);            // head right
      g.lineBetween(2, -7, -1, -8);           // head left
      // mining pulse ring while parked at the deposit.
      if (p.status === 'mining') { g.lineStyle(1.2, 0xffe08a, 0.7); g.strokeCircle(0, -2, 11); }
      // HP pip.
      const hpFrac = Math.max(0, Math.min(1, p.hp / p.maxHp));
      const hpCol = hpFrac > 0.5 ? 0x4ad06b : hpFrac > 0.25 ? 0xe6c84a : 0xd64a4a;
      g.fillStyle(0x000000, 0.5); g.fillRect(-9, -16, 18, 3);
      g.fillStyle(hpCol, 1); g.fillRect(-9, -16, 18 * hpFrac, 3);
      g.setPosition(wp.x, wp.y);
      g.setScale(sc);
      this.iconLayer.add(g);
    }

    // (Phase 5) MERCENARY CAMP icons (tent) + CARAVAN icons (cargo wagon) +
    // EXPLORED-RUIN markers. Merc camps & caravans aren't in the baked overview
    // texture, so (like founded colonies) we draw them live here.
    // -- Mercenary camps (tent) --
    for (const s of this.world.settlements) {
      if (s.kind !== 'mercenary') continue;
      if (!this.fogLifted(s.col, s.row)) continue;
      const mp = this.tileToPx(s.col, s.row);
      const tg = this.add.graphics();
      tg.fillStyle(0x1a120a, 0.5); tg.fillEllipse(0, 8, 18, 6);        // shadow
      tg.fillStyle(0x9a6b3a, 1);                                       // tent canvas
      tg.fillTriangle(0, -12, -11, 6, 11, 6);
      tg.lineStyle(1.4, 0x3a2810, 0.95); tg.strokeTriangle(0, -12, -11, 6, 11, 6);
      tg.lineStyle(1.4, 0x2a1c0c, 0.9); tg.lineBetween(0, -12, 0, 6);  // centre seam
      tg.fillStyle(0x2a1c0c, 1); tg.fillTriangle(-3, 6, 3, 6, 0, -2);  // doorway
      tg.setPosition(mp.x, mp.y); tg.setScale(sc);
      this.iconLayer.add(tg);
    }
    // -- Explored-ruin markers (a distinct open-archway glyph) --
    for (const s of this.world.settlements) {
      if (s.kind !== 'ruin') continue;
      const id = GameWorld.settlementId(s);
      if (!GameWorld.exploredRuins[id]) continue;       // unexplored ruins are in the baked texture
      if (!this.fogLifted(s.col, s.row)) continue;
      const rp = this.tileToPx(s.col, s.row);
      const rg = this.add.graphics();
      rg.fillStyle(0x1a120a, 0.5); rg.fillEllipse(0, 7, 16, 5);
      rg.lineStyle(2, 0xc9a14a, 1);
      rg.strokeRect(-7, -10, 14, 16);                   // archway frame
      rg.lineBetween(-7, -10, 0, -15); rg.lineBetween(7, -10, 0, -15); // broken pediment
      rg.fillStyle(0x2a7a4f, 1); rg.fillCircle(0, -2, 3); // green "cleared" gem
      rg.setPosition(rp.x, rp.y); rg.setScale(sc);
      this.iconLayer.add(rg);
    }
    // -- Cleared goblin-camp markers (skull crossed out) --
    for (const s of this.world.settlements) {
      if (s.kind !== 'goblin_camp') continue;
      const id = GameWorld.settlementId(s);
      if (!GameWorld.clearedCamps[id]) continue;
      if (!this.fogLifted(s.col, s.row)) continue;
      const cp = this.tileToPx(s.col, s.row);
      const cg = this.add.graphics();
      cg.fillStyle(0x1a120a, 0.5); cg.fillEllipse(0, 7, 16, 5);
      cg.fillStyle(0x6b6b6b, 1); cg.fillCircle(0, -2, 7);  // grey ash skull
      cg.lineStyle(2, 0x8c2b2b, 0.9); cg.lineBetween(-7, -9, 7, 5); // struck through
      cg.setPosition(cp.x, cp.y); cg.setScale(sc);
      this.iconLayer.add(cg);
    }
    // -- Caravans (cargo wagon, enemy faction colour) --
    for (const ai of GameWorld.aiParties as AIPartyT[]) {
      if (!ai.isCaravan) continue;
      if (!this.fogLifted(Math.round(ai.col), Math.round(ai.row))) continue;
      const cp = this.tileToPx(ai.col, ai.row);
      const cg = this.add.graphics();
      cg.fillStyle(0x1a120a, 0.5); cg.fillEllipse(0, 7, 22, 6);
      cg.fillStyle(0xb9924a, 1); cg.fillRect(-10, -8, 20, 9);   // cargo crate body
      cg.lineStyle(1.2, ai.color, 1); cg.strokeRect(-10, -8, 20, 9);
      cg.lineStyle(1, 0x5a3f1c, 0.9); cg.lineBetween(-10, -3, 10, -3); // crate band
      cg.fillStyle(0x2a1c0c, 1); cg.fillCircle(-6, 3, 2.4); cg.fillCircle(6, 3, 2.4); // wheels
      cg.setPosition(cp.x, cp.y); cg.setScale(sc);
      this.iconLayer.add(cg);
    }

    // (Phase 8) GRAND TOURNAMENT grounds near the home castle while active —
    // a cluster of striped tents + a tall pennant flag, in festive colours, so
    // the player can see the festival from the continent.
    const tour = GameWorld.tournament;
    if (tour.active) {
      const tp = this.tileToPx(tour.col, tour.row);
      const g = this.add.graphics();
      g.fillStyle(0x1a120a, 0.4); g.fillEllipse(0, 12, 44, 12);          // grounds shadow
      // Three tents (left/centre/right).
      const tent = (ox: number, col: number, h: number) => {
        g.fillStyle(col, 1); g.fillTriangle(ox, -h, ox - 9, 6, ox + 9, 6);
        g.lineStyle(1.2, 0x3a2810, 0.95); g.strokeTriangle(ox, -h, ox - 9, 6, ox + 9, 6);
        g.fillStyle(0xf5ecd2, 1); g.fillTriangle(ox, -h, ox - 9, 6, ox - 1, 6); // stripe
      };
      tent(-16, 0xc23b3b, 14); tent(16, 0x3b6bc2, 14); tent(0, 0xd6b33b, 20);
      // Central pennant flag (player colour) on a tall pole.
      g.lineStyle(2, 0x4a3318, 1); g.lineBetween(0, 6, 0, -30);
      g.fillStyle(GameWorld.playerColor, 1); g.fillTriangle(0, -30, 0, -20, 14, -25);
      g.lineStyle(1.2, 0xf5ecd2, 0.9); g.strokeTriangle(0, -30, 0, -20, 14, -25);
      g.setPosition(tp.x, tp.y); g.setScale(sc);
      this.iconLayer.add(g);
    }

    // (Phase 8) EMISSARY parties — a scroll/envelope icon in the target faction
    // colour, travelling toward that faction. Captured emissaries show a red bar.
    for (const em of LateGame.liveEmissaries() as EmissaryParty[]) {
      const ep = this.tileToPx(em.col, em.row);
      const g = this.add.graphics();
      g.fillStyle(0x1a120a, 0.5); g.fillEllipse(0, 7, 16, 5);            // shadow
      // parchment scroll body
      g.fillStyle(0xf2e8cf, 1); g.fillRoundedRect(-8, -8, 16, 12, 2);
      g.lineStyle(1.2, 0x6b4a26, 0.95); g.strokeRoundedRect(-8, -8, 16, 12, 2);
      // wax seal in the faction colour
      g.fillStyle(em.color, 1); g.fillCircle(0, -2, 3.2);
      g.lineStyle(1, 0x2a1c0c, 0.8); g.strokeCircle(0, -2, 3.2);
      if (em.status === 'captured') { g.lineStyle(2, 0x8c2b2b, 0.95); g.lineBetween(-8, -8, 8, 4); } // struck-through = captive
      g.setPosition(ep.x, ep.y); g.setScale(sc);
      this.iconLayer.add(g);
    }

    // (Phase 8) Standing EMBASSY markers at faction castles (a small banner pair
    // in player + faction colour) so the player can see where embassies stand.
    for (const fk of Object.keys(GameWorld.embassies)) {
      const f = this.world.factions.find(x => x.key === fk);
      if (!f) continue;
      if (!this.fogLifted(f.castleCol, f.castleRow)) continue;
      const bp = this.tileToPx(f.castleCol, f.castleRow);
      const g = this.add.graphics();
      g.lineStyle(1.6, 0x4a3318, 1); g.lineBetween(-4, 4, -4, -12);
      g.fillStyle(GameWorld.playerColor, 1); g.fillTriangle(-4, -12, -4, -5, 6, -8.5);
      g.lineStyle(1.6, 0x4a3318, 1); g.lineBetween(4, 4, 4, -8);
      g.fillStyle(f.color, 1); g.fillTriangle(4, -8, 4, -2, 12, -5);
      g.setPosition(bp.x, bp.y); g.setScale(sc * 0.9);
      this.iconLayer.add(g);
    }

    // (Phase 6) Active hero-quest markers (gold stars) into the icon layer.
    this.layoutQuestMarkers(sc);
    // (Phase 6) Hero portrait overlays on the party icon + stationed settlements.
    this.layoutHeroIcons();
    // (Phase 9) Bridge / broken-bridge / ferry-dock icons on the river lines.
    this.layoutRiverIcons(sc);
  }

  // =========================================================================
  // (Phase 9) RIVER SYSTEM rendering + pathfinder cost sync.
  // =========================================================================
  /** Push bridge/ferry crossing costs into the pathfinder as per-tile overrides:
   *  an intact bridge crosses fast (~1.0×), a ferry dock's adjacent river tile is
   *  medium (~1.5×), a destroyed bridge reverts to the slow ~2.5× ford (no override).
   *  Called on create, on every new day, and whenever a bridge/ferry changes. */
  syncRiverCrossings() {
    if (!this.pathfinder) return;
    this.pathfinder.clearTileOverrides();
    // Intact bridges → cheap crossing.
    for (const b of this.world.bridges) {
      if (GameWorld.isBridgeDestroyed(b.id)) continue; // destroyed → keep ford cost
      this.pathfinder.setTileOverride(b.col, b.row, 1.0);
    }
    // Ferry docks → reduce the adjacent river tile(s) to ~1.5×, but never override
    // a bridge tile (a bridge is already faster).
    for (const d of GameWorld.ferryDocks) {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        const c = d.col + dc, r = d.row + dr;
        if (this.world.tileBiome[r * this.world.size + c] !== 11) continue; // RIVER only
        const onBridge = this.world.bridges.some(b => b.col === c && b.row === r && !GameWorld.isBridgeDestroyed(b.id));
        if (!onBridge) this.pathfinder.setTileOverride(c, r, 1.5);
      }
    }
  }

  /** Draw bridge (intact / broken) + ferry-dock icons on the continent. Only on
   *  river tiles whose fog is lifted; scaled to keep readable at any zoom. */
  layoutRiverIcons(sc: number) {
    if (!this.bridgeLayer) return;
    this.bridgeLayer.removeAll(true);
    // -- Bridges (plank deck) / broken bridges (gap) --
    for (const b of this.world.bridges) {
      if (!this.fogLifted(b.col, b.row)) continue;
      const bp = this.tileToPx(b.col, b.row);
      const g = this.add.graphics();
      const destroyed = GameWorld.isBridgeDestroyed(b.id);
      if (destroyed) {
        // Broken bridge: two stubs with a gap + a faint X.
        g.fillStyle(0x6b4a26, 1); g.fillRect(-9, -2, 6, 4); g.fillRect(3, -2, 6, 4);
        g.lineStyle(1.4, 0x3a2810, 0.9); g.strokeRect(-9, -2, 6, 4); g.strokeRect(3, -2, 6, 4);
        g.lineStyle(1.6, 0x8c2b2b, 0.95); g.lineBetween(-4, -5, 4, 5); // struck-through
      } else {
        // Intact bridge: a planked deck spanning the river + two rail posts.
        g.fillStyle(0x9a6b3a, 1); g.fillRect(-10, -3, 20, 6);
        g.lineStyle(1.2, 0x3a2810, 0.95); g.strokeRect(-10, -3, 20, 6);
        for (let px = -8; px <= 8; px += 4) g.lineBetween(px, -3, px, 3); // planks
        g.fillStyle(0x6b4a26, 1); g.fillRect(-11, -5, 2, 4); g.fillRect(9, -5, 2, 4); // rail posts
      }
      g.setPosition(bp.x, bp.y); g.setScale(sc);
      this.bridgeLayer.add(g);
    }
    // -- Ferry docks (a pier + a small boat) --
    for (const d of GameWorld.ferryDocks) {
      if (!this.fogLifted(d.col, d.row)) continue;
      const dp = this.tileToPx(d.col, d.row);
      const g = this.add.graphics();
      g.fillStyle(0x6b4a26, 1); g.fillRect(-2, -8, 4, 10);           // pier post
      g.lineStyle(1, 0x3a2810, 0.9); g.strokeRect(-2, -8, 4, 10);
      g.fillStyle(0x8a5a2a, 1);                                       // boat hull
      g.beginPath(); g.moveTo(-9, 4); g.lineTo(9, 4); g.lineTo(6, 9); g.lineTo(-6, 9); g.closePath(); g.fillPath();
      g.lineStyle(1, 0x3a2810, 0.9); g.strokePath();
      g.fillStyle(GameWorld.playerColor, 1); g.fillTriangle(0, -6, 0, 2, 6, -2); // pennant
      g.setPosition(dp.x, dp.y); g.setScale(sc);
      this.bridgeLayer.add(g);
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

    // (Phase 5) Expedition panel toggle (left of the menu button).
    const eb = fix(this.add.rectangle(GAME_W - 70, by + 34, 120, 26, 0x4a3a6b).setStrokeStyle(2, 0xe9d6a4, 0.9).setInteractive({ useHandCursor: true }));
    fix(this.add.text(GAME_W - 70, by + 34, 'Expeditions (E)', { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#f5ecd2', fontStyle: 'bold' }).setOrigin(0.5));
    eb.on('pointerover', () => eb.setFillStyle(0x5d4a86));
    eb.on('pointerout', () => eb.setFillStyle(0x4a3a6b));
    eb.on('pointerdown', () => { this._uiClick = true; });
    eb.on('pointerup', () => { this._uiClick = true; this.toggleExpeditionPanel(); });
    this.input.keyboard?.on('keydown-E', () => this.toggleExpeditionPanel());

    // (Phase 6) Heroes panel toggle (roster + station/recall). H key + button.
    const hb = fix(this.add.rectangle(GAME_W - 70, by + 68, 120, 26, 0x6b4a26).setStrokeStyle(2, 0xe9d6a4, 0.9).setInteractive({ useHandCursor: true }));
    fix(this.add.text(GAME_W - 70, by + 68, 'Heroes (H)', { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#f5ecd2', fontStyle: 'bold' }).setOrigin(0.5));
    hb.on('pointerover', () => hb.setFillStyle(0x82602f));
    hb.on('pointerout', () => hb.setFillStyle(0x6b4a26));
    hb.on('pointerdown', () => { this._uiClick = true; });
    hb.on('pointerup', () => { this._uiClick = true; this.openHeroPanel(); });
    this.input.keyboard?.on('keydown-H', () => this.openHeroPanel());

    // (Phase 7) Diplomacy panel toggle (relations + leader memory + honor). D key.
    const db = fix(this.add.rectangle(GAME_W - 70, by + 102, 120, 26, 0x4a3a6b).setStrokeStyle(2, 0xe9d6a4, 0.9).setInteractive({ useHandCursor: true }));
    fix(this.add.text(GAME_W - 70, by + 102, 'Diplomacy (D)', { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#f5ecd2', fontStyle: 'bold' }).setOrigin(0.5));
    db.on('pointerover', () => db.setFillStyle(0x5d4a86));
    db.on('pointerout', () => db.setFillStyle(0x4a3a6b));
    db.on('pointerdown', () => { this._uiClick = true; });
    db.on('pointerup', () => { this._uiClick = true; this.toggleDiplomacyPanel(); });
    this.input.keyboard?.on('keydown-D', () => this.toggleDiplomacyPanel());

    // (Phase 8) Realm panel toggle — late-game actions (Grand Tournament,
    // Legendary Forge, Emissaries, Imperial Proclamation) + the Chronicle. R key.
    const rb = fix(this.add.rectangle(GAME_W - 70, by + 136, 120, 26, 0x6b4a26).setStrokeStyle(2, 0xe9d6a4, 0.9).setInteractive({ useHandCursor: true }));
    fix(this.add.text(GAME_W - 70, by + 136, 'Realm (R)', { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#f5ecd2', fontStyle: 'bold' }).setOrigin(0.5));
    rb.on('pointerover', () => rb.setFillStyle(0x82602f));
    rb.on('pointerout', () => rb.setFillStyle(0x6b4a26));
    rb.on('pointerdown', () => { this._uiClick = true; });
    rb.on('pointerup', () => { this._uiClick = true; this.toggleRealmPanel(); });
    this.input.keyboard?.on('keydown-R', () => this.toggleRealmPanel());

    // (Phase 9) Build a Ferry Dock at the party's current tile if it sits on a
    // river bank. Speeds that river's crossing to ~1.5×. B key.
    this.input.keyboard?.on('keydown-B', () => this.promptBuildFerry());
  }

  // (Phase 9) Offer to build a ferry dock when the party stands on a river bank.
  promptBuildFerry() {
    if (this._modal) return;
    const col = GameWorld.player.col, row = GameWorld.player.row;
    if (GameWorld.adjacentRiverIndex(col, row) < 0) { this.flashBanner('March onto a river bank to build a ferry.', 0x8c2b2b); return; }
    this.openChoiceModal('Build a Ferry Dock?', 'A ferry here speeds your hosts across this river (~1.5× cost). Costs 60 wood from your nearest settlement.', 'Build', () => {
      const res = GameWorld.buildFerryDock(col, row);
      if (res.ok) { this.syncRiverCrossings(); this.flashBanner('Ferry dock raised — the crossing is swifter.', 0x2a7a4f); }
      else this.flashBanner(res.reason || 'Cannot build here.', 0x8c2b2b);
    });
  }

  // =========================================================================
  // EXPEDITION PANEL (Phase 5) — Active journeys + Discovered locations + a
  // Quick-travel button (spend gold to send the main party to a known location).
  // Built lazily on first toggle; rebuilt each open so contents are fresh.
  // =========================================================================
  toggleExpeditionPanel() {
    if (this._expoPanel) { this.closeExpeditionPanel(); return; }
    this.openExpeditionPanel();
  }

  closeExpeditionPanel() {
    if (this._expoPanel) { this._expoPanel.forEach((o: any) => { try { o.destroy(); } catch (e) { /* ignore */ } }); this._expoPanel = null; }
  }

  openExpeditionPanel() {
    this.closeExpeditionPanel();
    const fix = (o: any) => o.setScrollFactor(0).setDepth(HUD_DEPTH + 25);
    const els: any[] = [];
    const W = 360, H = 420, x = 14, y = 80;
    els.push(fix(this.add.rectangle(x, y, W, H, 0x201608, 0.96).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.9)));
    els.push(fix(this.add.rectangle(x, y, W, 30, 0x3a2a10, 1).setOrigin(0, 0)));
    els.push(fix(this.add.text(x + 12, y + 7, 'Expeditions', { fontFamily: 'Georgia, serif', fontSize: '15px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0, 0)));
    const close = fix(this.add.text(x + W - 22, y + 6, '✕', { fontFamily: 'Georgia, serif', fontSize: '16px', color: '#e9d6a4' }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true }));
    close.on('pointerdown', () => { this._uiClick = true; });
    close.on('pointerup', () => { this._uiClick = true; this.closeExpeditionPanel(); });
    els.push(close);

    let cy = y + 40;
    const head = (t: string) => { els.push(fix(this.add.text(x + 12, cy, t, { fontFamily: 'Georgia, serif', fontSize: '13px', color: '#e0b84a', fontStyle: 'bold' }).setOrigin(0, 0))); cy += 20; };
    const line = (t: string, col = '#cfc1a6') => { els.push(fix(this.add.text(x + 18, cy, t, { fontFamily: 'Georgia, serif', fontSize: '12px', color: col, wordWrap: { width: W - 36 } }).setOrigin(0, 0))); cy += 17; };

    // --- Active journeys --------------------------------------------------
    head('Active Journeys');
    const mainRemaining = this.estimateRemainingCost ? (this.path && this.path.length ? this.estimateRemainingCost() : 0) : 0;
    const active = ExpeditionSystem.activeExpeditions(mainRemaining);
    if (!active.length) line('No parties travelling.', '#8a7e62');
    else for (const a of active.slice(0, 8)) {
      const glyph = a.kind === 'main' ? '♛' : a.kind === 'pioneer' ? '⛟' : '⛏';
      line(`${glyph} ${a.label} — ${a.purpose} (~${a.etaDays}d)`);
    }
    cy += 6;

    // --- Discovered locations --------------------------------------------
    head('Discovered Locations');
    const disc = ExpeditionSystem.discoveredLocations();
    if (!disc.length) line('Explore the map to discover sites.', '#8a7e62');
    else for (const d of disc.slice(0, 9)) {
      const tag = d.kind === 'ruin' ? 'Ruin' : d.kind === 'goblin_camp' ? 'Goblin Camp' : d.kind === 'mercenary' ? 'Merc Camp' : d.kind === 'deposit' ? 'Deposit' : d.kind;
      line(`• ${d.name} (${tag})`);
    }
    cy += 8;

    // --- Quick-travel -----------------------------------------------------
    const qtCost = ExpeditionSystem.quickTravelCost();
    const qbtnY = y + H - 40;
    const qb = fix(this.add.rectangle(x + W / 2, qbtnY, W - 28, 32, disc.length ? 0x1f5b3a : 0x39393f).setOrigin(0.5, 0).setStrokeStyle(2, 0xf0e6c8, 0.8).setInteractive({ useHandCursor: !!disc.length }));
    els.push(qb, fix(this.add.text(x + W / 2, qbtnY + 16, `Quick-travel to a site (${qtCost} gold)`, { fontFamily: 'Georgia, serif', fontSize: '13px', color: disc.length ? '#fff' : '#888', fontStyle: 'bold' }).setOrigin(0.5)));
    qb.on('pointerdown', () => { this._uiClick = true; });
    qb.on('pointerup', () => { this._uiClick = true; if (disc.length) { this.closeExpeditionPanel(); this.openQuickTravelMenu(disc); } });

    this._expoPanel = els;
  }

  // A compact list-picker: choose a discovered location, pay the gold, and the
  // main party auto-paths there via the existing pathfinder (moveTo).
  openQuickTravelMenu(disc: Array<{ id: string; kind: string; name: string; col: number; row: number }>) {
    const fix = (o: any) => o.setScrollFactor(0).setDepth(HUD_DEPTH + 40);
    const els: any[] = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 0.55).setOrigin(0, 0).setInteractive()));
    const items = disc.slice(0, 8);
    const W = 380, rowH = 34, H = 70 + items.length * rowH, x = (GAME_W - W) / 2, y = (GAME_H - H) / 2;
    els.push(fix(this.add.rectangle(x, y, W, H, 0x1a1410, 0.99).setOrigin(0, 0).setStrokeStyle(3, 0xc9a14a, 0.9)));
    els.push(fix(this.add.text(GAME_W / 2, y + 14, `Quick-travel (${ExpeditionSystem.quickTravelCost()} gold)`, { fontFamily: 'Georgia, serif', fontSize: '16px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0)));
    const close = () => { els.forEach(o => o.destroy()); this._modal = null; };
    this._modal = close;
    items.forEach((d, i) => {
      const ry = y + 44 + i * rowH;
      const row = fix(this.add.rectangle(x + 14, ry, W - 28, rowH - 6, 0x2a2014, 1).setOrigin(0, 0).setStrokeStyle(1, 0x6b4a26, 0.8).setInteractive({ useHandCursor: true }));
      els.push(row, fix(this.add.text(x + 24, ry + 7, `${d.name}  (${d.col}, ${d.row})`, { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#e6d8b8' }).setOrigin(0, 0)));
      row.on('pointerover', () => row.setFillStyle(0x3a2c18));
      row.on('pointerout', () => row.setFillStyle(0x2a2014));
      row.on('pointerdown', () => { this._uiClick = true; });
      row.on('pointerup', () => {
        this._uiClick = true;
        const res = ExpeditionSystem.quickTravel(d.col, d.row);
        close();
        if (!res.ok) { this.flashBanner(res.reason || 'Cannot travel.', 0x8c2b2b); return; }
        this.followParty = true;
        this.moveTo(d.col, d.row);
        this.flashBanner(`Main host sets out for ${d.name}.`, 0x2a7a4f);
      });
    });
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
      else if (s.kind === 'ruin') col = 0xc9a14a;          // (Phase 5) ruins
      else if (s.kind === 'mercenary') col = 0xe08a3a;     // (Phase 5) merc camps
      g.fillStyle(col, 1); g.fillRect(p.x - 1, p.y - 1, 3, 3);
    }
    // AI parties (where fog lifted).
    for (const ai of GameWorld.aiParties) {
      if (!this.fogLifted(Math.round(ai.col), Math.round(ai.row))) continue;
      const p = toMM(ai.col, ai.row);
      g.fillStyle(ai.color, 1); g.fillCircle(p.x, p.y, 1.6);
    }
    // (Phase 4) Pioneer parties — small player-coloured diamonds.
    for (const pio of GameWorld.pioneers) {
      if (pio.status === 'founded' || pio.status === 'lost') continue;
      const p = toMM(pio.col, pio.row);
      g.fillStyle(0xffffff, 0.9); g.fillRect(p.x - 1.6, p.y - 1.6, 3.2, 3.2);
      g.fillStyle(this.colorOf(GameWorld.playerColor), 1); g.fillRect(p.x - 1, p.y - 1, 2, 2);
    }
    // (Phase 5) Worker parties — small player-coloured squares with a tan border.
    for (const wk of GameWorld.workers as WorkerParty[]) {
      if (wk.status === 'done' || wk.status === 'lost') continue;
      const p = toMM(wk.col, wk.row);
      g.fillStyle(0xffe08a, 0.9); g.fillRect(p.x - 1.6, p.y - 1.6, 3.2, 3.2);
      g.fillStyle(this.colorOf(GameWorld.playerColor), 1); g.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6);
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
    // (Phase 4) Pioneer party? Tooltip = purpose + destination + ETA.
    for (const pio of GameWorld.pioneers) {
      if (pio.status === 'founded' || pio.status === 'lost') continue;
      if (Phaser.Math.Distance.Between(t.col, t.row, pio.col, pio.row) <= 2) {
        const eta = this.pioneerETA(pio);
        const dest = `${Math.round(pio.destCol)}, ${Math.round(pio.destRow)}`;
        const etaLine = pio.status === 'arrived' ? 'Arrived — ready to found'
          : `ETA ~${eta} day${eta === 1 ? '' : 's'}`;
        this.showTip(p, `Pioneer Party\n→ founding site (${dest})\n${etaLine}\nHP ${Math.ceil(pio.hp)}/${pio.maxHp}`);
        return;
      }
    }
    // (Phase 5) Worker party? Tooltip = purpose + carried haul + HP.
    for (const wk of GameWorld.workers as WorkerParty[]) {
      if (wk.status === 'done' || wk.status === 'lost') continue;
      if (Phaser.Math.Distance.Between(t.col, t.row, wk.col, wk.row) <= 2) {
        const line = wk.status === 'mining' ? `Mining ${wk.resource} (~${Math.max(0, Math.ceil(wk.mineDaysLeft))}d left)`
          : wk.status === 'returning' ? `Returning ${wk.carrying} ${wk.resource} home`
          : `En route to a ${wk.resource} deposit`;
        this.showTip(p, `Worker Party\n${line}\nHP ${Math.ceil(wk.hp)}/${wk.maxHp}`);
        return;
      }
    }
    // AI party / caravan?
    for (const ai of GameWorld.aiParties as AIPartyT[]) {
      if (!this.fogLifted(Math.round(ai.col), Math.round(ai.row))) continue;
      if (Phaser.Math.Distance.Between(t.col, t.row, ai.col, ai.row) <= 2) {
        const fac = this.world.factions.find((f: any) => f.key === ai.factionKey);
        if (ai.isCaravan) {
          this.showTip(p, `${fac ? fac.name : ai.factionKey} Caravan\nLaden supply train (guard ${ai.armyEstimate})\nIntercept to raid`);
        } else {
          this.showTip(p, `${fac ? fac.name : ai.factionKey}\nEst. army ${ai.armyEstimate}\n${ai.destLabel}`);
        }
        return;
      }
    }
    // Settlement?
    for (const s of this.world.settlements) {
      if (!this.fogLifted(s.col, s.row) && s.kind !== 'player_castle') continue;
      if (Phaser.Math.Distance.Between(t.col, t.row, s.col, s.row) <= 2) {
        const founded = !!(s as any).founded;
        const sid = GameWorld.settlementId(s);
        const status = founded ? 'Founded colony'
          : s.kind === 'player_castle' ? 'Yours'
          : s.kind === 'ai_castle' ? 'Enemy hold'
          : s.kind === 'goblin_camp' ? (GameWorld.clearedCamps[sid] ? 'Goblin camp (cleared)' : 'Goblin camp — raidable')
          : s.kind === 'ruin' ? (GameWorld.exploredRuins[sid] ? 'Ancient ruin (explored)' : 'Ancient ruin — explorable')
          : s.kind === 'mercenary' ? 'Mercenary camp — hire here'
          : 'Neutral';
        // (Phase 4) Show the colony's specialty label (from its SettlementState).
        let extra = '';
        if (founded) {
          const stt = GameWorld.settlementStates[GameWorld.settlementId(s)];
          if (stt && stt.specialty) extra = `\n${stt.specialty}`;
        }
        this.showTip(p, `${s.name}\n${status}${extra}`);
        // Highlight if within party interaction range.
        return;
      }
    }
    // (Phase 9) River tile? Show the crossing cost (ford / bridge / broken / ferry).
    if (this.fogLifted(t.col, t.row) && t.col >= 0 && t.row >= 0 &&
        this.world.tileBiome[t.row * this.world.size + t.col] === 11) {
      const bridge = this.world.bridges.find(b => b.col === t.col && b.row === t.row);
      const ferry = GameWorld.ferryDocks.some(d => Phaser.Math.Distance.Between(t.col, t.row, d.col, d.row) <= 1.5);
      let kind: string, mult: string;
      if (bridge && !GameWorld.isBridgeDestroyed(bridge.id)) { kind = 'Bridge crossing'; mult = '×1.0 (fast)'; }
      else if (bridge) { kind = 'Broken bridge — fording'; mult = '×2.5 (slow)'; }
      else if (ferry) { kind = 'Ferry crossing'; mult = '×1.5'; }
      else { kind = 'River ford'; mult = '×2.5 (slow)'; }
      this.showTip(p, `River\n${kind}\nMovement ${mult}`);
      return;
    }
    this.tip.setVisible(false);
  }

  showTip(p: Phaser.Input.Pointer, text: string) {
    this.tip.setText(text).setPosition(p.x, p.y - 8).setVisible(true);
  }

  // (Phase 4) Rough ETA in days for a travelling pioneer from its cached path.
  pioneerETA(pio: PioneerParty): number {
    const pc = this._pioneerPaths.get(pio.id);
    if (!pc || !pc.path || !pc.path.length) {
      // No cached path → estimate from straight-line distance on plains cost.
      const d = Math.hypot(pio.destCol - pio.col, pio.destRow - pio.row);
      return Math.max(1, Math.round(d / BASE_TILES_PER_DAY));
    }
    let cost = (1 - (pc.sub || 0)) * Math.max(0.5, this.pathfinder.tileCost(pc.path[0].col, pc.path[0].row));
    for (let i = 1; i < pc.path.length; i++) cost += Math.max(0.5, this.pathfinder.tileCost(pc.path[i].col, pc.path[i].row));
    return Math.max(1, Math.round(cost / (BASE_TILES_PER_DAY * 0.85)));
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

  // =========================================================================
  // PIONEER founding (Phase 4) — "Found Settlement Here?" + a name input.
  // Validates the site (passable, ≥15 tiles from any settlement, not in enemy
  // territory), shows the destination biome's specialty, takes a name, and on
  // confirm calls PioneerSystem.tryFound → a new player colony on the continent.
  // =========================================================================
  promptFound(pio: PioneerParty) {
    if (this._modal) return;
    const col = Math.round(pio.col), row = Math.round(pio.row);
    const valid = PioneerSystem.canFoundAt(col, row);
    const biome = this.world.tileBiome[row * this.world.size + col];
    const spec = PioneerSystem.specialtyForBiome(biome);

    const fix = (o: any) => o.setScrollFactor(0).setDepth(HUD_DEPTH + 40);
    const els: any[] = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 0.6).setOrigin(0, 0).setInteractive()));
    const W = 420, H = 220, x = (GAME_W - W) / 2, y = (GAME_H - H) / 2;
    els.push(fix(this.add.rectangle(x, y, W, H, 0x1a1410, 0.99).setOrigin(0, 0).setStrokeStyle(3, 0xc9a14a, 0.9)));
    els.push(fix(this.add.text(GAME_W / 2, y + 18, 'Found Settlement Here?', { fontFamily: 'Georgia, serif', fontSize: '19px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0)));
    const biomeName = biomeData(biome).displayName;
    els.push(fix(this.add.text(GAME_W / 2, y + 48, `${biomeName} site  ·  ${spec.label} (+25% ${spec.resource})`, { fontFamily: 'Georgia, serif', fontSize: '13px', color: '#cfc1a6' }).setOrigin(0.5, 0)));

    // DOM name input (canvas-scaling-robust, same approach as KingCreationScene).
    const input = document.createElement('input');
    input.type = 'text'; input.placeholder = 'Name your colony'; input.value = 'Newhaven'; input.maxLength = 24;
    input.style.cssText = `position:fixed;left:50%;transform:translateX(-50%);top:${window.innerHeight / 2 - 18}px;width:280px;padding:7px 9px;font-family:Georgia,serif;font-size:14px;z-index:9999;background:#0e1219;color:#fff;border:1px solid #c9a14a;border-radius:4px;text-align:center;`;
    document.body.appendChild(input);
    input.focus(); input.select();

    const reason = valid.ok ? '' : valid.reason || 'Cannot settle here.';
    if (reason) els.push(fix(this.add.text(GAME_W / 2, y + 96, reason, { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#ff9a9a', align: 'center', wordWrap: { width: W - 40 } }).setOrigin(0.5, 0)));

    const found = fix(this.add.rectangle(x + W / 2 - 95, y + H - 40, 160, 36, valid.ok ? 0x1f5b3a : 0x39393f).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: valid.ok }));
    els.push(found, fix(this.add.text(x + W / 2 - 95, y + H - 40, 'Found', { fontFamily: 'Georgia, serif', fontSize: '14px', color: valid.ok ? '#fff' : '#888', fontStyle: 'bold' }).setOrigin(0.5)));
    const cancel = fix(this.add.rectangle(x + W / 2 + 95, y + H - 40, 160, 36, 0x6b3a26).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
    els.push(cancel, fix(this.add.text(x + W / 2 + 95, y + H - 40, 'Cancel', { fontFamily: 'Georgia, serif', fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));

    const closeModal = () => {
      els.forEach(o => o.destroy());
      try { input.remove(); } catch (e) { /* ignore */ }
      this._modal = null;
    };
    this._modal = closeModal;
    cancel.on('pointerdown', () => { this._uiClick = true; });
    cancel.on('pointerup', () => { this._uiClick = true; closeModal(); });
    found.on('pointerdown', () => { this._uiClick = true; });
    found.on('pointerup', () => {
      this._uiClick = true;
      if (!valid.ok) return;
      const name = input.value;
      closeModal();
      const res = PioneerSystem.tryFound(pio.id, name);
      this._pioneerPaths.delete(pio.id);
      this.removePioneerIcon(pio.id);
      if (res.ok && res.settlement) {
        // Reveal the new colony, recentre, and offer to enter it.
        this.revealCircle(res.settlement.col, res.settlement.row, FOG_REVEAL);
        this._fogDirty = true;
        this.flashBanner(`${res.settlement.name} founded!`, 0x2a7a4f);
        this.time.delayedCall(120, () => { if (!this._closing && res.settlement) this.promptEnterSettlement(res.settlement); });
      } else {
        this.flashBanner(res.reason || 'Could not found here.', 0x8c2b2b);
      }
    });
  }

  // Enter a settlement: store its id in shared state and launch the REAL
  // per-settlement view (IsometricScene, Phase 3). We SLEEP the continent so it
  // keeps its full state (camera, fog, AI) and resumes instantly on return; the
  // settlement scene wakes us via leaveToContinent(). Sleeping (not pausing) frees
  // the GPU while inside the town yet preserves all display objects.
  enterSettlement(s: Settlement) {
    if (this._closing || this._enteringSettlement) return;
    const id = GameWorld.settlementId(s);
    GameWorld.currentSettlementId = id;
    this._enteringSettlement = true;
    // Detach chunk images before sleeping so a later texture eviction can't leave
    // a dangling frame under the canvas renderer while we are away.
    this.detachChunkImages();
    this.cameras.main.fadeOut(260, 0, 0, 0);
    this.time.delayedCall(280, () => {
      this._enteringSettlement = false;
      // Launch the local settlement view on top, then put the continent to sleep.
      this.scene.launch('IsometricScene', { settlementId: id });
      this.scene.sleep();
    });
  }

  // When the continent WAKES (player left a settlement, or returned from a scene),
  // re-attach chunk images, recentre on the player, and fade back in.
  onWake() {
    this._closing = false;
    this._enteringSettlement = false;
    // Recentre on the player (they may have moved to the settlement's tile).
    const pp = this.tileToPx(GameWorld.player.col, GameWorld.player.row);
    this.cameras.main.centerOn(pp.x, pp.y);
    this.refreshChunks();
    this.revealAroundPlayer();
    this.rebuildFog();
    this.updateHud();
    this.cameras.main.fadeIn(260, 12, 18, 26);
  }

  // PUBLIC test hook: leave the active settlement view (delegates to the scene).
  leaveSettlement() {
    const iso: any = this.scene.get('IsometricScene');
    if (iso && this.scene.isActive('IsometricScene') && iso.leaveToContinent) iso.leaveToContinent();
  }

  // =========================================================================
  // BATTLE trigger
  // =========================================================================
  checkEnemyProximity() {
    let warn = false;
    for (const ai of GameWorld.aiParties) {
      const d = Phaser.Math.Distance.Between(GameWorld.player.col, GameWorld.player.row, ai.col, ai.row);
      // (Phase 5) A laden enemy caravan within reach → offer a quick RAID (not a
      // pitched BattleScene). Only prompt once per interception (guarded by id).
      if (ai.isCaravan) {
        if (d <= ENEMY_FIGHT_RANGE) { this.promptCaravanRaid(ai); return; }
        if (d <= ENEMY_WARN_RANGE && this.fogLifted(Math.round(ai.col), Math.round(ai.row))) warn = true;
        continue;
      }
      if (d <= ENEMY_FIGHT_RANGE) { this.startBattle(ai); return; }
      if (d <= ENEMY_WARN_RANGE && this.fogLifted(Math.round(ai.col), Math.round(ai.row))) warn = true;
    }
    // (Phase 5) Expedition-target proximity: ruins (explore), goblin camps (raid),
    // mercenary camps (hire). Surfaces a contextual prompt when the main party is
    // parked on/adjacent to one. Cheap: bails out the instant a modal is open.
    this.checkExpeditionProximity();
    if (warn && !this._battleWarnShown) {
      this._battleWarnShown = true;
      this.flashBanner('Enemy army approaching!', 0x8c2b2b);
      this.time.delayedCall(2500, () => { this._battleWarnShown = false; });
    }
  }

  startBattle(ai: AIParty) {
    if (this._inBattle) return;
    this._inBattle = true;
    // (Phase 6) A hero reacts to entering battle; faction-territory beats fire too.
    this.fireHeroDialogue('battle');
    if (ai.factionKey === 'red') this.fireHeroDialogue('red_territory', { force: true });
    else if (ai.factionKey === 'yellow') this.fireHeroDialogue('yellow_territory', { force: true });
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
      intel: this.computeIntel(ai.factionKey),      // (Phase 9) pre-battle fog level
      riverBattle: this.battleOnRiver(),            // (Phase 9) river runs across the field
      onComplete: (res: any) => this.onBattleComplete(res, ai),
    });
  }

  // (Phase 9) Decide how much of the enemy formation BattleScene reveals before
  // the fight, based on what scouts/spies the player has on this faction:
  //   'mira'  — Mira Swiftarrow (ranger) marches with the host → she scouts ahead,
  //             no fog ever, and the enemy morale bar + ability are visible.
  //   'full'  — fresh intel report (Gather-Intel within ~5 days): full formation +
  //             enemy commander visible (but not their morale bar).
  //   'basic' — a weaker/older report: enemy unit TYPES visible, no arrangement.
  //   'none'  — no information: a fog overlay + a count-only estimate.
  computeIntel(faction: string): 'none' | 'basic' | 'full' | 'mira' {
    const miraHere = HeroWorld.partyHeroes().some((h: any) => h.id === 'mira' || h.type === 'ranger');
    if (miraHere) return 'mira';
    return GameWorld.intelOnFaction(faction); // 'none' | 'basic' | 'full'
  }

  // (Phase 9) Is the battle being fought ON a river crossing? Used to draw the
  // river across the battlefield + apply its crossing penalty.
  battleOnRiver(): boolean {
    return this.world.tileBiome[GameWorld.player.row * this.world.size + GameWorld.player.col] === 11; // Biome.RIVER
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
      // (Phase 6) Grant hero XP to party heroes + fire a victory/first-victory line.
      this.grantHeroBattleXP(true, (res.kills as number) || 0);
      GameWorld.heroFlags.battlesWon = (GameWorld.heroFlags.battlesWon || 0) + 1;
      this.fireHeroDialogue('victory');
      // Defeating a faction leader is a story beat (one-shot per faction).
      if (ai.factionKey === 'red') this.fireHeroDialogue('valdris_defeated', { force: true });
      // (Phase 7) Record the win into leader memory → escalating dialogue + memory
      // events (Valdris/Krag warrior/artifact gifts) surfaced via a leader popup.
      this.recordFactionBattle(ai.factionKey, true);
    } else {
      // Push the player back home-ward a little on defeat.
      this.flashBanner('Your army was defeated.', 0x8c2b2b);
      this.grantHeroBattleXP(false, 0);
      this.fireHeroDialogue('defeat');
      // (Phase 7) Record the loss into leader memory.
      this.recordFactionBattle(ai.factionKey, false);
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
  // (Phase 6) HEROES — dialogue popups, biome triggers, overlay icons, the
  // station/recall panel, and quest markers.
  // =========================================================================

  // (Phase 6) Grant battle XP to every hero travelling with the party (heroes
  // aren't army-assigned at the world level, so we use Heroes.grantXP directly,
  // keeping their existing leveling curve + passive recompute intact).
  grantHeroBattleXP(won: boolean, kills: number) {
    const H = GameWorld.heroes;
    for (const h of HeroWorld.partyHeroes()) {
      H.grantXP(h, 10 + kills * 5);
      if (won) h.battlesWon = (h.battlesWon || 0) + 1;
    }
    H.applyPassives();
  }

  // Fire a contextual hero line for a world event; render it if one returns.
  fireHeroDialogue(event: string, ctx: any = {}) {
    const line = HeroWorld.trigger(event, ctx);
    if (line) this.showHeroSpeech(line);
    return line;
  }

  // Detect biome crossings + season and fire the matching reaction.
  checkBiomeDialogue() {
    const b = this.world.tileBiome[GameWorld.player.row * this.world.size + GameWorld.player.col];
    if (b === this._lastHeroBiome) {
      // Still fire a winter remark when the season turns to Winter (once per season).
      if (GameWorld.season() === 'Winter' && this._lastHeroSeason !== 'Winter') {
        this._lastHeroSeason = 'Winter'; this.fireHeroDialogue('winter');
      } else if (GameWorld.season() !== 'Winter') { this._lastHeroSeason = GameWorld.season(); }
      return;
    }
    this._lastHeroBiome = b;
    // forest (lush/alpine) → 'forest'; highland/peak → 'mountain'.
    if (b === 7 || b === 9) this.fireHeroDialogue('forest');
    else if (b === 8) this.fireHeroDialogue('mountain');
  }

  // A small hero-portrait speech popup (cheap, auto-dismiss). Stacks at the
  // bottom-left so it never overlaps the minimap.
  showHeroSpeech(line: { heroId: string; name: string; text: string; portrait: string }) {
    if (this._closing) return;
    // Tear down any previous popup so they never stack on screen.
    if (this._heroSpeech) { try { this._heroSpeech.forEach((o: any) => o.destroy()); } catch (e) { /* ignore */ } this._heroSpeech = null; }
    const fix = (o: any) => o.setScrollFactor(0).setDepth(HUD_DEPTH + 35);
    const els: any[] = [];
    const W = 360, H = 76, x = 14, y = GAME_H - H - 14;
    els.push(fix(this.add.rectangle(x, y, W, H, 0x1a1410, 0.95).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.9)));
    // Portrait (texture if baked, else a coloured disc fallback).
    if (this.textures.exists(line.portrait)) {
      els.push(fix(this.add.image(x + 38, y + H / 2, line.portrait).setDisplaySize(56, 56)));
    } else {
      els.push(fix(this.add.circle(x + 38, y + H / 2, 26, 0x6b4a26).setStrokeStyle(2, 0xc9a14a, 0.9)));
    }
    els.push(fix(this.add.text(x + 74, y + 10, line.name, { fontFamily: 'Georgia, serif', fontSize: '13px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0, 0)));
    els.push(fix(this.add.text(x + 74, y + 30, line.text, { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#e6d8b8', fontStyle: 'italic', wordWrap: { width: W - 86 } }).setOrigin(0, 0)));
    this._heroSpeech = els;
    // Auto-dismiss after a few seconds.
    this.time.delayedCall(4200, () => { if (this._heroSpeech === els) { els.forEach(o => { try { o.destroy(); } catch (e) { /* ignore */ } }); this._heroSpeech = null; } });
  }

  // A two-line hero-hero conversation: show the first line, then the reply.
  showHeroConversation(lines: Array<{ heroId: string; name: string; text: string; portrait: string }>) {
    if (!lines || !lines.length) return;
    this.showHeroSpeech(lines[0]);
    if (lines[1]) this.time.delayedCall(2100, () => { if (!this._closing) this.showHeroSpeech(lines[1]); });
  }

  // Lay out hero portrait overlay icons on the player party icon (stack multiple),
  // and stationed-hero portraits on their settlement icons. Called from layoutIcons.
  layoutHeroIcons() {
    if (!this.heroOverlay) return;
    this.heroOverlay.removeAll(true);
    const sc = 1 / this.zoom * 0.9 + 0.1;
    // -- Party heroes: a row of small portrait discs above the party crown. --
    const party = HeroWorld.partyHeroes();
    const pp = this.tileToPx(GameWorld.player.col, GameWorld.player.row);
    party.slice(0, 4).forEach((h: any, i: number) => {
      const ox = (i - (Math.min(party.length, 4) - 1) / 2) * 16;
      this.addHeroPortraitIcon(pp.x + ox * sc, pp.y - 30 * sc, h, sc * 0.9);
    });
    // -- Stationed heroes: a portrait on their settlement's continent icon. --
    for (const s of this.world.settlements) {
      const sid = GameWorld.settlementId(s);
      const garrison = HeroWorld.heroesStationedAt(sid);
      if (!garrison.length) continue;
      if (!this.fogLifted(s.col, s.row) && s.kind !== 'player_castle') continue;
      const spx = this.tileToPx(s.col, s.row);
      garrison.slice(0, 3).forEach((h: any, i: number) => {
        this.addHeroPortraitIcon(spx.x + (i * 13 - 6) * sc, spx.y - 22 * sc, h, sc * 0.8);
      });
    }
  }

  // Draw one hero portrait icon (texture-backed disc with a gold ring + initial).
  addHeroPortraitIcon(x: number, y: number, h: any, scale: number) {
    const key = 'hero_' + h.id;
    if (this.textures.exists(key)) {
      const img = this.add.image(x, y, key).setDisplaySize(22, 22).setScale(scale);
      // Round-ish framing via a gold ring drawn behind.
      const ring = this.add.graphics();
      ring.fillStyle(0x1a120a, 0.6); ring.fillCircle(0, 0, 13);
      ring.lineStyle(2, 0xffe08a, 0.95); ring.strokeCircle(0, 0, 12);
      ring.setPosition(x, y).setScale(scale);
      this.heroOverlay.add(ring);
      this.heroOverlay.add(img);
    } else {
      const g = this.add.graphics();
      g.fillStyle(0x6b4a26, 1); g.fillCircle(0, 0, 11);
      g.lineStyle(2, 0xffe08a, 0.95); g.strokeCircle(0, 0, 11);
      g.setPosition(x, y).setScale(scale);
      this.heroOverlay.add(g);
      const t = this.add.text(x, y, h.name.charAt(0), { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setScale(scale);
      this.heroOverlay.add(t);
    }
  }

  // Draw active hero-quest markers on the continent (gold star) into iconLayer.
  layoutQuestMarkers(sc: number) {
    for (const m of HeroWorld.activeQuestMarkers()) {
      const qp = this.tileToPx(m.col, m.row);
      const g = this.add.graphics();
      g.fillStyle(0x1a120a, 0.5); g.fillEllipse(0, 9, 16, 5);
      // five-point gold star
      g.fillStyle(0xffe08a, 1);
      const pts: number[] = [];
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + i * Math.PI / 5;
        const r = i % 2 === 0 ? 10 : 4;
        pts.push(Math.cos(ang) * r, Math.sin(ang) * r - 2);
      }
      g.fillPoints(pts.reduce((acc: any[], v, idx) => { if (idx % 2 === 0) acc.push({ x: v, y: pts[idx + 1] }); return acc; }, []), true);
      g.lineStyle(1.5, 0x6b4a16, 0.9);
      g.strokePoints(pts.reduce((acc: any[], v, idx) => { if (idx % 2 === 0) acc.push({ x: v, y: pts[idx + 1] }); return acc; }, []), true, true);
      g.setPosition(qp.x, qp.y); g.setScale(sc);
      this.iconLayer.add(g);
    }
  }

  // PUBLIC: open the hero roster / station panel (also a test hook). Lists living
  // heroes with Station/Recall actions when the party is near a settlement.
  openHeroPanel() {
    if (this._heroPanel) { this.closeHeroPanel(); return; }
    const fix = (o: any) => o.setScrollFactor(0).setDepth(HUD_DEPTH + 26);
    const els: any[] = [];
    const W = 380, H = 360, x = GAME_W / 2 - W / 2, y = 80;
    els.push(fix(this.add.rectangle(x, y, W, H, 0x201608, 0.97).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.9)));
    els.push(fix(this.add.rectangle(x, y, W, 30, 0x3a2a10, 1).setOrigin(0, 0)));
    els.push(fix(this.add.text(x + 12, y + 7, 'Heroes', { fontFamily: 'Georgia, serif', fontSize: '15px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0, 0)));
    const closeBtn = fix(this.add.text(x + W - 22, y + 6, '✕', { fontFamily: 'Georgia, serif', fontSize: '16px', color: '#e9d6a4' }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true }));
    closeBtn.on('pointerdown', () => { this._uiClick = true; });
    closeBtn.on('pointerup', () => { this._uiClick = true; this.closeHeroPanel(); });
    els.push(closeBtn);

    const near = this.settlementNearParty();
    const nearId = near ? GameWorld.settlementId(near) : null;
    const living = GameWorld.heroes.living();
    let cy = y + 40;
    if (!living.length) {
      els.push(fix(this.add.text(x + 16, cy, 'No heroes have joined yet.\nThe first arrives around day 8.', { fontFamily: 'Georgia, serif', fontSize: '13px', color: '#9aa0a6', wordWrap: { width: W - 32 } }).setOrigin(0, 0)));
    }
    for (const h of living) {
      const stationedAt = GameWorld.heroStations[h.id];
      els.push(fix(this.add.text(x + 16, cy, `${h.name} — Lv.${h.level} ${h.type}`, { fontFamily: 'Georgia, serif', fontSize: '13px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0, 0)));
      const sub = stationedAt ? `Stationed at ${GameWorld.settlementById(stationedAt)?.name || 'a settlement'}` : 'Travelling with your host';
      els.push(fix(this.add.text(x + 16, cy + 17, sub, { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#cfc1a6' }).setOrigin(0, 0)));
      // Action button: Station here (if near a settlement, not already stationed) / Recall.
      const label = stationedAt ? 'Recall' : (nearId ? `Station at ${near!.name}` : 'Move near a town');
      const enabled = stationedAt ? true : !!nearId;
      const bw = 150;
      const btn = fix(this.add.rectangle(x + W - bw / 2 - 14, cy + 14, bw, 26, enabled ? (stationedAt ? 0x6b3a26 : 0x1f5b3a) : 0x39393f).setStrokeStyle(2, 0xf0e6c8, 0.8).setInteractive({ useHandCursor: enabled }));
      els.push(btn, fix(this.add.text(x + W - bw / 2 - 14, cy + 14, label, { fontFamily: 'Georgia, serif', fontSize: '11px', color: enabled ? '#fff' : '#888', fontStyle: 'bold' }).setOrigin(0.5)));
      btn.on('pointerdown', () => { this._uiClick = true; });
      btn.on('pointerup', () => {
        this._uiClick = true;
        if (!enabled) return;
        if (stationedAt) { HeroWorld.recall(h.id); this.flashBanner(`${h.name} rejoins your host.`, 0xc9a14a); }
        else if (nearId) { HeroWorld.station(h.id, nearId); this.flashBanner(`${h.name} stationed at ${near!.name}.`, 0x2a7a4f); }
        this.closeHeroPanel(); this.openHeroPanel(); // refresh
      });
      cy += 44;
    }
    this._heroPanel = els;
  }
  closeHeroPanel() { if (this._heroPanel) { this._heroPanel.forEach((o: any) => { try { o.destroy(); } catch (e) { /* ignore */ } }); this._heroPanel = null; } }

  // =========================================================================
  // (Phase 7) DIPLOMACY — leader speech popups, battle memory recording, and the
  // diplomacy panel (relation bars + leader memory + honor + world-level actions).
  // =========================================================================

  // Record a continent/expedition battle vs a real faction into leader memory,
  // then surface any escalating leader line + memory-event banner it triggers.
  // The single entry point the headless verification calls (window hook below).
  recordFactionBattle(faction: string, playerWon: boolean) {
    const r = WorldDiplomacy.recordBattle(faction, playerWon);
    if (r.line) this.showLeaderSpeech(r.line);
    if (r.event) this.flashBanner(r.event, 0xc9a14a);
    if (this._diploPanel) this.openDiplomacyPanel();
    return r;
  }

  // A leader-portrait speech popup (same warm style as the hero popup, but in the
  // bottom-RIGHT so a leader + a hero can both speak without overlapping).
  showLeaderSpeech(line: LeaderLine) {
    if (this._closing) return;
    if (this._leaderSpeech) { try { this._leaderSpeech.forEach((o: any) => o.destroy()); } catch (e) { /* ignore */ } this._leaderSpeech = null; }
    const fix = (o: any) => o.setScrollFactor(0).setDepth(HUD_DEPTH + 36);
    const els: any[] = [];
    const W = 380, H = 84, x = GAME_W - W - 14, y = GAME_H - H - 14;
    els.push(fix(this.add.rectangle(x, y, W, H, 0x1a1410, 0.96).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.95)));
    if (this.textures.exists(line.portrait)) {
      els.push(fix(this.add.image(x + 42, y + H / 2, line.portrait).setDisplaySize(62, 62)));
    } else {
      els.push(fix(this.add.circle(x + 42, y + H / 2, 28, 0x6b4a26).setStrokeStyle(2, 0xc9a14a, 0.9)));
    }
    els.push(fix(this.add.text(x + 82, y + 10, line.name, { fontFamily: 'Georgia, serif', fontSize: '13px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0, 0)));
    els.push(fix(this.add.text(x + 82, y + 30, line.text, { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#e6d8b8', fontStyle: 'italic', wordWrap: { width: W - 96 } }).setOrigin(0, 0)));
    this._leaderSpeech = els;
    this.time.delayedCall(5000, () => { if (this._leaderSpeech === els) { els.forEach(o => { try { o.destroy(); } catch (e) { /* ignore */ } }); this._leaderSpeech = null; } });
  }

  toggleDiplomacyPanel() {
    if (this._diploPanel) { this.closeDiplomacyPanel(); return; }
    this.openDiplomacyPanel();
  }
  closeDiplomacyPanel() { if (this._diploPanel) { this._diploPanel.forEach((o: any) => { try { o.destroy(); } catch (e) { /* ignore */ } }); this._diploPanel = null; } }

  // The diplomacy panel: per-faction leader portrait + name, a relation bar,
  // treaty status, a one-line memory summary, and the world-level actions (send
  // tribute / propose trade / propose alliance / break treaty / declare war), all
  // wired to the world Diplomacy instance via WorldDiplomacy. Player honor at top.
  openDiplomacyPanel() {
    WorldDiplomacy.ensure();
    this.closeDiplomacyPanel();
    const fix = (o: any) => o.setScrollFactor(0).setDepth(HUD_DEPTH + 26);
    const els: any[] = [];
    const W = 480, H = 540, x = GAME_W / 2 - W / 2, y = 60;
    els.push(fix(this.add.rectangle(x, y, W, H, 0x201608, 0.98).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.9)));
    els.push(fix(this.add.rectangle(x, y, W, 30, 0x3a2a10, 1).setOrigin(0, 0)));
    els.push(fix(this.add.text(x + 12, y + 7, 'Diplomacy', { fontFamily: 'Georgia, serif', fontSize: '15px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0, 0)));
    const closeBtn = fix(this.add.text(x + W - 22, y + 6, '✕', { fontFamily: 'Georgia, serif', fontSize: '16px', color: '#e9d6a4' }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true }));
    closeBtn.on('pointerdown', () => { this._uiClick = true; });
    closeBtn.on('pointerup', () => { this._uiClick = true; this.closeDiplomacyPanel(); });
    els.push(closeBtn);

    // --- Honor banner (the player's standing, with its current effect) ---
    const honor = WorldDiplomacy.honor();
    const honorColor = honor >= 10 ? '#7cfc7c' : honor <= -5 ? '#ff6b6b' : '#ffe9b0';
    const honorNote = honor >= 10 ? 'High honor — treaties are cheaper.' : honor <= -5 ? 'Low honor — treaties cost +50 gold.' : 'Honor is steady.';
    els.push(fix(this.add.text(x + 14, y + 38, `Honor: ${honor >= 0 ? '+' : ''}${honor}`, { fontFamily: 'Georgia, serif', fontSize: '14px', color: honorColor, fontStyle: 'bold' }).setOrigin(0, 0)));
    els.push(fix(this.add.text(x + 120, y + 40, honorNote, { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#cfc1a6' }).setOrigin(0, 0)));
    els.push(fix(this.add.text(x + 14, y + 56, `Gold: ${GameWorld.gold}`, { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#e0b84a' }).setOrigin(0, 0)));

    let cy = y + 78;
    const ROW_H = 150;
    for (const fk of WorldDiplomacy.FACTIONS) {
      const s = WorldDiplomacy.summary(fk);
      // Card frame.
      els.push(fix(this.add.rectangle(x + 10, cy, W - 20, ROW_H - 8, 0x2a2012, 0.95).setOrigin(0, 0).setStrokeStyle(1, 0xc9a14a, 0.5)));
      // Portrait.
      if (this.textures.exists(s.portrait)) els.push(fix(this.add.image(x + 46, cy + 40, s.portrait).setDisplaySize(60, 60)));
      else els.push(fix(this.add.circle(x + 46, cy + 40, 28, s.memory ? 0x6b4a26 : 0x6b4a26).setStrokeStyle(2, 0xc9a14a, 0.9)));
      // Name + status.
      els.push(fix(this.add.text(x + 86, cy + 8, `${s.leader}`, { fontFamily: 'Georgia, serif', fontSize: '13px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0, 0)));
      els.push(fix(this.add.text(x + 86, cy + 26, `${s.factionName} — ${s.status}`, { fontFamily: 'Georgia, serif', fontSize: '11px', color: s.allied ? '#7cfc7c' : '#cfc1a6' }).setOrigin(0, 0)));
      // Relation bar (−100..+100 → 0..barW).
      const barX = x + 86, barY = cy + 44, barW = W - 86 - 22;
      els.push(fix(this.add.rectangle(barX, barY, barW, 12, 0x140d06).setOrigin(0, 0).setStrokeStyle(1, 0x6b5a3a, 0.8)));
      const frac = Math.max(0, Math.min(1, (s.relation + 100) / 200));
      const relCol = s.relation >= 50 ? 0x2a7a4f : s.relation >= 0 ? 0xc9a14a : s.relation >= -50 ? 0xc77b3a : 0x8c2b2b;
      els.push(fix(this.add.rectangle(barX, barY, Math.max(2, barW * frac), 12, relCol).setOrigin(0, 0)));
      els.push(fix(this.add.text(barX + barW + 2, barY - 1, `${s.relation > 0 ? '+' : ''}${s.relation}`, { fontFamily: 'Georgia, serif', fontSize: '10px', color: '#f0e6d0' }).setOrigin(1, 0)));
      // Memory recap.
      els.push(fix(this.add.text(x + 86, cy + 60, WorldDiplomacy.memoryRecap(fk), { fontFamily: 'Georgia, serif', fontSize: '10px', color: '#9aa0a6', wordWrap: { width: W - 86 - 18 } }).setOrigin(0, 0)));

      // --- Action buttons row ---
      const t = s.treaties;
      const hasTreaty = t.trade || t.alliance || t.vassal;
      const actions: Array<[string, number, () => void]> = [];
      actions.push([`Tribute (50g)`, 0x6b4a26, () => this.diploAction(() => WorldDiplomacy.sendTribute(fk, 50))]);
      if (!t.trade && !t.alliance) actions.push([`Trade (${WorldDiplomacy.treatyCost(fk, 'trade')}g)`, 0x1f5b3a, () => this.diploAction(() => WorldDiplomacy.proposeTreaty(fk, 'trade'))]);
      if (!t.alliance) actions.push([`Ally (${WorldDiplomacy.treatyCost(fk, 'alliance')}g)`, 0x1f5b3a, () => this.diploAction(() => WorldDiplomacy.proposeTreaty(fk, 'alliance'))]);
      if (hasTreaty) actions.push([`Betray`, 0x8c2b2b, () => this.diploBreak(fk)]);
      actions.push([`War`, 0x6b1a1a, () => this.diploAction(() => WorldDiplomacy.declareWar(fk))]);

      let bx = x + 86, byb = cy + ROW_H - 32;
      for (const [label, col, fn] of actions.slice(0, 5)) {
        const bw = Math.min(82, Math.max(54, label.length * 6.4));
        const btn = fix(this.add.rectangle(bx, byb, bw, 22, col).setOrigin(0, 0).setStrokeStyle(1, 0xf0e6c8, 0.7).setInteractive({ useHandCursor: true }));
        els.push(btn, fix(this.add.text(bx + bw / 2, byb + 11, label, { fontFamily: 'Georgia, serif', fontSize: '9.5px', color: '#fff' }).setOrigin(0.5)));
        btn.on('pointerdown', () => { this._uiClick = true; });
        btn.on('pointerup', () => { this._uiClick = true; fn(); });
        bx += bw + 5;
      }
      cy += ROW_H;
    }
    this._diploPanel = els;
  }

  // Run a diplomacy action, surface its leader line / reason, then refresh.
  diploAction(fn: () => { ok?: boolean; reason?: string; line: LeaderLine | null }) {
    const r = fn();
    if (r && r.ok === false && r.reason) { this.flashBanner(r.reason, 0x8c2b2b); }
    if (r && r.line) this.showLeaderSpeech(r.line);
    this.openDiplomacyPanel(); // rebuild fresh
  }

  // Break a treaty (betrayal): apply consequences, surface the angry line + the
  // "cannot be trusted" broadcast, then refresh.
  diploBreak(faction: string) {
    const r = WorldDiplomacy.breakTreaty(faction);
    if (r.ok === false && r.reason) { this.flashBanner(r.reason, 0x8c2b2b); }
    else { if (r.line) this.showLeaderSpeech(r.line); if (r.notify) this.flashBanner(r.notify, 0x8c2b2b); }
    this.openDiplomacyPanel();
  }

  // =========================================================================
  // (Phase 8) REALM PANEL — late-game (stage 8/9) actions + the Chronicle.
  // Built lazily, rebuilt each open so contents (stage, costs, stock) stay fresh.
  // The single hub for: Grand Tournament, Legendary Forge + hero-weapon upgrade,
  // Emissaries (per faction), Imperial Proclamation, and the Chronicle scroll.
  // =========================================================================
  toggleRealmPanel() { if (this._realmPanel) { this.closeRealmPanel(); return; } this.openRealmPanel(); }
  closeRealmPanel() { if (this._realmPanel) { this._realmPanel.forEach((o: any) => { try { o.destroy(); } catch (e) { /* ignore */ } }); this._realmPanel = null; } }

  openRealmPanel() {
    this.closeRealmPanel();
    const fix = (o: any) => o.setScrollFactor(0).setDepth(HUD_DEPTH + 26);
    const els: any[] = [];
    const W = 460, H = 560, x = GAME_W / 2 - W / 2, y = 40;
    els.push(fix(this.add.rectangle(x, y, W, H, 0x201608, 0.98).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.9)));
    els.push(fix(this.add.rectangle(x, y, W, 30, 0x3a2a10, 1).setOrigin(0, 0)));
    const stage = GameWorld.kingdomStage();
    els.push(fix(this.add.text(x + 12, y + 7, `Realm — ${LateGame.stageName(stage)} (stage ${stage}/9)`, { fontFamily: 'Georgia, serif', fontSize: '14px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0, 0)));
    const close = fix(this.add.text(x + W - 22, y + 6, '✕', { fontFamily: 'Georgia, serif', fontSize: '16px', color: '#e9d6a4' }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true }));
    close.on('pointerdown', () => { this._uiClick = true; });
    close.on('pointerup', () => { this._uiClick = true; this.closeRealmPanel(); });
    els.push(close);

    let cy = y + 38;
    const head = (t: string) => { els.push(fix(this.add.text(x + 12, cy, t, { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#e0b84a', fontStyle: 'bold' }).setOrigin(0, 0))); cy += 18; };
    const note = (t: string, col = '#cfc1a6') => { els.push(fix(this.add.text(x + 16, cy, t, { fontFamily: 'Georgia, serif', fontSize: '11px', color: col, wordWrap: { width: W - 32 } }).setOrigin(0, 0))); cy += 15; };
    // A small action button helper. `enabled` greys it out; `tip` shown when disabled.
    const actionBtn = (label: string, enabled: boolean, fn: () => void, tip?: string) => {
      const bw = 150, bh = 24;
      const b = fix(this.add.rectangle(x + W - bw - 14, cy, bw, bh, enabled ? 0x1f5b3a : 0x39393f).setOrigin(0, 0).setStrokeStyle(1, 0xf0e6c8, 0.7).setInteractive({ useHandCursor: enabled }));
      els.push(b, fix(this.add.text(x + W - bw / 2 - 14, cy + bh / 2, label, { fontFamily: 'Georgia, serif', fontSize: '11px', color: enabled ? '#fff' : '#888', fontStyle: 'bold' }).setOrigin(0.5)));
      b.on('pointerdown', () => { this._uiClick = true; });
      b.on('pointerup', () => { this._uiClick = true; if (enabled) fn(); else if (tip) this.flashBanner(tip, 0x8c2b2b); });
      cy += bh + 6;
    };

    els.push(fix(this.add.text(x + W - 14, y + 9, `Gold ${GameWorld.gold}`, { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#e0b84a' }).setOrigin(1, 0)));

    if (stage < 8) {
      head('Late-game unlocks');
      note('Grow your home castle to a Medium Castle (stage 8) to unlock the Grand Tournament, the Legendary Forge, an extra army, and Emissaries.', '#9aa0a6');
      cy += 4;
    } else {
      // --- GRAND TOURNAMENT ---
      head('Grand Tournament');
      const t = GameWorld.tournament;
      if (t.active) { note(`Underway — ends day ${t.endDay}. Champions joust at your castle.`, '#ffe08a'); }
      else {
        note('300 gold + 50 food · ~3 days · champion joins, +10 relations, festival.');
        const tc = GameWorld.canStartTournament();
        actionBtn('Hold Tournament', tc.ok, () => { const r = GameWorld.startTournament(); if (r.ok) this.flashBanner('A Grand Tournament begins!', 0xd6c04a); this.openRealmPanel(); }, tc.reason);
      }
      cy += 2;
      // --- LEGENDARY FORGE ---
      head('Legendary Forge');
      if (GameWorld.hasLegendaryForge()) {
        note(`Legendary Equipment in stock: ${GameWorld.legendaryEquipmentStock()} (produces 1/day).`, '#ffe08a');
        // Hero-weapon upgrade: pick the first living hero without a legendary weapon.
        const living = GameWorld.heroes.living();
        const lw = GameWorld.heroFlags.legendaryWeapon || {};
        const target = living.find((h: any) => !lw[h.id]);
        if (target) {
          const can = GameWorld.legendaryEquipmentStock() >= 1;
          actionBtn(`Arm ${target.name} (+40%)`, can, () => { const r = GameWorld.upgradeHeroWeapon(target.id); if (r.ok) this.flashBanner(`${target.name} armed with legendary steel!`, 0xffe08a); this.openRealmPanel(); }, 'No Legendary Equipment in stock.');
        } else if (living.length) note('All heroes wield legendary weapons.', '#9aa0a6');
        else note('No heroes yet to arm.', '#9aa0a6');
      } else {
        note('Upgrade your Blacksmith: 200 iron + 100 stone (at your castle).');
        const fc = GameWorld.canBuildLegendaryForge();
        actionBtn('Build Forge', fc.ok, () => { const r = GameWorld.buildLegendaryForge(); if (r.ok) this.flashBanner('The Legendary Forge is raised!', 0xffe08a); this.openRealmPanel(); }, fc.reason);
      }
      cy += 2;
      // --- EMISSARIES (per faction) ---
      head('Emissaries & Embassies');
      note(`Armies cap: ${GameWorld.armyCap} (extra slot at stage 8).`, '#9aa0a6');
      for (const fk of GameWorld.factionKeys()) {
        const fName = LateGame.factionName(fk);
        if (GameWorld.embassies[fk] != null) { note(`${fName}: embassy open (+2 relations/day).`, '#7cfc7c'); continue; }
        const captive = GameWorld.emissaries.find(e => e.faction === fk && e.status === 'captured');
        if (captive) {
          actionBtn(`Ransom ${captive.name} (200g)`, GameWorld.gold >= 200, () => { const r = GameWorld.ransomEmissary(captive.id); if (r.ok) this.flashBanner('Emissary ransomed.', 0xc9a14a); this.openRealmPanel(); }, 'Need 200 gold.');
          continue;
        }
        const ec = GameWorld.canSendEmissary(fk);
        actionBtn(`Emissary → ${fName}`, ec.ok, () => { const r = GameWorld.sendEmissary(fk); if (r.ok) this.flashBanner(`Emissary sets out for ${fName}.`, 0xc9a14a); this.openRealmPanel(); }, ec.reason);
      }
      cy += 2;
      // --- IMPERIAL PROCLAMATION (stage 9) ---
      head('Imperial Proclamation');
      if (GameWorld.imperialProclaimed) note('The Empire has been proclaimed. History remembers this day.', '#ffe08a');
      else if (stage < 9) note('Requires a Large Castle (stage 9).', '#9aa0a6');
      else {
        note('1000 gold + 300 stone + 200 iron. Allies cheer; rivals turn; enemies march.');
        const ic = GameWorld.canDeclareImperial();
        actionBtn('Proclaim Empire', ic.ok, () => this.confirmImperial(), ic.reason);
      }
    }

    // --- CHRONICLE (always shown; the scribe tower formalises it at stage 9) ---
    cy += 6;
    els.push(fix(this.add.text(x + 12, cy, 'Chronicle of the Kingdom', { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#e0b84a', fontStyle: 'bold' }).setOrigin(0, 0)));
    cy += 18;
    const lines = LateGame.chronicleLines();
    const boxY = cy, boxH = y + H - cy - 12;
    els.push(fix(this.add.rectangle(x + 12, boxY, W - 24, boxH, 0x140d06, 0.85).setOrigin(0, 0).setStrokeStyle(1, 0x6b5a3a, 0.7)));
    if (!lines.length) {
      els.push(fix(this.add.text(x + 20, boxY + 8, 'The Chronicle is yet unwritten.', { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#8a7e62', fontStyle: 'italic' }).setOrigin(0, 0)));
    } else {
      // Show the most recent entries that fit, newest at the bottom (scroll-style).
      const maxLines = Math.max(1, Math.floor((boxH - 12) / 26));
      const shown = lines.slice(-maxLines);
      let ly = boxY + 8;
      for (const ln of shown) {
        els.push(fix(this.add.text(x + 20, ly, ln, { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#d8c8a4', fontStyle: 'italic', wordWrap: { width: W - 40 } }).setOrigin(0, 0)));
        ly += 26;
      }
    }

    this._realmPanel = els;
  }

  // A confirmation modal for the irreversible Imperial Proclamation.
  confirmImperial() {
    if (this._modal) return;
    const fix = (o: any) => o.setScrollFactor(0).setDepth(HUD_DEPTH + 50);
    const els: any[] = [];
    els.push(fix(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 0.6).setOrigin(0, 0).setInteractive()));
    const W = 440, H = 180, x = (GAME_W - W) / 2, y = (GAME_H - H) / 2;
    els.push(fix(this.add.rectangle(x, y, W, H, 0x1a1410, 0.99).setOrigin(0, 0).setStrokeStyle(3, 0xffe08a, 0.9)));
    els.push(fix(this.add.text(GAME_W / 2, y + 20, 'Proclaim the Empire?', { fontFamily: 'Georgia, serif', fontSize: '18px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0)));
    els.push(fix(this.add.text(GAME_W / 2, y + 50, 'This cannot be undone. Allies will celebrate, neutral\npowers will resent you, and your enemies will march to war.', { fontFamily: 'Georgia, serif', fontSize: '12px', color: '#cfc1a6', align: 'center' }).setOrigin(0.5, 0)));
    const yes = fix(this.add.rectangle(x + W / 2 - 90, y + H - 36, 150, 34, 0x8a6a1a).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
    els.push(yes, fix(this.add.text(x + W / 2 - 90, y + H - 36, 'Proclaim', { fontFamily: 'Georgia, serif', fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));
    const no = fix(this.add.rectangle(x + W / 2 + 90, y + H - 36, 150, 34, 0x6b3a26).setStrokeStyle(2, 0xf0e6c8, 0.85).setInteractive({ useHandCursor: true }));
    els.push(no, fix(this.add.text(x + W / 2 + 90, y + H - 36, 'Not yet', { fontFamily: 'Georgia, serif', fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5)));
    const closeModal = () => { els.forEach(o => { try { o.destroy(); } catch (e) { /* ignore */ } }); this._modal = null; };
    this._modal = closeModal;
    no.on('pointerdown', () => { this._uiClick = true; });
    no.on('pointerup', () => { this._uiClick = true; closeModal(); });
    yes.on('pointerdown', () => { this._uiClick = true; });
    yes.on('pointerup', () => { this._uiClick = true; closeModal(); this.doDeclareImperial(); });
  }

  // Run the proclamation, surface reactions (leader bubbles + banner), refresh.
  doDeclareImperial() {
    const r = GameWorld.declareImperial();
    if (!r.ok) { if (r.reason) this.flashBanner(r.reason, 0x8c2b2b); return; }
    this.flashBanner(`${GameWorld.king.kingdom} is proclaimed an EMPIRE!`, 0xffe08a);
    // Pop leader bubbles for the reactions (celebrate / war / neutral).
    const reactions = r.reactions || {};
    let delay = 0;
    for (const fk of Object.keys(reactions)) {
      const react = reactions[fk];
      const sit = react === 'war' ? 'war' : react === 'celebrate' || react === 'celebrates' ? 'allied' : 'neutral';
      this.time.delayedCall(delay, () => this.showLeaderSpeech(WorldDiplomacy.line(fk, sit)));
      delay += 1200;
    }
    if (this._diploPanel) this.openDiplomacyPanel();
    this.openRealmPanel();
  }

  // (Phase 8) Pop the three leader speech bubbles for the stage-9 transition.
  popStage9LeaderSpeech() {
    const lines: Record<string, string> = {
      red: 'A fortress worthy of a true war. I will be watching your every move.',
      purple: 'Such a seat of power. We must speak — there is much to gain, or lose.',
      yellow: 'BIG castle! Krag wants to SMASH it... or feast in it. Krag undecided!',
    };
    let delay = 0;
    for (const fk of GameWorld.factionKeys()) {
      const text = lines[fk];
      if (!text) continue;
      this.time.delayedCall(delay, () => this.showLeaderSpeech({ faction: fk, name: WorldDiplomacy.leaderName(fk), portrait: 'portrait_' + fk, text }));
      delay += 1400;
    }
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
    if (this._expoPanel) { try { this.closeExpeditionPanel(); } catch (e) { /* ignore */ } }
    if (this._settlementOverlay) { try { this._settlementOverlay(); } catch (e) { /* ignore */ } }
    // (Phase 6) Tear down hero UI overlays so nothing dangles after a scene swap.
    if (this._heroPanel) { try { this.closeHeroPanel(); } catch (e) { /* ignore */ } }
    if (this._heroSpeech) { try { this._heroSpeech.forEach((o: any) => o.destroy()); } catch (e) { /* ignore */ } this._heroSpeech = null; }
    // (Phase 7) Tear down diplomacy UI overlays + drop GameWorld hooks pointing here.
    if (this._diploPanel) { try { this.closeDiplomacyPanel(); } catch (e) { /* ignore */ } }
    if (this._leaderSpeech) { try { this._leaderSpeech.forEach((o: any) => o.destroy()); } catch (e) { /* ignore */ } this._leaderSpeech = null; }
    // (Phase 8) Tear down the Realm/Chronicle panel.
    if (this._realmPanel) { try { this.closeRealmPanel(); } catch (e) { /* ignore */ } }
    GameWorld._leaderSpeechHook = null;
    GameWorld._diploPanelHook = null;
  }

  // The minimap dots are refreshed in update via updateMinimap, but update() does
  // a lot; keep the call here so it always runs after layout.
  postUpdate() { /* reserved */ }
}
