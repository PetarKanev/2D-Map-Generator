const FLOOR = 0;
const WALL = 1;

// Applies one pass of cellular automata smoothing to the grid using double buffering
// so all cells are evaluated against the same generation before any changes are applied.
// A cell becomes floor if it has fewer than 4 wall neighbours,
// becomes wall if it has more than 4, and keeps its current state if exactly 4.
// Out-of-bounds neighbours are treated as walls (preserves the enclosed border).
function smoothMap(grid: number[][]): void {
  const height = grid.length;
  if (height === 0) { return; }
  const width = grid[0].length;
  if (width === 0) { return; }
  const next: number[][] = Array.from({ length: height }, () =>
    new Array(width).fill(WALL)
  );

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const wallCount = countWallNeighbours(grid, x, y, width, height);
      if (wallCount < 4) {
        next[y][x] = FLOOR;
      } else if (wallCount > 4) {
        next[y][x] = WALL;
      } else {
        next[y][x] = grid[y][x] === WALL ? WALL : FLOOR;
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      grid[y][x] = next[y][x];
    }
  }
}

// Counts the Moore neighbours (8 directions) of (x, y) that are walls.
// Only value 1 (WALL) counts — entrance/exit cells (2, 3) are treated as floor.
function countWallNeighbours(
  grid: number[][],
  x: number,
  y: number,
  width: number,
  height: number
): number {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
        count++;
      } else if (grid[ny][nx] === WALL) {
        count++;
      }
    }
  }
  return count;
}

// Runs smoothMap n times on the provided grid, mutating it in place.
export function applySmoothMap(grid: number[][], iterations: number): void {
  for (let i = 0; i < iterations; i++) {
    smoothMap(grid);
  }
}

// Removes rogue tiles each pass:
//   - Wall cells with ≤ 3 wall neighbours (≥ 5 floor neighbours) → floor
//   - Floor cells with ≥ 5 wall neighbours → wall
// Stops early once a full pass makes no changes. `maxIterations` caps the
// number of passes to prevent infinite loops.
// Returns the number of passes actually performed.
export function removeRogueTiles(grid: number[][], maxIterations: number): number {
  const height = grid.length;
  const width = grid[0].length;

  for (let i = 0; i < maxIterations; i++) {
    let changed = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const wallCount = countWallNeighbours(grid, x, y, width, height);
        if (grid[y][x] === WALL && wallCount <= 3) {
          grid[y][x] = FLOOR;
          changed = true;
        } else if (grid[y][x] === FLOOR && wallCount >= 5) {
          grid[y][x] = WALL;
          changed = true;
        }
      }
    }

    if (!changed) {
      return i + 1;
    }
  }

  return maxIterations;
}
