/**
 * Highlights the part of a reply that needs Rob.
 *
 * Rob's global CLAUDE.md has Claude open any reply that needs him with a line reading
 * `**Needs you**`. This finds that line, draws the section under it in a box, and puts the
 * Claude creature from the Stream Deck's Status key beside it, hopping to the same ratified
 * timeline. Only the latest such reply hops, and only until Rob sends a prompt of his own;
 * after that the creature stands still and the box stays, so the transcript does not fill with
 * motion. A turn Rob did not start (a background task finishing, say) does not settle an ask he
 * has not answered, though a new section in its reply takes over the hop.
 *
 * While the ask is open, a decision draws a button per choice: a top-level bullet whose text ends
 * in "?" (trailing bold or code aside), with a numbered list of two or more one-line choices under
 * it. `(recommended)` marks the primary button. Pressing one sends the question and the choice as
 * Rob's reply; with several decisions, the picks collect and send together.
 *
 * There is no model call anywhere in this. The marker is plain text, and `isMarker` is the rule
 * the Claude Deck plugin uses to decide when the Status key hops (`isMarkerLine` in
 * `plugin/src/stop-intent.ts` in robfresh2o/Stream-Deck), copied line for line, and so is
 * `inlineAsk` (`inlineAsk` there), so the box and the key agree. Change one and change the other.
 */

import type { Register } from 'claude-code'

const active = { plugin: 'needs-you', key: 'active' } as const
const picks = { plugin: 'needs-you', key: 'picks' } as const

/** The Status key's body colour, `BODY` in the deck's `plugin/tools/export_faces.py`. */
const BODY = '#d77757'

/** Markdown's own limit per element. A reply longer than this is left to the engine. */
const MARKDOWN_LIMIT = 10000

/**
 * Whether a line is the marker: once trimmed, with a heading's one to six `#` and the space after
 * them, the `**` or `__` around it, and one colon (inside the bold or after it) taken off, it is
 * "needs you" in any case. A sentence that merely contains the words is not. A quoted or
 * inline-code mention never is either, because neither the `>` nor the backticks come off.
 */
function isMarker(line: string): boolean {
  let text = line.trim().replace(/^#{1,6}\s+/, '').trim()
  let droppedColon = false
  if (text.endsWith(':')) {
    text = text.slice(0, -1).trim()
    droppedColon = true
  }
  for (const wrap of ['**', '__']) {
    if (text.length > 2 * wrap.length && text.startsWith(wrap) && text.endsWith(wrap)) {
      text = text.slice(wrap.length, -wrap.length).trim()
      break
    }
  }
  if (!droppedColon && text.endsWith(':')) {
    text = text.slice(0, -1).trim()
  }
  return text.toLowerCase() === 'needs you'
}

/**
 * The ask written on the marker's own line, when the marker opens the line in bold with a colon:
 * `**Needs you**: approve the wording` or `**Needs you:** approve the wording`. Null otherwise, so
 * a sentence that only mentions the words ("This **needs you** to approve") never counts.
 */
function inlineAsk(line: string): string | null {
  const found = /^(?:#{1,6}\s+)?(\*\*|__)\s*needs you\s*(?::\s*\1|\1\s*:)\s*([^\s:].*)$/i.exec(line.trim())
  return found?.[2] ?? null
}

type Split = { before: string; section: string; after: string }

const LIST_OR_INDENT = /^(\s*([-*+]|\d+[.)])\s|\s{2,}\S|\s*>|\s*(`{3,}|~{3,}))/
const BREAK = /^(#{1,6}\s|(-{3,}|\*{3,}|_{3,})\s*$)/

/**
 * The reply cut into what comes before the marker, the section it opens, and the rest.
 *
 * The section is the first paragraph after the marker, then every following paragraph that is
 * a list item, indented, quoted or a fenced block, which is how the asks are written: a command
 * an action needs, written after its lead-in, stays in the box. A heading, a rule written
 * without spaces (`---`, `***`, `___`) or an ordinary paragraph ends it. A fenced block is taken
 * whole, blank lines and all, so a command block after the marker stays in one piece. Lines inside fenced code never count as the marker.
 * When the ask starts on the marker's own line (`inlineAsk`), that text opens the section.
 */
function split(text: string): Split | null {
  const lines = text.split(/\r?\n/)
  const line = (i: number): string => lines[i] ?? ''
  const fenceOf = (line: string) => /^\s*(`{3,}|~{3,})/.exec(line)?.[1]?.[0]
  let fence: string | undefined
  let at = -1
  for (let i = 0; i < lines.length; i++) {
    const opens = fenceOf(line(i))
    if (fence === undefined) {
      if (opens !== undefined) fence = opens
      else if (isMarker(line(i)) || inlineAsk(line(i)) !== null) {
        at = i
        break
      }
    } else if (opens === fence) {
      fence = undefined
    }
  }
  if (at < 0) return null
  const ask = inlineAsk(line(at))
  if (ask !== null) lines[at] = ask
  const start = ask === null ? at + 1 : at

  let end = start
  let isFirst = true
  while (end < lines.length) {
    let next = end
    while (next < lines.length && line(next).trim() === '') next++
    if (next >= lines.length || BREAK.test(line(next))) break
    if (!isFirst && !LIST_OR_INDENT.test(line(next))) break
    // Take the paragraph, and any list item that runs on without a blank line. A fence opened in
    // it runs to its close, or to the end of the reply if it never closes.
    end = next
    let open: string | undefined
    while (end < lines.length && (open !== undefined || line(end).trim() !== '')) {
      if (open === undefined && end > next && BREAK.test(line(end))) break
      const marks = fenceOf(line(end))
      if (open === undefined) open = marks
      else if (marks === open) open = undefined
      end++
    }
    isFirst = false
  }

  return {
    before: lines.slice(0, at).join('\n').trim(),
    section: lines.slice(start, end).join('\n').trim(),
    after: lines.slice(end).join('\n').trim(),
  }
}

/** One thing the section asks of Rob: the bullet's text, and its choices when it is a decision. */
type Item = { text: string; question: string; choices: Choice[] }
type Choice = { label: string; answer: string; isRecommended: boolean }

const TOP_BULLET = /^[-*+]\s+/
const CHOICE = /^\s+\d+[.)]\s+(.*)$/
const RECOMMENDED = /\s*(\*\*|__|\*|_)?\(recommended\)\1?\s*/i

