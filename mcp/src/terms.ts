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
const SWITCHES = "tokens|protocols|deploy|dry-run|json|compact-args|yes|force|install";
const FLAGS_AFTER = String.raw`(?:\s+(?:--(?:${SWITCHES})\b(?!-)|--?[\w-]+(?:[ =](?!-)[^\s\x60),;]+)?))*`;
const command = (head: string): RegExp => new RegExp(`\`?${head}${FLAGS_AFTER}\`?`, "g");

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
    "a signed run (outside this server: sign and send sauce_tx's transaction)",
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
  [command("sauce (globals|compile|simulate|tx|pot|inspect|verify|price)"), "sauce_$1"],
  // A flag, as the input of the same meaning. `--config` is the operator's, and stays.
  [/pass them after --args, in order, or as --args-json/g, "pass them as args, in order"],
  [/--args-json\b|--args\b/g, "args"],
  [/--assume-balance\b/g, "assumeBalance"],
  [/--fund-mode\b/g, "fundMode"],
  [/--fund\b/g, "fund"],
  [/--sweep\b/g, "sweep"],
  [/--salt-hex\b/g, "saltHex"],
  [/--salt\b/g, "salt"],
  [/--owner\b/g, "owner"],
  [/--pot\b/g, "pot"],
  [/--value\b/g, "value"],
  [/--account\b/g, "accounts"],
  [/--intent-deadline\b/g, "intentDeadline"],
  [/--intent-creator\b/g, "intentCreator"],
  [/--intent-execution-fee\b/g, "intentExecutionFee"],
  [/--intent-fund-via\b/g, "intentFundVia"],
  [/--max-execution-fee\b/g, "maxExecutionFee"],
  [/--via\b/g, "via"],
  [/--compact-args\b/g, "compactArgs"],
  [/--defines?\b/g, "defines"],
  [/--chain\b/g, "chain"],
  [/--target\b/g, "target"],
  [/--rpc-url\b/g, "rpcUrl"],
  [/--from\b/g, "from"],
  [/--solver\b/g, "solver"],
  [/--claimant\b/g, "claimant"],
  [/--dry-run\b/g, "dryRun"],
  [/--pin\b/g, "pins"],
  [/--engine\b/g, "engines"],
  [/--min-out\b/g, "minOut"],
  [/--spl-count\b/g, "splCount"],
  [/--protocol\b/g, "protocol"],
  [/--sqrt-price-x96\b/g, "sqrtPriceX96"],
];

/** `text` in the tools' words. */
export function toolTerms(text: string): string {
  if (!text.includes("--") && !text.includes("sauce ")) return text;
  let out = text;
  for (const [pattern, replacement] of STEPS) out = out.replace(pattern, replacement);

  return out;
}
