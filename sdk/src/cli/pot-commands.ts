/**
 * `sauce pot list` and `sauce pot import`: the Pot store (`pot-store.ts`) read back, and Pots this
 * machine did not deploy recorded in it. What a record holds and how its release is told is
 * `pots.ts`'s.
 */
import { createSolanaRpc, type Address as SvmAddress } from "@solana/kit";
import type { Address } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { connect } from "./chain.js";
import type { CommandOutput } from "./commands.js";
import type { PotImportTarget } from "./inputs.js";
import { MAINNET_CLUSTER, type PotRecord, type PotStore } from "./pot-store.js";
import { importEvmOwnerPots, importEvmPot, importSvmPot, recordOn, releaseText } from "./pots.js";
import { genesisOf } from "./solana.js";

/** The chain a record is on, and on Solana a cluster other than mainnet's: `solana (devnet)`. */
const onChain = (record: PotRecord): string =>
  record.cluster === undefined || record.cluster === MAINNET_CLUSTER
    ? record.chain
    : `${record.chain} (${record.cluster})`;

/** One Pot, as `sauce pot list` prints it. */
const potLines = (record: PotRecord): string[] => [
  `${onChain(record)}  ${record.pot}  ${record.kind}`,
  `  owner ${record.owner}, salt ${record.salt}`,
  `  ${releaseText(record.release)}${record.engine === undefined ? "" : `, engine ${record.engine}`}`,
  record.deployment === undefined
    ? `  ${record.origin} ${record.recordedAt}`
    : `  ${record.origin} in ${record.deployment.tx} (${record.chain === "solana" ? "slot" : "block"} ` +
      `${record.deployment.block}) from ${record.deployment.from}`,
];

/** The same address, as its chain compares them: an EVM one in any case, a base58 one exactly. */
const sameAddress = (a: string, b: string): boolean =>
  a.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b;

/** `sauce pot list`: the store's Pots, those on `chain` or of `owner` when given. A Solana Pot is
 *  recorded under Solana's chain and its cluster, so `solana-devnet` lists devnet's Solana records
 *  (`pots.ts#recordOn`), whichever chain recorded them. */
export function potListCommand(
  store: PotStore,
  filter: { readonly chain?: CanonicalChain; readonly owner?: string },
): CommandOutput {
  const listing = store.list();
  const pots = listing.pots.filter(
    (record) =>
      (filter.chain === undefined || recordOn(record, filter.chain)) &&
      (filter.owner === undefined || sameAddress(record.owner, filter.owner)),
  );
  const which = [
    filter.chain === undefined ? undefined : `on ${filter.chain.slug}`,
    filter.owner === undefined ? undefined : `of ${filter.owner}`,
  ].filter((part) => part !== undefined);

  return {
    text:
      pots.length === 0
        ? `No Pots${which.length === 0 ? "" : ` ${which.join(" ")}`} in ${store.dir}.`
        : pots.flatMap(potLines).join("\n"),
    json: { store: store.dir, pots },
    ...(listing.warnings.length === 0 ? {} : { notes: listing.warnings }),
  };
}

export interface PotImportInput extends PotImportTarget {
  readonly store: PotStore;
  readonly chain: CanonicalChain;
  readonly rpcUrl: string;
}

/** `sauce pot import`: records Pots deployed elsewhere — one by its address, or an owner's by salt. */
export async function potImportCommand(input: PotImportInput): Promise<CommandOutput> {
  const { chain } = input;
  let found: PotRecord[];
  if (chain.kind === "svm") {
    const rpc = createSolanaRpc(input.rpcUrl);
    found = [
      await importSvmPot(
        {
          ownerOf: async (address) => {
            const { value } = await rpc.getAccountInfo(address, { encoding: "base64" }).send();

            return value === null ? undefined : value.owner;
          },
          genesis: () => genesisOf(rpc, input.rpcUrl),
        },
        chain,
        input.owner as SvmAddress,
        input.salt,
      ),
    ];
  } else {
    const client = await connect(input.rpcUrl, chain);
    if (input.pot !== undefined) {
      found = [await importEvmPot(client, chain, input.pot)];
    } else {
      found = await importEvmOwnerPots(client, chain, input.owner as Address, input.salt);
      if (found.length === 0) {
        throw new Error(
          `${input.owner} has no Pot at salt ${input.salt} on ${chain.slug} under any release ` +
            "this sauce knows",
        );
      }
    }
  }
  // An import has no deployment, so it is a Pot's first record or nothing new.
  const saved = found.map((record) => ({ record, saved: input.store.save(record) }));
  const pots = saved.flatMap(({ record, saved }) =>
    saved === "created"
      ? [record]
      : input.store.recordsOf(record.chainId, record.pot, record.cluster),
  );

  return {
    text: pots.flatMap(potLines).join("\n"),
    json: { store: input.store.dir, pots },
    notes: saved.map(({ record, saved }) =>
      saved === "created"
        ? `recorded Pot ${record.pot} on ${onChain(record)} in ${input.store.dir}`
        : `Pot ${record.pot} on ${onChain(record)} was already recorded in ${input.store.dir}; ` +
          "the record is kept as it was",
    ),
  };
}
