import { pseudoRandom } from './PseudoRandom';

// Grid dimensions. Each cell renders as CELL_SIZE px (set in GenerateMap.tsx),
// giving a GRID_WIDTH × CELL_SIZE by GRID_HEIGHT × CELL_SIZE pixel canvas.
const GRID_WIDTH = 100;
const GRID_HEIGHT = 100;

// Target fraction of the grid that should be open floor (rooms).
// 0.50 = 50% of cells will be carved into rooms.
// Higher values produce more/larger rooms; lower values produce a sparser dungeon.
const FILL_RATIO = 0.40;

// Minimum and maximum side length (in cells) of any generated room.
const ROOM_MIN_SIZE = 5;
const ROOM_MAX_SIZE = 35;

// Maximum number of room placement attempts before stopping.
// Prevents an infinite loop when the grid is too full to fit any more rooms.
const MAX_PLACEMENT_ATTEMPTS = 500;

// Cell values written into the grid:
//   0 = walkable floor
//   1 = impassable wall
//   2 = entrance
//   3 = exit
const FLOOR = 0;
const WALL = 1;
const ENTRANCE = 2;
const EXIT = 3;

interface Room {
  x: number;      // left edge (inclusive, 0-based)
  y: number;      // top edge (inclusive, 0-based)
  width: number;
  height: number;
}

// Returns the center cell of a room.
function roomCenter(room: Room): [number, number] {
  return [
    Math.floor(room.x + room.width / 2),
    Math.floor(room.y + room.height / 2),
  ];
}

// Entry point. Generates a room-based dungeon with hallway connections,
// an entrance, and an exit placed in opposite hemispheres.
// Returns a 2D grid: 0=floor, 1=wall, 2=entrance, 3=exit.
export function generateDungeonGrid(seed: number): number[][] {
  // Start with every cell as a wall; rooms and hallways carve into it.
  const grid: number[][] = Array.from({ length: GRID_HEIGHT }, () =>
    new Array(GRID_WIDTH).fill(WALL)
  );

  const { rooms, nextSeed } = generateRooms(seed);

  for (const room of rooms) {
    carveRoom(grid, room);
  }

  // MST guarantees every room is reachable — no isolated rooms.
  const mstEdges = buildMST(rooms);
  for (const [i, j] of mstEdges) {
    const [x1, y1] = roomCenter(rooms[i]);
    const [x2, y2] = roomCenter(rooms[j]);
    carveHallway(grid, x1, y1, x2, y2);
  }

  placeEntranceAndExit(grid, rooms, nextSeed);

  return grid;
}

// Generates non-overlapping rooms with at least a 1-cell wall gap between them.
// Stops when the total carved floor area reaches the FILL_RATIO target,
// or when MAX_PLACEMENT_ATTEMPTS have been exhausted.
// Returns the rooms and the last seed value (for downstream use).
function generateRooms(seed: number): { rooms: Room[]; nextSeed: number } {
  const rooms: Room[] = [];
  const targetFloorArea = GRID_WIDTH * GRID_HEIGHT * FILL_RATIO;
  let totalArea = 0;
  let currentSeed = seed;
  let attempts = 0;

  while (totalArea < targetFloorArea && attempts < MAX_PLACEMENT_ATTEMPTS) {
    attempts++;

    // Chain four PseudoRandom calls to get independent values for w, h, x, y.
    const [wVal] = pseudoRandom(currentSeed);
    const [hVal] = pseudoRandom(wVal);
    const [xVal] = pseudoRandom(hVal);
    const [yVal] = pseudoRandom(xVal);
    currentSeed = yVal;

    const width = ROOM_MIN_SIZE + Math.floor((wVal / 0xFFFFFFFF) * (ROOM_MAX_SIZE - ROOM_MIN_SIZE + 1));
    const height = ROOM_MIN_SIZE + Math.floor((hVal / 0xFFFFFFFF) * (ROOM_MAX_SIZE - ROOM_MIN_SIZE + 1));

    // Keep rooms at least 1 cell from the grid border so border walls stay intact.
    const maxX = GRID_WIDTH - width - 1;
    const maxY = GRID_HEIGHT - height - 1;
    if (maxX < 1 || maxY < 1) {
      continue;
    }

    const x = 1 + Math.floor((xVal / 0xFFFFFFFF) * maxX);
    const y = 1 + Math.floor((yVal / 0xFFFFFFFF) * maxY);

    const room: Room = { x, y, width, height };
    if (!overlapsAny(room, rooms)) {
      rooms.push(room);
      totalArea += width * height;
    }
  }

  return { rooms, nextSeed: currentSeed };
}

