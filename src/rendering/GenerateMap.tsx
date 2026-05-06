import type { CaveMetadata } from '../generators/CaveGenerator';
import type { DungeonMetadata } from '../generators/DungeonGenerator';
import { blockSize, ensurePixiApp, generateTilemap, OUTPUT_HEIGHT, OUTPUT_WIDTH, paintGrid, paintTilemap } from './PixiRenderer';
// Vite bundles each worker as a separate chunk via the ?worker suffix
import CaveWorker from '../workers/caveWorker.ts?worker';
import DungeonWorker from '../workers/dungeonWorker.ts?worker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MapMetadata = CaveMetadata | DungeonMetadata;
export type { CaveMetadata, DungeonMetadata };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let isGenerating = false; // guard against concurrent generation calls

// Single persistent worker instances — created once, reused across generations
let caveWorker: Worker | null = null;
let dungeonWorker: Worker | null = null;

// ---------------------------------------------------------------------------
// Worker access
// ---------------------------------------------------------------------------

/** Returns the shared CaveWorker, creating it on first access. */
function getCaveWorker(): Worker {
  if (caveWorker === null) { caveWorker = new CaveWorker(); }
  return caveWorker;
}

/** Returns the shared DungeonWorker, creating it on first access. */
function getDungeonWorker(): Worker {
  if (dungeonWorker === null) { dungeonWorker = new DungeonWorker(); }
  return dungeonWorker;
}

// ---------------------------------------------------------------------------
// Worker runners
// ---------------------------------------------------------------------------

/**
 * Wraps the cave worker's postMessage/onmessage in a Promise.
 * The listener is replaced on each call so concurrent calls don't cross-resolve.
 */
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

/**
 * Wraps the dungeon worker's postMessage/onmessage in a Promise.
 * The listener is replaced on each call so concurrent calls don't cross-resolve.
 */
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

// ---------------------------------------------------------------------------
// Map generators
// ---------------------------------------------------------------------------

/** Generates a cave map, renders it, and returns its metadata. */
async function generateCave(seed: number, container: HTMLDivElement, preferDiagonal: boolean, useTilemap: boolean): Promise<CaveMetadata | null> {
  if (isGenerating) { return null; }
  isGenerating = true;
  let result: CaveMetadata | null = null;

  try {
    const gridWidth  = Math.floor(OUTPUT_WIDTH  / blockSize);
    const gridHeight = Math.floor(OUTPUT_HEIGHT / blockSize);
    const { grid, metadata } = await runCaveWorker(seed, gridWidth, gridHeight, preferDiagonal);
    result = metadata;

    await ensurePixiApp(container, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    if (useTilemap) {
      paintTilemap(generateTilemap(grid), grid, { floorColor: 0xC2C3C7, wallColor: 0x1a1a1a });
    } else {
      paintGrid(grid, { floorColor: 0x5C4033, wallFlatColor: 0x1a1a1a });
    }
  } finally {
    isGenerating = false;
  }

  return result;
}

/** Generates a dungeon map, renders it, and returns its metadata. */
async function generateDungeon(seed: number, container: HTMLDivElement, preferDiagonal: boolean, useTilemap: boolean): Promise<DungeonMetadata | null> {
  if (isGenerating) { return null; }
  isGenerating = true;
  let result: DungeonMetadata | null = null;

  try {
    const gridWidth  = Math.floor(OUTPUT_WIDTH  / blockSize);
    const gridHeight = Math.floor(OUTPUT_HEIGHT / blockSize);
    const { grid, metadata } = await runDungeonWorker(seed, gridWidth, gridHeight, preferDiagonal);
    result = metadata;

    await ensurePixiApp(container, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    if (useTilemap) {
      paintTilemap(generateTilemap(grid), grid, { floorColor: 0xC2C3C7, wallColor: 0x1a1a1a });
    } else {
      paintGrid(grid, { floorColor: 0xC2C3C7, wallFlatColor: 0x1a1a1a });
    }
  } finally {
    isGenerating = false;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Dispatches to the appropriate generator based on mapType and returns its metadata. */
export async function GenerateMap(
  seed: number,
  mapType: string | null,
  container: HTMLDivElement | null,
  preferDiagonal: boolean = true,
  useTilemap: boolean = false
): Promise<MapMetadata | null> {
  if (container === null) { return null; }

  switch (mapType) {
    case 'Cave':    return await generateCave(seed, container, preferDiagonal, useTilemap);
    case 'Dungeon': return await generateDungeon(seed, container, preferDiagonal, useTilemap);
    default:        return null;
  }
}
