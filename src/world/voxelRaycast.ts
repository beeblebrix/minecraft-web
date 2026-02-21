export type VoxelHit = {
  x: number
  y: number
  z: number
  normalX: number
  normalY: number
  normalZ: number
}

export function raycastVoxel(
  originX: number,
  originY: number,
  originZ: number,
  directionX: number,
  directionY: number,
  directionZ: number,
  maxDistance: number,
  isSolid: (x: number, y: number, z: number) => boolean,
): VoxelHit | null {
  const length = Math.hypot(directionX, directionY, directionZ)
  if (length === 0) {
    return null
  }

  const dx = directionX / length
  const dy = directionY / length
  const dz = directionZ / length

  let x = Math.floor(originX)
  let y = Math.floor(originY)
  let z = Math.floor(originZ)

  if (isSolid(x, y, z)) {
    return { x, y, z, normalX: 0, normalY: 0, normalZ: 0 }
  }

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0

  const tDeltaX = stepX === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(dx)
  const tDeltaY = stepY === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(dy)
  const tDeltaZ = stepZ === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(dz)

  let tMaxX =
    stepX === 0
      ? Number.POSITIVE_INFINITY
      : stepX > 0
        ? (Math.floor(originX) + 1 - originX) / dx
        : (originX - Math.floor(originX)) / -dx
  let tMaxY =
    stepY === 0
      ? Number.POSITIVE_INFINITY
      : stepY > 0
        ? (Math.floor(originY) + 1 - originY) / dy
        : (originY - Math.floor(originY)) / -dy
  let tMaxZ =
    stepZ === 0
      ? Number.POSITIVE_INFINITY
      : stepZ > 0
        ? (Math.floor(originZ) + 1 - originZ) / dz
        : (originZ - Math.floor(originZ)) / -dz

  let traveled = 0
  let normalX = 0
  let normalY = 0
  let normalZ = 0

  while (traveled <= maxDistance) {
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        x += stepX
        traveled = tMaxX
        tMaxX += tDeltaX
        normalX = -stepX
        normalY = 0
        normalZ = 0
      } else {
        z += stepZ
        traveled = tMaxZ
        tMaxZ += tDeltaZ
        normalX = 0
        normalY = 0
        normalZ = -stepZ
      }
    } else if (tMaxY < tMaxZ) {
      y += stepY
      traveled = tMaxY
      tMaxY += tDeltaY
      normalX = 0
      normalY = -stepY
      normalZ = 0
    } else {
      z += stepZ
      traveled = tMaxZ
      tMaxZ += tDeltaZ
      normalX = 0
      normalY = 0
      normalZ = -stepZ
    }

    if (traveled > maxDistance) {
      break
    }

    if (isSolid(x, y, z)) {
      return { x, y, z, normalX, normalY, normalZ }
    }
  }

  return null
}
