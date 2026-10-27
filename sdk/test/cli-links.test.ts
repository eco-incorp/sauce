/**
 * Where a person opens a transaction the command sent or read (`cli/links.ts`): the chain's
 * explorer, and the trace on BlockSec's Phalcon explorer, by the slug Phalcon gives the chain.
 * Pure: built from the chain and the hash, nothing fetched.
 */
import { requireChain } from "../src/chains/canonical.js";
import { linkLines, txLinks } from "../src/cli/links.js";

const HASH = "0x63029432f59f2a3b044f5891140e95ebf0e515fc261ee3059f5173eaa38bc989";
const SIGNATURE =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

describe("a transaction's links", () => {
  it("gives the supported chains their explorer and their Phalcon trace", () => {
    expect(txLinks(requireChain("ethereum"), HASH)).toEqual({
      explorer: `https://etherscan.io/tx/${HASH}`,
      trace: `https://app.blocksec.com/phalcon/explorer/tx/eth/${HASH}`,
    });
    expect(txLinks(requireChain("base"), HASH)).toEqual({
      explorer: `https://basescan.org/tx/${HASH}`,
      trace: `https://app.blocksec.com/phalcon/explorer/tx/base/${HASH}`,
    });
    // Solana: Solscan for the explorer, and Phalcon's own Solana slug for the trace.
    expect(txLinks(requireChain("solana"), SIGNATURE)).toEqual({
      explorer: `https://solscan.io/tx/${SIGNATURE}`,
      trace: `https://app.blocksec.com/phalcon/explorer/tx/solana/${SIGNATURE}`,
    });
  });

  it("leaves the trace out on a chain Phalcon does not list", () => {
    // Zora has an explorer in the chain record, and no Phalcon slug.
    const links = txLinks(requireChain("zora"), HASH);
    expect(links.trace).toBeUndefined();
    expect(links.explorer).toMatch(new RegExp(`^https://[^/]+/tx/${HASH}$`));
  });

  it("gives Solana's devnet Solscan's devnet page, and no trace: Phalcon does not list devnet", () => {
    expect(txLinks(requireChain("solana-devnet"), SIGNATURE)).toEqual({
      explorer: `https://solscan.io/tx/${SIGNATURE}?cluster=devnet`,
    });
  });

  it("gives Solana's testnet Solscan's testnet page, and no trace: Phalcon does not list testnet", () => {
    expect(txLinks(requireChain("solana-testnet"), SIGNATURE)).toEqual({
      explorer: `https://solscan.io/tx/${SIGNATURE}?cluster=testnet`,
    });
  });

  it("prints each as a line of its own, the trace said to be for a browser", () => {
    expect(linkLines(txLinks(requireChain("base"), HASH))).toEqual([
      `  explorer: https://basescan.org/tx/${HASH}`,
      `  trace (calls and balance changes, to open in a browser): https://app.blocksec.com/phalcon/explorer/tx/base/${HASH}`,
    ]);
    expect(linkLines({}, "    ")).toEqual([]);
  });
});
