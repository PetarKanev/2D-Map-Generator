import { pseudoRandom } from '../utils/PseudoRandom';

const FLOOR = 0;
const WALL = 1;
const ENTRANCE = 2;
const EXIT = 3;

// Dungeon generation parameters
const MIN_ROOM_RADIUS = 8;  // minimum half-extent of any room (produces an 17×17 tile room)
const MAX_ROOM_RADIUS = 20; // maximum half-extent of any room (produces an 41×41 tile room)
const BORDER = 5;           // minimum tiles between any room edge and the map boundary

// ---------------------------------------------------------------------------
// Module-level RNG state — initialized once per generateDungeonGrid call.
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

type RoomShape = 'square' | 'rect' | 'rounded' | 'lshape';

/** Second rectangle of an L-shaped room, offset from the room centre. */
interface RoomArm {
  dx: number; dy: number; // centre offset from room cx/cy
  hw: number; hh: number; // half-extents of the arm rectangle
}

/** A room defined by its centre, base radius, actual half-extents, and carved shape. */
interface Room {
  cx: number;
  cy: number;
  radius: number; // sampled base radius — shapes may extend or contract from this
  hw: number;     // carved half-width  (x extent from centre)
  hh: number;     // carved half-height (y extent from centre)
  shape: RoomShape;
  arm?: RoomArm;  // second rectangle for L-shaped rooms only
}

/** A carved hallway connecting two rooms via their side exit points. */
export interface Corridor {
  from: Coord;   // exit point on the departing room's wall
  to: Coord;     // entry point on the arriving room's wall
  width: number; // tile width of the carved passage (2 or 3)
}

interface BorderOpening {
  cx: number;       // center x of the 3-cell stamp
  cy: number;       // center y of the 3-cell stamp
  edge: 'top' | 'bottom' | 'left' | 'right';
  quadrant: number; // 0=TL, 1=TR, 2=BL, 3=BR
  distToFloor: number;
  floorTarget: Coord;
}

