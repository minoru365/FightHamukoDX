// ゲーム共通の型定義

export type Difficulty = 'easy' | 'normal' | 'hard' | 'oni'

export type Phase =
  | 'title'
  | 'ready'
  | 'playing'
  | 'stageclear'
  | 'gameover'
  | 'allclear'

export type EnemyKind = 'chaser' | 'ambush' | 'patrol'

export type PowerKind = 'shield' | 'speed' | 'magnet' | 'slow' | 'time'

export interface Vec {
  x: number
  y: number
}

export interface Player extends Vec {
  vx: number
  vy: number
  angle: number
  walking: boolean
  walkFrame: 1 | 2
  walkTimer: number
}

export interface Enemy extends Vec {
  kind: EnemyKind
  angle: number
  speed: number
  // patrol 用の進行方向
  dirX: number
  dirY: number
}

export interface Item extends Vec {
  id: number
  type: 1 | 2 | 3
  collected: boolean
  bob: number // 上下ゆれ用の位相
}

export interface Obstacle extends Vec {
  id: number
  r: number
  emoji: string
}

export interface PowerUp extends Vec {
  id: number
  kind: PowerKind
  ttl: number // フィールド上に残る秒数
}

export interface Particle extends Vec {
  id: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: string
  size: number
}

export interface Floater {
  id: number
  x: number
  y: number
  vy: number
  life: number
  text: string
  color: string
  size: number
}

export interface Effects {
  shield: number
  speed: number
  magnet: number
  slow: number
}

export interface World {
  player: Player
  enemies: Enemy[]
  items: Item[]
  obstacles: Obstacle[]
  powerups: PowerUp[]
  particles: Particle[]
  floaters: Floater[]
  effects: Effects
  combo: number
  comboTimer: number
  score: number
  collected: number
  totalItems: number
  remainingTime: number
  timeAcc: number
  shake: number
  stage: number
  spawnTimer: number
  blockCd: number
  nextId: number
}
