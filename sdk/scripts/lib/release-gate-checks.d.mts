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
