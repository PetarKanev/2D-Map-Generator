# 2D Map Generator

A procedural 2D map generator built for experimentation and learning. Generates dungeon and cave-style maps with configurable parameters, rendered in the browser using PixiJS.

## What it does (WIP)

- Generates **dungeon maps** with rooms connected by corridors, using BSP-style room placement and a nearest-neighbour + MST corridor system to guarantee full connectivity between entrance and exit
- Generates **cave maps** using cellular automata, with smooth walls and configurable floor coverage
- Renders maps via **PixiJS** with a Web Worker offloading generation off the main thread
- Supports configurable options: map size, seed, diagonal preference, entrance/exit placement