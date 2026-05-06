import { pseudoRandom } from '../utils/PseudoRandom';

const FLOOR = 0;
const WALL = 1;
const ENTRANCE = 2;
const EXIT = 3;
//const DEBUG = 4;

// Dungeon generation parameters
const MIN_ROOM_RADIUS = 3;  // minimum half-extent of any room (produces a 7×7 tile square room)
const MAX_ROOM_RADIUS = 15; // maximum half-extent of any room (produces a 31×31 tile square room)
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
  width: number; // tile width of the carved passage (1, 2, or 3)
}

/** A candidate entrance/exit opening on the map border, associated with the nearest room. */
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

/** Exit face coordinates and perpendicular floor coverage for a room in one direction. */
interface FaceInfo {
  faceCoord: number;  // fixed coordinate of the exit face (x for left/right, y for top/bottom)
  coverMin: number;   // min perpendicular coordinate with floor at the face
  coverMax: number;   // max perpendicular coordinate with floor at the face
  perpCenter: number; // midpoint of coverage — used as the Z-shape stub row/column
}

/** One wall face of a room's AABB, used by findFaceEntry to rank and scan candidate BFS entry points. */
interface Face {
  axis: 'row' | 'col'; // 'row': scan along x at fixed y; 'col': scan along y at fixed x
  fixed: number;       // fixed coordinate (x for 'col', y for 'row')
  scanMin: number;
  scanMax: number;
  midCx: number;       // face midpoint x — used to rank faces by proximity to the target room
  midCy: number;       // face midpoint y
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

  const roomFloors = snapshotFloorSet(grid, width, height);

  const corridors = placeCorridors(grid, rooms, width, height);

  removeOrphanedCorridors(grid, roomFloors, width, height);

