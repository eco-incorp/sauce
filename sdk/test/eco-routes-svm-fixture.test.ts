/**
 * The pinned dump of eco-routes' Solana programs (`test/fixtures/eco-routes-svm/`, written by
 * `scripts/dump-eco-routes-svm.mjs`): every file hashes to the sha256 its manifest pins, every
 * program is an ELF of the size recorded, the manifest records where each came from (the program
 * id, its ProgramData account, upgrade authority and last-deploy slot, the slot and date of the
 * dump), and the eco-routes program ids are the registry's own. A redump that changes a byte fails
 * here until the manifest says so.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ecoRoutesContract, ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import { requireChain } from "../src/chains/canonical.js";
import { svmKeyOf } from "../src/svm/index.js";
import { fixtureBytes, MANIFEST } from "./svm/eco-routes-svm.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "eco-routes-svm");
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const solana = requireChain("solana");

describe("the eco-routes Solana dump", () => {
  it("records its source: mainnet, the slot and the day", () => {
    expect(MANIFEST.cluster).toBe("mainnet-beta");
    expect(MANIFEST.chainId).toBe(1399811149);
    expect(MANIFEST.slot).toMatch(/^\d+$/);
    expect(MANIFEST.dumpedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each(MANIFEST.programs.map((entry) => [entry.name, entry] as const))(
    "%s: the ELF its pin names, with its ProgramData, authority and deploy slot",
    (_name, entry) => {
      const bytes = fixtureBytes(entry.file);
      expect(sha256(bytes)).toBe(entry.sha256);
      expect(bytes.length).toBe(entry.size);
      expect(Buffer.from(bytes.subarray(0, 4)).toString("hex")).toBe("7f454c46");
      expect(entry.programData).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      expect(entry.lastDeploySlot).toMatch(/^\d+$/);
      expect(
        entry.authority === null || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(entry.authority),
      ).toBe(true);
    },
  );

  it.each(MANIFEST.accounts.map((entry) => [entry.name, entry] as const))(
    "%s: the account data its pin names",
    (_name, entry) => {
      const bytes = fixtureBytes(entry.file);
      expect(sha256(bytes)).toBe(entry.sha256);
      expect(bytes.length).toBe(entry.size);
    },
  );

  it("is the registry's Portal, HyperProver and PolymerProver", () => {
    const id = (name: string) => MANIFEST.programs.find((entry) => entry.name === name)!.programId;
    expect(id("portal")).toBe(svmKeyOf(ecoRoutesPortal(solana)));
    expect(id("hyper_prover")).toBe(svmKeyOf(ecoRoutesContract(solana, "HyperProver")));
    expect(id("polymer_prover")).toBe(svmKeyOf(ecoRoutesContract(solana, "PolymerProver")));
  });

  it("holds exactly the files the manifest names, and no endpoint", () => {
    const named = [...MANIFEST.programs, ...MANIFEST.accounts].map((entry) => entry.file);
    expect(
      readdirSync(DIR)
        .filter((file) => file !== "manifest.json")
        .sort(),
    ).toEqual([...named].sort());
    expect(readFileSync(join(DIR, "manifest.json"), "utf8")).not.toMatch(/https?:\/\//);
  });
});
