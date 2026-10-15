/**
 * The `sauce` command's words, as this server's tools say them. The tools return the command's own
 * messages and notes, which name its flags (`--salt-hex`) and its commands (`sauce pot --deploy …`);
 * an agent calling a tool knows inputs (`saltHex`) and tools (`sauce_pot`). This rewrites one into
 * the other, in errors, notes and every result string but a program's text.
 */

/**
 * A command's flags and their values, as a note spells them after the command. A switch takes no
 * value, so the word after it is the sentence again (`--tokens lists them`).
 */
const SWITCHES = "tokens|protocols|stocks|deploy|dry-run|json|compact-args|yes|force|install";
const FLAGS_AFTER = String.raw`(?:\s+(?:--(?:${SWITCHES})\b(?!-)|--?[\w-]+(?:[ =](?!-)[^\s\x60),;]+)?))*`;
const command = (head: string): RegExp => new RegExp(`\`?${head}${FLAGS_AFTER}\`?`, "g");

/** A `sauce` flag (or flags) and the tool input of the same meaning. */
export interface FlagInput {
  /** Without their `--`; the first is the one a person writes. */
  readonly flags: readonly string[];
  readonly input: string;
  /** A low-level flag (`--define`): rewritten in messages, never listed for an agent to use. */
  readonly lowLevel?: true;
}

/**
 * Every flag of the `sauce` command a tool takes as an input, and that input: the table the
 * server's instructions and the MCP guide print, and what the rewrites below turn a message's
 * flags into. A flag another flag starts with comes after it (`--salt-hex`, then `--salt`): each
 * is rewritten in this order.
 */
export const FLAG_INPUTS: readonly FlagInput[] = [
  { flags: ["args", "args-json"], input: "args" },
  { flags: ["assume-balance"], input: "assumeBalance" },
  { flags: ["fund-mode"], input: "fundMode" },
  { flags: ["fund"], input: "fund" },
  { flags: ["sweep"], input: "sweep" },
  { flags: ["salt-hex"], input: "saltHex" },
  { flags: ["salt"], input: "salt" },
  { flags: ["owner"], input: "owner" },
  { flags: ["pot"], input: "pot" },
  { flags: ["value"], input: "value" },
  { flags: ["account", "accounts"], input: "accounts" },
  { flags: ["intent-deadline"], input: "intentDeadline" },
  { flags: ["intent-creator"], input: "intentCreator" },
  { flags: ["intent-execution-fee"], input: "intentExecutionFee" },
  { flags: ["intent-fund-via"], input: "intentFundVia" },
  { flags: ["intent-reward-deadline"], input: "intentRewardDeadline" },
  { flags: ["intent-prover"], input: "intentProver" },
  { flags: ["no-prove"], input: "prove: false" },
  { flags: ["max-execution-fee"], input: "maxExecutionFee" },
  { flags: ["lookup-table"], input: "lookupTables" },
  { flags: ["cursor"], input: "cursor" },
  { flags: ["signature"], input: "signatures" },
  { flags: ["close"], input: "close: true" },
  { flags: ["keep-tables"], input: "keepTables" },
  { flags: ["keep"], input: "keep" },
  { flags: ["via"], input: "via" },
  { flags: ["compact-args"], input: "compactArgs" },
  { flags: ["define", "defines"], input: "defines", lowLevel: true },
  { flags: ["chain"], input: "chain" },
  { flags: ["target"], input: "target" },
  { flags: ["rpc-url"], input: "rpcUrl" },
  { flags: ["block"], input: "block" },
  // A fill's solver is its `from`, as every other transaction's sender is.
  { flags: ["from", "solver"], input: "from" },
  { flags: ["claimant"], input: "claimant" },
  { flags: ["dry-run"], input: "dryRun" },
  { flags: ["pin"], input: "pins" },
  { flags: ["engine"], input: "engines" },
  { flags: ["min-out"], input: "minOut" },
  { flags: ["spl-count"], input: "splCount" },
  { flags: ["protocol"], input: "protocol" },
  { flags: ["stocks"], input: "stocks" },
  { flags: ["search"], input: "search" },
  { flags: ["sqrt-price-x96"], input: "sqrtPriceX96" },
  { flags: ["pool"], input: "pool" },
  { flags: ["v4-key"], input: "v4Pools" },
  { flags: ["pay"], input: "pay" },
  { flags: ["max-price"], input: "maxPrice" },
  { flags: ["per-venue"], input: "perVenue" },
  { flags: ["slots"], input: "slots" },
  { flags: ["expect-revert"], input: "expectRevert" },
];

