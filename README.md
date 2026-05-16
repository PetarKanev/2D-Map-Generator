# 2D Map Generator

A procedural 2D map generator built for experimentation and learning. Generates dungeon and cave-style maps with configurable parameters, rendered in the browser using PixiJS.

## Features

- Generates 2D **dungeon maps** with rooms connected by corridors, using BSP-style room placement and a nearest-neighbour + MST corridor system to guarantee full connectivity between entrance and exit
- Generates 2D **cave maps** using cellular automata with configurable floor coverage and smooth walls
- **Four map sizes** — Small, Medium, Large, Very Large — scaling tile size while keeping a fixed 1920×1080 output resolution
- **Tilemap rendering mode** — renders floor tiles with inset borders for a top-down RPG look
- **Seed-based generation** — enter any numeric seed to reproduce a specific map exactly
- **Diagonal entrances** toggle for cave and dungeon connectivity style
- **HD preview modal** — click the canvas to open a full-screen view with mouse-wheel zoom, click-drag pan, and pinch-to-zoom on touch devices
- **Generation metadata** — displays room count, corridor count, floor coverage percentage, smoothing passes, and generation time
- Rendered in the browser using **PixiJS**, with Web Workers keeping generation off the main thread

## Running locally

```bash
npm install
npm run dev
```

## License

Copyright (C) 2026 Petar V. Kanev

2D Map Generator is open source software, licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. You are free to use, modify, and distribute this software, but any distributed or network-accessible version — including modifications — must also be released under the same license with full source code available.

See the [LICENSE](LICENSE) file for the full terms and conditions.
