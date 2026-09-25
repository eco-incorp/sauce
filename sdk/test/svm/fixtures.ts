/**
 * Venue fixture helpers: normalized mainnet account dumps
 * ({ address, owner, base64Data } JSON, one account per file, in
 * sdk/test/svm/fixtures/<slug>/) become an AccountLoader for fetchPoolConfig,
 * an AccountBytesMap for referenceQuote, and litesvm setAccount arguments
 * (kit EncodedAccount) for the engine-gated suites.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { address, lamports } from "@solana/kit";
import type { EncodedAccount } from "@solana/kit";
import type { AccountBytesMap, AccountLoader } from "../../src/svm/index.js";

export interface AccountFixture {
  /** Base58 account address. */
  address: string;
  /** Base58 owner program id. */
  owner: string;
  /** Raw account data, standard base64. */
  base64Data: string;
}

export function fixtureData(fixture: AccountFixture): Uint8Array {
  return new Uint8Array(Buffer.from(fixture.base64Data, "base64"));
}

/** Reads every *.json under dir (sorted by name) as one AccountFixture each. */
export function loadFixtures(dir: string): AccountFixture[] {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  return names.map((name) => {
    const parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
    for (const field of ["address", "owner", "base64Data"] as const) {
      if (typeof parsed[field] !== "string") {
        throw new Error(`fixture ${name} is missing string field '${field}'`);
      }
    }
    return { address: parsed.address, owner: parsed.owner, base64Data: parsed.base64Data };
  });
}

/** AccountLoader over the fixtures: a fresh data copy for known addresses, null otherwise. */
export function fixtureLoader(fixtures: AccountFixture[]): AccountLoader {
  const byAddress = new Map(fixtures.map((fixture) => [fixture.address, fixtureData(fixture)]));
  return async (addr) => {
    const data = byAddress.get(addr);
    return data === undefined ? null : new Uint8Array(data);
  };
}

/** referenceQuote state map: base58 address → account data. */
export function fixtureBytesMap(fixtures: AccountFixture[]): AccountBytesMap {
  const map: AccountBytesMap = {};
  for (const fixture of fixtures) map[fixture.address] = fixtureData(fixture);
  return map;
}

// LiteSVM boots the standard Rent sysvar (3480 lamports per byte-year, 2-year
// exemption threshold, 128-byte per-account overhead) — baking the rent-exempt
// minimum keeps callers from needing the svm instance to build the accounts.
const rentExempt = (space: bigint): bigint => (128n + space) * 3480n * 2n;

/** litesvm setAccount argument per fixture (rent-exempt, non-executable). */
export function fixtureAccounts(fixtures: AccountFixture[]): EncodedAccount[] {
  return fixtures.map((fixture) => {
    const data = fixtureData(fixture);
    const space = BigInt(data.length);
    return {
      address: address(fixture.address),
      data,
      executable: false,
      lamports: lamports(rentExempt(space)),
      programAddress: address(fixture.owner),
      space,
    };
  });
}
