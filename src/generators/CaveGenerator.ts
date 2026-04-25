import { pseudoRandom } from '../utils/PseudoRandom';
import { applySmoothMap, removeRogueTiles } from '../utils/SmoothMap';

let GRID_WIDTH = 100;
let GRID_HEIGHT = 100;

const FLOOR = 0;
const WALL = 1;
const ENTRANCE = 2;
const EXIT = 3;

// Cave generation parameters
const RANDOM_FILL_PERCENT = 0.50;  // probability any interior cell starts as a wall
const SMOOTH_ITERATIONS = 5;       // cellular automata passes
const WALL_THRESHOLD = 50;         // wall blobs smaller than this become floor
const ROOM_THRESHOLD = 50;         // floor regions smaller than this become wall
const PASSAGE_RADIUS = 5;          // radius of the circular brush used to carve corridors

// ---------------------------------------------------------------------------
// Module-level RNG state — initialized once per generateCaveGrid call.
// Safe in a Web Worker (single-threaded, synchronous generation).
// ---------------------------------------------------------------------------
let _rngSeed = 0;

/** Advance the RNG and return the raw 32-bit hash value. */
function rand(): number {
  const [val] = pseudoRandom(_rngSeed);
  _rngSeed = val;
  return val;
}

/** Uniform float in [0, 1). */
function randFloat(): number {
  return rand() / 0xFFFFFFFF;
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface Coord {
  x: number;
  y: number;
}

/** A cave room defined by its floor tiles and the subset that border a wall. */
interface Room {
  tiles: Coord[];
  edgeTiles: Coord[];
  roomSize: number;
}

interface BorderOpening {
  cx: number;       // center x of the 3-cell stamp
  cy: number;       // center y of the 3-cell stamp
  edge: 'top' | 'bottom' | 'left' | 'right';
  quadrant: number; // 0=TL, 1=TR, 2=BL, 3=BR
  distToFloor: number;
  floorTarget: Coord;
}

export interface CaveMetadata {
  roomCount: number;
  floorPercent: number;
  generationTimeMs: number;
  rogueIterations: number;
  preferDiagonal?: boolean;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function generateCaveGrid(seed: number, width: number, height: number, preferDiagonal: boolean): { grid: number[][], metadata: CaveMetadata } {
  const startTime = performance.now();

  GRID_WIDTH = width;
  GRID_HEIGHT = height;

  _rngSeed = seed; // seed the module-level RNG once

  const grid: number[][] = Array.from({ length: GRID_HEIGHT }, () =>
    new Array(GRID_WIDTH).fill(WALL)
  );

  randomFillMap(grid);
  applySmoothMap(grid, SMOOTH_ITERATIONS);

  const roomCount = processMap(grid);

  // Re-enforce border walls after all processing
  for (let x = 0; x < GRID_WIDTH; x++) {
    grid[0][x] = WALL;
    grid[GRID_HEIGHT - 1][x] = WALL;
  }
  for (let y = 0; y < GRID_HEIGHT; y++) {
    grid[y][0] = WALL;
    grid[y][GRID_WIDTH - 1] = WALL;
  }

  placeEntranceAndExit(grid, preferDiagonal);

  // Max 100 iterations of rogue tile removal to clean up any remaining 1-tile holes or protrusions.
  const rogueIterations = removeRogueTiles(grid, 100);

  const floorCells = grid.flat().filter(v => v === FLOOR || v === ENTRANCE || v === EXIT).length;
  const floorPercent = Math.round((floorCells / (GRID_WIDTH * GRID_HEIGHT)) * 100);
  const generationTimeMs = Math.round(performance.now() - startTime);

  return { grid, metadata: { roomCount, floorPercent, generationTimeMs, rogueIterations, preferDiagonal } };
}

// ---------------------------------------------------------------------------
// Map generation
// ---------------------------------------------------------------------------

/**
 * Cleans up the map and connects all rooms:
 *   1. Remove small wall blobs (< WALL_THRESHOLD) — converts them to floor.
 *   2. Remove small floor regions (< ROOM_THRESHOLD) — converts them to wall.
 *   3. Connect all surviving rooms via Prim's MST so the map is fully traversable.
 * Returns the number of surviving rooms.
 */
function processMap(grid: number[][]): number {
  const wallRegions = getRegions(grid, WALL);
  for (const region of wallRegions) {
    if (region.length < WALL_THRESHOLD) {
      for (const tile of region) {
        grid[tile.y][tile.x] = FLOOR;
      }
    }
  }

  const roomRegions = getRegions(grid, FLOOR);
  const survivingRooms: Room[] = [];

  for (const region of roomRegions) {
    if (region.length < ROOM_THRESHOLD) {
      for (const tile of region) {
        grid[tile.y][tile.x] = WALL;
      }
    } else {
      survivingRooms.push(createRoom(region, grid));
    }
  }

  if (survivingRooms.length === 0) {
    return 0;
  }

  connectAllRooms(grid, survivingRooms);
  return survivingRooms.length;
}

/**
 * Fills the grid with deterministic random noise.
 * Border cells are always walls. Interior cells are walls with probability
 * RANDOM_FILL_PERCENT; the same seed always produces the same map.
 */
function randomFillMap(grid: number[][]): void {
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      if (x === 0 || x === GRID_WIDTH - 1 || y === 0 || y === GRID_HEIGHT - 1) {
        grid[y][x] = WALL;
      } else {
        grid[y][x] = randFloat() < RANDOM_FILL_PERCENT ? WALL : FLOOR;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Region processing
// ---------------------------------------------------------------------------

/** Finds all contiguous regions of tileType using a 4-directional BFS. */
function getRegions(grid: number[][], tileType: number): Coord[][] {
  const regions: Coord[][] = [];
  const visited: boolean[][] = Array.from({ length: GRID_HEIGHT }, () =>
    new Array(GRID_WIDTH).fill(false)
  );

  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      if (!visited[y][x] && grid[y][x] === tileType) {
        const region = getRegionTiles(grid, x, y, visited, tileType);
        regions.push(region);
      }
    }
  }

  return regions;
}

/**
 * Builds a Room from a set of floor tiles and computes its edge tiles.
 * Edge tiles are floor tiles with at least one cardinal wall neighbour.
 * Duplicates are excluded: connectAllRooms finds the minimum-distance pair
 * exhaustively, so duplicates never change the result and only slow the MST.
 */
function createRoom(tiles: Coord[], grid: number[][]): Room {
  const seen = new Set<string>();
  const edgeTiles: Coord[] = [];
  for (const tile of tiles) {
    for (let nx = tile.x - 1; nx <= tile.x + 1; nx++) {
      for (let ny = tile.y - 1; ny <= tile.y + 1; ny++) {
        if (nx === tile.x || ny === tile.y) {
          if (nx >= 0 && nx < GRID_WIDTH && ny >= 0 && ny < GRID_HEIGHT) {
            if (grid[ny][nx] === WALL) {
              const key = `${tile.x},${tile.y}`;
              if (!seen.has(key)) {
                seen.add(key);
                edgeTiles.push(tile);
              }
            }
          }
        }
      }
    }
  }
  return { tiles, edgeTiles, roomSize: tiles.length };
}

/**
 * BFS flood-fill from (startX, startY), returning all connected tiles of tileType.
 * Uses the shared visited array to avoid re-visiting cells across multiple calls.
 */
function getRegionTiles(
  grid: number[][],
  startX: number,
  startY: number,
  visited: boolean[][],
  tileType: number
): Coord[] {
  const tiles: Coord[] = [];
  const queue: Coord[] = [{ x: startX, y: startY }];
  visited[startY][startX] = true;
  let head = 0;

  while (head < queue.length) {
    const tile = queue[head++];
    tiles.push(tile);

    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = tile.x + dx;
      const ny = tile.y + dy;
      if (
        nx >= 0 && nx < GRID_WIDTH &&
        ny >= 0 && ny < GRID_HEIGHT &&
        !visited[ny][nx] &&
        grid[ny][nx] === tileType
      ) {
        visited[ny][nx] = true;
        queue.push({ x: nx, y: ny });
      }
    }
  }

  return tiles;
}

// ---------------------------------------------------------------------------
// Room connection — Prim's MST
// ---------------------------------------------------------------------------

/**
 * Connects all rooms using Prim's MST over closest edge-tile pairs.
 * Guarantees every room is reachable from every other room.
 */
function connectAllRooms(grid: number[][], rooms: Room[]): void {
  if (rooms.length <= 1) {
    return;
  }

  const inTree = new Set<Room>([rooms[0]]);

  while (inTree.size < rooms.length) {
    let bestDist = Infinity;
    let bestTileA: Coord = { x: 0, y: 0 };
    let bestTileB: Coord = { x: 0, y: 0 };
    let bestRoomA: Room | null = null;
    let bestRoomB: Room | null = null;

    for (const roomA of inTree) {
      for (const roomB of rooms) {
        if (inTree.has(roomB)) { continue; }
        for (const tileA of roomA.edgeTiles) {
          for (const tileB of roomB.edgeTiles) {
            const dist = (tileA.x - tileB.x) ** 2 + (tileA.y - tileB.y) ** 2;
            if (dist < bestDist) {
              bestDist = dist;
              bestTileA = tileA;
              bestTileB = tileB;
              bestRoomA = roomA;
              bestRoomB = roomB;
            }
          }
        }
      }
    }

    if (bestRoomA === null || bestRoomB === null) { break; }

    createPassage(grid, bestTileA, bestTileB);
    inTree.add(bestRoomB);
  }
}

/** Carves a corridor between two edge tiles using Bresenham's line + a circular brush. */
function createPassage(grid: number[][], tileA: Coord, tileB: Coord): void {
  const line = getLine(tileA, tileB);
  for (const coord of line) {
    drawCircle(grid, coord, PASSAGE_RADIUS);
  }
}

/** Bresenham line — returns every grid coordinate on the straight line from `from` to `to`. */
function getLine(from: Coord, to: Coord): Coord[] {
  const line: Coord[] = [];
  let x = from.x;
  let y = from.y;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let inverted = false;
  let step = Math.sign(dx);
  let gradientStep = Math.sign(dy);
  let longest = Math.abs(dx);
  let shortest = Math.abs(dy);

  if (longest < shortest) {
    inverted = true;
    longest = Math.abs(dy);
    shortest = Math.abs(dx);
    step = Math.sign(dy);
    gradientStep = Math.sign(dx);
  }

  let gradientAccumulation = Math.floor(longest / 2);
  for (let i = 0; i < longest; i++) {
    line.push({ x, y });
    if (inverted) { y += step; } else { x += step; }
    gradientAccumulation += shortest;
    if (gradientAccumulation >= longest) {
      if (inverted) { x += gradientStep; } else { y += gradientStep; }
      gradientAccumulation -= longest;
    }
  }

  return line;
}

/** Carves a filled circle of floor cells centred at `center` with the given radius. */
function drawCircle(grid: number[][], center: Coord, radius: number): void {
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      if (dx * dx + dy * dy <= radius * radius) {
        const nx = center.x + dx;
        const ny = center.y + dy;
        if (nx >= 0 && nx < GRID_WIDTH && ny >= 0 && ny < GRID_HEIGHT) {
          grid[ny][nx] = FLOOR;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Entrance / Exit placement
// ---------------------------------------------------------------------------

/**
 * Places a 3×1 entrance and a 3×1 exit on the map border in different quadrants
 * (preferring opposite quadrants when preferDiagonal is set), each connected to
 * the nearest floor cell via a straight corridor.
 */
function placeEntranceAndExit(grid: number[][], preferDiagonal: boolean): void {
  const best = findBestOpeningPerQuadrant(grid);
  const minDist = GRID_WIDTH / 4;

  let entranceOpening: BorderOpening | null = null;
  let exitOpening: BorderOpening | null = null;

  if (preferDiagonal) {
    for (const [a, b] of [[0, 3], [1, 2]] as [number, number][]) {
      if (best[a] !== null && best[b] !== null && openingDistance(best[a]!, best[b]!) >= minDist) {
        entranceOpening = best[a];
        exitOpening = best[b];
        break;
      }
    }
  }

  if (entranceOpening === null) {
    outer: for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        if (best[a] !== null && best[b] !== null && openingDistance(best[a]!, best[b]!) >= minDist) {
          entranceOpening = best[a];
          exitOpening = best[b];
          break outer;
        }
      }
    }
  }

  if (entranceOpening === null || exitOpening === null) { return; }

  stampOpening(grid, entranceOpening, ENTRANCE);
  stampOpening(grid, exitOpening, EXIT);
}

/**
 * Scans inward from every valid 3-cell border position and keeps the closest
 * opening to a floor cell for each of the 4 quadrants.
 */
function findBestOpeningPerQuadrant(grid: number[][]): (BorderOpening | null)[] {
  const best: (BorderOpening | null)[] = [null, null, null, null];

  function consider(o: BorderOpening): void {
    const q = o.quadrant;
    if (best[q] === null || o.distToFloor < best[q]!.distToFloor) { best[q] = o; }
  }

  // Top edge — scan downward
  for (let cx = 1; cx < GRID_WIDTH - 1; cx++) {
    for (let depth = 1; depth < GRID_HEIGHT; depth++) {
      if (grid[depth][cx] === FLOOR) {
        consider({ cx, cy: 0, edge: 'top', quadrant: borderQuadrant(cx, 0, 'top'), distToFloor: depth, floorTarget: { x: cx, y: depth } });
        break;
      }
    }
  }

  // Bottom edge — scan upward
  for (let cx = 1; cx < GRID_WIDTH - 1; cx++) {
    for (let depth = GRID_HEIGHT - 2; depth >= 0; depth--) {
      if (grid[depth][cx] === FLOOR) {
        consider({ cx, cy: GRID_HEIGHT - 1, edge: 'bottom', quadrant: borderQuadrant(cx, GRID_HEIGHT - 1, 'bottom'), distToFloor: GRID_HEIGHT - 1 - depth, floorTarget: { x: cx, y: depth } });
        break;
      }
    }
  }

  // Left edge — scan rightward
  for (let cy = 1; cy < GRID_HEIGHT - 1; cy++) {
    for (let depth = 1; depth < GRID_WIDTH; depth++) {
      if (grid[cy][depth] === FLOOR) {
        consider({ cx: 0, cy, edge: 'left', quadrant: borderQuadrant(0, cy, 'left'), distToFloor: depth, floorTarget: { x: depth, y: cy } });
        break;
      }
    }
  }

  // Right edge — scan leftward
  for (let cy = 1; cy < GRID_HEIGHT - 1; cy++) {
    for (let depth = GRID_WIDTH - 2; depth >= 0; depth--) {
      if (grid[cy][depth] === FLOOR) {
        consider({ cx: GRID_WIDTH - 1, cy, edge: 'right', quadrant: borderQuadrant(GRID_WIDTH - 1, cy, 'right'), distToFloor: GRID_WIDTH - 1 - depth, floorTarget: { x: depth, y: cy } });
        break;
      }
    }
  }

  return best;
}

/** Carves a 1-cell corridor from just inside the border to `floorTarget`, then stamps the 3 border cells with `value`. */
function stampOpening(grid: number[][], opening: BorderOpening, value: number): void {
  const { cx, cy, edge, floorTarget } = opening;

  switch (edge) {
    case 'top':
      for (let y = 1; y <= floorTarget.y; y++) { grid[y][cx] = FLOOR; }
      grid[1][cx - 1] = FLOOR;
      grid[1][cx + 1] = FLOOR;
      grid[0][cx - 1] = value;
      grid[0][cx]     = value;
      grid[0][cx + 1] = value;
      break;
    case 'bottom':
      for (let y = floorTarget.y; y < GRID_HEIGHT - 1; y++) { grid[y][cx] = FLOOR; }
      grid[GRID_HEIGHT - 2][cx - 1] = FLOOR;
      grid[GRID_HEIGHT - 2][cx + 1] = FLOOR;
      grid[GRID_HEIGHT - 1][cx - 1] = value;
      grid[GRID_HEIGHT - 1][cx]     = value;
      grid[GRID_HEIGHT - 1][cx + 1] = value;
      break;
    case 'left':
      for (let x = 1; x <= floorTarget.x; x++) { grid[cy][x] = FLOOR; }
      grid[cy - 1][1] = FLOOR;
      grid[cy + 1][1] = FLOOR;
      grid[cy - 1][0] = value;
      grid[cy][0]     = value;
      grid[cy + 1][0] = value;
      break;
    case 'right':
      for (let x = floorTarget.x; x < GRID_WIDTH - 1; x++) { grid[cy][x] = FLOOR; }
      grid[cy - 1][GRID_WIDTH - 2] = FLOOR;
      grid[cy + 1][GRID_WIDTH - 2] = FLOOR;
      grid[cy - 1][GRID_WIDTH - 1] = value;
      grid[cy][GRID_WIDTH - 1]     = value;
      grid[cy + 1][GRID_WIDTH - 1] = value;
      break;
  }
}

function openingDistance(a: BorderOpening, b: BorderOpening): number {
  return Math.sqrt((a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2);
}

function borderQuadrant(cx: number, cy: number, edge: 'top' | 'bottom' | 'left' | 'right'): number {
  switch (edge) {
    case 'top':    return cx < GRID_WIDTH / 2  ? 0 : 1;
    case 'bottom': return cx < GRID_WIDTH / 2  ? 2 : 3;
    case 'left':   return cy < GRID_HEIGHT / 2 ? 0 : 2;
    case 'right':  return cy < GRID_HEIGHT / 2 ? 1 : 3;
  }
}