export interface DungeonMetadata {
  roomCount: number;
  corridors: Corridor[];
  floorPercent: number;
  generationTimeMs: number;
  preferDiagonal?: boolean;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function generateDungeonGrid(
  seed: number,
  width: number,
  height: number,
  preferDiagonal: boolean
): { grid: number[][], metadata: DungeonMetadata } {
  const startTime = performance.now();

  _rngSeed = seed; // seed the module-level RNG once

  // Start from solid rock — rooms are carved in
  const grid: number[][] = Array.from({ length: height }, () => new Array(width).fill(WALL));

  const rooms = placeRooms(grid, width, height);

  const corridors = placeCorridors(grid, rooms, width, height);

  placeEntranceAndExit(grid, rooms, preferDiagonal, width, height);

  const floorCells = grid.flat().filter(v => v === FLOOR || v === ENTRANCE || v === EXIT).length;
  const floorPercent = Math.round((floorCells / (width * height)) * 100);
  const generationTimeMs = Math.round(performance.now() - startTime);

  return { grid, metadata: { roomCount: rooms.length, corridors, floorPercent, generationTimeMs, preferDiagonal } };
}

// ---------------------------------------------------------------------------
// Room placement
// ---------------------------------------------------------------------------

/**
 * Places rooms as a compact building cluster seeded near the map centre.
 * Every subsequent room is attached directly to the side of an existing room
 * with a small wall gap. Perpendicular position snaps to one of three
 * shared-edge-line modes (centre, near-edge, far-edge) to produce an
 * architectural floor-plan feel. The cluster's perpendicular extent is tracked
 * so rooms cannot bulge past the established boundary.
 */
function placeRooms(grid: number[][], width: number, height: number): Room[] {
  const ATTACH_GAP  = 3; // wall tiles between room floor edges — minimum corridor length
  const targetCount = Math.max(6, Math.floor((width * height) / 700));
  const rooms: Room[] = [];

  // Seed room — placed near the map centre with a small random jitter
  const r0  = MIN_ROOM_RADIUS + Math.floor(randFloat() * (MAX_ROOM_RADIUS - MIN_ROOM_RADIUS + 1));
  const cx0 = Math.round(width  / 2) + Math.floor((randFloat() - 0.5) * width  * 0.08);
  const cy0 = Math.round(height / 2) + Math.floor((randFloat() - 0.5) * height * 0.08);
  const { hw: hw0, hh: hh0, shape: sh0, arm: arm0 } = buildRoomShape(r0);
  // Extend the clamp bounds to cover the arm's footprint, not just the main rect.
  const armRelMinX0 = arm0 ? Math.min(0, arm0.dx - arm0.hw) : 0;
  const armRelMaxX0 = arm0 ? Math.max(0, arm0.dx + arm0.hw) : 0;
  const armRelMinY0 = arm0 ? Math.min(0, arm0.dy - arm0.hh) : 0;
  const armRelMaxY0 = arm0 ? Math.max(0, arm0.dy + arm0.hh) : 0;
  const seed: Room = {
    cx: Math.max(hw0 - armRelMinX0 + BORDER, Math.min(width  - 1 - BORDER - hw0 - armRelMaxX0, cx0)),
    cy: Math.max(hh0 - armRelMinY0 + BORDER, Math.min(height - 1 - BORDER - hh0 - armRelMaxY0, cy0)),
    radius: r0, hw: hw0, hh: hh0, shape: sh0, arm: arm0,
  };
  carveRoom(grid, seed);
  rooms.push(seed);

  // Cluster bounding box (full AABB including arms), kept up to date as rooms are placed.
  const seedBB = getRoomBounds(seed);
  let clMinX = seedBB.minX, clMaxX = seedBB.maxX;
  let clMinY = seedBB.minY, clMaxY = seedBB.maxY;

  // Grow the cluster — each new room is attached to a random existing room.
  const maxAttempts = targetCount * 20;
  for (let attempt = 0; attempt < maxAttempts && rooms.length < targetCount; attempt++) {
    const parent = rooms[Math.floor(randFloat() * rooms.length)];
    const newR   = MIN_ROOM_RADIUS + Math.floor(randFloat() * (MAX_ROOM_RADIUS - MIN_ROOM_RADIUS + 1));
    const { hw: newHW, hh: newHH, shape: newShape, arm: newArm } = buildRoomShape(newR);

    // Try all 4 attachment sides in shuffled order — first valid placement wins.
    const sides: Array<'top' | 'bottom' | 'left' | 'right'> = ['top', 'bottom', 'left', 'right'];
    shuffle(sides);

    for (const side of sides) {
      // Perpendicular offset — one of three edge-alignment modes:
      //   centre    (perp = 0):              room centres share the same axis line
      //   near-edge (perp = newP - parentP): nearest edges align, sharing a wall line
      //   far-edge  (perp = parentP - newP): furthest edges align, sharing a wall line
      const parentPerp = (side === 'right' || side === 'left') ? parent.hh : parent.hw;
      const newPerp    = (side === 'right' || side === 'left') ? newHH     : newHW;
      const alignRoll  = randFloat();
      let perp: number;
      if (alignRoll < 0.34) {
        perp = 0;
      } else if (alignRoll < 0.67) {
        perp =  newPerp - parentPerp;
      } else {
        perp = parentPerp - newPerp;
      }
      if (randFloat() < 0.2) { perp += randFloat() < 0.5 ? -1 : 1; } // ±1 tile jitter

      // Clamp perp so the new room doesn't extend past the cluster's current boundary.
      if (rooms.length >= 3) {
        if (side === 'right' || side === 'left') {
          const cyMin = clMinY + newHH;
          const cyMax = clMaxY - newHH;
          if (cyMax >= cyMin) {
            perp = Math.max(cyMin - parent.cy, Math.min(cyMax - parent.cy, perp));
          }
        } else {
          const cxMin = clMinX + newHW;
          const cxMax = clMaxX - newHW;
          if (cxMax >= cxMin) {
            perp = Math.max(cxMin - parent.cx, Math.min(cxMax - parent.cx, perp));
          }
        }
      }

      // Position the new room flush against the chosen side, ATTACH_GAP tiles away.
      let cx: number, cy: number;
      if      (side === 'right')  { cx = parent.cx + parent.hw + ATTACH_GAP + newHW; cy = parent.cy + perp; }
      else if (side === 'left')   { cx = parent.cx - parent.hw - ATTACH_GAP - newHW; cy = parent.cy + perp; }
      else if (side === 'bottom') { cy = parent.cy + parent.hh + ATTACH_GAP + newHH; cx = parent.cx + perp; }
      else                        { cy = parent.cy - parent.hh - ATTACH_GAP - newHH; cx = parent.cx + perp; }

      const candidate: Room = { cx, cy, radius: newR, hw: newHW, hh: newHH, shape: newShape, arm: newArm };

      // Reject if the full AABB (including arm) breaches the border or overlaps another room.
      const bb = getRoomBounds(candidate);
      if (bb.minX < BORDER || bb.maxX > width  - 1 - BORDER ||
          bb.minY < BORDER || bb.maxY > height - 1 - BORDER) { continue; }
      if (rooms.some(r => roomsOverlap(r, candidate))) { continue; }

      carveRoom(grid, candidate);
      rooms.push(candidate);
      clMinX = Math.min(clMinX, bb.minX);
      clMaxX = Math.max(clMaxX, bb.maxX);
      clMinY = Math.min(clMinY, bb.minY);
      clMaxY = Math.max(clMaxY, bb.maxY);
      break;
    }
  }

  return rooms;
}

/**
 * Randomly picks a shape and computes the matching half-extents and optional arm.
 * Shape distribution: 25% square, 25% rect, 20% rounded, 30% L-shape.
 */
function buildRoomShape(radius: number): Pick<Room, 'hw' | 'hh' | 'shape' | 'arm'> {
  const roll = randFloat();

  if (roll < 0.25) {
    // Square — equal half-extents on both axes
    return { hw: radius, hh: radius, shape: 'square' };

  } else if (roll < 0.50) {
    // Rectangle — one axis stretched by 1–3 extra tiles
    const extra = 1 + Math.floor(randFloat() * 3);
    const wideX = randFloat() < 0.5;
    return {
      hw: wideX ? radius + extra : radius,
      hh: wideX ? radius        : radius + extra,
      shape: 'rect',
    };

  } else if (roll < 0.70) {
    // Rounded square — full rectangle with ~25% corner tiles chamfered off
    return { hw: radius, hh: radius, shape: 'rounded' };

  } else {
    // L-shape — main square plus a half-sized arm on a random side
    const armR  = Math.max(MIN_ROOM_RADIUS - 2, Math.floor(radius * 0.5));
    const sides: Array<'top' | 'bottom' | 'left' | 'right'> = ['top', 'bottom', 'left', 'right'];
    const side  = sides[Math.floor(randFloat() * 4)];
    let dx = 0, dy = 0;
    if (side === 'right')  { dx =  radius + armR; }
    if (side === 'left')   { dx = -radius - armR; }
    if (side === 'bottom') { dy =  radius + armR; }
    if (side === 'top')    { dy = -radius - armR; }
    const arm: RoomArm = { dx, dy, hw: armR, hh: armR };
    return { hw: radius, hh: radius, shape: 'lshape', arm };
  }
}

/**
 * Carves a room's shape into the grid.
 * All tile writes are clamped to valid grid indices so arm tiles that stray
 * near the border never cause an out-of-bounds write.
 */
function carveRoom(grid: number[][], room: Room): void {
  const { cx, cy, hw, hh, shape, arm } = room;

  const rows = grid.length;
  const cols = grid[0].length;

  const carveRect = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let ty = Math.max(0, y0); ty <= Math.min(rows - 1, y1); ty++) {
      for (let tx = Math.max(0, x0); tx <= Math.min(cols - 1, x1); tx++) {
        grid[ty][tx] = FLOOR;
      }
    }
  };

  switch (shape) {

    case 'square':
    case 'rect':
      carveRect(cx - hw, cy - hh, cx + hw, cy + hh);
      break;

    case 'rounded': {
      // Full rectangle with the outermost ~25% corner tiles cut away.
      const cut = Math.max(1, Math.floor(Math.min(hw, hh) * 0.25));
      for (let ty = Math.max(0, cy - hh); ty <= Math.min(rows - 1, cy + hh); ty++) {
        for (let tx = Math.max(0, cx - hw); tx <= Math.min(cols - 1, cx + hw); tx++) {
          const ax = Math.abs(tx - cx), ay = Math.abs(ty - cy);
          if (ax > hw - cut && ay > hh - cut) { continue; }
          grid[ty][tx] = FLOOR;
        }
      }
      break;
    }

    case 'lshape':
      // Main rectangle plus the arm rectangle.
      carveRect(cx - hw, cy - hh, cx + hw, cy + hh);
      if (arm) {
        const ax = cx + arm.dx, ay = cy + arm.dy;
        carveRect(ax - arm.hw, ay - arm.hh, ax + arm.hw, ay + arm.hh);
      }
      break;
  }
}

