import * as THREE from 'three'

const SIZE = 16
const GHOST_OPACITY = 0.85
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

function createTextureWithFallback(
  paths: string[],
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

  const loadAt = (index: number): void => {
    if (index >= paths.length) {
      return
    }

    const image = new Image()
    image.src = paths[index]
    image.onload = () => {
      context.clearRect(0, 0, SIZE, SIZE)
      context.imageSmoothingEnabled = false
      context.drawImage(image, 0, 0, SIZE, SIZE)
      texture.needsUpdate = true
    }
    image.onerror = () => {
      loadAt(index + 1)
    }
  }

  loadAt(0)
  return texture
}

function createFaceTexture(paths: string[], seed: number): THREE.Texture {
  return createTextureWithFallback(paths, (x, y) => {
    const n = noise(x, y, seed)
    if (n < 0.15) {
      return '#3e7e37'
    }
    if (n > 0.86) {
      return '#6dc75f'
    }
    return '#57a74a'
  })
}

function createGooTexture(paths: string[]): THREE.Texture {
  return createTextureWithFallback(paths, (x, y) => {
    const n = noise(x, y, 211)
    const ripple = (Math.sin((x + y) * 0.5) + 1) * 0.5

    if (n > 0.9) {
      return '#9fddff'
    }

    if (ripple < 0.2 || n < 0.15) {
      return '#2d72b2'
    }

    return '#4fa8ef'
  })
}

export function createGooeyMaterials(): THREE.MeshLambertMaterial[] {
  const side = createFaceTexture(
    [texturePath('gooey_side.png'), texturePath('mob_side.png'), texturePath('gooey.png'), texturePath('mob.png')],
    91,
  )
  const top = createFaceTexture(
    [texturePath('gooey_top.png'), texturePath('mob_top.png'), texturePath('gooey.png'), texturePath('mob.png')],
    97,
  )
  const bottom = createFaceTexture(
    [
      texturePath('gooey_bottom.png'),
      texturePath('mob_bottom.png'),
      texturePath('gooey_top.png'),
      texturePath('mob_top.png'),
      texturePath('gooey.png'),
      texturePath('mob.png'),
    ],
    103,
  )
  const front = createFaceTexture(
    [texturePath('gooey_front.png'), texturePath('mob_front.png'), texturePath('gooey.png'), texturePath('mob.png')],
    109,
  )
  const back = createFaceTexture(
    [
      texturePath('gooey_back.png'),
      texturePath('mob_back.png'),
      texturePath('gooey_side.png'),
      texturePath('mob_side.png'),
      texturePath('gooey.png'),
      texturePath('mob.png'),
    ],
    113,
  )

  const materialConfig = {
    transparent: true,
    opacity: GHOST_OPACITY,
    alphaTest: 0.08,
    depthWrite: false,
    side: THREE.FrontSide,
  } as const

  return [
    new THREE.MeshLambertMaterial({ map: side, ...materialConfig }),
    new THREE.MeshLambertMaterial({ map: side, ...materialConfig }),
    new THREE.MeshLambertMaterial({ map: top, ...materialConfig }),
    new THREE.MeshLambertMaterial({ map: bottom, ...materialConfig }),
    new THREE.MeshLambertMaterial({ map: front, ...materialConfig }),
    new THREE.MeshLambertMaterial({ map: back, ...materialConfig }),
  ]
}

export function createGooPuddleMaterial(): THREE.MeshLambertMaterial {
  const texture = createGooTexture([texturePath('goo_puddle.png'), texturePath('goo.png')])

  return new THREE.MeshLambertMaterial({
    map: texture,
    transparent: true,
    opacity: 0.78,
    alphaTest: 0.05,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}
