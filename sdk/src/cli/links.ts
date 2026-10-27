/**
 * Where a person opens a transaction the command sent or read: the chain's block explorer, and its
 * trace on BlockSec's Phalcon explorer, which shows the call tree, the decoded calls, the balance
 * changes and the fund flow on one page. Links for a browser, built from the chain and the hash:
 * nothing here reaches the network, and the command never reads these pages.
 *
 * Phalcon names each chain by a slug of its own (its explorer's chain list): Ethereum is `eth`,
 * Base `base`, Solana `solana`. A chain it does not list gets no trace link: Solana's devnet and
 * testnet among them, whose transactions Solscan shows under its `cluster` parameter.
 */
import type { CanonicalChain } from "../chains/canonical.js";
import { chains } from "../chains/index.js";
import { svmClusterOf } from "../routes/token-registry.js";

/** Phalcon's slug for each chain it traces, by chain id; Solana by its canonical id. */
const PHALCON: Readonly<Record<number, string>> = {
  1: "eth",
  10: "optimism",
  56: "bsc",
  100: "gnosis",
  137: "polygon",
  143: "monad",
  146: "sonic",
  169: "manta",
  250: "fantom",
  324: "zksync-era",
  1116: "core",
  1329: "sei",
  2222: "kava",
  5042: "arc",
  8453: "base",
  9745: "plasma",
  42161: "arbitrum",
  43114: "avalanche",
  59144: "linea",
  80094: "berachain",
  534352: "scroll",
  1399811149: "solana",
};

/** Solana's explorer: Solscan, which Phalcon links to as well. */
const SOLSCAN = "https://solscan.io";

/** Solscan's page of a transaction on an SVM chain: a cluster other than mainnet's by its name. */
function solscan(chain: CanonicalChain, hash: string): string {
  const cluster = svmClusterOf(chain);

  return `${SOLSCAN}/tx/${hash}${cluster === undefined || cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`}`;
}

/** A transaction's pages. Either may be missing, for a chain with no explorer or no trace. */
export interface TxLinks {
  readonly explorer?: string;
  /** The trace: calls, balance changes and fund flow, on Phalcon. */
  readonly trace?: string;
}

/** The pages of `hash` (a Solana signature on Solana) on `chain`. */
export function txLinks(chain: CanonicalChain, hash: string): TxLinks {
  const site = chains[chain.id]?.blockExplorerUrls[0];
  const explorer =
    chain.kind === "svm"
      ? solscan(chain, hash)
      : site === undefined
        ? undefined
        : `${site.replace(/\/$/, "")}/tx/${hash}`;
  const slug = PHALCON[chain.id];

  return {
    ...(explorer === undefined ? {} : { explorer }),
    ...(slug === undefined
      ? {}
      : { trace: `https://app.blocksec.com/phalcon/explorer/tx/${slug}/${hash}` }),
  };
}

/** The pages as lines under a sent transaction's line, indented by `indent`. */
export const linkLines = (links: TxLinks, indent = "  "): string[] => [
  ...(links.explorer === undefined ? [] : [`${indent}explorer: ${links.explorer}`]),
  ...(links.trace === undefined
    ? []
    : [`${indent}trace (calls and balance changes, to open in a browser): ${links.trace}`]),
];
