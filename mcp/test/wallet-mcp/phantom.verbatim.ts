// Phantom MCP's input schemas and the helpers its two send tools run them through, copied verbatim
// (formatting included, so a diff against the package reads clean) from `@phantom/cli` 3.0.0, the
// package `@phantom/mcp-server` 1.2.9 serves (`cli.serve(["--mcp"])`):
//
//   @phantom/cli-3.0.0.tgz    sha256 ade1b68dacd3754008a8c5c732f222ffc08676b992fc22ef4493aa35419a39c8
//   @phantom/mcp-server-1.2.9 sha256 a6a9a1aa906a5e17046f7e5975914c891023162fff2b032ca377005f9bff5d17
//
// The published tarball carries no license field or file. Its source is packages/cli of
// github.com/phantom/phantom-connect-sdk (version 3.0.0 at daa18efa5d653baf254bc8c010260a2cf2d6ba0a,
// these files byte for byte the tarball's), which is under the MIT License, reproduced here as it
// asks:
//
//   MIT License
//
//   Copyright (c) 2024 Phantom Technologies, Inc
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.
//
// Each block names the file it comes from. Changed, and only these: `z` is zod's (the package takes
// it from `incur`, which re-exports zod 4), `NetworkId` is the members the code reads (from
// `@phantom/constants` 2.0.4, packages/constants of the same repository), and the actions' `options`
// objects are exported under their own names. The server registers the tools by their command path (`incur` names a tool
// `mcp.name ?? path.join("_")`, and the actions set only `mcp.command`): `evm send` is `evm_send`,
// `solana send` is `solana_send`. Phantom's documentation calls them `send_evm_transaction` and
// `send_solana_transaction`. Its zod objects are not strict: a field they do not declare is dropped.
// When Phantom changes these, copy them again and let the tests say what moved.
import * as z from "zod";
import { getAddress } from "viem";

// @phantom/constants 2.0.4: the members of `NetworkId` this code reads.
const NetworkId = {
  SOLANA_MAINNET: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  SOLANA_DEVNET: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  SOLANA_TESTNET: "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z",
  ARBITRUM_ONE: "eip155:42161",
  ARBITRUM_SEPOLIA: "eip155:421614",
} as const;

// ─── src/utils/schemas.ts ────────────────────────────────────────────────────

/**
 * HD wallet derivation index.
 * No .describe() or .optional() here — add them at the call site.
 * Using .default(0) so the field is optional from the caller's perspective.
 *
 * @example
 *   derivationIndex: DerivationIndexSchema.describe("Optional derivation index (default: 0)"),
 */
export const DerivationIndexSchema = z.coerce.number().int().min(0).default(0).refine(Number.isSafeInteger, {
  message: "derivationIndex must be a safe integer",
});

/**
 * Optional wallet ID override.
 * No .describe() — add at call site.
 *
 * @example
 *   walletId: WalletIdSchema.describe("Optional wallet ID (defaults to authenticated wallet)"),
 */
export const WalletIdSchema = z.string().optional();

/**
 * EVM address — validates format and normalizes to EIP-55 checksum.
 *
 * Accepts any case (0xabc, 0xABC, mixed) and returns the checksummed form.
 * Rejects strings that are not 0x-prefixed 40-hex-char addresses.
 */
export const EthereumAddressSchema = z.string().transform((value, ctx) => {
  try {
    return getAddress(value);
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "Invalid Ethereum address — must be a 0x-prefixed 40-char hex string",
    });
    return z.NEVER;
  }
});

/**
 * CAIP-2 chain ID — validates the `namespace:reference` format.
 * Does NOT normalize (e.g. "solana:mainnet" is accepted as-is).
 *
 * Examples: "eip155:1", "solana:mainnet", "bip122:000000000019d6689c085ae165831e93"
 */
export const Caip2ChainIdSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/,
    'Must be a valid CAIP-2 chain ID (e.g. "eip155:1", "solana:mainnet", "eip155:8453")',
  );

