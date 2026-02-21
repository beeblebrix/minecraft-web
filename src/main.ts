import * as THREE from 'three'
import './style.css'
import { FirstPersonController } from './player/firstPersonController'
import { BlockId, CHUNK_SIZE } from './world/chunk'
import { ChunkManager } from './world/chunkManager'
import { WorldStorage } from './storage/worldStorage'
import { SimpleMobSystem } from './mobs/simpleMobSystem'
import { SoundSystem } from './audio/soundSystem'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('App root element was not found.')
}

app.innerHTML = `
  <div class="hud" id="hud"></div>
  <div class="overlay" id="overlay">
    <h2>Paused</h2>
    <p>Click to resume</p>
    <p>WASD move, Space jump, Shift sprint</p>
    <p>LMB break, RMB place, 1-3 select block</p>
  </div>
  <div class="crosshair" aria-hidden="true"></div>
  <div class="hotbar" id="hotbar"></div>
`

const hudNode = document.querySelector<HTMLDivElement>('#hud')
const overlayNode = document.querySelector<HTMLDivElement>('#overlay')
const hotbarNode = document.querySelector<HTMLDivElement>('#hotbar')
const crosshairNode = document.querySelector<HTMLDivElement>('.crosshair')

if (!hudNode || !overlayNode || !hotbarNode || !crosshairNode) {
  throw new Error('HUD elements were not created correctly.')
}

const hud = hudNode
const overlay = overlayNode
const hotbar = hotbarNode
const crosshair = crosshairNode

const HOTBAR_SLOTS = [
  { block: BlockId.Grass, label: 'Grass', color: '#64b84c' },
  { block: BlockId.Dirt, label: 'Dirt', color: '#7f5936' },
  { block: BlockId.Stone, label: 'Stone', color: '#746e67' },
] as const

const DAY_LENGTH_SECONDS = 540
const VIEW_DISTANCE_IN_CHUNKS = 5
const FOG_NEAR_DAY = 24
const FOG_FAR_DAY = 110
const FOG_NEAR_NIGHT = 18
const FOG_FAR_NIGHT = 80

let selectedSlotIndex = 1
const inventory = new Map<BlockId, number>([
  [BlockId.Grass, 0],
  [BlockId.Dirt, 0],
  [BlockId.Stone, 0],
])

function clampSlot(index: number): number {
  return Math.max(0, Math.min(HOTBAR_SLOTS.length - 1, index))
}

function selectedBlock(): BlockId {
  return HOTBAR_SLOTS[selectedSlotIndex].block
}

function getInventoryCount(block: BlockId): number {
  return inventory.get(block) ?? 0
}

function addInventory(block: BlockId, amount: number): void {
  const next = Math.max(0, getInventoryCount(block) + amount)
  inventory.set(block, next)
}

function updateHotbar(): void {
  hotbar.innerHTML = HOTBAR_SLOTS.map((slot, index) => {
    const selected = index === selectedSlotIndex
    const selectedClass = selected ? 'slot selected' : 'slot'
    const count = getInventoryCount(slot.block)
    return `<div class="${selectedClass}" data-slot="${index}"><span class="swatch" style="background:${slot.color}"></span><span class="key">${index + 1}</span><span class="name">${slot.label}</span><span class="count">${count}</span></div>`
  }).join('')
}

updateHotbar()

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
app.append(renderer.domElement)

const scene = new THREE.Scene()
const sceneFog = new THREE.Fog(0x8fc9ff, FOG_NEAR_DAY, FOG_FAR_DAY)
scene.fog = sceneFog

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500)

const hemisphereLight = new THREE.HemisphereLight(0xbbe0ff, 0x6a5f4b, 1.1)
scene.add(hemisphereLight)

const sunlight = new THREE.DirectionalLight(0xfff6de, 0.8)
sunlight.position.set(45, 80, 25)
scene.add(sunlight)

const skyDayColor = new THREE.Color(0x8fc9ff)
const skyNightColor = new THREE.Color(0x0d1424)
const skyColor = new THREE.Color()

const fogDayColor = new THREE.Color(0xa8dcff)
const fogNightColor = new THREE.Color(0x101624)
const fogColor = new THREE.Color()

const sunDayColor = new THREE.Color(0xfff6de)
const sunTwilightColor = new THREE.Color(0xffb576)

let timeOfDay = 0.25
let playerHealth = 100
let mobStats = { total: 0, alive: 0, chasing: 0, attacks: 0 }
let playerAttackCooldown = 0
let wasGrounded = false

