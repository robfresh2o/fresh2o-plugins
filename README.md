# fresh2o-plugins

Claude Code plugins I've built for my own work and decided to share. Each one installs on its own.

## Install

Add the marketplace once:

```bash
claude plugin marketplace add robfresh2o/fresh2o-plugins
```

Then install the plugins you want:

```bash
claude plugin install needs-you@fresh2o-plugins
```

## Plugins

### needs-you

When Claude needs something from you, such as a decision, an approval or a command only you can run, it opens its reply with a `**Needs you**` line. This plugin finds that line and draws the section under it in a box, with a small Claude creature hopping beside it. The creature keeps hopping until you send your next prompt, so you can see at a glance that a reply is waiting on you.

A decision written as a question, with its choices as a numbered list under it, gets one button per choice. Pressing a button sends the question and your choice as your reply. If the section holds several decisions, your picks collect and send together. Add `(recommended)` after a choice to make it the primary button.

The plugin only draws what Claude writes. It makes no model calls. For it to do anything, Claude has to write the section, so add something like this to your `~/.claude/CLAUDE.md`:

```markdown
If anything needs me (a decision, an approval, something only I can do), open the reply
with `**Needs you**` on a line of its own. Under it, one bullet per thing you need. A
decision is a direct question with its choices as a numbered list, one line each, with
`(recommended)` after the one you recommend. An action says what to do and includes
everything needed to do it, such as the exact command or the steps. Put the reasoning after
the section, not in it. Leave the line out when nothing needs me.
```

needs-you uses Claude Code's plugin hooks to draw inside the session. It was built on Claude Code 2.1.288 and tested in the desktop app's Code tab. It has not been tested in the terminal.

## A note on trust

A plugin runs with the same access to your files and processes as Claude Code. Read the code of any plugin before you install it, including these.

## License

MIT
