import { expect, test } from 'claude-code/testing'

test('le panneau affiche contexte, limites et session', async $ => {
  const ui = await $.ui.mount({
    plugin: 'side-dashboard',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'side-dashboard',
    props: { title: 'Dashboard', focused: false },
  })

  expect(await ui.find({ type: 'Text', text: /Contexte/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Limites/ })).toBeDefined()
  await ui.unmount()
})

test('une réponse est mise en forme : titre, puce, bloc Insight', async $ => {
  const text = [
    '**Ce qui change**',
    '- le `mod` est **prêt**',
    '',
    '`★ Insight ─────────`',
    '- un point clé',
    '`─────────────────────`',
  ].join('\n')
  const ui = await $.ui.mount({
    plugin: 'side-dashboard',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
  })

  expect(await ui.find({ type: 'Text', text: /Ce qui change/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Insight/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /un point clé/ })).toBeDefined()
  await ui.unmount()
})

test('un message envoyé est dessiné dans une carte', async $ => {
  const ui = await $.ui.mount({
    plugin: 'side-dashboard',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: 'bonjour le test', origin: { kind: 'composer' }, isExpanded: true },
  })

  expect(await ui.find({ type: 'Text', text: /bonjour le test/ })).toBeDefined()
  await ui.unmount()
})

test('les fichiers lus et modifiés apparaissent dans le panneau', async ($, on) => {
  on('tool.call', async () => ({ ref: 'x', result: 'ok', text: 'ok' }) as never)
  await $.tool.call({ tool: 'Read', file_path: 'C:/proj/a.ts' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'C:/proj/b.ts', old_string: 'x', new_string: 'y' } as never)

  const ui = await $.ui.mount({
    plugin: 'side-dashboard',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'side-dashboard',
    props: { title: 'Dashboard', focused: false },
  })

  expect(await ui.find({ type: 'Text', text: /Fichiers touchés/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /a\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /b\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /modifié/ })).toBeDefined()
  await ui.unmount()
})

test('une réponse est aérée : paragraphe, citation, liste longue, code natif', async ($, on) => {
  // Le moteur dessine lui-même les segments de code : on le simule.
  on('ui.render', async (_$, e) => h('Text', {}, `natif:${(e.props as { text: string }).text}`) as never)
  const text = [
    '> ⚠️ **Point à formuler avec honnêteté.** Un agent dédié est prévu',
    '> dans la roadmap mais pas encore construit.',
    '',
    'Ce qui existe déjà :',
    '- **Le texte réglementaire est une source à part entière.** Le questionnaire demande s\'il existe un texte.',
    '- **Des garde-fous ciblés.** Une signature électronique n\'est autorisée que si sa reconnaissance est établie.',
    '',
    '```ts',
    'const x = 1',
    '```',
  ].join('\n')
  const ui = await $.ui.mount({
    plugin: 'side-dashboard',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
  })

  expect(await ui.find({ type: 'Text', text: /pas encore construit/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Ce qui existe déjà/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Des garde-fous ciblés/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /natif:```ts/ })).toBeDefined()
  await ui.unmount()
})

test('un titre numéroté prend un disque plein, ses puces gardent leur numéro', async $ => {
  const ui = await $.ui.mount({
    plugin: 'side-dashboard',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '## 5. Utiliser les LLM\n\n1. premier point\n2. second point', isFirstOfReply: true },
  })

  expect(await ui.find({ type: 'Text', text: /❺/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Utiliser les LLM/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1\./ })).toBeDefined()
  await ui.unmount()
})

test('une puce numérotée qui s’ouvre sur un titre en gras prend un disque, pas une puce simple', async $ => {
  const ui = await $.ui.mount({
    plugin: 'side-dashboard',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '1. **Définir ton objectif** : web, mobile\n2. **Choisir un langage** : Python\n\n1. une simple étape', isFirstOfReply: true },
  })

  expect(await ui.find({ type: 'Text', text: /❶/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /❷/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Définir ton objectif/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1\./ })).toBeDefined()
  await ui.unmount()
})