const soundSystem = new SoundSystem()
soundSystem.bindUnlockEvents()

const storage = new WorldStorage()
let savedChunks = new Map<string, ArrayBuffer>()

try {
  savedChunks = await storage.loadAllChunks()
} catch {
  savedChunks = new Map<string, ArrayBuffer>()
}

const chunkManager = new ChunkManager(VIEW_DISTANCE_IN_CHUNKS, {
  savedChunks,
  onChunkChanged: async (chunkX, chunkZ, blocks) => {
    await storage.saveChunk(chunkX, chunkZ, blocks)
  },
})
scene.add(chunkManager.root)

const mobSystem = new SimpleMobSystem(chunkManager)
scene.add(mobSystem.root)

const blockHighlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
  new THREE.LineBasicMaterial({ color: 0xffe7a1 }),
)
blockHighlight.visible = false
scene.add(blockHighlight)

const controller = new FirstPersonController(camera, renderer.domElement, chunkManager)
const spawnHeight = chunkManager.getSurfaceHeight(0, 0)
controller.setPosition(0, spawnHeight + 2, 0)

const clock = new THREE.Clock()
const lookDirection = new THREE.Vector3()

window.addEventListener('contextmenu', (event) => {
  event.preventDefault()
})

window.addEventListener('keydown', (event) => {
  if (event.code === 'Digit1' || event.code === 'Digit2' || event.code === 'Digit3') {
    selectedSlotIndex = clampSlot(Number(event.code.at(-1)) - 1)
    updateHotbar()
  }
})

window.addEventListener(
  'wheel',
  (event) => {
    if (!controller.isPointerLocked) {
      return
    }

    const direction = event.deltaY > 0 ? 1 : -1
    selectedSlotIndex = clampSlot(selectedSlotIndex + direction)
    updateHotbar()
  },
  { passive: true },
)

window.addEventListener('mousedown', (event) => {
  if (!controller.isPointerLocked) {
    return
  }

  camera.getWorldDirection(lookDirection)
  const targetedBlock = chunkManager.raycastBlock(camera.position, lookDirection, 8)

  if (!targetedBlock) {
    return
  }

  if (event.button === 0) {
    let attackedMob = false

    if (playerAttackCooldown <= 0) {
      const attackResult = mobSystem.attackFromRay(camera.position, lookDirection, 4.5)
      attackedMob = attackResult.hit

      if (attackResult.hit) {
        soundSystem.playMobHit()
      }

      if (attackResult.killed) {
        soundSystem.playMobDeath()
      }

      if (attackResult.hit) {
        playerAttackCooldown = 0.28
      }
    }

    if (attackedMob) {
      return
    }

    const broken = chunkManager.breakBlock(targetedBlock.x, targetedBlock.y, targetedBlock.z)
    if (broken !== null && broken !== BlockId.Air) {
      addInventory(broken, 1)
      updateHotbar()
      soundSystem.playBlockBreak()
    }
  } else if (event.button === 2) {
    const placeX = targetedBlock.x + targetedBlock.normalX
    const placeY = targetedBlock.y + targetedBlock.normalY
    const placeZ = targetedBlock.z + targetedBlock.normalZ

    const blockToPlace = selectedBlock()
    if (getInventoryCount(blockToPlace) <= 0) {
      return
    }

    if (!controller.intersectsBlock(placeX, placeY, placeZ)) {
      const placed = chunkManager.placeBlock(placeX, placeY, placeZ, blockToPlace)
      if (placed) {
        addInventory(blockToPlace, -1)
        updateHotbar()
        soundSystem.playBlockPlace()
      }
    }
  }
})