  removeIsolatedFloor(grid, width, height);

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
  const ATTACH_GAP  = 5; // wall tiles between room floor edges — must be ≥ 5 so even the widest (3-tile) corridor has room to cross without touching either room face
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

/** Fills a clamped rectangle of FLOOR tiles into the grid. */
function carveRect(grid: number[][], rows: number, cols: number, x0: number, y0: number, x1: number, y1: number): void {
  for (let ty = Math.max(0, y0); ty <= Math.min(rows - 1, y1); ty++) {
    for (let tx = Math.max(0, x0); tx <= Math.min(cols - 1, x1); tx++) {
      grid[ty][tx] = FLOOR;
    }
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

  switch (shape) {

    case 'square':
    case 'rect':
      carveRect(grid, rows, cols, cx - hw, cy - hh, cx + hw, cy + hh);
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
      carveRect(grid, rows, cols, cx - hw, cy - hh, cx + hw, cy + hh);
      if (arm) {
        const ax = cx + arm.dx, ay = cy + arm.dy;
        carveRect(grid, rows, cols, ax - arm.hw, ay - arm.hh, ax + arm.hw, ay + arm.hh);
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
// Corridor placement
// ---------------------------------------------------------------------------

/**
 * Connects rooms in two phases:
 *
 * Phase 1 — nearest-neighbour pass: each room connects to its closest
 * neighbour (plus a 25% chance of a second connection) to produce organic,
 * varied layouts with loops and T-junctions.
 *
 * Phase 2 — connectivity guarantee: a union-find structure tracks which rooms
 * are already reachable from each other. After Phase 1, any rooms that remain
 * in isolated components are bridged by the cheapest available edge
 * (Kruskal-style), ensuring a path always exists from entrance to exit.
 */
function placeCorridors(grid: number[][], rooms: Room[], width: number, height: number): Corridor[] {
  const corridors: Corridor[] = [];
  const n = rooms.length;
  if (n < 2) { return corridors; }

  const parent = Array.from({ length: n }, (_, i) => i);
  const connected = new Set<string>();

  // Phase 1: nearest-neighbour connections.
  for (let i = 0; i < n; i++) {
    const others = rooms
      .map((r, idx) => ({ r, idx, d: (r.cx - rooms[i].cx) ** 2 + (r.cy - rooms[i].cy) ** 2 }))
      .filter(e => e.idx !== i)
      .sort((a, b) => a.d - b.d);

    if (others.length === 0) { continue; }

    const targets = [others[0]];
    if (others.length > 1 && randFloat() < 0.25) { targets.push(others[1]); }

    for (const { r: target, idx: targetIdx } of targets) {
      const key = pairKey(i, targetIdx);
      if (connected.has(key)) { continue; }
      const corridor = carveRoomCorridor(grid, rooms[i], target, rooms, width, height);
      if (corridor) {
        corridors.push(corridor);
        connected.add(key);
        unionRoots(parent, i, targetIdx);
      }
    }
  }

  // Phase 2: bridge any remaining disconnected components with the cheapest edges.
  const edges: Array<{ i: number; j: number; d: number }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      edges.push({ i, j, d: (rooms[i].cx - rooms[j].cx) ** 2 + (rooms[i].cy - rooms[j].cy) ** 2 });
    }
  }
  edges.sort((a, b) => a.d - b.d);

  for (const { i, j } of edges) {
    if (findRoot(parent, i) === findRoot(parent, j)) { continue; }
    const key = pairKey(i, j);
    if (connected.has(key)) { continue; }
    const corridor = carveRoomCorridor(grid, rooms[i], rooms[j], rooms, width, height);
    if (corridor) {
      corridors.push(corridor);
      connected.add(key);
      unionRoots(parent, i, j);
    }
  }

  return corridors;
}

/** Union-find: returns the root of i with path compression. */
function findRoot(parent: number[], i: number): number {
  while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
  return i;
}

/** Union-find: merges the components containing a and b. */
function unionRoots(parent: number[], a: number, b: number): void {
  parent[findRoot(parent, a)] = findRoot(parent, b);
}

/** Canonical string key for an unordered room-index pair. */
function pairKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/** Usable perpendicular half-extent at a room's exit face.
 * Rounded rooms have chamfered corners that reduce the floor width at the
 * outermost column/row, so corridors must stay within this narrower range. */
function exitHalfExtent(room: Room, axis: 'x' | 'y'): number {
  // axis 'x' → corridor exits left/right face, perpendicular = Y → hh
  // axis 'y' → corridor exits top/bottom face, perpendicular = X → hw
  const perp = axis === 'x' ? room.hh : room.hw;
  if (room.shape !== 'rounded') { return perp; }
  const cut = Math.max(1, Math.floor(Math.min(room.hw, room.hh) * 0.25));
  return perp - cut;
}

/** Returns the exit face coordinate and perpendicular floor coverage for a room.
 * When the L-shape arm points in the requested direction its outer face is used
 * instead of the main rectangle's — the arm IS the exit face in that case. */
function getRoomFace(room: Room, dir: 'left' | 'right' | 'top' | 'bottom'): FaceInfo {
  const { cx, cy, hw, hh, arm } = room;

  if (dir === 'right') {
    if (arm && arm.dx > 0) {
      // Arm points right — its outer face IS the right exit face.
      const armCy = cy + arm.dy;
      return { faceCoord: cx + arm.dx + arm.hw, coverMin: armCy - arm.hh, coverMax: armCy + arm.hh, perpCenter: armCy };
    }
    const ext = exitHalfExtent(room, 'x');
    return { faceCoord: cx + hw, coverMin: cy - ext, coverMax: cy + ext, perpCenter: cy };
  }

  if (dir === 'left') {
    if (arm && arm.dx < 0) {
      const armCy = cy + arm.dy;
      return { faceCoord: cx + arm.dx - arm.hw, coverMin: armCy - arm.hh, coverMax: armCy + arm.hh, perpCenter: armCy };
    }
    const ext = exitHalfExtent(room, 'x');
    return { faceCoord: cx - hw, coverMin: cy - ext, coverMax: cy + ext, perpCenter: cy };
  }

  if (dir === 'bottom') {
    if (arm && arm.dy > 0) {
      const armCx = cx + arm.dx;
      return { faceCoord: cy + arm.dy + arm.hh, coverMin: armCx - arm.hw, coverMax: armCx + arm.hw, perpCenter: armCx };
    }
    const ext = exitHalfExtent(room, 'y');
    return { faceCoord: cy + hh, coverMin: cx - ext, coverMax: cx + ext, perpCenter: cx };
  }

  // top
  if (arm && arm.dy < 0) {
    const armCx = cx + arm.dx;
    return { faceCoord: cy + arm.dy - arm.hh, coverMin: armCx - arm.hw, coverMax: armCx + arm.hw, perpCenter: armCx };
  }
  const ext = exitHalfExtent(room, 'y');
  return { faceCoord: cy - hh, coverMin: cx - ext, coverMax: cx + ext, perpCenter: cx };
}

/**
 * Builds a boolean mask of tiles corridors must not touch: every tile inside
 * each non-excluded room's bounding box, expanded by 1 tile. The 1-tile ring
 * is the room's wall — it must remain intact so room silhouettes stay whole.
 */
function buildForbiddenMask(rooms: Room[], exclude: Set<Room>, width: number, height: number, expansion: number = 1): boolean[][] {
  const mask: boolean[][] = Array.from({ length: height }, () => new Array(width).fill(false));
  for (const r of rooms) {
    if (exclude.has(r)) { continue; }
    const bb = getRoomBounds(r);
    const minX = Math.max(0, bb.minX - expansion);
    const maxX = Math.min(width - 1, bb.maxX + expansion);
    const minY = Math.max(0, bb.minY - expansion);
    const maxY = Math.min(height - 1, bb.maxY + expansion);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        mask[y][x] = true;
      }
    }
  }
  return mask;
}

/** True if the 3×3 footprint centred on (x,y) stays in-bounds and hits no forbidden tile. */
function footprintClear(mask: boolean[][], x: number, y: number): boolean {
  const h = mask.length, w = mask[0].length;
  if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) { return false; }
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (mask[y + dy][x + dx]) { return false; }
    }
  }
  return true;
}

