import * as THREE from 'three'
import {
  BlockId,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  ChunkData,
  type GenerateChunkRequest,
  type GenerateChunkResponse,
} from './chunk'
import { getHeightAt as terrainHeightAt, isSolidAt as terrainSolidAt } from './terrainMath'
import { raycastVoxel } from './voxelRaycast'

type ChunkRecord = {
  data: ChunkData
  object: THREE.Object3D
}

const MAX_CHUNK_REQUESTS_PER_UPDATE = 8

type ChunkManagerOptions = {
  savedChunks?: Map<string, ArrayBuffer>
  onChunkChanged?: (chunkX: number, chunkZ: number, blocks: ArrayBuffer) => void | Promise<void>
}

export class ChunkManager {
  readonly root = new THREE.Group()

  private readonly chunks = new Map<string, ChunkRecord>()
  private readonly requestedChunks = new Set<string>()
  private readonly viewDistanceInChunks: number
  private readonly worker: Worker
  private readonly savedChunks: Map<string, ArrayBuffer>
  private readonly onChunkChanged?: (chunkX: number, chunkZ: number, blocks: ArrayBuffer) => void | Promise<void>
  private targetChunkKeys = new Set<string>()

  private currentChunkX = Number.NaN
  private currentChunkZ = Number.NaN

  constructor(viewDistanceInChunks = 2, options: ChunkManagerOptions = {}) {
    this.viewDistanceInChunks = viewDistanceInChunks
    this.savedChunks = options.savedChunks ?? new Map<string, ArrayBuffer>()
    this.onChunkChanged = options.onChunkChanged
    this.worker = new Worker(new URL('./chunkWorker.ts', import.meta.url), { type: 'module' })
    this.worker.addEventListener('message', this.onChunkGenerated)
  }

  update(playerPosition: THREE.Vector3): void {
    const chunkX = Math.floor(playerPosition.x / CHUNK_SIZE)
    const chunkZ = Math.floor(playerPosition.z / CHUNK_SIZE)

    if (chunkX === this.currentChunkX && chunkZ === this.currentChunkZ) {
      return
    }

    this.currentChunkX = chunkX
    this.currentChunkZ = chunkZ

    const neededKeys = new Set<string>()
    const missingChunks: Array<{ x: number; z: number; key: string; distanceSq: number }> = []

    for (let dz = -this.viewDistanceInChunks; dz <= this.viewDistanceInChunks; dz += 1) {
      for (let dx = -this.viewDistanceInChunks; dx <= this.viewDistanceInChunks; dx += 1) {
        const nextX = chunkX + dx
        const nextZ = chunkZ + dz
        const key = toChunkKey(nextX, nextZ)
        neededKeys.add(key)

        if (!this.chunks.has(key) && !this.requestedChunks.has(key)) {
          missingChunks.push({
            x: nextX,
            z: nextZ,
            key,
            distanceSq: dx * dx + dz * dz,
          })
        }
      }
    }

    this.targetChunkKeys = neededKeys

    missingChunks
      .sort((a, b) => a.distanceSq - b.distanceSq)
      .slice(0, MAX_CHUNK_REQUESTS_PER_UPDATE)
      .forEach((chunk) => {
        this.requestChunk(chunk.x, chunk.z, chunk.key)
      })

    for (const [key, record] of this.chunks.entries()) {
      if (neededKeys.has(key)) {
        continue
      }

      this.root.remove(record.object)
      disposeObject(record.object)
      this.chunks.delete(key)
    }
  }

  getSurfaceHeight(worldX: number, worldZ: number): number {
    const height = getHeightAt(worldX, worldZ)
    return height + 1
  }

  getLoadedChunkCount(): number {
    return this.chunks.size
  }

  getPendingChunkCount(): number {
    return this.requestedChunks.size
  }

  getSavedChunkCount(): number {
    return this.savedChunks.size
  }

  isSolidBlock(worldX: number, y: number, worldZ: number): boolean {
    const chunkX = Math.floor(worldX / CHUNK_SIZE)
    const chunkZ = Math.floor(worldZ / CHUNK_SIZE)
    const key = toChunkKey(chunkX, chunkZ)
    const record = this.chunks.get(key)

    if (!record) {
      return terrainSolidAt(worldX, y, worldZ)
    }

    if (y < 0) {
      return true
    }

    if (y >= CHUNK_HEIGHT) {
      return false
    }

    const localX = worldX - chunkX * CHUNK_SIZE
    const localZ = worldZ - chunkZ * CHUNK_SIZE

    return record.data.get(localX, y, localZ) !== BlockId.Air
  }

  raycastBlock(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
  ): { x: number; y: number; z: number; normalX: number; normalY: number; normalZ: number } | null {
    return raycastVoxel(
      origin.x,
      origin.y,
      origin.z,
      direction.x,
      direction.y,
      direction.z,
      maxDistance,
      (x, y, z) => this.isSolidBlock(x, y, z),
    )
  }

  breakBlock(worldX: number, y: number, worldZ: number): BlockId | null {
    const current = this.getLoadedBlock(worldX, y, worldZ)

    if (current === null || current === BlockId.Air) {
      return null
    }

    const changed = this.setBlock(worldX, y, worldZ, BlockId.Air)
    return changed ? current : null
  }

