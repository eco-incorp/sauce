/**
 * The input schemas of the two wallet MCP servers an agent hands Sauce's unsigned transactions to,
 * copied (the parts that hold what a result carries) so a test can hold our output to them. Each
 * is cited by package and version, or by commit: when either server changes its input, update the
 * copy here, then the hand-off it checks.
 *
 * Phantom's MCP server (`@phantom/mcp-server` 1.2.9) registers the tools of `@phantom/cli` 3.0.0:
 * `src/actions/send-evm-transaction.ts`, `src/actions/send-solana-transaction.ts`, and the shared
 * field schemas in `src/utils/schemas.ts`. Its zod is the `z` of `incur`, zod 4. The fields a
 * caller does not fill from a Sauce result (walletId, derivationIndex, the fee fields, nonce,
 * type) are left out; `confirmed` is the caller's (true once the user approved the preview). The
 * bundled `incur` names each tool by its command path, so the server registers them as `evm_send`
 * and `solana_send`; `send_evm_transaction` and `send_solana_transaction`, the names Phantom's
 * documentation uses, are each action's `mcp.command`, which that `incur` does not read.
 *
 * Coinbase's Wallet MCP (`https://wallet-mcp.coinbase.com`, formerly Base MCP) publishes no
 * package: its `send_calls` input is as its own skill documents it, base/skills at
 * ef8bcd52ccc2e79de846cdf8d16b6fc62cf459a4, `skills/wallet-mcp/references/batch-calls.md` — a
 * `chain` string and `calls` of `{ to, value, data }`, `value` hex wei ("0x0"), `data` hex
 * calldata — and the plugins built on it, which hex-encode a decimal value before passing it
 * (`skills/base-mcp/plugins/kyberswap.md`: `"0x" + BigInt(transactionValue).toString(16)`).
 */
import assert from "node:assert/strict";

import {
  address,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  verifySignature,
} from "@solana/kit";
import { getAddress } from "viem";
import * as z from "zod";

// --- Phantom: src/utils/schemas.ts ---------------------------------------------------------------

/** `EthereumAddressSchema`: any case, normalized to EIP-55. */
const EthereumAddressSchema = z.string().transform((value, ctx) => {
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

/** `HexStringSchema`: 0x-prefixed hex of any length. A decimal string is refused. */
const HexStringSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/, 'Must be a 0x-prefixed hex string (e.g. "0x", "0x1234abcd")');

/** `EvmChainIdSchema`: a number, or a decimal or hex string. */
const EvmChainIdSchema = z.union([z.number(), z.string()]);

/** `Base64Schema`: standard base64, never base64url or base58. */
const Base64Schema = z
  .string()
  .regex(
    /^[A-Za-z0-9+/]*={0,2}$/,
    "Must be a valid standard base64 string (A-Za-z0-9+/= with correct padding)",
  )
  .refine((s) => s.length % 4 !== 1, "Base64 string has invalid length — check padding");

/** `Caip2ChainIdSchema` refined to `solana:` (`SolanaCaip2ChainIdSchema`). */
const SolanaCaip2ChainIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/)
  .refine((v) => v.startsWith("solana:"));

// --- Phantom: the tools --------------------------------------------------------------------------

/** `evm_send`'s input (`SendEvmTransactionSchema`), the fields a hand-off fills. */
export const phantomSendEvmTransaction = z.object({
  chainId: EvmChainIdSchema,
  to: EthereumAddressSchema.optional(),
  value: HexStringSchema.optional().default("0x0"),
  data: HexStringSchema.optional(),
  gas: HexStringSchema.optional(),
  gasLimit: HexStringSchema.optional(),
  confirmed: z.union([z.boolean(), z.stringbool()]).default(false),
});

/** `solana_send`'s input (`SendSolanaTransactionSchema`), the fields a hand-off fills. */
export const phantomSendSolanaTransaction = z.object({
  transaction: Base64Schema,
  networkId: SolanaCaip2ChainIdSchema.default("solana:mainnet"),
  confirmed: z.union([z.boolean(), z.stringbool()]).default(false),
});

/** The networkIds `normalizeNetworkId` (`src/utils/network.ts`) maps to Solana's mainnet. */
export const PHANTOM_SOLANA_MAINNET = ["solana:mainnet", "solana:mainnet-beta"] as const;

/** The EVM chains `evm_send` refuses (`assertTransactionNetworkSupported`). */
export const PHANTOM_EVM_REFUSED = [42161, 421614] as const;

// --- Coinbase Wallet MCP: send_calls -------------------------------------------------------------

/** The chain strings `send_calls` takes (batch-calls.md). */
export const COINBASE_CHAINS = [
  "base",
  "ethereum",
  "arbitrum",
  "optimism",
  "polygon",
  "bsc",
  "avalanche",
  "robinhood-chain",
  "base-sepolia",
] as const;

/** A `value` as the batch-calls reference writes it: hex wei, `0x0` for none. */
const HexQuantity = z.string().regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/);

/** `send_calls`' input: `{ chain, calls: [{ to, value?, data? }] }`, held strictly. */
export const coinbaseSendCalls = z
  .object({
    chain: z.enum(COINBASE_CHAINS),
    calls: z
      .array(
        z
          .object({
            to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
            value: HexQuantity.optional(),
            data: z
              .string()
              .regex(/^0x(?:[0-9a-fA-F]{2})*$/)
              .optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

// --- What solana_send signs ----------------------------------------------------------------------

/**
 * Holds `transaction` to what Phantom's `solana_send` signs: standard base64 its schema
 * takes, a message whose first account, the fee payer, is `feePayer` and is the one signature
 * missing (all zero: the KMS adds it), and every other signer's signature there and valid over the
 * message — the fresh keys a transaction creates accounts with sign before it is handed out.
 * Returns the message's version and how many signed already.
 */
export async function signableBy(
  transaction: string,
  feePayer: string,
): Promise<{ readonly version: number | "legacy"; readonly presigned: number }> {
  phantomSendSolanaTransaction.parse({ transaction });
  const decoded = getTransactionDecoder().decode(getBase64Encoder().encode(transaction));
  const message = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
  assert.equal(message.staticAccounts[0], feePayer, "the fee payer is the first account");
  const signatures = Object.entries(decoded.signatures);
  assert.equal(signatures.length, message.header.numSignerAccounts);
  assert.equal(signatures[0]![0], feePayer);
  assert.ok(
    signatures[0]![1] === null || signatures[0]![1].every((byte) => byte === 0),
    "the fee payer's signature is left empty",
  );
  for (const [signer, signature] of signatures.slice(1)) {
    assert.ok(signature !== null && signature.some((byte) => byte !== 0), `${signer} signed`);
    assert.ok(
      await verifySignature(
        await getPublicKeyFromAddress(address(signer)),
        signature,
        decoded.messageBytes,
      ),
      `${signer}'s signature is over this message`,
    );
  }

  return { version: message.version, presigned: signatures.length - 1 };
}
