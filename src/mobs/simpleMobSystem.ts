import * as THREE from 'three'

type TerrainProvider = {
  getSurfaceHeight: (worldX: number, worldZ: number) => number
}

type MobState = 'wander' | 'chase'

type Mob = {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>
  spawnAnchor: THREE.Vector3
  target: THREE.Vector3
  velocity: THREE.Vector3
  state: MobState
  wanderRetargetTimer: number
  attackCooldown: number
  animOffset: number
  health: number
  respawnTimer: number
  hitStunTimer: number
  hitFlashTimer: number
}

export type MobUpdateResult = {
  total: number
  alive: number
  chasing: number
  attacks: number
}

export type MobAttackResult = {
  hit: boolean
  killed: boolean
}

const MOB_COUNT = 8
const WANDER_SPEED = 1.2
const CHASE_SPEED = 2.35
const CHASE_RADIUS = 14
const ATTACK_RADIUS = 1.4
const ATTACK_COOLDOWN = 1.2
const MAX_MOB_DISTANCE = 64
const MOB_MAX_HEALTH = 3
const MOB_RESPAWN_SECONDS = 8
const MOB_HIT_RADIUS = 0.7
const MOB_KNOCKBACK_HORIZONTAL = 5.8
const MOB_KNOCKBACK_UPWARD = 3.2
const MOB_KNOCKBACK_DRAG = 7.5
const MOB_GRAVITY = 18
const MOB_HIT_STUN_SECONDS = 0.18
const MOB_HIT_FLASH_SECONDS = 0.12
const PLAYER_COLLISION_RADIUS = 0.45
const MOB_COLLISION_RADIUS = 0.45
const MIN_PLAYER_SEPARATION = PLAYER_COLLISION_RADIUS + MOB_COLLISION_RADIUS

export class SimpleMobSystem {
  readonly root = new THREE.Group()

  private readonly terrain: TerrainProvider
  private readonly mobs: Mob[] = []
  private readonly geometry = new THREE.BoxGeometry(0.9, 0.9, 0.9)
  private readonly baseColor = new THREE.Color(0x71d45b)
  private readonly tempClosestPoint = new THREE.Vector3()

  constructor(terrain: TerrainProvider) {
    this.terrain = terrain
  }

  attackFromRay(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    damage = 1,
    knockback = MOB_KNOCKBACK_HORIZONTAL,
  ): MobAttackResult {
    const directionLength = direction.length()
    if (directionLength === 0) {
      return { hit: false, killed: false }
    }

    const dirX = direction.x / directionLength
    const dirY = direction.y / directionLength
    const dirZ = direction.z / directionLength

    let bestMob: Mob | null = null
    let bestDistance = Number.POSITIVE_INFINITY

    for (const mob of this.mobs) {
      if (mob.respawnTimer > 0 || !mob.mesh.visible) {
        continue
      }

      const ox = mob.mesh.position.x - origin.x
      const oy = mob.mesh.position.y - origin.y
      const oz = mob.mesh.position.z - origin.z
      const projected = ox * dirX + oy * dirY + oz * dirZ

      if (projected < 0 || projected > maxDistance) {
        continue
      }

      this.tempClosestPoint.set(
        origin.x + dirX * projected,
        origin.y + dirY * projected,
        origin.z + dirZ * projected,
      )

      const distanceToRay = mob.mesh.position.distanceTo(this.tempClosestPoint)
      if (distanceToRay > MOB_HIT_RADIUS || projected >= bestDistance) {
        continue
      }

      bestDistance = projected
      bestMob = mob
    }

    if (!bestMob) {
      return { hit: false, killed: false }
    }

    bestMob.health -= damage
    bestMob.state = 'chase'
    bestMob.attackCooldown = Math.max(bestMob.attackCooldown, 0.2)
    bestMob.hitStunTimer = MOB_HIT_STUN_SECONDS
    bestMob.hitFlashTimer = MOB_HIT_FLASH_SECONDS

    const pushX = bestMob.mesh.position.x - origin.x
    const pushZ = bestMob.mesh.position.z - origin.z
    const pushLength = Math.hypot(pushX, pushZ)

    if (pushLength > 0.0001) {
      bestMob.velocity.x += (pushX / pushLength) * knockback
      bestMob.velocity.z += (pushZ / pushLength) * knockback
    } else {
      bestMob.velocity.x += dirX * knockback
      bestMob.velocity.z += dirZ * knockback
    }

    bestMob.velocity.y += MOB_KNOCKBACK_UPWARD

    let killed = false
    if (bestMob.health <= 0) {
      bestMob.respawnTimer = MOB_RESPAWN_SECONDS
      bestMob.mesh.visible = false
      killed = true
    }

    return { hit: true, killed }
  }

