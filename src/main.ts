import * as THREE from 'three'
import './style.css'
import { FirstPersonController } from './player/firstPersonController'
import { BlockId, CHUNK_SIZE } from './world/chunk'
import { ChunkManager } from './world/chunkManager'
import { WorldStorage } from './storage/worldStorage'
import { GooeyMobSystem } from './mobs/simpleMobSystem'
import { SoundSystem } from './audio/soundSystem'
import { getBiomeAt } from './world/terrainMath'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('App root element was not found.')
}

app.innerHTML = `
  <div class="debug-hint" id="debug-hint">F3: Show Debug</div>
  <div class="time-debug" id="time-debug">
    <div class="time-debug-row">
      <label for="time-slider">Time of day</label>
      <span id="time-label">06:00</span>
    </div>
    <input id="time-slider" type="range" min="0" max="1" step="0.001" value="0.25" />
    <label class="time-freeze">
      <input id="time-freeze" type="checkbox" />
      Freeze cycle
    </label>
  </div>
  <div class="hud" id="hud"></div>
  <div class="overlay" id="overlay">
    <div class="overlay-panel">
      <h2>Paused</h2>
      <p>Click anywhere or press Esc to resume</p>
      <p>WASD move, Space jump, Shift sprint</p>
      <p>LMB break, RMB place, 1-3 select block</p>
    </div>
  </div>
  <div class="crosshair" aria-hidden="true"></div>
  <div class="sun-haze" id="sun-haze" aria-hidden="true"></div>
  <div class="moon-haze" id="moon-haze" aria-hidden="true"></div>
  <div class="underwater-filter" id="underwater-filter" aria-hidden="true"></div>
  <div class="hotbar" id="hotbar"></div>
  <div class="inventory-screen" id="inventory-screen">
    <div class="inventory-panel">
      <h2>Inventory & Crafting</h2>
      <p>Press E to close</p>
      <div class="craft-grid" id="craft-grid"></div>
      <div class="craft-row">
        <button class="craft-btn" id="craft-btn" type="button">Craft</button>
        <div class="craft-result" id="craft-result">No recipe</div>
        <div class="craft-output empty" id="craft-output">?</div>
      </div>
      <h3 class="inventory-title">Inventory</h3>
      <div class="inventory-grid" id="inventory-grid"></div>
      <p class="inventory-help">Drag items from inventory into crafting cells</p>
      <div class="recipe-list">Recipes: 4 Dirt -> 1 Stone | 2 Log -> 1 Stone</div>
    </div>
  </div>
`

const hudNode = document.querySelector<HTMLDivElement>('#hud')
const debugHintNode = document.querySelector<HTMLDivElement>('#debug-hint')
const timeDebugNode = document.querySelector<HTMLDivElement>('#time-debug')
const timeSliderNode = document.querySelector<HTMLInputElement>('#time-slider')
const timeLabelNode = document.querySelector<HTMLSpanElement>('#time-label')
const timeFreezeNode = document.querySelector<HTMLInputElement>('#time-freeze')
const overlayNode = document.querySelector<HTMLDivElement>('#overlay')
const hotbarNode = document.querySelector<HTMLDivElement>('#hotbar')
const crosshairNode = document.querySelector<HTMLDivElement>('.crosshair')
const sunHazeNode = document.querySelector<HTMLDivElement>('#sun-haze')
const moonHazeNode = document.querySelector<HTMLDivElement>('#moon-haze')
const underwaterFilterNode = document.querySelector<HTMLDivElement>('#underwater-filter')
const inventoryScreenNode = document.querySelector<HTMLDivElement>('#inventory-screen')
const craftGridNode = document.querySelector<HTMLDivElement>('#craft-grid')
const craftButtonNode = document.querySelector<HTMLButtonElement>('#craft-btn')
const craftResultNode = document.querySelector<HTMLDivElement>('#craft-result')
const craftOutputNode = document.querySelector<HTMLDivElement>('#craft-output')
const inventoryGridNode = document.querySelector<HTMLDivElement>('#inventory-grid')

if (
  !hudNode ||
  !debugHintNode ||
  !timeDebugNode ||
  !timeSliderNode ||
  !timeLabelNode ||
  !timeFreezeNode ||
  !overlayNode ||
  !hotbarNode ||
  !crosshairNode ||
  !sunHazeNode ||
  !moonHazeNode ||
  !underwaterFilterNode ||
  !inventoryScreenNode ||
  !craftGridNode ||
  !craftButtonNode ||
  !craftResultNode ||
  !craftOutputNode ||
  !inventoryGridNode
) {
  throw new Error('HUD elements were not created correctly.')
}

const hud = hudNode
const debugHint = debugHintNode
const timeDebug = timeDebugNode
const timeSlider = timeSliderNode
const timeLabel = timeLabelNode
const timeFreeze = timeFreezeNode
const overlay = overlayNode
const hotbar = hotbarNode
const crosshair = crosshairNode
const sunHaze = sunHazeNode
const moonHaze = moonHazeNode
const underwaterFilter = underwaterFilterNode
const inventoryScreen = inventoryScreenNode
const craftGrid = craftGridNode
const craftButton = craftButtonNode
const craftResult = craftResultNode
const craftOutput = craftOutputNode
const inventoryGrid = inventoryGridNode

const HOTBAR_SLOTS = [
  { block: BlockId.Dirt, label: 'Dirt', color: '#7f5936' },
  { block: BlockId.Stone, label: 'Stone', color: '#746e67' },
  { block: BlockId.Log, label: 'Log', color: '#8a623d' },
] as const

type CraftRecipe = {
  input: Partial<Record<BlockId, number>>
  output: { block: BlockId; amount: number }
  label: string
}

