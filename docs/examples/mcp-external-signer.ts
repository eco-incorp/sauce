// The Sauce MCP server driven by an agent whose key it never sees: sauce_tx builds the cook, your
// signer (a KMS, a hardware wallet, another wallet's MCP server) signs each transaction, and
// sauce_send broadcasts them and reports what they did. A Solana cook too large for one
// transaction comes as a plan of steps, each sent with its cursor, which returns the next.
// Importing this example calls nothing: pass your MCP client's tool call and your signer.

/** One call to a tool of the Sauce MCP server, returning its structured result. */
export type CallTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** One transaction as the server returns it, unsigned: EVM `{ chainId, to, data, value }`, or
 *  Solana `{ transaction }` in base64, for its fee payer. */
export interface Unsigned {
  readonly what?: string;
  readonly chainId?: number;
  readonly to?: string;
  readonly data?: string;
  readonly value?: string;
  readonly transaction?: string;
  readonly feePayer?: string;
}

/** Your signer: the transaction signed, as raw `0x…` hex on an EVM chain, base64 on Solana. */
export type Sign = (unsigned: Unsigned, index: number) => Promise<string>;

/** The transactions a result carries to sign, in the order they are sent. */
export function unsignedOf(built: Record<string, unknown>): Unsigned[] {
  if (typeof built.transaction === "string") return [{ transaction: built.transaction }];
  if (Array.isArray(built.transactions)) return built.transactions as Unsigned[];

  return typeof built.to === "string" ? [built as Unsigned] : [];
}

/**
 * Builds the cook `program` describes (sauce_tx's inputs: source, chain, owner, args…), has `sign`
 * sign each of its transactions in order, and sends them with sauce_send — a plan's every step,
 * each sent with its cursor, until sauce_send says the plan is done. Returns the last report, with
 * every transaction sent along the way in `sent` and each step sent in `steps`.
 */
export async function cookWithYourSigner(
  callTool: CallTool,
  sign: Sign,
  program: Record<string, unknown>,
  rpcUrl?: string,
): Promise<Record<string, unknown>> {
  let step = await callTool("sauce_tx", program);
  const sent: unknown[] = [];
  const steps: string[] = [];
  for (;;) {
    const signed: string[] = [];
    for (const [index, unsigned] of unsignedOf(step).entries()) {
      signed.push(await sign(unsigned, index));
    }
    // Nothing to sign yet (a cook handed out can still land): ask again in a moment.
    if (signed.length === 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
    const report = await callTool("sauce_send", {
      transactions: signed,
      ...(typeof step.cursor === "string" ? { cursor: step.cursor } : {}),
      ...(rpcUrl === undefined ? {} : { rpcUrl }),
    });
    sent.push(...((report.sent as unknown[] | undefined) ?? []));
    steps.push(String(step.step ?? "cook"));
    const next = report.next as Record<string, unknown> | undefined;
    if (report.ok !== true || next === undefined || next.step === "done") {
      return { ...report, sent, steps };
    }
    step = next;
  }
}
