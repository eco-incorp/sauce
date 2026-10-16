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
 * Kitchen cook instructions — calls {@link assertEngineRunsCompiler} first.
 *
 * An engine no row names (a local deployment, a fork's own) is not refused: the SDK cannot tell
 * what it is. A row's engine is known from its release's `addresses.json` — the EVM address is
 * CREATE3 from the version and so known before the release, the SVM program id only after it.
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

/** The EVM Kitchen's release: the Kitchen proxy and the init-code hash every Pot it mints is
 *  `CREATE2(kitchen, …, potInitCodeHash)` under — `null` until the release says. */
export interface V12KitchenEvmPin extends V12ReleasePin {
  readonly kitchen: string | null;
  readonly potInitCodeHash: string | null;
}

/** One compiler version and the four releases its output pairs with. */
export interface V12ReleaseSet {
  readonly compiler: string;
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

/** The release set for `compiler` (default: this SDK's), or a throw naming the known ones. */
export function v12ReleaseSet(compiler: string = sdkCompilerVersion()): V12ReleaseSet {
  const set = V12_RELEASE_SETS.find((row) => row.compiler === compiler);
  if (set === undefined) {
    throw new Error(
      `no v12 release set pairs with compiler ${compiler} — the known ones are for ` +
        `${V12_RELEASE_SETS.map((row) => row.compiler).join(", ")} (deployments/releases.json)`,
    );
  }

  return set;
}

const ENGINE: Record<"evm" | "svm", "v12-evm" | "v12-svm"> = { evm: "v12-evm", svm: "v12-svm" };

/** EVM addresses compare case-insensitively; SVM program ids are base58 and compare exactly. */
const sameEngine = (target: "evm" | "svm", a: string, b: string): boolean =>
  target === "evm" ? a.toLowerCase() === b.toLowerCase() : a === b;

/**
 * Throws if `engine` is an engine a release set names for a compiler other than `compiler`
 * (default: this SDK's). An engine no set names passes — there is nothing to check it against.
 *
 * @param target `"evm"` for an engine address, `"svm"` for an engine program id.
 */
export function assertEngineRunsCompiler(
  target: "evm" | "svm",
  engine: string,
  compiler: string = sdkCompilerVersion(),
): void {
  const component = ENGINE[target];
  const naming = V12_RELEASE_SETS.filter((row) => {
    const known = row[component].engine;

    return known !== null && sameEngine(target, known, engine);
  });
  if (naming.length === 0 || naming.some((row) => row.compiler === compiler)) return;

  const { version } = naming[0]![component];
  const runs = naming.map((row) => row.compiler).join(", ");
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
