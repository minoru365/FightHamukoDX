import { useEffect, useReducer, useRef, useState } from 'react'
import './Game.css'
import HamStop from '../assets/images/characters/HamStop.png'
import HamWalk1 from '../assets/images/characters/HamWalk1.png'
import HamWalk2 from '../assets/images/characters/HamWalk2.png'
import Item01 from '../assets/images/item01.png'
import Item02 from '../assets/images/item02.png'
import Item03 from '../assets/images/item03.png'
import CatHand from '../assets/images/enemy/CatHand.png'
import BgField from '../assets/images/backgrounds/Field_pixel_art_finer.png'
import { audio } from './audio'
import { loadHighScores, saveHighScore, type HighScores } from './storage'
import type {
  Difficulty,
  Enemy,
  EnemyKind,
  Item,
  Obstacle,
  Phase,
  PowerKind,
  World,
} from './types'

// ===== 論理サイズ・物理定数（固定 60Hz ステップ前提） =====
const GAME_WIDTH = 550
const GAME_HEIGHT = 1000
const STEP = 1 / 60

const PLAYER_SIZE = 60
const ENEMY_SIZE = 64
const ITEM_SIZE = 38
const POWER_SIZE = 46

const PLAYER_R = PLAYER_SIZE / 2
const ENEMY_R = ENEMY_SIZE / 2
const ITEM_R = ITEM_SIZE / 2
const POWER_R = POWER_SIZE / 2

const MAX_SPEED = 10
const ACCEL = 0.3
const DAMP = 0.95
const COMBO_WINDOW = 2.2 // 秒
const MAGNET_R = 170
const TOTAL_STAGES = 5

// ===== 難易度設定 =====
interface DiffConfig {
  label: string
  emoji: string
  time: number
  items: number
  enemySpeed: number
  enemies: number
  klass: string
}
const DIFFICULTY: Record<Difficulty, DiffConfig> = {
  easy: { label: 'Easy', emoji: '😊', time: 90, items: 8, enemySpeed: 2.0, enemies: 1, klass: 'easy' },
  normal: { label: 'Normal', emoji: '🙂', time: 70, items: 12, enemySpeed: 2.8, enemies: 1, klass: 'normal' },
  hard: { label: 'Hard', emoji: '😰', time: 55, items: 16, enemySpeed: 3.6, enemies: 2, klass: 'hard' },
  oni: { label: '鬼', emoji: '👹', time: 40, items: 20, enemySpeed: 4.4, enemies: 2, klass: 'oni' },
}

// ===== パワーアップ表示情報 =====
const POWER_INFO: Record<PowerKind, { icon: string; label: string; color: string; duration: number }> = {
  shield: { icon: '🛡️', label: 'シールド', color: '#34d3ff', duration: 6 },
  speed: { icon: '⚡', label: 'スピード', color: '#ffe14d', duration: 6 },
  magnet: { icon: '🧲', label: 'マグネット', color: '#ff5db1', duration: 7 },
  slow: { icon: '🕸️', label: 'スロー', color: '#9d7bff', duration: 6 },
  time: { icon: '⏰', label: 'タイム +6s', color: '#5dff9d', duration: 0 },
}
const POWER_KINDS: PowerKind[] = ['shield', 'speed', 'magnet', 'slow', 'time']
const OBSTACLE_EMOJI = ['🪨', '🌳', '🌵', '🍄', '🌲']
const PARTICLE_COLORS = ['#FFD700', '#FF7AC6', '#5DE0FF', '#7CFF6B', '#FFB347']

// ===== 数学ヘルパー =====
const rand = (min: number, max: number) => min + Math.random() * (max - min)
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const itemImages = [Item01, Item02, Item03]

// ===== ステージ生成 =====
function stageItemCount(d: Difficulty, stage: number) {
  return DIFFICULTY[d].items + (stage - 1) * 2
}
function stageEnemyCount(d: Difficulty, stage: number) {
  return Math.min(5, DIFFICULTY[d].enemies + Math.floor((stage - 1) / 1.5))
}
function stageEnemySpeed(d: Difficulty, stage: number) {
  return DIFFICULTY[d].enemySpeed + (stage - 1) * 0.45
}

function randomFreePos(occupied: { x: number; y: number; r: number }[], r: number, margin = 30) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const x = rand(margin + r, GAME_WIDTH - margin - r)
    const y = rand(margin + r, GAME_HEIGHT - margin - r)
    let ok = true
    for (const o of occupied) {
      if (dist(x, y, o.x, o.y) < o.r + r + 16) {
        ok = false
        break
      }
    }
    if (ok) return { x, y }
  }
  return { x: rand(margin + r, GAME_WIDTH - margin - r), y: rand(margin + r, GAME_HEIGHT - margin - r) }
}