const DAY_LENGTH_SECONDS = 540
const VIEW_DISTANCE_IN_CHUNKS = 5
const FOG_NEAR_DAY = 24
const FOG_FAR_DAY = 110
const FOG_NEAR_NIGHT = 18
const FOG_FAR_NIGHT = 80
const HEIGHT_HAZE_TOP = 40
const HEIGHT_HAZE_BOTTOM = -4
const SHADOW_RANGE = 52
const SKY_BODY_DISTANCE = 185
const PLAYER_MAX_HEALTH = 100
const PLAYER_HURT_COOLDOWN = 0.75
const PLAYER_RESPAWN_SECONDS = 2.5

let selectedSlotIndex = 0
let debugHudVisible = false
let inventoryOpen = false
let draggedSource: { kind: 'inventory'; block: BlockId } | { kind: 'craft'; index: number; block: BlockId } | null =
  null
let inventorySaveTimer: ReturnType<typeof setTimeout> | null = null
const inventory = new Map<BlockId, number>([
  [BlockId.Dirt, 0],
  [BlockId.Stone, 0],
  [BlockId.Log, 0],
])
const craftCells: Array<BlockId | null> = [null, null, null, null]
const craftRecipes: CraftRecipe[] = [
  {
    input: { [BlockId.Dirt]: 4 },
    output: { block: BlockId.Stone, amount: 1 },
    label: '4 Dirt -> 1 Stone',
  },
  {
    input: { [BlockId.Log]: 2 },
    output: { block: BlockId.Stone, amount: 1 },
    label: '2 Log -> 1 Stone',
  },
]

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
  renderInventoryGrid()
  queueInventorySave()
}

function clearInventory(): void {
  for (const slot of HOTBAR_SLOTS) {
    inventory.set(slot.block, 0)
  }
  updateHotbar()
  renderInventoryGrid()
  queueInventorySave()
}

function inventorySnapshot(): Record<string, number> {
  const data: Record<string, number> = {}
  for (const slot of HOTBAR_SLOTS) {
    data[String(slot.block)] = getInventoryCount(slot.block)
  }
  return data
}

function queueInventorySave(): void {
  if (!storageReady) {
    return
  }

  if (inventorySaveTimer) {
    clearTimeout(inventorySaveTimer)
  }

  inventorySaveTimer = setTimeout(() => {
    inventorySaveTimer = null
    void storage.saveInventory(inventorySnapshot()).catch(() => {
    })
  }, 120)
}

function clearCraftGrid(): void {
  for (let i = 0; i < craftCells.length; i += 1) {
    const cell = craftCells[i]
    if (cell !== null) {
      addInventory(cell, 1)
      craftCells[i] = null
    }
  }
  draggedSource = null
  updateHotbar()
  renderCraftGrid()
}

function setInventoryOpen(nextOpen: boolean): void {
  inventoryOpen = nextOpen
  inventoryScreen.style.display = inventoryOpen ? 'grid' : 'none'

  renderInventoryGrid()
  renderCraftGrid()

  if (!inventoryOpen) {
    craftResult.textContent = 'No recipe'
  }
}

function countCraftIngredients(): Partial<Record<BlockId, number>> {
  const counts: Partial<Record<BlockId, number>> = {}
  for (const cell of craftCells) {
    if (cell === null) {
      continue
    }
    counts[cell] = (counts[cell] ?? 0) + 1
  }
  return counts
}

function findCraftRecipe(): CraftRecipe | null {
  const counts = countCraftIngredients()

  for (const recipe of craftRecipes) {
    let matches = true

    for (const slot of HOTBAR_SLOTS) {
      const block = slot.block
      const need = recipe.input[block] ?? 0
      const have = counts[block] ?? 0
      if (need !== have) {
        matches = false
        break
      }
    }

    if (matches) {
      return recipe
    }
  }

  return null
}

function renderCraftGrid(): void {
  craftGrid.innerHTML = craftCells
    .map((cell, index) => {
      if (cell === null) {
        return `<button class="craft-cell empty" data-cell="${index}" type="button">+</button>`
      }

      const slot = HOTBAR_SLOTS.find((entry) => entry.block === cell)
      const label = slot ? slot.label : 'Item'
      const color = slot ? slot.color : '#999'
      return `<button class="craft-cell" style="--cell-color:${color}" data-cell="${index}" type="button" draggable="true">${label}</button>`
    })
    .join('')

  const recipe = findCraftRecipe()
  craftResult.textContent = recipe ? recipe.label : 'No recipe'

  if (recipe) {
    const slot = HOTBAR_SLOTS.find((entry) => entry.block === recipe.output.block)
    const label = slot ? slot.label : 'Item'
    const color = slot ? slot.color : '#888'
    craftOutput.classList.remove('empty')
    craftOutput.style.setProperty('--cell-color', color)
    craftOutput.innerHTML = `${label}<span>x${recipe.output.amount}</span>`
    craftButton.disabled = false
  } else {
    craftOutput.classList.add('empty')
    craftOutput.style.removeProperty('--cell-color')
    craftOutput.textContent = '?'
    craftButton.disabled = true
  }
}

function updateHotbar(): void {
  hotbar.innerHTML = HOTBAR_SLOTS.map((slot, index) => {
    const selected = index === selectedSlotIndex
    const selectedClass = selected ? 'slot selected' : 'slot'
    const count = getInventoryCount(slot.block)
    return `<div class="${selectedClass}" data-slot="${index}"><span class="swatch" style="background:${slot.color}"></span><span class="key">${index + 1}</span><span class="name">${slot.label}</span><span class="count">${count}</span></div>`
  }).join('')
}

function renderInventoryGrid(): void {
  inventoryGrid.innerHTML = HOTBAR_SLOTS.map((slot) => {
    const count = getInventoryCount(slot.block)
    const disabledClass = count > 0 ? '' : ' empty'
    const draggable = count > 0 ? 'true' : 'false'
    return `<button class="inv-slot${disabledClass}" data-block="${slot.block}" type="button" draggable="${draggable}"><span class="swatch" style="background:${slot.color}"></span><span class="name">${slot.label}</span><span class="count">${count}</span></button>`
  }).join('')
}