// Returns true if `room` overlaps or is directly adjacent to any room in `rooms`.
// The +1 comparison enforces a minimum 1-cell gap between rooms,
// ensuring there is always a wall between two rooms for hallways to pass through.
function overlapsAny(room: Room, rooms: Room[]): boolean {
  return rooms.some(other =>
    room.x < other.x + other.width + 1 &&
    room.x + room.width + 1 > other.x &&
    room.y < other.y + other.height + 1 &&
    room.y + room.height + 1 > other.y
  );
}

// Sets every cell inside the room boundary to floor.
function carveRoom(grid: number[][], room: Room): void {
  for (let y = room.y; y < room.y + room.height; y++) {
    for (let x = room.x; x < room.x + room.width; x++) {
      grid[y][x] = FLOOR;
    }
  }
}

// Carves an L-shaped hallway between two points.
// First moves horizontally from (x1, y1) to (x2, y1),
// then vertically from (x2, y1) to (x2, y2).
function carveHallway(grid: number[][], x1: number, y1: number, x2: number, y2: number): void {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
    grid[y1][x] = FLOOR;
  }
  for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
    grid[y][x2] = FLOOR;
  }
}

// Builds a Minimum Spanning Tree over rooms using Prim's algorithm,
// connecting rooms by Manhattan distance between their centers.
// Every room in the MST is reachable from every other room,
// guaranteeing no isolated rooms exist after hallways are carved.
function buildMST(rooms: Room[]): Array<[number, number]> {
  if (rooms.length <= 1) {
    return [];
  }

  const edges: Array<[number, number]> = [];
  const connected = new Set<number>([0]);

  while (connected.size < rooms.length) {
    let bestDist = Infinity;
    let bestEdge: [number, number] = [0, 1];

    for (const i of connected) {
      for (let j = 0; j < rooms.length; j++) {
        if (connected.has(j)) {
          continue;
        }
        const [cx1, cy1] = roomCenter(rooms[i]);
        const [cx2, cy2] = roomCenter(rooms[j]);
        const dist = Math.abs(cx1 - cx2) + Math.abs(cy1 - cy2);
        if (dist < bestDist) {
          bestDist = dist;
          bestEdge = [i, j];
        }
      }
    }

    edges.push(bestEdge);
    connected.add(bestEdge[1]);
  }

  return edges;
}

