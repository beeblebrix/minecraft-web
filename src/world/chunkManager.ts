import * as THREE from 'three'
import {
  BlockId,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  ChunkData,
  SEA_LEVEL,
  type GenerateChunkRequest,
  type GenerateChunkResponse,
} from './chunk'
import {
  getHeightAt as terrainHeightAt,
  getSubsurfaceBlockAt as terrainSubsurfaceAt,
  getTopBlockAt as terrainTopBlockAt,
  isColdAt as terrainIsColdAt,
} from './terrainMath'
import { raycastVoxel } from './voxelRaycast'
import { createBlockTextures } from '../render/blockTextures'

type ChunkRecord = {
  data: ChunkData
  object: THREE.Object3D
}

const MAX_CHUNK_REQUESTS_PER_UPDATE = 8
const DIRT_GREEN_MIN_DELAY_MS = 30000
const DIRT_GREEN_MAX_DELAY_MS = 90000
const MAX_GRASS_GROWTH_REBUILDS_PER_UPDATE = 4

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
  private readonly textures = createBlockTextures()
  private readonly dirtGreenReadyAt = new Map<string, number>()
  private readonly dirtGreenGrown = new Set<string>()
  private readonly growthDirtyChunkKeys = new Set<string>()
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

    if (chunkX !== this.currentChunkX || chunkZ !== this.currentChunkZ) {
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
        this.clearDirtGrassTrackingForChunkKey(key)
      }
    }

    this.processGrassGrowth(Date.now())
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
    const block = this.getBlockAtWorld(worldX, y, worldZ)
    return block !== BlockId.Air && block !== BlockId.Water
  }

  isWaterBlock(worldX: number, y: number, worldZ: number): boolean {
    return this.getBlockAtWorld(worldX, y, worldZ) === BlockId.Water
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

    if (current === null || current === BlockId.Air || current === BlockId.Water) {
      return null
    }

    const changed = this.setBlock(worldX, y, worldZ, BlockId.Air)
    return changed ? current : null
  }

  placeBlock(worldX: number, y: number, worldZ: number, block: BlockId): boolean {
    const current = this.getLoadedBlock(worldX, y, worldZ)
    if (current === null || (current !== BlockId.Air && current !== BlockId.Water)) {
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
    this.dirtGreenReadyAt.clear()
    this.dirtGreenGrown.clear()
    this.growthDirtyChunkKeys.clear()
  }

  private buildChunkMesh(data: ChunkData): THREE.Object3D {
    let dirtCount = 0
    let stoneCount = 0
    let logCount = 0
    let leavesCount = 0
    let sandCount = 0
    let snowCount = 0
    let iceCount = 0
    let waterTopCount = 0
    let waterNorthCount = 0
    let waterSouthCount = 0
    let waterWestCount = 0
    let waterEastCount = 0
    let dirtTopCapCount = 0

    for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        for (let x = 0; x < CHUNK_SIZE; x += 1) {
          const block = data.get(x, y, z)
          if (block === BlockId.Air) {
            continue
          }

          const worldX = data.chunkX * CHUNK_SIZE + x
          const worldZ = data.chunkZ * CHUNK_SIZE + z

          if (block === BlockId.Water) {
            if (this.getBlockAtForMeshing(worldX, y + 1, worldZ, data) === BlockId.Air) {
              waterTopCount += 1
            }
            if (this.getBlockAtForMeshing(worldX, y, worldZ - 1, data) === BlockId.Air) {
              waterNorthCount += 1
            }
            if (this.getBlockAtForMeshing(worldX, y, worldZ + 1, data) === BlockId.Air) {
              waterSouthCount += 1
            }
            if (this.getBlockAtForMeshing(worldX - 1, y, worldZ, data) === BlockId.Air) {
              waterWestCount += 1
            }
            if (this.getBlockAtForMeshing(worldX + 1, y, worldZ, data) === BlockId.Air) {
              waterEastCount += 1
            }
            continue
          }

          const exposed = this.isBlockExposed(worldX, y, worldZ, data, block)
          const topExposed = this.getBlockAtForMeshing(worldX, y + 1, worldZ, data) === BlockId.Air

          this.syncDirtGrassGrowthState(worldX, y, worldZ, block, topExposed)

          if (exposed) {
            if (block === BlockId.Dirt || block === BlockId.Grass) {
              dirtCount += 1
            } else if (block === BlockId.Stone) {
              stoneCount += 1
            } else if (block === BlockId.Log) {
              logCount += 1
            } else if (block === BlockId.Leaves) {
              leavesCount += 1
            } else if (block === BlockId.Sand) {
              sandCount += 1
            } else if (block === BlockId.Snow) {
              snowCount += 1
            } else if (block === BlockId.Ice) {
              iceCount += 1
            }

            if (this.shouldRenderDirtGrassTopCap(worldX, y, worldZ, block, topExposed)) {
              dirtTopCapCount += 1
            }
          }
        }
      }
    }

    const blockGeometry = new THREE.BoxGeometry(1, 1, 1)
    const topCapGeometry = new THREE.PlaneGeometry(1, 1)
    const chunkGroup = new THREE.Group()

    const dirtMesh = createChunkLayerMesh(blockGeometry, dirtCount, { map: this.textures.dirt })
    const stoneMesh = createChunkLayerMesh(blockGeometry, stoneCount, { map: this.textures.stone })
    const logMesh = createChunkLayerMesh(blockGeometry, logCount, {
      material: [
        materialFromTexture(this.textures.logSide),
        materialFromTexture(this.textures.logSide),
        materialFromTexture(this.textures.logTop),
        materialFromTexture(this.textures.logTop),
        materialFromTexture(this.textures.logSide),
        materialFromTexture(this.textures.logSide),
      ],
    })
    const leavesMesh = createChunkLayerMesh(blockGeometry, leavesCount, { map: this.textures.leaves })
    const sandMesh = createChunkLayerMesh(blockGeometry, sandCount, { map: this.textures.sand })
    const snowMesh = createChunkLayerMesh(blockGeometry, snowCount, { map: this.textures.snow })
    const iceMesh = createChunkLayerMesh(blockGeometry, iceCount, {
      map: this.textures.ice,
      transparent: true,
      opacity: 0.85,
    })
    const waterFaceGeometry = new THREE.PlaneGeometry(1, 1)
    const waterMaterialOptions = {
      map: this.textures.water,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      side: THREE.DoubleSide,
    }
    const waterTopMesh = createChunkLayerMesh(waterFaceGeometry, waterTopCount, waterMaterialOptions)
    const waterNorthMesh = createChunkLayerMesh(waterFaceGeometry, waterNorthCount, waterMaterialOptions)
    const waterSouthMesh = createChunkLayerMesh(waterFaceGeometry, waterSouthCount, waterMaterialOptions)
    const waterWestMesh = createChunkLayerMesh(waterFaceGeometry, waterWestCount, waterMaterialOptions)
    const waterEastMesh = createChunkLayerMesh(waterFaceGeometry, waterEastCount, waterMaterialOptions)
    const dirtTopCapMesh = createChunkLayerMesh(topCapGeometry, dirtTopCapCount, { map: this.textures.grassTop })

    chunkGroup.add(
      dirtMesh,
      stoneMesh,
      logMesh,
      leavesMesh,
      sandMesh,
      snowMesh,
      iceMesh,
      waterTopMesh,
      waterNorthMesh,
      waterSouthMesh,
      waterWestMesh,
      waterEastMesh,
      dirtTopCapMesh,
    )

    const matrix = new THREE.Matrix4()
    const capPosition = new THREE.Vector3()
    const capRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
    const capScale = new THREE.Vector3(1, 1, 1)
    const waterTopRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
    const waterNorthRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0))
    const waterSouthRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0))
    const waterWestRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0))
    const waterEastRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0))
    let dirtIndex = 0
    let stoneIndex = 0
    let logIndex = 0
    let leavesIndex = 0
    let sandIndex = 0
    let snowIndex = 0
    let iceIndex = 0
    let waterTopIndex = 0
    let waterNorthIndex = 0
    let waterSouthIndex = 0
    let waterWestIndex = 0
    let waterEastIndex = 0
    let dirtTopCapIndex = 0

    for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        for (let x = 0; x < CHUNK_SIZE; x += 1) {
          const block = data.get(x, y, z)
          if (block === BlockId.Air) {
            continue
          }

          const worldX = data.chunkX * CHUNK_SIZE + x
          const worldZ = data.chunkZ * CHUNK_SIZE + z

          if (block === BlockId.Water) {
            if (this.getBlockAtForMeshing(worldX, y + 1, worldZ, data) === BlockId.Air) {
              capPosition.set(worldX + 0.5, y + 0.999, worldZ + 0.5)
              matrix.compose(capPosition, waterTopRotation, capScale)
              waterTopMesh.setMatrixAt(waterTopIndex, matrix)
              waterTopIndex += 1
            }

            if (this.getBlockAtForMeshing(worldX, y, worldZ - 1, data) === BlockId.Air) {
              capPosition.set(worldX + 0.5, y + 0.5, worldZ + 0.001)
              matrix.compose(capPosition, waterNorthRotation, capScale)
              waterNorthMesh.setMatrixAt(waterNorthIndex, matrix)
              waterNorthIndex += 1
            }

            if (this.getBlockAtForMeshing(worldX, y, worldZ + 1, data) === BlockId.Air) {
              capPosition.set(worldX + 0.5, y + 0.5, worldZ + 0.999)
              matrix.compose(capPosition, waterSouthRotation, capScale)
              waterSouthMesh.setMatrixAt(waterSouthIndex, matrix)
              waterSouthIndex += 1
            }

            if (this.getBlockAtForMeshing(worldX - 1, y, worldZ, data) === BlockId.Air) {
              capPosition.set(worldX + 0.001, y + 0.5, worldZ + 0.5)
              matrix.compose(capPosition, waterWestRotation, capScale)
              waterWestMesh.setMatrixAt(waterWestIndex, matrix)
              waterWestIndex += 1
            }

            if (this.getBlockAtForMeshing(worldX + 1, y, worldZ, data) === BlockId.Air) {
              capPosition.set(worldX + 0.999, y + 0.5, worldZ + 0.5)
              matrix.compose(capPosition, waterEastRotation, capScale)
              waterEastMesh.setMatrixAt(waterEastIndex, matrix)
              waterEastIndex += 1
            }

            continue
          }

          const exposed = this.isBlockExposed(worldX, y, worldZ, data, block)
          const topExposed = this.getBlockAtForMeshing(worldX, y + 1, worldZ, data) === BlockId.Air

          if (!exposed) {
            continue
          }

          matrix.makeTranslation(worldX + 0.5, y + 0.5, worldZ + 0.5)

          if (block === BlockId.Dirt || block === BlockId.Grass) {
            dirtMesh.setMatrixAt(dirtIndex, matrix)
            dirtIndex += 1
          } else if (block === BlockId.Stone) {
            stoneMesh.setMatrixAt(stoneIndex, matrix)
            stoneIndex += 1
          } else if (block === BlockId.Log) {
            logMesh.setMatrixAt(logIndex, matrix)
            logIndex += 1
          } else if (block === BlockId.Leaves) {
            leavesMesh.setMatrixAt(leavesIndex, matrix)
            leavesIndex += 1
          } else if (block === BlockId.Sand) {
            sandMesh.setMatrixAt(sandIndex, matrix)
            sandIndex += 1
          } else if (block === BlockId.Snow) {
            snowMesh.setMatrixAt(snowIndex, matrix)
            snowIndex += 1
          } else if (block === BlockId.Ice) {
            iceMesh.setMatrixAt(iceIndex, matrix)
            iceIndex += 1
          }

          if (this.shouldRenderDirtGrassTopCap(worldX, y, worldZ, block, topExposed)) {
            capPosition.set(worldX + 0.5, y + 1.002, worldZ + 0.5)
            matrix.compose(capPosition, capRotation, capScale)
            dirtTopCapMesh.setMatrixAt(dirtTopCapIndex, matrix)
            dirtTopCapIndex += 1
          }
        }
      }
    }

    dirtMesh.count = dirtIndex
    stoneMesh.count = stoneIndex
    logMesh.count = logIndex
    leavesMesh.count = leavesIndex
    sandMesh.count = sandIndex
    snowMesh.count = snowIndex
    iceMesh.count = iceIndex
    waterTopMesh.count = waterTopIndex
    waterNorthMesh.count = waterNorthIndex
    waterSouthMesh.count = waterSouthIndex
    waterWestMesh.count = waterWestIndex
    waterEastMesh.count = waterEastIndex
    dirtTopCapMesh.count = dirtTopCapIndex

    dirtMesh.instanceMatrix.needsUpdate = true
    stoneMesh.instanceMatrix.needsUpdate = true
    logMesh.instanceMatrix.needsUpdate = true
    leavesMesh.instanceMatrix.needsUpdate = true
    sandMesh.instanceMatrix.needsUpdate = true
    snowMesh.instanceMatrix.needsUpdate = true
    iceMesh.instanceMatrix.needsUpdate = true
    waterTopMesh.instanceMatrix.needsUpdate = true
    waterNorthMesh.instanceMatrix.needsUpdate = true
    waterSouthMesh.instanceMatrix.needsUpdate = true
    waterWestMesh.instanceMatrix.needsUpdate = true
    waterEastMesh.instanceMatrix.needsUpdate = true
    dirtTopCapMesh.instanceMatrix.needsUpdate = true

    return chunkGroup
  }

  private shouldRenderDirtGrassTopCap(
    worldX: number,
    y: number,
    worldZ: number,
    block: BlockId,
    exposed: boolean,
  ): boolean {
    if (!exposed) {
      return false
    }

    if (block === BlockId.Grass) {
      return true
    }

    if (block !== BlockId.Dirt) {
      return false
    }

    return this.dirtGreenGrown.has(toBlockKey(worldX, y, worldZ))
  }

  private syncDirtGrassGrowthState(
    worldX: number,
    y: number,
    worldZ: number,
    block: BlockId,
    exposed: boolean,
  ): void {
    const key = toBlockKey(worldX, y, worldZ)

    if (block !== BlockId.Dirt || !exposed) {
      this.dirtGreenReadyAt.delete(key)
      this.dirtGreenGrown.delete(key)
      return
    }

    if (this.dirtGreenGrown.has(key) || this.dirtGreenReadyAt.has(key)) {
      return
    }

    const isNaturalSurface = y === getHeightAt(worldX, worldZ)
    if (isNaturalSurface) {
      this.dirtGreenGrown.add(key)
      return
    }

    const delay = DIRT_GREEN_MIN_DELAY_MS + Math.random() * (DIRT_GREEN_MAX_DELAY_MS - DIRT_GREEN_MIN_DELAY_MS)
    this.dirtGreenReadyAt.set(key, Date.now() + delay)
  }

  private clearDirtGrassTrackingAt(worldX: number, y: number, worldZ: number): void {
    const key = toBlockKey(worldX, y, worldZ)
    this.dirtGreenReadyAt.delete(key)
    this.dirtGreenGrown.delete(key)
  }

  private clearDirtGrassTrackingForChunkKey(chunkKey: string): void {
    const [chunkXRaw, chunkZRaw] = chunkKey.split(':')
    const chunkX = Number(chunkXRaw)
    const chunkZ = Number(chunkZRaw)

    if (!Number.isInteger(chunkX) || !Number.isInteger(chunkZ)) {
      return
    }

    for (const key of this.dirtGreenReadyAt.keys()) {
      const position = parseBlockKey(key)
      if (!position) {
        continue
      }

      if (Math.floor(position.x / CHUNK_SIZE) === chunkX && Math.floor(position.z / CHUNK_SIZE) === chunkZ) {
        this.dirtGreenReadyAt.delete(key)
      }
    }

    for (const key of this.dirtGreenGrown) {
      const position = parseBlockKey(key)
      if (!position) {
        continue
      }

      if (Math.floor(position.x / CHUNK_SIZE) === chunkX && Math.floor(position.z / CHUNK_SIZE) === chunkZ) {
        this.dirtGreenGrown.delete(key)
      }
    }
  }

  private processGrassGrowth(nowMs: number): void {
    for (const [key, readyAt] of this.dirtGreenReadyAt.entries()) {
      if (readyAt > nowMs) {
        continue
      }

      const position = parseBlockKey(key)
      if (!position) {
        this.dirtGreenReadyAt.delete(key)
        continue
      }

      const { x, y, z } = position
      const block = this.getLoadedBlock(x, y, z)
      const isExposed = this.getBlockAtWorld(x, y + 1, z) === BlockId.Air

      if (block === BlockId.Dirt && isExposed) {
        this.dirtGreenGrown.add(key)
        this.growthDirtyChunkKeys.add(toChunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)))
      }

      this.dirtGreenReadyAt.delete(key)
    }

    let rebuilt = 0
    for (const chunkKey of this.growthDirtyChunkKeys) {
      const record = this.chunks.get(chunkKey)
      if (!record) {
        this.growthDirtyChunkKeys.delete(chunkKey)
        continue
      }

      this.root.remove(record.object)
      disposeObject(record.object)

      const rebuiltObject = this.buildChunkMesh(record.data)
      this.root.add(rebuiltObject)
      record.object = rebuiltObject
      this.chunks.set(chunkKey, record)
      this.growthDirtyChunkKeys.delete(chunkKey)

      rebuilt += 1
      if (rebuilt >= MAX_GRASS_GROWTH_REBUILDS_PER_UPDATE) {
        break
      }
    }
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
    const expectedByteLength = CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE

    if (saved && saved.byteLength === expectedByteLength) {
      data.loadFromBuffer(saved)
    } else {
      data.loadFromBuffer(blocks)

      if (saved && saved.byteLength !== expectedByteLength) {
        this.savedChunks.delete(key)
      }
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
    this.clearDirtGrassTrackingAt(worldX, y, worldZ)
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

  private isBlockExposed(worldX: number, y: number, worldZ: number, sourceChunk: ChunkData, block: BlockId): boolean {
    if (block === BlockId.Water) {
      return (
        this.getBlockAtForMeshing(worldX + 1, y, worldZ, sourceChunk) === BlockId.Air ||
        this.getBlockAtForMeshing(worldX - 1, y, worldZ, sourceChunk) === BlockId.Air ||
        this.getBlockAtForMeshing(worldX, y + 1, worldZ, sourceChunk) === BlockId.Air ||
        this.getBlockAtForMeshing(worldX, y - 1, worldZ, sourceChunk) === BlockId.Air ||
        this.getBlockAtForMeshing(worldX, y, worldZ + 1, sourceChunk) === BlockId.Air ||
        this.getBlockAtForMeshing(worldX, y, worldZ - 1, sourceChunk) === BlockId.Air
      )
    }

    return (
      !this.isSolidAtForMeshing(worldX + 1, y, worldZ, sourceChunk) ||
      !this.isSolidAtForMeshing(worldX - 1, y, worldZ, sourceChunk) ||
      !this.isSolidAtForMeshing(worldX, y + 1, worldZ, sourceChunk) ||
      !this.isSolidAtForMeshing(worldX, y - 1, worldZ, sourceChunk) ||
      !this.isSolidAtForMeshing(worldX, y, worldZ + 1, sourceChunk) ||
      !this.isSolidAtForMeshing(worldX, y, worldZ - 1, sourceChunk)
    )
  }

  private getBlockAtWorld(worldX: number, y: number, worldZ: number): BlockId {
    if (y < 0) {
      return BlockId.Stone
    }

    if (y >= CHUNK_HEIGHT) {
      return BlockId.Air
    }

    const chunkX = Math.floor(worldX / CHUNK_SIZE)
    const chunkZ = Math.floor(worldZ / CHUNK_SIZE)
    const record = this.chunks.get(toChunkKey(chunkX, chunkZ))

    if (record) {
      const localX = worldX - chunkX * CHUNK_SIZE
      const localZ = worldZ - chunkZ * CHUNK_SIZE
      return record.data.get(localX, y, localZ)
    }

    const height = getHeightAt(worldX, worldZ)
    if (y <= height) {
      if (y === height) {
        return terrainTopBlockAt(worldX, worldZ, height)
      }

      return terrainSubsurfaceAt(worldX, worldZ, y, height)
    }

    if (y <= SEA_LEVEL) {
      return y === SEA_LEVEL && terrainIsColdAt(worldX, worldZ) ? BlockId.Ice : BlockId.Water
    }

    return BlockId.Air
  }

  private getBlockAtForMeshing(worldX: number, y: number, worldZ: number, sourceChunk: ChunkData): BlockId {
    if (y < 0) {
      return BlockId.Stone
    }

    if (y >= CHUNK_HEIGHT) {
      return BlockId.Air
    }

    const chunkX = Math.floor(worldX / CHUNK_SIZE)
    const chunkZ = Math.floor(worldZ / CHUNK_SIZE)

    if (chunkX === sourceChunk.chunkX && chunkZ === sourceChunk.chunkZ) {
      const localX = worldX - chunkX * CHUNK_SIZE
      const localZ = worldZ - chunkZ * CHUNK_SIZE
      return sourceChunk.get(localX, y, localZ)
    }

    const neighbor = this.chunks.get(toChunkKey(chunkX, chunkZ))
    if (neighbor) {
      const localX = worldX - chunkX * CHUNK_SIZE
      const localZ = worldZ - chunkZ * CHUNK_SIZE
      return neighbor.data.get(localX, y, localZ)
    }

    return this.getBlockAtWorld(worldX, y, worldZ)
  }

  private isSolidAtForMeshing(worldX: number, y: number, worldZ: number, sourceChunk: ChunkData): boolean {
    const block = this.getBlockAtForMeshing(worldX, y, worldZ, sourceChunk)
    return block !== BlockId.Air && block !== BlockId.Water
  }
}

