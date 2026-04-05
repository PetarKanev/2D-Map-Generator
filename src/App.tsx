import { useState, useRef } from 'react'
import { PseudoRandom } from './utils/PseudoRandom'
import './App.css'

function App() {
  const [mapID, setMapID] = useState(0)
  const [seed, setSeed] = useState<number | null>(null)

  // Track the last seed used for generation
  const lastUsedSeed = useRef<number | null>(undefined)

  function handleSeedChange(e: React.ChangeEvent<HTMLInputElement>) {

    // Only allow numeric input
    if (/^\d*$/.test(e.target.value)) {
      setSeed(e.target.value ? Number(e.target.value) : null);
    }
  }

  // Set Map ID and seed after generating a new random value
  function handleGenerateRandom([randomValue, newSeed]: [number, number]) {
    setMapID(randomValue);
    setSeed(newSeed);
    lastUsedSeed.current = newSeed;
  }

  // Keep track of the last used seed to prevent generating the same map when the user clicks "Generate" multiple times without 
  // changing the seed. If the current seed is the same as the last used seed, return null to trigger generation of a new random seed.
  function getSeedForGenerate(): number | null {
    return seed === lastUsedSeed.current ? null : seed;
  }

  return (
    <> 
      <div>
        <div>Map ID: {mapID}</div>

        <div>
          Seed: <input type="text" value={seed ?? ''} onChange={handleSeedChange} />
          <button onClick={() => handleGenerateRandom(PseudoRandom(getSeedForGenerate()))}>
            Generate
          </button>
        </div>

      </div>
    </>
  )
}

export default App