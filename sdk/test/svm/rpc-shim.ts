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
import { FailedTransactionMetadata, FeatureSet, LiteSVM } from "litesvm";

import { FIELDLESS } from "../../src/cli/svm-fork.js";

/** The bank a shim answers from, named for suites whose package does not depend on LiteSVM. */
export type { LiteSVM };

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

/** The genesis hash the shim answers: its own, a local bank's, which names no public cluster. */
export const SHIM_GENESIS_HASH = "LocaLSVMgenesis1111111111111111111111111111";

/**
 * A bank to answer from, as a cluster runs: every feature, the builtins, precompiles and sysvars,
 * and LiteSVM's default programs (SPL Token, Token-2022, the Associated Token Account program).
 */
export function clusterBank(): LiteSVM {
  return new LiteSVM()
    .withFeatureSet(FeatureSet.allEnabled())
    .withBuiltins()
    .withPrecompiles()
    .withSysvars()
    .withDefaultPrograms();
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
    // The bank's latest blockhash expires as a cluster's would, after its slots, though nothing
    // landed since to move it on.
    const latest = svm.latestBlockhash();
    const at = issued.get(latest);
    if (at !== undefined && slot() - at > BLOCKHASH_SLOTS) svm.expireBlockhash();
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

  let synced = -1n;
  /** The bank's SlotHashes as a cluster's: the 512 slots before the tip, newest first, none skipped
   *  — what a lookup table's creation (its recent slot) and its close (its cooldown) read. */
  const syncSlotHashes = (): void => {
    const tip = slot();
    if (tip === synced) return;
    synced = tip;
    const count = Number(tip < 512n ? tip : 512n);
    const entries: ReturnType<LiteSVM["getSlotHashes"]> = [];
    // Each read hands out copies of the entries: as many as the sysvar is to hold.
    while (entries.length < count) {
      const read = svm.getSlotHashes();
      if (read.length === 0) return;
      entries.push(...read);
    }
    const fresh = entries.slice(0, count);
    fresh.forEach((entry, index) => {
      entry.slot = tip - 1n - BigInt(index);
    });
    svm.setSlotHashes(fresh);
  };

  const stub = async (input: unknown, init?: { body?: string }): Promise<Response> => {
    const target =
      typeof input === "string" ? input : String((input as { url?: string }).url ?? input);
    if (target !== url) return original(input as Parameters<typeof fetch>[0], init as RequestInit);
    syncSlotHashes();
    const { id, method, params } = JSON.parse(init!.body!) as {
      id: unknown;
      method: string;
      params: unknown[];
    };
    switch (method) {
      case "getLatestBlockhash": {
        // A cluster's latest blockhash is a recent one: the bank's, moved on where it is old.
        const stale = issued.get(svm.latestBlockhash());
        if (stale !== undefined && slot() - stale > BLOCKHASH_SLOTS) svm.expireBlockhash();
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
        const [key, config] = params as [string, { limit?: number; before?: string } | undefined];
        const newest = [...landed.entries()].reverse();
        const from =
          config?.before === undefined
            ? 0
            : newest.findIndex(([signature]) => signature === config.before) + 1;
        const found = newest
          .slice(from)
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
      // A local bank is no public cluster: a Pot created on it is recorded as this one's.
      case "getGenesisHash":
        return answer(id, SHIM_GENESIS_HASH);
      case "getSlot": {
        // No commitment is the server's default, finalized (which a client leaves out).
        const commitment = (params[0] as { commitment?: string } | undefined)?.commitment;
        if (commitment !== undefined && commitment !== "finalized")
          return answer(id, Number(slot()));
        // A cluster's finalized slot trails its tip, and its SlotHashes holds it: the recent slot
        // a lookup table's creation names.
        return answer(id, Number(slot() - 1n));
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
        const wantsInner =
          (params[1] as { innerInstructions?: boolean } | undefined)?.innerInstructions === true;
        // As a cluster reports them: a group per top-level instruction that made CPIs, each inner
        // instruction keyed by `programId`. A mainnet node gives a program it has no parser for —
        // the Kitchen, the engine — partially decoded (accounts by address, data in base58, stack
        // height), and System and SPL Token parsed, with no accounts or data; here every program
        // comes partially decoded, which is all a reader of the Kitchen's calls needs.
        const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes) as {
          staticAccounts: readonly string[];
          addressTableLookups?: readonly {
            lookupTableAddress: Address;
            writableIndexes: readonly number[];
            readonlyIndexes: readonly number[];
          }[];
        };
        const tableKey = (table: Address, index: number): string => {
          const read = svm.getAccount(table);

          return read.exists
            ? getBase58Decoder().decode(read.data.subarray(56 + index * 32, 88 + index * 32))
            : "";
        };
        const lookups = message.addressTableLookups ?? [];
        const keys = [
          ...message.staticAccounts,
          ...lookups.flatMap((l) =>
            l.writableIndexes.map((i) => tableKey(l.lookupTableAddress, i)),
          ),
          ...lookups.flatMap((l) =>
            l.readonlyIndexes.map((i) => tableKey(l.lookupTableAddress, i)),
          ),
        ];
        const inner = meta
          .innerInstructions()
          .map((group, index) => ({
            index,
            instructions: group.map((each) => {
              const compiled = each.instruction();

              return {
                programId: keys[compiled.programIdIndex()],
                accounts: Array.from(compiled.accounts()).map((at) => keys[at]),
                data: getBase58Decoder().decode(compiled.data()),
                stackHeight: each.stackHeight(),
              };
            }),
          }))
          .filter((group) => group.instructions.length > 0);
        const post = failed ? [] : result.postAccounts();
        // The last return data any instruction set, as a cluster reports it: what `main` returned.
        const returned = meta.returnData();

        return answer(id, {
          context: context(),
          value: {
            err: failed ? rpcError(result.err()) : null,
            logs: meta.logs(),
            innerInstructions: wantsInner ? inner : null,
            unitsConsumed: Number(meta.computeUnitsConsumed()),
            returnData:
              returned.data().length === 0
                ? null
                : {
                    programId: getBase58Decoder().decode(returned.programId()),
                    data: [b64(returned.data()), "base64"],
                  },
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
