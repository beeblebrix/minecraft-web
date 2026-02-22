/// <reference lib="webworker" />

import {
  BlockId,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  SEA_LEVEL,
  type GenerateChunkRequest,
  type GenerateChunkResponse,
} from './chunk'
import { BiomeId, getBiomeAt, getFluidBlockAt, getHeightAt, getSubsurfaceBlockAt, getTopBlockAt } from './terrainMath'

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

function getLocalBlock(blocks: Uint8Array, x: number, y: number, z: number): BlockId {
  if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT) {
    return BlockId.Air
  }

  return blocks[toIndex(x, y, z)] as BlockId
}

function placeSwampTree(blocks: Uint8Array, chunkX: number, chunkZ: number, x: number, z: number): void {
  if (x < 3 || z < 3 || x > CHUNK_SIZE - 6 || z > CHUNK_SIZE - 6) {
    return
  }

  const worldX = chunkX * CHUNK_SIZE + x
  const worldZ = chunkZ * CHUNK_SIZE + z
  const groundY = Math.min(CHUNK_HEIGHT - 1, getHeightAt(worldX, worldZ))
  const groundY10 = Math.min(CHUNK_HEIGHT - 1, getHeightAt(worldX + 1, worldZ))
  const groundY01 = Math.min(CHUNK_HEIGHT - 1, getHeightAt(worldX, worldZ + 1))
  const groundY11 = Math.min(CHUNK_HEIGHT - 1, getHeightAt(worldX + 1, worldZ + 1))

  if (
    groundY <= SEA_LEVEL ||
    groundY > CHUNK_HEIGHT - 16 ||
    groundY10 !== groundY ||
    groundY01 !== groundY ||
    groundY11 !== groundY
  ) {
    return
  }

  const top00 = getLocalBlock(blocks, x, groundY, z)
  const top10 = getLocalBlock(blocks, x + 1, groundY, z)
  const top01 = getLocalBlock(blocks, x, groundY, z + 1)
  const top11 = getLocalBlock(blocks, x + 1, groundY, z + 1)
  const goodBase = (block: BlockId): boolean => block === BlockId.SwampGrass || block === BlockId.Dirt
  if (!goodBase(top00) || !goodBase(top10) || !goodBase(top01) || !goodBase(top11)) {
    return
  }

  const trunkHeight = 8 + Math.floor(hash2(worldX, worldZ, 401) * 7)
  const trunkTopY = groundY + trunkHeight

  for (let y = 1; y <= trunkHeight; y += 1) {
    setIfAir(blocks, x, groundY + y, z, BlockId.SwampLog)
    setIfAir(blocks, x + 1, groundY + y, z, BlockId.SwampLog)
    setIfAir(blocks, x, groundY + y, z + 1, BlockId.SwampLog)
    setIfAir(blocks, x + 1, groundY + y, z + 1, BlockId.SwampLog)
  }

  for (let oy = -3; oy <= 4; oy += 1) {
    const y = trunkTopY + oy
    let radius = 4
    if (oy <= -2 || oy >= 3) {
      radius = 3
    }
    if (oy >= 4) {
      radius = 2
    }

    for (let oz = -radius; oz <= radius + 1; oz += 1) {
      for (let ox = -radius; ox <= radius + 1; ox += 1) {
        const ax = Math.max(0, ox) + Math.max(0, oz)
        const bx = Math.max(0, -ox) + Math.max(0, -oz)
        if (Math.max(ax, bx) > radius + 1) {
          continue
        }

        const tx = x + ox
        const tz = z + oz

        const inTrunkCore = tx >= x && tx <= x + 1 && tz >= z && tz <= z + 1
        if (inTrunkCore && oy <= 1) {
          continue
        }

        const edgeNoise = hash2(worldX + ox, worldZ + oz, 409)
        if (edgeNoise > 0.9 && Math.abs(ox) + Math.abs(oz) >= radius) {
          continue
        }

        setIfAir(blocks, tx, y, tz, BlockId.SwampLeaves)
      }
    }
  }

  setIfAir(blocks, x, trunkTopY + 5, z, BlockId.SwampLeaves)
  setIfAir(blocks, x + 1, trunkTopY + 5, z, BlockId.SwampLeaves)
  setIfAir(blocks, x, trunkTopY + 5, z + 1, BlockId.SwampLeaves)
  setIfAir(blocks, x + 1, trunkTopY + 5, z + 1, BlockId.SwampLeaves)

  for (let oz = -4; oz <= 5; oz += 1) {
    for (let ox = -4; ox <= 5; ox += 1) {
      const perimeter = Math.max(Math.abs(ox), Math.abs(oz))
      if (perimeter < 3 || perimeter > 5) {
        continue
      }

      const tx = x + ox
      const tz = z + oz
      const startY = trunkTopY + 1 + Math.floor(hash2(worldX + ox, worldZ + oz, 421) * 3)

      if (getLocalBlock(blocks, tx, startY, tz) !== BlockId.SwampLeaves) {
        continue
      }

      if (hash2(worldX + ox, worldZ + oz, 433) > 0.48) {
        continue
      }

      const reachesGround = hash2(worldX + ox, worldZ + oz, 439) > 0.62
      const terrainY = Math.min(CHUNK_HEIGHT - 1, getHeightAt(worldX + ox, worldZ + oz))
      const shortBottom = startY - (3 + Math.floor(hash2(worldX + ox, worldZ + oz, 443) * 5))
      const minBottom = terrainY + 1
      const targetBottom = reachesGround ? minBottom : Math.max(minBottom + 2, shortBottom)

      for (let y = startY - 1; y >= targetBottom; y -= 1) {
        setIfAir(blocks, tx, y, tz, BlockId.SwampLeaves)
      }
    }
  }
}

