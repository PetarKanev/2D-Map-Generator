import { useState, useRef } from 'react'
import { PseudoRandom } from './utils/PseudoRandom'
import { GenerateMap } from './utils/GenerateMap'
import './App.css'

const mapTypes = ['Cave', 'Dungeon'];

function App() {
  const [mapID, setMapID] = useState(0)
  const [seed, setSeed] = useState<number | null>(null)
  const [pixiContainer, setPixiContainer] = useState<HTMLDivElement | null>(null)
  const [selectedMapType, setSelectedMapType] = useState<string | null>(mapTypes[0]);

  // Track the last seed used for generation
  const lastUsedSeed = useRef<number | null>(null)

  function handleSeedChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Only allow numeric input
    if (/^\d*$/.test(e.target.value)) {
      setSeed(e.target.value ? Number(e.target.value) : null);
    }
  }

  // Set Map ID and seed after generating a new random value
  async function handleGenerateRandom([mapID, mapSeed]: [number, number]) {
    setMapID(mapID);
    setSeed(mapSeed);

    // Map generator
    await GenerateMap(mapSeed, selectedMapType, pixiContainer);
    lastUsedSeed.current = mapSeed;
  }

  // Keep track of the last used seed to prevent generating the same map when the user clicks "Generate" multiple times without 
  // changing the seed. If the current seed is the same as the last used seed, return null to trigger generation of a new random seed.
  function getSeedForGenerate(): number | null {
    return seed === lastUsedSeed.current ? null : seed;
  }

  function getSelect(options: string[], value: string | null, onChange: (value: string | null) => void) {
    return (
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {options.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
    );
  }

  return (
    <>
      {/*<div>
        <div>Map ID: {mapID}</div>

        <div>
          Seed: <input type="text" value={seed ?? ''} onChange={handleSeedChange} />
          <button onClick={() => handleGenerateRandom(PseudoRandom(getSeedForGenerate()))}>
            Generate
          </button>
        </div>
        <div>
          Map Type: {getSelect(mapTypes, selectedMapType, setSelectedMapType)}
        </div>
        <div ref={setPixiContainer} id="pixi-container" />

      </div>*/}
      Site Under Construction. Please come back later.
    </>
  )
}

export default App