/**
 * Solana CAIP-2 chain ID — must start with "solana:".
 * Examples: "solana:mainnet", "solana:devnet", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
 */
export const SolanaCaip2ChainIdSchema = Caip2ChainIdSchema.refine(
  v => v.startsWith("solana:"),
  'Must be a Solana chain ID starting with "solana:" (e.g. "solana:mainnet", "solana:devnet")',
);

/**
 * EVM chain ID coerced from number or string — accepts numeric chain IDs as used by DeFi
 * aggregators (e.g. 1, 8453, "8453", "0x2105").
 * Does NOT validate the chain is supported; use parseChainId() at runtime.
 */
export const EvmChainIdSchema = z
  .union([z.number(), z.string()])
  .describe('EVM chain ID as a number or decimal/hex string (e.g. 1, 8453, "8453", "0x2105" for Base).');

/**
 * 0x-prefixed hex string of any length (including "0x" with no data).
 * Does not enforce even length or minimum length beyond the prefix.
 */
export const HexStringSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/, 'Must be a 0x-prefixed hex string (e.g. "0x", "0x1234abcd")');

/**
 * Standard base64-encoded string (A-Za-z0-9+/= with correct padding).
 * Rejects base64url (- and _) — use this for Solana transaction bytes.
 */
export const Base64Schema = z
  .string()
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, "Must be a valid standard base64 string (A-Za-z0-9+/= with correct padding)")
  .refine(s => s.length % 4 !== 1, "Base64 string has invalid length — check padding");

// ─── src/actions/send-evm-transaction.ts ─────────────────────────────────────

export const SendEvmTransactionSchema = z.object({
  chainId: EvmChainIdSchema.describe(
    'EVM chain ID as a number or string (e.g. 8453, "8453", or "0x2105" for Base). This is the chainId field returned directly by DeFi aggregators.',
  ),
  to: EthereumAddressSchema.optional().describe("Recipient address (checksummed EVM address)"),
  value: HexStringSchema.optional()
    .default("0x0")
    .describe(
      'Amount to send in wei as a hex string (e.g., "0x38D7EA4C68000" for 0.001 ETH). If omitted, defaults to 0.',
    ),
  data: HexStringSchema.optional().describe(
    "Encoded contract call data (0x-prefixed hex). Omit for plain ETH transfers.",
  ),
  gas: HexStringSchema.optional().describe(
    'Gas limit as a hex string (e.g., "0x5208" for 21000). If omitted, estimated automatically from the network with a 20% buffer.',
  ),
  gasLimit: HexStringSchema.optional().describe(
    "Gas limit as a hex string — alias for gas, accepted directly from DeFi aggregator responses. If both gas and gasLimit are provided, gas takes precedence.",
  ),
  gasPrice: HexStringSchema.optional().describe(
    "Gas price in wei as a hex string (legacy transactions). Use maxFeePerGas + maxPriorityFeePerGas for EIP-1559 transactions. If neither gasPrice nor maxFeePerGas is provided, gasPrice is fetched automatically.",
  ),
  maxFeePerGas: HexStringSchema.optional().describe("Maximum total fee per gas in wei (EIP-1559, hex string)"),
  maxPriorityFeePerGas: HexStringSchema.optional().describe(
    "Maximum priority fee (tip) per gas in wei (EIP-1559, hex string)",
  ),
  nonce: HexStringSchema.optional().describe(
    "Transaction nonce as a hex string. If omitted, fetched automatically via eth_getTransactionCount.",
  ),
  type: HexStringSchema.optional().describe(
    'Hex-encoded transaction type (e.g. "0x0" for legacy, "0x2" for EIP-1559, "0x3" for blob). Inferred automatically if omitted.',
  ),
  walletId: WalletIdSchema.describe("Optional wallet ID (defaults to authenticated wallet)"),
  derivationIndex: DerivationIndexSchema.describe("Optional derivation index for the account (default: 0)"),
  confirmed: z
    .union([z.boolean(), z.stringbool()])
    .default(false)
    .describe(
      "Set to true only after the user has reviewed and approved the simulation results. Omit (or false) on the first call to get a simulation preview without submitting.",
    ),
});