function makeEmptyWorld(): World {
  return {
    player: { x: GAME_WIDTH / 2, y: GAME_HEIGHT * 0.72, vx: 0, vy: 0, angle: 0, walking: false, walkFrame: 1, walkTimer: 0 },
    enemies: [],
    items: [],
    obstacles: [],
    powerups: [],
    particles: [],
    floaters: [],
    effects: { shield: 0, speed: 0, magnet: 0, slow: 0 },
    combo: 0,
    comboTimer: 0,
    score: 0,
    collected: 0,
    totalItems: 0,
    remainingTime: 0,
    timeAcc: 0,
    shake: 0,
    stage: 1,
    spawnTimer: 6,
    blockCd: 0,
    nextId: 1,
  }
}

/** 既存ワールドにステージを構築（score / stage は維持） */
function buildStage(w: World, d: Difficulty, stage: number) {
  w.stage = stage
  const startX = GAME_WIDTH / 2
  const startY = GAME_HEIGHT * 0.72
  w.player = { x: startX, y: startY, vx: 0, vy: 0, angle: 0, walking: false, walkFrame: 1, walkTimer: 0 }
  w.effects = { shield: 0, speed: 0, magnet: 0, slow: 0 }
  w.combo = 0
  w.comboTimer = 0
  w.particles = []
  w.floaters = []
  w.powerups = []
  w.shake = 0
  w.timeAcc = 0
  w.spawnTimer = rand(5, 8)
  w.remainingTime = DIFFICULTY[d].time

  const occupied: { x: number; y: number; r: number }[] = [{ x: startX, y: startY, r: 110 }]

  // 障害物
  const obstacles: Obstacle[] = []
  const obsCount = 3 + Math.floor(rand(0, 3)) + Math.floor((stage - 1) / 2)
  for (let i = 0; i < obsCount; i++) {
    const r = rand(24, 40)
    const pos = randomFreePos(occupied, r, 40)
    const obs: Obstacle = { id: w.nextId++, x: pos.x, y: pos.y, r, emoji: OBSTACLE_EMOJI[Math.floor(rand(0, OBSTACLE_EMOJI.length))] }
    obstacles.push(obs)
    occupied.push({ x: pos.x, y: pos.y, r })
  }
  w.obstacles = obstacles

  // アイテム
  const items: Item[] = []
  const count = stageItemCount(d, stage)
  for (let i = 0; i < count; i++) {
    const pos = randomFreePos(occupied, ITEM_R, 24)
    items.push({ id: w.nextId++, x: pos.x, y: pos.y, type: ((i % 3) + 1) as 1 | 2 | 3, collected: false, bob: rand(0, Math.PI * 2) })
    occupied.push({ x: pos.x, y: pos.y, r: ITEM_R })
  }
  w.items = items
  w.totalItems = count
  w.collected = 0

  // 敵（プレイヤー開始位置から十分離れた上部に配置）
  const enemies: Enemy[] = []
  const ecount = stageEnemyCount(d, stage)
  const espeed = stageEnemySpeed(d, stage)
  const kinds: EnemyKind[] = ['chaser', 'ambush', 'patrol']
  const MIN_SPAWN_DIST = 360
  for (let i = 0; i < ecount; i++) {
    const kind: EnemyKind = i === 0 ? 'chaser' : kinds[Math.floor(rand(0, kinds.length))]
    // プレイヤー（画面下部中央）から MIN_SPAWN_DIST 以上離れた地点を探す
    let ex = GAME_WIDTH / 2
    let ey = ENEMY_R + 30
    for (let attempt = 0; attempt < 30; attempt++) {
      const cx = rand(ENEMY_R + 20, GAME_WIDTH - ENEMY_R - 20)
      const cy = rand(ENEMY_R + 20, GAME_HEIGHT * 0.4)
      if (dist(cx, cy, startX, startY) >= MIN_SPAWN_DIST) {
        ex = cx
        ey = cy
        break
      }
    }
    const ang = rand(0, Math.PI * 2)
    enemies.push({
      x: ex,
      y: ey,
      kind,
      angle: 0,
      speed: espeed * (kind === 'patrol' ? 1.15 : 1) * (kind === 'ambush' ? 0.95 : 1),
      dirX: Math.cos(ang),
      dirY: Math.sin(ang),
    })
  }
  w.enemies = enemies
}

function burst(w: World, x: number, y: number, count: number, colors = PARTICLE_COLORS) {
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count + rand(-0.3, 0.3)
    const sp = rand(2, 6)
    w.particles.push({
      id: w.nextId++,
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: rand(0.5, 0.9),
      maxLife: 0.9,
      color: colors[Math.floor(rand(0, colors.length))],
      size: rand(4, 9),
    })
  }
}

function addFloater(w: World, x: number, y: number, text: string, color: string, size = 26) {
  w.floaters.push({ id: w.nextId++, x, y, vy: -0.7, life: 1.1, text, color, size })
}