  update(delta: number, playerPosition: THREE.Vector3): MobUpdateResult {
    if (this.mobs.length === 0) {
      this.spawnInitialMobs(playerPosition)
    }

    let chasing = 0
    let attacks = 0
    let alive = 0

    for (const mob of this.mobs) {
      if (mob.respawnTimer > 0) {
        mob.respawnTimer -= delta
        if (mob.respawnTimer <= 0) {
          mob.health = MOB_MAX_HEALTH
          mob.mesh.visible = true
          this.teleportNearPlayer(mob, playerPosition)
        }
        continue
      }

      mob.hitStunTimer = Math.max(0, mob.hitStunTimer - delta)
      mob.hitFlashTimer = Math.max(0, mob.hitFlashTimer - delta)

      alive += 1

      const toPlayerX = playerPosition.x - mob.mesh.position.x
      const toPlayerZ = playerPosition.z - mob.mesh.position.z
      const playerDistance = Math.hypot(toPlayerX, toPlayerZ)
      const surfaceY = this.terrain.getSurfaceHeight(mob.mesh.position.x, mob.mesh.position.z) + 0.45
      const airborne = mob.mesh.position.y > surfaceY + 0.05
      const movementScale = airborne ? 0.45 : 1

      if (playerDistance > MAX_MOB_DISTANCE) {
        this.teleportNearPlayer(mob, playerPosition)
      }

      if (playerDistance <= CHASE_RADIUS) {
        mob.state = 'chase'
        chasing += 1
      } else {
        mob.state = 'wander'
      }

      if (mob.hitStunTimer <= 0 && mob.state === 'wander') {
        mob.wanderRetargetTimer -= delta
        const toTargetX = mob.target.x - mob.mesh.position.x
        const toTargetZ = mob.target.z - mob.mesh.position.z
        const targetDistance = Math.hypot(toTargetX, toTargetZ)

        if (targetDistance < 0.8 || mob.wanderRetargetTimer <= 0) {
          this.pickWanderTarget(mob)
        }

        this.moveToward(mob, mob.target, WANDER_SPEED * movementScale, delta)
      } else if (mob.hitStunTimer <= 0) {
        this.moveToward(mob, playerPosition, CHASE_SPEED * movementScale, delta)

        mob.attackCooldown = Math.max(0, mob.attackCooldown - delta)
        if (playerDistance <= ATTACK_RADIUS && mob.attackCooldown <= 0) {
          attacks += 1
          mob.attackCooldown = ATTACK_COOLDOWN
        }
      }

      mob.velocity.y -= MOB_GRAVITY * delta
      mob.mesh.position.x += mob.velocity.x * delta
      mob.mesh.position.y += mob.velocity.y * delta
      mob.mesh.position.z += mob.velocity.z * delta

      mob.velocity.x = THREE.MathUtils.damp(mob.velocity.x, 0, MOB_KNOCKBACK_DRAG, delta)
      mob.velocity.z = THREE.MathUtils.damp(mob.velocity.z, 0, MOB_KNOCKBACK_DRAG, delta)

      mob.animOffset += delta * 3.1
      const settledSurfaceY = this.terrain.getSurfaceHeight(mob.mesh.position.x, mob.mesh.position.z) + 0.45
      if (mob.mesh.position.y < settledSurfaceY) {
        mob.mesh.position.y = settledSurfaceY
        if (mob.velocity.y < 0) {
          mob.velocity.y = 0
        }
      }

      this.resolvePlayerCollision(mob, playerPosition)

      const grounded = mob.mesh.position.y <= settledSurfaceY + 0.01
      mob.mesh.scale.y = grounded ? 0.88 + Math.sin(mob.animOffset) * 0.08 : 0.95

      if (mob.hitFlashTimer > 0) {
        const flash = mob.hitFlashTimer / MOB_HIT_FLASH_SECONDS
        mob.mesh.material.color.lerpColors(this.baseColor, new THREE.Color(0xffc5c5), flash)
        mob.mesh.material.emissive.setRGB(flash * 0.35, flash * 0.08, flash * 0.08)
      } else {
        mob.mesh.material.color.copy(this.baseColor)
        mob.mesh.material.emissive.setRGB(0, 0, 0)
      }
    }

    return {
      total: this.mobs.length,
      alive,
      chasing,
      attacks,
    }
  }

