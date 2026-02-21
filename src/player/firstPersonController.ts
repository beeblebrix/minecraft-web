import * as THREE from 'three'
export type WorldCollisionProvider = {
  isSolidBlock: (worldX: number, y: number, worldZ: number) => boolean
}

const LOOK_SPEED = 0.0025
const WALK_SPEED = 6
const SPRINT_SPEED = 10
const JUMP_FORCE = 8
const GRAVITY = 22
const EYE_HEIGHT = 1.7
const PLAYER_HEIGHT = 1.8
const PLAYER_RADIUS = 0.32
const COLLISION_STEP = 0.1
const GROUND_CHECK_EPSILON = 0.06

export class FirstPersonController {
  readonly position = new THREE.Vector3()

  private readonly camera: THREE.PerspectiveCamera
  private readonly domElement: HTMLElement
  private readonly world: WorldCollisionProvider

  private readonly keys = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    jump: false,
  }

  private yaw = 0
  private pitch = 0
  private velocityY = 0
  private grounded = false
  private movingHorizontally = false

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement, world: WorldCollisionProvider) {
    this.camera = camera
    this.domElement = domElement
    this.world = world

    this.camera.rotation.order = 'YXZ'
    this.bindEvents()
  }

  get isPointerLocked(): boolean {
    return document.pointerLockElement === this.domElement
  }

  get isGrounded(): boolean {
    return this.grounded
  }

  get isMovingOnGround(): boolean {
    return this.grounded && this.movingHorizontally
  }

  setPosition(x: number, y: number, z: number): void {
    this.position.set(x, y, z)
    this.camera.position.set(x, y + EYE_HEIGHT, z)
  }

  update(deltaSeconds: number): void {
    this.grounded = this.checkGrounded()

    const moveX = Number(this.keys.right) - Number(this.keys.left)
    const moveZ = Number(this.keys.forward) - Number(this.keys.backward)
    const hasMovementInput = moveX !== 0 || moveZ !== 0

    const speed = this.keys.sprint ? SPRINT_SPEED : WALK_SPEED

    if (hasMovementInput) {
      const inputLength = Math.hypot(moveX, moveZ)
      const localX = moveX / inputLength
      const localZ = moveZ / inputLength

      const sinYaw = Math.sin(this.yaw)
      const cosYaw = Math.cos(this.yaw)

      const worldX = localX * cosYaw - localZ * sinYaw
      const worldZ = -localX * sinYaw - localZ * cosYaw

      this.moveHorizontally(worldX * speed * deltaSeconds, worldZ * speed * deltaSeconds)
    } else {
      this.movingHorizontally = false
    }

    if (this.grounded && this.keys.jump) {
      this.velocityY = JUMP_FORCE
      this.grounded = false
    }

    this.velocityY -= GRAVITY * deltaSeconds
    this.moveVertical(this.velocityY * deltaSeconds)

    this.camera.position.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z)
    this.camera.rotation.y = this.yaw
    this.camera.rotation.x = this.pitch
  }

  intersectsBlock(blockX: number, blockY: number, blockZ: number): boolean {
    const playerMinX = this.position.x - PLAYER_RADIUS
    const playerMaxX = this.position.x + PLAYER_RADIUS
    const playerMinY = this.position.y
    const playerMaxY = this.position.y + PLAYER_HEIGHT
    const playerMinZ = this.position.z - PLAYER_RADIUS
    const playerMaxZ = this.position.z + PLAYER_RADIUS

    const blockMinX = blockX
    const blockMaxX = blockX + 1
    const blockMinY = blockY
    const blockMaxY = blockY + 1
    const blockMinZ = blockZ
    const blockMaxZ = blockZ + 1

    return !(
      playerMaxX <= blockMinX ||
      playerMinX >= blockMaxX ||
      playerMaxY <= blockMinY ||
      playerMinY >= blockMaxY ||
      playerMaxZ <= blockMinZ ||
      playerMinZ >= blockMaxZ
    )
  }

  private moveHorizontally(deltaX: number, deltaZ: number): void {
    const startX = this.position.x
    const startZ = this.position.z

    this.position.x = this.moveAxis(this.position.x, deltaX, (nextX) =>
      this.collidesAt(nextX, this.position.y, this.position.z),
    )
    this.position.z = this.moveAxis(this.position.z, deltaZ, (nextZ) =>
      this.collidesAt(this.position.x, this.position.y, nextZ),
    )

    this.movingHorizontally =
      Math.abs(this.position.x - startX) > 0.0001 || Math.abs(this.position.z - startZ) > 0.0001
  }

  private moveVertical(deltaY: number): void {
    if (deltaY === 0) {
      return
    }

    const direction = Math.sign(deltaY)
    const steps = Math.max(1, Math.ceil(Math.abs(deltaY) / COLLISION_STEP))
    const step = deltaY / steps

    for (let i = 0; i < steps; i += 1) {
      const nextY = this.position.y + step
      if (this.collidesAt(this.position.x, nextY, this.position.z)) {
        if (direction < 0) {
          this.grounded = true
        }
        this.velocityY = 0
        return
      }
      this.position.y = nextY
    }

    if (direction < 0) {
      this.grounded = false
    }
  }

  private moveAxis(
    current: number,
    delta: number,
    collidesAtNext: (next: number) => boolean,
  ): number {
    if (delta === 0) {
      return current
    }

    const steps = Math.max(1, Math.ceil(Math.abs(delta) / COLLISION_STEP))
    const step = delta / steps

    let value = current
    for (let i = 0; i < steps; i += 1) {
      const next = value + step
      if (collidesAtNext(next)) {
        return value
      }
      value = next
    }

    return value
  }

  private checkGrounded(): boolean {
    return this.collidesAt(this.position.x, this.position.y - GROUND_CHECK_EPSILON, this.position.z)
  }

  private collidesAt(positionX: number, positionY: number, positionZ: number): boolean {
    const minX = Math.floor(positionX - PLAYER_RADIUS)
    const maxX = Math.floor(positionX + PLAYER_RADIUS - Number.EPSILON)
    const minY = Math.floor(positionY)
    const maxY = Math.floor(positionY + PLAYER_HEIGHT - Number.EPSILON)
    const minZ = Math.floor(positionZ - PLAYER_RADIUS)
    const maxZ = Math.floor(positionZ + PLAYER_RADIUS - Number.EPSILON)

    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          if (this.world.isSolidBlock(x, y, z)) {
            return true
          }
        }
      }
    }

    return false
  }

  private bindEvents(): void {
    this.domElement.addEventListener('click', () => {
      this.domElement.requestPointerLock()
    })

    window.addEventListener('mousemove', (event) => {
      if (!this.isPointerLocked) {
        return
      }

      this.yaw -= event.movementX * LOOK_SPEED
      this.pitch -= event.movementY * LOOK_SPEED

      const limit = Math.PI / 2 - 0.01
      this.pitch = THREE.MathUtils.clamp(this.pitch, -limit, limit)
    })

    window.addEventListener('keydown', (event) => {
      this.updateKeyState(event.code, true)
    })

    window.addEventListener('keyup', (event) => {
      this.updateKeyState(event.code, false)
    })

    window.addEventListener('blur', () => {
      this.resetInputState()
    })

    document.addEventListener('pointerlockchange', () => {
      if (!this.isPointerLocked) {
        this.resetInputState()
      }
    })
  }

  private updateKeyState(code: string, isPressed: boolean): void {
    switch (code) {
      case 'KeyW':
        this.keys.forward = isPressed
        break
      case 'KeyS':
        this.keys.backward = isPressed
        break
      case 'KeyA':
        this.keys.left = isPressed
        break
      case 'KeyD':
        this.keys.right = isPressed
        break
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keys.sprint = isPressed
        break
      case 'Space':
        this.keys.jump = isPressed
        break
      default:
        break
    }
  }

  private resetInputState(): void {
    this.keys.forward = false
    this.keys.backward = false
    this.keys.left = false
    this.keys.right = false
    this.keys.sprint = false
    this.keys.jump = false
  }
}
