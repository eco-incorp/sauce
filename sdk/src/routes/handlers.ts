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
 * that checks its caller, takes the continuation the request parked and runs it. A package of the
 * async family declares its handlers in its `package.json`, beside the code that makes its requests:
 *
 *   "handlers": [
 *     { "selector": "rawFulfillRandomWords(uint256,uint256[])", "program": "vrf.handler.js", "readOnly": false }
 *   ]
 *
 * `selector` is the function's signature (or its four bytes, `0x1fe543e3`); `program` is a file of
 * the package, compiled for the chain the Pot is on with that chain's names, so a handler names the
 * protocol's contract as the program's registry does; `readOnly` runs it under a static call with
 * no fee, for a view the protocol asks the Pot.
 *
 * Installing them is one cook of the Pot: a program calling `@sauce/async`'s `install` once per
 * selector, with each handler's bytecode written into it, which {@link handlersInstallSource}
 * writes and the `sauce` command takes as a program operand (`sauce run @sauce/random --chain base`).
 * The Pot's Router (`setHandler`) deploys each handler as code and records it per selector; it
 * refuses on a Shared Pot.
 */
import { bytesToHex, isHex, toFunctionSelector, type Hex } from "viem";

import { requireChain, type ChainRef } from "../chains/canonical.js";
import { resolveSdkPackage, sdkPackageFile } from "../embedded/resolve.js";
import { compileSauceProgram, type SauceCompileOptions } from "./sauce-route.js";

/** One selector a package answers on a Pot, as its `package.json` declares it. */
export interface HandlerDeclaration {
  /** The function's signature, `rawFulfillRandomWords(uint256,uint256[])`, or its four bytes. */
  readonly selector: string;
  /** The handler's file, relative to the package's directory. */
  readonly program: string;
  /** Run under a static call, with no fee, rather than as a cook. */
  readonly readOnly?: boolean;
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

const SELECTOR = /^0x[0-9a-fA-F]{8}$/;

/** A declaration's four bytes. */
function selectorOf(selector: string): Hex {
  if (SELECTOR.test(selector)) return selector.toLowerCase() as Hex;
  if (isHex(selector)) {
    throw new Error(`a handler's selector is four bytes or a signature, not ${selector}`);
  }

  return toFunctionSelector(selector);
}

/**
 * The handlers `specifier` (a standard-library package, `@sauce/random`) declares in its
 * `package.json`: none when it declares none. Throws for a package the SDK does not have, and for a
 * declaration that is not one.
 */
export function packageHandlerDeclarations(specifier: string): readonly HandlerDeclaration[] {
  if (resolveSdkPackage(specifier) === undefined) {
    throw new Error(`${specifier} is no package of the SDK's`);
  }
  const manifest = JSON.parse(sdkPackageFile(specifier, "package.json") ?? "{}") as {
    readonly handlers?: unknown;
  };
  if (manifest.handlers === undefined) return [];
  if (!Array.isArray(manifest.handlers)) {
    throw new Error(`${specifier}'s "handlers" is a list of { selector, program, readOnly }`);
  }

  return manifest.handlers.map((entry: unknown, index) => {
    const { selector, program, readOnly } = (entry ?? {}) as Record<string, unknown>;
    if (
      typeof selector !== "string" ||
      typeof program !== "string" ||
      (readOnly !== undefined && typeof readOnly !== "boolean")
    ) {
      throw new Error(
        `${specifier}'s handler ${index} is not { selector: string, program: string, readOnly?: boolean }`,
      );
    }

    return { selector, program, ...(readOnly === undefined ? {} : { readOnly }) };
  });
}

/**
 * `declarations`, each compiled for `chain` with the chain's names, its file read through `read`
 * (which also serves the file's relative imports, by their path relative to it). Two declarations
 * of one selector are refused: a Pot answers a selector with one program.
 */
export function compileHandlers(
  chain: ChainRef,
  declarations: readonly HandlerDeclaration[],
  read: (path: string) => string | undefined,
  options: SauceCompileOptions = {},
): CompiledHandler[] {
  const seen = new Map<Hex, string>();

  return declarations.map((declaration) => {
    const selector = selectorOf(declaration.selector);
    const before = seen.get(selector);
    if (before !== undefined) {
      throw new Error(
        `${declaration.selector} and ${before} are one selector, ${selector}: a Pot answers it with one handler`,
      );
    }
    seen.set(selector, declaration.selector);
    const source = read(declaration.program);
    if (source === undefined) throw new Error(`no handler at ${declaration.program}`);
    const directory = declaration.program.split("/").slice(0, -1).join("/");
    const program = compileSauceProgram(chain, source, {
      ...options,
      resolve: (path) => {
        const relative = path.startsWith("./") ? path.slice(2) : path;
        const text = read(directory === "" ? relative : `${directory}/${relative}`);
        return text === undefined ? options.resolve?.(path) : new TextEncoder().encode(text);
      },
    });

    return {
      signature: declaration.selector,
      selector,
      readOnly: declaration.readOnly === true,
      program: declaration.program,
      bytecode: program.bytecode,
    };
  });
}

/** Every handler `specifier` declares, compiled for `chain`. */
export function packageHandlers(
  chain: ChainRef,
  specifier: string,
  options: SauceCompileOptions = {},
): CompiledHandler[] {
  return compileHandlers(
    requireChain(chain),
    packageHandlerDeclarations(specifier),
    (path) => sdkPackageFile(specifier, path),
    options,
  );
}

/**
 * The program that installs `handlers` on the Pot it is cooked on: one `install` per selector,
 * each handler's bytecode written into it. Cooked by the Pot's owner, or by a program the owner
 * cooks; `name` heads it, to say whose handlers they are.
 */
export function handlersInstallSource(handlers: readonly CompiledHandler[], name?: string): string {
  if (handlers.length === 0) {
    throw new Error(`${name ?? "the package"} declares no handlers: there is nothing to install`);
  }

  return [
    `// Installs ${name === undefined ? "these handlers" : `${name}'s handlers`} on the Pot this program runs on, one per`,
    "// selector: the program the Pot's Router runs when that selector reaches it.",
    'import { install } from "@sauce/async";',
    "",
    ...handlers.map(
      (handler) =>
        `install(${handler.selector}, hex\`${bytesToHex(handler.bytecode).slice(2)}\`, ${handler.readOnly}); // ${handler.signature}`,
    ),
    "",
  ].join("\n");
}
