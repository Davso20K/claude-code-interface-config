import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DashSkill, DashTask, DashTiming, DashUsage, DashWhere } from '../types'

const PANE = 'side-dashboard'
const tasks = atom({ plugin: 'side-dashboard', key: 'tasks' } as const, [] as DashTask[])
const usage = atom(
  { plugin: 'side-dashboard', key: 'usage' } as const,
  { window: 0, model: '…', limits: [] } as DashUsage,
)

const timing = atom(
  { plugin: 'side-dashboard', key: 'timing' } as const,
  { sessionStart: 0, now: 0 } as DashTiming,
)

const where = atom(
  { plugin: 'side-dashboard', key: 'where' } as const,
  { cwd: '' } as DashWhere,
)

const skill = atom(
  { plugin: 'side-dashboard', key: 'skill' } as const,
  { isActive: false } as DashSkill,
)

// Colonnes réservées à gauche par le moteur (pastille du mode) que le bandeau rattrape.
const GUTTER = 16

// Largeur de la barre de contexte, en cellules (rectangles ▬).
const BAR_WIDTH = 16

// Colonne réservée à l'icône d'un titre : assez large pour un emoji et un espace.
const ICON_COLS = 3


const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

const LIMIT_LABEL: Record<string, string> = { five_hour: 'Session 5h', seven_day: 'Hebdo 7j' }

const dur = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (days > 0) return `${days}j ${h}h`
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m${String(sec).padStart(2, '0')}s`

  return `${sec}s`
}

// Couleurs par clés de thème : elles suivent le thème de la personne (sombre, clair…).
const C = {
  border: 'promptBorder',
  title: 'suggestion',
  accent: 'claude',
  text: 'text',
  dim: 'inactive',
  green: 'success',
  track: 'subtle',
} as const

// Orange Claude (clé de thème), réservé au bandeau sous le prompt.
const BANNER = 'claude'

const ICON = { pending: '○', in_progress: '◐', completed: '●' } as const

const fmt = (n?: number) =>
  n === undefined ? '–' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

const bar = (percent: number, width: number) => {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

// Barre arrondie : rectangles ▬ entre deux demi-cercles ◖ ◗, hauteur moyenne.

const pill = (percent: number, width: number) => {
  const inner = Math.max(1, width - 2)
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * inner)

  return { filled, rest: inner - filled, isFull: filled === inner }
}

// ── Mise en forme des réponses ──────────────────────────────────────────────
type MdBlock =
  | { k: 'heading'; text: string }
  | { k: 'bullet'; level: number; marker: string; text: string }
  | { k: 'para'; text: string }
  | { k: 'insight'; items: MdBlock[] }

const INSIGHT_START = /^`?★\s*Insight/
const INSIGHT_END = /^`?[─-]{8,}`?$/

function parseMd(lines: string[]): MdBlock[] {
  const out: MdBlock[] = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (!line) continue

    if (INSIGHT_START.test(line)) {
      const inner: string[] = []
      for (i++; i < lines.length && !INSIGHT_END.test(lines[i].trim()); i++) inner.push(lines[i])
      out.push({ k: 'insight', items: parseMd(inner) })
      continue
    }

    const heading = /^#{1,4}\s+(.*)$/.exec(line) ?? /^\*\*([^*]+)\*\*:?$/.exec(line)
    if (heading) {
      out.push({ k: 'heading', text: heading[1].trim() })
      continue
    }

    const bullet = /^(\s*)([-*•]|\d+\.)\s+(.*)$/.exec(raw)
    if (bullet) {
      const marker = /^\d/.test(bullet[2]) ? bullet[2] : '•'
      out.push({ k: 'bullet', level: Math.floor(bullet[1].length / 2), marker, text: bullet[3] })
      continue
    }

    out.push({ k: 'para', text: line })
  }

  return out
}

// Découpe `code` et **gras** pour les dessiner à part.
function spans(text: string): { t: string; kind: 'plain' | 'code' | 'bold' }[] {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/)
    .filter(part => part !== '')
    .map(part =>
      part.startsWith('`')
        ? { t: part.slice(1, -1), kind: 'code' as const }
        : part.startsWith('**')
          ? { t: part.slice(2, -2), kind: 'bold' as const }
          : { t: part, kind: 'plain' as const },
    )
}

