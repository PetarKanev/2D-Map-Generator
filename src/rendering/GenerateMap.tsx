import type { CaveMetadata } from '../generators/CaveGenerator';
import type { DungeonMetadata } from '../generators/DungeonGenerator';
import { CELL_SIZE, computeWallDepth, ensurePixiApp, paintGrid } from './PixiRenderer';
// Vite bundles each worker as a separate chunk via the ?worker suffix
import CaveWorker from '../workers/caveWorker.ts?worker';
import DungeonWorker from '../workers/dungeonWorker.ts?worker';

export type MapMetadata = CaveMetadata | DungeonMetadata;
export type { CaveMetadata };

let isGenerating = false;

// Single persistent worker instances — created once, reused across generations
let caveWorker: Worker | null = null;
let dungeonWorker: Worker | null = null;

function getCaveWorker(): Worker {
  if (caveWorker === null) { caveWorker = new CaveWorker(); }
  return caveWorker;
}

function getDungeonWorker(): Worker {
  if (dungeonWorker === null) { dungeonWorker = new DungeonWorker(); }
  return dungeonWorker;
}

// Wrap each worker's postMessage/onmessage in a Promise so callers can await it.
// One-shot listeners are replaced on each call so concurrent calls don't cross.
function runCaveWorker(
  seed: number, width: number, height: number, preferDiagonal: boolean
): Promise<{ grid: number[][], metadata: CaveMetadata }> {
  return new Promise((resolve, reject) => {
    const worker = getCaveWorker();
    worker.onmessage = (e) => resolve(e.data);
    worker.onerror = (e) => reject(e);
    worker.postMessage({ seed, width, height, preferDiagonal });
  });
}

function runDungeonWorker(
  seed: number, width: number, height: number, preferDiagonal: boolean
): Promise<{ grid: number[][], metadata: DungeonMetadata }> {
  return new Promise((resolve, reject) => {
    const worker = getDungeonWorker();
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
): Promise<MapMetadata | null> {
  if (container === null) { return null; }

  switch (mapType) {
    case 'Cave':    return await generateCave(seed, container, preferDiagonal);
    case 'Dungeon': return await generateDungeon(seed, container, preferDiagonal);
    default:        return null;
  }
}

async function generateCave(seed: number, container: HTMLDivElement, preferDiagonal: boolean): Promise<CaveMetadata | null> {
  if (isGenerating) { return null; }
  isGenerating = true;
  let result: CaveMetadata | null = null;

  try {
    const gridWidth = Math.max(10, Math.floor(container.clientWidth / CELL_SIZE));
    const gridHeight = Math.max(10, Math.floor(container.clientHeight / CELL_SIZE));
    const { grid, metadata } = await runCaveWorker(seed, gridWidth, gridHeight, preferDiagonal);
    result = metadata;

    await ensurePixiApp(container, gridWidth * CELL_SIZE, gridHeight * CELL_SIZE);
    paintGrid(grid, {
      floorColor: 0x5C4033,
      wallDepth: computeWallDepth(grid),
      wallDepthColors: [
        [1, 0x222222],
        [2, 0x222222],
        [3, 0x222222],
      ],
    });
  } finally {
    isGenerating = false;
  }

  return result;
}

async function generateDungeon(seed: number, container: HTMLDivElement, preferDiagonal: boolean): Promise<DungeonMetadata | null> {
  if (isGenerating) { return null; }
  isGenerating = true;
  let result: DungeonMetadata | null = null;

  try {
    const gridWidth = Math.max(10, Math.floor(container.clientWidth / CELL_SIZE));
    const gridHeight = Math.max(10, Math.floor(container.clientHeight / CELL_SIZE));
    const { grid, metadata } = await runDungeonWorker(seed, gridWidth, gridHeight, preferDiagonal);
    result = metadata;

    await ensurePixiApp(container, gridWidth * CELL_SIZE, gridHeight * CELL_SIZE);
    paintGrid(grid, {
      floorColor: 0xC2C3C7,
      wallFlatColor: 0x5F574F,
    });
  } finally {
    isGenerating = false;
  }

  return result;
}
