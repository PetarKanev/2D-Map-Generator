import { pseudoRandom } from '../utils/PseudoRandom';

let GRID_WIDTH = 100;
let GRID_HEIGHT = 100;

const FLOOR = 0;
const WALL = 1;
const ENTRANCE = 2;
const EXIT = 3;

const MIN_ROOM_W = 4;
const MAX_ROOM_W = 12;
const MIN_ROOM_H = 4;
const MAX_ROOM_H = 10;
const ROOM_BUFFER = 1;
const DEVIATION_CHANCE = 0.25;

interface Coord {
  x: number;
  y: number;
}

// Axis-aligned bounding rectangle for a room
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BorderOpening {
  cx: number;
  cy: number;
  edge: 'top' | 'bottom' | 'left' | 'right';
  quadrant: number; // 0=TL, 1=TR, 2=BL, 3=BR
  distToFloor: number;
  floorTarget: Coord;
}

export interface DungeonMetadata {
  roomCount: number;
  floorPercent: number;
  generationTimeMs: number;
  preferDiagonal?: boolean;
}

// Entry point — returns the grid and generation metadata.
export function generateDungeonGrid(
  seed: number,
  width: number,
  height: number,
  preferDiagonal: boolean
): { grid: number[][], metadata: DungeonMetadata } {
  const startTime = performance.now();

  GRID_WIDTH = width;
  GRID_HEIGHT = height;

  // Start from solid rock — rooms and corridors are carved in
  const grid: number[][] = Array.from({ length: GRID_HEIGHT }, () =>
    new Array(GRID_WIDTH).fill(WALL)
  );

  let s = seed;

  const [rooms, nextSeed] = placeRooms(grid, s, width, height);
  s = nextSeed;
  s = connectRooms(grid, rooms, s, width, height);

  // Re-enforce border walls after carving
  for (let x = 0; x < GRID_WIDTH; x++) {
    grid[0][x] = WALL;
    grid[GRID_HEIGHT - 1][x] = WALL;
  }
  for (let y = 0; y < GRID_HEIGHT; y++) {
    grid[y][0] = WALL;
    grid[y][GRID_WIDTH - 1] = WALL;
  }

  placeEntranceAndExit(grid, preferDiagonal);

  const floorCells = grid.flat().filter(v => v === FLOOR || v === ENTRANCE || v === EXIT).length;
  const floorPercent = Math.round((floorCells / (GRID_WIDTH * GRID_HEIGHT)) * 100);
  const generationTimeMs = Math.round(performance.now() - startTime);

  return { grid, metadata: { roomCount: rooms.length, floorPercent, generationTimeMs, preferDiagonal } };
}

// Attempts to place up to ATTEMPTS rectangular rooms via rejection sampling.
// Returns the placed rooms and the final seed state.
function placeRooms(grid: number[][], seed: number, width: number, height: number): [Rect[], number] {
  const attempts = Math.max(10, Math.floor((width * height) / 800));
  const rooms: Rect[] = [];
  let s = seed;

  for (let i = 0; i < attempts; i++) {
    let val: number;

    [val] = pseudoRandom(s); s = val;
    const roomW = MIN_ROOM_W + Math.floor((val / 0xFFFFFFFF) * (MAX_ROOM_W - MIN_ROOM_W + 1));

    [val] = pseudoRandom(s); s = val;
    const roomH = MIN_ROOM_H + Math.floor((val / 0xFFFFFFFF) * (MAX_ROOM_H - MIN_ROOM_H + 1));

    [val] = pseudoRandom(s); s = val;
    const roomX = 1 + Math.floor((val / 0xFFFFFFFF) * (width - roomW - 2));

    [val] = pseudoRandom(s); s = val;
    const roomY = 1 + Math.floor((val / 0xFFFFFFFF) * (height - roomH - 2));

    const candidate: Rect = { x: roomX, y: roomY, w: roomW, h: roomH };

    // Reject if overlapping any existing room (with buffer gap between them)
    if (rooms.some(r => roomsOverlap(r, candidate, ROOM_BUFFER))) {
      continue;
    }

    // Carve room into grid
    for (let ry = roomY; ry < roomY + roomH; ry++) {
      for (let rx = roomX; rx < roomX + roomW; rx++) {
        grid[ry][rx] = FLOOR;
      }
    }

    rooms.push(candidate);
  }

  return [rooms, s];
}

// Returns true if two rects overlap when expanded by `buffer` cells on all sides.
function roomsOverlap(a: Rect, b: Rect, buffer: number): boolean {
  return (
    a.x - buffer <= b.x + b.w &&
    a.x + a.w + buffer >= b.x &&
    a.y - buffer <= b.y + b.h &&
    a.y + a.h + buffer >= b.y
  );
}

// Returns the center coordinate of a room.
function roomCenter(r: Rect): Coord {
  return {
    x: Math.floor(r.x + r.w / 2),
    y: Math.floor(r.y + r.h / 2),
  };
}

function squaredDist(a: Coord, b: Coord): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

