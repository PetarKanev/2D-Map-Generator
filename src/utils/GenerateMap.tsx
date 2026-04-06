import { Application, Graphics } from 'pixi.js';
import { generateCaveGrid } from './CaveGenerator';
import type { CaveMetadata } from './CaveGenerator';
import { generateDungeonGrid } from './DungeonGenerator';

export type { CaveMetadata };

const CELL_SIZE = 5;
let pixiApp: Application | null = null;
let isGenerating = false;

export async function GenerateMap(
  seed: number,
  mapType: string | null,
  container: HTMLDivElement | null
): Promise<CaveMetadata | null> {
  if (container === null) {
    return null;
  }

  switch (mapType) {
    case 'Cave':
      return await generateCave(seed, container);
    case 'Dungeon':
      await generateDungeon(seed, container);
      return null;
    default:
      return null;
  }
}

async function generateCave(seed: number, container: HTMLDivElement): Promise<CaveMetadata | null> {
  if (isGenerating) {
    return null;
  }

  isGenerating = true;
  let result: CaveMetadata | null = null;

  try {
    if (pixiApp !== null) {
      pixiApp.destroy(true, { children: true });
      pixiApp = null;
    }

    const gridWidth = Math.max(10, Math.floor(container.clientWidth / CELL_SIZE));
    const gridHeight = Math.max(10, Math.floor(container.clientHeight / CELL_SIZE));
    const { grid, metadata } = generateCaveGrid(seed, gridWidth, gridHeight);
    result = metadata;

    pixiApp = new Application();
    await pixiApp.init({
      width: gridWidth * CELL_SIZE,
      height: gridHeight * CELL_SIZE,
      backgroundColor: 0x000000,
      antialias: false,
      preference: 'webgl',
    });

    container.appendChild(pixiApp.canvas);

    const graphics = new Graphics();

    // Floor cells — white
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x] === 0) {
          graphics.rect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      }
    }
    graphics.fill(0xffffff);

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
  console.log(`Generating Dungeon with seed: ${seed}`);
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

    // Floor cells — white
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x] === 0) {
          graphics.rect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      }
    }
    graphics.fill(0xffffff);

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