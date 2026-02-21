const DB_NAME = 'minecraft-web-world'
const DB_VERSION = 1
const CHUNK_STORE = 'chunks'

type ChunkRecord = {
  key: string
  chunkX: number
  chunkZ: number
  blocks: ArrayBuffer
  updatedAt: number
}

export class WorldStorage {
  private dbPromise: Promise<IDBDatabase> | null = null

  async loadAllChunks(): Promise<Map<string, ArrayBuffer>> {
    const db = await this.getDb()
    const transaction = db.transaction(CHUNK_STORE, 'readonly')
    const store = transaction.objectStore(CHUNK_STORE)
    const chunks = new Map<string, ArrayBuffer>()

    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor()

      request.onerror = () => {
        reject(request.error ?? new Error('Failed to read saved chunks.'))
      }

      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve()
          return
        }

        const value = cursor.value as ChunkRecord
        chunks.set(value.key, value.blocks.slice(0))
        cursor.continue()
      }
    })

    return chunks
  }

  async saveChunk(chunkX: number, chunkZ: number, blocks: ArrayBuffer): Promise<void> {
    const db = await this.getDb()
    const key = `${chunkX}:${chunkZ}`

    const record: ChunkRecord = {
      key,
      chunkX,
      chunkZ,
      blocks: blocks.slice(0),
      updatedAt: Date.now(),
    }

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(CHUNK_STORE, 'readwrite')
      const store = transaction.objectStore(CHUNK_STORE)
      const request = store.put(record)

      request.onerror = () => {
        reject(request.error ?? new Error('Failed to save chunk data.'))
      }

      transaction.oncomplete = () => {
        resolve()
      }

      transaction.onerror = () => {
        reject(transaction.error ?? new Error('Chunk save transaction failed.'))
      }
    })
  }

  private async getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)

        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(CHUNK_STORE)) {
            db.createObjectStore(CHUNK_STORE, { keyPath: 'key' })
          }
        }

        request.onsuccess = () => {
          resolve(request.result)
        }

        request.onerror = () => {
          reject(request.error ?? new Error('Failed to open world storage.'))
        }
      })
    }

    return this.dbPromise
  }
}
