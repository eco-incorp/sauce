/**
 * A package's handlers, and the program that installs them on a Pot.
 *
 * A request a program makes with `@sauce/async` (`await Random.vrf(…).then((words) => { … })`) is
 * answered later by the protocol calling the Pot back with a selector of its own. A Private Pot
 * answers such a selector with the program its owner registered for it, which its Router's
 * fallback runs: the HANDLER, a SauceScript program
 *
 *   function main(caller: Address, value: Uint256, data: bytes): bytes { … }
 *
 * that checks its caller and settles the promise the callback names. A package of the async family
 * declares its handlers in its `package.json`, beside the code that makes its requests:
 *
 *   "handlers": [
 *     { "selector": "rawFulfillRandomWords(uint256,uint256[])", "program": "vrf.handler.js",
 *       "readOnly": false, "requires": ["ChainlinkVRF.Wrapper"] }
 *   ],
 *   "interfaces": ["0x805f2132"]
 *
 * `selector` is the function's signature (or its four bytes, `0x1fe543e3`); `program` is a file of
 * the package, compiled for the chain the Pot is on with that chain's names, so a handler names the
 * protocol's contract as the program's registry does; `readOnly` runs it as a view, static and with
 * no fee; `requires` names the contracts (`Namespace.Contract`) it needs, so a chain without one of
 * them skips it. `interfaces` are the ERC-165 ids the Pot declares for the package, which its Router
 * answers natively: what a protocol that checks its receiver before it calls back asks.
 *
 * Installing them is one cook of the Pot: a program calling `@sauce/async`'s `install` once per
 * selector, with each handler's bytecode written into it, and `declareInterface` once per id, which
 * {@link handlersInstallSource} writes and the `sauce` command takes as a program operand
 * (`sauce run @sauce/random --chain base`). `@sauce/async`'s own handlers (the public
 * `expire(bytes32)`) are installed with every package's. The Pot's Router deploys each handler as
 * code and records it per selector; it refuses on a Shared Pot and on a Pot whose Router is fixed.
 */
import { bytesToHex, isHex, toFunctionSelector, type Hex } from "viem";

import { requireChain, type CanonicalChain, type ChainRef } from "../chains/canonical.js";
import { resolveSdkPackage, sdkPackageFile } from "../embedded/resolve.js";
import { contractAddressOn } from "./chain-module.js";
import { compileSauceProgram, type SauceCompileOptions } from "./sauce-route.js";

/** The package every async package's handlers are installed with. */
export const ASYNC_PACKAGE = "@sauce/async";

/** One selector a package answers on a Pot, as its `package.json` declares it. */
export interface HandlerDeclaration {
  /** The function's signature, `rawFulfillRandomWords(uint256,uint256[])`, or its four bytes. */
  readonly selector: string;
  /** The handler's file, relative to the package's directory. */
  readonly program: string;
  /** Run as a view, static and with no fee, rather than as a cook. */
  readonly readOnly?: boolean;
  /** The contracts (`Namespace.Contract`) the handler needs: a chain without one skips it. */
  readonly requires?: readonly string[];
}

/** A handler compiled for one chain: what `install` registers for its selector. */
export interface CompiledHandler {
  /** As the package wrote it: a signature, or four bytes. */
  readonly signature: string;
  /** Its four bytes. */
  readonly selector: Hex;
  readonly readOnly: boolean;
  /** The package's file it was compiled from. */
  readonly program: string;
  /** The handler, compiled for the chain, without arguments: the Router appends them per call. */
  readonly bytecode: Uint8Array;
}

/** What installing a package on a Pot takes: its handlers, and the ERC-165 ids it declares. */
export interface PackageInstall {
  readonly handlers: readonly CompiledHandler[];
  /** Four bytes each. */
  readonly interfaces: readonly Hex[];
  /** Declarations skipped on this chain, each with the contract it lacks. */
  readonly skipped: readonly { readonly selector: string; readonly missing: string }[];
}

const SELECTOR = /^0x[0-9a-fA-F]{8}$/;

