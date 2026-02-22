import { BlockId, CHUNK_HEIGHT, SEA_LEVEL } from './chunk'

export const BiomeId = {
  Forest: 'forest',
  Snow: 'snow',
  Desert: 'desert',
  Swamp: 'swamp',
} as const

export type BiomeId = (typeof BiomeId)[keyof typeof BiomeId]

export type BiomeBlend = {
  forest: number
  snow: number
  desert: number
  swamp: number
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function sampleClimate(worldX: number, worldZ: number): { temperature: number; moisture: number } {
  const temperature = (Math.sin(worldX * 0.0045) + Math.cos(worldZ * 0.0038) + 2) * 0.25
  const moisture = (Math.cos((worldX + worldZ) * 0.0042) + Math.sin(worldZ * 0.0053) + 2) * 0.25
  return { temperature, moisture }
}

export function getBiomeBlendAt(worldX: number, worldZ: number): BiomeBlend {
  const { temperature, moisture } = sampleClimate(worldX, worldZ)

  const snow = 1 - smoothstep(0.3, 0.5, temperature)
  const desert = smoothstep(0.6, 0.8, temperature) * (1 - smoothstep(0.42, 0.63, moisture))
  const swamp = smoothstep(0.58, 0.82, moisture) * smoothstep(0.35, 0.62, temperature)

  const forestBase = Math.max(0, 1 - Math.max(snow, desert, swamp))
  const total = forestBase + snow + desert + swamp

  if (total <= 0.0001) {
    return { forest: 1, snow: 0, desert: 0, swamp: 0 }
  }

  return {
    forest: forestBase / total,
    snow: snow / total,
    desert: desert / total,
    swamp: swamp / total,
  }
}

export function getBiomeAt(worldX: number, worldZ: number): BiomeId {
  const blend = getBiomeBlendAt(worldX, worldZ)
  if (blend.desert >= blend.snow && blend.desert >= blend.swamp && blend.desert >= blend.forest) {
    return BiomeId.Desert
  }
  if (blend.snow >= blend.swamp && blend.snow >= blend.forest) {
    return BiomeId.Snow
  }
  if (blend.swamp >= blend.forest) {
    return BiomeId.Swamp
  }
  return BiomeId.Forest
}

export function getWaterLevelAt(worldX: number, worldZ: number): number {
  if (getBiomeAt(worldX, worldZ) === BiomeId.Desert) {
    return SEA_LEVEL - 1
  }

  return SEA_LEVEL
}

export function getHeightAt(worldX: number, worldZ: number): number {
  const biome = getBiomeAt(worldX, worldZ)
  const waterLevel = getWaterLevelAt(worldX, worldZ)

  const hillA = Math.sin(worldX * 0.075) * 7.5
  const hillB = Math.cos(worldZ * 0.075) * 7.5
  const ridge = Math.sin((worldX + worldZ) * 0.04) * 5.5
  const plateaus = Math.sin(worldX * 0.014) * Math.cos(worldZ * 0.014) * 6.5
  const basin = Math.sin((worldX - worldZ) * 0.018) * 3.2

  let rawHeight = SEA_LEVEL + 8 + hillA + hillB + ridge + plateaus - basin

  if (biome === BiomeId.Snow) {
    rawHeight += 4 + Math.sin((worldX - worldZ) * 0.02) * 2.2
  } else if (biome === BiomeId.Desert) {
    const dune = Math.sin(worldX * 0.11) * Math.cos(worldZ * 0.09) * 2.8
    rawHeight = rawHeight * 0.72 + (waterLevel + 6) * 0.28 + dune
  } else if (biome === BiomeId.Swamp) {
    const marshNoise = Math.sin(worldX * 0.035) * Math.cos(worldZ * 0.031) * 1.6
    rawHeight = rawHeight * 0.44 + (waterLevel + 1) * 0.56 + marshNoise
  }

  return Math.floor(Math.max(2, Math.min(CHUNK_HEIGHT - 2, rawHeight)))
}

export function getTopBlockAt(worldX: number, worldZ: number, height: number): BlockId {
  const biome = getBiomeAt(worldX, worldZ)
  const waterLevel = getWaterLevelAt(worldX, worldZ)

  if (biome === BiomeId.Desert) {
    return BlockId.Sand
  }

  if (biome === BiomeId.Swamp) {
    return BlockId.SwampGrass
  }

  if (biome === BiomeId.Snow && height >= waterLevel + 1) {
    return BlockId.Snow
  }

  if (height <= waterLevel + 1) {
    return BlockId.Sand
  }

  const east = getHeightAt(worldX + 1, worldZ)
  const west = getHeightAt(worldX - 1, worldZ)
  const north = getHeightAt(worldX, worldZ - 1)
  const south = getHeightAt(worldX, worldZ + 1)

  const slope = Math.max(
    Math.abs(height - east),
    Math.abs(height - west),
    Math.abs(height - north),
    Math.abs(height - south),
  )

  const dryNoise = Math.sin(worldX * 0.19) * Math.cos(worldZ * 0.17)

  if (slope >= 1 || dryNoise > 0.58) {
    return BlockId.Dirt
  }

  if (height > CHUNK_HEIGHT * 0.65) {
    return BlockId.Stone
  }

  return BlockId.Dirt
}

export function getSubsurfaceBlockAt(worldX: number, worldZ: number, y: number, surfaceY: number): BlockId {
  const biome = getBiomeAt(worldX, worldZ)
  const waterLevel = getWaterLevelAt(worldX, worldZ)
  const depth = surfaceY - y

  if ((biome === BiomeId.Desert || surfaceY <= waterLevel + 1) && depth <= 4) {
    return BlockId.Sand
  }

  if (biome === BiomeId.Snow && depth <= 2) {
    return BlockId.Stone
  }

  if (biome === BiomeId.Swamp && depth <= 4) {
    return BlockId.Dirt
  }

  if (depth <= 3) {
    return BlockId.Dirt
  }

  return BlockId.Stone
}

export function isColdAt(worldX: number, worldZ: number): boolean {
  return getBiomeAt(worldX, worldZ) === BiomeId.Snow
}

export function getFluidBlockAt(worldX: number, worldZ: number, y: number, surfaceY: number): BlockId {
  if (y <= surfaceY) {
    return BlockId.Air
  }

  const waterLevel = getWaterLevelAt(worldX, worldZ)
  if (y > waterLevel) {
    return BlockId.Air
  }

  const biome = getBiomeAt(worldX, worldZ)
  if (biome === BiomeId.Snow && y === waterLevel) {
    return BlockId.Ice
  }

  return BlockId.Water
}

export function isSolidAt(worldX: number, y: number, worldZ: number): boolean {
  if (y < 0) {
    return true
  }

  if (y >= CHUNK_HEIGHT) {
    return false
  }

  return y <= getHeightAt(worldX, worldZ)
}
