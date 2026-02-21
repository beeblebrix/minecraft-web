/// <reference lib="webworker" />

import {
  BlockId,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  type GenerateChunkRequest,
  type GenerateChunkResponse,
} from './chunk'
import { getHeightAt, getTopBlockAt } from './terrainMath'

function toIndex(x: number, y: number, z: number): number {
  return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE
}

function generateChunkBlocks(chunkX: number, chunkZ: number): Uint8Array {
  const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE)

  for (let z = 0; z < CHUNK_SIZE; z += 1) {
    for (let x = 0; x < CHUNK_SIZE; x += 1) {
      const worldX = chunkX * CHUNK_SIZE + x
      const worldZ = chunkZ * CHUNK_SIZE + z
      const height = Math.min(CHUNK_HEIGHT - 1, getHeightAt(worldX, worldZ))
      const topBlock = getTopBlockAt(worldX, worldZ, height)

      for (let y = 0; y <= height; y += 1) {
        const index = toIndex(x, y, z)

        if (y === height) {
          blocks[index] = topBlock
        } else if (y >= height - 3) {
          blocks[index] = BlockId.Dirt
        } else {
          blocks[index] = BlockId.Stone
        }
      }
    }
  }

  return blocks
}

self.onmessage = (event: MessageEvent<GenerateChunkRequest>) => {
  if (event.data.type !== 'generate') {
    return
  }

  const { chunkX, chunkZ } = event.data
  const blocks = generateChunkBlocks(chunkX, chunkZ)

  const message: GenerateChunkResponse = {
    type: 'generated',
    chunkX,
    chunkZ,
    blocks: blocks.buffer as ArrayBuffer,
  }

  self.postMessage(message, [blocks.buffer])
}

export {}
