import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DashFile, DashSkill, DashTiming, DashUsage, DashWhere } from '../types'

const PANE = 'side-dashboard'
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

const files = atom(
  { plugin: 'side-dashboard', key: 'files' } as const,
  [] as DashFile[],
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
  // Crème ivoire : second neutre chaud (le vert et le sable ne plaisaient pas). Même valeur que `suggestion` dans le thème.
  soft: '#f3ead8',
  track: 'subtle',
} as const

// Bandeau du bas : sans contour, branche en crème ivoire comme « auto mode on » (clé `warning` du thème).
const BRANCH = C.soft

// Réponses : orange Claude pour les titres et les crochets, neutres pour le reste ; `code` en pastille sombre.
const R = {
  heading: C.accent,
  icon: 'inactive',
  code: C.soft,
  codeBg: '#2f2f2f',
} as const

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
// `gap` : une ligne vide précédait le bloc dans le texte d'origine.
type MdBlock = { gap?: boolean } & (
  | { k: 'heading'; text: string }
  | { k: 'bullet'; level: number; marker: string; text: string }
  | { k: 'para'; text: string }
  | { k: 'quote'; text: string }
  | { k: 'insight'; items: MdBlock[] }
  // Bloc de code ou tableau : dessiné par le moteur, segment par segment.
  | { k: 'raw'; text: string }
)

