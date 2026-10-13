/**
 * A Solana JSON-RPC endpoint over a LiteSVM bank, for suites that drive the `sauce` command
 * against Solana in process: `globalThis.fetch` answers the calls to `url` from the bank and passes
 * every other request on, so an anvil beside it is reached as usual. It answers what the CLI's
 * Solana steps ask — the blockhash, the clock and accounts, balances, simulation (with the
 * accounts it is asked to report), sending, statuses with their slot, the landed transaction, a
 * key's transactions, the block height and the finalized slot (one behind the tip, held in
 * SlotHashes as a cluster's is) — and refuses anything else by name. A blockhash it hands out is
 * good for 150 slots, as a cluster's is, where the bank takes only its latest. `sendTransaction`
 * checks every signature against the message first, so a test proves the CLI signed what it sent.
 */
import {
  address,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  getTransactionEncoder,
  verifySignature,
  type Address,
  type ReadonlyUint8Array,
  type Transaction,
} from "@solana/kit";
import { FailedTransactionMetadata, type LiteSVM } from "litesvm";

import { FIELDLESS } from "../../src/cli/svm-fork.js";

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

/** The addresses a v0 message loads through lookup tables, read from the tables in `svm`. */
function loadedKeys(svm: LiteSVM, transaction: Transaction): string[] {
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes) as {
    addressTableLookups?: readonly {
      lookupTableAddress: Address;
      writableIndexes: readonly number[];
      readonlyIndexes: readonly number[];
    }[];
  };

  return (message.addressTableLookups ?? []).flatMap((lookup) => {
    const table = svm.getAccount(lookup.lookupTableAddress);
    if (!table.exists) return [];
    // A table's addresses follow its 56-byte header, 32 bytes each.
    const key = (index: number): string =>
      getBase58Decoder().decode(table.data.subarray(56 + index * 32, 88 + index * 32));

    return [...lookup.writableIndexes, ...lookup.readonlyIndexes].map(key);
  });
}

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

  // A transaction error with no fields, by its name, as a cluster spells it.
  return typeof err === "number" ? (FIELDLESS[err] ?? String(err)) : String(err);
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
  /** Makes every blockhash handed out so far expire, as a minute's wait would on a cluster. */
  expire(): void;
  install(): void;
  restore(): void;
}

/** How many slots a blockhash stays valid for after it is handed out, as on a cluster. */
const BLOCKHASH_SLOTS = 150n;

/**
 * A Solana endpoint at `url`, answered from `svm`. `known` names the accounts `getProgramAccounts`
 * scans, the bank having no way to list its own: without it the call is refused.
 */
