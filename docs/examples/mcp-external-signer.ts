// The Sauce MCP server driven by an agent whose key it never sees: sauce_tx builds the cook, your
// signer (a KMS, a hardware wallet, another wallet's MCP server) signs each transaction, and
// sauce_send broadcasts them and reports what they did. Importing this example calls nothing:
// pass your MCP client's tool call and your signer.

/** One call to a tool of the Sauce MCP server, returning its structured result. */
export type CallTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** One transaction as sauce_tx returns it, unsigned: EVM `{ chainId, to, data, value }`, or
 *  Solana `{ transaction }` in base64, for its fee payer. */
export interface Unsigned {
  readonly what?: string;
  readonly chainId?: number;
  readonly to?: string;
  readonly data?: string;
  readonly value?: string;
  /** EVM: the gas limit to sign it with, where the server gives one. A cook planned after its
   *  Pot's deployment has one, estimated as if the deployment had landed: a signer's own estimate,
   *  taken while the Pot has no code, is far too low. */
  readonly gas?: string;
  readonly transaction?: string;
  readonly feePayer?: string;
}

/** Your signer: the transaction signed, as raw `0x…` hex on an EVM chain, base64 on Solana. On an
 *  EVM chain, sign with `gas` as the gas limit where it is given. */
export type Sign = (unsigned: Unsigned, index: number) => Promise<string>;

/** The transactions a sauce_tx result carries, in the order they are sent. */
export function unsignedOf(built: Record<string, unknown>): Unsigned[] {
  if (typeof built.transaction === "string") return [{ transaction: built.transaction }];
  if (Array.isArray(built.transactions)) return built.transactions as Unsigned[];

  return [built as Unsigned];
}

/**
 * Builds the cook `program` describes (sauce_tx's inputs: source, chain, owner, args…), has `sign`
 * sign each of its transactions in order, and sends them with sauce_send. Returns what sauce_send
 * reported: `ok`, and each transaction's hash, status and what it did.
 */
export async function cookWithYourSigner(
  callTool: CallTool,
  sign: Sign,
  program: Record<string, unknown>,
  rpcUrl?: string,
): Promise<Record<string, unknown>> {
  const built = await callTool("sauce_tx", program);
  const signed: string[] = [];
  for (const [index, unsigned] of unsignedOf(built).entries()) {
    signed.push(await sign(unsigned, index));
  }

  return callTool("sauce_send", {
    transactions: signed,
    ...(rpcUrl === undefined ? {} : { rpcUrl }),
  });
}