/** Returns the bounding box of a room, expanded to include any L-shape arm. */
function getRoomBounds(r: Room): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = r.cx - r.hw, maxX = r.cx + r.hw;
  let minY = r.cy - r.hh, maxY = r.cy + r.hh;
  if (r.arm) {
    const ax = r.cx + r.arm.dx, ay = r.cy + r.arm.dy;
    minX = Math.min(minX, ax - r.arm.hw); maxX = Math.max(maxX, ax + r.arm.hw);
    minY = Math.min(minY, ay - r.arm.hh); maxY = Math.max(maxY, ay + r.arm.hh);
  }
  return { minX, maxX, minY, maxY };
}

/** Returns true if the two rooms' full AABBs (Axis-Aligned Bounding Boxes) overlap when each is expanded by the buffer gap. */
function roomsOverlap(a: Room, b: Room): boolean {
  const gap = 2;
  const ab = getRoomBounds(a), bb = getRoomBounds(b);
  return ab.minX - gap <= bb.maxX && ab.maxX + gap >= bb.minX &&
         ab.minY - gap <= bb.maxY && ab.maxY + gap >= bb.minY;
}

/** Fisher-Yates shuffle using the module-level RNG. Mutates the array in place. */
function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(randFloat() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---------------------------------------------------------------------------
// Corridor placement TODO: This is not working very well 
// ---------------------------------------------------------------------------

/**
 * Connects rooms with straight 3-tile-wide corridors.
 * Each room exits from the centre of its wall face nearest to the target room.
 * A 25% chance causes a second connection to the next-nearest room, producing
 * T-junctions where corridors share a wall tile.
 */
function placeCorridors(grid: number[][], rooms: Room[], width: number, height: number): Corridor[] {
  const corridors: Corridor[] = [];

  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];

    // Sort all other rooms by centre distance.
    const others = rooms
      .map((r, idx) => ({ r, idx, d: (r.cx - room.cx) ** 2 + (r.cy - room.cy) ** 2 }))
      .filter(e => e.idx !== i)
      .sort((a, b) => a.d - b.d);

    if (others.length === 0) { continue; }

    const targets = [others[0]];
    if (others.length > 1 && randFloat() < 0.25) { targets.push(others[1]); }

    for (const { r: target } of targets) {
      const corridor = carveRoomCorridor(grid, room, target, width, height);
      if (corridor) { corridors.push(corridor); }
    }
  }

  return corridors;
}

