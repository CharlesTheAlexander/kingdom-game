// Simple 4-directional A* over the tile grid.
// `blocked` is a 2D boolean array indexed [row][col]; true means impassable.
// start / goal are { col, row }. The goal tile is always treated as reachable
// even if it is "blocked" (e.g. the castle tile), so enemies can path to it.

export function findPath(blocked: boolean[][], start: { col: number; row: number }, goal: { col: number; row: number }): { col: number; row: number }[] | null {
  const rows = blocked.length;
  const cols = blocked[0].length;

  const key = (c, r) => r * cols + c;
  const h = (c, r) => Math.abs(c - goal.col) + Math.abs(r - goal.row);

  const open = [{ col: start.col, row: start.row, g: 0, f: h(start.col, start.row) }];
  const cameFrom = new Map();
  const gScore = new Map([[key(start.col, start.row), 0]]);
  const closed = new Set();

  while (open.length > 0) {
    // Pick the node with the lowest f (small grid, linear scan is fine).
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];
    const ck = key(current.col, current.row);

    if (current.col === goal.col && current.row === goal.row) {
      return reconstruct(cameFrom, ck, cols);
    }

    if (closed.has(ck)) continue;
    closed.add(ck);

    const neighbors = [
      [current.col + 1, current.row],
      [current.col - 1, current.row],
      [current.col, current.row + 1],
      [current.col, current.row - 1],
    ];

    for (const [nc, nr] of neighbors) {
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const isGoal = nc === goal.col && nr === goal.row;
      if (blocked[nr][nc] && !isGoal) continue;

      const nk = key(nc, nr);
      if (closed.has(nk)) continue;

      const tentative = current.g + 1;
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, ck);
        gScore.set(nk, tentative);
        open.push({ col: nc, row: nr, g: tentative, f: tentative + h(nc, nr) });
      }
    }
  }

  return null; // no path
}

function reconstruct(cameFrom: Map<number, number>, endKey: number, cols: number) {
  const path: any[] = [];
  let k = endKey;
  while (k !== undefined) {
    const col = k % cols;
    const row = Math.floor(k / cols);
    path.unshift({ col, row });
    k = cameFrom.get(k);
  }
  return path;
}
