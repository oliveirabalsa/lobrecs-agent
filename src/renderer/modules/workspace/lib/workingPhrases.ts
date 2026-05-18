/**
 * Phrases that cycle in the WorkingState row while a turn is in flight.
 *
 * Design notes (so future-you doesn't drift):
 *  - Present participle, no trailing punctuation — the renderer appends "…".
 *  - Keep each phrase under ~20 chars so the row stays one line on the narrow
 *    workspace column.
 *  - Avoid implementation detail ("Spawning worktree", "Calling tool") — that
 *    was the old STEP pill problem. Phrases should read as a personality, not
 *    as a status log.
 *  - Aim for ~12–20 phrases so repeats feel rare across a typical turn.
 *
 * TODO(human): replace this seed list with the lobrecs voice. Pick phrases
 * that match how you want the product to feel — playful, terse, professional,
 * etc. Mix in a few brand-flavored ones so it doesn't sound generic.
 */
export const WORKING_PHRASES: readonly string[] = [
  'Thinking',
  'Cooking',
  'Working on it',
  'Crunching',
  'Reading the room',
  'Reasoning',
  'Mapping it out',
  'Connecting dots',
  'Drafting',
  'Sketching',
  'Pondering',
  'Wrangling tokens',
]
