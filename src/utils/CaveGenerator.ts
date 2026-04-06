import { PseudoRandom } from './PseudoRandom';

const GRID_WIDTH = 100;
const GRID_HEIGHT = 100;
const FILL_RATIO = 0.45;
const WALL_THRESHOLD = 5;
const ITERATIONS = 5;

export function generateCaveGrid(seed: number): number[][] {
  let grid = initGrid(seed);
  for (let i = 0; i < ITERATIONS; i++) {
    grid = stepAutomata(grid);
  }
  return grid;
}

function initGrid(seed: number): number[][] {
  const grid: number[][] = [];
  let currentSeed = seed;

  for (let y = 0; y < GRID_HEIGHT; y++) {
    grid[y] = [];
    for (let x = 0; x < GRID_WIDTH; x++) {
      if (x === 0 || x === GRID_WIDTH - 1 || y === 0 || y === GRID_HEIGHT - 1) {
        grid[y][x] = 1;
      } else {
        const [value] = PseudoRandom(currentSeed);
        grid[y][x] = (value / 0xFFFFFFFF) < FILL_RATIO ? 1 : 0;
        currentSeed = value;
      }
    }
  }

  return grid;
}

function countWallNeighbors(grid: number[][], x: number, y: number): number {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= GRID_WIDTH || ny < 0 || ny >= GRID_HEIGHT) {
        count++;
      } else {
        count += grid[ny][nx];
      }
    }
  }
  return count;
}

function stepAutomata(grid: number[][]): number[][] {
  const next: number[][] = [];

  for (let y = 0; y < GRID_HEIGHT; y++) {
    next[y] = [];
    for (let x = 0; x < GRID_WIDTH; x++) {
      if (x === 0 || x === GRID_WIDTH - 1 || y === 0 || y === GRID_HEIGHT - 1) {
        next[y][x] = 1;
      } else {
        next[y][x] = countWallNeighbors(grid, x, y) >= WALL_THRESHOLD ? 1 : 0;
      }
    }
  }

  return next;
}