function updateHud() {
  const position = controller.position
  const lockHint = controller.isPointerLocked ? 'Captured' : 'Free'
  const currentChunk = chunkManager.getCurrentChunk()
  const loadedChunks = chunkManager.getLoadedChunkCount()
  const pendingChunks = chunkManager.getPendingChunkCount()
  const savedChunkCount = chunkManager.getSavedChunkCount()
  const slot = HOTBAR_SLOTS[selectedSlotIndex]
  const hour24 = Math.floor(timeOfDay * 24)
  const minute = Math.floor((timeOfDay * 24 - hour24) * 60)
  const timeText = `${hour24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`

  camera.getWorldDirection(lookDirection)
  const targetedBlock = chunkManager.raycastBlock(camera.position, lookDirection, 8)

  if (targetedBlock) {
    blockHighlight.position.set(targetedBlock.x + 0.5, targetedBlock.y + 0.5, targetedBlock.z + 0.5)
    blockHighlight.visible = true
  } else {
    blockHighlight.visible = false
  }

  const targetText = targetedBlock
    ? `Target x:${targetedBlock.x} y:${targetedBlock.y} z:${targetedBlock.z}`
    : 'Target none'

  hud.innerHTML = [
    'Milestone 2 complete: worker chunk streaming',
    'Milestone 3 complete: target + break/place',
    'Milestone 4 complete: save/load edited chunks',
    'Milestone 5 complete: hotbar + pause menu',
    'Milestone 6 in progress: lighting + simple mobs',
    `Position x:${position.x.toFixed(1)} y:${position.y.toFixed(1)} z:${position.z.toFixed(1)}`,
    `Chunk x:${currentChunk.x} z:${currentChunk.z} | Loaded: ${loadedChunks} | Pending: ${pendingChunks} | Saved: ${savedChunkCount} | Chunk size: ${CHUNK_SIZE}`,
    `Time of day: ${timeText}`,
    `Health: ${Math.floor(playerHealth)} | Mobs: ${mobStats.alive}/${mobStats.total} | Chasing: ${mobStats.chasing}`,
    `Selected block: ${slot.label} (${selectedSlotIndex + 1}) | Count: ${getInventoryCount(slot.block)}`,
    targetText,
    `Pointer ${lockHint} | WASD move | Space jump | Shift sprint | LMB attack/break | RMB place | Wheel/1-3 select | Esc release`,
  ].join('<br/>')
}

function updateLighting(delta: number): void {
  timeOfDay = (timeOfDay + delta / DAY_LENGTH_SECONDS) % 1

  const sunAngle = timeOfDay * Math.PI * 2
  const sunElevation = Math.sin(sunAngle)
  const dayFactor = THREE.MathUtils.smoothstep(sunElevation, -0.18, 0.35)
  const twilightFactor = THREE.MathUtils.smoothstep(sunElevation, -0.05, 0.25) - dayFactor

  skyColor.lerpColors(skyNightColor, skyDayColor, dayFactor)
  fogColor.lerpColors(fogNightColor, fogDayColor, dayFactor)
  renderer.setClearColor(skyColor)
  sceneFog.color.copy(fogColor)
  sceneFog.near = THREE.MathUtils.lerp(FOG_NEAR_NIGHT, FOG_NEAR_DAY, dayFactor)
  sceneFog.far = THREE.MathUtils.lerp(FOG_FAR_NIGHT, FOG_FAR_DAY, dayFactor)

  hemisphereLight.intensity = 0.15 + dayFactor * 0.95
  hemisphereLight.color.copy(skyColor)
  hemisphereLight.groundColor.setRGB(0.2 + dayFactor * 0.25, 0.18 + dayFactor * 0.2, 0.18 + dayFactor * 0.12)

  sunlight.intensity = 0.05 + Math.max(0, sunElevation) * 1.1 + twilightFactor * 0.25
  sunlight.color.lerpColors(sunTwilightColor, sunDayColor, dayFactor)

  const azimuth = sunAngle * 0.35
  const radius = 140
  sunlight.position.set(
    Math.cos(azimuth) * radius,
    18 + sunElevation * 90,
    Math.sin(azimuth) * radius,
  )
}

function renderLoop() {
  const delta = Math.min(clock.getDelta(), 0.05)
  controller.update(delta)
  chunkManager.update(controller.position)
  playerAttackCooldown = Math.max(0, playerAttackCooldown - delta)

  if (controller.isPointerLocked) {
    soundSystem.updateMovement(delta, controller.isMovingOnGround)
  }

  if (controller.isPointerLocked) {
    updateLighting(delta)
    mobStats = mobSystem.update(delta, controller.position)

    if (mobStats.attacks > 0) {
      playerHealth = Math.max(0, playerHealth - mobStats.attacks * 4)
      soundSystem.playPlayerHurt()
    }
  } else {
    mobStats = { ...mobStats, attacks: 0 }
  }

  if (!wasGrounded && controller.isGrounded) {
    soundSystem.playLanding()
  }
  wasGrounded = controller.isGrounded

  overlay.style.display = controller.isPointerLocked ? 'none' : 'block'
  crosshair.style.display = controller.isPointerLocked ? 'block' : 'none'
  updateHud()

  renderer.render(scene, camera)
  requestAnimationFrame(renderLoop)
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

window.addEventListener('beforeunload', () => {
  mobSystem.dispose()
  chunkManager.dispose()
})

renderLoop()