function createChunkLayerMesh(
  geometry: THREE.BufferGeometry,
  instanceCount: number,
  materialOptions: {
    map?: THREE.Texture
    color?: number
    transparent?: boolean
    opacity?: number
    depthWrite?: boolean
    side?: THREE.Side
    material?: THREE.Material | THREE.Material[]
  } = {},
): THREE.InstancedMesh {
  const material =
    materialOptions.material ??
    new THREE.MeshLambertMaterial({
      color: materialOptions.color ?? 0xffffff,
      map: materialOptions.map,
      transparent: materialOptions.transparent,
      opacity: materialOptions.opacity,
      depthWrite: materialOptions.depthWrite,
      side: materialOptions.side,
    })
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(instanceCount, 1))
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  mesh.castShadow = false
  mesh.receiveShadow = true
  return mesh
}

function materialFromTexture(texture: THREE.Texture): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    map: texture,
  })
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

function toBlockKey(worldX: number, y: number, worldZ: number): string {
  return `${worldX}:${y}:${worldZ}`
}

function parseBlockKey(key: string): { x: number; y: number; z: number } | null {
  const [xRaw, yRaw, zRaw] = key.split(':')
  const x = Number(xRaw)
  const y = Number(yRaw)
  const z = Number(zRaw)

  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) {
    return null
  }

  return { x, y, z }
}

function getHeightAt(worldX: number, worldZ: number): number {
  return terrainHeightAt(worldX, worldZ)
}
