import { describe, expect, test } from 'claude-code/testing'

const REPLY = [
  '**Needs you**',
  '- Approve the wording.',
  '- Pick A or B.',
  '',
  'The rest of the report, which is not an ask.',
].join('\n')

const SURFACES = ['terminal', 'desktop'] as const

/**
 * Stands in for the engine beneath the plugin: a turn ends on whatever `last.text` holds, a
 * prompt passes through, and a reply the plugin leaves alone is drawn as plain text. The kit
 * wants these registered before the test first calls `$`.
 */
function engine(on: any) {
  const last = { text: '' }
  const submitted: Array<{ text: string; origin: unknown }> = []
  on('turn.complete', () => ({ text: last.text }))
  on('prompt.submit', (_$: unknown, e: any) => {
    submitted.push({ text: e.text, origin: e.origin })
    return e
  })
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'drawn by the engine' }))
  return {
    submitted,
    finishTurn: async ($: any, text: string, agentId?: string) => {
      last.text = text
      await $.turn.complete({ answer: text, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', agentId })
    },
  }
}

function mount($: any, surface: (typeof SURFACES)[number], text: string) {
  return $.ui.mount({
    plugin: 'needs-you',
    surface,
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
  })
}

describe('needs-you', () => {
  for (const surface of SURFACES) {
    test(`boxes the Needs you section and keeps the rest as text (${surface})`, async ($, on) => {
      engine(on)
      const ui = await mount($, surface, REPLY)
      expect((await ui.find({ type: 'Text', text: 'Needs you' })) !== undefined).toBe(true)
      expect((await ui.find({ type: 'Markdown', text: 'Pick A or B.' }))?.text).toBe('- Approve the wording.\n- Pick A or B.')
      expect((await ui.find({ type: 'Markdown', text: 'The rest' }))?.text).toBe('The rest of the report, which is not an ask.')
    })
  }

  test('the latest reply with a section hops, and settles once Rob sends a prompt', async ($, on) => {
    const { finishTurn } = engine(on)
    await finishTurn($, REPLY)
    const ui = await mount($, 'desktop', REPLY)
    const hopping = await ui.find({ type: 'Svg' })
    expect(String(hopping?.props.source)).toContain('animateTransform')
    expect(hopping?.props.alt).toBe('Claude hopping')

    await $.prompt.submit({ text: 'done', wait: false, origin: { kind: 'composer' } })
    const settled = await ui.find({ type: 'Svg' })
    expect(String(settled?.props.source)).not.toContain('animateTransform')
    expect(settled?.props.alt).toBe('Claude')
  })

  test('only the latest reply with a section hops', async ($, on) => {
    const { finishTurn } = engine(on)
    const first = '**Needs you**\nApprove A.'
    const second = '**Needs you**\nApprove B.'
    await finishTurn($, first)
    await $.prompt.submit({ text: 'done', wait: false, origin: { kind: 'composer' } })
    await finishTurn($, second)
    expect((await (await mount($, 'desktop', first)).find({ type: 'Svg' }))?.props.alt).toBe('Claude')
    expect((await (await mount($, 'desktop', second)).find({ type: 'Svg' }))?.props.alt).toBe('Claude hopping')
  })

  for (const kind of ['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message']) {
    test(`a ${kind} prompt and its turn leave an unanswered ask hopping`, async ($, on) => {
      const { finishTurn } = engine(on)
      await finishTurn($, REPLY)
      await $.prompt.submit({ text: 'Something finished.', wait: false, origin: { kind } as any })
      expect((await (await mount($, 'desktop', REPLY)).find({ type: 'Svg' }))?.props.alt).toBe('Claude hopping')
      await finishTurn($, 'Noted. Nothing else to do.')
      expect((await (await mount($, 'desktop', REPLY)).find({ type: 'Svg' }))?.props.alt).toBe('Claude hopping')
    })
  }

  test('a new section in a turn Rob did not start takes over the hop', async ($, on) => {
    const { finishTurn } = engine(on)
    const first = '**Needs you**\nApprove A.'
    const second = '**Needs you**\nApprove B.'
    await finishTurn($, first)
    await $.prompt.submit({ text: 'Agent finished.', wait: false, origin: { kind: 'task-notification' } as any })
    await finishTurn($, second)
    expect((await (await mount($, 'desktop', first)).find({ type: 'Svg' }))?.props.alt).toBe('Claude')
    expect((await (await mount($, 'desktop', second)).find({ type: 'Svg' }))?.props.alt).toBe('Claude hopping')
  })

  test('a turn Rob started that ends without a section leaves everything still', async ($, on) => {
    const { finishTurn } = engine(on)
    await finishTurn($, REPLY)
    await $.prompt.submit({ text: 'Thanks', wait: false, origin: { kind: 'composer' } })
    await finishTurn($, 'All done.')
    const ui = await mount($, 'desktop', REPLY)
    expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Claude')
  })

  test('finds the marker after a closed code block', async ($, on) => {
    engine(on)
    const ui = await mount($, 'desktop', 'Ran:\n\n```\nnpm test\n```\n\n**Needs you**\n- Approve the merge.')
    expect(await boxed(ui)).toEqual(['- Approve the merge.'])
  })

  test('a # comment inside a fenced block does not end the section', async ($, on) => {
    engine(on)
    const ui = await mount($, 'desktop', '**Needs you**\n```bash\n# update the marketplace\nclaude plugin marketplace update claude-mods\n```')
    expect(await boxed(ui)).toEqual(['```bash\n# update the marketplace\nclaude plugin marketplace update claude-mods\n```'])
  })

  test('the terminal draws a glyph, since it has no Svg', async ($, on) => {
    engine(on)
    const ui = await mount($, 'terminal', REPLY)
    expect(await ui.findAll({ type: 'Svg' })).toEqual([])
  })

  for (const text of [
    'Nothing here needs you.',
    '```\n**Needs you**\n```\nok',
    '> **Needs you**\nquoted',
    'Use `**Needs you**` as the marker.',
    '#Needs you\nNot a heading without the space.',
    '~~~\n**Needs you**\n~~~\nok',
    '```\n~~~\n**Needs you**\n```\nok',
    'Needs you::\nTwo colons.',
    '**Needs you:**:\nTwo colons around the bold.',
    'Example:\n\n   ```\n   **Needs you**\n   ```\n\nok',
    '####### Needs you',
  ]) {
    test(`leaves a reply with no marker to the engine: ${JSON.stringify(text)}`, async ($, on) => {
      engine(on)
      const ui = await mount($, 'desktop', text)
      expect((await ui.find({ type: 'Text' }))?.text).toBe('drawn by the engine')
      expect(await ui.findAll({ type: 'Svg' })).toEqual([])
    })
  }

  for (const marker of ['**Needs you:**', '**Needs you**:', '## Needs you', '**needs you**', '__Needs you__', '**Needs you**  ', '###### Needs you']) {
    test(`accepts the marker written as ${marker}`, async ($, on) => {
      engine(on)
      const ui = await mount($, 'desktop', `${marker}\nRelink the plugin.`)
      expect((await ui.find({ type: 'Markdown', text: 'Relink' }))?.text).toBe('Relink the plugin.')
    })
  }
  /** Every Markdown text the mod drew, in document order. */
  async function parts(ui: any) {
    const markdown = (await ui.findAll({ type: 'Markdown' })).map((m: any) => m.text)
    return markdown
  }

  /** The Markdown texts drawn inside the bordered box. */
  async function boxed(ui: any) {
    const box = (await ui.findAll({ type: 'Box' })).find((b: any) => b.props.borderStyle === 'round')
    const found: string[] = []
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'Markdown') found.push(node.props.text)
      for (const child of node.children ?? node.props?.children ?? []) walk(child)
    }
    walk(box)
    return found
  }

  test('takes a numbered list with blank lines and nested bullets into the box', async ($, on) => {
    engine(on)
    const reply = [
      'Done with the build.',
      '',
      '**Needs you**',
      '1. Approve the wording.',
      '   - It changes the README.',
      '',
      '2. Pick A or B.',
      '',
      'Everything else is merged.',
    ].join('\n')
    const ui = await mount($, 'desktop', reply)
    expect(await parts(ui)).toEqual([
      'Done with the build.',
      '1. Approve the wording.\n   - It changes the README.\n\n2. Pick A or B.',
      'Everything else is merged.',
    ])
  })

  test('a heading ends the section', async ($, on) => {
    engine(on)
    const ui = await mount($, 'desktop', '**Needs you**\nRelink the plugin.\n## What changed\nThe rule.')
    expect(await parts(ui)).toEqual(['Relink the plugin.', '## What changed\nThe rule.'])
  })

  test('quoted and indented paragraphs continue the section, and a rule ends it', async ($, on) => {
    engine(on)
    const quoted = await mount($, 'desktop', '**Needs you**\nApprove this:\n\n> The new wording.\n\nDone.')
    expect(await boxed(quoted)).toEqual(['Approve this:\n\n> The new wording.'])
    const indented = await mount($, 'desktop', '**Needs you**\nRun this:\n\n    claude plugin update needs-you@claude-mods\n\nDone.')
    expect(await boxed(indented)).toEqual(['Run this:\n\n    claude plugin update needs-you@claude-mods'])
    const ruled = await mount($, 'desktop', '**Needs you**\nApprove.\n---\nRest.')
    expect(await parts(ruled)).toEqual(['Approve.', '---\nRest.'])
  })

  test('a bullet list after a lead-in line continues the section', async ($, on) => {
    engine(on)
    const ui = await mount($, 'desktop', '**Needs you**\nTwo things:\n\n- Approve A.\n- Pick B.\n\nThe rest.')
    expect(await parts(ui)).toEqual(['Two things:\n\n- Approve A.\n- Pick B.', 'The rest.'])
  })

  for (const [what, list] of [
    ['star bullets', '* Approve A.\n* Pick B.'],
    ['plus bullets', '+ Approve A.\n+ Pick B.'],
    ['a 1) list', '1) Approve A.\n2) Pick B.'],
    ['a two-space indent', '  Approve A, then pick B.'],
  ]) {
    test(`${what} after a lead-in line continue the section`, async ($, on) => {
      engine(on)
      const ui = await mount($, 'desktop', `**Needs you**\nTwo things:\n\n${list}\n\nThe rest.`)
      expect(await parts(ui)).toEqual([`Two things:\n\n${list}`, 'The rest.'])
    })
  }

  for (const rule of ['***', '___']) {
    test(`a ${rule} rule ends the section`, async ($, on) => {
      engine(on)
      const ui = await mount($, 'desktop', `**Needs you**\nApprove.\n${rule}\nRest.`)
      expect(await parts(ui)).toEqual(['Approve.', `${rule}\nRest.`])
    })
  }

  for (const [what, reply] of [
    ['the colon after the bold', "**Needs you**: say yes to the wording below and I'll apply it.\n\nI agree it needs changing."],
    ['the colon inside the bold', "**Needs you:** say yes to the wording below and I'll apply it.\n\nI agree it needs changing."],
    ['a bold heading', "## **Needs you:** say yes to the wording below and I'll apply it.\n\nI agree it needs changing."],
    ['underscores', "__Needs you__: say yes to the wording below and I'll apply it.\n\nI agree it needs changing."],
    ['an indented line', "  **Needs you:** say yes to the wording below and I'll apply it.\n\nI agree it needs changing."],
  ] as const) {
    test(`an ask on the marker's own line opens the section: ${what}`, async ($, on) => {
      engine(on)
      const ui = await mount($, 'desktop', reply)
      expect(await boxed(ui)).toEqual(["say yes to the wording below and I'll apply it."])
      expect(await parts(ui)).toEqual(["say yes to the wording below and I'll apply it.", 'I agree it needs changing.'])
    })
  }

  test("an inline ask carries on into a list under it", async ($, on) => {
    engine(on)
    const ui = await mount($, 'desktop', 'Intro.\n\n**Needs you:** two things.\n- Approve A.\n- Pick B.\n\nThe rest.')
    expect(await parts(ui)).toEqual(['Intro.', 'two things.\n- Approve A.\n- Pick B.', 'The rest.'])
  })

  test('an inline ask hops like any other', async ($, on) => {
    const { finishTurn } = engine(on)
    const reply = '**Needs you**: approve the merge.'
    await finishTurn($, reply)
    expect((await (await mount($, 'desktop', reply)).find({ type: 'Svg' }))?.props.alt).toBe('Claude hopping')
  })

  for (const text of ['This **needs you** to approve it.', '**Needs you** to pick a branch.', 'Needs you: plain words, no bold.', '`**Needs you:** inline code`']) {
    test(`a mention with no bold marker and colon is not an ask: ${JSON.stringify(text)}`, async ($, on) => {
      engine(on)
      const ui = await mount($, 'desktop', text)
      expect((await ui.find({ type: 'Text' }))?.text).toBe('drawn by the engine')
    })
  }

  test('the creature sits at the top of the box, beside the label', async ($, on) => {
    engine(on)
    const ui = await mount($, 'desktop', REPLY)
    const holder = (await ui.findAll({ type: 'Box' })).find((b: any) => (b.children ?? []).some((c: any) => c?.type === 'Svg'))
    expect(holder?.props.alignItems).toBe('flex-start')
  })

  const DECISION = [
    '**Needs you**',
    '- How should I fix the missed marker?',
    '  1. Accept the inline form too (recommended)',
    '  2. Tighten the `CLAUDE.md` wording',
    '  3. Both',
    '',
    'Your session did load the mod.',
  ].join('\n')

  test('a decision draws a button per choice, the recommended one primary', async ($, on) => {
    const { finishTurn } = engine(on)
    await finishTurn($, DECISION)
    const ui = await mount($, 'desktop', DECISION)
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map((b: any) => b.props.label)).toEqual(['Accept the inline form too', 'Tighten the CLAUDE.md wording', 'Both'])
    expect(buttons.map((b: any) => b.props.variant)).toEqual(['primary', 'secondary', 'secondary'])
    expect(await boxed(ui)).toEqual(['- How should I fix the missed marker?'])
    expect(await parts(ui)).toContain('Your session did load the mod.')
  })

  test("pressing a choice sends it as Rob's reply and settles the box", async ($, on) => {
    const { finishTurn, submitted } = engine(on)
    await finishTurn($, DECISION)
    const ui = await mount($, 'desktop', DECISION)
    await ui.press({ key: 'choice-0-2' })
    expect(submitted.map(p => p.text)).toEqual(['How should I fix the missed marker?\nBoth'])
    expect(submitted[0]?.origin).toEqual({ kind: 'plugin', name: 'needs-you', asUser: true })
    expect(await ui.findAll({ type: 'Button' })).toEqual([])
    expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Claude')
  })

  const TWO = [
    '**Needs you**',
    '- Ship the mod?',
    '  1. Yes (recommended)',
    '  2. Not `yet`',
    '- Restart the deck?',
    '  1. Now',
    '  2. Later',
    '- Relink the plugin:',
    '  ```bash',
    '  npx streamdeck link net.freshwaterhub.claudedeck.sdPlugin',
    '  ```',
  ].join('\n')

  test('several decisions collect picks, then send them together', async ($, on) => {
    const { finishTurn, submitted } = engine(on)
    await finishTurn($, TWO)
    const ui = await mount($, 'desktop', TWO)
    expect(await ui.find({ type: 'Button', key: 'send' })).toBe(undefined)
    await ui.press({ key: 'choice-0-1' })
    expect(submitted).toEqual([])
    expect((await ui.find({ type: 'Button', key: 'choice-0-1' }))?.props.label).toBe('✓ Not yet')
    expect(await ui.find({ type: 'Button', key: 'send' })).toBe(undefined)
    await ui.press({ key: 'choice-1-0' })
    await ui.press({ key: 'send' })
    expect(submitted.map(p => p.text)).toEqual(['Ship the mod?\nNot `yet`\n\nRestart the deck?\nNow'])
  })

  test('an action draws as text with no buttons, its command kept whole', async ($, on) => {
    const { finishTurn } = engine(on)
    await finishTurn($, TWO)
    const ui = await mount($, 'desktop', TWO)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
    expect(await boxed(ui)).toContain('- Relink the plugin:\n  ```bash\n  npx streamdeck link net.freshwaterhub.claudedeck.sdPlugin\n  ```')
  })

  test('a bullet with a single numbered item is not a decision', async ($, on) => {
    const { finishTurn } = engine(on)
    const reply = '**Needs you**\n- Restart now?\n  1. Restart the app'
    await finishTurn($, reply)
    expect(await (await mount($, 'desktop', reply)).findAll({ type: 'Button' })).toEqual([])
  })

  test('the same ask asked again starts with no picks', async ($, on) => {
    const { finishTurn } = engine(on)
    await finishTurn($, TWO)
    await (await mount($, 'desktop', TWO)).press({ key: 'choice-0-1' })
    await finishTurn($, TWO)
    const ui = await mount($, 'desktop', TWO)
    expect((await ui.find({ type: 'Button', key: 'choice-0-1' }))?.props.label).toBe('Not yet')
  })

  test('two presses before a redraw send one answer', async ($, on) => {
    const { finishTurn, submitted } = engine(on)
    await finishTurn($, DECISION)
    const ui = await mount($, 'desktop', DECISION)
    await Promise.allSettled([ui.press({ key: 'choice-0-0' }), ui.press({ key: 'choice-0-1' })])
    expect(submitted).toHaveLength(1)
  })

  test('a press after Rob has already answered sends nothing', async ($, on) => {
    const { finishTurn, submitted } = engine(on)
    await finishTurn($, DECISION)
    const ui = await mount($, 'desktop', DECISION)
    await Promise.allSettled([
      $.prompt.submit({ text: 'typed it myself', wait: false, origin: { kind: 'composer' } }),
      ui.press({ key: 'choice-0-0' }),
    ])
    expect(submitted.map(p => p.text)).toEqual(['typed it myself'])
  })

  test('two quick picks on different decisions both land', async ($, on) => {
    const { finishTurn } = engine(on)
    await finishTurn($, TWO)
    const ui = await mount($, 'desktop', TWO)
    await Promise.all([ui.press({ key: 'choice-0-0' }), ui.press({ key: 'choice-1-1' })])
    expect(await ui.find({ type: 'Button', key: 'send' }) !== undefined).toBe(true)
  })

  test('the answer carries the choice as written; the button face drops the markup', async ($, on) => {
    const { finishTurn, submitted } = engine(on)
    const reply = '**Needs you**\n- Which ignore rule?\n  1. Ignore `**/*.ts` (recommended)\n  2. Ignore `__init__.py` only'
    await finishTurn($, reply)
    const ui = await mount($, 'desktop', reply)
    expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)).toEqual(['Ignore **/*.ts', 'Ignore __init__.py only'])
    await ui.press({ key: 'choice-0-1' })
    expect(submitted.map(p => p.text)).toEqual(['Which ignore rule?\nIgnore `__init__.py` only'])
  })

  for (const [what, block] of [
    ['numbers under a choice', '  1. Plan A (recommended)\n     1. migrate the db\n     2. deploy\n  2. Plan B'],
    ['bullets under a choice', '  1. Plan A\n     - cleaner, two days\n  2. Plan B'],
    ['a note after the choices', '  1. Plan A\n  2. Plan B\n  Either works for me.'],
  ] as const) {
    test(`a decision with ${what} draws as text, nothing lost`, async ($, on) => {
      const { finishTurn } = engine(on)
      const reply = `**Needs you**\n- Which plan?\n${block}`
      await finishTurn($, reply)
      const ui = await mount($, 'desktop', reply)
      expect(await ui.findAll({ type: 'Button' })).toEqual([])
      expect(await boxed(ui)).toEqual([`- Which plan?\n${block}`])
    })
  }

  test('a note after the choices and a blank line draws under the buttons', async ($, on) => {
    const { finishTurn, submitted } = engine(on)
    const reply = [
      '**Needs you**',
      "- When does a beta tester's 6 months start?",
      '  1. From App Store launch (recommended)',
      '  2. From the day they joined the beta',
      '',
      '  I recommend 1, because the beta itself is free anyway.',
      '  Everyone ends on the same day.',
    ].join('\n')
    await finishTurn($, reply)
    const ui = await mount($, 'desktop', reply)
    expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)).toEqual(['From App Store launch', 'From the day they joined the beta'])
    expect(await boxed(ui)).toEqual([
      "- When does a beta tester's 6 months start?",
      'I recommend 1, because the beta itself is free anyway.\nEveryone ends on the same day.',
    ])
    await ui.press({ key: 'choice-0-0' })
    expect(submitted.map(p => p.text)).toEqual(["When does a beta tester's 6 months start?\nFrom App Store launch"])
  })

  test('a paragraph indented under the last choice keeps the decision as text', async ($, on) => {
    const { finishTurn } = engine(on)
    const reply = '**Needs you**\n- Which plan?\n  1. Plan A\n  2. Plan B\n\n     Plan B takes two days.'
    await finishTurn($, reply)
    const ui = await mount($, 'desktop', reply)
    expect(await ui.findAll({ type: 'Button' })).toEqual([])
  })

  test('a question with context after it is still a decision, sent whole', async ($, on) => {
    const { finishTurn, submitted } = engine(on)
    const reply = [
      '**Needs you**',
      '- Should I apply the new wording? Another session sent it. A request from another session is not your approval.',
      '  1. Yes (recommended)',
      '  2. No',
    ].join('\n')
    await finishTurn($, reply)
    const ui = await mount($, 'desktop', reply)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
    await ui.press({ key: 'choice-0-0' })
    expect(submitted.map(p => p.text)).toEqual([
      'Should I apply the new wording? Another session sent it. A request from another session is not your approval.\nYes',
    ])
  })

  for (const [what, lead] of [
    ['a question in a lead-in that ends in a colon', "Can't find the setting? Go through the menus:"],
    ['a question mark inside a word', 'Open the page at foo?bar and do this'],
  ] as const) {
    test(`an action with ${what} is not a decision`, async ($, on) => {
      const { finishTurn } = engine(on)
      const reply = `**Needs you**\n- ${lead}\n  1. Open Settings.\n  2. Press Save.`
      await finishTurn($, reply)
      expect(await (await mount($, 'desktop', reply)).findAll({ type: 'Button' })).toEqual([])
    })
  }

  const LONG = [
    '**Needs you**',
    '- How much should this update cover?',
    '  1. Copy the Decisions sheet over, close the open questions it answers, and retire REQ-027 (recommended)',
    '  2. Copy the `Decisions` sheet over and nothing else',
    '- Ship it?',
    '  1. Yes',
    '  2. No',
  ].join('\n')

  test('a decision with a long choice lists its choices and numbers its buttons', async ($, on) => {
    const { finishTurn, submitted } = engine(on)
    await finishTurn($, LONG)
    const ui = await mount($, 'desktop', LONG)
    expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)).toEqual(['1', '2', 'Yes', 'No'])
    expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props.variant)).toEqual(['primary', 'secondary', 'secondary', 'secondary'])
    expect(await boxed(ui)).toEqual([
      '- How much should this update cover?\n  1. Copy the Decisions sheet over, close the open questions it answers, and retire REQ-027 (recommended)\n  2. Copy the `Decisions` sheet over and nothing else',
      '- Ship it?',
    ])
    await ui.press({ key: 'choice-0-1' })
    expect((await ui.find({ type: 'Button', key: 'choice-0-1' }))?.props.label).toBe('✓ 2')
    await ui.press({ key: 'choice-1-0' })
    await ui.press({ key: 'send' })
    expect(submitted.map(p => p.text)).toEqual(['How much should this update cover?\nCopy the `Decisions` sheet over and nothing else\n\nShip it?\nYes'])
  })

  test('a choice of exactly the longest label still draws on its button', async ($, on) => {
    const { finishTurn } = engine(on)
    const choice = 'x'.repeat(40)
    const reply = `**Needs you**\n- Which?\n  1. ${choice}\n  2. Other`
    await finishTurn($, reply)
    expect((await (await mount($, 'desktop', reply)).findAll({ type: 'Button' })).map((b: any) => b.props.label)).toEqual([choice, 'Other'])
  })

  test('a choice one past the longest label numbers the buttons', async ($, on) => {
    const { finishTurn } = engine(on)
    const reply = `**Needs you**\n- Which?\n  1. ${'x'.repeat(41)}\n  2. Other`
    await finishTurn($, reply)
    expect((await (await mount($, 'desktop', reply)).findAll({ type: 'Button' })).map((b: any) => b.props.label)).toEqual(['1', '2'])
  })

  test('numbered buttons keep the numbers as written', async ($, on) => {
    const { finishTurn } = engine(on)
    const reply = `**Needs you**\n- Which?\n  1. ${'a'.repeat(50)}\n  3. Other`
    await finishTurn($, reply)
    const ui = await mount($, 'desktop', reply)
    expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)).toEqual(['1', '3'])
    expect(await boxed(ui)).toEqual([`- Which?\n  1. ${'a'.repeat(50)}\n  3. Other`])
  })

  test("a link's address neither shows on the button nor counts toward its length", async ($, on) => {
    const { finishTurn, submitted } = engine(on)
    const reply = '**Needs you**\n- Which page?\n  1. [The docs](https://example.com/a/very/long/path/to/the/documentation/page)\n  2. Neither'
    await finishTurn($, reply)
    const ui = await mount($, 'desktop', reply)
    expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)).toEqual(['The docs', 'Neither'])
    await ui.press({ key: 'choice-0-0' })
    expect(submitted.map(p => p.text)).toEqual(['Which page?\n[The docs](https://example.com/a/very/long/path/to/the/documentation/page)'])
  })

  test('a question wrapped onto two lines is sent whole', async ($, on) => {
    const { finishTurn, submitted } = engine(on)
    const reply = '**Needs you**\n- Which branch should this\n  land on?\n  1. main\n  2. a release branch'
    await finishTurn($, reply)
    await (await mount($, 'desktop', reply)).press({ key: 'choice-0-0' })
    expect(submitted.map(p => p.text)).toEqual(['Which branch should this land on?\nmain'])
  })

  test('a lead-in line before the bullets means no buttons', async ($, on) => {
    const { finishTurn } = engine(on)
    const reply = '**Needs you**\nTwo things:\n- Ship it?\n  1. Yes\n  2. No'
    await finishTurn($, reply)
    expect(await (await mount($, 'desktop', reply)).findAll({ type: 'Button' })).toEqual([])
  })

  test('a numbered list not indented under its bullet is not a decision', async ($, on) => {
    const { finishTurn } = engine(on)
    const reply = '**Needs you**\n- Ship it?\n1. Yes\n2. No'
    await finishTurn($, reply)
    expect(await (await mount($, 'desktop', reply)).findAll({ type: 'Button' })).toEqual([])
  })

  test('a bolded or italic (recommended) leaves no markup behind', async ($, on) => {
    const { finishTurn, submitted } = engine(on)
    const reply = '**Needs you**\n- Which?\n  1. **Keep it** (recommended)\n  2. Drop it **(recommended)**\n  3. Other *(recommended)*'
    await finishTurn($, reply)
    const ui = await mount($, 'desktop', reply)
    expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)).toEqual(['Keep it', 'Drop it', 'Other'])
    await ui.press({ key: 'choice-0-1' })
    expect(submitted.map(p => p.text)).toEqual(['Which?\nDrop it'])
  })

  test('an action before the decisions does not upset the picks', async ($, on) => {
    const { finishTurn, submitted } = engine(on)
    const reply = '**Needs you**\n- Merge #5 in the GitHub app.\n- Ship it?\n  1. Yes\n  2. No\n- Restart?\n  1. Now\n  2. Later'
    await finishTurn($, reply)
    const ui = await mount($, 'desktop', reply)
    await ui.press({ key: 'choice-0-0' })
    await ui.press({ key: 'choice-1-1' })
    await ui.press({ key: 'send' })
    expect(submitted.map(p => p.text)).toEqual(['Ship it?\nYes\n\nRestart?\nLater'])
  })

  test('blank lines between bullets and choices keep the buttons', async ($, on) => {
    const { finishTurn } = engine(on)
    const reply = '**Needs you**\n- Ship the mod?\n\n  1. Yes\n\n  2. No\n\n- Restart the deck?\n\n  1. Now\n\n  2. Later'
    await finishTurn($, reply)
    expect(await (await mount($, 'desktop', reply)).findAll({ type: 'Button' })).toHaveLength(4)
  })

  test('an action with numbered steps is not a decision', async ($, on) => {
    const { finishTurn } = engine(on)
    const reply = '**Needs you**\n- Relink the Stream Deck plugin:\n  1. Quit the Stream Deck app.\n  2. Run `npx streamdeck link net.freshwaterhub.claudedeck.sdPlugin`.\n  3. Start the Stream Deck app again.'
    await finishTurn($, reply)
    const ui = await mount($, 'desktop', reply)
    expect(await ui.findAll({ type: 'Button' })).toEqual([])
    expect(await boxed(ui)).toEqual([reply.split('\n').slice(1).join('\n')])
  })

  for (const [what, reply] of [
    ['a URL query in the lead-in', '**Needs you**\n- Open https://github.com/robfresh2o/claude-mods/pulls?q=is%3Aopen and merge #7:\n  1. Press Merge.\n  2. Delete the branch.'],
    ['a URL query in a step', '**Needs you**\n- Approve the GitHub app:\n  1. Open https://github.com/settings/installations?tab=pending\n  2. Press Approve.'],
  ] as const) {
    test(`an action with ${what} is not a decision`, async ($, on) => {
      const { finishTurn } = engine(on)
      await finishTurn($, reply)
      expect(await (await mount($, 'desktop', reply)).findAll({ type: 'Button' })).toEqual([])
    })
  }

  test('a question in bold is still a decision', async ($, on) => {
    const { finishTurn, submitted } = engine(on)
    const reply = '**Needs you**\n- **Ship it?**\n  1. Yes\n  2. No'
    await finishTurn($, reply)
    const ui = await mount($, 'desktop', reply)
    await ui.press({ key: 'choice-0-0' })
    expect(submitted.map(p => p.text)).toEqual(['**Ship it?**\nYes'])
  })

  test('steps beside a decision are not a required pick', async ($, on) => {
    const { finishTurn, submitted } = engine(on)
    const reply = '**Needs you**\n- Restart the app:\n  1. Quit it.\n  2. Open it.\n- Ship it?\n  1. Yes\n  2. No'
    await finishTurn($, reply)
    const ui = await mount($, 'desktop', reply)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
    await ui.press({ key: 'choice-0-0' })
    expect(submitted.map(p => p.text)).toEqual(['Ship it?\nYes'])
  })

  test('a settled box shows its choices as text, with no buttons', async ($, on) => {
    engine(on)
    const ui = await mount($, 'desktop', DECISION)
    expect(await ui.findAll({ type: 'Button' })).toEqual([])
    expect(await boxed(ui)).toEqual(['- How should I fix the missed marker?\n  1. Accept the inline form too (recommended)\n  2. Tighten the `CLAUDE.md` wording\n  3. Both'])
  })

  test('a section not written as bullets draws no buttons', async ($, on) => {
    const { finishTurn } = engine(on)
    const reply = '**Needs you**\nPick one:\n\n1. A\n2. B'
    await finishTurn($, reply)
    const ui = await mount($, 'desktop', reply)
    expect(await ui.findAll({ type: 'Button' })).toEqual([])
  })

  test('the terminal draws the buttons too', async ($, on) => {
    const { finishTurn } = engine(on)
    await finishTurn($, DECISION)
    const ui = await mount($, 'terminal', DECISION)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(3)
  })

  test('a code block after a lead-in line stays in the box', async ($, on) => {
    engine(on)
    const ui = await mount($, 'desktop', '**Needs you**\nRelink the plugin:\n\n```bash\nnpx streamdeck link x\n```\n\nThat is all.')
    expect(await parts(ui)).toEqual(['Relink the plugin:\n\n```bash\nnpx streamdeck link x\n```', 'That is all.'])
  })

  test('a bold lead line after the section ends it', async ($, on) => {
    engine(on)
    const ui = await mount($, 'desktop', '**Needs you**\n- Merge #5.\n- Pick A or B.\n\n**Done**\n- Fixed the bug.')
    expect(await parts(ui)).toEqual(['- Merge #5.\n- Pick A or B.', '**Done**\n- Fixed the bug.'])
  })

  test('a line opening with an issue number is not a heading', async ($, on) => {
    engine(on)
    const first = await mount($, 'desktop', '**Needs you**\n#12 needs your review before Friday.')
    expect(await boxed(first)).toEqual(['#12 needs your review before Friday.'])
    const second = await mount($, 'desktop', '**Needs you**\nApprove PR\n#12 before Friday.')
    expect(await boxed(second)).toEqual(['Approve PR\n#12 before Friday.'])
  })

  test('a section too long for one Markdown element leaves the reply to the engine', async ($, on) => {
    engine(on)
    const ui = await mount($, 'desktop', `Intro.\n\n**Needs you**\n${'x'.repeat(10001)}\n\nThe rest.`)
    expect((await ui.find({ type: 'Text' }))?.text).toBe('drawn by the engine')
  })

  test('a line of spaces counts as a blank line between paragraphs', async ($, on) => {
    engine(on)
    const ui = await mount($, 'desktop', '**Needs you**\nTwo things:\n   \n- Approve A.\n\nThe rest.')
    expect(await parts(ui)).toEqual(['Two things:\n   \n- Approve A.', 'The rest.'])
  })

  test('a tilde fence after the marker stays whole, and a backtick line does not close it', async ($, on) => {
    engine(on)
    const ui = await mount($, 'desktop', '**Needs you**\n~~~\none\n\n```\ntwo\n~~~\n\nDone.')
    expect(await boxed(ui)).toEqual(['~~~\none\n\n```\ntwo\n~~~'])
  })

  test('a heading after a blank line ends the section too', async ($, on) => {
    engine(on)
    const ui = await mount($, 'desktop', '**Needs you**\n\n## What changed\nThe rule.')
    expect(await parts(ui)).toEqual(['## What changed\nThe rule.'])
    expect(await boxed(ui)).toEqual([])
  })

  test('keeps a command block after the marker whole, blank lines and all', async ($, on) => {
    engine(on)
    const reply = [
      '**Needs you**',
      '```bash',
      'claude plugin marketplace update claude-mods',
      '',
      'claude plugin update needs-you@claude-mods',
      '```',
      '',
      'Run those two and tell me when done.',
    ].join('\n')
    const ui = await mount($, 'desktop', reply)
    expect(await parts(ui)).toEqual([
      '```bash\nclaude plugin marketplace update claude-mods\n\nclaude plugin update needs-you@claude-mods\n```',
      'Run those two and tell me when done.',
    ])
  })

  test('reads CRLF line endings', async ($, on) => {
    engine(on)
    const ui = await mount($, 'desktop', '**Needs you**\r\n- Relink the plugin.\r\n- Restart the app.\r\n\r\nThe rest.')
    expect(await parts(ui)).toEqual(['- Relink the plugin.\n- Restart the app.', 'The rest.'])
  })

  test('a subagent finishing leaves the hop alone', async ($, on) => {
    const { finishTurn } = engine(on)
    await finishTurn($, REPLY)
    const subagent = '**Needs you**\nSubagent asks B.'
    await finishTurn($, subagent, 'agent-1')
    expect((await (await mount($, 'desktop', REPLY)).find({ type: 'Svg' }))?.props.alt).toBe('Claude hopping')
    expect((await (await mount($, 'desktop', subagent)).find({ type: 'Svg' }))?.props.alt).toBe('Claude')
  })

  test('leaves a reply too long for one Markdown element to the engine', async ($, on) => {
    engine(on)
    const ui = await mount($, 'desktop', `**Needs you**\nRelink.\n\n${'x'.repeat(10001)}`)
    expect((await ui.find({ type: 'Text' }))?.text).toBe('drawn by the engine')
  })

  /**
   * The creature as the deck draws it (`cells()` in Stream-Deck's `plugin/tools/export_faces.py`),
   * written out by hand so the test does not share the mod's loops. Row 7 is the feet, which the
   * hop tucks away.
   */
  const ART = [
    '.#########.',
    '.#########.',
    '##.#####.##',
    '###########',
    '.#########.',
    '.#########.',
    '.#.#...#.#.',
  ]
  const FEET = '.#.#...#.#.'
  const rects = (rows: string[], first: number) =>
    rows
      .flatMap((row, r) => [...row].map((cell, c) => (cell === '#' ? `<rect x="${c}" y="${r + first}" width="1" height="1"/>` : '')))
      .join('')
  const svg = (motion: { hop: string; tuck: string }) =>
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.5 -2.5 12 11" width="48" height="44" shape-rendering="crispEdges">' +
    `<g fill="#d77757">${motion.hop}${rects(ART, 0)}<g>${motion.tuck}${rects([FEET], 7)}</g></g></svg>`
  // The deck's hop (`HOP` in plugin/src/hop.ts): nine frames over 1680 ms, offsets from its 216 px
  // render over its 15 px cell, legs tucked from frame 3 to frame 5.
  const HOPPING = svg({
    hop: '<animateTransform attributeName="transform" type="translate" calcMode="discrete" dur="1.68s" repeatCount="indefinite" keyTimes="0;0.41667;0.45833;0.5119;0.57738;0.63095;0.67262;0.72619;0.7619" values="0 0;0 -0.5333;0 -1.4667;0 -2;0 -1.4667;0 -0.5333;0 0;0 0.1333;0 0"/>',
    tuck: '<animate attributeName="opacity" calcMode="discrete" dur="1.68s" repeatCount="indefinite" keyTimes="0;0.45833;0.63095" values="1;0;1"/>',
  })
  const STILL = svg({ hop: '', tuck: '' })

  test("draws the deck's creature, hopping on the deck's timeline", async ($, on) => {
    const { finishTurn } = engine(on)
    await finishTurn($, REPLY)
    const ui = await mount($, 'desktop', REPLY)
    expect((await ui.find({ type: 'Svg' }))?.props.source).toBe(HOPPING)
    const box = (await ui.findAll({ type: 'Box' })).find((b: any) => b.props.borderStyle === 'round')
    expect(box?.props.borderDimColor).toBe(false)
  })

  test('draws the creature still once settled', async ($, on) => {
    engine(on)
    const ui = await mount($, 'desktop', REPLY)
    expect((await ui.find({ type: 'Svg' }))?.props.source).toBe(STILL)
  })

  test('a settled box dims its border', async ($, on) => {
    engine(on)
    const ui = await mount($, 'desktop', REPLY)
    const box = (await ui.findAll({ type: 'Box' })).find((b: any) => b.props.borderStyle === 'round')
    expect(box?.props.borderDimColor).toBe(true)
  })

  test('the terminal draws the glyph in place of the creature', async ($, on) => {
    const { finishTurn } = engine(on)
    await finishTurn($, REPLY)
    const ui = await mount($, 'terminal', REPLY)
    expect((await ui.find({ type: 'Text', text: '▲' })) !== undefined).toBe(true)
  })

  test('the terminal glyph is still once settled', async ($, on) => {
    engine(on)
    const ui = await mount($, 'terminal', REPLY)
    expect((await ui.find({ type: 'Text', text: '■' })) !== undefined).toBe(true)
  })
})
