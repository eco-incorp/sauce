/**
 * A line of text the `sauce` command asks for at a terminal, over the injected `ask`
 * (`run.ts#nodeIo` reads it with `node:readline`, the same way it asks yes or no), so a test
 * answers it and no prompt dependency is needed.
 */

/** Asks `question` and returns the line typed; `undefined` where there is no terminal. */
export type Ask = (question: string) => Promise<string | undefined>;
