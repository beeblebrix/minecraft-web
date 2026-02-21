/// <reference lib="webworker" />

import {
  BlockId,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  SEA_LEVEL,
  type GenerateChunkRequest,
  type GenerateChunkResponse,
} from './chunk'
import { getHeightAt, getTopBlockAt } from './terrainMath'

function toIndex(x: number, y: number, z: number): number {
  return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE
}

function hash2(worldX: number, worldZ: number, salt: number): number {
  let value = worldX * 374761393 + worldZ * 668265263 + salt * 362437
  value = (value ^ (value >>> 13)) * 1274126177
  value ^= value >>> 16
  return (value >>> 0) / 4294967295
}

function setIfAir(blocks: Uint8Array, x: number, y: number, z: number, block: BlockId): void {
  if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT) {
    return
  }

  const index = toIndex(x, y, z)
  if (blocks[index] === BlockId.Air) {
    blocks[index] = block
  }
}

function addTrees(blocks: Uint8Array, chunkX: number, chunkZ: number): void {
  for (let z = 2; z < CHUNK_SIZE - 2; z += 1) {
    for (let x = 2; x < CHUNK_SIZE - 2; x += 1) {
      const worldX = chunkX * CHUNK_SIZE + x
      const worldZ = chunkZ * CHUNK_SIZE + z

      const seed = hash2(worldX, worldZ, 17)
      if (seed > 0.038) {
        continue
      }

      const groundY = Math.min(CHUNK_HEIGHT - 1, getHeightAt(worldX, worldZ))
      if (groundY < 3 || groundY > CHUNK_HEIGHT - 8 || groundY <= SEA_LEVEL) {
        continue
      }

      const topBlock = blocks[toIndex(x, groundY, z)]
      if (topBlock !== BlockId.Dirt) {
        continue
      }

      const trunkHeight = 3 + Math.floor(hash2(worldX, worldZ, 41) * 3)

      for (let y = 1; y <= trunkHeight; y += 1) {
        setIfAir(blocks, x, groundY + y, z, BlockId.Wood)
      }

      const canopyY = groundY + trunkHeight
      for (let oy = -2; oy <= 2; oy += 1) {
        for (let oz = -2; oz <= 2; oz += 1) {
          for (let ox = -2; ox <= 2; ox += 1) {
            const distance = Math.abs(ox) + Math.abs(oz) + Math.max(0, oy)
            if (distance > 4) {
              continue
            }

            if (ox === 0 && oz === 0 && oy <= 0) {
              continue
            }

            setIfAir(blocks, x + ox, canopyY + oy, z + oz, BlockId.Leaves)
          }
        }
      }

      setIfAir(blocks, x, canopyY + 3, z, BlockId.Leaves)
    }
  }
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

      if (height < SEA_LEVEL) {
        for (let y = height + 1; y <= SEA_LEVEL && y < CHUNK_HEIGHT; y += 1) {
          const index = toIndex(x, y, z)
          if (blocks[index] === BlockId.Air) {
            blocks[index] = BlockId.Water
          }
        }
      }
    }
  }

  addTrees(blocks, chunkX, chunkZ)

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
