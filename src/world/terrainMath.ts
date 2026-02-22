import { BlockId, CHUNK_HEIGHT, SEA_LEVEL } from './chunk'

export function getHeightAt(worldX: number, worldZ: number): number {
  const hillA = Math.sin(worldX * 0.075) * 8.5
  const hillB = Math.cos(worldZ * 0.075) * 8.5
  const ridge = Math.sin((worldX + worldZ) * 0.04) * 6
  const plateaus = Math.sin(worldX * 0.014) * Math.cos(worldZ * 0.014) * 7
  const basin = Math.sin((worldX - worldZ) * 0.018) * 3.5

  const rawHeight = SEA_LEVEL + 8 + hillA + hillB + ridge + plateaus - basin
  return Math.floor(Math.max(2, Math.min(CHUNK_HEIGHT - 2, rawHeight)))
}

export function getTopBlockAt(worldX: number, worldZ: number, height: number): BlockId {
  if (isColdAt(worldX, worldZ) && height >= CHUNK_HEIGHT * 0.55) {
    return BlockId.Snow
  }

  if (height <= SEA_LEVEL + 1) {
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
  const depth = surfaceY - y

  if (surfaceY <= SEA_LEVEL + 1 && depth <= 3) {
    return BlockId.Sand
  }

  if (surfaceY >= CHUNK_HEIGHT * 0.55 && isColdAt(worldX, worldZ) && depth <= 2) {
    return BlockId.Stone
  }

  if (depth <= 3) {
    return BlockId.Dirt
  }

  return BlockId.Stone
}

export function isColdAt(worldX: number, worldZ: number): boolean {
  const latitude = (Math.sin(worldZ * 0.01) + 1) * 0.5
  const continental = (Math.cos(worldX * 0.014) + 1) * 0.5
  const noise = Math.sin((worldX + worldZ) * 0.02) * 0.12
  const coldness = latitude * 0.55 + continental * 0.35 + noise
  return coldness > 0.68
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
