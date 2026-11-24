/**
 * Where a Pot lives without asking a chain: `v12PredictPot`, and the Kitchen releases' Pot families
 * it is derived from.
 *
 * The expected addresses are the live Kitchen's own answers — `predictPot` and `predictSharedPot`
 * read for owner `0x…dEaD` on all six supported EVM chains (kitchen-evm 1.4.0) — so a drift between
 * this derivation and the contract fails here, with no chain.
 */
import { getAddress, zeroAddress, type Address, type Hex } from "viem";

import { v12KitchenAddress, v12PotDerivation, v12ReleaseSet } from "../src/deployments/index.js";
import {
  DEFAULT_POT_SALT,
  potFamilyEngine,
  potFamilyRunsCompiler,
  potSalt,
  v12DefaultPotFamily,
  v12PotFamilies,
  v12PotRelease,
  v12PredictPot,
} from "../src/deployments/pot.js";

const OWNER = "0x000000000000000000000000000000000000dEaD" as Address;

/** The live 1.4.0 Kitchen's `predictPot`, `predictPot(.., true)` and `predictSharedPot`. */
const LIVE = {
  default: {
    salt: DEFAULT_POT_SALT,
    private: "0xAD0d985b044B726E10D57E153891829c9C49fd99",
    fixed: "0x3b60af361D07E2EE47188e71d6088046DfE75FE4",
    shared: "0x9a1C11ad4A68c861c17f6B52dd5B8F704CfF9dCF",
  },
  treasury: {
    salt: potSalt("treasury"),
    private: "0x41a3E643b325dE5b50A563e4d5F21850497CE07c",
    fixed: "0x2B909db1133468962bB995d26760b185D5079571",
    shared: "0x94F86Ae002206B0AE1a59DD3d8e57885A7680C2D",
  },
} as const;

describe("v12PredictPot", () => {
  it("predicts the installed release's CREATE3 Pot by default", () => {
    for (const live of [LIVE.default, LIVE.treasury]) {
      expect(v12PredictPot(OWNER, live.salt)).toBe(live.private);
      expect(v12PredictPot(OWNER, live.salt, { routerFixed: true })).toBe(live.fixed);
      expect(v12PredictPot(zeroAddress, live.salt)).toBe(live.shared);
      // The Kitchen-address form predicts the installed release's Pot at that Kitchen.
      expect(v12PredictPot(OWNER, live.salt, v12KitchenAddress() as Hex)).toBe(live.private);
    }
    expect(v12PredictPot(OWNER)).toBe(LIVE.default.private);
    expect(v12PredictPot(OWNER, DEFAULT_POT_SALT, { routerFixed: false })).toBe(
      LIVE.default.private,
    );
    // A Shared Pot has no mutable Router to ask for.
    expect(() => v12PredictPot(zeroAddress, DEFAULT_POT_SALT, { routerFixed: false })).toThrow(
      /shared Pots always have a fixed Router/,
    );
  });

  it("predicts an earlier release's Pot when asked for its compiler", () => {
    // The kitchen-evm 1.3.0 CREATE2 Pot SDK 1.1.0 predicted for this owner by default.
    expect(v12PredictPot(OWNER, DEFAULT_POT_SALT, { compiler: "2.6.2" })).toBe(
      "0xC23890F611D2Fb425E045BdE1A022d769640b1eC",
    );
    // SDK 1.1.0's documented call: compiler 2.6.3's row stays as that release's record, and its Kitchen
    // is the installed release's, so it predicts the default CREATE3 Pot.
    expect(v12PredictPot(OWNER, DEFAULT_POT_SALT, { compiler: "2.6.3" })).toBe(
      LIVE.default.private,
    );
  });
});

describe("Pot families", () => {
  const kitchen = getAddress(v12KitchenAddress());
  const find = (pot: Address, owner: Address = OWNER, salt: Hex = DEFAULT_POT_SALT) =>
    v12PotRelease({ kitchen, owner, salt, pot: getAddress(pot) });

  it("has one engine per family; the installed one is CREATE3; v12PotRelease tells each", () => {
    for (const family of v12PotFamilies()) {
      const engines = new Set(family.sets.map((set) => set["v12-evm"].engine?.toLowerCase()));
      expect([family.sets[0]!["kitchen-evm"].version, engines.size]).toEqual([
        family.sets[0]!["kitchen-evm"].version,
        1,
      ]);
      expect(potFamilyEngine(family).toLowerCase()).toBe([...engines][0]);
    }

    const installed = v12DefaultPotFamily();
    expect(installed.scheme).toBe("create3");
    expect(installed.sets[0]).toBe(v12ReleaseSet());
    // What the live Kitchen's `potInitCodeHash()` reports: keccak256 of the Pot's creation code.
    expect(installed.reportedHash).toBe(
      "0x127f4d767a3585b9d2bb1a4d6ef3b46289cfa0452ac8323baf91fc8ffbcb03dc",
    );
    expect(installed.reportedHash).toBe(v12PotDerivation().initCodeHash.toLowerCase());
    expect(potFamilyRunsCompiler(installed)).toBe(true);

    expect(find(LIVE.default.private)).toEqual({ family: installed, kind: "private" });
    expect(find(LIVE.default.fixed)).toEqual({ family: installed, kind: "private-fixed-router" });
    expect(find(LIVE.default.shared, zeroAddress)).toEqual({ family: installed, kind: "shared" });
    // The same address for another owner or salt is no Pot of any release.
    expect(find(LIVE.default.private, OWNER, LIVE.treasury.salt)).toBeUndefined();
    expect(find(LIVE.default.private, zeroAddress)).toBeUndefined();

    // kitchen-evm 1.3.0's Pot is CREATE2 under its init-code hash, and its engine runs this SDK's
    // compiler output; kitchen-evm 1.2.0's runs none of it.
    const v130 = find(v12PredictPot(OWNER, DEFAULT_POT_SALT, { compiler: "2.6.2" }));
    expect(v130?.kind).toBe("private");
    expect(v130?.family.scheme).toBe("create2");
    expect(v130?.family.sets[0]!["kitchen-evm"].version).toBe("1.3.0");
    expect(potFamilyRunsCompiler(v130!.family)).toBe(true);
    const v120 = find(v12PredictPot(OWNER, DEFAULT_POT_SALT, { compiler: "2.5.0" }));
    expect(v120?.kind).toBe("private");
    expect(v120?.family.sets[0]!["kitchen-evm"].version).toBe("1.2.0");
    expect(potFamilyRunsCompiler(v120!.family)).toBe(false);
  });
});