/**
 * Carves a single straight 3-tile-wide corridor from `from` to `to`.
 * Exits from the centre of whichever wall face of `from` points most directly
 * at `to`, and enters `to` through its opposing face. The corridor is L-shaped
 * when the two exit points are not axis-aligned: horizontal segment first, then
 * vertical.
 */
function carveRoomCorridor(grid: number[][], from: Room, to: Room, width: number, height: number): Corridor | null {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;

  // Exit point: centre of the wall face of `from` that faces `to`.
  let x1: number, y1: number;
  if (Math.abs(dx) >= Math.abs(dy)) {
    x1 = dx > 0 ? from.cx + from.hw : from.cx - from.hw;
    y1 = from.cy;
  } else {
    x1 = from.cx;
    y1 = dy > 0 ? from.cy + from.hh : from.cy - from.hh;
  }

  // Entry point: centre of the opposing face of `to`.
  let x2: number, y2: number;
  if (Math.abs(dx) >= Math.abs(dy)) {
    x2 = dx > 0 ? to.cx - to.hw : to.cx + to.hw;
    y2 = to.cy;
  } else {
    x2 = to.cx;
    y2 = dy > 0 ? to.cy - to.hh : to.cy + to.hh;
  }

  // Clamp endpoints to grid interior.
  x1 = Math.max(1, Math.min(width  - 2, x1));
  y1 = Math.max(1, Math.min(height - 2, y1));
  x2 = Math.max(1, Math.min(width  - 2, x2));
  y2 = Math.max(1, Math.min(height - 2, y2));

  // Horizontal leg then vertical leg (L-shape or straight).
  carveHorizontalCorridor(grid, y1, Math.min(x1, x2), Math.max(x1, x2));
  carveVerticalCorridor(grid, x2, Math.min(y1, y2), Math.max(y1, y2));

  return { from: { x: x1, y: y1 }, to: { x: x2, y: y2 }, width: 3 };
}

// ---------------------------------------------------------------------------
// Entrance / Exit placement
// ---------------------------------------------------------------------------

/**
 * Places a 3×1 entrance and a 3×1 exit on the map border in different quadrants
 * (preferring opposite quadrants when preferDiagonal is set), each connected to
 * the nearest room centre via a 3-tile-wide straight corridor.
 */
