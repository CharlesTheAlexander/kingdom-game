import Phaser from 'phaser';

// Territory + fog of war, scaled for the 200x200 continent (Phase B).
//
// Rendering tints the terrain Blitter's per-tile Bobs. On a 40,000-tile map we
// CANNOT re-tint every tile each frame, so:
//   - all tiles start dark (unexplored fog),
//   - recompute() (on build / tier upgrade — rare) re-tints only the bounded
//     region around the player's territory,
//   - update() incrementally marks tiles newly seen by your units as explored
//     (permanent) and tints just those.
// Tints are a pure function of position (tintFor), so there's no giant state grid.

const BASE_RADIUS = 8;     // tiles around the castle at game start
const BUILDING_R = 2;      // +2 tiles of territory each building projects locally
const PER_BUILDING = 0.6;  // +radius the WHOLE border grows per building placed,
                           // so even central placements visibly push it outward
const TIER_BONUS = 15;     // +radius per settlement-tier upgrade
const AI_RADIUS = 8;       // tiles of territory around an AI castle
const SETTLE_R = 4;        // territory around a conquered neutral settlement
const HARVEST_MARGIN = 2;  // tiles outside the border that workers will still reach
const FOG = 15;            // tiles beyond territory before it goes fully dark
const REVEAL_TILES = 5;    // reveal radius around player units (permanent)

// Tints (multiplicative over the ground art).
const T_PLAYER = 0xcfe0ff;
const T_CONTEST = 0xffe9a8;
const T_EDGE = 0xc8ccd0;   // just outside the border
const T_NEAR = 0xa6aeb8;   // visible, within fog range
const T_FAR = 0x848c97;    // visible, near the fog edge
const T_EXPLORED = 0x5c6470; // explored but far from territory — dim but visible
const T_DARK = 0x232c3c;   // unexplored fog — deep dark blue-gray (Phase 7)

export class Territory {
  constructor(scene) {
    this.scene = scene;
    this.N = scene.COLS;
    this.bonus = 0;
    this.explored = Array.from({ length: this.N }, () => Array(this.N).fill(false));
    this.border = scene.add.graphics().setDepth(-9).setScrollFactor(1); // just above terrain blitter
    this._revealAcc = 0;
    this._tileCount = 0;
    this._lastRegion = null;
    this.darkenAll();
    this.recompute();
  }

  baseR() { return BASE_RADIUS + this.bonus + this.scene.buildings.placedCount() * PER_BUILDING; }
  addTierBonus() { this.bonus += TIER_BONUS; this.recompute(); }
  get controlledTiles() { return this._tileCount; }
  get hasContested() { return this._contested > 0; }
  // Fraction of the whole continent the player controls (for the continent view).
  get percentOwned() { return (this._tileCount / (this.N * this.N)) * 100; }