function setColorDragGhost(event: DragEvent, block: BlockId): void {
  if (!event.dataTransfer) {
    return
  }

  const slot = HOTBAR_SLOTS.find((entry) => entry.block === block)
  const color = slot ? slot.color : '#999'

  const ghost = document.createElement('div')
  ghost.style.width = '22px'
  ghost.style.height = '22px'
  ghost.style.border = '1px solid rgba(0,0,0,0.6)'
  ghost.style.borderRadius = '2px'
  ghost.style.background = color
  ghost.style.boxShadow = '0 1px 4px rgba(0,0,0,0.45)'
  ghost.style.position = 'fixed'
  ghost.style.top = '-9999px'
  ghost.style.left = '-9999px'
  ghost.style.pointerEvents = 'none'

  document.body.append(ghost)
  event.dataTransfer.setDragImage(ghost, 11, 11)

  requestAnimationFrame(() => {
    ghost.remove()
  })
}

updateHotbar()
renderInventoryGrid()
setInventoryOpen(false)
renderCraftGrid()

craftGrid.addEventListener('click', (event) => {
  const target = event.target as HTMLElement
  const button = target.closest<HTMLButtonElement>('[data-cell]')
  if (!button) {
    return
  }

  const index = Number(button.dataset.cell)
  if (!Number.isInteger(index) || index < 0 || index >= craftCells.length) {
    return
  }

  const current = craftCells[index]
  if (current !== null) {
    addInventory(current, 1)
    craftCells[index] = null
    updateHotbar()
    renderCraftGrid()
    return
  }

  const block = selectedBlock()
  if (getInventoryCount(block) <= 0) {
    return
  }

  addInventory(block, -1)
  craftCells[index] = block
  updateHotbar()
  renderCraftGrid()
})

inventoryGrid.addEventListener('dragstart', (event) => {
  const target = event.target as HTMLElement
  const slot = target.closest<HTMLButtonElement>('.inv-slot')
  if (!slot || !event.dataTransfer) {
    return
  }

  const block = Number(slot.dataset.block) as BlockId
  if (getInventoryCount(block) <= 0) {
    event.preventDefault()
    return
  }

  draggedSource = { kind: 'inventory', block }
  event.dataTransfer.effectAllowed = 'move'
  setColorDragGhost(event, block)
})

craftGrid.addEventListener('dragstart', (event) => {
  const target = event.target as HTMLElement
  const cellButton = target.closest<HTMLButtonElement>('[data-cell]')
  if (!cellButton || !event.dataTransfer) {
    return
  }

  const index = Number(cellButton.dataset.cell)
  if (!Number.isInteger(index) || index < 0 || index >= craftCells.length) {
    return
  }

  const block = craftCells[index]
  if (block === null) {
    event.preventDefault()
    return
  }

  draggedSource = { kind: 'craft', index, block }
  event.dataTransfer.effectAllowed = 'move'
  setColorDragGhost(event, block)
})

craftGrid.addEventListener('dragover', (event) => {
  event.preventDefault()
})

craftGrid.addEventListener('drop', (event) => {
  event.preventDefault()

  const target = event.target as HTMLElement
  const cellButton = target.closest<HTMLButtonElement>('[data-cell]')
  if (!cellButton || !draggedSource) {
    draggedSource = null
    return
  }

  const targetIndex = Number(cellButton.dataset.cell)
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= craftCells.length) {
    draggedSource = null
    return
  }

  if (draggedSource.kind === 'inventory') {
    if (craftCells[targetIndex] === null && getInventoryCount(draggedSource.block) > 0) {
      addInventory(draggedSource.block, -1)
      craftCells[targetIndex] = draggedSource.block
      updateHotbar()
      renderCraftGrid()
    }
    draggedSource = null
    return
  }

  if (draggedSource.kind === 'craft') {
    if (draggedSource.index === targetIndex) {
      draggedSource = null
      return
    }

    const movingBlock = draggedSource.block
    const targetBlock = craftCells[targetIndex]
    craftCells[draggedSource.index] = targetBlock
    craftCells[targetIndex] = movingBlock
    renderCraftGrid()
  }

  draggedSource = null
})

inventoryGrid.addEventListener('dragover', (event) => {
  event.preventDefault()
})

inventoryGrid.addEventListener('drop', (event) => {
  event.preventDefault()

  if (!draggedSource) {
    return
  }

  if (draggedSource.kind === 'craft') {
    craftCells[draggedSource.index] = null
    addInventory(draggedSource.block, 1)
    updateHotbar()
    renderCraftGrid()
  }

  draggedSource = null
})

document.addEventListener('dragend', () => {
  draggedSource = null
})

craftButton.addEventListener('click', () => {
  const recipe = findCraftRecipe()
  if (!recipe) {
    return
  }

  craftCells.fill(null)
  addInventory(recipe.output.block, recipe.output.amount)
  updateHotbar()
  renderCraftGrid()
  soundSystem.playBlockPlace()
})

hud.style.display = 'none'

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.NoToneMapping
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
app.append(renderer.domElement)

const scene = new THREE.Scene()
const sceneFog = new THREE.Fog(0x8fc9ff, FOG_NEAR_DAY, FOG_FAR_DAY)
scene.fog = sceneFog

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500)

const hemisphereLight = new THREE.HemisphereLight(0xbbe0ff, 0x6a5f4b, 1.1)
scene.add(hemisphereLight)

