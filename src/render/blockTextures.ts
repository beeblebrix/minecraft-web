import * as THREE from 'three'

type TextureSet = {
  dirt: THREE.Texture
  stone: THREE.Texture
  logSide: THREE.Texture
  logTop: THREE.Texture
  leaves: THREE.Texture
  water: THREE.Texture
  grassTop: THREE.Texture
  sand: THREE.Texture
  snow: THREE.Texture
  ice: THREE.Texture
  swampGrass: THREE.Texture
  swampLogSide: THREE.Texture
  swampLogTop: THREE.Texture
  swampLeaves: THREE.Texture
  cactusSide: THREE.Texture
  cactusTop: THREE.Texture
  swampReed: THREE.Texture
  shrub: THREE.Texture
  tallGrass: THREE.Texture
  sedge: THREE.Texture
}

const SIZE = 16
const TEXTURE_BASE_PATH = `${import.meta.env.BASE_URL}textures/`

function texturePath(filename: string): string {
  return `${TEXTURE_BASE_PATH}${filename}`
}

function noise(x: number, y: number, seed: number): number {
  let value = x * 374761393 + y * 668265263 + seed * 362437
  value = (value ^ (value >>> 13)) * 1274126177
  value ^= value >>> 16
  return (value >>> 0) / 4294967295
}

function createTextureWithExternalOverride(
  path: string,
  drawFallback: (x: number, y: number) => string,
): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Could not create texture canvas context.')
  }

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      context.fillStyle = drawFallback(x, y)
      context.fillRect(x, y, 1, 1)
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestMipmapNearestFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true

  const image = new Image()
  image.src = path
  image.onload = () => {
    context.clearRect(0, 0, SIZE, SIZE)
    context.imageSmoothingEnabled = false
    context.drawImage(image, 0, 0, SIZE, SIZE)
    texture.needsUpdate = true
  }

  return texture
}