// Deterministic Fisher-Yates shuffle using pseudoRandom chaining.
// Returns the shuffled array (mutates in place) and the final seed.
function deterministicShuffle<T>(arr: T[], seed: number): [T[], number] {
  let s = seed;
  for (let i = arr.length - 1; i > 0; i--) {
    let val: number;
    [val] = pseudoRandom(s); s = val;
    const j = Math.floor((val / 0xFFFFFFFF) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return [arr, s];
}

// Connects all rooms via sequential nearest-neighbor spanning tree.
// For each unconnected room, finds the closest already-connected room and
// carves an L-shaped hallway between their centers.
function connectRooms(grid: number[][], rooms: Rect[], seed: number, width: number, height: number): number {
  if (rooms.length < 2) { return seed; }

  let s = seed;
  const shuffled = [...rooms];
  [, s] = deterministicShuffle(shuffled, s);

  const connected = new Set<number>([0]);

  for (let i = 1; i < shuffled.length; i++) {
    const centerA = roomCenter(shuffled[i]);

    // Find the nearest room already in the connected set
    let bestDist = Infinity;
    let bestIdx = 0;
    for (const j of connected) {
      const d = squaredDist(centerA, roomCenter(shuffled[j]));
      if (d < bestDist) {
        bestDist = d;
        bestIdx = j;
      }
    }

    const centerB = roomCenter(shuffled[bestIdx]);
    s = carveHallway(grid, centerA, centerB, s, width, height);
    connected.add(i);
  }

  return s;
}

// Carves an L-shaped hallway between two points.
// Orientation (horizontal-first vs vertical-first) is chosen randomly.
// A ±1 jog at the corner is applied with DEVIATION_CHANCE probability.
function carveHallway(grid: number[][], a: Coord, b: Coord, seed: number, width: number, height: number): number {
  let s = seed;
  let val: number;

  [val] = pseudoRandom(s); s = val;
  const horizontalFirst = (val / 0xFFFFFFFF) < 0.5;

  [val] = pseudoRandom(s); s = val;
  const deviate = (val / 0xFFFFFFFF) < DEVIATION_CHANCE;

  let cornerX = horizontalFirst ? b.x : a.x;
  let cornerY = horizontalFirst ? a.y : b.y;

  // Optional ±1 deviation at the bend point
  if (deviate) {
    [val] = pseudoRandom(s); s = val;
    const shift = (val / 0xFFFFFFFF) < 0.5 ? -1 : 1;
    if (horizontalFirst) {
      cornerY = Math.max(1, Math.min(height - 2, cornerY + shift));
    } else {
      cornerX = Math.max(1, Math.min(width - 2, cornerX + shift));
    }
  }

  if (horizontalFirst) {
    // Horizontal segment: a → corner, then vertical: corner → b
    carveSegment(grid, a.x, a.y, cornerX, cornerY, width, height);
    carveSegment(grid, cornerX, cornerY, b.x, b.y, width, height);
  } else {
    // Vertical segment: a → corner, then horizontal: corner → b
    carveSegment(grid, a.x, a.y, cornerX, cornerY, width, height);
    carveSegment(grid, cornerX, cornerY, b.x, b.y, width, height);
  }

  return s;
}

// Carves a single axis-aligned segment from (x1,y1) to (x2,y2).
// One axis must be equal (pure horizontal or pure vertical).
function carveSegment(grid: number[][], x1: number, y1: number, x2: number, y2: number, width: number, height: number): void {
  if (y1 === y2) {
    // Horizontal segment
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      if (x >= 1 && x < width - 1 && y1 >= 1 && y1 < height - 1) {
        grid[y1][x] = FLOOR;
      }
    }
  } else {
    // Vertical segment
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
      if (x1 >= 1 && x1 < width - 1 && y >= 1 && y < height - 1) {
        grid[y][x1] = FLOOR;
      }
    }
  }
}

// --- Entrance / Exit (mirrored from CaveGenerator) ---

function borderQuadrant(cx: number, cy: number, edge: 'top' | 'bottom' | 'left' | 'right'): number {
  switch (edge) {
    case 'top':    return cx < GRID_WIDTH / 2  ? 0 : 1;
    case 'bottom': return cx < GRID_WIDTH / 2  ? 2 : 3;
    case 'left':   return cy < GRID_HEIGHT / 2 ? 0 : 2;
    case 'right':  return cy < GRID_HEIGHT / 2 ? 1 : 3;
  }
}

function findBestOpeningPerQuadrant(grid: number[][]): (BorderOpening | null)[] {
  const best: (BorderOpening | null)[] = [null, null, null, null];

  function consider(o: BorderOpening): void {
    const q = o.quadrant;
    if (best[q] === null || o.distToFloor < best[q]!.distToFloor) {
      best[q] = o;
    }
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

function openingDistance(a: BorderOpening, b: BorderOpening): number {
  return Math.sqrt((a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2);
}

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

  if (entranceOpening === null || exitOpening === null) {
    return;
  }

  stampOpening(grid, entranceOpening, ENTRANCE);
  stampOpening(grid, exitOpening, EXIT);
}

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
