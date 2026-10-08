export type DashLimit = { kind: string; percent: number; resetsAt?: string }

export type DashUsage = {
  tokens?: number
  window: number
  percent?: number
  model: string
  usd?: number
  limits: DashLimit[]
}

export type DashTiming = {
  sessionStart: number
  now: number
  turnStart?: number
  lastTurn?: number
}

export type DashWhere = { cwd: string; branch?: string }

export type DashSkill = { name?: string; isActive: boolean }

declare module 'claude-code' {
  interface PluginState {
    'side-dashboard': { usage: DashUsage; timing: DashTiming; where: DashWhere; skill: DashSkill }
  }
}
