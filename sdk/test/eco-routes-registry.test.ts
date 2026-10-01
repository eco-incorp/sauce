/**
 * The eco-routes deployment the SDK builds intents for: the one the production solvers serve.
 *
 * A solver fills an intent only on the Portal it runs, so a registry that records an earlier
 * Portal produces intents nobody fills, with nothing failing locally. These pins are the
 * `@eco-foundation/routes-ts` 3.2.24 table (eco-routes 2.12.0 on EVM, the rotated eco-routes-svm
 * programs on Solana), each one read on chain before it was written here: every EVM address has
 * code and reports `version()` 2.12.0 (the provers name this Portal as their `PORTAL()`), and each
 * Solana id is an executable, upgradeable program.
 */
import { bytesToHex, getAddress } from "viem";
import { address as solanaAddress, getAddressEncoder } from "@solana/kit";

import { ECO_ROUTES_ADDRESSES } from "../src/protocols/eco-routes/addresses.generated.js";
import {
  ecoRoutesDeployment,
  ecoRoutesPortal,
  ecoRoutesProver,
} from "../src/protocols/eco-routes/lookup.js";

const PORTAL = "0xEC000769A73b70e16f361a442292500b3BCf4A85";
const HYPER_PROVER = "0xEC08fb4647f3f50d1162a578d481266687C60fc5";
const POLYMER_PROVER = "0xEC0DeD087Ee6C55991Bb4D4567ca1134c5353Ed6";

/** A Solana program id as the registry holds it: its 32 bytes, hex. */
const svmKey = (base58: string) =>
  bytesToHex(new Uint8Array(getAddressEncoder().encode(solanaAddress(base58))));

describe("eco-routes: the production deployment", () => {
  it("is pinned to routes-ts 3.2.24", () => {
    expect(ECO_ROUTES_ADDRESSES.v3.version).toBe("3.2.24");
  });

  it.each([
    "ethereum",
    "optimism",
    "unichain",
    "polygon",
    "monad",
    "arc",
    "base",
    "plasma",
    "arbitrum",
  ])("%s has the Portal and both provers", (chain) => {
    const deployment = ecoRoutesDeployment(chain)!;
    expect(ecoRoutesPortal(chain)).toBe(PORTAL);
    expect(getAddress(deployment.HyperProver!)).toBe(HYPER_PROVER);
    expect(getAddress(deployment.PolymerProver!)).toBe(POLYMER_PROVER);
  });

  it("ronin has the Portal and no prover", () => {
    expect(ecoRoutesPortal("ronin")).toBe(PORTAL);
    expect(Object.keys(ecoRoutesDeployment("ronin")!)).toEqual(["Portal"]);
  });

  it("a route between two of them proves through the Hyperlane prover", () => {
    expect(ecoRoutesProver("base", "arbitrum")).toBe(HYPER_PROVER);
    expect(ecoRoutesProver("arc", "base")).toBe(HYPER_PROVER);
  });

  // No deployment of this generation exists on these, so nothing can fill an intent there.
  it.each(["bsc", "sonic", "celo", "ink"])("%s has no production Portal", (chain) => {
    expect(ecoRoutesDeployment(chain)).toBeUndefined();
    expect(() => ecoRoutesPortal(chain)).toThrow(/is not deployed on/);
  });

  it("Solana records the live eco-routes-svm programs", () => {
    const solana = ecoRoutesDeployment("solana")!;
    expect(solana.Portal).toBe(svmKey("EcoowmRRrMyYtQCuh5fCvMDWcD6B9ZDZkpgedf2bWKXi"));
    expect(solana.HyperProver).toBe(svmKey("EcoHjwFYKtiHp5ZuFQBc87GDikm9Lc5EYapKywjNAQQF"));
    expect(solana.PolymerProver).toBe(svmKey("EcoPSkJe6BYMwkuYmpsEbhHX3ikDbnG2BdwavGquSwRV"));
  });
});
