import { Application, Graphics } from 'pixi.js';
import { generateCaveGrid } from './CaveGenerator';

const CELL_SIZE = 5;
let pixiApp: Application | null = null;
let isGenerating = false;

export async function GenerateMap(
  seed: number,
  mapType: string | null,
  container: HTMLDivElement | null
): Promise<void> {
  if (container === null) {
    return;
  }

  switch (mapType) {
    case 'Cave':
      await generateCave(seed, container);
      break;
    case 'Dungeon':
      generateDungeon(seed, container);
      break;
    default:
      return;
  }
}

async function generateCave(seed: number, container: HTMLDivElement): Promise<void> {
  if (isGenerating) {
    return;
  }
  isGenerating = true;

  try {
    if (pixiApp !== null) {
      pixiApp.destroy(true, { children: true });
      pixiApp = null;
    }

    const grid = generateCaveGrid(seed);

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
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x] === 0) {
          graphics.rect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      }
    }
    graphics.fill(0xffffff);

    pixiApp.stage.addChild(graphics);
  } finally {
    isGenerating = false;
  }
}

function generateDungeon(seed: number, _container: HTMLDivElement): void {
  console.log(`Generating Dungeon with seed: ${seed}`);
}
