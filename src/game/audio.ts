// Web Audio API を使ったサウンドエンジン（効果音）＋ MP3 による BGM / 効果音。

import TitleBgmUrl from '../assets/sound/がんばれハム子 タイトル.mp3'
import PlayBgmUrl from '../assets/sound/がんばれハム子 プレイ中.mp3'
import ClearBgmUrl from '../assets/sound/GameClearMusic.mp3'
import CatAngryUrl from '../assets/sound/ネコの怒り声1.mp3'

type Win = Window & { webkitAudioContext?: typeof AudioContext }
export type MusicTrack = 'title' | 'play' | 'clear'

const MUSIC_VOLUME = 0.45

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sfxGain: GainNode | null = null
  private _muted = false

  // ---- MP3 ベースの BGM / 効果音 ----
  private musicEls: Partial<Record<MusicTrack, HTMLAudioElement>> = {}
  private catAngryEl: HTMLAudioElement | null = null
  private currentTrack: MusicTrack | null = null
  private pendingTrack: MusicTrack | null = null
  private gestureBound = false

  /** ユーザー操作のタイミングで呼ぶ（自動再生制限の解除） */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const Ctor = window.AudioContext || (window as Win).webkitAudioContext
    if (!Ctor) return
    this.ctx = new Ctor()
    this.master = this.ctx.createGain()
    this.master.gain.value = this._muted ? 0 : 0.9
    this.master.connect(this.ctx.destination)

    this.sfxGain = this.ctx.createGain()
    this.sfxGain.gain.value = 0.5
    this.sfxGain.connect(this.master)
  }

  get muted() {
    return this._muted
  }

  setMuted(v: boolean) {
    this._muted = v
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v ? 0 : 0.9, this.ctx.currentTime, 0.02)
    }
    // MP3 BGM はミュート切替で停止 / 再開
    for (const el of Object.values(this.musicEls)) {
      if (el) el.muted = v
    }
    if (this.catAngryEl) this.catAngryEl.muted = v
  }

  toggleMute() {
    this.setMuted(!this._muted)
    return this._muted
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType = 'sine',
    when = 0,
    gainPeak = 0.4,
    dest?: GainNode,
  ) {
    if (!this.ctx || !this.sfxGain) return
    const t0 = this.ctx.currentTime + when
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
    osc.connect(g)
    g.connect(dest ?? this.sfxGain)
    osc.start(t0)
    osc.stop(t0 + duration + 0.02)
  }

  // ---- 効果音 ----
  item() {
    this.tone(880, 0.08, 'square', 0, 0.3)
    this.tone(1180, 0.1, 'square', 0.05, 0.3)
  }

  combo(n: number) {
    const base = 500 + Math.min(n, 12) * 80
    this.tone(base, 0.1, 'triangle', 0, 0.35)
    this.tone(base * 1.5, 0.12, 'triangle', 0.06, 0.3)
  }

  powerup() {
    this.tone(440, 0.1, 'sawtooth', 0, 0.3)
    this.tone(660, 0.1, 'sawtooth', 0.08, 0.3)
    this.tone(880, 0.16, 'sawtooth', 0.16, 0.3)
  }

  shieldBlock() {
    this.tone(220, 0.18, 'sawtooth', 0, 0.4)
    this.tone(160, 0.22, 'square', 0.05, 0.3)
  }

  click() {
    this.tone(600, 0.05, 'square', 0, 0.25)
  }

  // 猫に捕まった時の効果音（MP3）
  catAngry() {
    if (!this.catAngryEl) {
      this.catAngryEl = new Audio(CatAngryUrl)
      this.catAngryEl.volume = 0.85
    }
    this.catAngryEl.muted = this._muted
    try {
      this.catAngryEl.currentTime = 0
      void this.catAngryEl.play()
    } catch {
      /* 再生不可は無視 */
    }
  }

  stageclear() {
    const notes = [523, 659, 784, 1047]
    notes.forEach((f, i) => this.tone(f, 0.18, 'sine', i * 0.12, 0.35))
  }

  allclear() {
    const notes = [523, 659, 784, 1047, 784, 1047, 1319]
    notes.forEach((f, i) => this.tone(f, 0.22, 'sine', i * 0.14, 0.4))
  }

  // ---- BGM（MP3） ----
  private trackUrl(track: MusicTrack): string {
    switch (track) {
      case 'title':
        return TitleBgmUrl
      case 'play':
        return PlayBgmUrl
      case 'clear':
        return ClearBgmUrl
    }
  }

  private getMusicEl(track: MusicTrack): HTMLAudioElement {
    let el = this.musicEls[track]
    if (!el) {
      el = new Audio(this.trackUrl(track))
      el.loop = track !== 'clear' // クリア曲は1回再生、他はループ
      el.volume = MUSIC_VOLUME
      this.musicEls[track] = el
    }
    return el
  }

  /** 指定トラックの BGM を再生（他のトラックは停止）。自動再生制限時はユーザー操作後に再生。 */
  playMusic(track: MusicTrack) {
    // 既に同じ曲が鳴っていれば何もしない（クリア曲は毎回頭出し）
    if (this.currentTrack === track && track !== 'clear') return
    this.stopMusic()
    this.pendingTrack = null // 保留中のトラックをクリア
    this.currentTrack = track
    const el = this.getMusicEl(track)
    el.muted = this._muted
    el.currentTime = 0
    const p = el.play()
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // 自動再生がブロックされた場合、最初のユーザー操作で再生する
        this.pendingTrack = track
        this.bindGestureUnlock()
      })
    }
  }

  stopMusic() {
    for (const el of Object.values(this.musicEls)) {
      if (el && !el.paused) {
        el.pause()
        el.currentTime = 0
      }
    }
    this.currentTrack = null
  }

  private bindGestureUnlock() {
    if (this.gestureBound) return
    this.gestureBound = true
    const unlock = () => {
      this.gestureBound = false
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      if (this.pendingTrack) {
        const t = this.pendingTrack
        this.pendingTrack = null
        // 遅延で再生（同じクリックで startGame が別トラックを設定する場合に備える）
        setTimeout(() => {
          // pendingTrack がクリアされていなければ再生
          if (this.currentTrack === t || !this.currentTrack) {
            this.currentTrack = null // 再入防止をリセット
            this.playMusic(t)
          }
        }, 0)
      }
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
  }
}

export const audio = new AudioEngine()

