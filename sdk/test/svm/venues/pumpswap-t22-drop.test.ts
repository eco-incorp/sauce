/**
 * PumpSwap Token-2022 handling: the base side already resolves its token
 * program per mint (baseTokenProgram / quoteTokenProgram), so a zero-fee /
 * advisory-only Token-2022 base mint must ROUTE (not be dropped), a legacy
 * base mint stays Tokenkeg, and only a genuinely un-routable (NonTransferable /
 * frozen) mint self-drops. A TransferFeeConfig mint stays rejected — fee
 * netting is a documented follow-up (see the TODO(t22-fee-netting) in the
 * adapter), and the rejection is the safe self-limiting behavior.
 */
import { join } from "path";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { pumpswapAdapter } from "../../../src/svm/venues/pumpswap/index.js";
import type { PumpswapPoolConfig } from "../../../src/svm/venues/pumpswap/index.js";
import { fixtureData, fixtureLoader, loadFixtures } from "../fixtures.js";
import type { AccountFixture } from "../fixtures.js";
import {
  makeT22Mint,
  makeLegacyMint,
  tlvEntry,
  NON_TRANSFERABLE_TLV,
} from "../fixtures/token-2022/synth.js";

const POOL = address("2uF4Xh61rDwxnG9woyxsVQP7zuA6kLFpb3NvnRQeoiSd");
const PUMP_MINT = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn"; // base mint (real fixture is Token-2022)
const TOKENKEG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const FIXTURE_DIR = join(process.cwd(), "test", "svm", "fixtures", "pumpswap");

/** The real fixture set with the base (PUMP) mint account overwritten. */
function withBaseMint(bytes: Uint8Array, owner = TOKEN_2022): AccountFixture[] {
  return loadFixtures(FIXTURE_DIR).map((f) =>
    f.address === PUMP_MINT
      ? { ...f, owner, base64Data: Buffer.from(bytes).toString("base64") }
      : f,
  );
}

