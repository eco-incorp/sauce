export declare const ERAVM: ReadonlySet<number>;
export declare const ZERO: string;
export declare const isAddress: (a: string | null) => boolean;

/** Whether a JSON-RPC error is the call's own revert, rather than a node failing the request. */
export declare function isRevert(
  error: { code?: number; message?: string } | null | undefined,
): boolean;

/** The code `getCode` reads at `address`: what the chain served, or a thrown error naming `what`. */
export declare function readCode(
  getCode: (chainId: number, address: string) => Promise<unknown>,
  chainId: number,
  address: string,
  what: string,
): Promise<string>;

/** The addresses a thin proxy hard-codes. */
export declare function embeddedAddresses(code: string): string[];

/** The Solidity libraries `codes` link, by address; throws where an embedded address cannot be read. */
export declare function linkedLibraries(
  chainId: number,
  codes: readonly (string | null | undefined)[],
  getCode: (chainId: number, address: string) => Promise<unknown>,
): Promise<Map<string, string>>;

/** The code of each of `facets`, by address; throws where one cannot be read. */
export declare function facetCodes(
  chainId: number,
  facets: Iterable<string>,
  getCode: (chainId: number, address: string) => Promise<unknown>,
): Promise<Record<string, string>>;

/** The captured rows of one export; throws where one recorded an error. */
export declare function readableRows<Row extends { protocol: string; abi: string; error?: string }>(
  instances: readonly (Row & { chainId: number; address: string })[],
  protocol: string,
  abi: string,
): (Row & { chainId: number; address: string })[];