  // (Save system) Pack the explored grid into a base64 bitset (1 bit/tile).
  serializeFog() {
    const N = this.N;
    const bytes = new Uint8Array(Math.ceil((N * N) / 8));
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (this.explored[r][c]) { const i = r * N + c; bytes[i >> 3] |= 1 << (i & 7); }
    }
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  // (Save system) Restore the explored grid from a base64 bitset and re-tint.
  restoreFog(b64) {
    if (!b64) return;
    try {
      const s = atob(b64);
      const N = this.N;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const i = r * N + c;
        this.explored[r][c] = (s.charCodeAt(i >> 3) & (1 << (i & 7))) !== 0;
      }
      const tiles = this.scene.terrainTiles;
      if (tiles) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (this.explored[r][c] && tiles[r][c]) tiles[r][c].setTint(this.tintFor(c, r));
      this.recompute();
    } catch (e) { console.error('[Save] fog restore failed', e); }
  }

  // Paint the entire map dark once at startup (everything begins unexplored).
  darkenAll() {
    const tiles = this.scene.terrainTiles;
    if (!tiles) return;
    for (let r = 0; r < this.N; r++) for (let c = 0; c < this.N; c++) if (tiles[r][c]) tiles[r][c].setTint(T_DARK);
  }

  // AI castle nearest (c,r) within AI_RADIUS → its zone tint, else null.
  aiTintAt(c, r) {
    const ks = this.scene.kingdoms || (this.scene.ai ? [this.scene.ai] : []);
    for (const k of ks) {
      if (!k.castleAlive || k.castleCol == null) continue;
      if (Phaser.Math.Distance.Between(c, r, k.castleCol, k.castleRow) <= AI_RADIUS) return (k.cfg && k.cfg.zoneTint) || T_CONTEST;
    }
    return null;
  }

  // Is (c,r) inside the player's controlled territory?
  playerLevel(c, r) {
    const castle = this.scene.buildings.castle;
    if (castle && Phaser.Math.Distance.Between(c, r, castle.col, castle.row) <= this.baseR()) return true;
    for (const b of this.scene.buildings.buildings) {
      if (b.typeKey === 'castle') continue;
      if (Phaser.Math.Distance.Between(c, r, b.col, b.row) <= BUILDING_R) return true;
    }
    if (this.scene.settlements) {
      for (const st of this.scene.settlements.list) {
        if (st.owner === 'player' && Phaser.Math.Distance.Between(c, r, st.col, st.row) <= SETTLE_R) return true;
      }
    }
    return false;
  }

  // Approx tiles from the nearest player territory (circle around the castle).
  fogDist(c, r) {
    const castle = this.scene.buildings.castle;
    if (!castle) return 99;
    return Math.max(0, Phaser.Math.Distance.Between(c, r, castle.col, castle.row) - this.baseR());
  }

  tintFor(c, r) {
    const pl = this.playerLevel(c, r);
    const ai = this.aiTintAt(c, r);
    if (pl && ai) return T_CONTEST;
    if (pl) return T_PLAYER;
    const fd = this.fogDist(c, r);
    const seen = this.explored[r][c];
    if (ai && (seen || fd <= FOG)) return ai;
    if (fd <= FOG || seen) {
      if (fd <= 2) return T_EDGE;
      if (fd <= 8) return T_NEAR;
      if (fd <= FOG) return T_FAR;
      return T_EXPLORED; // explored but beyond the fog ring
    }
    return T_DARK;
  }

  isInTerritory(col, row) {
    if (col < 0 || row < 0 || col >= this.N || row >= this.N) return false;
    return this.playerLevel(col, row);
  }

  nodeProtected(node) {
    const t = this.scene.screenToTile(node.x, node.y);
    return this.isInTerritory(t.col, t.row);
  }

  // Workers only walk to nodes within HARVEST_MARGIN tiles of the border.
  canHarvest(node) {
    const t = this.scene.screenToTile(node.x, node.y);
    if (t.col < 0 || t.row < 0 || t.col >= this.N || t.row >= this.N) return false;
    return this.playerLevel(t.col, t.row) || this.fogDist(t.col, t.row) <= HARVEST_MARGIN;
  }

  // Re-tint the bounded region around the player's territory (+ fog ring). Far
  // tiles keep their dark/explored tint. Called on build / tier upgrade.
  recompute() {
    const castle = this.scene.buildings.castle;
    const cc = castle ? castle.col : Math.floor(this.N / 2);
    const cr = castle ? castle.row : Math.floor(this.N / 2);
    const reach = this.baseR() + FOG + BUILDING_R + 2; // baseR may be fractional
    const c0 = Math.max(0, Math.floor(cc - reach)), c1 = Math.min(this.N - 1, Math.ceil(cc + reach));
    const r0 = Math.max(0, Math.floor(cr - reach)), r1 = Math.min(this.N - 1, Math.ceil(cr + reach));

    this._tileCount = 0;
    this._contested = 0;
    const playerTiles = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const bob = this.scene.terrainTiles[r][c];
        if (bob) bob.setTint(this.tintFor(c, r));
        const pl = this.playerLevel(c, r);
        if (pl) {
          this._tileCount++;
          this.explored[r][c] = true;
          if (this.aiTintAt(c, r)) this._contested++;
          if (!this.playerLevel(c, r + 1) || !this.playerLevel(c, r - 1) || !this.playerLevel(c + 1, r) || !this.playerLevel(c - 1, r)) playerTiles.push([c, r]);
        }
      }
    }
    this.redrawBorder(playerTiles);
    this._lastRegion = { c0, c1, r0, r1 };
  }

  redrawBorder(edges) {
    const s = this.scene;
    const g = this.border;
    g.clear();
    // (Phase 7) Soft warm-gold frontier at lower opacity (was bright cyan).
    const draw = (width, alpha) => {
      g.lineStyle(width, 0xe6c87a, alpha);
      for (const [c, r] of edges) { const pts = s.regionDiamond(c, c, r, r); s.strokeDiamond(g, pts); g.strokePath(); }
    };
    draw(6, 0.07);
    draw(2, 0.3);
    // (Phase 4 Decision 1) Automatic settlement walls along the border, by stage:
    // 3 = wooden fence, 4 = wooden wall, 6 = stone wall, 7+ = full fortification.
    const stage = s.currentStage ? s.currentStage() : 0;
    let wall = null;
    if (stage >= 7) wall = { color: 0x9aa0a6, width: 7 };
    else if (stage >= 6) wall = { color: 0x8a8f99, width: 5 };
    else if (stage >= 4) wall = { color: 0x7a5a32, width: 5 };
    else if (stage >= 3) wall = { color: 0x6b4a28, width: 3 };
    if (wall) {
      g.lineStyle(wall.width, wall.color, 0.95);
      for (const [c, r] of edges) { const pts = s.regionDiamond(c, c, r, r); s.strokeDiamond(g, pts); g.strokePath(); }
      if (stage >= 7) { // merlons: little stone caps at each edge tile's top
        g.fillStyle(0xb6bcc4, 0.95);
        for (const [c, r] of edges) { const p = s.tileCenter(c, r); g.fillRect(p.x - 2, p.y - 12, 4, 5); }
      }
    }
    if (!this._borderPulse) {
      this._borderPulse = this.scene.tweens.add({ targets: g, alpha: { from: 0.7, to: 1 }, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  // Incremental fog reveal: mark tiles newly seen by units as explored (forever)
  // and tint just those. Cheap — bounded by units * reveal area.
  update(dt) {
    this._revealAcc += dt;
    if (this._revealAcc < 0.4) return;
    this._revealAcc = 0;
    const s = this.scene;
    const seen = [];
    const mark = (x, y) => {
      const t = s.screenToTile(x, y);
      for (let dr = -REVEAL_TILES; dr <= REVEAL_TILES; dr++) {
        for (let dc = -REVEAL_TILES; dc <= REVEAL_TILES; dc++) {
          const nc = t.col + dc, nr = t.row + dr;
          if (nc < 0 || nr < 0 || nc >= this.N || nr >= this.N) continue;
          if (dc * dc + dr * dr > REVEAL_TILES * REVEAL_TILES) continue;
          if (!this.explored[nr][nc]) { this.explored[nr][nc] = true; seen.push([nc, nr]); }
        }
      }
    };
    for (const u of s.troops.allUnits()) mark(u.x, u.y);
    for (const p of s.pawns.pawns) mark(p.x, p.y);
    for (const [c, r] of seen) { const bob = s.terrainTiles[r][c]; if (bob) bob.setTint(this.tintFor(c, r)); }
    if (seen.length) s._fogDirty = true; // (BUG 7) refresh the fog overlay when new tiles open
  }
}