export function solanaShim(
  svm: LiteSVM,
  url: string,
  known?: () => readonly Address[],
): SolanaShim {
  const original = globalThis.fetch;
  const landed = new Map<string, Landed>();
  const sent: Transaction[] = [];
  // Every blockhash handed out, and the slot it was: a cluster takes a transaction on any of them
  // for BLOCKHASH_SLOTS slots, where the bank takes only its latest.
  const issued = new Map<string, bigint>();
  const recent = (transaction: Transaction): boolean => {
    const { lifetimeToken } = getCompiledTransactionMessageDecoder().decode(
      transaction.messageBytes,
    ) as { lifetimeToken: string };
    const at = issued.get(lifetimeToken);

    return at !== undefined && slot() - at <= BLOCKHASH_SLOTS;
  };
  /** Runs `run` with the bank's blockhash check off where the cluster's would pass `transaction`:
   *  a recent blockhash that is not the bank's latest, or a simulation that replaces it. */
  const onCluster = <T>(transaction: Transaction, replaced: boolean, run: () => T): T => {
    const relaxed = replaced || recent(transaction);
    if (relaxed) svm.withBlockhashCheck(false);
    try {
      return run();
    } finally {
      if (relaxed) svm.withBlockhashCheck(true);
    }
  };
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
      case "getLatestBlockhash": {
        const blockhash = svm.latestBlockhash();
        if (!issued.has(blockhash)) issued.set(blockhash, slot());

        return answer(id, {
          context: context(),
          value: {
            blockhash,
            lastValidBlockHeight: Number(issued.get(blockhash)! + BLOCKHASH_SLOTS),
          },
        });
      }
      // The block height, as the slot: no slot is skipped here.
      case "getBlockHeight":
        return answer(id, Number(slot()));
      case "getSignaturesForAddress": {
        const [key, config] = params as [string, { limit?: number } | undefined];
        const found = [...landed.entries()]
          .reverse()
          .filter(([, tx]) =>
            [
              ...(
                getCompiledTransactionMessageDecoder().decode(tx.transaction.messageBytes) as {
                  staticAccounts: readonly string[];
                }
              ).staticAccounts,
              ...loadedKeys(svm, tx.transaction),
            ].includes(key),
          )
          .slice(0, config?.limit ?? 1000)
          .map(([signature, tx]) => ({
            signature,
            slot: Number(tx.slot),
            err: tx.err,
            memo: null,
            blockTime: null,
            confirmationStatus: "confirmed",
          }));

        return answer(id, found);
      }
      case "getSlot": {
        // No commitment is the server's default, finalized (which a client leaves out).
        const commitment = (params[0] as { commitment?: string } | undefined)?.commitment;
        if (commitment !== undefined && commitment !== "finalized")
          return answer(id, Number(slot()));
        // A cluster's finalized slot trails its tip, and its SlotHashes holds it: the recent slot
        // a lookup table's creation names, which the bank refuses unless SlotHashes has it.
        const finalized = slot() - 1n;
        const hashes = svm.getSlotHashes();
        if (!hashes.some((entry) => entry.slot === finalized) && hashes.length > 0) {
          // Each read hands out copies: one more entry, for the new slot, ahead of the rest, which
          // the sysvar keeps (512 of them) as a cluster's does.
          const fresh = svm.getSlotHashes()[0]!;
          fresh.slot = finalized;
          svm.setSlotHashes([fresh, ...hashes].slice(0, 512));
        }
        return answer(id, Number(finalized));
      }
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
      case "getProgramAccounts": {
        if (known === undefined) break;
        const [program, config] = params as [
          string,
          {
            dataSlice?: { offset: number; length: number };
            filters?: ({ dataSize: number } | { memcmp: { offset: number; bytes: string } })[];
          },
        ];
        const matches = known().flatMap((key) => {
          const found = svm.getAccount(key);
          if (!found.exists || found.programAddress !== program) return [];
          const data = found.data;
          const kept = (config.filters ?? []).every((filter) =>
            "dataSize" in filter
              ? data.length === Number(filter.dataSize)
              : (() => {
                  const want = getBase58Encoder().encode(filter.memcmp.bytes);
                  const at = Number(filter.memcmp.offset);
                  return want.every((byte, i) => data[at + i] === byte);
                })(),
          );
          if (!kept) return [];
          const slice = config.dataSlice;
          const shown =
            slice === undefined
              ? data
              : data.subarray(Number(slice.offset), Number(slice.offset) + Number(slice.length));
          return [{ pubkey: key, account: rpcAccount({ ...found, data: shown }) }];
        });
        return answer(id, matches);
      }
      case "getMinimumBalanceForRentExemption":
        return answer(id, Number(svm.minimumBalanceForRentExemption(BigInt(params[0] as number))));
      case "simulateTransaction": {
        const transaction = decode(params[0] as string);
        const replaced =
          (params[1] as { replaceRecentBlockhash?: boolean } | undefined)
            ?.replaceRecentBlockhash === true;
        svm.withSigverify(false);
        const result = onCluster(transaction, replaced, () => svm.simulateTransaction(transaction));
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
        const result = onCluster(transaction, false, () => svm.sendTransaction(transaction));
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
    expire: () => {
      issued.clear();
      svm.expireBlockhash();
    },
    install: () => {
      globalThis.fetch = stub as unknown as typeof fetch;
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
