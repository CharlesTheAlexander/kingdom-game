import Phaser from 'phaser';

// Territory + basic fog of war (Phase 4).
//
// Your controlled area is the union of a growing radius around the castle and a
// small radius around every building you place — so building toward an edge
// pushes the border that way, and each settlement-tier upgrade adds +5 radius.
// The AI kingdoms project their own (red) territory; where the two meet is a
// contested (yellow) border with heavier raids.
//
// Rendering is done by TINTING the existing terrain tiles (each already carries
// the correct per-tile isometric depth) rather than stacking overlay diamonds:
//   player    -> subtle blue wash      contested -> yellow
//   ai        -> red wash              just-outside -> slightly desaturated
//   far away  -> progressively darker "fog" (lifted around your units)
// A soft cyan glow line traces the player border.
//
// Gameplay hooks:
//   isInTerritory / nodeProtected -> resource nodes inside territory are safe
//       from goblin raids (goblins must breach the border first).
//   canHarvest -> worker pawns only walk to nodes within 2 tiles of the border.

const BASE_RADIUS = 9;     // tiles around the castle at game start (~the build zone)
const BUILDING_R = 2.6;    // tiles of territory each building projects
const TIER_BONUS = 5;      // +radius per settlement-tier upgrade
const AI_RADIUS = 6;       // tiles of territory around an AI castle
const HARVEST_MARGIN = 2;  // tiles outside the border that workers will still reach
const FOG_START = 3;       // tiles beyond the border before fog begins
const REVEAL_TILES = 3;    // reveal radius around player units

// Tints (multiplicative over the ground art).
const T_PLAYER = 0xcfe0ff;
const T_CONTEST = 0xffe9a8;
const T_AI = 0xffc2c2;
const T_EDGE = 0xc4c8cc;     // just outside the border, desaturated
const T_FOG1 = 0x9aa3ad;
const T_FOG2 = 0x737b86;
const T_FOG3 = 0x515862;
const T_REVEAL = 0xdfe6ee;

export class Territory {
  constructor(scene) {
    this.scene = scene;
    this.N = scene.COLS;
    this.bonus = 0; // accumulated tier radius bonus
    this.state = Array.from({ length: this.N }, () => Array(this.N).fill('neutral'));
    this.aiTint = Array.from({ length: this.N }, () => Array(this.N).fill(null));
    this.fogDist = Array.from({ length: this.N }, () => Array(this.N).fill(99));
    this.border = scene.add.graphics().setDepth(27.7).setScrollFactor(1);
    this._revealAcc = 0;
    this._tileCount = 0;
    this.recompute();
  }

  addTierBonus() { this.bonus += TIER_BONUS; this.recompute(); }

  // Number of player-controlled tiles (used for the kingdom status readout).
  get controlledTiles() { return this._tileCount; }

  isInTerritory(col, row) {
    if (col < 0 || row < 0 || col >= this.N || row >= this.N) return false;
    const s = this.state[row][col];
    return s === 'player' || s === 'contested';
  }

  // A resource node is protected (raid-safe) when its tile sits in territory.
  nodeProtected(node) {
    const t = this.scene.screenToTile(node.x, node.y);
    return this.isInTerritory(t.col, t.row);
  }

  // Workers will only venture to nodes within HARVEST_MARGIN tiles of the border.
  canHarvest(node) {
    const t = this.scene.screenToTile(node.x, node.y);
    if (t.col < 0 || t.row < 0 || t.col >= this.N || t.row >= this.N) return false;
    return this.fogDist[t.row][t.col] <= HARVEST_MARGIN;
  }

  // True while any tile is contested between the player and an AI kingdom.
  get hasContested() { return this._contested > 0; }