/**
 * The section as its bullets, when it is written as one: each top-level bullet is an item, and a
 * bullet with a numbered list under it is a decision whose choices are that list. Rob's
 * CLAUDE.md writes decisions that way, with `(recommended)` after the recommended choice. A
 * section not written as bullets is null, and draws as plain Markdown with no buttons.
 */
function itemsOf(section: string): Item[] | null {
  const lines = section.split('\n')
  if (!TOP_BULLET.test(lines[0] ?? '')) return null
  const items: string[][] = []
  for (const line of lines) {
    if (TOP_BULLET.test(line)) items.push([line])
    else items[items.length - 1]?.push(line)
  }
  return items.map(block => {
    const text = block.join('\n').trim()
    const firstChoice = block.findIndex(line => CHOICE.test(line))
    if (firstChoice === -1) return { text, question: '', choices: [] }
    // Choices are the numbered lines at the first choice's indent, and nothing else may follow
    // them: a choice with lines of its own under it, or a note after the list, is more than a
    // button can carry, so the bullet draws as text instead.
    const indent = (/^\s*/.exec(block[firstChoice] ?? '')?.[0] ?? '').length
    const rest = block.slice(firstChoice)
    const isChoice = (line: string) => CHOICE.test(line) && (/^\s*/.exec(line)?.[0] ?? '').length === indent
    if (rest.some(line => line.trim() !== '' && !isChoice(line))) return { text, question: '', choices: [] }
    const question = block.slice(0, firstChoice).join(' ').replace(TOP_BULLET, '').replace(/\s+/g, ' ').trim()
    const choices = rest.filter(isChoice).map(line => {
      // The reply carries the choice as written, so code and links reach Claude intact. A button
      // draws plain text, so its face loses the backticks around code and the bold, never what is
      // inside the code.
      const answer = (CHOICE.exec(line)?.[1] ?? '').replace(RECOMMENDED, ' ').replace(/\s+/g, ' ').trim()
      return {
        label: answer.replace(/`([^`]*)`|\*\*(.+?)\*\*/g, (_, code, bold) => code ?? bold),
        answer,
        isRecommended: RECOMMENDED.test(line),
      }
    })
    // A decision is a direct question, as Rob's CLAUDE.md has it: its text ends in "?", bold or
    // code around it aside. An action with numbered steps is the same shape without the question
    // mark, and its steps are not answers. A "?" anywhere else, as in a URL, does not count.
    const isQuestion = question.replace(/[*_`\s]+$/, '').endsWith('?')
    return { text, question, choices: isQuestion && choices.length >= 2 ? choices : [] }
  })
}

