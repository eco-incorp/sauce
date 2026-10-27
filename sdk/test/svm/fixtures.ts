/**
 * Venue fixture helpers: normalized mainnet account dumps
 * ({ address, owner, base64Data } JSON, one account per file, in
 * sdk/test/svm/fixtures/<slug>/) become an OwnedAccountLoader for fetchPoolConfig,
 * an AccountBytesMap for referenceQuote, and litesvm setAccount arguments
 * (kit EncodedAccount) for the engine-gated suites.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { address, lamports } from "@solana/kit";
import type { Address, EncodedAccount } from "@solana/kit";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  SPL_MINT_SIZE,
  isToken2022Mint,
} from "../../src/svm/token-program.js";
import type {
  AccountBytesMap,
  AccountLoader,
  OwnedAccountLoader,
} from "../../src/svm/venues/types.js";

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

/** OwnedAccountLoader over the fixtures: a fresh data copy and the captured owner for known
 *  addresses, null otherwise. */
export function fixtureLoader(fixtures: AccountFixture[]): OwnedAccountLoader {
  const byAddress = new Map(
    fixtures.map((fixture) => [
      fixture.address,
      { data: fixtureData(fixture), owner: address(fixture.owner) },
    ]),
  );
  return async (addr) => {
    const account = byAddress.get(addr);
    return account === undefined
      ? null
      : { data: new Uint8Array(account.data), owner: account.owner };
  };
}

/** The System Program: the owner {@link ownedByShape} gives an account that is not a mint. */
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

/**
 * A synthetic data-only loader as an OwnedAccountLoader, each account owned as its bytes would be on
 * chain: a Token-2022-shaped mint (the account-type byte at 165) by Token-2022, an 82-byte account
 * by the legacy token program, anything else by the System Program. For hand-built fixtures that
 * carry no owner; a test about an extensionless Token-2022 mint gives the owner itself.
 */
export function ownedByShape(load: AccountLoader): OwnedAccountLoader {
  return async (addr) => {
    const data = await load(addr);
    if (data === null) return null;
    const owner: Address = isToken2022Mint(data)
      ? TOKEN_2022_PROGRAM_ID
      : data.length === SPL_MINT_SIZE
        ? TOKEN_PROGRAM_ID
        : SYSTEM_PROGRAM;
    return { data, owner };
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
