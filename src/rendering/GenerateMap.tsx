import { Application, Graphics } from 'pixi.js';
import type { CaveMetadata } from '../generators/CaveGenerator';
import { generateDungeonGrid } from '../generators/DungeonGenerator';
// Vite bundles the worker as a separate chunk via the ?worker suffix
import CaveWorker from '../workers/caveWorker.ts?worker';

export type { CaveMetadata };

const CELL_SIZE = 5;
let pixiApp: Application | null = null;
let isGenerating = false;

// Single persistent worker instance — created once, reused across generations
let caveWorker: Worker | null = null;

function getCaveWorker(): Worker {
  if (caveWorker === null) {
    caveWorker = new CaveWorker();
  }
  return caveWorker;
}

// Wraps the worker postMessage/onmessage pair in a Promise so callers can await it
function runCaveWorker(
  seed: number,
  width: number,
  height: number,
  preferDiagonal: boolean
): Promise<{ grid: number[][], metadata: CaveMetadata }> {
  return new Promise((resolve, reject) => {
    const worker = getCaveWorker();
    // One-shot listeners: replaced on each call so concurrent calls don't cross
    worker.onmessage = (e) => resolve(e.data);
    worker.onerror = (e) => reject(e);
    worker.postMessage({ seed, width, height, preferDiagonal });
  });
}

export async function GenerateMap(
  seed: number,
  mapType: string | null,
  container: HTMLDivElement | null,
  preferDiagonal: boolean = true
): Promise<CaveMetadata | null> {
  if (container === null) {
    return null;
  }

  switch (mapType) {
    case 'Cave':
      return await generateCave(seed, container, preferDiagonal);
    case 'Dungeon':
      await generateDungeon(seed, container);
      return null;
    default:
      return null;
  }
}

function computeWallDepth(grid: number[][]): number[][] {
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

async function generateCave(seed: number, container: HTMLDivElement, preferDiagonal: boolean): Promise<CaveMetadata | null> {
  if (isGenerating) {
    return null;
  }

  isGenerating = true;
  let result: CaveMetadata | null = null;

  // Load animation test (ignore this):
  //await new Promise(resolve => setTimeout(resolve, 3000));

  try {
    const gridWidth = Math.max(10, Math.floor(container.clientWidth / CELL_SIZE));
    const gridHeight = Math.max(10, Math.floor(container.clientHeight / CELL_SIZE));
    const { grid, metadata } = await runCaveWorker(seed, gridWidth, gridHeight, preferDiagonal);
    result = metadata;

    const wallDepth = computeWallDepth(grid);

    if (pixiApp === null) {
      pixiApp = new Application();
      await pixiApp.init({
        width: gridWidth * CELL_SIZE,
        height: gridHeight * CELL_SIZE,
        backgroundColor: 0x000000,
        antialias: false,
        preference: 'webgl',
      });
      container.appendChild(pixiApp.canvas);
    } else {
      pixiApp.renderer.resize(gridWidth * CELL_SIZE, gridHeight * CELL_SIZE);
      pixiApp.stage.removeChildren();
    }

    const graphics = new Graphics();

    // Wall cells — depth-shaded gray (>2 deep remain black via background)
    const wallColors: [number, number][] = [
      [1, 0x222222], // 0 deep — medium gray
      [2, 0x222222], // 1 deep — medium gray
      [3, 0x222222], // 2 deep — dark gray
      //[4, 0x222222], // 3 deep — dark gray
    ];
    for (const [dist, color] of wallColors) {
      for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[y].length; x++) {
          if (grid[y][x] === 1 && wallDepth[y][x] === dist) {
            graphics.rect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
          }
        }
      }
      graphics.fill(color);
    }

    // Floor cells
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x] === 0) {
          graphics.rect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      }
    }

    // Floor color
    graphics.fill(0x5C4033);

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

    pixiApp.stage.addChild(graphics);
  } finally {
    isGenerating = false;
  }

  return result;
}

async function generateDungeon(seed: number, container: HTMLDivElement): Promise<void> {
  if (isGenerating) {
    return;
  }

  isGenerating = true;

  try {
    if (pixiApp !== null) {
      pixiApp.destroy(true, { children: true });
      pixiApp = null;
    }

    const grid = generateDungeonGrid(seed);

    pixiApp = new Application();
    await pixiApp.init({
      width: 500,
      height: 500,
      backgroundColor: 0x000000,
      antialias: false,
      preference: 'webgl',
    });

    container.appendChild(pixiApp.canvas);

    const graphics = new Graphics();

    // Floor cells
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x] === 0) {
          graphics.rect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      }
    }

    // Floor color
    graphics.fill(0x5C4033);

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

    pixiApp.stage.addChild(graphics);
  } finally {
    isGenerating = false;
  }
}