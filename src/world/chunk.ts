export const CHUNK_SIZE = 16
export const CHUNK_HEIGHT = 48
export const SEA_LEVEL = 7

export const BlockId = {
  Air: 0,
  Grass: 1,
  Dirt: 2,
  Stone: 3,
  Log: 4,
  Wood: 4,
  Leaves: 5,
  Water: 6,
  Sand: 7,
  Snow: 8,
  Ice: 9,
  SwampGrass: 10,
  SwampLog: 11,
  SwampLeaves: 12,
  Cactus: 13,
  SwampReed: 14,
} as const

export type BlockId = (typeof BlockId)[keyof typeof BlockId]

export type GenerateChunkRequest = {
  type: 'generate'
  chunkX: number
  chunkZ: number
}

export type GenerateChunkResponse = {
  type: 'generated'
  chunkX: number
  chunkZ: number
  blocks: ArrayBuffer
}

export class ChunkData {
  readonly chunkX: number
  readonly chunkZ: number
  readonly blocks: Uint8Array

  constructor(chunkX: number, chunkZ: number) {
    this.chunkX = chunkX
    this.chunkZ = chunkZ
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE)
  }

  get(x: number, y: number, z: number): BlockId {
    return this.blocks[this.toIndex(x, y, z)] as BlockId
  }

  set(x: number, y: number, z: number, value: BlockId): void {
    this.blocks[this.toIndex(x, y, z)] = value
  }

  loadFromBuffer(blocks: ArrayBuffer): void {
    this.blocks.set(new Uint8Array(blocks))
  }

  toArrayBuffer(): ArrayBuffer {
    return this.blocks.slice().buffer
  }

  private toIndex(x: number, y: number, z: number): number {
    return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE
  }
}
