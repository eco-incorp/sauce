/**
 * The SDK's own modules, served to the compiler from memory.
 *
 * A program the SDK emits imports files the SDK ships: the ERC-20 and Sauce Router ABIs
 * (`./artifacts/IERC20.json`, `./artifacts/ISauceRouter.json`), a protocol's ABI twin
 * (`./protocols/<slug>/<Export>.json`), and the `@sauce/token` and `@sauce/router` standard
 * libraries. None of them is read from a filesystem: the ABIs are JSON imports and the rest is
 * embedded at build time (`sources.generated.ts`), so the same resolution runs in Node and in a
 * browser.
 *
 * `resolveSdkModule` and `resolveSdkPackage` have the compiler's own `resolve` and `resolvePackage`
 * contracts, so a raw `compile()` can fall back to them for anything its own resolver does not
 * serve — which is how a partner reproduces the settle program byte for byte.
 */
import IERC20 from "../artifacts/IERC20.json" with { type: "json" };
import ISauceRouter from "../artifacts/ISauceRouter.json" with { type: "json" };
import { PROTOCOL_ABIS, STD_SOURCES } from "./sources.generated.js";

/**
 * The absolute root the standard library is served under. A name, not a filesystem path: nothing
 * is read from it, and it only has to be absolute so an arm's relative imports stay inside it.
 */
export const SDK_STD_ROOT = "/@eco-incorp/sauce/std";

/** Bare specifiers the SDK resolves itself, mapped to their directory under `std/`. */
const STD_PACKAGES: Readonly<Record<string, string>> = {
  "@sauce/token": "token",
  "@sauce/router": "router",
  "@sauce/hop": "hop",
  "@sauce/remote": "remote",
  "@sauce/async": "async",
  "@sauce/oracle": "oracle",
  "@sauce/random": "random",
  "@sauce/zk": "zk",
  "@sauce/signed": "signed",
};

/** The engine ABIs the SDK's generated programs import, by path under the SDK root. */
const ARTIFACTS: Readonly<Record<string, string>> = {
  "artifacts/IERC20.json": JSON.stringify(IERC20),
  "artifacts/ISauceRouter.json": JSON.stringify(ISauceRouter),
};

const PROTOCOLS = "protocols/";
const utf8 = new TextEncoder();

/**
 * `path` with `.` segments dropped and `..` applied, `/`-joined without a leading slash —
 * `undefined` when a `..` would climb above the root.
 */
function normalize(path: string): string | undefined {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.join("/");
}

/**
 * The path under `std/` that `path` names, or `undefined` when it is not a standard-library path.
 *
 * The compiler asks for the package entry by the absolute path `resolveSdkPackage` returned, and for
 * a relative import inside the package (`./erc20.abi.json`) by the importer's directory joined to it
 * and prefixed with `.` — `"./@eco-incorp/sauce/std/token/erc20.abi.json"`. Both shapes land here.
 */
export function sdkStdPath(path: string): string | undefined {
  const absolute = path.startsWith(`.${SDK_STD_ROOT}/`) ? path.slice(1) : path;
  if (!absolute.startsWith(`${SDK_STD_ROOT}/`)) return undefined;

  return normalize(absolute.slice(SDK_STD_ROOT.length + 1));
}

function sdkModuleText(path: string): string | undefined {
  const std = sdkStdPath(path);
  if (std !== undefined) return STD_SOURCES[std];
  const key = normalize(path);
  if (key === undefined) return undefined;

  return key.startsWith(PROTOCOLS) ? PROTOCOL_ABIS[key.slice(PROTOCOLS.length)] : ARTIFACTS[key];
}

/**
 * The bytes of an SDK module: a standard-library file, an engine ABI or a protocol ABI twin.
 * `undefined` for anything else, which is the compiler's "nothing at this path".
 */
export function resolveSdkModule(path: string): Uint8Array | undefined {
  const text = sdkModuleText(path);

  return text === undefined ? undefined : utf8.encode(text);
}

/**
 * The entry path of a standard-library package (`@sauce/token`, `@sauce/router`), under
 * `SDK_STD_ROOT`, or `undefined` to decline any other specifier.
 *
 * The entry is the package's `module`, else `main`, else `index.js`. Each package's `main` is a
 * neutral base (`token.js`, `router.js`) the compiler suffixes per target (`token.evm.js`).
 */
export function resolveSdkPackage(specifier: string): string | undefined {
  const dir = STD_PACKAGES[specifier];
  if (dir === undefined) return undefined;
  const manifest = JSON.parse(STD_SOURCES[`${dir}/package.json`] ?? "{}") as Record<
    string,
    unknown
  >;
  const entry =
    typeof manifest.module === "string"
      ? manifest.module
      : typeof manifest.main === "string"
        ? manifest.main
        : "index.js";

  return `${SDK_STD_ROOT}/${normalize(`${dir}/${entry}`)}`;
}

/**
 * The text of `path`, a file of the standard-library package `specifier` (`@sauce/random`,
 * `handlers/vrf.js`), or `undefined` when the package or the file is not the SDK's. `path` is
 * relative to the package's directory and cannot leave it.
 */
export function sdkPackageFile(specifier: string, path: string): string | undefined {
  const dir = STD_PACKAGES[specifier];
  const file = normalize(path);
  if (dir === undefined || file === undefined || file === "") return undefined;

  return STD_SOURCES[`${dir}/${file}`];
}
