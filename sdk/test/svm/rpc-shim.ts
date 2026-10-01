/**
 * A Solana JSON-RPC endpoint over a LiteSVM bank, for suites that drive the `sauce` command
 * against Solana in process: `globalThis.fetch` answers the calls to `url` from the bank and passes
 * every other request on, so an anvil beside it is reached as usual. It answers what the CLI's
 * Solana steps ask — the blockhash, the clock and accounts, balances, simulation (with the
 * accounts it is asked to report), sending, statuses with their slot, the landed transaction and
 * the finalized slot — and refuses anything else by name. `sendTransaction` checks every signature
 * against the message first, so a test proves the CLI signed what it sent.
 */
import {
  address,
  getBase58Decoder,
  getBase64Decoder,
  getBase64Encoder,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  getTransactionEncoder,
  verifySignature,
  type Address,
  type ReadonlyUint8Array,
  type Transaction,
} from "@solana/kit";
import { FailedTransactionMetadata, type LiteSVM } from "litesvm";

const b64 = (bytes: ReadonlyUint8Array): string => getBase64Decoder().decode(bytes);

const rpcAccount = (account: {
  readonly data: ReadonlyUint8Array;
  readonly executable: boolean;
  readonly lamports: bigint;
  readonly programAddress: Address;
}) => ({
  data: [b64(account.data), "base64"],
  executable: account.executable,
  lamports: Number(account.lamports),
  owner: account.programAddress,
  rentEpoch: 0,
  space: account.data.length,
});

function rpcError(err: unknown): unknown {
  const detail = err as { index?: number; err?: () => unknown };
  if (typeof detail.index === "number" && typeof detail.err === "function") {
    const inner = detail.err() as { code?: number } | number;

    return {
      InstructionError: [
        detail.index,
        typeof inner === "object" && inner !== null && "code" in inner
          ? { Custom: inner.code }
          : String(inner),
      ],
    };
  }

  return String(err);
}

interface Landed {
  readonly err: unknown;
  readonly logs: string[];
  readonly units: bigint;
  readonly slot: bigint;
  readonly transaction: Transaction;
}

export interface SolanaShim {
  readonly url: string;
  /** Every transaction sent, in order, decoded. */
  readonly sent: Transaction[];
  install(): void;
  restore(): void;
}