export function createBlockTextures(): TextureSet {
  const dirt = createTextureWithExternalOverride(texturePath('dirt.png'), (x, y) => {
    const n = noise(x, y, 11)
    if (n < 0.2) {
      return '#6a4428'
    }
    if (n > 0.82) {
      return '#8f653f'
    }
    return '#7b5633'
  })

  const stone = createTextureWithExternalOverride(texturePath('stone.png'), (x, y) => {
    const n = noise(x, y, 23)
    if (n < 0.15) {
      return '#5f5c59'
    }
    if (n > 0.84) {
      return '#88827b'
    }
    return '#746e67'
  })

  const logSide = createTextureWithExternalOverride(texturePath('log_side.png'), (x, y) => {
    const ring = (Math.sin(x * 0.9) + 1) * 0.5
    const n = noise(x, y, 37)
    if (ring > 0.74 || n > 0.88) {
      return '#9a7449'
    }
    if (ring < 0.22 || n < 0.14) {
      return '#6e4e2e'
    }
    return '#865f3a'
  })

  const logTop = createTextureWithExternalOverride(texturePath('log_top.png'), (x, y) => {
    const cx = x - SIZE / 2 + 0.5
    const cy = y - SIZE / 2 + 0.5
    const distance = Math.hypot(cx, cy)
    const ring = Math.sin(distance * 1.45)
    const n = noise(x, y, 45)

    if (ring > 0.55 || n > 0.9) {
      return '#a77d4d'
    }

    if (ring < -0.4 || n < 0.12) {
      return '#6f4f30'
    }

    return '#8a623d'
  })

  const leaves = createTextureWithExternalOverride(texturePath('leaves.png'), (x, y) => {
    const n = noise(x, y, 51)
    if (n < 0.16) {
      return '#3e7039'
    }
    if (n > 0.82) {
      return '#5ca951'
    }
    return '#4f9447'
  })

  const water = createTextureWithExternalOverride(texturePath('water.png'), (x, y) => {
    const wave = (Math.sin((x + y) * 0.7) + Math.cos((x - y) * 0.5)) * 0.5
    const n = noise(x, y, 67)
    if (wave > 0.45 || n > 0.86) {
      return '#78c3ff'
    }
    if (wave < -0.35 || n < 0.12) {
      return '#2f6fa6'
    }
    return '#4da8ff'
  })

  const grassTop = createTextureWithExternalOverride(texturePath('grass_top.png'), (x, y) => {
    const n = noise(x, y, 79)
    if (n < 0.2) {
      return '#4c8d42'
    }
    if (n > 0.85) {
      return '#74c25b'
    }
    return '#62ad4c'
  })

  const sand = createTextureWithExternalOverride(texturePath('sand.png'), (x, y) => {
    const n = noise(x, y, 131)
    if (n < 0.15) {
      return '#c8b17a'
    }
    if (n > 0.86) {
      return '#e4d39a'
    }
    return '#d8c489'
  })

  const snow = createTextureWithExternalOverride(texturePath('snow.png'), (x, y) => {
    const n = noise(x, y, 149)
    if (n < 0.12) {
      return '#dbe9f4'
    }
    if (n > 0.88) {
      return '#ffffff'
    }
    return '#eef6ff'
  })

  const ice = createTextureWithExternalOverride(texturePath('ice.png'), (x, y) => {
    const n = noise(x, y, 167)
    if (n < 0.2) {
      return '#7dbbe8'
    }
    if (n > 0.86) {
      return '#b8e8ff'
    }
    return '#98d4f3'
  })

  const swampGrass = createTextureWithExternalOverride(texturePath('swamp_grass.png'), (x, y) => {
    const n = noise(x, y, 187)
    if (n < 0.18) {
      return '#4a6035'
    }
    if (n > 0.86) {
      return '#75915a'
    }
    return '#617b46'
  })

  const swampLogSide = createTextureWithExternalOverride(texturePath('swamp_log_side.png'), (x, y) => {
    const band = (Math.sin(x * 0.8) + 1) * 0.5
    const n = noise(x, y, 193)
    if (band > 0.72 || n > 0.88) {
      return '#7e6a45'
    }
    if (band < 0.2 || n < 0.12) {
      return '#4f412c'
    }
    return '#665436'
  })

  const swampLogTop = createTextureWithExternalOverride(texturePath('swamp_log_top.png'), (x, y) => {
    const cx = x - SIZE / 2 + 0.5
    const cy = y - SIZE / 2 + 0.5
    const ring = Math.sin(Math.hypot(cx, cy) * 1.35)
    const n = noise(x, y, 199)
    if (ring > 0.55 || n > 0.9) {
      return '#897351'
    }
    if (ring < -0.4 || n < 0.12) {
      return '#53432f'
    }
    return '#6c593c'
  })

  const swampLeaves = createTextureWithExternalOverride(texturePath('swamp_leaves.png'), (x, y) => {
    const n = noise(x, y, 223)
    if (n < 0.15) {
      return '#4f653e'
    }
    if (n > 0.86) {
      return '#7d9461'
    }
    return '#657e4d'
  })

  const cactusSide = createTextureWithExternalOverride(texturePath('cactus_side.png'), (x, y) => {
    const n = noise(x, y, 241)
    const stripe = Math.sin(x * 1.15)
    if (stripe > 0.72 || n > 0.9) {
      return '#7eb05a'
    }
    if (stripe < -0.6 || n < 0.14) {
      return '#447b35'
    }
    return '#5f9646'
  })

  const cactusTop = createTextureWithExternalOverride(texturePath('cactus_top.png'), (x, y) => {
    const cx = x - SIZE / 2 + 0.5
    const cy = y - SIZE / 2 + 0.5
    const edge = Math.max(Math.abs(cx), Math.abs(cy))
    const n = noise(x, y, 251)
    if (edge > 6.2) {
      return '#3f7133'
    }
    if (n > 0.86) {
      return '#7fb65f'
    }
    return '#5d9848'
  })

  const swampReed = createTextureWithExternalOverride(texturePath('swamp_reed.png'), (x, y) => {
    const n = noise(x, y, 263)
    if (n < 0.2) {
      return '#6b7e49'
    }
    if (n > 0.84) {
      return '#8fa467'
    }
    return '#7c9157'
  })

  const shrub = createTextureWithExternalOverride(texturePath('shrub.png'), (x, y) => {
    const n = noise(x, y, 277)
    if (n < 0.18) {
      return '#2e4f2f'
    }
    if (n > 0.84) {
      return '#456a43'
    }
    return '#3a5d39'
  })

  const tallGrass = createTextureWithExternalOverride(texturePath('tall_grass.png'), (x, y) => {
    const n = noise(x, y, 283)
    if (n < 0.2) {
      return '#4f7e3f'
    }
    if (n > 0.85) {
      return '#79ab59'
    }
    return '#64984b'
  })

  const sedge = createTextureWithExternalOverride(texturePath('sedge.png'), (x, y) => {
    const n = noise(x, y, 293)
    if (n < 0.2) {
      return '#355733'
    }
    if (n > 0.85) {
      return '#52774a'
    }
    return '#44693f'
  })

  return {
    dirt,
    stone,
    logSide,
    logTop,
    leaves,
    water,
    grassTop,
    sand,
    snow,
    ice,
    swampGrass,
    swampLogSide,
    swampLogTop,
    swampLeaves,
    cactusSide,
    cactusTop,
    swampReed,
    shrub,
    tallGrass,
    sedge,
  }
}