  recompute() {
    const s = this.scene;
    const N = this.N;
    const castle = s.buildings.castle;
    const cc = castle ? castle.col : Math.floor(N / 2);
    const cr = castle ? castle.row : Math.floor(N / 2);
    const baseR = BASE_RADIUS + this.bonus;

    // AI castle influence sources (Phase 6: each kingdom projects its colour).
    const aiSources = [];
    const pushAI = (k) => { if (k && k.castleAlive && k.castleCol != null) aiSources.push({ c: k.castleCol, r: k.castleRow, tint: (k.cfg && k.cfg.zoneTint) || T_AI }); };
    if (s.kingdoms) for (const k of s.kingdoms) pushAI(k);
    else if (s.ai) pushAI(s.ai);

    const playerTiles = [];
    this._tileCount = 0;
    this._contested = 0;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        let player = Phaser.Math.Distance.Between(c, r, cc, cr) <= baseR;
        if (!player) {
          for (const b of s.buildings.buildings) {
            if (Phaser.Math.Distance.Between(c, r, b.col, b.row) <= BUILDING_R) { player = true; break; }
          }
        }
        let ai = false;
        let aiTint = null;
        for (const a of aiSources) {
          if (Phaser.Math.Distance.Between(c, r, a.c, a.r) <= AI_RADIUS) { ai = true; aiTint = a.tint; break; }
        }
        this.aiTint[r][c] = aiTint;
        let st = 'neutral';
        if (player && ai) { st = 'contested'; this._contested++; }
        else if (player) st = 'player';
        else if (ai) st = 'ai';
        this.state[r][c] = st;
        if (st === 'player' || st === 'contested') { playerTiles.push([c, r]); this._tileCount++; }
      }
    }

    // Multi-source BFS: distance (in tiles) from the nearest player territory.
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) this.fogDist[r][c] = 99;
    let frontier = [];
    for (const [c, r] of playerTiles) { this.fogDist[r][c] = 0; frontier.push([c, r]); }
    let d = 0;
    while (frontier.length) {
      const next = [];
      for (const [c, r] of frontier) {
        const nb = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
        for (const [nc, nr] of nb) {
          if (nc < 0 || nr < 0 || nc >= N || nr >= N) continue;
          if (this.fogDist[nr][nc] > d + 1) { this.fogDist[nr][nc] = d + 1; next.push([nc, nr]); }
        }
      }
      frontier = next;
      d++;
    }

    this.redrawBorder(playerTiles);
    this.applyTints();
  }

  // Soft cyan glow tracing player tiles that touch non-player tiles.
  redrawBorder(playerTiles) {
    const s = this.scene;
    const g = this.border;
    g.clear();
    const isP = (c, r) => c >= 0 && r >= 0 && c < this.N && r < this.N && (this.state[r][c] === 'player' || this.state[r][c] === 'contested');
    const edges = [];
    for (const [c, r] of playerTiles) {
      if (!isP(c, r + 1) || !isP(c, r - 1) || !isP(c + 1, r) || !isP(c - 1, r)) edges.push([c, r]);
    }
    const draw = (width, alpha) => {
      g.lineStyle(width, 0x6fdcff, alpha);
      for (const [c, r] of edges) {
        const pts = s.regionDiamond(c, c, r, r);
        s.strokeDiamond(g, pts);
        g.strokePath();
      }
    };
    draw(5, 0.12); // outer glow
    draw(2, 0.5);  // crisp edge
  }

  // Tint every tile by its territory state + fog distance, lifting fog around
  // the player's own units. Cheap (just setTint calls); called on recompute and
  // throttled for the moving fog-reveal.
  applyTints(reveal) {
    const s = this.scene;
    const tiles = s.terrainTiles;
    if (!tiles) return;
    for (let r = 0; r < this.N; r++) {
      for (let c = 0; c < this.N; c++) {
        const img = tiles[r][c];
        if (!img) continue;
        const st = this.state[r][c];
        let tint;
        if (st === 'player') tint = T_PLAYER;
        else if (st === 'contested') tint = T_CONTEST;
        else if (st === 'ai') tint = this.aiTint[r][c] || T_AI;
        else {
          const fd = this.fogDist[r][c];
          const revealed = reveal && reveal[r][c];
          if (fd <= FOG_START) tint = T_EDGE;
          else if (revealed) tint = T_REVEAL;
          else if (fd <= FOG_START + 2) tint = T_FOG1;
          else if (fd <= FOG_START + 4) tint = T_FOG2;
          else tint = T_FOG3;
        }
        img.setTint(tint);
      }
    }
  }

  // Throttled fog-reveal: ~3x/sec rebuild a reveal grid from unit positions and
  // re-tint so the darkness lifts around moving troops/pawns.
  update(dt) {
    this._revealAcc += dt;
    if (this._revealAcc < 0.33) return;
    this._revealAcc = 0;
    const s = this.scene;
    const reveal = Array.from({ length: this.N }, () => Array(this.N).fill(false));
    const mark = (x, y) => {
      const t = s.screenToTile(x, y);
      for (let dr = -REVEAL_TILES; dr <= REVEAL_TILES; dr++) {
        for (let dc = -REVEAL_TILES; dc <= REVEAL_TILES; dc++) {
          const nc = t.col + dc, nr = t.row + dr;
          if (nc < 0 || nr < 0 || nc >= this.N || nr >= this.N) continue;
          if (dc * dc + dr * dr <= REVEAL_TILES * REVEAL_TILES) reveal[nr][nc] = true;
        }
      }
    };
    for (const u of s.troops.allUnits()) mark(u.x, u.y);
    for (const p of s.pawns.pawns) mark(p.x, p.y);
    this.applyTints(reveal);
  }
}