function addTrees(blocks: Uint8Array, chunkX: number, chunkZ: number): void {
  for (let z = 2; z < CHUNK_SIZE - 2; z += 1) {
    for (let x = 2; x < CHUNK_SIZE - 2; x += 1) {
      const worldX = chunkX * CHUNK_SIZE + x
      const worldZ = chunkZ * CHUNK_SIZE + z
      const biome = getBiomeAt(worldX, worldZ)

      if (biome === BiomeId.Desert) {
        continue
      }

      const chance = biome === BiomeId.Forest ? 0.06 : 0.02

      const seed = hash2(worldX, worldZ, 17)
      if (seed > chance) {
        continue
      }

      if (biome === BiomeId.Swamp) {
        placeSwampTree(blocks, chunkX, chunkZ, x, z)
        continue
      }

      const groundY = Math.min(CHUNK_HEIGHT - 1, getHeightAt(worldX, worldZ))
      if (groundY < 3 || groundY > CHUNK_HEIGHT - 8 || groundY <= SEA_LEVEL) {
        continue
      }

      const topBlock = blocks[toIndex(x, groundY, z)]
      if (biome === BiomeId.Forest && topBlock !== BlockId.Dirt && topBlock !== BlockId.SwampGrass) {
        continue
      }

      if (biome === BiomeId.Snow && topBlock !== BlockId.Snow && topBlock !== BlockId.Dirt) {
        continue
      }

      const heightNoiseA = hash2(worldX, worldZ, 41)
      const heightNoiseB = hash2(worldX, worldZ, 73)
      const extraTallBonus = heightNoiseB > 0.82 ? 1 : 0
      const trunkBase = 4
      const trunkRange = biome === BiomeId.Forest ? 4 : 2
      const trunkHeight = trunkBase + Math.floor(heightNoiseA * trunkRange) + extraTallBonus
      const canopyRadius = 2
      const canopyDistanceLimit = 4

      const trunkBlock = BlockId.Log
      const leafBlock = BlockId.Leaves

      for (let y = 1; y <= trunkHeight; y += 1) {
        setIfAir(blocks, x, groundY + y, z, trunkBlock)
      }

      const canopyY = groundY + trunkHeight
      for (let oy = -2; oy <= 2; oy += 1) {
        for (let oz = -canopyRadius; oz <= canopyRadius; oz += 1) {
          for (let ox = -canopyRadius; ox <= canopyRadius; ox += 1) {
            const distance = Math.abs(ox) + Math.abs(oz) + Math.max(0, oy)
            if (distance > canopyDistanceLimit) {
              continue
            }

            if (ox === 0 && oz === 0 && oy <= 0) {
              continue
            }

            setIfAir(blocks, x + ox, canopyY + oy, z + oz, leafBlock)

          }
        }
      }

      setIfAir(blocks, x, canopyY + 3, z, leafBlock)
    }
  }
}