/** A declaration's four bytes. */
function selectorOf(selector: string): Hex {
  if (SELECTOR.test(selector)) return selector.toLowerCase() as Hex;
  if (isHex(selector)) {
    throw new Error(`a handler's selector is four bytes or a signature, not ${selector}`);
  }

  return toFunctionSelector(selector);
}

function manifestOf(specifier: string): {
  readonly handlers?: unknown;
  readonly interfaces?: unknown;
} {
  if (resolveSdkPackage(specifier) === undefined) {
    throw new Error(`${specifier} is no package of the SDK's`);
  }

  return JSON.parse(sdkPackageFile(specifier, "package.json") ?? "{}") as {
    readonly handlers?: unknown;
    readonly interfaces?: unknown;
  };
}

/**
 * The handlers `specifier` (a standard-library package, `@sauce/random`) declares in its
 * `package.json`: none when it declares none. Throws for a package the SDK does not have, and for a
 * declaration that is not one.
 */
export function packageHandlerDeclarations(specifier: string): readonly HandlerDeclaration[] {
  const { handlers } = manifestOf(specifier);
  if (handlers === undefined) return [];
  if (!Array.isArray(handlers)) {
    throw new Error(
      `${specifier}'s "handlers" is a list of { selector, program, readOnly, requires }`,
    );
  }

  return handlers.map((entry: unknown, index) => {
    const { selector, program, readOnly, requires } = (entry ?? {}) as Record<string, unknown>;
    if (
      typeof selector !== "string" ||
      typeof program !== "string" ||
      (readOnly !== undefined && typeof readOnly !== "boolean") ||
      (requires !== undefined &&
        (!Array.isArray(requires) || requires.some((name) => typeof name !== "string")))
    ) {
      throw new Error(
        `${specifier}'s handler ${index} is not { selector: string, program: string, readOnly?: boolean, requires?: string[] }`,
      );
    }

    return {
      selector,
      program,
      ...(readOnly === undefined ? {} : { readOnly }),
      ...(requires === undefined ? {} : { requires: requires as string[] }),
    };
  });
}

/** The ERC-165 ids `specifier` declares in its `package.json`, four bytes each. */
export function packageInterfaces(specifier: string): readonly Hex[] {
  const { interfaces } = manifestOf(specifier);
  if (interfaces === undefined) return [];
  if (!Array.isArray(interfaces) || interfaces.some((id) => !SELECTOR.test(String(id)))) {
    throw new Error(`${specifier}'s "interfaces" is a list of four-byte ids, "0x805f2132"`);
  }

  return interfaces.map((id) => String(id).toLowerCase() as Hex);
}

/** The first of `requires` that `chain` does not have, or `undefined` when it has them all. */
function missingOn(
  chain: CanonicalChain,
  requires: readonly string[] | undefined,
): string | undefined {
  return (requires ?? []).find((name) => {
    const [namespace, contract, ...rest] = name.split(".");
    if (namespace === undefined || contract === undefined || rest.length > 0) {
      throw new Error(`a handler requires a contract as Namespace.Contract, not ${name}`);
    }

    return contractAddressOn(chain, namespace, contract) === undefined;
  });
}

/**
 * `declarations`, each compiled for `chain` with the chain's names, its file read through `read`
 * (which also serves the file's relative imports, by their path relative to it). Two declarations
 * of one selector are refused: a Pot answers a selector with one program. A declaration whose
 * `requires` the chain lacks is not compiled.
 */
