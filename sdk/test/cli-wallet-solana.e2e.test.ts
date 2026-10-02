/**
 * A Solana wallet the `sauce` command made, sending through the released Kitchen and engine in
 * LiteSVM (`svm/engine-harness.ts`, reached through `svm/rpc-shim.ts`, which checks every signature
 * it is sent): `sauce wallet new --solana`, an airdrop, `sauce pot --deploy --wallet`, and `sauce run
 * --wallet` sweeping tokens out of the wallet's Pot — the password from the variable
 * `--password-env` names, here a throwaway one handed to the command's `readEnv`. Then the
 * policy, measured from a simulation that reports the accounts the cook writes: a sweep of more of
 * a mint than its limit is refused, and so is a native limit below the transaction's own fee, each
 * naming its limit, with nothing sent.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { address, getAddressCodec, lamports, type Address } from "@solana/kit";
import { bytesToHex } from "viem";

import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../src/deployments/index.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { derivePotPda } from "../src/svm/index.js";
import {
  describeSvm,
  ENGINE_SO,
  randomAddress,
  setMint,
  setTokenAccount,
  startEngine,
  TOKEN_PROGRAM,
  tokenAmount,
  type EngineHarness,
} from "./svm/engine-harness.js";
import { solanaShim, type SolanaShim } from "./svm/rpc-shim.js";

const RPC_URL = "http://127.0.0.1:65534/";
const KITCHEN = address(v12SvmKitchenProgramId());
const SWEEP = [
  "// @chain solana",
  "function main(tokenProgram: Account, source: Account<Writable>, dest: Account<Writable>, authority: Account<Signer>, amount: Uint256) {",
  "  transfer(MINT, tokenProgram, source, dest, authority, amount);",
  "}",
  "",
].join("\n");

describeSvm("sauce run --wallet on Solana, through the released Kitchen", () => {
  let harness: EngineHarness;
  let shim: SolanaShim;
  let work: string;
  let wallets: string;
  let sweep: string;
  let wallet: Address;
  let pot: Address;
  const mint = randomAddress();
  const mintDefine = `MINT=${bytesToHex(new Uint8Array(getAddressCodec().encode(mint)))}`;
  // A throwaway password, as an agent's .env would hold one.
  const password = `throwaway-${process.pid}-${Date.now()}`;
  const PASSWORD = ["--password-env", "SAUCE_TEST_WALLET_PASSWORD"];

  async function sauce(
    ...argv: string[]
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    let stdout = "";
    let stderr = "";
    const io: CliIo = {
      ...nodeIo(),
      walletsDir: wallets,
      readEnv: (name) => (name === "SAUCE_TEST_WALLET_PASSWORD" ? password : undefined),
      confirm: async () => undefined,
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
    };

    return { code: await runCli(argv, io), stdout, stderr };
  }

  /** A sweep of `amount` from a token account of the Pot holding `held` to a fresh one. */
  const sweepOf = (held: bigint, amount: bigint) => {
    const source = setTokenAccount(harness, randomAddress(), mint, pot, held);
    const dest = setTokenAccount(harness, randomAddress(), mint, randomAddress(), 0n);
    const run = sauce(
      ...["run", sweep, "--chain", "solana", "--define", mintDefine, "--rpc-url", RPC_URL],
      ...["--wallet", "sol", ...PASSWORD],
      ...["--account", `tokenProgram=${TOKEN_PROGRAM}`, "--account", `source=${source}`],
      ...["--account", `dest=${dest}`, "--account", "authority=pot", "--json"],
      ...["--args", amount.toString()],
    );

    return { source, dest, run };
  };

  beforeAll(async () => {
    harness = await startEngine(
      1_700_000_000n,
      ENGINE_SO as string,
      address(v12SvmEngineProgramId()),
    );
    setMint(harness, mint, 6);
    work = mkdtempSync(join(tmpdir(), "sauce-wallet-solana-"));
    wallets = join(work, "wallets");
    sweep = join(work, "sweep.sauce.ts");
    writeFileSync(sweep, SWEEP);
    shim = solanaShim(harness.svm, RPC_URL);
    shim.install();
  }, 120_000);
  afterAll(() => {
    shim?.restore();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  it("creates a Solana wallet, deploys its Pot from it, and sweeps from the Pot", async () => {
    const created = await sauce("wallet", "new", "sol", "--solana", ...PASSWORD, "--json");
    expect(created.code).toBe(0);
    wallet = address((JSON.parse(created.stdout) as { address: string }).address);
    harness.svm.airdrop(wallet, lamports(5_000_000_000n));
    pot = (await derivePotPda(KITCHEN, wallet, new Uint8Array(32))).address;

    const deployed = await sauce(
      ...["pot", "--deploy", "--chain", "solana", "--rpc-url", RPC_URL, "--wallet", "sol"],
      ...PASSWORD,
    );
    expect(deployed.code).toBe(0);
    expect(deployed.stderr).toMatch(/note: wallet sol has no policy, so no limits are set/);
    expect(harness.svm.getAccount(pot).exists).toBe(true);

    const { source, dest, run } = sweepOf(1_000n, 400n);
    const done = await run;
    expect(done.code).toBe(0);
    expect(JSON.parse(done.stdout)).toMatchObject({
      owner: wallet,
      pot,
      cook: { status: "success" },
    });
    expect(tokenAmount(harness, source)).toBe(600n);
    expect(tokenAmount(harness, dest)).toBe(400n);
    // The shim checked every signature: the wallet signed what it sent.
    const last = shim.sent.at(-1)!;
    expect(Object.keys(last.signatures)[0]).toBe(wallet);
    expect(done.stdout + done.stderr + deployed.stderr).not.toContain(password);
  }, 120_000);

  it("refuses a sweep above a mint's limit, and a native limit below the fee, sending nothing", async () => {
    writeFileSync(
      join(wallets, "sol.policy.json"),
      JSON.stringify({ chains: ["solana"], tokens: { [mint]: { perTransaction: "0.0003" } } }),
      { mode: 0o600 },
    );
    const sentBefore = shim.sent.length;
    const over = sweepOf(1_000n, 400n);
    const refused = await over.run;
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(
      new RegExp(
        `refused by the policy of wallet sol \\(.*sol\\.policy\\.json\\): tokens\\.${mint}\\.perTransaction is 0\\.0003 ${mint}, and this transaction sends 0\\.0004 ${mint}`,
      ),
    );
    expect(tokenAmount(harness, over.source)).toBe(1_000n);
    expect(shim.sent.length).toBe(sentBefore);

    // Within the limit, it goes.
    const within = sweepOf(1_000n, 300n);
    expect((await within.run).code).toBe(0);
    expect(tokenAmount(harness, within.dest)).toBe(300n);

    // The fee alone is above a native limit of 1000 lamports.
    writeFileSync(
      join(wallets, "sol.policy.json"),
      JSON.stringify({ native: { perTransaction: "0.000001" } }),
      { mode: 0o600 },
    );
    const sentNow = shim.sent.length;
    const native = await sweepOf(1_000n, 1n).run;
    expect(native.code).toBe(1);
    expect(native.stderr).toMatch(
      /native\.perTransaction is 0\.000001 SOL, and this transaction sends 0\.\d+ SOL/,
    );
    expect(shim.sent.length).toBe(sentNow);
  }, 120_000);
});
