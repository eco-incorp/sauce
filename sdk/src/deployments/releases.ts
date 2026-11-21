/**
 * Which v12 engine runs which compiler's output — ONE table, keyed by exact versions.
 *
 * Compiler output and engines are compatible in both directions or not at all. Compiler 2.4.0's EVM
 * programs carry `ABI_ENCODE` type lists a v12-evm 1.0.x engine reads as instructions, and its SVM
 * programs rely on the untyped stack of v12-svm 1.3.0; 2.3.x output must not reach the new engines
 * either. The ISA label cannot tell them apart — v12-svm 1.2.0 and 1.3.0 both report
 * `stack-compact-v2` — so the pairing is by exact package version, recorded in `releases.json`.
 *
 * The same rows drive `sync-engine-artifacts`, which fetches the row of the installed compiler, so
 * the artifacts on disk pair with the compiler that runs. What this module adds is the refusal at
 * call-build time: every SDK builder that names an engine — `v12Pot.encodeCook`, the SVM engine and
 * Kitchen cook instructions — calls {@link assertEngineRunsCompiler} first, which refuses an
 * engine that does not run the program's compiler ({@link engineRunsCompiler}).
 *
 * An engine can also run a later compiler's output where that compiler's row lists the engine's
 * version in `alsoRunsOn`, an evidenced fact: compiler 2.6.3's output runs on v12-evm 1.3.0 and
 * v12-svm 1.4.0, so Pots of those releases still cook (each on its own engine).
 *
 * An engine no row names (a local deployment, a fork's own) is not refused: the SDK cannot tell
 * what it is. A row's engine is known from its release's `addresses.json`; current engines are
 * content-addressed, so a runtime change also changes the EVM address or SVM program id.
 */
import table from "./releases.json" with { type: "json" };
import { v12DeployedAddresses } from "./v12-addresses.js";

/** The four independently released v12 components the SDK pins. */
export type V12Component = "v12-evm" | "kitchen-evm" | "v12-svm" | "kitchen-svm";

/** One pinned release: its version, the digest of each asset the sync takes from it (`null` until
 *  the release exists), and — for the two engines — the engine's own identity. */
export interface V12ReleasePin {
  readonly version: string;
  readonly assets: Readonly<Record<string, string | null>>;
  /** The EVM engine's address or the SVM engine's program id; `null` until the release says. */
  readonly engine?: string | null;
}

/** The EVM Kitchen's release: legacy CREATE2 init-code identity or the qualified CREATE3 profile. */
export interface V12KitchenEvmPin extends V12ReleasePin {
  readonly kitchen: string | null;
  readonly potInitCodeHash: string | null;
  readonly potProfileHash?: string;
  readonly potProxyInitCodeHash?: string;
  readonly fixedRouter?: string;
}

/** One compiler version and the four releases its output pairs with. */
export interface V12ReleaseSet {
  readonly compiler: string;
  /**
   * Earlier engine releases this compiler's output also runs on, besides the row's own engines, by
   * version: `{ "v12-evm": ["1.3.0"] }`. Each is an evidenced fact; an ISA label never is one.
   */
  readonly alsoRunsOn?: Readonly<Partial<Record<"v12-evm" | "v12-svm", readonly string[]>>>;
  /** No row sets it since SDK 1.2.0: a row's own releases are the defaults. Kept so code reading
   *  it still compiles. */
  readonly deployedCompiler?: string;
  /** The public `@eco-incorp/sauce` version whose tarball carries this row's artifacts, held to
   *  its integrity (`sync-engine-artifacts`' public source); `compiler` names the row it was built
   *  from when that is another. Always in the JSON; typed now so the suites can read it. */
  readonly npm?: {
    readonly version: string;
    readonly integrity: string;
    readonly compiler?: string;
  };
  readonly "v12-evm": V12ReleasePin & { readonly engine: string | null };
  readonly "kitchen-evm": V12KitchenEvmPin;
  readonly "v12-svm": V12ReleasePin & { readonly engine: string | null };
  readonly "kitchen-svm": V12ReleasePin;
}

/** Every release set the SDK knows, oldest first. */
export const V12_RELEASE_SETS: readonly V12ReleaseSet[] = (
  table as { releases: readonly V12ReleaseSet[] }
).releases;

/** The compiler version this SDK compiles with — the one its pinned engines were synced for. */
export const sdkCompilerVersion = (): string => v12DeployedAddresses().compiler;