function placeEntranceAndExit(grid: number[][], rooms: Room[], preferDiagonal: boolean, width: number, height: number): void {
  const best = findBestOpeningPerQuadrant(rooms, width, height);
  const minDist = width / 4;

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

  stampOpening(grid, entranceOpening, ENTRANCE, width, height);
  stampOpening(grid, exitOpening, EXIT, width, height);
}

/**
 * For each border quadrant, finds the room whose centre is closest to that edge.
 * The floorTarget is the room centre so stampOpening tunnels to the middle of the room.
 */
function findBestOpeningPerQuadrant(rooms: Room[], width: number, height: number): (BorderOpening | null)[] {
  const best: (BorderOpening | null)[] = [null, null, null, null];

  function consider(o: BorderOpening): void {
    const q = o.quadrant;
    if (best[q] === null || o.distToFloor < best[q]!.distToFloor) { best[q] = o; }
  }

  for (const { cx, cy } of rooms) {
    consider({ cx, cy: 0,          edge: 'top',    quadrant: borderQuadrant(cx, 0,          'top',    width, height), distToFloor: cy,              floorTarget: { x: cx, y: cy } });
    consider({ cx, cy: height - 1, edge: 'bottom', quadrant: borderQuadrant(cx, height - 1, 'bottom', width, height), distToFloor: height - 1 - cy, floorTarget: { x: cx, y: cy } });
    consider({ cx: 0,         cy,  edge: 'left',   quadrant: borderQuadrant(0,         cy,  'left',   width, height), distToFloor: cx,              floorTarget: { x: cx, y: cy } });
    consider({ cx: width - 1, cy,  edge: 'right',  quadrant: borderQuadrant(width - 1, cy,  'right',  width, height), distToFloor: width - 1 - cx,  floorTarget: { x: cx, y: cy } });
  }

  return best;
}

/** Carves a 3-tile-wide corridor from just inside the border to floorTarget, then stamps the 3 border cells with value. */
function stampOpening(grid: number[][], opening: BorderOpening, value: number, width: number, height: number): void {
  const { cx, cy, edge, floorTarget } = opening;

  switch (edge) {
    case 'top':
      carveVerticalCorridor(grid, cx, 1, floorTarget.y);
      grid[0][cx - 1] = value;
      grid[0][cx]     = value;
      grid[0][cx + 1] = value;
      break;
    case 'bottom':
      carveVerticalCorridor(grid, cx, floorTarget.y, height - 2);
      grid[height - 1][cx - 1] = value;
      grid[height - 1][cx]     = value;
      grid[height - 1][cx + 1] = value;
      break;
    case 'left':
      carveHorizontalCorridor(grid, cy, 1, floorTarget.x);
      grid[cy - 1][0] = value;
      grid[cy][0]     = value;
      grid[cy + 1][0] = value;
      break;
    case 'right':
      carveHorizontalCorridor(grid, cy, floorTarget.x, width - 2);
      grid[cy - 1][width - 1] = value;
      grid[cy][width - 1]     = value;
      grid[cy + 1][width - 1] = value;
      break;
  }
}

/** Carves a 3-tile-wide vertical corridor strip from y=yStart to y=yEnd at column cx. */
function carveVerticalCorridor(grid: number[][], cx: number, yStart: number, yEnd: number): void {
  for (let y = yStart; y <= yEnd; y++) {
    grid[y][cx - 1] = FLOOR;
    grid[y][cx]     = FLOOR;
    grid[y][cx + 1] = FLOOR;
  }
}

/** Carves a 3-tile-wide horizontal corridor strip from x=xStart to x=xEnd at row cy. */
function carveHorizontalCorridor(grid: number[][], cy: number, xStart: number, xEnd: number): void {
  for (let x = xStart; x <= xEnd; x++) {
    grid[cy - 1][x] = FLOOR;
    grid[cy][x]     = FLOOR;
    grid[cy + 1][x] = FLOOR;
  }
}

function openingDistance(a: BorderOpening, b: BorderOpening): number {
  return Math.sqrt((a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2);
}

function borderQuadrant(cx: number, cy: number, edge: 'top' | 'bottom' | 'left' | 'right', width: number, height: number): number {
  switch (edge) {
    case 'top':    return cx < width / 2  ? 0 : 1;
    case 'bottom': return cx < width / 2  ? 2 : 3;
    case 'left':   return cy < height / 2 ? 0 : 2;
    case 'right':  return cy < height / 2 ? 1 : 3;
  }
}
