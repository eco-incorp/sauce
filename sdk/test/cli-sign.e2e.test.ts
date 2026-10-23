/**
 * `sauce sign` on a local anvil running the released gated stack (`cli-anvil.ts`, the Kitchen's fee
 * set non-zero): the owner signs with the chain read, ANOTHER account submits the cook — signed by
 * it and broadcast with `sauce send`, or sent with viem — and the program runs as the Pot, which
 * pays the Kitchen's fee; a Pot with no code yet comes with its `deployPot`, sent first by that other
 * account; and `--cancel` sends the owner's `invalidateNonces`, after which the earlier signature
 * reverts with NonceUsed. The fields and their encoding are `cli-sign.test.ts`'s, offline.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeFunctionData, getAddress, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { potSalt, v12PredictPot } from "../src/deployments/pot.js";
import { cookNonceUsed, v12PotAbi } from "../src/evm/engine.js";
import {
  DEPLOYER,
  deployPot,
  describeEvm,
  FEE,
  fixture,
  jsonOf,
  OTHER_KEY,
  OWNER,
  OWNER_KEY,
  potOwner,
  registered,
  sauce,
  startChain,
  type LocalChain,
} from "./cli-anvil.js";

const RECIPIENT = getAddress("0x6666666666666666666666666666666666666666");
const OTHER = privateKeyToAccount(OTHER_KEY);
const SOURCE = `function main(recipient: Address, amount: Uint256): void {
  USDC.transfer(recipient, amount);
}
`;

interface Signed {
  pot: Address;
  owner?: Address;
  value: string;
  maxExecutionFee: string;
  nonce: string;
  submitter: Address;
  signature?: Hex;
  cook?: { chainId: number; to: Address; data: Hex; value: Hex };
  deployPot?: { chainId: number; to: Address; data: Hex; value: Hex };
}

describeEvm("sauce sign, submitted by another account", () => {
  let base: LocalChain;
  let usdc: Address;
  let pot: Address;
  let work: string;
  let file: string;

  /** The owner's `sauce sign` of the payment, with the chain read. */
  const sign = async (...extra: string[]): Promise<Signed> =>
    jsonOf(
      await sauce(
        ...["sign", file, "--chain", "base", "--private-key", OWNER_KEY],
        ...["--rpc-url", base.rpcUrl, "--json", ...extra],
      ),
    ) as unknown as Signed;

  /** Submitting `cook` from `from` as it stands now: it succeeds, its output answered raw. */
  const submit = (cook: NonNullable<Signed["cook"]>, from: Address) =>
    base.publicClient.call({
      account: from,
      to: cook.to,
      data: cook.data,
      value: BigInt(cook.value),
    });

  /** The same, refused: rejects naming the Pot's error. */
  const refused = (cook: NonNullable<Signed["cook"]>, from: Address) => {
    const { args } = decodeFunctionData({ abi: v12PotAbi, data: cook.data });

    return base.publicClient.simulateContract({
      address: cook.to,
      abi: v12PotAbi,
      functionName: "cookSigned",
      args: args as never,
      value: BigInt(cook.value),
      account: from,
    });
  };

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-sign-e2e-"));
    file = join(work, "pay.sauce.ts");
    writeFileSync(file, SOURCE);
    base = await startChain("base");
    usdc = await base.plant(fixture("MockERC20"), registered(base.chain, "USDC"));
    pot = await deployPot(base);
    await base.mint(usdc, pot, 10_000_000n);
    // The Pot pays the Kitchen's fee from its own balance, for each cook it runs.
    await base.testClient.setBalance({ address: pot, value: 10n * FEE });
  }, 120_000);

  afterAll(async () => {
    await base?.stop();
    rmSync(work, { recursive: true, force: true });
  });

  it("is signed by the owner, sent by another account with sauce send, and runs as the Pot", async () => {
    const run = await sauce(
      ...["sign", file, "--chain", "base", "--private-key", OWNER_KEY, "--rpc-url", base.rpcUrl],
      ...["--submitter", DEPLOYER.address, "--json", "--args", RECIPIENT, "1000000"],
    );
    const signed = jsonOf(run) as unknown as Signed;
    // The fee ceiling is the Kitchen's fee, read; the Pot is the owner's, deployed.
    expect(signed).toMatchObject({
      pot,
      owner: OWNER.address,
      value: "0",
      maxExecutionFee: FEE.toString(),
      submitter: DEPLOYER.address,
    });
    expect(signed.deployPot).toBeUndefined();
    expect(run.stderr).toContain(`the fee is ${FEE} wei`);
    expect(run.stderr).toContain(`the Pot holds ${10n * FEE} wei`);
    const cook = signed.cook!;

    // Only the submitter it names may send it.
    await expect(refused(cook, OTHER.address)).rejects.toThrow(/WrongSubmitter/);
    await submit(cook, DEPLOYER.address);

    // The submitter signs it with its own key and broadcasts it: no key of the owner's is near.
    const fees = await base.publicClient.estimateFeesPerGas();
    const gas = await base.publicClient.estimateGas({
      account: DEPLOYER.address,
      to: cook.to,
      data: cook.data,
      value: BigInt(cook.value),
    });
    const raw = await DEPLOYER.signTransaction({
      chainId: base.chain.id,
      type: "eip1559",
      to: cook.to,
      data: cook.data,
      value: BigInt(cook.value),
      nonce: await base.publicClient.getTransactionCount({ address: DEPLOYER.address }),
      gas: gas * 2n,
      maxFeePerGas: fees.maxFeePerGas * 2n,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    const sent = jsonOf(await sauce("send", raw, "--rpc-url", base.rpcUrl, "--json")) as {
      ok: boolean;
      sent: Array<{ what: string; status: string; hash: Hex; from: Address; moves?: unknown }>;
    };
    expect(sent.ok).toBe(true);
    expect(sent.sent[0]).toMatchObject({
      what: `signed cook on Pot ${pot}`,
      status: "success",
      from: DEPLOYER.address,
    });
    expect(sent.sent[0]!.moves).toEqual(expect.arrayContaining([expect.any(Object)]));

    // The program ran as the Pot: its USDC moved, and the Pot paid the Kitchen's fee.
    expect(await base.balanceOf(usdc, RECIPIENT)).toBe(1_000_000n);
    expect(await base.balanceOf(usdc, pot)).toBe(9_000_000n);
    expect(await base.publicClient.getBalance({ address: pot })).toBe(9n * FEE);
    const receipt = await base.publicClient.getTransactionReceipt({ hash: sent.sent[0]!.hash });
    const [event] = parseEventLogs({ abi: v12PotAbi, logs: receipt.logs, eventName: "SignedCook" });
    expect(getAddress(event!.address)).toBe(pot);
    expect(event!.args).toEqual({ nonce: BigInt(signed.nonce), submitter: DEPLOYER.address });
    expect(await cookNonceUsed(base.publicClient, pot, BigInt(signed.nonce))).toBe(true);

    // sauce inspect reads the landed cook back, and checks the signature is the owner's.
    const inspected = jsonOf(
      await sauce(
        "inspect",
        sent.sent[0]!.hash,
        "--chain",
        "base",
        "--rpc-url",
        base.rpcUrl,
        "--json",
      ),
    );
    expect(inspected).toMatchObject({
      call: "Pot.cookSigned",
      from: DEPLOYER.address,
      to: pot,
      nonce: signed.nonce,
      submitter: DEPLOYER.address,
      owner: OWNER.address,
      signedByOwner: true,
    });

    // It runs once.
    await expect(refused(cook, DEPLOYER.address)).rejects.toThrow(/NonceUsed/);
  }, 120_000);

  it("comes with deployPot for a Pot with no code, sent first by any account, then the cook", async () => {
    const fresh = getAddress(v12PredictPot(OWNER.address, potSalt("signed-fresh")));
    expect(await base.publicClient.getCode({ address: fresh })).toBeUndefined();
    const run = await sauce(
      ...["sign", file, "--chain", "base", "--private-key", OWNER_KEY, "--salt", "signed-fresh"],
      ...["--rpc-url", base.rpcUrl, "--json", "--args", RECIPIENT, "2000000"],
    );
    const signed = jsonOf(run) as unknown as Signed;
    expect(signed.pot).toBe(fresh);
    expect(signed.deployPot).toMatchObject({ chainId: base.chain.id, value: "0x0" });
    expect(run.stderr).toContain(`Pot ${fresh} has no code yet: send deployPot first`);
    // An unfunded Pot is warned of: neither its balance nor the value covers the fee.
    expect(run.stderr).toContain("do not cover the Kitchen's fee");

    // Funded at its address before it exists; then another account deploys it and submits.
    await base.mint(usdc, fresh, 2_000_000n);
    await base.testClient.setBalance({ address: fresh, value: FEE });
    const before = await base.balanceOf(usdc, RECIPIENT);
    await base.send(base.deployer, signed.deployPot!.to, signed.deployPot!.data);
    expect(await potOwner(base, fresh)).toBe(OWNER.address);
    await base.send(base.deployer, signed.cook!.to, signed.cook!.data, BigInt(signed.cook!.value));
    expect(await base.balanceOf(usdc, RECIPIENT)).toBe(before + 2_000_000n);
    expect(await base.publicClient.getBalance({ address: fresh })).toBe(0n);
  }, 120_000);

  it("--cancel sends the owner's invalidateNonces, and the signature then reverts NonceUsed", async () => {
    const signed = await sign("--nonce", "42", "--args", RECIPIENT, "1");
    expect(signed.nonce).toBe("42");
    // Submittable now, by anyone.
    await submit(signed.cook!, OTHER.address);

    // Only the owner cancels: another key is refused before anything is sent.
    const stranger = await sauce(
      ...["sign", "--cancel", "42", "--chain", "base", "--pot", pot, "--private-key", OTHER_KEY],
      ...["--rpc-url", base.rpcUrl],
    );
    expect(stranger.code).toBe(1);
    expect(stranger.stderr).toContain(`does not own Pot ${pot}`);
    expect(await cookNonceUsed(base.publicClient, pot, 42n)).toBe(false);

    const sentCancel = await sauce(
      ...["sign", "--cancel", "42", "--chain", "base", "--private-key", OWNER_KEY],
      ...["--rpc-url", base.rpcUrl, "--json"],
    );
    // --json changes what a sent cancellation prints: its JSON, where the text is its receipt.
    expect(sentCancel.stdout.trimStart().startsWith("{")).toBe(true);
    const cancelled = jsonOf(sentCancel) as {
      pot: Address;
      from: Address;
      sent: Array<{ status: string; word: string; mask: string; hash: Hex }>;
    };
    expect(cancelled).toMatchObject({ pot, from: OWNER.address });
    expect(cancelled.sent).toHaveLength(1);
    expect(cancelled.sent[0]).toMatchObject({
      status: "success",
      word: "0",
      mask: String(1n << 42n),
    });
    const receipt = await base.publicClient.getTransactionReceipt({
      hash: cancelled.sent[0]!.hash,
    });
    const [event] = parseEventLogs({
      abi: v12PotAbi,
      logs: receipt.logs,
      eventName: "NoncesInvalidated",
    });
    expect(event!.args).toEqual({ word: 0n, mask: 1n << 42n });
    expect(await cookNonceUsed(base.publicClient, pot, 42n)).toBe(true);
    await expect(refused(signed.cook!, OTHER.address)).rejects.toThrow(/NonceUsed/);

    // Without --json a sent cancellation prints its receipt, one line per transaction, not JSON.
    const receiptText = await sauce(
      ...["sign", "--cancel", "43", "--chain", "base", "--private-key", OWNER_KEY],
      ...["--rpc-url", base.rpcUrl],
    );
    expect(receiptText.code).toBe(0);
    expect(receiptText.stdout.trimStart().startsWith("{")).toBe(false);
    expect(receiptText.stdout).toMatch(/: 0x[0-9a-f]{64} success, gas used \d+, block \d+/);
    expect(await cookNonceUsed(base.publicClient, pot, 43n)).toBe(true);
  }, 120_000);
});