export function compileHandlers(
  chain: ChainRef,
  declarations: readonly HandlerDeclaration[],
  read: (path: string) => string | undefined,
  options: SauceCompileOptions = {},
): CompiledHandler[] {
  const resolved = requireChain(chain);
  const seen = new Map<Hex, string>();

  return declarations.flatMap((declaration) => {
    const selector = selectorOf(declaration.selector);
    const before = seen.get(selector);
    if (before !== undefined) {
      throw new Error(
        `${declaration.selector} and ${before} are one selector, ${selector}: a Pot answers it with one handler`,
      );
    }
    seen.set(selector, declaration.selector);
    if (missingOn(resolved, declaration.requires) !== undefined) return [];
    const source = read(declaration.program);
    if (source === undefined) throw new Error(`no handler at ${declaration.program}`);
    const directory = declaration.program.split("/").slice(0, -1).join("/");
    const program = compileSauceProgram(resolved, source, {
      ...options,
      resolve: (path) => {
        const relative = path.startsWith("./") ? path.slice(2) : path;
        const text = read(directory === "" ? relative : `${directory}/${relative}`);
        return text === undefined ? options.resolve?.(path) : new TextEncoder().encode(text);
      },
    });

    return [
      {
        signature: declaration.selector,
        selector,
        readOnly: declaration.readOnly === true,
        program: declaration.program,
        bytecode: program.bytecode,
      },
    ];
  });
}

/**
 * Every handler `specifier` declares that `chain` can run, compiled for it, with `@sauce/async`'s
 * own (a selector the package declares itself is the package's), and the ids it declares.
 */
export function packageInstall(
  chain: ChainRef,
  specifier: string,
  options: SauceCompileOptions = {},
): PackageInstall {
  const resolved = requireChain(chain);
  const own = packageHandlerDeclarations(specifier).map((declaration) => ({
    declaration,
    package: specifier,
  }));
  const taken = new Set(own.map(({ declaration }) => selectorOf(declaration.selector)));
  const core =
    specifier === ASYNC_PACKAGE
      ? []
      : packageHandlerDeclarations(ASYNC_PACKAGE)
          .filter((declaration) => !taken.has(selectorOf(declaration.selector)))
          .map((declaration) => ({ declaration, package: ASYNC_PACKAGE }));
  const skipped: { selector: string; missing: string }[] = [];
  const handlers = [...own, ...core].flatMap(({ declaration, package: from }) => {
    const missing = missingOn(resolved, declaration.requires);
    if (missing !== undefined) {
      skipped.push({ selector: declaration.selector, missing });
      return [];
    }

    return compileHandlers(resolved, [declaration], (path) => sdkPackageFile(from, path), options);
  });

  return { handlers, interfaces: packageInterfaces(specifier), skipped };
}

/** Every handler `specifier` declares that `chain` can run, compiled for it, with `@sauce/async`'s. */
export function packageHandlers(
  chain: ChainRef,
  specifier: string,
  options: SauceCompileOptions = {},
): CompiledHandler[] {
  return [...packageInstall(chain, specifier, options).handlers];
}

/**
 * The program that installs `handlers` on the Pot it is cooked on: one `install` per selector,
 * each handler's bytecode written into it, then a `declareInterface` per ERC-165 id in
 * `interfaces`. Cooked by the Pot's owner, or by a program the owner cooks; `name` heads it, to say
 * whose handlers they are.
 */
export function handlersInstallSource(
  handlers: readonly CompiledHandler[],
  name?: string,
  interfaces: readonly Hex[] = [],
): string {
  if (handlers.length === 0 && interfaces.length === 0) {
    throw new Error(`${name ?? "the package"} declares no handlers: there is nothing to install`);
  }
  const imports = [
    ...(handlers.length > 0 ? ["install"] : []),
    ...(interfaces.length > 0 ? ["declareInterface"] : []),
  ];

  return [
    `// Installs ${name === undefined ? "these handlers" : `${name}'s handlers`} on the Pot this program runs on, one per`,
    "// selector: the program the Pot's Router runs when that selector reaches it.",
    `import { ${imports.join(", ")} } from "${ASYNC_PACKAGE}";`,
    "",
    ...handlers.map(
      (handler) =>
        `install(${handler.selector}, hex\`${bytesToHex(handler.bytecode).slice(2)}\`, ${handler.readOnly}); // ${handler.signature}`,
    ),
    ...interfaces.map((id) => `declareInterface(${id}, true); // ERC-165`),
    "",
  ].join("\n");
}