// ─── src/actions/send-solana-transaction.ts ──────────────────────────────────

export const SendSolanaTransactionSchema = z.object({
  transaction: Base64Schema.describe(
    "The serialized Solana transaction encoded as standard base64 (the format used by Solana JSON-RPC and DeFi APIs). Do not base58-encode — use base64.",
  ),
  networkId: SolanaCaip2ChainIdSchema.default("solana:mainnet").describe(
    'Solana network identifier (e.g., "solana:mainnet", "solana:devnet"). Defaults to "solana:mainnet".',
  ),
  derivationIndex: DerivationIndexSchema.describe("Optional derivation index for the account (default: 0)"),
  confirmed: z
    .union([z.boolean(), z.stringbool()])
    .default(false)
    .describe(
      "Set to true only after the user has reviewed and approved the simulation results. Omit (or false) on the first call to get a simulation preview without submitting.",
    ),
  walletId: WalletIdSchema.describe("Optional wallet ID (defaults to authenticated wallet)"),
});

// ─── src/utils/params.ts ─────────────────────────────────────────────────────

/**
 * Parse a chain ID from unknown input.
 *
 * Accepts numbers directly, decimal strings ("8453"), and hex strings ("0x2105").
 * Throws if the value is missing, not a valid positive integer, or an unrecognised type.
 */
export function parseChainId(value: unknown): number {
  let parsed: number;

  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    parsed = value.startsWith("0x") ? parseInt(value, 16) : parseInt(value, 10);
  } else {
    throw new Error("chainId must be a number (e.g. 1 for Ethereum mainnet, 8453 for Base)");
  }

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("chainId must be a number (e.g. 1 for Ethereum mainnet, 8453 for Base)");
  }

  return parsed;
}

// ─── src/utils/network.ts ────────────────────────────────────────────────────

export function normalizeNetworkId(networkId: string): string {
  const normalized = networkId.toLowerCase();

  switch (normalized) {
    case "solana:mainnet":
    case "solana:mainnet-beta":
      return NetworkId.SOLANA_MAINNET;
    case "solana:devnet":
      return NetworkId.SOLANA_DEVNET;
    case "solana:testnet":
      return NetworkId.SOLANA_TESTNET;
    default:
      return networkId;
  }
}

const UNSUPPORTED_TRANSACTION_NETWORKS: ReadonlyMap<string, string> = new Map([
  [NetworkId.ARBITRUM_ONE, "Arbitrum One"],
  [NetworkId.ARBITRUM_SEPOLIA, "Arbitrum Sepolia"],
]);

/**
 * EVM networks where the wallet can sign and submit transactions through these tools.
 * Listed in error messages so callers can pick a working network.
 */
export const SUPPORTED_EVM_TRANSACTION_NETWORKS_HINT =
  "eip155:1 (Ethereum), eip155:8453 (Base), eip155:137 (Polygon), eip155:143 (Monad)";

/**
 * Throws if the wallet cannot sign and submit transactions on `networkId`.
 *
 * Some networks are recognized for addresses and balances but have no end-to-end transaction
 * submission support, so requests there would fail after signing. Rejecting them up front gives
 * a clear error instead of a generic signing or submission failure.
 */
export function assertTransactionNetworkSupported(networkId: string): void {
  const name = UNSUPPORTED_TRANSACTION_NETWORKS.get(networkId.toLowerCase());
  if (name) {
    throw new Error(
      `${name} (${networkId}) is not supported for sending transactions. ` +
        `Use a supported EVM network: ${SUPPORTED_EVM_TRANSACTION_NETWORKS_HINT}.`,
    );
  }
}
