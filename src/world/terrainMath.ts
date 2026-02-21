import { BlockId, CHUNK_HEIGHT } from './chunk'

export function getHeightAt(worldX: number, worldZ: number): number {
  const hillA = Math.sin(worldX * 0.08) * 4.5
  const hillB = Math.cos(worldZ * 0.08) * 4.5
  const ridge = Math.sin((worldX + worldZ) * 0.045) * 3
  const plateaus = Math.sin(worldX * 0.015) * Math.cos(worldZ * 0.015) * 4

  return Math.floor(10 + hillA + hillB + ridge + plateaus)
}

export function getTopBlockAt(worldX: number, worldZ: number, height: number): BlockId {
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

  return BlockId.Grass
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