/** Generates candidate positions in [min..max] starting at `mid` and expanding outward. */
function scanOutward(mid: number, min: number, max: number): number[] {
  const out: number[] = [];
  if (mid >= min && mid <= max) { out.push(mid); }
  const maxOff = Math.max(mid - min, max - mid);
  for (let i = 1; i <= maxOff; i++) {
    if (mid - i >= min) { out.push(mid - i); }
    if (mid + i <= max) { out.push(mid + i); }
  }
  return out;
}

/** True if every tile along row y from x1 to x2 has a clear 3×3 footprint. */
function horizontalStripClear(mask: boolean[][], y: number, x1: number, x2: number): boolean {
  for (let x = x1; x <= x2; x++) {
    if (!footprintClear(mask, x, y)) { return false; }
  }
  return true;
}

/** True if every tile along column x from y1 to y2 has a clear 3×3 footprint. */
function verticalStripClear(mask: boolean[][], x: number, y1: number, y2: number): boolean {
  for (let y = y1; y <= y2; y++) {
    if (!footprintClear(mask, x, y)) { return false; }
  }
  return true;
}

/**
 * Finds the best entry/exit point on a room's outer wall face toward another room.
 *
 * All four outer wall faces (bbox+2) are considered and ranked by distance to
 * `toward`'s centre, so the face pointing most directly at the other room is
 * tried first. Candidate positions are scanned outward from the face midpoint
 * and the first tile whose 3×3 footprint is clear of forbidden tiles is returned.
 * Returns null if no clear cell exists on any face.
 */
function findFaceEntry(room: Room, toward: Room, mask: boolean[][], width: number, height: number): Coord | null {
  const bb   = getRoomBounds(room);
  const midX = Math.round((bb.minX + bb.maxX) / 2);
  const midY = Math.round((bb.minY + bb.maxY) / 2);

  // bbox+2 so the 3×3 stamp covers bbox+1..bbox+3 — never overwrites the room's floor
  // tile at bbox. The carved wall tile at bbox+1 is adjacent to room floor — connection valid.
  const faces: Face[] = [
    { axis: 'col', fixed: bb.maxX + 2, scanMin: bb.minY, scanMax: bb.maxY, midCx: bb.maxX + 2, midCy: midY },
    { axis: 'col', fixed: bb.minX - 2, scanMin: bb.minY, scanMax: bb.maxY, midCx: bb.minX - 2, midCy: midY },
    { axis: 'row', fixed: bb.maxY + 2, scanMin: bb.minX, scanMax: bb.maxX, midCx: midX,        midCy: bb.maxY + 2 },
    { axis: 'row', fixed: bb.minY - 2, scanMin: bb.minX, scanMax: bb.maxX, midCx: midX,        midCy: bb.minY - 2 },
  ];

  faces.sort((a, b) => {
    const da = (a.midCx - toward.cx) ** 2 + (a.midCy - toward.cy) ** 2;
    const db = (b.midCx - toward.cx) ** 2 + (b.midCy - toward.cy) ** 2;
    return da - db;
  });

  for (const face of faces) {
    const mid = face.axis === 'col' ? midY : midX;
    for (const v of scanOutward(mid, face.scanMin, face.scanMax)) {
      const fx = face.axis === 'col' ? face.fixed : v;
      const fy = face.axis === 'col' ? v         : face.fixed;
      if (fx < 1 || fx >= width - 1 || fy < 1 || fy >= height - 1) { continue; }
      if (footprintClear(mask, fx, fy)) { return { x: fx, y: fy }; }
    }
  }
  return null;
}

/** Maps a room radius to a corridor width: small→1, medium→2, large→3. */
function corridorWidthForRadius(radius: number): number {
  if (radius <= 7)  { return 1; }
  if (radius <= 11) { return 2; }
  return 3;
}

/** Carves a w-tile-wide vertical corridor strip from y=yStart to y=yEnd at column cx. */
function carveVerticalCorridor(grid: number[][], cx: number, yStart: number, yEnd: number, w: number): void {
  const loOff = w === 3 ? 1 : 0;
  const hiOff = w >= 2  ? 1 : 0;
  for (let y = yStart; y <= yEnd; y++) {
    for (let dx = -loOff; dx <= hiOff; dx++) { grid[y][cx + dx] = FLOOR; }
  }
}

/** Carves a w-tile-wide horizontal corridor strip from x=xStart to x=xEnd at row cy. */
function carveHorizontalCorridor(grid: number[][], cy: number, xStart: number, xEnd: number, w: number): void {
  const loOff = w === 3 ? 1 : 0;
  const hiOff = w >= 2  ? 1 : 0;
  for (let x = xStart; x <= xEnd; x++) {
    for (let dy = -loOff; dy <= hiOff; dy++) { grid[cy + dy][x] = FLOOR; }
  }
}

/**
 * Last-resort corridor router used when neither the straight nor Z-shape
 * strategy can find a clear path between two rooms.
 *
 * Start and goal are bbox+2 face tiles found via `findFaceEntry` — one tile
 * outside the wall ring on the face of each room pointing toward the other.
 * The BFS path therefore stays entirely outside both room interiors; the 3×3
 * stamps at the endpoints carve through the wall ring (bbox+1) to open a
 * clean doorway into each room's floor at bbox.
 *
 * Every BFS candidate is tested with `footprintClear`: the 3×3 neighbourhood
 * must be free of forbidden tiles (wall rings of all non-endpoint rooms), so
 * the carved corridor never clips a bystander room.
 *
 * BFS uses a head-index rather than Array.shift() to avoid O(n) dequeues.
 * The path is reconstructed via `parent` and carved by stamping a 3×3
 * footprint at every cell regardless of `w` — the 3×3 stamp is required to
 * break through the wall ring at the entry/exit tiles. Returns null if no
 * valid route exists.
 */
