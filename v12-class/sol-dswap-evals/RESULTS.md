# Solana distributed swap: headless agent evaluations

The `sauce-solana-distributed-swap` skill (eco-incorp/sauce #100, merged as e55bc0ba), evaluated
with headless Claude Code agents. All runs were rehearsals only: no keys were used and nothing was
sent.

**Task, the same in every run:**

> Do a distributed swap on Solana: sell 500 USDC for SOL (or a pair you choose with real pools)
> across every venue that supports a price limit, never below 0.0084 SOL per USDC, and rehearse it
> with sauce simulate. It is a rehearsal only: use no keys and send nothing.

The correct `maxPrice` for that floor is `10^15 ÷ 0.0084` = **119047619047619047**.

**Modes:**

- **A (skills + CLI):** run in `sauce-agent-demo`, with the skills installed by `pnpm skills:update`
  and no MCP server.
- **B (MCP only):** run in `sauce-agent-demo-mcp`, with no skills on disk, `sauce mcp` over stdio,
  and the `sauce` CLI denied to Bash.

**Harness settings** (`config/settings-{A,B}.json`, `config/run.sh`):

- Read is denied for `.env*`, `.secrets`, `sauce.config.json`, the SDK source and other runs' files.
- After each task the session is resumed with one feedback question; its cost is the "feedback"
  column.
- Each run's transcript, feedback and the files it wrote are in its directory.

## Results

Costs are USD, as task + feedback.

| Round | Run       | Outcome                                                                                                                                | Cost        | Time  |
| ----- | --------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----- |
| 1     | A-opus    | No clean rehearsal: every cook hit the local-copy rent bug. The program (5 slots) and `maxPrice` were correct.                         | 1.16 + 1.78 | 299 s |
| 1     | A-sonnet  | No clean rehearsal: the rent bug. The program and `maxPrice` were correct.                                                             | 0.35 + 0.59 | 151 s |
| 1     | A-haiku   | Failed: `maxPrice` wrong (8.4e15, the floor not inverted), the rent bug, then claimed success.                                         | 0.24 + 0.36 | 364 s |
| 1     | B-opus    | Blocked: `sauce_pools` failed its own MCP output schema on Solana, so no slots came back.                                              | 0.69 + 1.30 | 119 s |
| 1     | B-sonnet  | No clean rehearsal: the rent bug.                                                                                                      | 0.69 + 1.06 | 285 s |
| 1     | B-haiku   | No clean rehearsal: the rent bug, then claimed success.                                                                                | 0.31 + 0.46 | 310 s |
| 2     | A-opus    | **Correct.** One slot per venue (5 slots), clean rehearsal at 403k CU, both guard reverts checked.                                     | 0.76 + 1.31 | 270 s |
| 2     | A-sonnet  | **Correct.** Clean rehearsal on its first try. (A first attempt was blocked by a harness deny rule and discarded, $0.09 + $0.17.)      | 0.17 + 0.32 | 69 s  |
| 2     | A-haiku   | Failed: passed non-wallet owners (System program, pools), and the copy answered only "5". Its `maxPrice` and accounts were correct.    | 0.35 + 0.48 | 365 s |
| 2     | B-opus    | **Correct.** 5 slots, clean rehearsal, both guard reverts checked.                                                                     | 1.10 + 1.95 | 203 s |
| 2     | B-sonnet  | **Correct.** Clean on its first simulate.                                                                                              | 0.40 + 0.72 | 111 s |
| 2     | B-haiku   | Failed: all slots empty, `maxPrice` 1000x too small, claimed success.                                                                  | 0.18 + 0.29 | 131 s |
| 3     | A-haiku   | **Correct.** Used `sauce pools --pay … --per-venue`; clean rehearsal: 500 USDC bought 4.30 SOL. It went unread that 8 of 9 venues were missing on the public endpoint (since fixed). | 0.11 + 0.18 | 112 s |
| 3     | B-haiku   | Failed: wrote its own program, `maxPrice` 116e15, empty slots, claimed success on a revert. The owner refusal worked.                  | 0.65 + 0.74 | 406 s |

**Totals:**

- About $18.94 across the 14 counted runs and their feedback turns, plus the discarded A-sonnet
  attempt.
- Probes: about $0.25.
- One B-sonnet start was aborted before it rehearsed, to fix the MCP schema bug first.

**By model, after round 1's fixes:**

- opus: correct in both modes.
- sonnet: correct in both modes.
- haiku: correct with skills + CLI (round 3); not correct over MCP only.

## What the runs changed

Every change below is in #100.

**After round 1:**

- The local copy kept LiteSVM's default rent rather than mainnet's (5080 lamports a byte-year at
  one year), so every rehearsed cook failed. It now reads the cluster's Rent sysvar.
- `sauce_pools`' MCP output schema now takes a Solana result.
- A failure names the account behind an error's index, and keeps what `main` returned.
- `SOL` names WSOL, and stale Phoenix books are skipped.
- `sauce_pools` takes a `limit`.
- LiteSVM became a runtime dependency of the package.
- Skill text:
  - use the program whole;
  - how to add a fifth slot;
  - inverting a floor (with the 0.0084 row);
  - the owner rule;
  - SOL is WSOL.

**After round 2:**

- `sauce pools --pay --max-price --per-venue --slots` chooses the slots and prints their accounts.
- A partial listing exits 1.
- `sauce run` creates missing Pot and owner token accounts.
- A non-wallet owner is refused by name, and LiteSVM's errors are named.

**After round 3:**

- The skill says when a rehearsal counts: it succeeds and `bought` is above 0.
- The skill spells out `--assume-balance` and the account forms.

**Completion:**

- A revert is unmistakable:
  - the CLI's first line, exit 1;
  - in JSON, `reverted` and `error` lead the object;
  - MCP returns an error result.
- `--expect-revert` / `expectRevert` assert a guard's revert.
- Solana scenarios rehearse on one snapshot (one slot).
- Public endpoints:
  - scans go only to an endpoint that answers them;
  - a refused scan is retried after 1, 2 and 4 seconds;
  - live, all 9 venues are read.
- A five-slot example program.

## Harness issues

- A deny rule, `Bash(* sauce.config.json)`, blocked a legitimate `--config sauce.config.json` at the
  end of a command. A-sonnet's first round-2 attempt was discarded because of it, and A-opus-r2 was
  pushed onto the public endpoints.
- An `Edit(**/.claude/skills/**)` rule blocked copying the example out of the skills.
- Both rules were removed and checked with a probe before round 3.