function addCacti(blocks: Uint8Array, chunkX: number, chunkZ: number): void {
  for (let z = 1; z < CHUNK_SIZE - 1; z += 1) {
    for (let x = 1; x < CHUNK_SIZE - 1; x += 1) {
      const worldX = chunkX * CHUNK_SIZE + x
      const worldZ = chunkZ * CHUNK_SIZE + z
      if (getBiomeAt(worldX, worldZ) !== BiomeId.Desert) {
        continue
      }

      const seed = hash2(worldX, worldZ, 271)
      if (seed > 0.035) {
        continue
      }

      const groundY = Math.min(CHUNK_HEIGHT - 1, getHeightAt(worldX, worldZ))
      if (groundY <= SEA_LEVEL - 1 || groundY > CHUNK_HEIGHT - 6) {
        continue
      }

      if (getLocalBlock(blocks, x, groundY, z) !== BlockId.Sand) {
        continue
      }

      const height = 2 + Math.floor(hash2(worldX, worldZ, 281) * 3)
      for (let y = 1; y <= height; y += 1) {
        setIfAir(blocks, x, groundY + y, z, BlockId.Cactus)
      }
    }
  }
}

function addSwampReeds(blocks: Uint8Array, chunkX: number, chunkZ: number): void {
  for (let z = 1; z < CHUNK_SIZE - 1; z += 1) {
    for (let x = 1; x < CHUNK_SIZE - 1; x += 1) {
      const worldX = chunkX * CHUNK_SIZE + x
      const worldZ = chunkZ * CHUNK_SIZE + z
      if (getBiomeAt(worldX, worldZ) !== BiomeId.Swamp) {
        continue
      }

      const seed = hash2(worldX, worldZ, 307)
      if (seed > 0.09) {
        continue
      }

      const groundY = Math.min(CHUNK_HEIGHT - 2, getHeightAt(worldX, worldZ))
      const ground = getLocalBlock(blocks, x, groundY, z)
      if (ground !== BlockId.SwampGrass && ground !== BlockId.Dirt && ground !== BlockId.Sand) {
        continue
      }

      const north = getLocalBlock(blocks, x, groundY, z - 1)
      const south = getLocalBlock(blocks, x, groundY, z + 1)
      const west = getLocalBlock(blocks, x - 1, groundY, z)
      const east = getLocalBlock(blocks, x + 1, groundY, z)
      const hasNearbyWater = north === BlockId.Water || south === BlockId.Water || west === BlockId.Water || east === BlockId.Water
      if (!hasNearbyWater) {
        continue
      }

      const height = 1 + Math.floor(hash2(worldX, worldZ, 313) * 3)
      for (let y = 1; y <= height; y += 1) {
        setIfAir(blocks, x, groundY + y, z, BlockId.SwampReed)
      }
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
        } else {
          blocks[index] = getSubsurfaceBlockAt(worldX, worldZ, y, height)
        }
      }

      for (let y = height + 1; y < CHUNK_HEIGHT; y += 1) {
        const fluid = getFluidBlockAt(worldX, worldZ, y, height)
        if (fluid === BlockId.Air) {
          break
        }

        const index = toIndex(x, y, z)
        if (blocks[index] === BlockId.Air) {
          blocks[index] = fluid
        }
      }
    }
  }

  addTrees(blocks, chunkX, chunkZ)
  addCacti(blocks, chunkX, chunkZ)
  addSwampReeds(blocks, chunkX, chunkZ)

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