function bfsCorridor(
  grid: number[][], mask: boolean[][], from: Room, to: Room, width: number, height: number, w: number
): Corridor | null {
  // Use outer wall face tiles (bbox + 1) as start and goal so the BFS path
  // never travels through room interiors, avoiding corner-chewing artefacts.
  const start = findFaceEntry(from, to,   mask, width, height) ?? { x: from.cx, y: from.cy };
  const goal  = findFaceEntry(to,   from, mask, width, height) ?? { x: to.cx,   y: to.cy   };

  // endpointMask covers the bbox+2 halo of `from` and `to` (one tile wider than the wall
  // ring). BFS cells other than the goal may not enter this zone, which prevents the path
  // from running parallel to a room face at bbox+2 — a route that would stamp corridor
  // tiles at bbox+1 (adjacent to room floor) along its entire length, violating the
  // 1-tile wall rule everywhere except the intended doorway.
  // The start cell sits at bbox+2 but is seeded directly into `visited`, so BFS departs
  // outward from there without needing to re-enter the halo.
  const endpointMask = buildForbiddenMask([from, to], new Set(), width, height, 2);

  // visited and parent tables are indexed [y][x].
  const visited: boolean[][] = Array.from({ length: height }, () => new Array(width).fill(false));
  const parent: (Coord | null)[][] = Array.from({ length: height }, () => new Array(width).fill(null));
  const queue: Coord[] = [start];
  visited[start.y][start.x] = true;
  let head = 0;
  let found = false;

  while (head < queue.length) {
    const cur = queue[head++];
    if (cur.x === goal.x && cur.y === goal.y) { found = true; break; }
    for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + ddx, ny = cur.y + ddy;
      // Stay one tile inside the map border so 3×3 stamps never go out of bounds.
      if (nx < 1 || ny < 1 || nx >= width - 1 || ny >= height - 1) { continue; }
      if (visited[ny][nx]) { continue; }
      const isGoal = nx === goal.x && ny === goal.y;
      // Block re-entry into from/to's bbox+1 ring except for the goal tile.
      if (!isGoal && endpointMask[ny][nx]) { continue; }
      // Reject cells whose 3×3 footprint would touch any forbidden (other-room wall) tile.
      if (!footprintClear(mask, nx, ny)) { continue; }
      visited[ny][nx] = true;
      parent[ny][nx] = cur;
      queue.push({ x: nx, y: ny });
    }
  }

  if (!found) { return null; }

  // Walk the parent chain from goal back to start and stamp a 3×3 footprint
  // at each cell — always 3×3 so the stamps at the start/goal cells carve
  // through the wall ring (bbox+1) into the room floor at bbox.
  const halfW = 1;
  let cur: Coord | null = goal;
  while (cur) {
    for (let dy = -halfW; dy <= halfW; dy++) {
      for (let dx = -halfW; dx <= halfW; dx++) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
          grid[ny][nx] = FLOOR;
        }
      }
    }
    cur = parent[cur.y][cur.x];
  }

  return { from: start, to: goal, width: w };
}

/**
 * Attempts to connect two rooms with a corridor using three strategies in order:
 *
 * 1. Straight — single horizontal or vertical strip if both face coverages overlap.
 * 2. Z-shape  — two stubs from each room's face perpendicular centre joined by a
 *               perpendicular connector in the gap between them.
 * 3. BFS      — grid pathfinding when the direct routes are blocked by other rooms.
 *
 * Returns a Corridor on success, or null if no valid route could be carved.
 */