/** The row for exactly `compiler`, or a throw naming the known ones. */
function releaseRow(compiler: string): V12ReleaseSet {
  const set = V12_RELEASE_SETS.find((row) => row.compiler === compiler);
  if (set === undefined) {
    throw new Error(
      `no v12 release set pairs with compiler ${compiler} — the known ones are for ` +
        `${V12_RELEASE_SETS.map((row) => row.compiler).join(", ")} (deployments/releases.json)`,
    );
  }

  return set;
}

/**
 * The release set for `compiler`, or a throw naming the known ones. With no argument it is the
 * installed compiler's own row (`sdkCompilerVersion()`): the release every default of this SDK
 * comes from — `v12EngineAddress()`, `v12KitchenAddress()`, the Pot derivation and
 * `v12SvmEngineProgramId()`.
 */
export function v12ReleaseSet(compiler?: string): V12ReleaseSet {
  return releaseRow(compiler ?? sdkCompilerVersion());
}

/**
 * The installed compiler's own row, the same as `v12ReleaseSet()`. Kept for compatibility: in SDK
 * 1.1.0 it named this row while the network defaults came from an earlier one.
 */
export function v12OptInReleaseSet(): V12ReleaseSet {
  return releaseRow(sdkCompilerVersion());
}

/**
 * The release the SDK's network defaults come from: the installed compiler's own row, the same as
 * `v12ReleaseSet()`. Kept for compatibility.
 */
export function v12DeployedReleaseSet(): V12ReleaseSet {
  return releaseRow(sdkCompilerVersion());
}

const ENGINE: Record<"evm" | "svm", "v12-evm" | "v12-svm"> = { evm: "v12-evm", svm: "v12-svm" };

/** EVM addresses compare case-insensitively; SVM program ids are base58 and compare exactly. */
const sameEngine = (target: "evm" | "svm", a: string, b: string): boolean =>
  target === "evm" ? a.toLowerCase() === b.toLowerCase() : a === b;

/** Every row naming `engine` as its engine. */
const rowsNaming = (target: "evm" | "svm", engine: string): V12ReleaseSet[] =>
  V12_RELEASE_SETS.filter((row) => {
    const known = row[ENGINE[target]].engine;

    return known !== null && sameEngine(target, known, engine);
  });

/**
 * Whether `engine` runs `compiler`'s output (default: this SDK's): a row for `compiler` names it,
 * or that row's `alsoRunsOn` lists its version. `undefined` for an engine no row names — a local
 * deployment — which the SDK cannot tell.
 *
 * @param target `"evm"` for an engine address, `"svm"` for an engine program id.
 */
export function engineRunsCompiler(
  target: "evm" | "svm",
  engine: string,
  compiler: string = sdkCompilerVersion(),
): boolean | undefined {
  const component = ENGINE[target];
  const naming = rowsNaming(target, engine);
  if (naming.length === 0) return undefined;
  if (naming.some((row) => row.compiler === compiler)) return true;
  const own = V12_RELEASE_SETS.find((row) => row.compiler === compiler);

  return own?.alsoRunsOn?.[component]?.includes(naming[0]![component].version) ?? false;
}

/**
 * Throws if `engine` is an engine a release set names that does not run `compiler`'s output
 * ({@link engineRunsCompiler}; default compiler: this SDK's). An engine no set names passes —
 * there is nothing to check it against.
 *
 * @param target `"evm"` for an engine address, `"svm"` for an engine program id.
 */
export function assertEngineRunsCompiler(
  target: "evm" | "svm",
  engine: string,
  compiler: string = sdkCompilerVersion(),
): void {
  if (engineRunsCompiler(target, engine, compiler) !== false) return;
  const component = ENGINE[target];
  const { version } = rowsNaming(target, engine)[0]![component];
  const runs = V12_RELEASE_SETS.filter(
    (row) =>
      (row[component].engine !== null && sameEngine(target, row[component].engine!, engine)) ||
      row.alsoRunsOn?.[component]?.includes(version) === true,
  )
    .map((row) => row.compiler)
    .join(", ");
  const own = V12_RELEASE_SETS.find((row) => row.compiler === compiler)?.[component];
  const instead =
    own === undefined
      ? `No release set pairs with compiler ${compiler} at all.`
      : `Compiler ${compiler} output runs on ${component} ${own.version}` +
        (own.engine === null ? " (not released yet)." : ` (${own.engine}).`);
  throw new Error(
    `${engine} is ${component} ${version}, which runs compiler ${runs} output; this program is ` +
      `compiler ${compiler}'s. ${instead}`,
  );
}