/** What pressing sends as Rob's reply: each decision's question, then the choice he made. */
function answerFor(answers: Array<{ question: string; answer: string }>): string {
  return answers.map(({ question, answer }) => `${question}\n${answer}`).join('\n\n')
}

/**
 * The creature, transcribed cell for cell from `cells()` in the deck's `plugin/tools/export_faces.py`.
 * The eyes are the holes at (2, 2) and (8, 2). Row 7 is the lower half of the legs, which the
 * hop tucks away.
 */
function sprite(): { body: string; feet: string } {
  const cells: Array<[number, number]> = []
  for (const r of [0, 1]) for (let c = 1; c <= 9; c++) cells.push([c, r])
  for (let c = 0; c <= 10; c++) if (c !== 2 && c !== 8) cells.push([c, 2])
  for (let c = 0; c <= 10; c++) cells.push([c, 3])
  for (const r of [4, 5]) for (let c = 1; c <= 9; c++) cells.push([c, r])
  for (const c of [1, 3, 7, 9]) cells.push([c, 6])
  const rect = ([c, r]: [number, number]) => `<rect x="${c}" y="${r}" width="1" height="1"/>`
  return {
    body: cells.map(rect).join(''),
    feet: [1, 3, 7, 9].map(c => rect([c, 7])).join(''),
  }
}

/**
 * The hop, as ratified on the deck (`HOP` in `plugin/src/hop.ts`): nine frames over 1680 ms.
 * The offsets are the deck's 216 px render divided by its 15 px cell, so they are in cells
 * here. Frames 3 to 5 have the legs tucked.
 */
const HOP_TIMES = '0;0.41667;0.45833;0.5119;0.57738;0.63095;0.67262;0.72619;0.7619'
const HOP_OFFSETS = '0 0;0 -0.5333;0 -1.4667;0 -2;0 -1.4667;0 -0.5333;0 0;0 0.1333;0 0'

// Drawn as an image, not in the interactive frame. `SvgProps.isInteractive` says SMIL needs the
// frame, but in the desktop app (engine 2.1.286, 3 October 2026) an image plays it and stays
// transparent, while the frame paints an opaque white page behind the SVG whatever it declares.
function creature(isHopping: boolean): string {
  const { body, feet } = sprite()
  const hop = isHopping
    ? `<animateTransform attributeName="transform" type="translate" calcMode="discrete" dur="1.68s" repeatCount="indefinite" keyTimes="${HOP_TIMES}" values="${HOP_OFFSETS}"/>`
    : ''
  const tuck = isHopping
    ? '<animate attributeName="opacity" calcMode="discrete" dur="1.68s" repeatCount="indefinite" keyTimes="0;0.45833;0.63095" values="1;0;1"/>'
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.5 -2.5 12 11" width="48" height="44" shape-rendering="crispEdges"><g fill="${BODY}">${hop}${body}<g>${tuck}${feet}</g></g></svg>`
}

/** The prompt origins that are not Rob answering. */
const NOT_ROB = new Set(['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message'])