function carveRoomCorridor(grid: number[][], from: Room, to: Room, rooms: Room[], width: number, height: number): Corridor | null {
  const mask = buildForbiddenMask(rooms, new Set([from, to]), width, height);
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;

  const w     = corridorWidthForRadius(Math.min(from.radius, to.radius));
  const loOff = w === 3 ? 1 : 0;
  const hiOff = w >= 2  ? 1 : 0;

  // Offset based on direction in order to fix gaps in the corridors
  let offsetYLeft = 0;
  let offsetYRight = 0;
  let offsetXTop = 0;
  let offsetXBottom = 0;

  if (Math.abs(dx) >= Math.abs(dy)) {
    // ── Horizontal primary: rooms are side by side ──────────────────────────
    const leftRoom  = dx >= 0 ? from : to;
    const rightRoom = dx >= 0 ? to   : from;

    // Use actual face positions — accounts for L-shape arms extending in the exit direction.
    const leftFace  = getRoomFace(leftRoom,  'right');
    const rightFace = getRoomFace(rightRoom, 'left');
    const x1 = leftFace.faceCoord;
    const x2 = rightFace.faceCoord;
    if (x1 >= x2) { return bfsCorridor(grid, mask, from, to, width, height, w); }

    // Safe y-range: intersection of both rooms' actual exit face coverage, inset so the
    // corridor's full w-tile extent stays within floor at both faces.
    const safeMin = Math.max(leftFace.coverMin + loOff, rightFace.coverMin + loOff);
    const safeMax = Math.min(leftFace.coverMax - hiOff, rightFace.coverMax - hiOff);

    // Corridor carves start/end 1 tile outside room floor edge so room tiles stay unmodified.
    const cx1 = x1 + 1; // first tile in the gap (just outside left room's right face)
    const cx2 = x2 - 1; // last  tile in the gap (just outside right room's left face)

    if (safeMin <= safeMax && cx1 <= cx2) {
      // Strategy 1 — straight corridor: scan outward from midpoint for a clear row.
      const mid = Math.round((safeMin + safeMax) / 2);
      for (const corY of scanOutward(mid, safeMin, safeMax)) {
        if (horizontalStripClear(mask, corY, cx1, cx2)) {
          carveHorizontalCorridor(grid, corY, cx1, cx2, w);
          return { from: { x: x1, y: corY }, to: { x: x2, y: corY }, width: w };
        }
      }
    }

    // Strategy 2 — Z-shape: stubs exit from the actual face perpendicular centre.
    const leftCy  = Math.max(1, Math.min(height - 2, leftFace.perpCenter));
    const rightCy = Math.max(1, Math.min(height - 2, rightFace.perpCenter));
    const zMin    = Math.min(leftCy, rightCy);
    const zMax    = Math.max(leftCy, rightCy);

    // Offset calc — w=1 uses face centre directly; wider corridors offset by ±1 so the
    // wider carving spans the face floor tile at both stubs.
    if (w === 1) {
      offsetYLeft  = leftCy;
      offsetYRight = rightCy;
    } else if ((dx > 0 && dy > 0) || (dx < 0 && dy < 0)) {
      offsetYLeft  = leftCy  + 1;
      offsetYRight = rightCy - 1;
    } else {
      offsetYLeft  = leftCy  - 1;
      offsetYRight = rightCy + 1;
    }

    // If the offset row has no room floor at either face tile the arms would be
    // disconnected — fall through immediately to BFS rather than carving a stub.
    if (grid[offsetYLeft][x1] !== FLOOR || grid[offsetYRight][x2] !== FLOOR) {
      return bfsCorridor(grid, mask, from, to, width, height, w);
    }

    // gapMid range keeps the w-wide vertical connector ≥1 wall tile away from each room face.
    const midX    = Math.round((cx1 + cx2) / 2);
    for (const gapMid of scanOutward(midX, cx1 + 1 + loOff, cx2 - 1 - hiOff)) {
      if (horizontalStripClear(mask, leftCy, cx1, gapMid) &&
          verticalStripClear(mask, gapMid, zMin, zMax) &&
          horizontalStripClear(mask, rightCy, gapMid, cx2)) {
        carveHorizontalCorridor(grid, offsetYLeft,  cx1,    gapMid, w);
        carveVerticalCorridor  (grid, gapMid,        zMin,   zMax,   w);
        carveHorizontalCorridor(grid, offsetYRight, gapMid, cx2,    w);
        return { from: { x: x1, y: leftCy }, to: { x: x2, y: rightCy }, width: w };
      }
    }

    // Strategy 3 — BFS fallback.
    return bfsCorridor(grid, mask, from, to, width, height, w);

  } else {
    // ── Vertical primary: rooms are above and below ──────────────────────────
    const topRoom    = dy >= 0 ? from : to;
    const bottomRoom = dy >= 0 ? to   : from;

    // Use actual face positions — accounts for L-shape arms extending in the exit direction.
    const topFace    = getRoomFace(topRoom,    'bottom');
    const bottomFace = getRoomFace(bottomRoom, 'top');
    const y1 = topFace.faceCoord;
    const y2 = bottomFace.faceCoord;
    if (y1 >= y2) { return bfsCorridor(grid, mask, from, to, width, height, w); }

    // Safe x-range: intersection of both rooms' actual exit face coverage, inset by w extent.
    const safeMin = Math.max(topFace.coverMin + loOff, bottomFace.coverMin + loOff);
    const safeMax = Math.min(topFace.coverMax - hiOff, bottomFace.coverMax - hiOff);

    // Corridor carves start/end 1 tile outside room floor edge so room tiles stay unmodified.
    const cy1 = y1 + 1; // first tile in the gap (just outside top room's bottom face)
    const cy2 = y2 - 1; // last  tile in the gap (just outside bottom room's top face)

    if (safeMin <= safeMax && cy1 <= cy2) {
      // Strategy 1 — straight corridor: scan outward from midpoint for a clear column.
      const mid = Math.round((safeMin + safeMax) / 2);
      for (const corX of scanOutward(mid, safeMin, safeMax)) {
        if (verticalStripClear(mask, corX, cy1, cy2)) {
          carveVerticalCorridor(grid, corX, cy1, cy2, w);
          return { from: { x: corX, y: y1 }, to: { x: corX, y: y2 }, width: w };
        }
      }
    }

    // Strategy 2 — Z-shape: stubs exit from the actual face perpendicular centre.
    const topCx    = Math.max(1, Math.min(width - 2, topFace.perpCenter));
    const bottomCx = Math.max(1, Math.min(width - 2, bottomFace.perpCenter));
    const zMin     = Math.min(topCx, bottomCx);
    const zMax     = Math.max(topCx, bottomCx);

    // Offset calc — w=1 uses face centre directly; wider corridors offset by ±1.
    if (w === 1) {
      offsetXTop    = topCx;
      offsetXBottom = bottomCx;
    } else if ((dx > 0 && dy > 0) || (dx < 0 && dy < 0)) {
      offsetXTop    = topCx    + 1;
      offsetXBottom = bottomCx - 1;
    } else {
      offsetXTop    = topCx    - 1;
      offsetXBottom = bottomCx + 1;
    }

    // If the offset column has no room floor at either face tile the arms would be
    // disconnected — fall through immediately to BFS rather than carving a stub.
    if (grid[y1][offsetXTop] !== FLOOR || grid[y2][offsetXBottom] !== FLOOR) {
      return bfsCorridor(grid, mask, from, to, width, height, w);
    }

    // gapMid range keeps the w-wide horizontal connector ≥1 wall tile away from each room face.
    const midY     = Math.round((cy1 + cy2) / 2);
    for (const gapMid of scanOutward(midY, cy1 + 1 + loOff, cy2 - 1 - hiOff)) {
      if (verticalStripClear(mask, topCx, cy1, gapMid) &&
          horizontalStripClear(mask, gapMid, zMin, zMax) &&
          verticalStripClear(mask, bottomCx, gapMid, cy2)) {
        carveVerticalCorridor  (grid, offsetXTop,    cy1,    gapMid, w);
        carveHorizontalCorridor(grid, gapMid,         zMin,   zMax,   w);
        carveVerticalCorridor  (grid, offsetXBottom, gapMid, cy2,    w);
        return { from: { x: topCx, y: y1 }, to: { x: bottomCx, y: y2 }, width: w };
      }
    }

    // Strategy 3 — BFS fallback.
    return bfsCorridor(grid, mask, from, to, width, height, w);
  }
}

