type ToneOptions = {
  frequency: number
  duration: number
  type?: OscillatorType
  gain?: number
  attack?: number
  release?: number
}

export class SoundSystem {
  private context: AudioContext | null = null
  private moveStepCooldown = 0

  bindUnlockEvents(): void {
    const unlock = () => {
      this.ensureContext()
      if (this.context && this.context.state === 'suspended') {
        this.context.resume().catch(() => {
        })
      }
    }

    window.addEventListener('mousedown', unlock)
    window.addEventListener('keydown', unlock)
    window.addEventListener('touchstart', unlock, { passive: true })
  }

  updateMovement(delta: number, movingOnGround: boolean): void {
    if (!movingOnGround) {
      this.moveStepCooldown = 0
      return
    }

    this.moveStepCooldown -= delta
    if (this.moveStepCooldown > 0) {
      return
    }

    this.moveStepCooldown = 0.29 + Math.random() * 0.08
    this.playStep()
  }

  playBlockPlace(): void {
    this.playTone({ frequency: 300 + Math.random() * 40, duration: 0.06, type: 'square', gain: 0.035 })
    this.playTone({ frequency: 180 + Math.random() * 25, duration: 0.045, type: 'triangle', gain: 0.03 })
  }

  playBlockBreak(): void {
    this.playTone({ frequency: 220 + Math.random() * 40, duration: 0.08, type: 'sawtooth', gain: 0.03 })
    this.playTone({ frequency: 120 + Math.random() * 20, duration: 0.06, type: 'triangle', gain: 0.03 })
  }

  playPlayerHurt(): void {
    this.playTone({ frequency: 170, duration: 0.12, type: 'sawtooth', gain: 0.05 })
  }

  playLanding(): void {
    this.playTone({ frequency: 120, duration: 0.07, type: 'triangle', gain: 0.05 })
    this.playTone({ frequency: 85, duration: 0.09, type: 'sine', gain: 0.04 })
  }

  playMobHit(): void {
    this.playTone({ frequency: 240, duration: 0.08, type: 'square', gain: 0.04 })
  }

  playMobDeath(): void {
    this.playTone({ frequency: 210, duration: 0.1, type: 'sawtooth', gain: 0.045 })
    this.playTone({ frequency: 120, duration: 0.2, type: 'triangle', gain: 0.04 })
  }

  private playStep(): void {
    const base = 120 + Math.random() * 30
    this.playTone({ frequency: base, duration: 0.05, type: 'triangle', gain: 0.03 })
    this.playTone({ frequency: base * 1.8, duration: 0.025, type: 'square', gain: 0.015 })
  }

  private playTone(options: ToneOptions): void {
    const context = this.ensureContext()
    if (!context) {
      return
    }

    if (context.state === 'suspended') {
      return
    }

    const now = context.currentTime
    const attack = options.attack ?? 0.005
    const release = options.release ?? options.duration
    const gainValue = options.gain ?? 0.04

    const oscillator = context.createOscillator()
    oscillator.type = options.type ?? 'sine'
    oscillator.frequency.setValueAtTime(options.frequency, now)

    const gainNode = context.createGain()
    gainNode.gain.setValueAtTime(0.0001, now)
    gainNode.gain.linearRampToValueAtTime(gainValue, now + attack)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + release)

    oscillator.connect(gainNode)
    gainNode.connect(context.destination)

    oscillator.start(now)
    oscillator.stop(now + release + 0.01)
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined' || !('AudioContext' in window)) {
      return null
    }

    if (!this.context) {
      this.context = new AudioContext()
    }

    return this.context
  }
}