export default function Game() {
  const worldRef = useRef<World>(makeEmptyWorld())
  const [phase, setPhase] = useState<Phase>('title')
  const phaseRef = useRef<Phase>('title')
  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const difficultyRef = useRef<Difficulty>('normal')
  const [, forceRender] = useReducer((c: number) => c + 1, 0)

  const [highScores, setHighScores] = useState<HighScores>(() => loadHighScores())
  const [isNewRecord, setIsNewRecord] = useState(false)
  const [muted, setMuted] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const countdownRef = useRef(0)

  // 入力
  const accelRef = useRef({ x: 0, y: 0 })
  const keysRef = useRef<Set<string>>(new Set())
  const gameAreaRef = useRef<HTMLDivElement | null>(null)

  // ジョイスティック
  const [joyActive, setJoyActive] = useState(false)
  const [joyOrigin, setJoyOrigin] = useState({ x: 0, y: 0 })
  const [joyStick, setJoyStick] = useState({ x: 0, y: 0 })
  const joyBaseRef = useRef({ x: 0, y: 0 })
  const joyActiveRef = useRef(false)

  // 傾きセンサー操作
  const [tiltEnabled, setTiltEnabled] = useState(false)
  const [tiltSupported, setTiltSupported] = useState(false)
  const tiltEnabledRef = useRef(false)

  // 画面サイズ → スケール
  const [screen, setScreen] = useState({ w: GAME_WIDTH, h: GAME_HEIGHT })
  useEffect(() => {
    const update = () => {
      const el = gameAreaRef.current
      if (el) {
        const r = el.getBoundingClientRect()
        setScreen({ w: r.width, h: r.height })
      }
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [phase])
  const scaleX = screen.w / GAME_WIDTH
  const scaleY = screen.h / GAME_HEIGHT

  // タイトルBGMを初回マウント時に再生（自動再生制限時は最初の操作で再生）
  useEffect(() => {
    audio.playMusic('title')
  }, [])

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p
    setPhase(p)
  }

  // ===== 入力（キーボード） =====
  const updateKeyAccel = () => {
    if (joyActiveRef.current) return
    let ax = 0
    let ay = 0
    const k = keysRef.current
    if (k.has('ArrowLeft') || k.has('a') || k.has('A')) ax -= 1
    if (k.has('ArrowRight') || k.has('d') || k.has('D')) ax += 1
    if (k.has('ArrowUp') || k.has('w') || k.has('W')) ay -= 1
    if (k.has('ArrowDown') || k.has('s') || k.has('S')) ay += 1
    if (ax !== 0 && ay !== 0) {
      const len = Math.hypot(ax, ay)
      ax /= len
      ay /= len
    }
    accelRef.current = { x: ax * 1.67, y: ay * 1.67 }
  }
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D']
    if (keys.includes(e.key)) {
      e.preventDefault()
      keysRef.current.add(e.key)
      updateKeyAccel()
    }
  }
  const handleKeyUp = (e: React.KeyboardEvent) => {
    keysRef.current.delete(e.key)
    updateKeyAccel()
  }

  // ===== 入力（ポインタ＝ジョイスティック） =====
  const updateJoy = (cx: number, cy: number) => {
    const dx = cx - joyBaseRef.current.x
    const dy = cy - joyBaseRef.current.y
    const maxD = 55
    const d = Math.hypot(dx, dy)
    let sx = dx
    let sy = dy
    if (d > maxD) {
      sx = (dx / d) * maxD
      sy = (dy / d) * maxD
    }
    setJoyStick({ x: sx, y: sy })
    if (d > 3) {
      const strength = Math.min(d, maxD) / maxD
      accelRef.current = { x: (dx / d) * strength * 1.83, y: (dy / d) * strength * 1.83 }
    } else {
      accelRef.current = { x: 0, y: 0 }
    }
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if (phaseRef.current !== 'playing') return
    const target = e.target as HTMLElement
    if (target.tagName === 'BUTTON' || target.closest('button')) return
    e.preventDefault()
    const area = e.currentTarget as HTMLElement
    area.setPointerCapture(e.pointerId)
    const r = area.getBoundingClientRect()
    joyBaseRef.current = { x: e.clientX, y: e.clientY }
    setJoyOrigin({ x: e.clientX - r.left, y: e.clientY - r.top })
    setJoyStick({ x: 0, y: 0 })
    setJoyActive(true)
    joyActiveRef.current = true
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!joyActiveRef.current) return
    e.preventDefault()
    updateJoy(e.clientX, e.clientY)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!joyActiveRef.current) return
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    setJoyActive(false)
    joyActiveRef.current = false
    setJoyStick({ x: 0, y: 0 })
    accelRef.current = { x: 0, y: 0 }
    gameAreaRef.current?.focus()
  }

  // ===== 入力（傾きセンサー） =====
  useEffect(() => {
    // DeviceOrientationEvent が使えるか検出
    const hasOrientation = 'DeviceOrientationEvent' in window
    setTiltSupported(hasOrientation)
  }, [])

  useEffect(() => {
    if (!tiltEnabled) return
    tiltEnabledRef.current = true
    const DEAD_ZONE = 4 // 度
    const MAX_ANGLE = 30 // 最大傾き角
    const SENSITIVITY = 1.7

    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (!tiltEnabledRef.current) return
      if (joyActiveRef.current) return // ジョイスティック操作中は傾き無視
      if (keysRef.current.size > 0) return // キーボード操作中は傾き無視

      const gamma = e.gamma ?? 0 // 左右傾き (-90..90)
      const beta = e.beta ?? 0  // 前後傾き (-180..180)

      // デッドゾーン適用
      let ax = Math.abs(gamma) < DEAD_ZONE ? 0 : (gamma - Math.sign(gamma) * DEAD_ZONE) / (MAX_ANGLE - DEAD_ZONE)
      let ay = Math.abs(beta - 20) < DEAD_ZONE ? 0 : ((beta - 20) - Math.sign(beta - 20) * DEAD_ZONE) / (MAX_ANGLE - DEAD_ZONE)
      // beta の基準を20度（自然な持ち方）にオフセット

      // clamp to -1..1
      ax = Math.max(-1, Math.min(1, ax))
      ay = Math.max(-1, Math.min(1, ay))

      accelRef.current = { x: ax * SENSITIVITY, y: ay * SENSITIVITY }
    }

    window.addEventListener('deviceorientation', handleOrientation)
    return () => {
      tiltEnabledRef.current = false
      window.removeEventListener('deviceorientation', handleOrientation)
    }
  }, [tiltEnabled])

  const requestTilt = async () => {
    // iOS 13+ は明示的な許可が必要
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
    if (typeof DOE.requestPermission === 'function') {
      try {
        const perm = await DOE.requestPermission()
        if (perm === 'granted') {
          setTiltEnabled(true)
          tiltEnabledRef.current = true
        }
      } catch {
        /* ユーザーが拒否、または API エラー */
      }
    } else {
      // Android / デスクトップ → そのまま有効化
      setTiltEnabled(true)
      tiltEnabledRef.current = true
    }
  }

  const toggleTilt = () => {
    if (tiltEnabled) {
      setTiltEnabled(false)
      tiltEnabledRef.current = false
      accelRef.current = { x: 0, y: 0 }
    } else {
      void requestTilt()
    }
  }

  // ===== ゲームループ（固定タイムステップ rAF） =====
  useEffect(() => {
    if (phase !== 'playing') return
    let raf = 0
    let last = performance.now()
    let acc = 0
    let running = true

    const loop = (now: number) => {
      if (!running) return
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      if (countdownRef.current <= 0) {
        acc += dt
        while (acc >= STEP) {
          const transition = step()
          acc -= STEP
          if (transition) {
            handleTransition(transition)
            running = false
            break
          }
        }
      }
      forceRender()
      if (running) raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      running = false
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // 1 ステップ（1/60 秒）進める。状態遷移が必要なら文字列を返す。
  const step = (): 'gameover' | 'stageclear' | null => {
    const w = worldRef.current
    const p = w.player
    const a = accelRef.current

    // --- プレイヤー物理 ---
    const speedBoost = w.effects.speed > 0
    const accelMul = speedBoost ? 1.4 : 1
    const maxSpeed = MAX_SPEED * (speedBoost ? 1.5 : 1)
    p.vx += a.x * ACCEL * accelMul
    p.vy += a.y * ACCEL * accelMul
    p.vx *= DAMP
    p.vy *= DAMP
    const sp = Math.hypot(p.vx, p.vy)
    if (sp > maxSpeed) {
      p.vx = (p.vx / sp) * maxSpeed
      p.vy = (p.vy / sp) * maxSpeed
    }
    if (sp > 0.5) p.angle = Math.atan2(p.vx, -p.vy) * (180 / Math.PI)
    p.x += p.vx
    p.y += p.vy
    if (p.x < PLAYER_R) { p.x = PLAYER_R; p.vx = 0 }
    if (p.x > GAME_WIDTH - PLAYER_R) { p.x = GAME_WIDTH - PLAYER_R; p.vx = 0 }
    if (p.y < PLAYER_R) { p.y = PLAYER_R; p.vy = 0 }
    if (p.y > GAME_HEIGHT - PLAYER_R) { p.y = GAME_HEIGHT - PLAYER_R; p.vy = 0 }

    // --- 障害物との衝突（押し出し） ---
    for (const o of w.obstacles) {
      const dx = p.x - o.x
      const dy = p.y - o.y
      const dd = Math.hypot(dx, dy)
      const min = PLAYER_R + o.r
      if (dd < min && dd > 0.001) {
        const nx = dx / dd
        const ny = dy / dd
        p.x = o.x + nx * min
        p.y = o.y + ny * min
        const vd = p.vx * nx + p.vy * ny
        if (vd < 0) {
          p.vx -= vd * nx
          p.vy -= vd * ny
        }
      }
    }

    // --- 歩行アニメ ---
    const realSp = Math.hypot(p.vx, p.vy)
    p.walking = realSp > 1
    if (p.walking) {
      const interval = realSp > 7 ? 0.1 : realSp > 4 ? 0.18 : 0.28
      p.walkTimer += STEP
      if (p.walkTimer >= interval) {
        p.walkTimer = 0
        p.walkFrame = p.walkFrame === 1 ? 2 : 1
      }
    } else {
      p.walkFrame = 1
      p.angle = 0 // 停止時はスタート時と同じ向き（上向き）に戻す
    }

    // --- 効果時間の減衰 ---
    const e = w.effects
    e.shield = Math.max(0, e.shield - STEP)
    e.speed = Math.max(0, e.speed - STEP)
    e.magnet = Math.max(0, e.magnet - STEP)
    e.slow = Math.max(0, e.slow - STEP)
    if (w.blockCd > 0) w.blockCd -= STEP

    // --- 敵 AI ---
    const slowMul = e.slow > 0 ? 0.45 : 1
    for (const en of w.enemies) {
      const es = en.speed * slowMul
      if (en.kind === 'patrol') {
        en.x += en.dirX * es
        en.y += en.dirY * es
        if (en.x < ENEMY_R || en.x > GAME_WIDTH - ENEMY_R) en.dirX *= -1
        if (en.y < ENEMY_R || en.y > GAME_HEIGHT - ENEMY_R) en.dirY *= -1
        // プレイヤーが近いと寄ってくる
        const pd = dist(en.x, en.y, p.x, p.y)
        if (pd < 210 && pd > 1) {
          const tx = (p.x - en.x) / pd
          const ty = (p.y - en.y) / pd
          en.dirX += tx * 0.06
          en.dirY += ty * 0.06
          const dl = Math.hypot(en.dirX, en.dirY) || 1
          en.dirX /= dl
          en.dirY /= dl
        }
        en.angle = Math.atan2(en.dirX, -en.dirY) * (180 / Math.PI)
      } else {
        let tx = p.x
        let ty = p.y
        if (en.kind === 'ambush') {
          tx = p.x + p.vx * 9
          ty = p.y + p.vy * 9
        }
        const dx = tx - en.x
        const dy = ty - en.y
        const dd = Math.hypot(dx, dy)
        if (dd > 0.001) {
          en.x += (dx / dd) * es
          en.y += (dy / dd) * es
          en.angle = Math.atan2(dx / dd, -dy / dd) * (180 / Math.PI)
        }
      }
      en.x = clamp(en.x, ENEMY_R, GAME_WIDTH - ENEMY_R)
      en.y = clamp(en.y, ENEMY_R, GAME_HEIGHT - ENEMY_R)
    }

    // --- 敵との接触判定 ---
    for (const en of w.enemies) {
      const dd = dist(en.x, en.y, p.x, p.y)
      const hitR = PLAYER_R * 0.62 + ENEMY_R * 0.62
      if (dd < hitR) {
        if (w.effects.shield > 0) {
          // シールドで弾く
          const nx = (en.x - p.x) / (dd || 1)
          const ny = (en.y - p.y) / (dd || 1)
          en.x = p.x + nx * (hitR + 6)
          en.y = p.y + ny * (hitR + 6)
          p.vx -= nx * 2
          p.vy -= ny * 2
          if (w.blockCd <= 0) {
            audio.shieldBlock()
            burst(w, en.x, en.y, 8, ['#34d3ff', '#bdecff'])
            w.shake = Math.max(w.shake, 6)
            w.blockCd = 0.25
          }
        } else {
          w.shake = 22
          burst(w, p.x, p.y, 20, ['#ff4d4d', '#ffb199', '#ffe14d'])
          return 'gameover'
        }
      }
    }

    // --- アイテム（マグネット＋取得） ---
    for (const it of w.items) {
      if (it.collected) continue
      it.bob += STEP * 4
      const dd = dist(it.x, it.y, p.x, p.y)
      if (e.magnet > 0 && dd < MAGNET_R && dd > 1) {
        const pull = 4.2 * (1 - dd / MAGNET_R) + 1.5
        it.x += ((p.x - it.x) / dd) * pull
        it.y += ((p.y - it.y) / dd) * pull
      }
      if (dd < PLAYER_R + ITEM_R - 6) {
        it.collected = true
        w.collected++
        w.combo++
        w.comboTimer = COMBO_WINDOW
        const base = 100
        const bonus = (w.combo - 1) * 50
        const gained = base + bonus
        w.score += gained
        burst(w, it.x, it.y, 14)
        addFloater(w, it.x, it.y, `+${gained}`, '#FFD700', w.combo > 2 ? 30 : 24)
        if (w.combo > 1) audio.combo(w.combo)
        else audio.item()
      }
    }

    // コンボ持続
    if (w.comboTimer > 0) {
      w.comboTimer -= STEP
      if (w.comboTimer <= 0) w.combo = 0
    }

    // --- パワーアップ：出現 ---
    w.spawnTimer -= STEP
    if (w.spawnTimer <= 0 && w.powerups.length < 2) {
      const occupied = [
        { x: p.x, y: p.y, r: 90 },
        ...w.obstacles.map((o) => ({ x: o.x, y: o.y, r: o.r })),
        ...w.powerups.map((pu) => ({ x: pu.x, y: pu.y, r: POWER_R })),
      ]
      const pos = randomFreePos(occupied, POWER_R, 30)
      const kind = POWER_KINDS[Math.floor(rand(0, POWER_KINDS.length))]
      w.powerups.push({ id: w.nextId++, x: pos.x, y: pos.y, kind, ttl: 12 })
      w.spawnTimer = rand(8, 12)
    }

    // --- パワーアップ：寿命＆取得 ---
    for (const pu of w.powerups) {
      pu.ttl -= STEP
      const dd = dist(pu.x, pu.y, p.x, p.y)
      if (dd < PLAYER_R + POWER_R - 6) {
        pu.ttl = -1 // 取得→除去
        const info = POWER_INFO[pu.kind]
        if (pu.kind === 'time') {
          w.remainingTime += 6
        } else {
          w.effects[pu.kind] = info.duration
        }
        audio.powerup()
        burst(w, pu.x, pu.y, 16, [info.color, '#ffffff'])
        addFloater(w, pu.x, pu.y, `${info.icon} ${info.label}`, info.color, 24)
      }
    }
    w.powerups = w.powerups.filter((pu) => pu.ttl > 0)

    // --- パーティクル / フローター ---
    for (const pt of w.particles) {
      pt.x += pt.vx
      pt.y += pt.vy
      pt.vy += 0.22
      pt.life -= STEP
    }
    w.particles = w.particles.filter((pt) => pt.life > 0)
    for (const fl of w.floaters) {
      fl.y += fl.vy
      fl.life -= STEP
    }
    w.floaters = w.floaters.filter((fl) => fl.life > 0)

    // シェイク減衰
    w.shake *= 0.88
    if (w.shake < 0.3) w.shake = 0

    // --- タイマー ---
    w.timeAcc += STEP
    if (w.timeAcc >= 1) {
      w.timeAcc -= 1
      w.remainingTime--
      if (w.remainingTime <= 0) {
        w.remainingTime = 0
        w.shake = 18
        return 'gameover'
      }
    }

    // --- クリア判定 ---
    if (w.collected >= w.totalItems) {
      return 'stageclear'
    }

    return null
  }

  const handleTransition = (t: 'gameover' | 'stageclear') => {
    const w = worldRef.current
    if (t === 'gameover') {
      audio.stopMusic()
      audio.catAngry()
      commitHighScore(w.score)
      setPhaseBoth('gameover')
    } else {
      // ステージクリア：タイムボーナス加算
      const bonus = w.remainingTime * 50
      w.score += bonus
      if (w.remainingTime > 0) addFloater(w, w.player.x, w.player.y, `TIME +${bonus}`, '#5dff9d', 28)
      audio.playMusic('clear')
      if (w.stage >= TOTAL_STAGES) {
        audio.allclear()
        commitHighScore(w.score)
        setPhaseBoth('allclear')
      } else {
        audio.stageclear()
        setPhaseBoth('stageclear')
      }
    }
  }

  const commitHighScore = (score: number) => {
    const result = saveHighScore(highScores, difficultyRef.current, score)
    setHighScores(result.scores)
    setIsNewRecord(result.isNewRecord)
  }

  // ===== カウントダウン =====
  const startCountdown = () => {
    countdownRef.current = 3
    setCountdown(3)
    const id = setInterval(() => {
      countdownRef.current -= 1
      setCountdown(countdownRef.current)
      if (countdownRef.current <= 0) {
        clearInterval(id)
        gameAreaRef.current?.focus()
      }
    }, 700)
  }

  // ===== フロー制御 =====
  const startGame = (d: Difficulty) => {
    audio.ensure()
    audio.playMusic('play')
    difficultyRef.current = d
    setDifficulty(d)
    setIsNewRecord(false)
    const w = makeEmptyWorld()
    w.score = 0
    w.stage = 1
    worldRef.current = w
    buildStage(w, d, 1)
    setPhaseBoth('playing')
    startCountdown()
    setTimeout(() => gameAreaRef.current?.focus(), 50)
  }

  const nextStage = () => {
    const w = worldRef.current
    const d = difficultyRef.current
    audio.ensure()
    audio.playMusic('play')
    buildStage(w, d, w.stage + 1)
    setPhaseBoth('playing')
    startCountdown()
    setTimeout(() => gameAreaRef.current?.focus(), 50)
  }

  const retry = () => {
    startGame(difficultyRef.current)
  }

  const backToTitle = () => {
    audio.playMusic('title')
    setIsNewRecord(false)
    setPhaseBoth('title')
  }

  const toggleMute = () => {
    audio.ensure()
    const m = audio.toggleMute()
    setMuted(m)
  }

  // ===== 描画ヘルパー =====
  const playerImg = () => {
    const p = worldRef.current.player
    if (!p.walking) return HamStop
    return p.walkFrame === 1 ? HamWalk1 : HamWalk2
  }

  const w = worldRef.current
  const shakeX = w.shake ? (Math.random() - 0.5) * w.shake : 0
  const shakeY = w.shake ? (Math.random() - 0.5) * w.shake : 0
  const effects = w.effects
  const activeEffects = (Object.keys(effects) as (keyof typeof effects)[]).filter((k) => effects[k] > 0)

  return (
    <div className="game-container">
      <div className="play-stage">
        {/* 上部インフォメーションバー（プレイエリアと分離） */}
        {phase !== 'title' && (
          <div className="info-bar">
            <div className="info-stats">
              <div className={`hud-pill ${w.remainingTime <= 10 ? 'danger' : ''}`}>⏱️ {w.remainingTime}</div>
              <div className="hud-pill stage">🏁 {w.stage}/{TOTAL_STAGES}</div>
              <div className="hud-pill">🌟 {w.collected}/{w.totalItems}</div>
              <div className="hud-pill score">💰 {w.score.toLocaleString()}</div>
            </div>
            <div className="info-actions">
              {tiltSupported && (
                <button className={`mute-btn in-game${tiltEnabled ? ' active' : ''}`} onClick={toggleTilt}>📱</button>
              )}
              <button className="mute-btn in-game" onClick={toggleMute}>{muted ? '🔇' : '🔊'}</button>
            </div>
          </div>
        )}
        <div
          className="game-area"
          tabIndex={0}
          ref={gameAreaRef}
          style={{ backgroundImage: `url(${BgField})` }}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="world" style={{ transform: `translate(${shakeX}px, ${shakeY}px)` }}>
          {/* 障害物 */}
          {w.obstacles.map((o) => (
            <div
              key={o.id}
              className="obstacle"
              style={{
                left: `${o.x * scaleX}px`,
                top: `${o.y * scaleY}px`,
                fontSize: `${o.r * 2 * scaleX}px`,
              }}
            >
              {o.emoji}
            </div>
          ))}

          {/* アイテム */}
          {w.items.filter((it) => !it.collected).map((it) => (
            <img
              key={it.id}
              src={itemImages[it.type - 1]}
              alt="item"
              className="item"
              style={{
                left: `${it.x * scaleX}px`,
                top: `${(it.y + Math.sin(it.bob) * 4) * scaleY}px`,
                width: `${ITEM_SIZE * scaleX}px`,
                height: `${ITEM_SIZE * scaleY}px`,
              }}
            />
          ))}

          {/* パワーアップ */}
          {w.powerups.map((pu) => (
            <div
              key={pu.id}
              className={`powerup ${pu.ttl < 3 ? 'blink' : ''}`}
              style={{
                left: `${pu.x * scaleX}px`,
                top: `${pu.y * scaleY}px`,
                width: `${POWER_SIZE * scaleX}px`,
                height: `${POWER_SIZE * scaleY}px`,
                boxShadow: `0 0 16px ${POWER_INFO[pu.kind].color}`,
                borderColor: POWER_INFO[pu.kind].color,
              }}
            >
              {POWER_INFO[pu.kind].icon}
            </div>
          ))}

          {/* 敵 */}
          {w.enemies.map((en, i) => (
            <img
              key={i}
              src={CatHand}
              alt="enemy"
              className={`enemy ${en.kind}`}
              style={{
                left: `${en.x * scaleX}px`,
                top: `${en.y * scaleY}px`,
                width: `${ENEMY_SIZE * scaleX}px`,
                height: `${ENEMY_SIZE * scaleY}px`,
                transform: `translate(-50%, -50%) rotate(${en.angle}deg)`,
              }}
            />
          ))}

          {/* プレイヤー（オーラ付き） */}
          <div
            className="player-wrap"
            style={{ left: `${w.player.x * scaleX}px`, top: `${w.player.y * scaleY}px` }}
          >
            {effects.shield > 0 && <div className="aura shield-aura" />}
            {effects.magnet > 0 && <div className="aura magnet-aura" />}
            {effects.speed > 0 && <div className="aura speed-aura" />}
            <img
              src={playerImg()}
              alt="hamuko"
              className="player"
              style={{
                width: `${PLAYER_SIZE * scaleX}px`,
                height: `${PLAYER_SIZE * scaleY}px`,
                transform: `translate(-50%, -50%) rotate(${w.player.angle}deg)`,
              }}
            />
          </div>

          {/* パーティクル */}
          {w.particles.map((pt) => (
            <div
              key={pt.id}
              className="particle"
              style={{
                left: `${pt.x * scaleX}px`,
                top: `${pt.y * scaleY}px`,
                width: `${pt.size}px`,
                height: `${pt.size}px`,
                backgroundColor: pt.color,
                color: pt.color,
                opacity: clamp(pt.life / pt.maxLife, 0, 1),
              }}
            />
          ))}

          {/* フローター */}
          {w.floaters.map((fl) => (
            <div
              key={fl.id}
              className="floater"
              style={{
                left: `${fl.x * scaleX}px`,
                top: `${fl.y * scaleY}px`,
                color: fl.color,
                fontSize: `${fl.size}px`,
                opacity: clamp(fl.life, 0, 1),
              }}
            >
              {fl.text}
            </div>
          ))}
        </div>

        {/* HUD（プレイエリア内オーバーレイ） */}
        {(phase === 'playing') && (
          <>
            {/* 効果インジケータ */}
            {activeEffects.length > 0 && (
              <div className="effect-bar">
                {activeEffects.map((k) => (
                  <div key={k} className="effect-chip" style={{ borderColor: POWER_INFO[k].color }}>
                    <span>{POWER_INFO[k].icon}</span>
                    <span className="effect-time">{Math.ceil(effects[k])}</span>
                  </div>
                ))}
              </div>
            )}

            {/* コンボ */}
            {w.combo > 1 && (
              <div className="combo-display">
                <span className="combo-text">{w.combo} COMBO 🔥</span>
              </div>
            )}

            {/* カウントダウン */}
            {countdown > 0 && (
              <div className="countdown-overlay">
                <div className="countdown-num" key={countdown}>{countdown}</div>
              </div>
            )}
          </>
        )}

        {/* ジョイスティック */}
        {phase === 'playing' && joyActive && (
          <div className="joystick-container" style={{ left: `${joyOrigin.x - 60}px`, top: `${joyOrigin.y - 60}px` }}>
            <div className="joystick-base active">
              <div className="joystick-stick" style={{ transform: `translate(${joyStick.x}px, ${joyStick.y}px)` }} />
            </div>
          </div>
        )}

        {/* タイトル */}
        {phase === 'title' && (
          <div className="overlay title-overlay" onPointerDown={() => audio.playMusic('title')}>
            <div className="title-card">
              <h1 className="title">🐹 がんばれハム子 <span className="dx">DX</span></h1>
              <p className="subtitle">猫の手から逃げて、制限時間内にアイテムを集めよう！</p>
              <p className="subtitle-2">⚡パワーアップ・🪨障害物・全{TOTAL_STAGES}ステージ</p>

              <div className="diff-list">
                <h2>難易度を選択</h2>
                {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
                  <button key={d} className={`diff-btn ${DIFFICULTY[d].klass}`} onClick={() => startGame(d)}>
                    <span className="diff-name">{DIFFICULTY[d].emoji} {DIFFICULTY[d].label}</span>
                    <span className="diff-info">
                      アイテム {DIFFICULTY[d].items}〜 / {DIFFICULTY[d].time}秒
                      <span className="diff-hi">🏆 {highScores[d].toLocaleString()}</span>
                    </span>
                  </button>
                ))}
              </div>

              <div className="control-hint">
                🕹️ 画面ドラッグ ・ ⌨️ 矢印/WASD キーで移動
                {tiltSupported && ' ・ 📱 傾きセンサー'}
              </div>
              <div className="title-btns">
                <button className="mute-btn" onClick={toggleMute}>{muted ? '🔇 ミュート中' : '🔊 サウンドON'}</button>
                {tiltSupported && (
                  <button className="mute-btn" onClick={toggleTilt}>
                    {tiltEnabled ? '📱 傾きON' : '📱 傾きOFF'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ステージクリア */}
        {phase === 'stageclear' && (
          <div className="overlay result-overlay">
            <div className="result-card">
              <h1 className="result-title clear">STAGE {w.stage} CLEAR!</h1>
              <div className="result-stats">
                <p>💰 スコア <span className="val">{w.score.toLocaleString()}</span></p>
                <p>⏱️ 残り時間ボーナス <span className="val">+{(w.remainingTime * 50).toLocaleString()}</span></p>
                <p>➡️ 次は STAGE {w.stage + 1}（敵が強くなる！）</p>
              </div>
              <div className="result-buttons">
                <button className="primary" onClick={nextStage}>次のステージへ ▶</button>
                <button className="ghost" onClick={backToTitle}>タイトル</button>
              </div>
            </div>
          </div>
        )}

        {/* ゲームオーバー */}
        {phase === 'gameover' && (
          <div className="overlay result-overlay">
            <div className="result-card">
              <h1 className="result-title over">GAME OVER</h1>
              <p className="result-diff">{DIFFICULTY[difficulty].emoji} {DIFFICULTY[difficulty].label} ・ STAGE {w.stage}</p>
              {isNewRecord && <p className="new-record">🎉 ハイスコア更新！</p>}
              <div className="result-stats">
                <p>💰 スコア <span className="val hl">{w.score.toLocaleString()}</span></p>
                <p>🌟 取得 <span className="val">{w.collected}/{w.totalItems}</span></p>
                <p>🏆 ベスト <span className="val">{highScores[difficulty].toLocaleString()}</span></p>
              </div>
              <div className="result-buttons">
                <button className="primary" onClick={retry}>リトライ 🔁</button>
                <button className="ghost" onClick={backToTitle}>タイトル</button>
              </div>
            </div>
          </div>
        )}

        {/* 全ステージクリア */}
        {phase === 'allclear' && (
          <div className="overlay result-overlay">
            <div className="result-card allclear-card">
              <h1 className="result-title allclear">🎉 ALL CLEAR! 🎉</h1>
              <p className="result-diff">{DIFFICULTY[difficulty].emoji} {DIFFICULTY[difficulty].label} 全{TOTAL_STAGES}ステージ制覇！</p>
              {isNewRecord && <p className="new-record">🏆 ハイスコア更新！</p>}
              <div className="result-stats">
                <p>💰 最終スコア <span className="val hl">{w.score.toLocaleString()}</span></p>
                <p>🏆 ベスト <span className="val">{highScores[difficulty].toLocaleString()}</span></p>
              </div>
              <div className="result-buttons">
                <button className="primary" onClick={retry}>もう一度 🔁</button>
                <button className="ghost" onClick={backToTitle}>タイトル</button>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