// ---------------------------------------------------------------------------
// Corridor cleanup
// ---------------------------------------------------------------------------

/** Returns a Set of encoded positions (y * width + x) for every FLOOR tile in the grid. */
function snapshotFloorSet(grid: number[][], width: number, height: number): Set<number> {
  const set = new Set<number>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] === FLOOR) { set.add(y * width + x); }
    }
  }
  return set;
}

/**
 * Destroys any corridor component that does not border at least two distinct
 * room components. Such components are dangling arms that never connect two
 * rooms and would leave unreachable dead-end passages.
 *
 * Corridor tiles are identified as FLOOR tiles whose position was NOT in
 * `roomFloors` (the snapshot taken before placeCorridors ran). Room tiles
 * stay in `roomFloors`; corridor tiles do not, so the two sets are disjoint.
 *
 * Algorithm per corridor component:
 *   1. BFS over corridor tiles to collect the component.
 *   2. Collect unique room-tile seeds adjacent to the component.
 *   3. BFS over room tiles only from those seeds, counting distinct room
 *      components (rooms remain separate islands because corridor tiles are
 *      excluded from traversal).
 *   4. If roomCount < 2, convert every tile in the component to WALL.
 */
function removeOrphanedCorridors(grid: number[][], roomFloors: Set<number>, width: number, height: number): void {
  const visited: boolean[][] = Array.from({ length: height }, () => new Array(width).fill(false));

  for (let sy = 0; sy < height; sy++) {
    for (let sx = 0; sx < width; sx++) {
      const startKey = sy * width + sx;
      if (visited[sy][sx] || grid[sy][sx] !== FLOOR || roomFloors.has(startKey)) { continue; }

      // BFS — collect all tiles in this corridor component.
      const component: Coord[] = [];
      const q: Coord[] = [{ x: sx, y: sy }];
      visited[sy][sx] = true;
      let head = 0;
      while (head < q.length) {
        const cur = q[head++];
        component.push(cur);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cur.x + dx, ny = cur.y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) { continue; }
          const key = ny * width + nx;
          if (visited[ny][nx] || grid[ny][nx] !== FLOOR || roomFloors.has(key)) { continue; }
          visited[ny][nx] = true;
          q.push({ x: nx, y: ny });
        }
      }

      // Collect unique room tiles adjacent to the corridor component.
      const roomSeeds: Coord[] = [];
      const seenRoom = new Set<number>();
      for (const { x, y } of component) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) { continue; }
          const key = ny * width + nx;
          if (!roomFloors.has(key) || seenRoom.has(key)) { continue; }
          seenRoom.add(key);
          roomSeeds.push({ x: nx, y: ny });
        }
      }

      // BFS over room tiles only from each seed, counting distinct room components.
      const roomVisited = new Set<number>();
      let roomCount = 0;
      for (const seed of roomSeeds) {
        const seedKey = seed.y * width + seed.x;
        if (roomVisited.has(seedKey)) { continue; }
        roomCount++;
        const rq: Coord[] = [seed];
        roomVisited.add(seedKey);
        let rhead = 0;
        while (rhead < rq.length) {
          const cur = rq[rhead++];
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cur.x + dx, ny = cur.y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) { continue; }
            const key = ny * width + nx;
            if (!roomFloors.has(key) || roomVisited.has(key)) { continue; }
            roomVisited.add(key);
            rq.push({ x: nx, y: ny });
          }
        }
      }

      if (roomCount < 2) {
        for (const { x, y } of component) {
          grid[y][x] = WALL;
        }
      }
    }
  }
}

