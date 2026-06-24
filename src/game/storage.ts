import type { Difficulty } from './types'

const KEY = 'fighthamuko-dx-highscore-v1'

export type HighScores = Record<Difficulty, number>

const DEFAULTS: HighScores = { easy: 0, normal: 0, hard: 0, oni: 0 }

export function loadHighScores(): HighScores {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<HighScores>
    return {
      easy: Number(parsed.easy) || 0,
      normal: Number(parsed.normal) || 0,
      hard: Number(parsed.hard) || 0,
      oni: Number(parsed.oni) || 0,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

/** スコアがハイスコアを更新した場合のみ保存し、更新されたかを返す */
export function saveHighScore(
  current: HighScores,
  difficulty: Difficulty,
  score: number,
): { scores: HighScores; isNewRecord: boolean } {
  if (score <= current[difficulty]) {
    return { scores: current, isNewRecord: false }
  }
  const scores: HighScores = { ...current, [difficulty]: score }
  try {
    localStorage.setItem(KEY, JSON.stringify(scores))
  } catch {
    // localStorage が使えない環境では黙って無視
  }
  return { scores, isNewRecord: true }
}
