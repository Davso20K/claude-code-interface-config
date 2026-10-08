import { expect, test } from 'claude-code/testing'

test('le panneau affiche contexte, session et tâches', async $ => {
  const ui = await $.ui.mount({
    plugin: 'side-dashboard',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'side-dashboard',
    props: { title: 'Dashboard', focused: false },
  })

  expect(await ui.find({ type: 'Text', text: /Contexte/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Aucune tâche/ })).toBeDefined()
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

test('un sous-agent lancé apparaît dans les tâches puis passe à terminé', async ($, on) => {
  on('tool.call', async () => ({ ref: 'x', result: 'ok', text: 'ok' }) as never)
  await $.tool.call({ tool: 'Agent', description: 'Chercher le bug', prompt: 'cherche' } as never)

  const ui = await $.ui.mount({
    plugin: 'side-dashboard',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'side-dashboard',
    props: { title: 'Dashboard', focused: false },
  })

  expect(await ui.find({ type: 'Text', text: /Chercher le bug/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Tâches \(1\/1\)/ })).toBeDefined()
  await ui.unmount()
})
