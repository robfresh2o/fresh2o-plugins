/** The Needs you section of the latest reply that has one, until Rob next sends a prompt. */
export type Active = string | null

/**
 * The choices Rob has pressed in the hopping box while it holds more than one decision, by the
 * decision's place in the section. Kept with the section they belong to, so a new ask starts clean.
 */
export type Picks = { section: string; chosen: Record<string, number> } | null

declare module 'claude-code' {
  interface PluginState {
    'needs-you': { active: Active; picks: Picks }
  }
}
