/**
 * An actions document as a program operand: `sauce actions <file>` prints the SauceScript it lowers
 * to on a chain and what that compiles to, and `compile`, `tx`, `simulate` and `run` take the
 * document wherever they take a `.sauce.ts` file.
 *
 * Nothing is lowered here. The document goes to the actions package's own lowering
 * (`programSource`, in `actions/src/compose.ts`), which checks every name it uses on the chain and
 * returns the generated source and the ABI bindings it calls through; from there the document is an
 * ordinary `ProgramInput`, so its compile, cook, Pot, arguments and funding are the ones every
 * program gets (`commands.ts`). `actionsCommand` is the one function `sauce actions` runs, and the
 * MCP server's `sauce_actions` tool calls it too.
 *
 * The actions package is loaded at run time, by path: in the repository and in the published
 * package `actions/dist` sits beside `sdk/dist`, but the SDK builds first, so its compile cannot
 * import a package not built yet. NODE-ONLY, like the rest of `cli/`.
 */
import type { CanonicalChain } from "../chains/canonical.js";
import type { SauceCompileOptions } from "../routes/sauce-route.js";
import { CliError, parseChain, UsageError } from "./args.js";
import {
  compileCommand,
  type CliFiles,
  type CommandOutput,
  type ProgramInput,
} from "./commands.js";

/** An actions document given to a command. */
export interface ActionsInput {
  /** Where the document came from, for messages: a path, or `<stdin>`. */
  readonly file: string;
  /** The document: its JSON text. */
  readonly text: string;
  /**
   * The chain to compile for, a slug or a chain id. Defaults to the document's `chainId`; a
   * document without one needs it, and one with a `chainId` compiles for that chain only.
   */
  readonly chain?: string;
}

/** What the actions package's lowering returns (`actions/src/compose.ts#ProgramSource`). */
interface ProgramSource {
  readonly chain: CanonicalChain;
  readonly program: { readonly chainId?: number };
  readonly source: string;
  readonly contracts: NonNullable<SauceCompileOptions["contracts"]>;
  readonly parameters: readonly string[];
}

interface ActionsModule {
  programSource(program: unknown, chain?: string | number): ProgramSource;
}

/** The actions package's compose module, beside the SDK's build in both layouts. */
async function actionsModule(): Promise<ActionsModule> {
  const url = new URL("../../../actions/dist/compose.js", import.meta.url).href;
  try {
    return (await import(url)) as ActionsModule;
  } catch (error) {
    throw new CliError(
      `the actions package is not where the sauce command expects it (${url}): ${(error as Error).message}`,
    );
  }
}

/**
 * True when `text` is an actions document rather than SauceScript: a JSON object with an `actions`
 * array. SauceScript never parses as one.
 */
export function isActionsDocument(text: string): boolean {
  if (!/^\s*\{/.test(text)) return false;
  try {
    const value = JSON.parse(text) as unknown;

    return typeof value === "object" && value !== null && "actions" in value;
  } catch {
    return false;
  }
}

/** A failure of the document, as one message naming the file and every problem with its path. */
function documentError(error: unknown, input: ActionsInput): never {
  if (error instanceof Error && error.name === "ProgramError") {
    const { issues, chain } = error as Error & {
      issues: readonly { path: string; message: string }[];
      chain?: CanonicalChain;
    };
    const heading =
      chain === undefined
        ? `${input.file} is not a valid actions document`
        : `${input.file} does not compile for ${chain.slug}`;

    throw new CliError(`${heading}:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`);
  }
  if (error instanceof Error && /has no `chainId`, so say which chain/.test(error.message)) {
    throw new UsageError(
      `missing --chain <slug|id>: ${input.file} has no chainId, so it compiles for the chain you ` +
        "name (any chain where its tokens and contracts exist)",
    );
  }
  throw new CliError(`${input.file}: ${(error as Error).message}`);
}

/** The document lowered for its chain, or a message about the file. */
async function lowered(input: ActionsInput): Promise<ProgramSource> {
  let document: unknown;
  try {
    document = JSON.parse(input.text);
  } catch (error) {
    throw new CliError(`${input.file} is not JSON: ${(error as Error).message}`);
  }
  // Checked here first, so a slug the SDK does not know reads as the flag's error.
  const chain = input.chain === undefined ? undefined : parseChain(input.chain).slug;
  const { programSource } = await actionsModule();
  try {
    return programSource(document, chain);
  } catch (error) {
    return documentError(error, input);
  }
}

/** The document as the program operand of `compile`, `tx`, `simulate` or `run`. */
export async function actionsProgram(input: ActionsInput): Promise<ProgramInput> {
  const { chain, source, contracts } = await lowered(input);

  return {
    file: input.file,
    text: source,
    chain,
    defines: {},
    contracts,
  };
}

/**
 * `sauce actions`: the SauceScript an actions document lowers to on its chain, and what it
 * compiles to — as text, the source followed by its `main` and bytecode as comments; as JSON, the
 * compile report `sauce compile --json` prints, with the document, the source and the bindings.
 */
export async function actionsCommand(
  input: ActionsInput,
  files: CliFiles = NO_FILES,
): Promise<CommandOutput> {
  const lowering = await lowered(input);
  const program: ProgramInput = {
    file: input.file,
    text: lowering.source,
    chain: lowering.chain,
    defines: {},
    contracts: lowering.contracts,
  };
  const compiled = await compileCommand(program, files);
  const bytecode = compiled.json.bytecode as string;
  const size = compiled.json.size as number;
  const { chain } = lowering;
  const signature = `main(${lowering.parameters.map((name) => `a_${name}: Uint256`).join(", ")})`;

  return {
    text: [
      `// ${input.file}, lowered for ${chain.slug} (chain ${chain.id})`,
      lowering.source.trimEnd(),
      "",
      `// ${signature}${lowering.parameters.length === 0 ? "" : ": pass the arguments in this order"}`,
      `// bytecode, ${size} bytes: ${bytecode}`,
    ].join("\n"),
    json: {
      ...compiled.json,
      document: lowering.program,
      source: lowering.source,
      // The ABI bindings the source calls through, by name: not `contracts`, which is the compile
      // report's — the protocol contracts the program calls, resolved on their chain.
      bindings: Object.keys(lowering.contracts),
      parameters: lowering.parameters,
    },
  };
}

/** A generated program imports nothing from beside a file: there is no file to read. */
const NO_FILES: CliFiles = {
  readText: (path) => {
    throw new CliError(`${path}: an actions document reads no file`);
  },
  readModule: () => undefined,
};