const sunlight = new THREE.DirectionalLight(0xfff6de, 0.8)
sunlight.position.set(45, 80, 25)
sunlight.castShadow = true
sunlight.shadow.mapSize.set(2048, 2048)
sunlight.shadow.camera.near = 1
sunlight.shadow.camera.far = 260
sunlight.shadow.camera.left = -SHADOW_RANGE
sunlight.shadow.camera.right = SHADOW_RANGE
sunlight.shadow.camera.top = SHADOW_RANGE
sunlight.shadow.camera.bottom = -SHADOW_RANGE
sunlight.shadow.bias = -0.00014
sunlight.shadow.normalBias = 0.35
sunlight.shadow.radius = 2
scene.add(sunlight.target)
scene.add(sunlight)

const moonlight = new THREE.DirectionalLight(0xb4c9ff, 0.1)
moonlight.position.set(-45, 70, -25)
moonlight.castShadow = true
moonlight.shadow.mapSize.set(1024, 1024)
moonlight.shadow.camera.near = 1
moonlight.shadow.camera.far = 260
moonlight.shadow.camera.left = -SHADOW_RANGE
moonlight.shadow.camera.right = SHADOW_RANGE
moonlight.shadow.camera.top = SHADOW_RANGE
moonlight.shadow.camera.bottom = -SHADOW_RANGE
moonlight.shadow.bias = -0.00016
moonlight.shadow.normalBias = 0.3
moonlight.shadow.radius = 2
scene.add(moonlight.target)
scene.add(moonlight)

const sunDiskMaterial = new THREE.MeshBasicMaterial({
  color: 0xffefb3,
  transparent: true,
  opacity: 1,
  depthWrite: false,
  fog: false,
})
const sunGlowTexture = createSunGlowTexture()
const sunGlowMaterial = new THREE.SpriteMaterial({
  map: sunGlowTexture,
  color: 0xffd98a,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  depthTest: true,
  fog: false,
  blending: THREE.AdditiveBlending,
})
const moonDiskMaterial = new THREE.MeshBasicMaterial({
  color: 0xd4defa,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
  fog: false,
})
const moonGlowTexture = createMoonGlowTexture()
const moonGlowMaterial = new THREE.SpriteMaterial({
  map: moonGlowTexture,
  color: 0xb8cbff,
  transparent: true,
  opacity: 0.24,
  depthWrite: false,
  depthTest: true,
  fog: false,
  blending: THREE.AdditiveBlending,
})
const sunDisk = new THREE.Mesh(new THREE.SphereGeometry(19.5, 22, 22), sunDiskMaterial)
const sunGlow = new THREE.Sprite(sunGlowMaterial)
const moonDisk = new THREE.Mesh(new THREE.SphereGeometry(9.6, 18, 18), moonDiskMaterial)
const moonGlow = new THREE.Sprite(moonGlowMaterial)
sunDisk.frustumCulled = false
sunGlow.frustumCulled = false
moonDisk.frustumCulled = false
moonGlow.frustumCulled = false
sunGlow.scale.set(115, 115, 1)
moonGlow.scale.set(68, 68, 1)
scene.add(sunDisk)
scene.add(sunGlow)
scene.add(moonDisk)
scene.add(moonGlow)

const skyDayColor = new THREE.Color(0x8fc9ff)
const skyNightColor = new THREE.Color(0x0d1424)
const skyColor = new THREE.Color()

const fogDayColor = new THREE.Color(0xa8dcff)
const fogNightColor = new THREE.Color(0x101624)
const fogColor = new THREE.Color()
const lowAltitudeHazeDay = new THREE.Color(0xc5e6cd)
const lowAltitudeHazeNight = new THREE.Color(0x192232)
const lowAltitudeHazeColor = new THREE.Color()
const underwaterFogColor = new THREE.Color(0x2b6ea6)
const sunScreen = new THREE.Vector3()
const moonScreen = new THREE.Vector3()
const sunRayDirection = new THREE.Vector3()
const moonRayDirection = new THREE.Vector3()

let worldFogNear = FOG_NEAR_DAY
let worldFogFar = FOG_FAR_DAY

const sunDayColor = new THREE.Color(0xfff6de)
const sunTwilightColor = new THREE.Color(0xffb576)
const sunDiskDayColor = new THREE.Color(0xfff4dc)
const sunDiskTwilightColor = new THREE.Color(0xff9b66)
const sunGlowDayColor = new THREE.Color(0xffdfa0)
const sunGlowTwilightColor = new THREE.Color(0xff8b52)
const sunRayDayColor = new THREE.Color(0xffecc1)
const sunRayTwilightColor = new THREE.Color(0xffa166)
const sunDiskTint = new THREE.Color()
const sunGlowTint = new THREE.Color()
const sunRayTint = new THREE.Color()
const moonNightColor = new THREE.Color(0xb6cbff)
const moonTwilightColor = new THREE.Color(0x8da4cf)

let timeOfDay = 0.25
let playerHealth = PLAYER_MAX_HEALTH
let mobStats = { total: 0, alive: 0, chasing: 0, attacks: 0 }
let playerAttackCooldown = 0
let playerHurtCooldown = 0
let playerRespawnTimer = 0
let playerRespawnAtMs = 0
let playerDead = false
let gameStarted = false
let mobsEnabled = true
let wasGrounded = false
let lastOverlayStateKey = ''
let sunHazeOpacity = 0
let moonHazeOpacity = 0
let timeCyclePaused = false

const soundSystem = new SoundSystem()
soundSystem.bindUnlockEvents()

const storage = new WorldStorage()
let storageReady = false
let savedChunks = new Map<string, ArrayBuffer>()

try {
  savedChunks = await storage.loadAllChunks()
} catch {
  savedChunks = new Map<string, ArrayBuffer>()
}

try {
  const savedInventory = await storage.loadInventory()
  if (savedInventory) {
    for (const slot of HOTBAR_SLOTS) {
      const raw = savedInventory[String(slot.block)]
      inventory.set(slot.block, Math.max(0, Number.isFinite(raw) ? Math.floor(raw) : 0))
    }
  }
} catch {
}

