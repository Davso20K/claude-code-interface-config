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
