import { useState, useRef } from 'react'
import { pseudoRandom } from './utils/PseudoRandom'
import { GenerateMap } from './rendering/GenerateMap'
import { SimpleSelect } from './components/SimpleSelect'
import { version, repository } from '../package.json'

import type { MapMetadata } from './rendering/GenerateMap'

import './App.css'

const mapTypes = [
  {label:'Cave', value: 'Cave', disabled: false}, 
  {label:'Dungeon -- WIP', value: 'Dungeon', disabled: true}
];

function formatTime(ms: number): string {
  return `${ms}ms`;
}

function App() {
  const [mapID, setMapID] = useState(0)
  const [seed, setSeed] = useState<number | null>(null)
  const [pixiContainer, setPixiContainer] = useState<HTMLDivElement | null>(null)
  const [selectedMapType, setSelectedMapType] = useState<string | null>(mapTypes[0].value)
  const [metadata, setMetadata] = useState<MapMetadata | null>(null)
  const [preferDiagonal, setPreferDiagonal] = useState<boolean>(true)
  const [isLoading, setIsLoading] = useState(false)
  
  const lastUsedSeed = useRef<number | null>(null)
  const lastUsedPreferDiagonal = useRef<boolean>(true)

  function handleSeedChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (/^\d*$/.test(e.target.value)) {
      setSeed(e.target.value ? Number(e.target.value) : null);
    }
  }

  async function handleGenerate() {
    const configUnchanged = seed === lastUsedSeed.current && preferDiagonal === lastUsedPreferDiagonal.current;
    const [newMapID, mapSeed] = pseudoRandom(configUnchanged ? null : seed);
    
    setMapID(newMapID);
    setSeed(mapSeed);
    setIsLoading(true);

    // Yield to allow loading overlay to render before 
    // heavy generation starts, 0ms overhead should not 
    // affect performance but ensures UI responsiveness.
    await new Promise(resolve => setTimeout(resolve, 0)); 
    setMetadata(await GenerateMap(mapSeed, selectedMapType, pixiContainer, preferDiagonal));
    setIsLoading(false);

    lastUsedSeed.current = mapSeed;
    lastUsedPreferDiagonal.current = preferDiagonal;
  }

  return (
    <div id="app-container">
      <div id="left-panel">
        <div id='app-version'>
          v{version} — <a href={repository.url} target="_blank" rel="noreferrer">GitHub</a>
        </div>
        <div>Map ID: {mapID}</div>
        <div id="seed-row">
          <label>Seed:</label>
          <input type="text" value={seed ?? ''} onChange={handleSeedChange} />
        </div>
        <div>
        Map Type: <SimpleSelect options={mapTypes} value={selectedMapType} onChange={setSelectedMapType} />
        </div>
        <div>
        Diagonal Entrances: <input type="checkbox" checked={preferDiagonal ?? true} onChange={(e) => setPreferDiagonal(e.target.checked)} />
        </div>
        <button onClick={handleGenerate}>Generate</button>
        {metadata && (
          <div id="metadata"> 
            <div id="metadata-title">Metadata</div>
            <div>Rooms: {metadata.roomCount}</div>
            <div>Floor: {metadata.floorPercent}%</div>
            <div>Runtime: {formatTime(metadata.generationTimeMs)}</div>
            {'rogueIterations' in metadata && <div>Smoothing passes: {metadata.rogueIterations}</div>}
            <div>Diagonal Entrances: {metadata.preferDiagonal ? 'Yes' : 'No'}</div>
          </div>
        )}
      </div>
      <div id="right-panel">
        {isLoading && <div id="loading-overlay">Generating</div>}
        <div ref={setPixiContainer} id="pixi-container" />
      </div>
    </div>
  )
}

export default App