  placeBlock(worldX: number, y: number, worldZ: number, block: BlockId): boolean {
    const current = this.getLoadedBlock(worldX, y, worldZ)
    if (current === null || current !== BlockId.Air) {
      return false
    }

    return this.setBlock(worldX, y, worldZ, block)
  }

  getCurrentChunk(): { x: number; z: number } {
    return {
      x: Number.isNaN(this.currentChunkX) ? 0 : this.currentChunkX,
      z: Number.isNaN(this.currentChunkZ) ? 0 : this.currentChunkZ,
    }
  }

  dispose(): void {
    this.worker.removeEventListener('message', this.onChunkGenerated)
    this.worker.terminate()

    for (const record of this.chunks.values()) {
      this.root.remove(record.object)
      disposeObject(record.object)
    }

    this.chunks.clear()
    this.requestedChunks.clear()
    this.targetChunkKeys.clear()
  }

  private buildChunkMesh(data: ChunkData): THREE.Object3D {
    let grassCount = 0
    let dirtCount = 0
    let stoneCount = 0

    for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        for (let x = 0; x < CHUNK_SIZE; x += 1) {
          const block = data.get(x, y, z)
          if (block === BlockId.Air) {
            continue
          }

          const worldX = data.chunkX * CHUNK_SIZE + x
          const worldZ = data.chunkZ * CHUNK_SIZE + z

          if (this.isBlockExposed(worldX, y, worldZ, data)) {
            if (block === BlockId.Grass) {
              grassCount += 1
            } else if (block === BlockId.Dirt) {
              dirtCount += 1
            } else if (block === BlockId.Stone) {
              stoneCount += 1
            }
          }
        }
      }
    }

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const chunkGroup = new THREE.Group()

    const grassMesh = createChunkLayerMesh(geometry, 0x64b84c, grassCount)
    const dirtMesh = createChunkLayerMesh(geometry, 0x7f5936, dirtCount)
    const stoneMesh = createChunkLayerMesh(geometry, 0x746e67, stoneCount)

    chunkGroup.add(grassMesh, dirtMesh, stoneMesh)

    const matrix = new THREE.Matrix4()
    let grassIndex = 0
    let dirtIndex = 0
    let stoneIndex = 0

    for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        for (let x = 0; x < CHUNK_SIZE; x += 1) {
          const block = data.get(x, y, z)
          if (block === BlockId.Air) {
            continue
          }

          const worldX = data.chunkX * CHUNK_SIZE + x
          const worldZ = data.chunkZ * CHUNK_SIZE + z

          if (!this.isBlockExposed(worldX, y, worldZ, data)) {
            continue
          }

          matrix.makeTranslation(worldX + 0.5, y + 0.5, worldZ + 0.5)

          if (block === BlockId.Grass) {
            grassMesh.setMatrixAt(grassIndex, matrix)
            grassIndex += 1
          } else if (block === BlockId.Dirt) {
            dirtMesh.setMatrixAt(dirtIndex, matrix)
            dirtIndex += 1
          } else if (block === BlockId.Stone) {
            stoneMesh.setMatrixAt(stoneIndex, matrix)
            stoneIndex += 1
          }
        }
      }
    }

    grassMesh.count = grassIndex
    dirtMesh.count = dirtIndex
    stoneMesh.count = stoneIndex

    grassMesh.instanceMatrix.needsUpdate = true
    dirtMesh.instanceMatrix.needsUpdate = true
    stoneMesh.instanceMatrix.needsUpdate = true

    return chunkGroup
  }

  private requestChunk(chunkX: number, chunkZ: number, key: string): void {
    this.requestedChunks.add(key)

    const message: GenerateChunkRequest = {
      type: 'generate',
      chunkX,
      chunkZ,
    }

    this.worker.postMessage(message)
  }

  private readonly onChunkGenerated = (event: MessageEvent<GenerateChunkResponse>): void => {
    if (event.data.type !== 'generated') {
      return
    }

    const { chunkX, chunkZ, blocks } = event.data
    const key = toChunkKey(chunkX, chunkZ)
    this.requestedChunks.delete(key)

    if (!this.targetChunkKeys.has(key) || this.chunks.has(key)) {
      return
    }

    const data = new ChunkData(chunkX, chunkZ)
    const saved = this.savedChunks.get(key)

    if (saved) {
      data.loadFromBuffer(saved)
    } else {
      data.loadFromBuffer(blocks)
    }

    const object = this.buildChunkMesh(data)
    this.root.add(object)
    this.chunks.set(key, { data, object })
  }

  private setBlock(worldX: number, y: number, worldZ: number, block: BlockId): boolean {
    if (y < 0 || y >= CHUNK_HEIGHT) {
      return false
    }

    const chunkX = Math.floor(worldX / CHUNK_SIZE)
    const chunkZ = Math.floor(worldZ / CHUNK_SIZE)
    const key = toChunkKey(chunkX, chunkZ)
    const record = this.chunks.get(key)

    if (!record) {
      return false
    }

    const localX = worldX - chunkX * CHUNK_SIZE
    const localZ = worldZ - chunkZ * CHUNK_SIZE
    const existing = record.data.get(localX, y, localZ)

    if (existing === block) {
      return false
    }

    record.data.set(localX, y, localZ, block)
    this.persistChunk(chunkX, chunkZ, record.data)
    this.rebuildImpactedChunks(chunkX, chunkZ, localX, localZ)
    return true
  }

  private getLoadedBlock(worldX: number, y: number, worldZ: number): BlockId | null {
    if (y < 0 || y >= CHUNK_HEIGHT) {
      return null
    }

    const chunkX = Math.floor(worldX / CHUNK_SIZE)
    const chunkZ = Math.floor(worldZ / CHUNK_SIZE)
    const record = this.chunks.get(toChunkKey(chunkX, chunkZ))

    if (!record) {
      return null
    }

    const localX = worldX - chunkX * CHUNK_SIZE
    const localZ = worldZ - chunkZ * CHUNK_SIZE
    return record.data.get(localX, y, localZ)
  }

  private persistChunk(chunkX: number, chunkZ: number, data: ChunkData): void {
    const key = toChunkKey(chunkX, chunkZ)
    const blocks = data.toArrayBuffer()
    this.savedChunks.set(key, blocks)

    if (!this.onChunkChanged) {
      return
    }

    Promise.resolve(this.onChunkChanged(chunkX, chunkZ, blocks)).catch(() => {
    })
  }

  private rebuildImpactedChunks(chunkX: number, chunkZ: number, localX: number, localZ: number): void {
    const keys = new Set<string>([toChunkKey(chunkX, chunkZ)])

    if (localX === 0) {
      keys.add(toChunkKey(chunkX - 1, chunkZ))
    } else if (localX === CHUNK_SIZE - 1) {
      keys.add(toChunkKey(chunkX + 1, chunkZ))
    }

    if (localZ === 0) {
      keys.add(toChunkKey(chunkX, chunkZ - 1))
    } else if (localZ === CHUNK_SIZE - 1) {
      keys.add(toChunkKey(chunkX, chunkZ + 1))
    }

    for (const key of keys) {
      const record = this.chunks.get(key)
      if (!record) {
        continue
      }

      this.root.remove(record.object)
      disposeObject(record.object)

      const rebuiltObject = this.buildChunkMesh(record.data)
      this.root.add(rebuiltObject)
      record.object = rebuiltObject
      this.chunks.set(key, record)
    }
  }

  private isBlockExposed(worldX: number, y: number, worldZ: number, sourceChunk: ChunkData): boolean {
    return (
      !this.isSolidAtForMeshing(worldX + 1, y, worldZ, sourceChunk) ||
      !this.isSolidAtForMeshing(worldX - 1, y, worldZ, sourceChunk) ||
      !this.isSolidAtForMeshing(worldX, y + 1, worldZ, sourceChunk) ||
      !this.isSolidAtForMeshing(worldX, y - 1, worldZ, sourceChunk) ||
      !this.isSolidAtForMeshing(worldX, y, worldZ + 1, sourceChunk) ||
      !this.isSolidAtForMeshing(worldX, y, worldZ - 1, sourceChunk)
    )
  }

  private isSolidAtForMeshing(worldX: number, y: number, worldZ: number, sourceChunk: ChunkData): boolean {
    if (y < 0) {
      return true
    }

    if (y >= CHUNK_HEIGHT) {
      return false
    }

    const chunkX = Math.floor(worldX / CHUNK_SIZE)
    const chunkZ = Math.floor(worldZ / CHUNK_SIZE)

    if (chunkX === sourceChunk.chunkX && chunkZ === sourceChunk.chunkZ) {
      const localX = worldX - chunkX * CHUNK_SIZE
      const localZ = worldZ - chunkZ * CHUNK_SIZE
      return sourceChunk.get(localX, y, localZ) !== BlockId.Air
    }

    const neighbor = this.chunks.get(toChunkKey(chunkX, chunkZ))
    if (neighbor) {
      const localX = worldX - chunkX * CHUNK_SIZE
      const localZ = worldZ - chunkZ * CHUNK_SIZE
      return neighbor.data.get(localX, y, localZ) !== BlockId.Air
    }

    return terrainSolidAt(worldX, y, worldZ)
  }
}

function createChunkLayerMesh(
  geometry: THREE.BoxGeometry,
  color: number,
  instanceCount: number,
): THREE.InstancedMesh {
  const material = new THREE.MeshLambertMaterial({ color })
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(instanceCount, 1))
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  mesh.castShadow = false
  mesh.receiveShadow = true
  return mesh
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.geometry || !mesh.material) {
      return
    }

    mesh.geometry.dispose()

    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((material) => material.dispose())
    } else {
      mesh.material.dispose()
    }
  })
}

function toChunkKey(chunkX: number, chunkZ: number): string {
  return `${chunkX}:${chunkZ}`
}

function getHeightAt(worldX: number, worldZ: number): number {
  return terrainHeightAt(worldX, worldZ)
}