describe("pumpswap Token-2022 handling", () => {
  it("routes a zero-fee (extensionless) Token-2022 base mint; quote side stays legacy", async () => {
    const cfg = await pumpswapAdapter.fetchPoolConfig(
      fixtureLoader(withBaseMint(makeT22Mint())),
      POOL,
    );
    expect(cfg.baseTokenProgram).toBe(TOKEN_2022);
    expect(cfg.quoteTokenProgram).toBe(TOKENKEG); // USDC quote mint — unchanged
  });

  it("routes the real (advisory-only) Token-2022 base mint fixture unchanged", async () => {
    const cfg = await pumpswapAdapter.fetchPoolConfig(
      fixtureLoader(loadFixtures(FIXTURE_DIR)),
      POOL,
    );
    expect(cfg.baseTokenProgram).toBe(TOKEN_2022);
    expect(cfg.quoteTokenProgram).toBe(TOKENKEG);
  });

  it("drops the pool when the base mint carries a blocking NonTransferable extension", async () => {
    const load = fixtureLoader(withBaseMint(makeT22Mint(NON_TRANSFERABLE_TLV)));
    await expect(pumpswapAdapter.fetchPoolConfig(load, POOL)).rejects.toThrow(/un-routable/);
  });

  it("still rejects a TransferFeeConfig base mint (fee-netting is a documented follow-up)", async () => {
    const load = fixtureLoader(withBaseMint(makeT22Mint(tlvEntry(1, new Uint8Array(108)))));
    await expect(pumpswapAdapter.fetchPoolConfig(load, POOL)).rejects.toThrow(/TransferFeeConfig/);
  });

  it("a legacy 82-byte base mint routes as Tokenkeg (byte-identical legacy path)", async () => {
    const cfg = await pumpswapAdapter.fetchPoolConfig(
      fixtureLoader(withBaseMint(makeLegacyMint(), TOKENKEG)),
      POOL,
    );
    expect(cfg.baseTokenProgram).toBe(TOKENKEG);
    expect(cfg.quoteTokenProgram).toBe(TOKENKEG);
  });

  it("an extensionless (82-byte) Token-2022-owned base mint routes as Token-2022, by its owner", async () => {
    const cfg = await pumpswapAdapter.fetchPoolConfig(
      fixtureLoader(withBaseMint(makeLegacyMint(), TOKEN_2022)),
      POOL,
    );
    expect(cfg.baseTokenProgram).toBe(TOKEN_2022);
    expect(cfg.quoteTokenProgram).toBe(TOKENKEG);
  });

  it("refuses the pool when an 82-byte mint is owned by neither token program", async () => {
    const foreign = "11111111111111111111111111111111";
    await expect(
      pumpswapAdapter.fetchPoolConfig(fixtureLoader(withBaseMint(makeLegacyMint(), foreign)), POOL),
    ).rejects.toThrow(
      `token-program: mint ${PUMP_MINT} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
    );
    await expect(
      pumpswapAdapter.fetchPoolConfig(
        fixtureLoader(withQuoteMint(makeLegacyMint(), foreign)),
        POOL,
      ),
    ).rejects.toThrow(
      `token-program: mint ${USDC_MINT} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
    );
  });
});

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // quote mint (real fixture is legacy)
const PUMPSWAP_PROGRAM = address("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const GLOBAL_CONFIG = "ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw";
const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

/** The fixture set with the quote (USDC) mint account overwritten. */
function withQuoteMint(bytes: Uint8Array, owner: string): AccountFixture[] {
  return loadFixtures(FIXTURE_DIR).map((f) =>
    f.address === USDC_MINT
      ? { ...f, owner, base64Data: Buffer.from(bytes).toString("base64") }
      : f,
  );
}

/** An associated token account, derived here from its seeds rather than by the adapter's helper. */
async function expectedAta(owner: string, tokenProgram: string, mint: string): Promise<string> {
  const [derived] = await getProgramDerivedAddress({
    programAddress: ATA_PROGRAM,
    seeds: [
      addressEncoder.encode(address(owner)),
      addressEncoder.encode(address(tokenProgram)),
      addressEncoder.encode(address(mint)),
    ],
  });
  return derived;
}

function fixtureBytes(fixtures: AccountFixture[], target: string): Uint8Array {
  const found = fixtures.find((f) => f.address === target);
  if (found === undefined) throw new Error(`fixture ${target} missing`);
  return fixtureData(found);
}

/** The three quote-side ATAs from the pool and global-config bytes, under `quoteProgram`. */
async function independentQuoteAtas(fixtures: AccountFixture[], quoteProgram: string) {
  const pool = fixtureBytes(fixtures, POOL);
  const globalConfig = fixtureBytes(fixtures, GLOBAL_CONFIG);
  const protocolFeeRecipient = addressDecoder.decode(globalConfig.slice(57, 89));
  const buybackFeeRecipient = addressDecoder.decode(globalConfig.slice(643, 675));
  const coinCreatorBytes = pool.length >= 243 ? pool.slice(211, 243) : new Uint8Array(32);
  const [creatorVaultAuthority] = await getProgramDerivedAddress({
    programAddress: PUMPSWAP_PROGRAM,
    seeds: ["creator_vault", coinCreatorBytes],
  });
  return {
    protocolFeeRecipientTokenAccount: await expectedAta(
      protocolFeeRecipient,
      quoteProgram,
      USDC_MINT,
    ),
    coinCreatorVaultAta: await expectedAta(creatorVaultAuthority, quoteProgram, USDC_MINT),
    buybackFeeRecipientTokenAccount: await expectedAta(
      buybackFeeRecipient,
      quoteProgram,
      USDC_MINT,
    ),
  };
}

describe("pumpswap quote-side token program follows the quote mint's owner", () => {
  const user = { owner: "UserOwner", inAta: "UserQuoteAta", outAta: "UserBaseAta" };

  it("derives all three quote-side ATAs under Token-2022 and wires both program slots for an 82-byte Token-2022-owned quote mint", async () => {
    const fixtures = withQuoteMint(makeLegacyMint(), TOKEN_2022);
    const cfg = await pumpswapAdapter.fetchPoolConfig(fixtureLoader(fixtures), POOL);
    expect(cfg.baseTokenProgram).toBe(TOKEN_2022); // PUMP base mint is Token-2022 in the fixture
    expect(cfg.quoteTokenProgram).toBe(TOKEN_2022);

    const expected = await independentQuoteAtas(fixtures, TOKEN_2022);
    const legacy = await independentQuoteAtas(fixtures, TOKENKEG);
    // The program seed matters: the two derivations are different addresses.
    expect(expected.protocolFeeRecipientTokenAccount).not.toBe(
      legacy.protocolFeeRecipientTokenAccount,
    );
    expect(expected.coinCreatorVaultAta).not.toBe(legacy.coinCreatorVaultAta);
    expect(expected.buybackFeeRecipientTokenAccount).not.toBe(
      legacy.buybackFeeRecipientTokenAccount,
    );
    expect(cfg.protocolFeeRecipientTokenAccount).toBe(expected.protocolFeeRecipientTokenAccount);
    expect(cfg.coinCreatorVaultAta).toBe(expected.coinCreatorVaultAta);
    expect(cfg.buybackFeeRecipientTokenAccount).toBe(expected.buybackFeeRecipientTokenAccount);

    for (const direction of ["quoteToBase", "baseToQuote"] as const) {
      const sided: PumpswapPoolConfig = { ...cfg, direction };
      const swap = pumpswapAdapter.buildSwap(sided, user, 1_000_000n);
      const refs = swap.accounts.map((a) => a.ref);
      expect(refs[11]).toBe(TOKEN_2022); // base_token_program, unchanged
      expect(refs[12]).toBe(TOKEN_2022); // quote_token_program
      expect(refs[10]).toBe(expected.protocolFeeRecipientTokenAccount);
      expect(refs[17]).toBe(expected.coinCreatorVaultAta);
      expect(refs[refs.length - 1]).toBe(expected.buybackFeeRecipientTokenAccount);
    }
  });

  it("keeps Tokenkeg in the quote slot and ATAs for a legacy-owned 82-byte quote mint (control)", async () => {
    const fixtures = withQuoteMint(makeLegacyMint(), TOKENKEG);
    const cfg = await pumpswapAdapter.fetchPoolConfig(fixtureLoader(fixtures), POOL);
    expect(cfg.baseTokenProgram).toBe(TOKEN_2022);
    expect(cfg.quoteTokenProgram).toBe(TOKENKEG);

    const expected = await independentQuoteAtas(fixtures, TOKENKEG);
    expect(cfg.protocolFeeRecipientTokenAccount).toBe(expected.protocolFeeRecipientTokenAccount);
    expect(cfg.coinCreatorVaultAta).toBe(expected.coinCreatorVaultAta);
    expect(cfg.buybackFeeRecipientTokenAccount).toBe(expected.buybackFeeRecipientTokenAccount);

    for (const direction of ["quoteToBase", "baseToQuote"] as const) {
      const sided: PumpswapPoolConfig = { ...cfg, direction };
      const swap = pumpswapAdapter.buildSwap(sided, user, 1_000_000n);
      const refs = swap.accounts.map((a) => a.ref);
      expect(refs[11]).toBe(TOKEN_2022);
      expect(refs[12]).toBe(TOKENKEG);
      expect(refs[10]).toBe(expected.protocolFeeRecipientTokenAccount);
      expect(refs[17]).toBe(expected.coinCreatorVaultAta);
      expect(refs[refs.length - 1]).toBe(expected.buybackFeeRecipientTokenAccount);
    }
  });
});