/** What the mapping does not show flag by flag: a command is its tool, and a file its text. */
export const COMMAND_TOOLS = [
  "`sauce <command>` is the tool sauce_<command> (`sauce intent status` is sauce_intent_status).",
  "A program file is `source`, its text (over stdio, `path` names the file instead); every result",
  "is the command's --json; a tool that reads several chains takes `rpcUrls`, one per chain.",
] as const;

/** {@link FLAG_INPUTS} but the low-level ones: the table the instructions and the guide print. */
export const LISTED_FLAG_INPUTS = FLAG_INPUTS.filter((entry) => entry.lowLevel !== true);

/** {@link LISTED_FLAG_INPUTS} as lines of `--flag → input`, for the server's instructions. */
export function flagInputLines(width = 96): string[] {
  const lines: string[] = [];
  let line = "";
  for (const { flags, input } of LISTED_FLAG_INPUTS) {
    const entry = `${flags.map((flag) => `--${flag}`).join("/")} → ${input}`;
    if (line !== "" && line.length + 2 + entry.length > width) {
      lines.push(line);
      line = "";
    }
    line = line === "" ? entry : `${line}, ${entry}`;
  }

  return line === "" ? lines : [...lines, line];
}

const STEPS: ReadonlyArray<readonly [RegExp, string]> = [
  // A signer never reaches this server: what a note would sign with goes.
  [/\s--(?:keystore|keypair|private-key|password-file)\s<[^>]*>/g, ""],
  // `sauce pot --deploy …` and `sauce run …` sign: the server builds, the caller signs and sends.
  [
    command("sauce pot --deploy"),
    "sauce_pot (its unsigned deployment, which any account may send)",
  ],
  [/`?sauce run`?(?= would)/g, "a signed run"],
  [
    command("sauce run"),
    "a signed run (sign sauce_tx's transactions with any signer, then sauce_send them)",
  ],
  // fill's: --rpc-url is one destination's endpoint; the call's rpcUrls names each.
  [/so give --config, which names each destination's/g, "so give rpcUrls, which names each one"],
  [
    /`sauce (?:intent )?fill` with the same file and flags/g,
    "sauce_intent_fill with the same inputs",
  ],
  // An intent's commands are its tools under sauce_intent_, spelt either way the command line has.
  [command("sauce (?:intent )?(publish|fill)"), "sauce_intent_$1"],
  [command("sauce intent (status|import|prove|claim|refund|cancel)"), "sauce_intent_$1"],
  [command("sauce (globals|compile|simulate|tx|pot|inspect|verify|price|pools)"), "sauce_$1"],
  // `sauce intent show`'s, with no endpoint for the intent's chains: the call can give them.
  [
    /no endpoint given: --config with both chains' endpoints shows where it stands/g,
    "no endpoint reached its chains: rpcUrls with both chains' endpoints shows where it stands",
  ],
  // A wallet's commands are its tools; `wallet new` is sauce_wallet_create.
  [/`?sauce wallet new(?: [a-z0-9][a-z0-9_-]*)?`?/g, "sauce_wallet_create"],
  [/`?sauce wallet (list|address|import)`?/g, "sauce_wallet_$1"],
  // The lifecycle core's refusal for a chain it has no endpoint of: the call can give one.
  [
    /needs ([\w-]+)'s endpoint \(chain id (\d+)\)/g,
    'needs $1\'s endpoint (chain id $2): pass rpcUrls { "$1": "<url>" } with the call',
  ],
  // A flag, as the input of the same meaning (FLAG_INPUTS). `--config` is the operator's, and stays.
  [/pass them after --args, in order, or as --args-json/g, "pass them as args, in order"],
  // The longer of an entry's flags first: `--args` would match the start of `--args-json`.
  ...FLAG_INPUTS.flatMap(({ flags, input }) =>
    [...flags]
      .sort((a, b) => b.length - a.length)
      .map((flag) => [new RegExp(`--${flag}\\b`, "g"), input] as const),
  ),
];

/** `text` in the tools' words. */
export function toolTerms(text: string): string {
  if (!text.includes("--") && !text.includes("sauce ") && !text.includes("endpoint (chain id")) {
    return text;
  }
  let out = text;
  for (const [pattern, replacement] of STEPS) out = out.replace(pattern, replacement);

  return out;
}
