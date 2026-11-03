/**
 * `sauce where`: the chains one program compiles on. It compiles the file for every chain the SDK
 * knows (or the ones `--chains` names), the same compile `sauce compile` runs, and says for each
 * whether it compiled and how large it is, or the first reason it did not: a token or protocol the
 * chain has no name for, most often. It reads no chain and needs no key.
 */
import { canonicalChains, type CanonicalChain } from "../chains/canonical.js";
import { UsageError } from "./args.js";
import {
  compileProgram,
  type CliFiles,
  type CommandOutput,
  type ProgramInput,
} from "./commands.js";
import { chainSupport, type ChainSupport } from "./support.js";

export interface WhereInput {
  readonly file: string;
  readonly text: string;
  readonly stdin?: boolean;
  readonly sourceDir?: string;
  /** The chains to try, in order; every chain the SDK knows when absent. */
  readonly chains?: readonly CanonicalChain[];
  /** Only the chains Sauce builds and sends transactions on. */
  readonly supported?: boolean;
}

interface Attempt {
  readonly chain: CanonicalChain;
  readonly support: ChainSupport;
  readonly bytes?: number;
  readonly reason?: string;
}

/** The first sentence of why the compile refused, the chain's own name put as "there", so the
 *  chains that refuse for one reason are listed together. */
function reasonOf(error: unknown, file: string, chain: CanonicalChain): string {
  const lines = String(error instanceof Error ? error.message : error)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith(`${file} does not compile`));
  const first = (lines[0] ?? "does not compile")
    .replace(/^error:\s*/i, "")
    .replace(/^[A-Za-z]+: /, "");
  const sentence = /^(.*?[.!?])(\s|$)/.exec(first)?.[1] ?? first;

  return sentence
    .replace(new RegExp(` on ${chain.slug}(?=\\W|$)`, "g"), " there")
    .replace(/\.$/, "");
}

export function whereCommand(input: WhereInput, files: CliFiles): CommandOutput {
  const chains = (input.chains ?? canonicalChains).filter(
    (chain) => input.supported !== true || chainSupport(chain) === "supported",
  );
  if (chains.length === 0) throw new UsageError("no chain to compile for");
  const attempts: Attempt[] = chains.map((chain) => {
    const program: ProgramInput = {
      file: input.file,
      text: input.text,
      ...(input.stdin === true ? { stdin: true } : {}),
      ...(input.sourceDir === undefined ? {} : { sourceDir: input.sourceDir }),
      chain,
      defines: {},
    };
    const support = chainSupport(chain);
    try {
      return { chain, support, bytes: compileProgram(program, files).bytecode.length };
    } catch (error) {
      return { chain, support, reason: reasonOf(error, input.file, chain) };
    }
  });
  const ok = attempts.filter((each) => each.bytes !== undefined);
  const width = Math.max(0, ...ok.map((each) => each.chain.slug.length));
  const line = (each: Attempt): string =>
    `  ✓ ${each.chain.slug.padEnd(width)}  ${each.chain.kind}  ${each.support.padEnd(9)}  ` +
    `${each.bytes} bytes`;
  // The chains that refuse, one line for each reason.
  const reasons = new Map<string, string[]>();
  for (const each of attempts) {
    if (each.reason !== undefined)
      reasons.set(each.reason, [...(reasons.get(each.reason) ?? []), each.chain.slug]);
  }
  const text = [
    `${input.file} compiles on ${ok.length} of ${attempts.length} chains` +
      (ok.length === 0
        ? ""
        : ` (${ok.filter((each) => each.support === "supported").length} supported)`),
    "",
    ...ok.map(line),
    ...[...reasons].flatMap(([reason, slugs]) => [
      "",
      `  ✗ ${reason} (${slugs.length}): ${slugs.join(", ")}`,
    ]),
  ];

  return {
    text: text.join("\n"),
    json: {
      file: input.file,
      compiles: ok.length,
      chains: attempts.map((each) => ({
        chain: each.chain.slug,
        id: each.chain.id,
        kind: each.chain.kind,
        support: each.support,
        compiles: each.bytes !== undefined,
        ...(each.bytes === undefined ? { reason: each.reason } : { bytes: each.bytes }),
      })),
    },
  };
}
