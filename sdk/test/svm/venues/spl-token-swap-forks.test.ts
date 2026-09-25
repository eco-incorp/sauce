/**
 * spl-token-swap-forks Account-model migration unit (RS/WASM compile, no engine):
 * the emitQuote fragment now reads the two pool vault balances through the Account
 * model — `svm.sload(acc<k>, 64, 8).toLe()` over main()'s positional `acc<k>`
 * params — instead of the TS compiler's `accountUint("<ref>", 64, 8)` string-ref
 * sugar. quoteAccounts() order is [vault-in, vault-out], so vault-in is slot 0
 * (acc0) and vault-out slot 1 (acc1); the emitted manifest binds each slot back
 * to that vault address in the same order.
 *
 * The math (constant-product with baked-in fees) is shared across all six forks
 * (see the module header); this exercises the token-swap-v1 instantiation with a
 * hand-built config — the migration transform is identical for every fork.
 */
import { address } from "@solana/kit";
import { compileSvm, wrapQuoteMain } from "../rs-compile.js";
import {
  tokenSwapV1,
  TOKEN_SWAP_V1_PROGRAM_ID,
} from "../../../src/svm/venues/spl-token-swap-forks/index.js";
import type { SplTokenSwapForkPoolConfig } from "../../../src/svm/venues/spl-token-swap-forks/index.js";

const POOL = address("9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP");
const VAULT_IN = address("CfWX7o2TswwbxusJ4hCaPobu2jLCb1hfXuXJQjVq3jQF");
const VAULT_OUT = address("EnTrdMMpdhugeH6Ban6gYZWXughWxKtVGfCwFn78ZmY3");
const MISC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const cfg: SplTokenSwapForkPoolConfig = {
  venue: "token-swap-v1",
  pool: POOL,
  swapAuthority: MISC,
  tokenProgram: TOKEN_PROGRAM,
  vaultIn: VAULT_IN,
  vaultOut: VAULT_OUT,
  poolMint: MISC,
  inputMint: MISC,
  outputMint: MISC,
  poolFeeAccount: MISC,
  tradeFeeNumerator: 25n,
  tradeFeeDenominator: 10_000n,
  ownerTradeFeeNumerator: 5n,
  ownerTradeFeeDenominator: 10_000n,
  bumpSeed: 255,
};

describe("spl-token-swap-forks emitQuote — Account model (svm.sload) via RS", () => {
  it("reads vault-in via acc0 and vault-out via acc1", () => {
    const fragment = tokenSwapV1.emitQuote(cfg, 0, 1_000_000_000n);
    expect(fragment).toContain("const rIn0 = svm.sload(acc0, 64, 8).toLe();");
    expect(fragment).toContain("const rOut0 = svm.sload(acc1, 64, 8).toLe();");
    expect(fragment).not.toContain("accountUint(");
  });

  it("compiles for the svm target and manifests the two vaults in quoteAccounts order", () => {
    expect(tokenSwapV1.programId).toBe(TOKEN_SWAP_V1_PROGRAM_ID);
    const fragment = tokenSwapV1.emitQuote(cfg, 0, 1_000_000_000n);
    const accounts = tokenSwapV1.quoteAccounts(cfg); // ordered [vault-in, vault-out]
    const { bytecode, manifest } = compileSvm(wrapQuoteMain(accounts.length, fragment, "q0"));
    expect(bytecode.length).toBeGreaterThan(0);
    expect(manifest?.accounts).toEqual([
      { kind: "slot", index: 0, name: "acc0", requires: "readonly" },
      { kind: "slot", index: 1, name: "acc1", requires: "readonly" },
    ]);
    const boundAddresses = manifest?.accounts.map((meta) =>
      meta.kind === "slot" ? accounts[meta.index]?.address : undefined,
    );
    expect(boundAddresses).toEqual([VAULT_IN, VAULT_OUT]);
  });
});
