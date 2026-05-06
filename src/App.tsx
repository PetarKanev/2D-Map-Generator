import { useState, useRef } from 'react'
import { pseudoRandom } from './utils/PseudoRandom'
import { GenerateMap } from './rendering/GenerateMap'
import { getCanvasDataURL } from './rendering/PixiRenderer'
import { SimpleSelect } from './components/SimpleSelect'
import { HdModal } from './components/HdModal'
import { version, repository } from '../package.json'

import type { MapMetadata } from './rendering/GenerateMap'

import './App.css'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const mapTypes = [ // available generator options shown in the map-type dropdown
  { label: 'Cave', value: 'Cave', disabled: false },
  { label: 'Dungeon', value: 'Dungeon', disabled: false }
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Formats a millisecond duration for display in the metadata panel. */
function formatTime(ms: number): string {
  return `${ms}ms`;
}

// ---------------------------------------------------------------------------
// App 
// ---------------------------------------------------------------------------

function App() {
  // State
  const [mapID, setMapID] = useState(0)
  const [seed, setSeed] = useState<number | null>(null)
  const [pixiContainer, setPixiContainer] = useState<HTMLDivElement | null>(null)
  const [selectedMapType, setSelectedMapType] = useState<string | null>(mapTypes[0].value)
  const [metadata, setMetadata] = useState<MapMetadata | null>(null)
  const [preferDiagonal, setPreferDiagonal] = useState<boolean>(true)
  const [useTilemap, setUseTilemap] = useState<boolean>(false)
  const [hdPreviewSrc, setHdPreviewSrc] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Refs 
  // Track the last-used config so re-generating with identical settings still produces a new map by passing null (random) to pseudoRandom.
  const lastUsedSeed = useRef<number | null>(null)
  const lastUsedPreferDiagonal = useRef<boolean>(true)
  const lastUsedUseTilemap = useRef<boolean>(false)

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  
  /** Restricts the seed input to digits only. */
  function handleSeedChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (/^\d*$/.test(e.target.value)) {
      setSeed(e.target.value ? Number(e.target.value) : null);
    }
  }

  /**
   * Kicks off map generation. Yields to the event loop first so the loading
   * overlay can render before the heavy generation work begins.
   */
  async function handleGenerate() {
    const configUnchanged = seed === lastUsedSeed.current && preferDiagonal === lastUsedPreferDiagonal.current && useTilemap === lastUsedUseTilemap.current;
    const [newMapID, mapSeed] = pseudoRandom(configUnchanged ? null : seed);

    setMapID(newMapID);
    setSeed(mapSeed);
    setIsLoading(true);

    await new Promise(resolve => setTimeout(resolve, 0));
    setMetadata(await GenerateMap(mapSeed, selectedMapType, pixiContainer, preferDiagonal, useTilemap));
    setIsLoading(false);

    lastUsedSeed.current = mapSeed;
    lastUsedPreferDiagonal.current = preferDiagonal;
    lastUsedUseTilemap.current = useTilemap;
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
        <div>
          Tilemap: <input type="checkbox" checked={useTilemap} onChange={(e) => setUseTilemap(e.target.checked)} />
        </div>
        <button onClick={handleGenerate}>Generate</button>
        {metadata && (
          <div id="metadata">
            <div id="metadata-title">Metadata</div>
            <div>Rooms: {metadata.roomCount}</div>
            {'corridors' in metadata && metadata.corridors && <div>Corridors: {metadata.corridors.length}</div>}
            <div>Floor: {metadata.floorPercent}%</div>
            <div>Runtime: {formatTime(metadata.generationTimeMs)}</div>
            {'rogueIterations' in metadata && <div>Smoothing passes: {metadata.rogueIterations}</div>}
            <div>Diagonal Entrances: {metadata.preferDiagonal ? 'Yes' : 'No'}</div>
          </div>
        )}
      </div>
      <div id="right-panel">
        {isLoading && <div id="loading-overlay">Generating</div>}
        <div
          ref={setPixiContainer}
          id="pixi-container"
          onClick={() => { const src = getCanvasDataURL(); if (src) { setHdPreviewSrc(src); } }}
          style={{ cursor: metadata ? 'zoom-in' : 'default' }}
        />
      </div>
      {hdPreviewSrc && <HdModal src={hdPreviewSrc} onClose={() => setHdPreviewSrc(null)} />}
    </div>
  )
}

export default App