const INSIGHT_START = /^`?★\s*Insight/
const INSIGHT_END = /^`?[─-]{8,}`?$/
const FENCE = /^\s*(```|~~~)/
const TABLE_ROW = /^\s*\|/
function parseMd(lines: string[]): MdBlock[] {
  const out: MdBlock[] = []
  let gap = false
  const push = (b: MdBlock) => {
    out.push({ ...b, gap })
    gap = false
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (!line) {
      gap = true
      continue
    }

    const fence = FENCE.exec(raw)
    if (fence) {
      const seg = [raw]
      for (i++; i < lines.length; i++) {
        seg.push(lines[i])
        if (lines[i].trim().startsWith(fence[1])) break
      }
      push({ k: 'raw', text: seg.join('\n') })
      continue
    }

    if (TABLE_ROW.test(raw)) {
      const seg = [raw]
      while (i + 1 < lines.length && TABLE_ROW.test(lines[i + 1])) seg.push(lines[++i])
      push({ k: 'raw', text: seg.join('\n') })
      continue
    }

    if (INSIGHT_START.test(line)) {
      const inner: string[] = []
      for (i++; i < lines.length && !INSIGHT_END.test(lines[i].trim()); i++) inner.push(lines[i])
      push({ k: 'insight', items: parseMd(inner) })
      continue
    }

    const heading = /^#{1,4}\s+(.*)$/.exec(line) ?? /^\*\*([^*]+)\*\*:?$/.exec(line)
    if (heading) {
      push({ k: 'heading', text: heading[1].trim() })
      continue
    }

    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      const prev = out[out.length - 1]
      // Les lignes d'une même citation se suivent : on les recolle.
      if (prev?.k === 'quote' && !gap) prev.text += quote[1] ? ' ' + quote[1] : ''
      else if (quote[1]) push({ k: 'quote', text: quote[1] })
      continue
    }

    const bullet = /^(\s*)([-*•]|\d+\.)\s+(.*)$/.exec(raw)
    if (bullet) {
      const marker = /^\d/.test(bullet[2]) ? bullet[2] : '•'
      push({ k: 'bullet', level: Math.floor(bullet[1].length / 2), marker, text: bullet[3] })
      continue
    }

    push({ k: 'para', text: line })
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
          ? { t: part.slice(2, -2).replace(/`/g, ''), kind: 'bold' as const }
          : { t: part, kind: 'plain' as const },
    )
}

// Puce numérotée dont le texte s'ouvre sur un **titre en gras** : elle joue le rôle de titre, son numéro devient un disque.
function discMarker(marker: string, text: string): string | undefined {
  const m = /^(\d{1,2})\.$/.exec(marker)
  if (!m || +m[1] < 1 || +m[1] > DISC.length || !/^\*\*[^*]+\*\*/.test(text)) return undefined

  return DISC[+m[1] - 1]
}

// Titre numéroté (« 5. Évaluation ») : le numéro devient un disque plein ❺ à la place de l'icône.
const DISC = ['❶', '❷', '❸', '❹', '❺', '❻', '❼', '❽', '❾', '❿']
function numberedHeading(text: string): { disc: string; title: string } | undefined {
  const m = /^(\d{1,2})[.)]\s+(.+)$/.exec(text)
  if (!m || +m[1] < 1 || +m[1] > DISC.length) return undefined

  return { disc: DISC[+m[1] - 1], title: m[2] }
}

function headingStyle(text: string): { icon: string; color: string } {
  if (/limite|attention|risque|savoir|vérifier|problème|erreur/i.test(text)) return { icon: '⚠', color: '#f2c94c' }
  if (/fait|chang|ajout|résultat|réussi|terminé|ok\b/i.test(text)) return { icon: '✓', color: C.accent }
  if (/insight/i.test(text)) return { icon: '💡', color: R.icon }

  return { icon: '◆', color: R.icon }
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

// Effort connu avant la première requête : variable d'environnement, puis réglage
// du modèle (`modelSettings`), puis réglage global. turn.step le remplace ensuite.
async function startEffort($: EngineInterface, model: string): Promise<string | undefined> {
  const fromEnv = await $.env.get('CLAUDE_CODE_EFFORT_LEVEL')
  if (fromEnv) {
    return fromEnv
  }

  const perModel = (await $.settings.read({ key: 'modelSettings' })) as
    | Record<string, { effortLevel?: string } | undefined>
    | undefined
  const global = (await $.settings.read({ key: 'effortLevel' })) as string | undefined

  return perModel?.[model]?.effortLevel ?? global
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    void $.ui.open({ id: PANE, title: 'Dashboard' })

    // Efface le texte de status line laissé par une version précédente du mod.
    $.ui.status(undefined)

    // Dossier et horloge connus tout de suite : le bandeau et la durée s'affichent dès l'ouverture.
    await update($, where, () => ({ cwd: e.cwd, branch: undefined }))
    const t0 = await $.clock.now()
    await update($, timing, t => ({ ...t, sessionStart: t0, now: t0 }))

    // Le reste (branche git, chiffres du panneau) se charge en arrière-plan : un appel lent
    // ne doit ni bloquer le démarrage de la session ni retarder l'affichage jusqu'au premier message.
    void (async () => {
      try {
        await refreshWhere($)
      } catch {
        // le bandeau garde le dossier de départ
      }

      try {
        const now = await $.session.usage()
        const model = await $.session.model()
        const effort = await startEffort($, model)
        await update($, timing, t => ({ ...t, sessionStart: now.startedAt, now: now.startedAt }))
        await update($, usage, u => ({
          ...u,
          // turn.step a pu passer avant : sa valeur (l'effort réellement envoyé) prime.
          effort: u.effort ?? effort,
          tokens: now.context.tokens,
          window: now.context.window,
          percent: now.context.percent,
          model,
          usd: now.cost?.usd,
          limits: now.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt })),
        }))
      } catch {
        // le panneau se remplira à la fin du premier tour
      }
    })()

    // Chrono : un tick par seconde fait avancer la durée du tour et de la session.
    void $.clock.every(1000, async () => {
      const now = await $.clock.now()
      await update($, timing, t => ({ ...t, now }))
    })

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

  // Fichiers touchés : les arguments de l'outil sont directement sur l'événement.
  on('tool.call', async ($, e, next) => {
    const hit =
      e.tool === 'Read'
        ? { path: e.file_path, action: 'lu' as const }
        : e.tool === 'Edit' || e.tool === 'Write'
          ? { path: e.file_path, action: 'modifié' as const }
          : undefined
    if (hit) {
      await update($, files, list => [...list.filter(f => f.path !== hit.path), hit].slice(-30))
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
    await update($, usage, u => ({
      ...u,
      tokens: e.context.tokens,
      window: e.context.window,
      percent: e.context.percent,
      model,
      usd: e.cost?.usd,
      limits: e.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt })),
    }))

    return next(e)
  })

  // Effort : lu sur chaque requête de la boucle principale (les sous-agents ont le leur).
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort = e.effort === undefined ? undefined : String(e.effort)
      const u = await read($, usage)
      if (u.effort !== effort) {
        await update($, usage, x => ({ ...x, effort }))
      }
    }

    return yield* next(e)
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
          <Text color={R.heading}>
            {'[ '}
          </Text>
          {text}
          <Text color={R.heading}>
            {' ]'}
          </Text>
        </Text>
      </Box>
    )
  })

  // Réponses : titres en couleur, listes alignées et aérées, blocs Insight dans un cadre.
  // Tableaux et blocs de code sont dessinés par le moteur, au milieu du reste.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const text = e.props.text
    if (e.props.isSummary || !text.trim()) {
      return next(e)
    }

    const blocks = parseMd(text.split('\n'))
    // Un message fait seulement de code ou de tableaux : rien à mettre en forme.
    if (blocks.every(b => b.k === 'raw')) {
      return next(e)
    }

    // Les segments natifs se demandent au moteur avant de dessiner.
    const native = new Map<MdBlock, Awaited<ReturnType<typeof next>>>()
    for (const b of blocks) {
      if (b.k === 'raw') native.set(b, await next({ ...e, props: { ...e.props, text: b.text, isFirstOfReply: false } }))
    }

    const { Box, Text } = $.ui.resolve(e)

    const inline = (raw: string, italic = false) => (
      <Text italic={italic}>
        {spans(raw).map(sp =>
          sp.kind === 'code' ? (
            <Text color={R.code} backgroundColor={R.codeBg}>
              {` ${sp.t} `}
            </Text>
          ) : sp.kind === 'bold' ? (
            <Text bold>{sp.t}</Text>
          ) : (
            sp.t
          ),
        )}
      </Text>
    )

    const draw = (b: MdBlock, i: number, all: MdBlock[]): ReturnType<typeof inline> => {
      const prev = all[i - 1]
      // Une ligne vide avant un bloc s'il y en avait une dans le texte,
      // ou s'il change de nature (titre puis liste, paragraphe puis liste...).
      const spaced = !!prev && (!!b.gap || prev.k !== b.k)

      if (b.k === 'heading') {
        const num = numberedHeading(b.text)
        const st = num ? { icon: num.disc, color: C.accent } : headingStyle(b.text)

        return (
          <Box marginTop={prev ? 1 : 0}>
            <Box flexShrink={0} width={ICON_COLS}>
              <Text color={st.color}>{st.icon}</Text>
            </Box>
            <Text color={R.heading}>
              {num ? num.title : b.text}
            </Text>
          </Box>
        )
      }
      if (b.k === 'bullet') {
        // Les puces d'une même liste restent serrées, même séparées par une ligne vide.
        // Exception : les puces à disque jouent le rôle de titres, longues et sur plusieurs lignes : on les sépare.
        const isTitle = !!discMarker(b.marker, b.text)
        const prevIsTitle = prev?.k === 'bullet' && !!discMarker(prev.marker, prev.text)
        const top = (spaced && prev.k !== 'bullet') || (isTitle && prevIsTitle)

        return (
          <Box marginTop={top ? 1 : 0} paddingLeft={ICON_COLS + b.level * 2}>
            <Box flexShrink={0}>
              {(() => {
                const disc = discMarker(b.marker, b.text)

                return disc ? <Text color={C.accent}>{disc}  </Text> : <Text color={C.dim}>{b.marker}  </Text>
              })()}
            </Box>
            <Box flexShrink={1}>{inline(b.text)}</Box>
          </Box>
        )
      }
      if (b.k === 'quote') {
        return (
          <Box marginTop={spaced ? 1 : 0}>
            <Box flexShrink={0} width={2}>
              <Text color={C.dim}>│</Text>
            </Box>
            <Box flexShrink={1}>{inline(b.text, true)}</Box>
          </Box>
        )
      }
      if (b.k === 'insight') {
        return (
          <Box
            marginTop={prev ? 1 : 0}
            flexDirection="column"
            borderStyle="round"
            borderColor={C.border}
            paddingX={1}
          >
            <Box>
              <Box flexShrink={0} width={ICON_COLS}>
                <Text>💡</Text>
              </Box>
              <Text color={R.heading}>
                Insight
              </Text>
            </Box>
            {b.items.map((x, j, xs) => draw(x, j, xs))}
          </Box>
        )
      }
      if (b.k === 'raw') {
        return <Box marginTop={prev ? 1 : 0}>{native.get(b)}</Box>
      }

      return spaced ? <Box marginTop={1}>{inline(b.text)}</Box> : inline(b.text)
    }

    return <Box flexDirection="column">{blocks.map((b, i) => draw(b, i, blocks))}</Box>
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
        <Box paddingX={2} gap={1} width="100%">
          <Box flexShrink={0}>
            <Text bold color={BRANCH} wrap="truncate">
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
    const u = await read($, usage)
    const t = await read($, timing)
    const k = await read($, skill)
    const touched = (await read($, files)).slice(-6).reverse()
    const percent = u.percent ?? 0

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
      <Box flexDirection="column" paddingX={1}>
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
            {row('effort', u.effort ?? '–', u.effort ? C.soft : C.dim)}
            {u.usd !== undefined && row('coût', `$${u.usd.toFixed(2)}`)}
            {row('session', t.sessionStart > 0 ? dur(t.now - t.sessionStart) : '–')}
            {row(turnLabel, turnValue, t.turnStart !== undefined ? C.soft : C.text)}
            {k.name && row(k.isActive ? '✦ skill' : 'skill', k.name, k.isActive ? C.soft : C.dim)}
          </Box>,
        )}
        {card(
          'Fichiers touchés',
          <Box flexDirection="column">
            {touched.length === 0 && <Text color={C.dim}>Aucun fichier.</Text>}
            {touched.map(f => (
              <Box justifyContent="space-between" gap={1}>
                <Box flexShrink={1} minWidth={0}>
                  <Text color={C.text} wrap="truncate-start">
                    {baseName(f.path)}
                  </Text>
                </Box>
                <Box flexShrink={0}>
                  <Text color={f.action === 'modifié' ? C.soft : C.dim}>{f.action}</Text>
                </Box>
              </Box>
            ))}
          </Box>,
        )}
      </Box>
    )
  })
}
