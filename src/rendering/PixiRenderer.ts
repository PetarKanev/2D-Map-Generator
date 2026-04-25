import { Application, Graphics } from 'pixi.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CELL_SIZE = 5; // pixels per grid tile

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pixiApp: Application | null = null; // single persistent PixiJS instance

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface PaintOptions {
  floorColor: number;
  wallFlatColor?: number;        // flat wall color — used when wallDepth is not provided
  wallDepth?: number[][];        // per-tile BFS distance from nearest walkable cell
  wallDepthColors?: [number, number][]; // pairs of [bfsDistance, color]; cells deeper than the last entry remain black
}

// ---------------------------------------------------------------------------
// Wall depth
// ---------------------------------------------------------------------------

/** BFS outward from all non-wall cells to compute each wall tile's distance from the nearest walkable cell. */
export function computeWallDepth(grid: number[][]): number[][] {
  const height = grid.length;
  const width = grid[0].length;
  const depth: number[][] = Array.from({ length: height }, () =>
    new Array(width).fill(Infinity)
  );

  const queue: number[] = [];
  let head = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] !== 1) {
        depth[y][x] = 0;
        queue.push(y * width + x);
      }
    }
  }

  while (head < queue.length) {
    const idx = queue[head++];
    const y = Math.floor(idx / width);
    const x = idx % width;
    const nextDist = depth[y][x] + 1;
    for (const [dy, dx] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const ny = y + dy;
      const nx = x + dx;
      if (ny >= 0 && ny < height && nx >= 0 && nx < width && depth[ny][nx] === Infinity) {
        depth[ny][nx] = nextDist;
        queue.push(ny * width + nx);
      }
    }
  }

  return depth;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/** Creates the PixiJS app on first call; resizes and clears the stage on subsequent calls. */
export async function ensurePixiApp(container: HTMLDivElement, width: number, height: number): Promise<void> {
  if (pixiApp === null) {
    pixiApp = new Application();
    await pixiApp.init({
      width,
      height,
      backgroundColor: 0x000000,
      antialias: false,
      preference: 'webgl',
    });
    container.appendChild(pixiApp.canvas);
  } else {
    pixiApp.renderer.resize(width, height);
    pixiApp.stage.removeChildren();
  }
}

/** Paints all tile types onto a single Graphics object and adds it to the PixiJS stage. */
export function paintGrid(grid: number[][], options: PaintOptions): void {
  const graphics = new Graphics();

  // Wall cells
  if (options.wallDepth && options.wallDepthColors) {
    for (const [dist, color] of options.wallDepthColors) {
      for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[y].length; x++) {
          if (grid[y][x] === 1 && options.wallDepth[y][x] === dist) {
            graphics.rect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
          }
        }
      }
      graphics.fill(color);
    }
  } else if (options.wallFlatColor !== undefined) {
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x] === 1) {
          graphics.rect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      }
    }
    graphics.fill(options.wallFlatColor);
  }

  // Floor cells
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x] === 0) {
        graphics.rect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    }
  }
  graphics.fill(options.floorColor);

  // Entrance — green
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x] === 2) {
        graphics.rect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    }
  }
  graphics.fill(0x00ff00);

  // Exit — red
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x] === 3) {
        graphics.rect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    }
  }
  graphics.fill(0xff0000);

  pixiApp!.stage.addChild(graphics);
}