  dispose(): void {
    for (const mob of this.mobs) {
      this.root.remove(mob.mesh)
      mob.mesh.material.dispose()
    }
    this.mobs.length = 0

    this.geometry.dispose()
  }

  private spawnInitialMobs(playerPosition: THREE.Vector3): void {
    for (let i = 0; i < MOB_COUNT; i += 1) {
      const spawn = randomAround(playerPosition, 8, 30)
      const surfaceHeight = this.terrain.getSurfaceHeight(spawn.x, spawn.z)
      const mesh = new THREE.Mesh(this.geometry, new THREE.MeshLambertMaterial({ color: this.baseColor }))
      mesh.position.set(spawn.x, surfaceHeight + 0.45, spawn.z)
      mesh.castShadow = false
      mesh.receiveShadow = true

      const mob: Mob = {
        mesh,
        spawnAnchor: new THREE.Vector3(spawn.x, surfaceHeight, spawn.z),
        target: new THREE.Vector3(spawn.x, surfaceHeight, spawn.z),
        velocity: new THREE.Vector3(),
        state: 'wander',
        wanderRetargetTimer: 0,
        attackCooldown: ATTACK_COOLDOWN * (0.6 + Math.random() * 0.7),
        animOffset: Math.random() * Math.PI * 2,
        health: MOB_MAX_HEALTH,
        respawnTimer: 0,
        hitStunTimer: 0,
        hitFlashTimer: 0,
      }

      this.pickWanderTarget(mob)
      this.root.add(mesh)
      this.mobs.push(mob)
    }
  }

  private teleportNearPlayer(mob: Mob, playerPosition: THREE.Vector3): void {
    const spawn = randomAround(playerPosition, 10, 22)
    const surfaceHeight = this.terrain.getSurfaceHeight(spawn.x, spawn.z)
    mob.mesh.position.set(spawn.x, surfaceHeight + 0.45, spawn.z)
    mob.spawnAnchor.set(spawn.x, surfaceHeight, spawn.z)
    mob.velocity.set(0, 0, 0)
    mob.attackCooldown = ATTACK_COOLDOWN * (0.6 + Math.random() * 0.7)
    mob.hitStunTimer = 0
    mob.hitFlashTimer = 0
    mob.mesh.material.color.copy(this.baseColor)
    mob.mesh.material.emissive.setRGB(0, 0, 0)
    this.pickWanderTarget(mob)
  }

  private pickWanderTarget(mob: Mob): void {
    const target = randomAround(mob.spawnAnchor, 2, 9)
    mob.target.set(target.x, 0, target.z)
    mob.wanderRetargetTimer = 1.5 + Math.random() * 3.2
  }

  private moveToward(mob: Mob, target: THREE.Vector3, speed: number, delta: number): void {
    const dx = target.x - mob.mesh.position.x
    const dz = target.z - mob.mesh.position.z
    const distance = Math.hypot(dx, dz)

    if (distance < 0.0001) {
      return
    }

    const moveDistance = Math.min(distance, speed * delta)
    const dirX = dx / distance
    const dirZ = dz / distance

    mob.mesh.position.x += dirX * moveDistance
    mob.mesh.position.z += dirZ * moveDistance
    mob.mesh.rotation.y = Math.atan2(dirX, dirZ)
  }

  private resolvePlayerCollision(mob: Mob, playerPosition: THREE.Vector3): void {
    const dx = mob.mesh.position.x - playerPosition.x
    const dz = mob.mesh.position.z - playerPosition.z
    const distance = Math.hypot(dx, dz)

    if (distance >= MIN_PLAYER_SEPARATION) {
      return
    }

    const safeDistance = Math.max(distance, 0.0001)
    const pushX = dx / safeDistance
    const pushZ = dz / safeDistance
    const correction = MIN_PLAYER_SEPARATION - distance

    mob.mesh.position.x += pushX * correction
    mob.mesh.position.z += pushZ * correction

    const outwardSpeed = mob.velocity.x * pushX + mob.velocity.z * pushZ
    if (outwardSpeed < 0) {
      mob.velocity.x -= pushX * outwardSpeed
      mob.velocity.z -= pushZ * outwardSpeed
    }
  }
}

function randomAround(center: THREE.Vector3, minRadius: number, maxRadius: number): THREE.Vector3 {
  const angle = Math.random() * Math.PI * 2
  const radius = minRadius + Math.random() * (maxRadius - minRadius)
  return new THREE.Vector3(center.x + Math.cos(angle) * radius, center.y, center.z + Math.sin(angle) * radius)
}
