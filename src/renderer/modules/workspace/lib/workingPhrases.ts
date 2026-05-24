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
  "Thinking",
  "Cooking",
  "Working on it",
  "Crunching",
  "Reading the room",
  "Reasoning",
  "Mapping it out",
  "Connecting dots",
  "Drafting",
  "Sketching",
  "Pondering",
  "Wrangling tokens",
  "Plotting a course",
  "Calibrating",
  "Chewing on it",
  "Consulting the void",
  "Consulting the oracle",
  "Defragmenting thoughts",
  "Doing the math",
  "Dusting off the neurons",
  "Fetching wisdom",
  "Figuring it out",
  "Finding the signal",
  "Firing synapses",
  "Following the thread",
  "Getting my bearings",
  "Herding ideas",
  "Interrogating the data",
  "Juggling variables",
  "Loading context",
  "Looking it up",
  "Making sense of things",
  "Mulling it over",
  "Navigating the noise",
  "Noodling on this",
  "On the case",
  "Parsing the chaos",
  "Piecing it together",
  "Processing",
  "Pulling threads",
  "Reverse engineering",
  "Ruminating",
  "Running the numbers",
  "Shaking the tree",
  "Sifting through the noise",
  "Simulating possibilities",
  "Sorting it out",
  "Spelunking for answers",
  "Squinting at the problem",
  "Stress-testing ideas",
  "Synthesizing",
  "Tracing the logic",
  "Untangling the knot",
];
