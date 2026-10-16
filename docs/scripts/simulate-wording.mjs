// The word for running something with no key and sending nothing is simulate: the command is
// `sauce simulate`, and what it, a dry run and a fill without --send run is a simulation. So nothing
// a user or an agent reads says rehearse or rehearsal. `docs:check` applies this to the manual (the
// README, every page under docs/ and the examples), `skills:check` to every file of the skills,
// comments included, and `sdk/test/simulate-wording.test.ts` to every string the shipped source
// holds: the `sauce` command's --help and output, the MCP server's tools and instructions.

const WORD = /\w*rehears\w*/gi;

/** Each line of `text` that says rehearse, as `where:line: …`. */
export function simulateWordingProblems({ where, text }) {
  return text
    .split("\n")
    .flatMap((line, i) =>
      [...line.matchAll(WORD)].map(
        (m) => `${where}:${i + 1}: says "${m[0]}"; say simulate (a simulation, simulated)`,
      ),
    );
}
