/**
 * `sauce where`: the chains one program compiles on. It compiles the file for every chain the SDK
 * knows (or the ones `--chains` names), the same compile `sauce compile` runs, and says for each
 * whether it compiled and how large it is, or the first reason it did not: a token or protocol the
 * chain has no name for, most often. It reads no chain and needs no key.
 */
import { canonicalChains, type CanonicalChain } from "../chains/canonical.js";
import { compileDiagnostics } from "../wasm-compiler.js";
import { CliError, parseHeader, parseTarget, UsageError } from "./args.js";
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

/**
 * The first sentence of why the compile refused, the chain's own name put as "there", so the
 * chains that refuse for one reason are listed together. `failure` is the compile's own error
 * (`compileProgram`'s `cause`): the compiler's, whose first diagnostic is the reason, or the SDK's
 * refusal, whose message is.
 */
function reasonOf(failure: unknown, chain: CanonicalChain): string {
  const placed = compileDiagnostics(failure)?.[0]?.message.split("\n")[0]?.trim();
  const first = placed || textReason(failure);
  // A sentence ends at a stop before a space or the end of the text, never inside an ellipsis
  // (the compiler writes `{ ... }` in its advice).
  const sentence = /^(.*?[^.][.!?])(?:\s|$)/.exec(first)?.[1] ?? first;

  return sentence
    .replace(new RegExp(` on ${chain.slug}(?=\\W|$)`, "g"), " there")
    .replace(/\.$/, "");
}

/**
 * The reason a failure the compiler placed nowhere gives in its text: the SDK's refusal
 * (`compileSauceRoute: …`), a parse error, or the compiler's error with no diagnostic, a module that
 * does not resolve among them, whose report wraps its cause
 * (`compiling the program failed │ ├─▶ … ╰─▶ <cause>`).
 */
function textReason(failure: unknown): string {
  const lines = String(failure instanceof Error ? failure.message : failure)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const cause = lines.find((line) => line.startsWith("╰─▶ "))?.slice("╰─▶ ".length);

  return (cause ?? lines[0] ?? "does not compile")
    .replace(/^error:\s*/i, "")
    .replace(/^[A-Za-z]+: /, "");
}

export function whereCommand(input: WhereInput, files: CliFiles): CommandOutput {
  const chains = (input.chains ?? canonicalChains).filter(
    (chain) => input.supported !== true || chainSupport(chain) === "supported",
  );
  if (chains.length === 0) throw new UsageError("no chain to compile for");
  // A `// @target` header holds here as it does for `sauce compile`: a chain of the other kind
  // is refused before it is compiled.
  const targetRaw = parseHeader(input.text, input.file).target;
  const target =
    targetRaw === undefined ? undefined : parseTarget(targetRaw, `${input.file}'s // @target`);
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
    if (target !== undefined && target !== chain.kind) {
      return {
        chain,
        support,
        reason: `the file's \`// @target ${target}\` does not match ${chain.kind.toUpperCase()} chains`,
      };
    }
    try {
      return { chain, support, bytes: compileProgram(program, files).bytecode.length };
    } catch (error) {
      // `compileProgram` names the file and the chain; its `cause` is the compile's own error.
      const failure = error instanceof CliError && error.cause !== undefined ? error.cause : error;

      return { chain, support, reason: reasonOf(failure, chain) };
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
