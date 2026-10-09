/**
 * The npm registry: the `sauce` command's one network access besides a chain's endpoints, and the
 * one module that names it or reads it. Two things read it through here: `sauce update`
 * (`update.ts`), the package's versions when that command runs, and the update check
 * (`update-check.ts`), the latest version, in a process of its own at most once a day. Neither is
 * reached by anything browser-facing: `cli/` is in no package export.
 */

/** The package the command updates, and whose newer versions it notices. */
export const PACKAGE = "@eco-incorp/sauce";

/** Where the package is published (the root manifest's `publishConfig.registry`): the one registry
 *  the command reads. */
export const REGISTRY = "https://registry.npmjs.org/";

/** A version as npm publishes one: `1.2.3`, `1.2.3-beta.1`, `1.2.3+build`. */
export const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** The registry's view of the package: its dist-tags and every published version. */
export interface Packument {
  readonly distTags: Readonly<Record<string, string>>;
  readonly versions: readonly string[];
}

/**
 * Whether version `a` is newer than `b`, by their numbers and a prerelease below its release;
 * `false` where either is no version.
 */
export function newer(a: string, b: string): boolean {
  const parse = (text: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?/.exec(text);

    return match === null
      ? undefined
      : { numbers: [1, 2, 3].map((at) => BigInt(match[at]!)), pre: match[4] };
  };
  const [x, y] = [parse(a), parse(b)];
  if (x === undefined || y === undefined) return false;
  for (let at = 0; at < 3; at++) {
    if (x.numbers[at] !== y.numbers[at]) return x.numbers[at]! > y.numbers[at]!;
  }
  if (x.pre === undefined || y.pre === undefined) return x.pre === undefined && y.pre !== undefined;

  return x.pre.localeCompare(y.pre, "en", { numeric: true }) > 0;
}

/** The package's name as a registry path segment: `@eco-incorp%2fsauce`. */
const ESCAPED = PACKAGE.replace("/", "%2f");

/** The package's packument: its dist-tags and every version, for `sauce update`. */
export async function readPackument(fetchImpl: typeof fetch = fetch): Promise<Packument> {
  const response = await fetchImpl(`${REGISTRY}${ESCAPED}`, {
    // The abbreviated document: dist-tags and versions, without every version's readme.
    headers: { accept: "application/vnd.npm.install-v1+json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`the registry answered ${response.status}`);
  const body = (await response.json()) as {
    "dist-tags"?: Record<string, string>;
    versions?: Record<string, unknown>;
  };

  return { distTags: body["dist-tags"] ?? {}, versions: Object.keys(body.versions ?? {}) };
}

/**
 * The version the package's `latest` dist-tag names, from the registry's dist-tags document (a few
 * bytes, where the packument lists every version), within `timeout` milliseconds. Whatever the
 * registry answers is returned as it is: the caller decides what is a version.
 */
export async function readLatest(
  fetchImpl: typeof fetch = fetch,
  timeout = 10_000,
): Promise<string> {
  const response = await fetchImpl(`${REGISTRY}-/package/${ESCAPED}/dist-tags`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`the registry answered ${response.status}`);
  const latest = ((await response.json()) as { latest?: unknown } | null)?.latest;
  if (typeof latest !== "string") throw new Error("the registry names no latest version");

  return latest;
}