// Selects entrance and exit rooms in opposite hemispheres, then carves
// 3-cell-wide openings on the corresponding map edges and connects each
// opening to its room via a wandering hallway.
//
// Split axis (horizontal = top/bottom, vertical = left/right) and which
// half the entrance goes in are chosen from the seed.
// If all rooms land in the same half (edge case) the two most extreme
// rooms along the chosen axis are used as fallback.
function placeEntranceAndExit(grid: number[][], rooms: Room[], seed: number): void {
  if (rooms.length < 2) {
    return;
  }

  const [axisVal] = pseudoRandom(seed);
  const [sideVal] = pseudoRandom(axisVal);
  const horizontal = (axisVal / 0xFFFFFFFF) < 0.5;
  const entranceInFirstHalf = (sideVal / 0xFFFFFFFF) < 0.5;

  const midpoint = horizontal ? GRID_HEIGHT / 2 : GRID_WIDTH / 2;

  const firstHalf: number[] = [];
  const secondHalf: number[] = [];
  for (let i = 0; i < rooms.length; i++) {
    const [cx, cy] = roomCenter(rooms[i]);
    const pos = horizontal ? cy : cx;
    if (pos < midpoint) {
      firstHalf.push(i);
    } else {
      secondHalf.push(i);
    }
  }

  let entranceIdx: number;
  let exitIdx: number;

  if (firstHalf.length === 0 || secondHalf.length === 0) {
    const sorted = [...rooms.keys()].sort((a, b) => {
      const [ax, ay] = roomCenter(rooms[a]);
      const [bx, by] = roomCenter(rooms[b]);
      return horizontal ? ay - by : ax - bx;
    });
    entranceIdx = entranceInFirstHalf ? sorted[0] : sorted[sorted.length - 1];
    exitIdx = entranceInFirstHalf ? sorted[sorted.length - 1] : sorted[0];
  } else {
    const entrancePool = entranceInFirstHalf ? firstHalf : secondHalf;
    const exitPool = entranceInFirstHalf ? secondHalf : firstHalf;
    entranceIdx = deepestRoom(entrancePool, rooms, horizontal, entranceInFirstHalf);
    exitIdx = deepestRoom(exitPool, rooms, horizontal, !entranceInFirstHalf);
  }

  // Derive independent seeds for each opening's connecting hallway.
  const [entranceSeed] = pseudoRandom(sideVal);
  const [exitSeed] = pseudoRandom(entranceSeed);

  carveEdgeOpening(grid, rooms[entranceIdx], horizontal, entranceInFirstHalf, ENTRANCE, entranceSeed);
  carveEdgeOpening(grid, rooms[exitIdx], horizontal, !entranceInFirstHalf, EXIT, exitSeed);
}

// Carves a 3-cell-wide opening on the map border and connects it to the room
// via a wandering hallway. The opening is aligned with the room center on the
// perpendicular axis and clamped so all 3 cells stay within grid bounds.
// The hallway is carved first, then the 3 border cells are stamped with
// cellValue so the hallway does not overwrite them with plain FLOOR.
function carveEdgeOpening(
  grid: number[][],
  room: Room,
  horizontal: boolean,
  inFirstHalf: boolean,
  cellValue: number,
  seed: number
): void {
  const [rx, ry] = roomCenter(room);

  if (horizontal) {
    // Top edge (inFirstHalf) or bottom edge (!inFirstHalf).
    const edgeY = inFirstHalf ? 0 : GRID_HEIGHT - 1;
    const cx = Math.max(1, Math.min(GRID_WIDTH - 2, rx));
    carveHallway(grid, cx, edgeY, rx, ry);
    for (let dx = -1; dx <= 1; dx++) {
      const ox = cx + dx;
      if (ox >= 0 && ox < GRID_WIDTH) {
        grid[edgeY][ox] = cellValue;
      }
    }
  } else {
    // Left edge (inFirstHalf) or right edge (!inFirstHalf).
    const edgeX = inFirstHalf ? 0 : GRID_WIDTH - 1;
    const cy = Math.max(1, Math.min(GRID_HEIGHT - 2, ry));
    carveHallway(grid, edgeX, cy, rx, ry);
    for (let dy = -1; dy <= 1; dy++) {
      const oy = cy + dy;
      if (oy >= 0 && oy < GRID_HEIGHT) {
        grid[oy][edgeX] = cellValue;
      }
    }
  }
}

// Returns the index of the room in `pool` whose center is farthest from the
// midpoint along the split axis (i.e., deepest into its hemisphere).
// `inFirstHalf` tells us which direction "deep" means:
//   first half  → smallest position value (closest to 0)
//   second half → largest position value (closest to grid edge)
function deepestRoom(pool: number[], rooms: Room[], horizontal: boolean, inFirstHalf: boolean): number {
  let best = pool[0];
  let bestScore = -Infinity;

  for (const idx of pool) {
    const [cx, cy] = roomCenter(rooms[idx]);
    const pos = horizontal ? cy : cx;
    // Negate pos for firstHalf so that smaller positions score higher.
    const score = inFirstHalf ? -pos : pos;
    if (score > bestScore) {
      bestScore = score;
      best = idx;
    }
  }

  return best;
}