import { useState, useRef } from 'react'
import { pseudoRandom } from './utils/PseudoRandom'
import { GenerateMap } from './utils/GenerateMap'
import type { CaveMetadata } from './utils/GenerateMap'
import { SimpleSelect } from './utils/RenderFunctions'
import './App.css'

const mapTypes = ['Cave', 'Dungeon'];

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${ms}ms (${minutes}m ${seconds}s)`;
}

function App() {
  const [mapID, setMapID] = useState(0)
  const [seed, setSeed] = useState<number | null>(null)
  const [pixiContainer, setPixiContainer] = useState<HTMLDivElement | null>(null)
  const [selectedMapType, setSelectedMapType] = useState<string | null>(mapTypes[0])
  const [metadata, setMetadata] = useState<CaveMetadata | null>(null)
  const lastUsedSeed = useRef<number | null>(null)

  function handleSeedChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (/^\d*$/.test(e.target.value)) {
      setSeed(e.target.value ? Number(e.target.value) : null);
    }
  }

  async function handleGenerate() {
    const seedForGenerate = seed === lastUsedSeed.current ? null : seed;
    const [newMapID, mapSeed] = pseudoRandom(seedForGenerate);
    setMapID(newMapID);
    setSeed(mapSeed);
    const result = await GenerateMap(mapSeed, selectedMapType, pixiContainer);
    setMetadata(result);
    lastUsedSeed.current = mapSeed;
  }

  return (
    <div id="app-container">
      <div id="left-panel">
        <div>Map ID: {mapID}</div>
        <div id="seed-row">
          <label>Seed:</label>
          <input type="text" value={seed ?? ''} onChange={handleSeedChange} />
        </div>
        <div>
          Map Type: <SimpleSelect options={mapTypes} value={selectedMapType} onChange={setSelectedMapType} />
        </div>
        <button onClick={handleGenerate}>Generate</button>
        {metadata && (
          <div id="metadata">
            <div>Rooms: {metadata.roomCount}</div>
            <div>Floor: {metadata.floorPercent}%</div>
            <div>Time: {formatTime(metadata.generationTimeMs)}</div>
            <div>Smoothing passes: {metadata.rogueIterations}</div>
          </div>
        )}
      </div>
      <div id="right-panel">
        <div ref={setPixiContainer} id="pixi-container" />
      </div>
    </div>
  )
}

export default App