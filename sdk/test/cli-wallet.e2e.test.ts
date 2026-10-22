/**
 * A wallet the `sauce` command made, sending through the released gated stack on a local anvil
 * (`cli-anvil.ts`): `sauce wallet new`, funded from a dev account, then `sauce run --wallet`
 * deploying its Pot and cooking on it — the password read from the variable `--password-env`
 * names, here a throwaway one the test hands the command's `readEnv`. The wallet's file signs as a
 * plain `--keystore` too. Then its policy: a cook that sends more than a limit is refused naming
 * it, with nothing sent; the day's total is counted from the ledger across runs; a chain the policy
 * does not name is refused.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite (CLAUDE.md), and a hard
 * failure without it in CI.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, parseEther, type Address, type Hex } from "viem";

import { DEFAULT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";
import {
  describeEvm,
  fixture,
  potOwner,
  registered,
  sauceWith,
  startChain,
  type LocalChain,
} from "./cli-anvil.js";

const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const PAY = [
  "function main(recipient: Address, amount: Uint256) {",
  "  USDC.transfer(recipient, amount);",
  "}",
  "",
].join("\n");

describeEvm("sauce run --wallet, through the released gated stack", () => {
  let base: LocalChain;
  let work: string;
  let wallets: string;
  let usdc: Address;
  let wallet: Address;
  let pot: Address;
  let program: string;
  // A throwaway password, as an agent's .env would hold one; never a real one.
  const password = `throwaway-${process.pid}-${Date.now()}`;
  const env = (name: string) => (name === "SAUCE_TEST_WALLET_PASSWORD" ? password : undefined);
  const sauce = (...argv: string[]) => sauceWith({ readEnv: env, walletsDir: wallets }, ...argv);
  const PASSWORD = ["--password-env", "SAUCE_TEST_WALLET_PASSWORD"];
  const run = (amount: bigint, ...more: string[]) =>
    sauce(
      ...["run", program, "--chain", "base", "--rpc-url", base.rpcUrl],
      ...["--wallet", "agent", ...PASSWORD, ...more, "--json"],
      ...["--args", RECIPIENT, amount.toString()],
    );

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-wallet-e2e-"));
    wallets = join(work, "wallets");
    program = join(work, "pay.sauce.ts");
    writeFileSync(program, PAY);
    base = await startChain("base");
    usdc = await base.plant(fixture("MockERC20"), registered(base.chain, "USDC"));
  }, 120_000);
  afterAll(async () => {
    await base?.stop();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  it("creates a wallet, and with no policy deploys its Pot and cooks, saying no limits are set", async () => {
    const created = await sauce("wallet", "new", "agent", ...PASSWORD, "--json");
    expect(created.code).toBe(0);
    wallet = getAddress((JSON.parse(created.stdout) as { address: string }).address);
    pot = v12PredictPot(wallet, DEFAULT_POT_SALT) as Address;
    await base.send(base.deployer, wallet, "0x", parseEther("1"));
    await base.mint(usdc, pot, 10_000_000n);

    const sent = await run(1_000_000n, "--auto-approve");
    expect(sent.stderr).toContain("auto-approved: deploy Pot");
    expect(sent.code).toBe(0);
    expect(sent.stderr).toMatch(/note: wallet agent has no policy, so no limits are set/);
    const out = JSON.parse(sent.stdout) as { from: string; pot: string; cook: { hash: Hex } };
    expect(out).toMatchObject({ from: wallet, pot });
    const receipt = await base.publicClient.getTransactionReceipt({ hash: out.cook.hash });
    expect(getAddress(receipt.from)).toBe(wallet);
    expect(await potOwner(base, pot)).toBe(wallet);
    expect(await base.balanceOf(usdc, RECIPIENT)).toBe(1_000_000n);
    expect(sent.stdout + sent.stderr).not.toContain(password);
  }, 120_000);

  it("signs as a plain --keystore too: the wallet's file is a v3 keystore", async () => {
    const passwordFile = join(work, "password");
    writeFileSync(passwordFile, password, { mode: 0o600 });
    const sent = await sauce(
      ...["run", program, "--chain", "base", "--rpc-url", base.rpcUrl],
      ...["--keystore", join(wallets, "agent.json"), "--password-file", passwordFile, "--json"],
      ...["--args", RECIPIENT, "1000000"],
    );
    expect(sent.code).toBe(0);
    expect(JSON.parse(sent.stdout)).toMatchObject({ from: wallet, cook: { status: "success" } });
    expect(await base.balanceOf(usdc, RECIPIENT)).toBe(2_000_000n);
  }, 120_000);

  it("refuses, sending nothing, a cook above the policy's limit, and counts the day", async () => {
    writeFileSync(
      join(wallets, "agent.policy.json"),
      JSON.stringify({
        chains: ["base"],
        tokens: { USDC: { perTransaction: "1", perDay: "1.5" } },
      }),
      { mode: 0o600 },
    );
    const nonce = await base.publicClient.getTransactionCount({ address: wallet });
    const over = await run(2_000_000n);
    expect(over.code).toBe(1);
    expect(over.stderr).toMatch(
      /refused by the policy of wallet agent \(.*agent\.policy\.json\): tokens\.USDC\.perTransaction is 1 USDC, and this transaction sends 2 USDC/,
    );
    expect(await base.publicClient.getTransactionCount({ address: wallet })).toBe(nonce);

    const within = await run(1_000_000n);
    expect(within.code).toBe(0);
    expect(within.stderr).not.toMatch(/no limits are set/);
    expect(await base.balanceOf(usdc, RECIPIENT)).toBe(3_000_000n);
    const ledger = readFileSync(join(wallets, "agent.ledger.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { state: string; spend?: Record<string, unknown> });
    expect(ledger.map((line) => line.state)).toEqual(["reserved", "sent"]);
    expect(ledger[0]!.spend).toEqual({ "tokens.USDC": { amount: "1000000", decimals: 6 } });

    const again = await run(1_000_000n);
    expect(again.code).toBe(1);
    expect(again.stderr).toMatch(
      /tokens\.USDC\.perDay is 1\.5 USDC; 1 USDC went in the last 24 hours, and this transaction sends 1 USDC/,
    );
    expect(await base.balanceOf(usdc, RECIPIENT)).toBe(3_000_000n);
  }, 120_000);

  it("refuses a chain the policy does not name", async () => {
    writeFileSync(join(wallets, "agent.policy.json"), JSON.stringify({ chains: ["ethereum"] }), {
      mode: 0o600,
    });
    const nonce = await base.publicClient.getTransactionCount({ address: wallet });
    const refused = await run(1n);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/chains allows ethereum, and this transaction is on base/);
    expect(await base.publicClient.getTransactionCount({ address: wallet })).toBe(nonce);
  }, 120_000);

  it("deploys its own Pot under a policy whose `to` allows that Pot, and refuses it otherwise", async () => {
    const created = await sauce("wallet", "new", "builder", ...PASSWORD, "--json");
    expect(created.code).toBe(0);
    const builder = getAddress((JSON.parse(created.stdout) as { address: string }).address);
    const builderPot = getAddress(v12PredictPot(builder, DEFAULT_POT_SALT) as Address);
    await base.send(base.deployer, builder, "0x", parseEther("1"));
    await base.mint(usdc, builderPot, 1_000_000n);
    const policy = join(wallets, "builder.policy.json");
    const build = () =>
      sauce(
        ...["run", program, "--chain", "base", "--rpc-url", base.rpcUrl],
        ...["--wallet", "builder", ...PASSWORD, "--yes", "--json"],
        ...["--args", RECIPIENT, "500000"],
      );
    // `to` names another address: the deploy is refused before anything is sent, naming the Pot.
    writeFileSync(policy, JSON.stringify({ to: [RECIPIENT] }), { mode: 0o600 });
    const refused = await build();
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(
      `this transaction deploys the wallet's Pot ${builderPot}, which is not one of them: add ` +
        "it to to",
    );
    expect(await base.publicClient.getTransactionCount({ address: builder })).toBe(0);
    expect(await base.publicClient.getCode({ address: builderPot })).toBeUndefined();
    // `to` names the Pot: deploying it is allowed, as cooking on it is, though the Kitchen is not.
    writeFileSync(policy, JSON.stringify({ to: [builderPot] }), { mode: 0o600 });
    const sent = await build();
    expect(sent.code).toBe(0);
    expect(JSON.parse(sent.stdout)).toMatchObject({
      pot: builderPot,
      deployPot: { status: "success" },
      cook: { status: "success" },
    });
    expect(await potOwner(base, builderPot)).toBe(builder);
  }, 120_000);
});