function headingStyle(text: string): { icon: string; color: string } {
  if (/limite|attention|risque|savoir|vérifier|problème|erreur/i.test(text)) return { icon: '⚠', color: 'warning' }
  if (/fait|chang|ajout|résultat|réussi|terminé|ok\b/i.test(text)) return { icon: '✓', color: 'success' }
  if (/insight/i.test(text)) return { icon: '💡', color: 'suggestion' }

  return { icon: '▸', color: 'suggestion' }
}

// Dossier et branche : relus au démarrage et après chaque tour (un `cd` ou un checkout les change).
async function refreshWhere($: EngineInterface) {
  const cwd = await $.session.cwd()
  let branch: string | undefined
  try {
    const r = await $.process.run(['git', 'branch', '--show-current'])
    const name = r.stdout.trim()
    branch = r.exitCode === 0 && name ? name : undefined
  } catch {
    branch = undefined
  }
  await update($, where, () => ({ cwd, branch }))
}

export const register: Register = on => {
  let nextTaskId = 1
  on('session.start', async ($, e, next) => {
    void $.ui.open({ id: PANE, title: 'Dashboard' })

    // Efface le texte de status line laissé par une version précédente du mod.
    $.ui.status(undefined)

    await refreshWhere($)

    // Chrono : un tick par seconde fait avancer la durée du tour et de la session.
    const start = (await $.session.usage()).startedAt
    await update($, timing, t => ({ ...t, sessionStart: start, now: start }))
    void $.clock.every(1000, async () => {
      const now = await $.clock.now()
      await update($, timing, t => ({ ...t, now }))
    })

    // Valeurs initiales, sans attendre la fin du premier tour.
    const now = await $.session.usage()
    const model = await $.session.model()
    await update($, usage, () => ({
      tokens: now.context.tokens,
      window: now.context.window,
      percent: now.context.percent,
      model,
      usd: now.cost?.usd,
      limits: now.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt })),
    }))

    return next(e)
  })

  // Ouvert sur une action de la personne (son premier message), le panneau se
  // dock dès 110 colonnes au lieu des 144 exigés d'une ouverture non sollicitée.
  let isOpenedByPrompt = false
  on('prompt.submit', async ($, e, next) => {
    if (!isOpenedByPrompt) {
      isOpenedByPrompt = true
      void $.ui.open({ id: PANE, title: 'Dashboard' })
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, timing, t => ({ ...t, turnStart: now, now }))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    await refreshWhere($)
    await update($, skill, k => ({ ...k, isActive: false }))
    await update($, timing, t => ({
      ...t,
      now,
      turnStart: undefined,
      lastTurn: t.turnStart === undefined ? t.lastTurn : now - t.turnStart,
    }))

    return next(e)
  })

  // Skill : `/nom`, outil Skill ou préchargement passent tous par skill.prompt.
  on('skill.prompt', async ($, e, next) => {
    await update($, skill, () => ({ name: e.skill, isActive: true }))

    return next(e)
  })

  // Tokens, coût et modèle : poussés par le moteur après chaque tour.
  on('session.measure', async ($, e, next) => {
    const model = await $.session.model()
    await update($, usage, () => ({
      tokens: e.context.tokens,
      window: e.context.window,
      percent: e.context.percent,
      model,
      usd: e.cost?.usd,
      limits: e.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt })),
    }))

    return next(e)
  })

  // Tâches : TodoWrite remplace la liste, TaskCreate/TaskUpdate la modifient ;
  // les travaux programmés (cron, réveil /loop) et sous-agents y figurent aussi.
  const short = (t: string, n = 48) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
  on('tool.call', async ($, e, next) => {
    $.ui.toast(`DEBUG tool.call: ${e.tool}`) // TEMP diagnostic
    if (e.tool === 'TodoWrite') {
      const list = e.todos.map((t, i) => ({
        id: String(i),
        label: t.content,
        status: t.status,
      }))
      await update($, tasks, () => list)
    } else if (e.tool === 'TaskCreate') {
      const task: DashTask = {
        id: `t${nextTaskId++}`,
        label: e.subject,
        status: 'pending',
      }
      await update($, tasks, list => [...list, task])
    } else if (e.tool === 'TaskUpdate') {
      const { taskId, status, subject } = e
      await update($, tasks, list =>
        status === 'deleted'
          ? list.filter(t => t.id !== taskId)
          : list.map(t =>
              t.id === taskId
                ? { ...t, status: status ?? t.status, label: subject ?? t.label }
                : t,
            ),
      )
    } else if (e.tool === 'CronCreate') {
      const task: DashTask = {
        id: `c${nextTaskId++}`,
        label: `⏰ ${e.cron} · ${short(e.prompt)}`,
        status: 'pending',
      }
      await update($, tasks, list => [...list, task])
    } else if (e.tool === 'ScheduleWakeup') {
      await update($, tasks, list => {
        const rest = list.filter(t => t.id !== 'wakeup')
        if (e.stop) return rest
        const mins = Math.round((e.delaySeconds ?? 0) / 60)
        const task: DashTask = {
          id: 'wakeup',
          label: `⏰ réveil dans ${mins} min · ${short(e.reason ?? 'boucle')}`,
          status: 'pending',
        }
        return [...rest, task]
      })
    } else if (e.tool === 'Agent') {
      const id = `a${nextTaskId++}`
      const task: DashTask = { id, label: `🤖 ${short(e.description)}`, status: 'in_progress' }
      await update($, tasks, list => [...list, task])
      const result = await next(e)
      await update($, tasks, list => list.map(t => (t.id === id ? { ...t, status: 'completed' } : t)))

      return result
    }

    return next(e)
  })

  // Tes messages envoyés : le texte entre < >, sans cadre. Les autres origines
  // (notifications, autres agents) gardent le rendu du moteur.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const { text, origin } = e.props
    if (origin.kind !== 'composer' || !text.trim()) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box marginY={1}>
        <Text>
          <Text bold color={C.accent}>
            {'[ '}
          </Text>
          {text}
          <Text bold color={C.accent}>
            {' ]'}
          </Text>
        </Text>
      </Box>
    )
  })

  // Réponses : titres en couleur, listes alignées, blocs Insight dans un cadre.
  // Tableaux et blocs de code restent au rendu natif du moteur.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const text = e.props.text
    if (e.props.isSummary || !text.trim() || /```|^\s*\|/m.test(text)) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    const inline = (raw: string) => (
      <Text>
        {spans(raw).map(sp =>
          sp.kind === 'code' ? (
            <Text color={C.title}>{sp.t}</Text>
          ) : sp.kind === 'bold' ? (
            <Text bold>{sp.t}</Text>
          ) : (
            sp.t
          ),
        )}
      </Text>
    )

    const draw = (b: MdBlock, i: number, all: MdBlock[]) => {
      if (b.k === 'heading') {
        const st = headingStyle(b.text)

        return (
          <Box marginTop={1}>
            <Box flexShrink={0} width={ICON_COLS}>
              <Text color={st.color}>{st.icon}</Text>
            </Box>
            <Text bold color={st.color}>
              {b.text}
            </Text>
          </Box>
        )
      }
      if (b.k === 'bullet') {
        return (
          <Box paddingLeft={ICON_COLS + b.level * 2}>
            <Box flexShrink={0}>
              <Text color={C.dim}>{b.marker} </Text>
            </Box>
            <Box flexShrink={1}>{inline(b.text)}</Box>
          </Box>
        )
      }
      if (b.k === 'insight') {
        return (
          <Box
            marginTop={1}
            flexDirection="column"
            borderStyle="round"
            borderColor={C.border}
            paddingX={1}
          >
            <Box>
              <Box flexShrink={0} width={ICON_COLS}>
                <Text color={C.title}>💡</Text>
              </Box>
              <Text bold color={C.title}>
                Insight
              </Text>
            </Box>
            {b.items.map(draw)}
          </Box>
        )
      }

      const prev = all[i - 1]

      return prev && prev.k !== 'para' ? <Box marginTop={1}>{inline(b.text)}</Box> : inline(b.text)
    }

    return <Box flexDirection="column">{parseMd(text.split('\n')).map(draw)}</Box>
  })

  // Bandeau sous le prompt, pleine largeur, calé à gauche.
  on('ui.render', { component: 'PromptHint' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const w = await read($, where)

    return (
      <Box
        flexDirection="column"
        position="relative"
        left={-GUTTER}
        marginTop={1}
        width={(e.viewport?.columns ?? 100) - 6}
      >
        <Box borderStyle="round" borderColor={BANNER} paddingX={1} gap={1} width="100%">
          <Box flexShrink={0}>
            <Text bold color={BANNER} wrap="truncate">
              ⎇ {w.branch ?? 'pas de git'}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text color={C.dim}>·</Text>
          </Box>
          <Box flexShrink={0}>
            <Text color={C.text} wrap="truncate">
              📁 {baseName(w.cwd)}
            </Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text color={C.dim} wrap="truncate-start">
              {w.cwd}
            </Text>
          </Box>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, tasks)
    const u = await read($, usage)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 24)
    const t = await read($, timing)
    const k = await read($, skill)
    const percent = u.percent ?? 0
    const done = list.filter(x => x.status === 'completed').length

    const filledPill = pill(percent, BAR_WIDTH + 2)
    const turnLabel = t.turnStart !== undefined ? '⏱ tour en cours' : 'dernier tour'
    const turnValue =
      t.turnStart !== undefined
        ? dur(t.now - t.turnStart)
        : t.lastTurn !== undefined
          ? dur(t.lastTurn)
          : '–'

    const card = (title: string, children: unknown) => (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={C.border}
        paddingX={1}
      >
        <Text bold color={C.accent}>
          {title}
        </Text>
        {children}
      </Box>
    )
    const row = (label: string, value: string, color: string = C.text) => (
      <Box justifyContent="space-between">
        <Text color={C.dim}>{label}</Text>
        <Text color={color}>{value}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1} padding={1}>
        {card(
          'Contexte',
          <Box flexDirection="column">
            <Box gap={2}>
              <Text>
                <Text color={filledPill.filled > 0 ? C.text : C.track}>◖</Text>
                <Text color={C.text}>{'▬'.repeat(filledPill.filled)}</Text>
                <Text color={C.track}>{'▬'.repeat(filledPill.rest)}</Text>
                <Text color={filledPill.isFull ? C.text : C.track}>◗</Text>
              </Text>
              <Text bold color={C.text}>
                {Math.round(percent)}%
              </Text>
            </Box>
            <Text color={C.dim}>
              {fmt(u.tokens)} / {fmt(u.window)} tokens
            </Text>
          </Box>,
        )}
        {card(
          'Limites',
          <Box flexDirection="column">
            {u.limits.length === 0 && <Text color={C.dim}>Pas de donnée.</Text>}
            {u.limits.map(l => {
              const lp = pill(l.percent, BAR_WIDTH + 2)
              const ms = l.resetsAt ? Date.parse(l.resetsAt) - t.now : NaN
              return (
                <Box flexDirection="column">
                  <Box gap={2}>
                    <Text>
                      <Text color={lp.filled > 0 ? C.text : C.track}>◖</Text>
                      <Text color={C.text}>{'▬'.repeat(lp.filled)}</Text>
                      <Text color={C.track}>{'▬'.repeat(lp.rest)}</Text>
                      <Text color={lp.isFull ? C.text : C.track}>◗</Text>
                    </Text>
                    <Text bold color={C.text}>
                      {Math.round(l.percent)}%
                    </Text>
                  </Box>
                  <Text color={C.dim}>
                    {LIMIT_LABEL[l.kind] ?? l.kind}
                    {Number.isNaN(ms) ? '' : ` · reset ${dur(ms)}`}
                  </Text>
                </Box>
              )
            })}
          </Box>,
        )}
        {card(
          'Session',
          <Box flexDirection="column">
            {row('modèle', u.model)}
            {u.usd !== undefined && row('coût', `$${u.usd.toFixed(2)}`)}
            {row('session', dur(t.now - t.sessionStart))}
            {row(turnLabel, turnValue, t.turnStart !== undefined ? C.green : C.text)}
            {k.name && row(k.isActive ? '✦ skill' : 'dernier skill', k.name, k.isActive ? C.green : C.dim)}
          </Box>,
        )}
        {card(
          `Tâches (${done}/${list.length})`,
          <Box flexDirection="column">
            {list.length === 0 && <Text color={C.dim}>Aucune tâche.</Text>}
            {list.slice(-room).map(x => (
              <Text
                color={x.status === 'completed' ? C.dim : x.status === 'in_progress' ? C.green : C.text}
              >
                {ICON[x.status]} {x.label}
              </Text>
            ))}
          </Box>,
        )}
      </Box>
    )
  })
}
