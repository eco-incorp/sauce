/**
 * jupiter-lend-earn Token-2022 self-drop: a synthesized (otherwise valid)
 * Lending account whose underlying `mint` is a Token-2022 mint must make the
 * fetcher REJECT (the graceful self-drop signal). The legacy path (classic
 * mints + a present TokenReserve) is unaffected.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import {
  JUPITER_LEND_EARN_PROGRAM_ID,
  jupiterLendEarn,
  LENDING_ACCOUNT_SIZE,
} from "../../../src/svm/venues/jupiter-lend-earn/index.js";
import { makeT22Mint, makeLegacyMint } from "../fixtures/token-2022/synth.js";

type Owned = { data: Uint8Array; owner: Address };
const t22 = (data: Uint8Array = makeT22Mint()): Owned => ({ data, owner: TOKEN_2022_PROGRAM_ID });
const legacy = (): Owned => ({ data: makeLegacyMint(), owner: TOKEN_PROGRAM_ID });
const program = (data: Uint8Array): Owned => ({ data, owner: JUPITER_LEND_EARN_PROGRAM_ID });

const POOL = address("CcWf5D6BhUTv2tD4ebFFcmCdTUgBWMc8CqqoJvFHGGXi");
const MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC-shaped underlying
const FTOKEN_MINT = address("So11111111111111111111111111111111111111112");
const REWARDS_RATE_MODEL = address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
const LIQ_RESERVE = address("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");
const SUPPLY_POSITION = address("orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE");

const codec = getAddressCodec();
function writePubkey(buf: Uint8Array, off: number, addr: Address): void {
  buf.set(new Uint8Array(codec.encode(addr)), off);
}

function buildLending(): Uint8Array {
  const data = new Uint8Array(LENDING_ACCOUNT_SIZE);
  writePubkey(data, 8, MINT); // OFF_MINT
  writePubkey(data, 40, FTOKEN_MINT); // OFF_F_TOKEN_MINT
  writePubkey(data, 75, REWARDS_RATE_MODEL); // OFF_REWARDS_RATE_MODEL
  writePubkey(data, 131, LIQ_RESERVE); // OFF_TOKEN_RESERVES_LIQUIDITY
  writePubkey(data, 163, SUPPLY_POSITION); // OFF_SUPPLY_POSITION_ON_LIQUIDITY
  return data;
}

/** A TokenReserve account only needs a vault pubkey at offset 40 for this fetch. */
function buildTokenReserve(): Uint8Array {
  const data = new Uint8Array(200);
  writePubkey(data, 40, address("4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R")); // OFF_RESERVE_VAULT
  return data;
}

function loaderFrom(map: Record<string, Owned>): OwnedAccountLoader {
  return async (addr: Address) => map[addr] ?? null;
}

describe("jupiter-lend-earn Token-2022 self-drop", () => {
  it("REJECTS a market whose underlying mint is a Token-2022 mint", async () => {
    const load = loaderFrom({
      [POOL]: program(buildLending()),
      [MINT]: t22(),
      [FTOKEN_MINT]: legacy(),
    });
    await expect(jupiterLendEarn.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("REJECTS a market whose underlying mint is an extensionless (82-byte) Token-2022 mint", async () => {
    const load = loaderFrom({
      [POOL]: program(buildLending()),
      [MINT]: t22(makeLegacyMint()),
      [FTOKEN_MINT]: legacy(),
    });
    await expect(jupiterLendEarn.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("does NOT drop a classic-legacy market", async () => {
    const load = loaderFrom({
      [POOL]: program(buildLending()),
      [MINT]: legacy(),
      [FTOKEN_MINT]: legacy(),
      [LIQ_RESERVE]: program(buildTokenReserve()),
    });
    const cfg = await jupiterLendEarn.fetchPoolConfig(load, POOL);
    expect(cfg.venue).toBe("jupiter-lend-earn");
  });

  it("REJECTS a market whose 82-byte mint is owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    for (const mint of [MINT, FTOKEN_MINT]) {
      const mintAccount = (m: Address): Owned =>
        m === mint ? { data: makeLegacyMint(), owner: foreign } : legacy();
      const load = loaderFrom({
        [POOL]: program(buildLending()),
        [MINT]: mintAccount(MINT),
        [FTOKEN_MINT]: mintAccount(FTOKEN_MINT),
      });
      await expect(jupiterLendEarn.fetchPoolConfig(load, POOL)).rejects.toThrow(
        `token-program: mint ${mint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
      );
    }
  });
});