storageReady = true
updateHotbar()
renderInventoryGrid()
timeDebug.style.display = 'none'
syncTimeDebugControls()

const chunkManager = new ChunkManager(VIEW_DISTANCE_IN_CHUNKS, {
  savedChunks,
  onChunkChanged: async (chunkX, chunkZ, blocks) => {
    await storage.saveChunk(chunkX, chunkZ, blocks)
  },
})
scene.add(chunkManager.root)

const mobSystem = new GooeyMobSystem(chunkManager)
scene.add(mobSystem.root)

const blockHighlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
  new THREE.LineBasicMaterial({ color: 0xffe7a1 }),
)
blockHighlight.visible = false
scene.add(blockHighlight)

const controller = new FirstPersonController(camera, renderer.domElement, chunkManager)
const spawnHeight = chunkManager.getSurfaceHeight(0, 0)
const spawnPoint = new THREE.Vector3(0, spawnHeight + 2, 0)
controller.setPosition(spawnPoint.x, spawnPoint.y, spawnPoint.z)

const clock = new THREE.Clock()
const lookDirection = new THREE.Vector3()

window.addEventListener('contextmenu', (event) => {
  event.preventDefault()
})

function tryResumeFromPause(): void {
  if (!gameStarted || playerDead || inventoryOpen || controller.isPointerLocked) {
    return
  }

  controller.requestPointerLock()
}

overlay.addEventListener('pointerdown', () => {
  if (!gameStarted) {
    return
  }

  tryResumeFromPause()
})

document.addEventListener(
  'pointerdown',
  () => {
    if (!gameStarted) {
      return
    }

    tryResumeFromPause()
  },
  { capture: true },
)

overlay.addEventListener('click', (event) => {
  const target = event.target as HTMLElement
  const modeButton = target.closest<HTMLButtonElement>('[data-start-mode]')
  if (!modeButton || gameStarted) {
    return
  }

  mobsEnabled = modeButton.dataset.startMode === 'mobs'
  gameStarted = true
  controller.requestPointerLock()
})

