/** What a simulated Solana payment is held to. */
export interface SolanaCookExpected {
  /** The engine program the cook must invoke. */
  readonly engine: string;
  /** Earlier engine programs the cook must not invoke. */
  readonly earlier: readonly string[];
  /** Who is paid, as a base58 public key: the owner of the token account that receives. */
  readonly recipient: string;
  /** The token's mint, base58. */
  readonly mint: string;
  /** What the token is called in a message: `USDC`. */
  readonly symbol: string;
  /** What the recipient receives and the Pot pays, in the token's base units. */
  readonly amount: bigint;
}

/**
 * Why a simulated Solana payment is not the one expected, or `undefined`: `simulated` is
 * `sauce simulate --json`'s object, read by its top-level `ok`, `logs`, `pot` and `tokenChanges`.
 */
export declare function solanaCookProblem(
  simulated: Record<string, unknown>,
  expected: SolanaCookExpected,
): string | undefined;

/** What the chain shows of a mined EVM cook. */
export interface EvmCookObserved {
  /** The mined transaction's target. */
  readonly to: string | null | undefined;
  /** The engine the cook's calldata names. */
  readonly engine: string;
  /**
   * The output of the transaction's top call, as `debug_traceTransaction`'s call tracer gives it:
   * the program's return data, with no ABI framing (`return 7` is the one 32-byte word 7).
   */
  readonly output: string | null | undefined;
}

/** What a mined EVM cook is held to. */
export interface EvmCookExpected {
  /** The Pot step 3 deployed: the cook's target. */
  readonly pot: string;
  /** The engine the package names. */
  readonly engine: string;
  /** What the program returns. */
  readonly value: bigint;
}

/** Why a mined EVM cook is not the one expected, or `undefined`. */
export declare function evmCookProblem(
  observed: EvmCookObserved,
  expected: EvmCookExpected,
): string | undefined;

/** Every string a message of the gate is scrubbed of for `url`, an endpoint that carries a key. */
export declare function endpointSecrets(url: string): string[];

/** The environment of a child of the gate: PATH and TMPDIR, the temp home, npm's cache, no more. */
export declare function childEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  options: { readonly home: string; readonly cache?: string | undefined },
): Record<string, string>;

/** Throws unless `url` is the loopback endpoint of the kit's own fork. */
export declare function requireLoopback(url: string): void;

/** Throws for a command line that carries a key unless its `--rpc-url` is the kit's loopback fork. */
export declare function requireSigningEndpoint(args: readonly string[]): void;

/** Writes an endpoint as a `--config` file only its owner can read, and returns its path. */
export declare function writeEndpointConfig(dir: string, id: number, url: string): string;

/**
 * Runs `use` with the path of an endpoint's `--config` file and removes the file when `use` returns
 * or throws.
 */
export declare function withEndpointConfig<T>(
  dir: string,
  id: number,
  url: string,
  use: (path: string) => T,
): T;

/** What the kit's children need of the operator's environment: PATH, TMPDIR, HOME, USERPROFILE. */
export declare const GATE_ENVIRONMENT: readonly string[];

/** `env` with every variable but those of `keep` deleted, in place; returns it. */
export declare function confineEnvironment<T extends Record<string, string | undefined>>(
  env: T,
  keep: readonly string[],
): T;

/** What a probe of one callback on the Router did: it succeeded, or reverted with this data. */
export type RouterProbeOutcome =
  { readonly succeeded: true } | { readonly succeeded?: undefined; readonly revertData?: string };

/**
 * Why a probe of one callback name on a Router did not find what it should, or `undefined`:
 * `"answered"` expects `UnauthorizedCallback()` (the Router has the name), `"missing"` expects no
 * data at all (the control: a name no Router has, the Router having no fallback).
 */
export declare function routerProbeProblem(probe: {
  readonly name: string;
  readonly selector: string;
  readonly expect: "answered" | "missing";
  readonly outcome: RouterProbeOutcome;
}): string | undefined;

/** Why the code at `address` on `chain` is not `expected`, the runtime the release deploys, or `undefined`. */
export declare function runtimeProblem(code: {
  readonly chain: string;
  readonly address: string;
  readonly expected: string;
  readonly actual: string | undefined;
}): string | undefined;

/** What is wrong with the keys of the gate's endpoint file, or `undefined`: a count, never a key. */
export declare function configKeyProblem(keys: readonly string[]): string | undefined;

/**
 * The other chains of the endpoint file whose Kitchen proxy has code though ROUTER_CHAINS lacks
 * them. Only a canonical EVM chain is read; the rest come back in `skipped`.
 */
export declare function kitchenCoverage(input: {
  readonly ids: readonly number[];
  readonly routerIds: readonly number[];
  readonly canonical: ReadonlyArray<{ readonly id: number; readonly kind: string }>;
  readonly hasCode: (id: number) => Promise<boolean>;
  readonly reasonOf: (error: unknown) => string;
}): Promise<{ problems: string[]; skipped: number[] }>;

/**
 * What an `eth_call` that threw says of the contract: the revert data its RPC error carries, `"0x"`
 * for a revert with none; anything that is no revert is thrown.
 */
export declare function revertOutcome(error: unknown): { readonly revertData: string };

/** What step 6b's program must return: `0xbeef`, the low 160 bits of a word that has bit 160 set. */
export declare const DECODED: "48879";

/**
 * Why a run of step 6b's decode is not what the installed compiler must give, or `undefined`:
 * `result` is `sauce simulate`'s JSON, `engine` the engine the same command's cook names,
 * `expectedEngine` the engine the Pot's release runs on, and `notes` everything the command printed,
 * which must name that engine where `notesNameEngine` says so.
 */
export declare function decodeProblem(run: {
  readonly result: {
    readonly ok?: unknown;
    readonly returned?: unknown;
    readonly reason?: unknown;
  };
  readonly engine: string;
  readonly expectedEngine: string;
  readonly notes: string;
  readonly notesNameEngine?: boolean;
}): string | undefined;