/**
 * Keeps only the largest 4-connected FLOOR component. Any smaller disconnected
 * patches are converted back to WALL so the dungeon never contains unreachable
 * floor islands.
 */
function removeIsolatedFloor(grid: number[][], width: number, height: number): void {
  const visited: boolean[][] = Array.from({ length: height }, () => new Array(width).fill(false));
  const components: Coord[][] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (visited[y][x] || grid[y][x] !== FLOOR) { continue; }
      const tiles: Coord[] = [];
      const q: Coord[] = [{ x, y }];
      visited[y][x] = true;
      let head = 0;
      while (head < q.length) {
        const cur = q[head++];
        tiles.push(cur);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cur.x + dx, ny = cur.y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) { continue; }
          if (visited[ny][nx] || grid[ny][nx] !== FLOOR) { continue; }
          visited[ny][nx] = true;
          q.push({ x: nx, y: ny });
        }
      }
      components.push(tiles);
    }
  }

  if (components.length <= 1) { return; }

  let largest = components[0];
  for (const c of components) {
    if (c.length > largest.length) { largest = c; }
  }
  for (const c of components) {
    if (c === largest) { continue; }
    for (const { x, y } of c) {
      grid[y][x] = WALL;
    }
  }
}

// ---------------------------------------------------------------------------
// Entrance / Exit placement
// ---------------------------------------------------------------------------

/**
 * Places a 3×1 entrance and a 3×1 exit on the map border in different quadrants
 * (preferring opposite quadrants when preferDiagonal is set), each connected to
 * the nearest room centre via a 3-tile-wide straight corridor.
 *
 * Only accepts a quadrant pair if the shortest walkable path between their
 * floor targets is at least 25% of the grid diagonal.
 */
function placeEntranceAndExit(grid: number[][], rooms: Room[], preferDiagonal: boolean, width: number, height: number): void {
  const best = findBestOpeningPerQuadrant(rooms, width, height);
  const minTraversable = Math.sqrt(width * width + height * height) * 0.25;

  let entranceOpening: BorderOpening | null = null;
  let exitOpening: BorderOpening | null = null;

  if (preferDiagonal) {
    const diagonalPairs: [number, number][] = [[0, 3], [1, 2]];
    shuffle(diagonalPairs);
    for (const [a, b] of diagonalPairs) {
      const pair = pickOpeningPair(grid, best, a, b, minTraversable, width, height);
      if (pair) { [entranceOpening, exitOpening] = pair; break; }
    }
  }

  if (entranceOpening === null) {
    const allPairs: [number, number][] = [];
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        allPairs.push([a, b]);
      }
    }
    shuffle(allPairs);
    for (const [a, b] of allPairs) {
      const pair = pickOpeningPair(grid, best, a, b, minTraversable, width, height);
      if (pair) { [entranceOpening, exitOpening] = pair; break; }
    }
  }

  if (entranceOpening === null || exitOpening === null) { return; }

  stampOpening(grid, entranceOpening, ENTRANCE, width, height);
  stampOpening(grid, exitOpening, EXIT, width, height);
}

/**
 * Returns [entrance, exit] openings if the walkable path between their floor
 * targets meets the minimum traversable distance, or null if the pair fails.
 * Entrance/exit assignment is randomised.
 */
function pickOpeningPair(
  grid: number[][],
  best: (BorderOpening | null)[],
  a: number,
  b: number,
  minTraversable: number,
  width: number,
  height: number
): [BorderOpening, BorderOpening] | null {
  if (best[a] === null || best[b] === null) { return null; }
  const dist = bfsDistance(grid, best[a]!.floorTarget, best[b]!.floorTarget, width, height);
  if (dist < 0 || dist < minTraversable) { return null; }
  return randFloat() < 0.5
    ? [best[a]!, best[b]!]
    : [best[b]!, best[a]!];
}

