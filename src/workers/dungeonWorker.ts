import { generateDungeonGrid } from '../generators/DungeonGenerator';
import type { DungeonMetadata } from '../generators/DungeonGenerator';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Message shape sent from the main thread to this worker. */
interface WorkerRequest {
  seed: number;
  width: number;
  height: number;
  preferDiagonal: boolean;
}

/** Message shape this worker sends back to the main thread. */
interface WorkerResponse {
  grid: number[][];
  metadata: DungeonMetadata;
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

/** Receives a generation request, runs the dungeon generator, and posts the result.
 *  All data is structured-cloneable (number[][] and plain object), so no serialization is needed. */
self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { seed, width, height, preferDiagonal } = e.data;
  const result = generateDungeonGrid(seed, width, height, preferDiagonal);
  self.postMessage(result satisfies WorkerResponse);
};