/** A Solana endpoint at `url`, answered from `svm`. */
export function solanaShim(svm: LiteSVM, url: string): SolanaShim {
  const original = globalThis.fetch;
  const landed = new Map<string, Landed>();
  const sent: Transaction[] = [];
  const decode = (wire: string): Transaction =>
    getTransactionDecoder().decode(new Uint8Array(getBase64Encoder().encode(wire)));
  const slot = (): bigint => svm.getClock().slot;
  const context = () => ({ apiVersion: "2.0.0", slot: Number(slot()) });
  const answer = (id: unknown, result: unknown): Response =>
    Response.json({ id, jsonrpc: "2.0", result });
  const account = (key: string) => {
    const found = svm.getAccount(address(key));

    return found.exists ? rpcAccount(found) : null;
  };

  const stub = async (input: unknown, init?: { body?: string }): Promise<Response> => {
    const target =
      typeof input === "string" ? input : String((input as { url?: string }).url ?? input);
    if (target !== url) return original(input as Parameters<typeof fetch>[0], init as RequestInit);
    const { id, method, params } = JSON.parse(init!.body!) as {
      id: unknown;
      method: string;
      params: unknown[];
    };
    switch (method) {
      case "getLatestBlockhash":
        return answer(id, {
          context: context(),
          value: { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 1_000_000 },
        });
      case "getSlot":
        return answer(id, Number(slot()));
      case "getBalance":
        return answer(id, {
          context: context(),
          value: Number(svm.getBalance(address(params[0] as string)) ?? 0n),
        });
      case "getAccountInfo":
        return answer(id, { context: context(), value: account(params[0] as string) });
      case "getMultipleAccounts":
        return answer(id, {
          context: context(),
          value: (params[0] as string[]).map(account),
        });
      case "getFeeForMessage": {
        // The base fee: 5000 lamports per signature the message requires, its header's first byte.
        const message = new Uint8Array(getBase64Encoder().encode(params[0] as string));
        const versioned = (message[0]! & 0x80) !== 0;

        return answer(id, { context: context(), value: 5000 * message[versioned ? 1 : 0]! });
      }
      case "getMinimumBalanceForRentExemption":
        return answer(id, Number(svm.minimumBalanceForRentExemption(BigInt(params[0] as number))));
      case "simulateTransaction": {
        const transaction = decode(params[0] as string);
        svm.withSigverify(false);
        const result = svm.simulateTransaction(transaction);
        svm.withSigverify(true);
        const failed = result instanceof FailedTransactionMetadata;
        const meta = result.meta();
        const asked = (params[1] as { accounts?: { addresses: string[] } } | undefined)?.accounts;
        const post = failed ? [] : result.postAccounts();

        return answer(id, {
          context: context(),
          value: {
            err: failed ? rpcError(result.err()) : null,
            logs: meta.logs(),
            unitsConsumed: Number(meta.computeUnitsConsumed()),
            returnData: null,
            accounts:
              asked === undefined || failed
                ? null
                : asked.addresses.map((key) => {
                    const after = post.find((entry) => entry.address === key);
                    if (after !== undefined) return after.lamports > 0n ? rpcAccount(after) : null;

                    return account(key);
                  }),
          },
        });
      }
      case "sendTransaction": {
        const transaction = decode(params[0] as string);
        for (const [signer, signature] of Object.entries(transaction.signatures)) {
          const key = await getPublicKeyFromAddress(address(signer));
          if (
            signature === null ||
            !(await verifySignature(key, signature, transaction.messageBytes))
          ) {
            throw new Error(`sendTransaction: ${signer} did not sign the message`);
          }
        }
        const signature = getBase58Decoder().decode(Object.values(transaction.signatures)[0]!);
        const result = svm.sendTransaction(transaction);
        const failed = result instanceof FailedTransactionMetadata;
        const meta = failed ? result.meta() : result;
        landed.set(signature, {
          err: failed ? rpcError(result.err()) : null,
          logs: meta.logs(),
          units: meta.computeUnitsConsumed(),
          slot: slot(),
          transaction,
        });
        sent.push(transaction);
        // The next transaction lands in a later slot, on a fresh blockhash.
        svm.warpToSlot(slot() + 1n);
        svm.expireBlockhash();

        return answer(id, signature);
      }
      case "getSignatureStatuses":
        return answer(id, {
          context: context(),
          value: (params[0] as string[]).map((signature) => {
            const tx = landed.get(signature);

            return tx === undefined
              ? null
              : {
                  slot: Number(tx.slot),
                  confirmations: null,
                  err: tx.err,
                  confirmationStatus: "confirmed",
                };
          }),
        });
      case "getTransaction": {
        const tx = landed.get(params[0] as string);

        return answer(
          id,
          tx === undefined
            ? null
            : {
                slot: Number(tx.slot),
                blockTime: null,
                version: 0,
                transaction: [
                  b64(new Uint8Array(getTransactionEncoder().encode(tx.transaction))),
                  "base64",
                ],
                meta: {
                  err: tx.err,
                  fee: 5000,
                  logMessages: tx.logs,
                  computeUnitsConsumed: Number(tx.units),
                  returnData: null,
                  preBalances: [],
                  postBalances: [],
                  innerInstructions: [],
                  loadedAddresses: { writable: [], readonly: [] },
                },
              },
        );
      }
    }
    throw new Error(`the CLI made a Solana RPC call the shim does not answer: ${method}`);
  };

  return {
    url,
    sent,
    install: () => {
      globalThis.fetch = stub as unknown as typeof fetch;
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