/** BFS shortest walkable path distance between two grid points. Returns -1 if unreachable. */
function bfsDistance(grid: number[][], start: Coord, goal: Coord, width: number, height: number): number {
  const dist: number[][] = Array.from({ length: height }, () => new Array(width).fill(-1));
  const queue: Coord[] = [start];
  dist[start.y][start.x] = 0;
  let head = 0;
  while (head < queue.length) {
    const { x, y } = queue[head++];
    if (x === goal.x && y === goal.y) { return dist[y][x]; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) { continue; }
      if (dist[ny][nx] !== -1) { continue; }
      const v = grid[ny][nx];
      if (v !== FLOOR) { continue; }
      dist[ny][nx] = dist[y][x] + 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return -1;
}

/**
 * For each border quadrant, finds the room whose centre is closest to that edge.
 * The floorTarget is the room's AABB edge so stampOpening connects to the actual wall face.
 */
function findBestOpeningPerQuadrant(rooms: Room[], width: number, height: number): (BorderOpening | null)[] {
  const best: (BorderOpening | null)[] = [null, null, null, null];

  for (const room of rooms) {
    const { cx, cy } = room;
    const bb = getRoomBounds(room);
    // distToFloor uses actual AABB so L-shape arms are correctly ranked by proximity to border.
    considerOpening(best, { cx, cy: 0,          edge: 'top',    quadrant: borderQuadrant(cx, 0,          'top',    width, height), distToFloor: bb.minY,              floorTarget: { x: cx, y: bb.minY } });
    considerOpening(best, { cx, cy: height - 1, edge: 'bottom', quadrant: borderQuadrant(cx, height - 1, 'bottom', width, height), distToFloor: height - 1 - bb.maxY, floorTarget: { x: cx, y: bb.maxY } });
    considerOpening(best, { cx: 0,         cy,  edge: 'left',   quadrant: borderQuadrant(0,         cy,  'left',   width, height), distToFloor: bb.minX,              floorTarget: { x: bb.minX, y: cy } });
    considerOpening(best, { cx: width - 1, cy,  edge: 'right',  quadrant: borderQuadrant(width - 1, cy,  'right',  width, height), distToFloor: width - 1 - bb.maxX,  floorTarget: { x: bb.maxX, y: cy } });
  }

  return best;
}

/** Keeps the closer-to-border candidate for each quadrant slot. */
function considerOpening(best: (BorderOpening | null)[], o: BorderOpening): void {
  const q = o.quadrant;
  if (best[q] === null || o.distToFloor < best[q]!.distToFloor) { best[q] = o; }
}

/** Maps a border position to one of four quadrants (0=TL, 1=TR, 2=BL, 3=BR). */
function borderQuadrant(cx: number, cy: number, edge: 'top' | 'bottom' | 'left' | 'right', width: number, height: number): number {
  switch (edge) {
    case 'top':    return cx < width / 2  ? 0 : 1;
    case 'bottom': return cx < width / 2  ? 2 : 3;
    case 'left':   return cy < height / 2 ? 0 : 2;
    case 'right':  return cy < height / 2 ? 1 : 3;
  }
}

/**
 * Carves a 3-tile-wide corridor from just inside the border inward, stopping the moment
 * ANY tile in the 3-wide strip is already FLOOR (= room interior reached). This prevents
 * the corridor from entering or passing through rooms that sit between the border and the
 * target room. The corridor terminates adjacent to the first room floor tile found, which
 * is a valid doorway connection. Then stamps the 3 border cells with value.
 */
function stampOpening(grid: number[][], opening: BorderOpening, value: number, width: number, height: number): void {
  const { cx, cy, edge } = opening;

  switch (edge) {
    case 'top':
      for (let y = 1; y < height - 1; y++) {
        if (grid[y][cx - 1] === FLOOR || grid[y][cx] === FLOOR || grid[y][cx + 1] === FLOOR) { break; }
        grid[y][cx - 1] = FLOOR;
        grid[y][cx]     = FLOOR;
        grid[y][cx + 1] = FLOOR;
      }
      grid[0][cx - 1] = value;
      grid[0][cx]     = value;
      grid[0][cx + 1] = value;
      break;
    case 'bottom':
      for (let y = height - 2; y >= 1; y--) {
        if (grid[y][cx - 1] === FLOOR || grid[y][cx] === FLOOR || grid[y][cx + 1] === FLOOR) { break; }
        grid[y][cx - 1] = FLOOR;
        grid[y][cx]     = FLOOR;
        grid[y][cx + 1] = FLOOR;
      }
      grid[height - 1][cx - 1] = value;
      grid[height - 1][cx]     = value;
      grid[height - 1][cx + 1] = value;
      break;
    case 'left':
      for (let x = 1; x < width - 1; x++) {
        if (grid[cy - 1][x] === FLOOR || grid[cy][x] === FLOOR || grid[cy + 1][x] === FLOOR) { break; }
        grid[cy - 1][x] = FLOOR;
        grid[cy][x]     = FLOOR;
        grid[cy + 1][x] = FLOOR;
      }
      grid[cy - 1][0] = value;
      grid[cy][0]     = value;
      grid[cy + 1][0] = value;
      break;
    case 'right':
      for (let x = width - 2; x >= 1; x--) {
        if (grid[cy - 1][x] === FLOOR || grid[cy][x] === FLOOR || grid[cy + 1][x] === FLOOR) { break; }
        grid[cy - 1][x] = FLOOR;
        grid[cy][x]     = FLOOR;
        grid[cy + 1][x] = FLOOR;
      }
      grid[cy - 1][width - 1] = value;
      grid[cy][width - 1]     = value;
      grid[cy + 1][width - 1] = value;
      break;
  }
}