window.addEventListener('keydown', (event) => {
  if (event.code === 'F3') {
    event.preventDefault()
    debugHudVisible = !debugHudVisible
    hud.style.display = debugHudVisible ? 'block' : 'none'
    updateTimeDebugVisibility()
    debugHint.textContent = debugHudVisible ? 'F3: Hide Debug' : 'F3: Show Debug'
    if (debugHudVisible && !controller.isPointerLocked) {
      syncTimeDebugControls()
    }
    return
  }

  if (event.code === 'KeyE' && !playerDead) {
    event.preventDefault()

    if (inventoryOpen) {
      clearCraftGrid()
      setInventoryOpen(false)
      controller.requestPointerLock()
    } else if (controller.isPointerLocked) {
      setInventoryOpen(true)
      if (document.pointerLockElement) {
        document.exitPointerLock()
      }
    }
    return
  }

  if (!controller.isPointerLocked) {
    return
  }

  if (event.code.startsWith('Digit')) {
    const digit = Number(event.code.slice(5))
    if (Number.isInteger(digit) && digit >= 1 && digit <= HOTBAR_SLOTS.length) {
      selectedSlotIndex = clampSlot(digit - 1)
      updateHotbar()
    }
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
  if (playerDead) {
    return
  }

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
  const lockHint = inventoryOpen ? 'Inventory' : controller.isPointerLocked ? 'Captured' : 'Free'
  const currentChunk = chunkManager.getCurrentChunk()
  const loadedChunks = chunkManager.getLoadedChunkCount()
  const pendingChunks = chunkManager.getPendingChunkCount()
  const savedChunkCount = chunkManager.getSavedChunkCount()
  const slot = HOTBAR_SLOTS[selectedSlotIndex]
  const timeText = formatTimeOfDay(timeOfDay)

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
  const combatStatus = playerDead
    ? `Status: Respawning in ${Math.max(0, Math.ceil(playerRespawnTimer))}s`
    : playerHurtCooldown > 0
      ? `Status: Invulnerable ${(playerHurtCooldown).toFixed(1)}s`
      : 'Status: Ready'
  const modeText = mobsEnabled ? 'With Mobs' : 'Peaceful'
  const biome = getBiomeAt(Math.floor(position.x), Math.floor(position.z))
  const biomeText = biome.charAt(0).toUpperCase() + biome.slice(1)

  hud.innerHTML = [
    'Milestone 2 complete: worker chunk streaming',
    'Milestone 3 complete: target + break/place',
    'Milestone 4 complete: save/load edited chunks',
    'Milestone 5 complete: hotbar + pause menu',
    'Milestone 6 in progress: lighting + gooey mobs',
    `Position x:${position.x.toFixed(1)} y:${position.y.toFixed(1)} z:${position.z.toFixed(1)}`,
    `Chunk x:${currentChunk.x} z:${currentChunk.z} | Loaded: ${loadedChunks} | Pending: ${pendingChunks} | Saved: ${savedChunkCount} | Chunk size: ${CHUNK_SIZE}`,
    `Biome: ${biomeText}`,
    `Time of day: ${timeText}`,
    `Mode: ${modeText}`,
    `Health: ${Math.floor(playerHealth)} | Gooeys: ${mobStats.alive}/${mobStats.total} | Chasing: ${mobStats.chasing}`,
    combatStatus,
    `Selected block: ${slot.label} (${selectedSlotIndex + 1}) | Count: ${getInventoryCount(slot.block)}`,
    targetText,
    `Pointer ${lockHint} | WASD move | Space jump | Shift sprint | LMB attack/break | RMB place | Wheel/1-3 select | E inventory | K test death | Esc toggle pause`,
  ].join('<br/>')
}

function formatTimeOfDay(value: number): string {
  const wrapped = ((value % 1) + 1) % 1
  const hour24 = Math.floor(wrapped * 24)
  const minute = Math.floor((wrapped * 24 - hour24) * 60)
  return `${hour24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}

function toRgbTripletString(color: THREE.Color): string {
  const r = Math.round(THREE.MathUtils.clamp(color.r, 0, 1) * 255)
  const g = Math.round(THREE.MathUtils.clamp(color.g, 0, 1) * 255)
  const b = Math.round(THREE.MathUtils.clamp(color.b, 0, 1) * 255)
  return `${r} ${g} ${b}`
}

function syncTimeDebugControls(): void {
  timeSlider.value = timeOfDay.toFixed(3)
  timeLabel.textContent = formatTimeOfDay(timeOfDay)
  timeFreeze.checked = timeCyclePaused
}

function updateTimeDebugVisibility(): void {
  const showInPause = debugHudVisible && gameStarted && !playerDead && !controller.isPointerLocked && !inventoryOpen
  timeDebug.style.display = showInPause ? 'block' : 'none'
}

function updateOverlay(): void {
  const overlayStateKey = !gameStarted
    ? 'start'
    : playerDead
      ? `dead:${Math.max(0, Math.ceil(playerRespawnTimer))}`
      : 'paused'

  if (overlayStateKey === lastOverlayStateKey) {
    return
  }

  lastOverlayStateKey = overlayStateKey

  if (!gameStarted) {
    overlay.innerHTML = `
      <div class="overlay-panel">
        <h2>Choose Mode</h2>
        <p>Select how you want to play this world</p>
        <div class="mode-row">
          <button class="mode-btn" type="button" data-start-mode="peaceful">Peaceful</button>
          <button class="mode-btn" type="button" data-start-mode="mobs">With Mobs</button>
        </div>
      </div>
    `
    return
  }

  if (playerDead) {
    overlay.innerHTML = `
      <div class="overlay-panel">
        <h2>You Died</h2>
        <p>Respawning in ${Math.max(0, Math.ceil(playerRespawnTimer))}s</p>
        <p>Mobs hit hard. Keep moving and strike first.</p>
      </div>
    `
  } else {
    overlay.innerHTML = `
      <div class="overlay-panel">
        <h2>Paused</h2>
        <p>Click anywhere or press Esc to resume</p>
        <p>Press E to open inventory crafting</p>
        <p>WASD move, Space jump, Shift sprint</p>
        <p>LMB attack/break, RMB place, 1-3 select block</p>
      </div>
    `
  }
}

function respawnPlayer(): void {
  playerDead = false
  playerRespawnTimer = 0
  playerRespawnAtMs = 0
  playerHurtCooldown = 0
  playerHealth = PLAYER_MAX_HEALTH
  const controllerWithReset = controller as FirstPersonController & {
    resetMotion?: () => void
  }
  controllerWithReset.resetMotion?.()
  controller.setPosition(spawnPoint.x, spawnPoint.y, spawnPoint.z)
}

function triggerPlayerDeathForTesting(): void {
  if (playerDead) {
    return
  }

  clearInventory()
  playerHealth = 0
  playerDead = true
  playerRespawnAtMs = performance.now() + PLAYER_RESPAWN_SECONDS * 1000
  playerRespawnTimer = PLAYER_RESPAWN_SECONDS

  if (document.pointerLockElement) {
    document.exitPointerLock()
  }
}

function updateLighting(delta: number): void {
  if (!timeCyclePaused) {
    timeOfDay = (timeOfDay + delta / DAY_LENGTH_SECONDS) % 1
  }

  const sunAngle = timeOfDay * Math.PI * 2
  const sunElevation = Math.sin(sunAngle)
  const dayFactor = THREE.MathUtils.smoothstep(sunElevation, -0.18, 0.35)
  const twilightFactor = THREE.MathUtils.smoothstep(sunElevation, -0.05, 0.25) - dayFactor

  skyColor.lerpColors(skyNightColor, skyDayColor, dayFactor)
  fogColor.lerpColors(fogNightColor, fogDayColor, dayFactor)
  lowAltitudeHazeColor.lerpColors(lowAltitudeHazeNight, lowAltitudeHazeDay, dayFactor)

  const heightProgress = THREE.MathUtils.smoothstep(controller.position.y, HEIGHT_HAZE_BOTTOM, HEIGHT_HAZE_TOP)
  const heightFogFactor = 1 - heightProgress

  renderer.setClearColor(skyColor)
  sceneFog.color.copy(fogColor).lerp(lowAltitudeHazeColor, heightFogFactor * 0.42)
  worldFogNear = THREE.MathUtils.lerp(FOG_NEAR_NIGHT, FOG_NEAR_DAY, dayFactor)
  worldFogFar = THREE.MathUtils.lerp(FOG_FAR_NIGHT, FOG_FAR_DAY, dayFactor)
  sceneFog.near = worldFogNear * THREE.MathUtils.lerp(1, 0.78, heightFogFactor)
  sceneFog.far = worldFogFar * THREE.MathUtils.lerp(1, 0.72, heightFogFactor)

  hemisphereLight.intensity = 0.15 + dayFactor * 0.95
  hemisphereLight.color.copy(skyColor)
  hemisphereLight.groundColor.setRGB(0.2 + dayFactor * 0.25, 0.18 + dayFactor * 0.2, 0.18 + dayFactor * 0.12)

  const moonElevation = -sunElevation
  const moonFactor = THREE.MathUtils.smoothstep(moonElevation, -0.18, 0.35)

  sunlight.intensity = 0.04 + Math.max(0, sunElevation) * 1.05 + twilightFactor * 0.22
  sunlight.color.lerpColors(sunTwilightColor, sunDayColor, dayFactor)
  sunDiskTint.lerpColors(sunDiskTwilightColor, sunDiskDayColor, dayFactor)
  sunGlowTint.lerpColors(sunGlowTwilightColor, sunGlowDayColor, dayFactor)
  sunRayTint.lerpColors(sunRayTwilightColor, sunRayDayColor, dayFactor)
  sunDiskMaterial.color.copy(sunDiskTint)
  sunGlowMaterial.color.copy(sunGlowTint)
  sunHaze.style.setProperty('--sun-core-rgb', toRgbTripletString(sunRayTint))
  sunHaze.style.setProperty('--sun-ray-rgb', toRgbTripletString(sunGlowTint))

  moonlight.intensity = 0.02 + moonFactor * 0.2
  moonlight.color.lerpColors(moonTwilightColor, moonNightColor, moonFactor)

  const azimuth = sunAngle * 0.35
  const radius = 140
  const moonAzimuth = azimuth + Math.PI
  sunlight.position.set(
    controller.position.x + Math.cos(azimuth) * radius,
    18 + sunElevation * 90,
    controller.position.z + Math.sin(azimuth) * radius,
  )
  sunlight.target.position.set(controller.position.x, controller.position.y, controller.position.z)

  moonlight.position.set(
    controller.position.x + Math.cos(moonAzimuth) * radius,
    18 + moonElevation * 90,
    controller.position.z + Math.sin(moonAzimuth) * radius,
  )
  moonlight.target.position.set(controller.position.x, controller.position.y, controller.position.z)

  const shadowBlend = dayFactor >= moonFactor
  sunlight.castShadow = shadowBlend && dayFactor > 0.05
  moonlight.castShadow = !shadowBlend && moonFactor > 0.05

  sunDisk.position.set(
    controller.position.x + Math.cos(azimuth) * SKY_BODY_DISTANCE,
    30 + sunElevation * 120,
    controller.position.z + Math.sin(azimuth) * SKY_BODY_DISTANCE,
  )
  sunGlow.position.copy(sunDisk.position)
  moonDisk.position.set(
    controller.position.x + Math.cos(moonAzimuth) * SKY_BODY_DISTANCE,
    30 + moonElevation * 120,
    controller.position.z + Math.sin(moonAzimuth) * SKY_BODY_DISTANCE,
  )
  moonGlow.position.copy(moonDisk.position)

  sunDisk.visible = sunElevation > -0.24
  sunGlow.visible = sunDisk.visible
  moonDisk.visible = moonElevation > -0.24
  moonGlow.visible = moonDisk.visible
  sunDiskMaterial.opacity = THREE.MathUtils.lerp(0.45, 1, dayFactor)
  sunGlowMaterial.opacity = THREE.MathUtils.lerp(0.08, 0.42, dayFactor)
  moonDiskMaterial.opacity = THREE.MathUtils.lerp(0.35, 0.92, moonFactor)
  moonGlowMaterial.opacity = THREE.MathUtils.lerp(0.06, 0.28, moonFactor)
}

function updateUnderwaterEffects(): void {
  if (controller.isFullySubmerged) {
    sceneFog.color.lerp(underwaterFogColor, 0.7)
    sceneFog.near = Math.min(worldFogNear, 8)
    sceneFog.far = Math.min(worldFogFar, 34)
    underwaterFilter.style.opacity = '0.22'
  } else {
    underwaterFilter.style.opacity = '0'
  }
}

function createSunGlowTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) {
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }

  const center = size / 2
  const gradient = context.createRadialGradient(center, center, 0, center, center, center)
  gradient.addColorStop(0, 'rgba(255, 250, 220, 0.95)')
  gradient.addColorStop(0.18, 'rgba(255, 236, 180, 0.72)')
  gradient.addColorStop(0.45, 'rgba(255, 213, 138, 0.3)')
  gradient.addColorStop(0.78, 'rgba(255, 196, 114, 0.08)')
  gradient.addColorStop(1, 'rgba(255, 196, 114, 0)')

  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function createMoonGlowTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) {
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }

  const center = size / 2
  const gradient = context.createRadialGradient(center, center, 0, center, center, center)
  gradient.addColorStop(0, 'rgba(232, 242, 255, 0.86)')
  gradient.addColorStop(0.2, 'rgba(196, 214, 255, 0.58)')
  gradient.addColorStop(0.48, 'rgba(162, 189, 255, 0.25)')
  gradient.addColorStop(0.78, 'rgba(140, 168, 235, 0.08)')
  gradient.addColorStop(1, 'rgba(140, 168, 235, 0)')

  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function updateSunHaze(): void {
  sunScreen.copy(sunlight.position).project(camera)
  const nearScreen = sunScreen.z > -1 && sunScreen.z < 1 && Math.abs(sunScreen.x) <= 1.6 && Math.abs(sunScreen.y) <= 1.6
  const sunElevation = sunlight.position.y
  const lowSunBoost = 1 - THREE.MathUtils.smoothstep(sunElevation, 10, 56)
  const midDayBase = 1 - THREE.MathUtils.smoothstep(sunElevation, 70, 130)
  const elevationFactor = Math.max(lowSunBoost, midDayBase * 0.45)
  const sunDistance = camera.position.distanceTo(sunDisk.position)
  let sunOccluded = false
  if (sunDistance > 0.001) {
    sunRayDirection.copy(sunDisk.position).sub(camera.position).normalize()
    sunOccluded = chunkManager.raycastBlock(camera.position, sunRayDirection, sunDistance - 2) !== null
  }
  const targetOpacity = nearScreen && !controller.isFullySubmerged && !sunOccluded ? elevationFactor * 0.55 : 0
  sunHazeOpacity = THREE.MathUtils.lerp(sunHazeOpacity, targetOpacity, 0.08)

  const x = THREE.MathUtils.clamp((sunScreen.x * 0.5 + 0.5) * 100, -10, 110)
  const y = THREE.MathUtils.clamp((-sunScreen.y * 0.5 + 0.5) * 100, -10, 110)
  sunHaze.style.setProperty('--sun-x', `${x.toFixed(2)}%`)
  sunHaze.style.setProperty('--sun-y', `${y.toFixed(2)}%`)
  sunHaze.style.opacity = sunHazeOpacity.toFixed(3)
}

function updateMoonHaze(): void {
  moonScreen.copy(moonlight.position).project(camera)
  const nearScreen = moonScreen.z > -1 && moonScreen.z < 1 && Math.abs(moonScreen.x) <= 1.6 && Math.abs(moonScreen.y) <= 1.6
  const moonHeight = moonlight.position.y
  const lowMoonBoost = 1 - THREE.MathUtils.smoothstep(moonHeight, 10, 56)
  const midNightBase = 1 - THREE.MathUtils.smoothstep(moonHeight, 70, 130)
  const elevationFactor = Math.max(lowMoonBoost, midNightBase * 0.38)
  const moonDistance = camera.position.distanceTo(moonDisk.position)
  let moonOccluded = false
  if (moonDistance > 0.001) {
    moonRayDirection.copy(moonDisk.position).sub(camera.position).normalize()
    moonOccluded = chunkManager.raycastBlock(camera.position, moonRayDirection, moonDistance - 2) !== null
  }
  const targetOpacity = nearScreen && !controller.isFullySubmerged && !moonOccluded ? elevationFactor * 0.32 : 0
  moonHazeOpacity = THREE.MathUtils.lerp(moonHazeOpacity, targetOpacity, 0.08)

  const x = THREE.MathUtils.clamp((moonScreen.x * 0.5 + 0.5) * 100, -10, 110)
  const y = THREE.MathUtils.clamp((-moonScreen.y * 0.5 + 0.5) * 100, -10, 110)
  moonHaze.style.setProperty('--moon-x', `${x.toFixed(2)}%`)
  moonHaze.style.setProperty('--moon-y', `${y.toFixed(2)}%`)
  moonHaze.style.opacity = moonHazeOpacity.toFixed(3)
}

timeSlider.addEventListener('input', () => {
  const next = Number(timeSlider.value)
  if (!Number.isFinite(next)) {
    return
  }

  timeOfDay = THREE.MathUtils.euclideanModulo(next, 1)
  updateLighting(0)
  syncTimeDebugControls()
})

timeFreeze.addEventListener('change', () => {
  timeCyclePaused = timeFreeze.checked
  syncTimeDebugControls()
})

function renderLoop() {
  const delta = Math.min(clock.getDelta(), 0.05)
  if (!playerDead) {
    controller.update(delta)
  }
  chunkManager.update(controller.position)
  playerAttackCooldown = Math.max(0, playerAttackCooldown - delta)
  playerHurtCooldown = Math.max(0, playerHurtCooldown - delta)

  if (controller.isPointerLocked) {
    soundSystem.updateMovement(delta, controller.isMovingOnGround)
  }

  if (controller.isPointerLocked) {
    updateLighting(delta)
    if (mobsEnabled) {
      mobStats = mobSystem.update(delta, controller.position)
    } else {
      mobStats = { total: 0, alive: 0, chasing: 0, attacks: 0 }
    }

    if (mobsEnabled && !playerDead && mobStats.attacks > 0 && playerHurtCooldown <= 0) {
      playerHealth = Math.max(0, playerHealth - mobStats.attacks * 4)
      playerHurtCooldown = PLAYER_HURT_COOLDOWN
      soundSystem.playPlayerHurt()

      if (playerHealth <= 0) {
        clearInventory()
        playerDead = true
        playerRespawnAtMs = performance.now() + PLAYER_RESPAWN_SECONDS * 1000
        playerRespawnTimer = PLAYER_RESPAWN_SECONDS
        if (document.pointerLockElement) {
          document.exitPointerLock()
        }
      }
    }
  } else {
    mobStats = mobsEnabled ? { ...mobStats, attacks: 0 } : { total: 0, alive: 0, chasing: 0, attacks: 0 }
  }

  updateUnderwaterEffects()
  updateSunHaze()
  updateMoonHaze()
  if (debugHudVisible) {
    syncTimeDebugControls()
  }

  if (playerDead) {
    playerRespawnTimer = Math.max(0, (playerRespawnAtMs - performance.now()) / 1000)
    if (performance.now() >= playerRespawnAtMs) {
      respawnPlayer()
    }
  }

  if (!wasGrounded && controller.isGrounded) {
    soundSystem.playLanding()
  }
  wasGrounded = controller.isGrounded

  updateOverlay()
  renderer.domElement.style.pointerEvents = playerDead ? 'none' : 'auto'
  overlay.style.display = controller.isPointerLocked || inventoryOpen ? 'none' : 'block'
  inventoryScreen.style.display = inventoryOpen ? 'grid' : 'none'
  crosshair.style.display = controller.isPointerLocked ? 'block' : 'none'
  updateTimeDebugVisibility()
  updateHud()

  renderer.render(scene, camera)
  requestAnimationFrame(renderLoop)
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && !playerDead && !controller.isPointerLocked) {
    tryResumeFromPause()
  }
})

window.addEventListener('keyup', (event) => {
  if (event.code === 'Escape' && !playerDead && !controller.isPointerLocked) {
    tryResumeFromPause()
  }
})

window.addEventListener('keydown', (event) => {
  if (!controller.isPointerLocked) {
    return
  }

  if (event.code === 'KeyK') {
    triggerPlayerDeathForTesting()
  }
})

document.addEventListener('pointerlockchange', () => {
  if (playerDead && document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock()
  }
})

window.addEventListener('beforeunload', () => {
  mobSystem.dispose()
  chunkManager.dispose()
})

renderLoop()