export const register: Register = on => {
  // A turn that ends on a reply with a Needs you section makes that section the one that hops.
  // The final text is what the deck reads too (`last_assistant_message` at Stop). Only the main
  // conversation counts: a subagent finishing is not a reply to Rob, and Stop, which the deck
  // reads, fires only for the main loop.
  //
  // The section's text is the key, since nothing here ties a turn to the message it drew, so an
  // earlier reply with exactly the same section hops alongside the latest one.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    // A reply without a section leaves the hop alone: Rob's own prompt already settled it before
    // a turn he started, and a turn he did not start does not answer the ask.
    const found = split(result.text)
    if (found !== null) {
      await $.state.set(active, found.section)
      await $.state.set(picks, null)
    }
    return result
  })

  // Rob answering settles it. A prompt he did not send (a background task finishing, a
  // scheduled trigger, another session's message) is not an answer and leaves it hopping,
  // through the turn it starts as well.
  on('prompt.submit', async ($, e, next) => {
    if (!NOT_ROB.has(e.origin.kind)) {
      await $.state.set(active, null)
      await $.state.set(picks, null)
    }
    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const found = split(e.props.text)
    if (found === null) return next(e)
    if ([found.before, found.section, found.after].some(part => part.length > MARKDOWN_LIMIT)) {
      return next(e)
    }

    const { value = null } = await $.state.get(active)
    const isHopping = value === found.section
    const { Box, Text, Markdown, Button } = $.ui.resolve(e)

    // The terminal has no Svg; its table hands one out anyway, as an empty fragment, so the
    // surface decides, not whether the element exists.
    let figure
    if (e.surface === 'terminal') {
      figure = <Text color={BODY} bold>{isHopping ? '▲' : '■'}</Text>
    } else {
      const { Svg } = $.ui.resolve(e)
      figure = <Svg source={creature(isHopping)} alt={isHopping ? 'Claude hopping' : 'Claude'} width={48} height={44} />
    }

    // Pressing answers for Rob. The plugin's own prompt.submit hook does not see a prompt the
    // plugin submits, so the box settles here, before the reply goes.
    // Only one press answers: it closes the ask with `ifVersion`, so a second press before the
    // redraw finds it closed and sends nothing.
    const answer = async (text: string) => {
      const open = await $.state.get(active)
      if (open.value !== found.section) return
      const closed = await $.state.set(active, null, { ifVersion: open.version })
      if (!closed.isSet) return
      await $.state.set(picks, null)
      await $.prompt.submit({ text, asUser: true })
    }

    // Buttons only while the ask is open: once Rob has answered, an old box pressing out a reply
    // would answer a question nobody is asking any more.
    const items = isHopping ? itemsOf(found.section) : null
    const decisions = (items ?? []).filter(item => item.choices.length > 0)
    let body
    if (items === null || decisions.length === 0) {
      body = found.section ? <Markdown text={found.section} /> : null
    } else {
      const { value: held = null } = await $.state.get(picks)
      const chosen = held !== null && held.section === found.section ? held.chosen : {}
      const isSingle = decisions.length === 1
      // A pick reads the picks as they stand, not as this drawing saw them, and tries again if
      // another press wrote in between, so two quick presses on different decisions both land.
      const pick = async (d: number, c: number) => {
        for (let tries = 0; tries < 5; tries++) {
          const now = await $.state.get(picks)
          const kept = now.value != null && now.value.section === found.section ? now.value.chosen : {}
          const chosen = { ...kept, [String(d)]: c }
          const wrote = await $.state.set(picks, { section: found.section, chosen }, { ifVersion: now.version })
          if (wrote.isSet) return
        }
      }
      body = (
        <Box flexDirection="column">
          {items.map((item, i) => {
            if (item.choices.length === 0) return <Markdown key={`item-${i}`} text={item.text} />
            const d = decisions.indexOf(item)
            return (
              <Box key={`item-${i}`} flexDirection="column">
                <Markdown text={`- ${item.question}`} />
                <Box flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={2}>
                  {item.choices.map((choice, c) => {
                    const isPicked = chosen[String(d)] === c
                    return (
                      <Button
                        key={`choice-${d}-${c}`}
                        label={isPicked ? `✓ ${choice.label}` : choice.label}
                        variant={choice.isRecommended ? 'primary' : 'secondary'}
                        onPress={() => {
                          if (isSingle) {
                            void answer(answerFor([{ question: item.question, answer: choice.answer }]))
                          } else {
                            void pick(d, c)
                          }
                        }}
                      />
                    )
                  })}
                </Box>
              </Box>
            )
          })}
          {!isSingle && decisions.every((_, d) => chosen[String(d)] !== undefined) ? (
            <Box paddingLeft={2} marginTop={1}>
              <Button
                key="send"
                label="Send answers"
                variant="primary"
                onPress={async () => {
                  // The picks as they stand, not as this drawing saw them.
                  const now = await $.state.get(picks)
                  const fresh = now.value != null && now.value.section === found.section ? now.value.chosen : chosen
                  const answers = decisions.map((item, d) => ({ question: item.question, answer: item.choices[fresh[String(d)] ?? 0]?.answer ?? '' }))
                  await answer(answerFor(answers))
                }}
              />
            </Box>
          ) : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {found.before ? <Markdown text={found.before} /> : null}
        <Box flexDirection="row" borderStyle="round" borderColor={BODY} borderDimColor={!isHopping} paddingX={1} columnGap={2} marginY={1}>
          <Box flexShrink={0} alignItems="flex-start">{figure}</Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text color={BODY} bold>Needs you</Text>
            {body}
          </Box>
        </Box>
        {found.after ? <Markdown text={found.after} /> : null}
      </Box>
    )
  })
}
