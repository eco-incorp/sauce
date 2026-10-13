/**
 * `sauce send`: what `sauce tx` built, signed by a signer the command never sees — a throwaway key
 * standing in for a KMS or a hardware wallet — then broadcast, confirmed and reported.
 *
 * Ethereum, on an anvil running the released gated stack (`cli-anvil.ts`): `sauce tx`'s plan for an
 * owner with no Pot yet (Kitchen.deployPot, then the cook), signed with consecutive nonces. Sent in
 * order, the deployment lands and a cook signed short of gas is refused, unsent; signed again with
 * room, it pays the recipient and reports what moved and what stayed in the Pot. Sent twice, it is
 * read back, not resent. A cook that would revert is refused before it is broadcast.
 *
 * Solana, on the released Kitchen and engine in LiteSVM (`svm/rpc-shim.ts`, which checks every
 * signature it is sent): `sauce tx`'s one-transaction cook, the Pot created in it, signed by the
 * owner's keypair and sent — tokens moved, and what `main` returned. An unsigned transaction, one
 * changed after it was signed, and one that would fail are refused, and nothing is sent.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX and on the engine artifacts respectively, like every
 * execution suite, and a hard failure without them in CI.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  address,
  generateKeyPairSigner,
  getAddressCodec,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  lamports,
  signTransaction,
  type Address as SvmAddress,
  type Blockhash,
  type KeyPairSigner,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  bytesToHex,
  encodeAbiParameters,
  hexToBigInt,
  serializeTransaction,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../src/deployments/index.js";
import { buildExecuteTransaction, derivePotPda } from "../src/svm/index.js";
import {
  CLI_FIXTURES,
  describeEvm,
  fixture,
  jsonOf,
  registered,
  sauce,
  startChain,
  type LocalChain,
} from "./cli-anvil.js";
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

const PAY = join(CLI_FIXTURES, "pay.sauce.ts");
const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const AMOUNT = 1_000_000n;
const FUNDED = 10_000_000n;
const USDT_CREATION = `${fixture("NoReturnERC20")}${encodeAbiParameters(
  [{ type: "string" }, { type: "string" }, { type: "uint8" }],
  ["Tether USD", "USDT", 6],
).slice(2)}` as Hex;

interface Unsigned {
  readonly to: Address;
  readonly data: Hex;
  readonly value: string;
}

describeEvm("sauce send: sauce tx's plan, signed elsewhere, on an EVM chain", () => {
  let ethereum: LocalChain;
  let usdc: Address;
  let usdt: Address;
  // The external signer: a key only this test holds, as a KMS or a hardware wallet would.
  const signer = privateKeyToAccount(generatePrivateKey());
  let plan: { pot: Address; transactions: Unsigned[] };

  const nonce = () => ethereum.publicClient.getTransactionCount({ address: signer.address });
  const sign = async (tx: Unsigned, at: number, gas: bigint): Promise<Hex> => {
    const fees = await ethereum.publicClient.estimateFeesPerGas();

    return signer.signTransaction({
      chainId: 1,
      type: "eip1559",
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value),
      nonce: at,
      gas,
      maxFeePerGas: fees.maxFeePerGas * 2n,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
  };
  const cookFor = async (amount: bigint): Promise<Unsigned> =>
    jsonOf(
      await sauce(
        ...["tx", PAY, "--chain", "ethereum", "--owner", signer.address],
        ...["--args-json", JSON.stringify([RECIPIENT, amount.toString()])],
        ...["--rpc-url", ethereum.rpcUrl],
      ),
    ) as unknown as Unsigned;

  beforeAll(async () => {
    ethereum = await startChain("ethereum");
    usdc = await ethereum.plant(fixture("MockERC20"), registered(ethereum.chain, "USDC"));
    usdt = await ethereum.plant(USDT_CREATION, registered(ethereum.chain, "USDT"));
    await ethereum.deployer.sendTransaction({
      account: ethereum.deployer.account!,
      chain: null,
      to: signer.address,
      value: 10n ** 18n,
    });
  }, 120_000);
  afterAll(async () => {
    await ethereum?.stop();
  });

  it("refuses what is not a signed transaction, before reaching the chain", async () => {
    const garbage = await sauce("send", "0x1234", "--rpc-url", "http://127.0.0.1:9/");
    expect(garbage.code).toBe(2);
    expect(garbage.stderr).toMatch(/not a serialized EVM transaction/);
    const unsigned = serializeTransaction({
      chainId: 1,
      type: "eip1559",
      to: RECIPIENT,
      value: 0n,
      nonce: 0,
      gas: 21_000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
    });
    const run = await sauce("send", unsigned, "--rpc-url", "http://127.0.0.1:9/");
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/is not signed: sign it with your wallet or signer first/);
  });

  it("sends the plan in order: the Pot deployed, and a cook signed short of gas refused", async () => {
    const built = await sauce(
      ...["tx", PAY, "--chain", "ethereum", "--owner", signer.address],
      ...["--args-json", JSON.stringify([RECIPIENT, AMOUNT.toString()])],
      ...["--rpc-url", ethereum.rpcUrl],
    );
    plan = jsonOf(built) as unknown as typeof plan;
    expect(plan.transactions).toHaveLength(2);
    for (const token of [usdc, usdt]) await ethereum.mint(token, plan.pot, FUNDED);
    const [deploy, cook] = plan.transactions as [Unsigned, Unsigned];
    const first = await nonce();
    const deployGas = await ethereum.publicClient.estimateGas({
      account: signer.address,
      to: deploy.to,
      data: deploy.data,
    });
    // An estimate taken before the Pot exists prices a call to an empty address: far too little.
    const signed = [await sign(deploy, first, deployGas), await sign(cook, first + 1, 50_000n)];

    const run = await sauce("send", ...signed, "--rpc-url", ethereum.rpcUrl, "--json");

    expect(run.code).toBe(1);
    const out = JSON.parse(run.stdout) as {
      ok: boolean;
      sent: Array<{ what: string; status: string; hash: string; reason?: string }>;
    };
    expect(out.ok).toBe(false);
    expect(out.sent[0]).toMatchObject({
      status: "success",
      what: expect.stringMatching(/deployPot/),
    });
    expect(out.sent[1]).toMatchObject({ status: "failed", hash: "" });
    expect(out.sent[1]!.reason).toMatch(
      /signed with a gas limit of 50000, and the simulation used/,
    );
    expect(await ethereum.publicClient.getCode({ address: plan.pot })).toMatch(/^0x[0-9a-f]{2,}/);
    expect(await ethereum.balanceOf(usdc, RECIPIENT)).toBe(0n);
    expect(await nonce()).toBe(first + 1);
    expect(run.stdout + run.stderr).not.toContain(ethereum.rpcUrl);
  }, 120_000);

  it("sends the cook signed again with room: the recipient paid, what moved reported", async () => {
    const cook = plan.transactions[1]!;
    const signed = await sign(cook, await nonce(), 1_000_000n);

    const run = await sauce("send", signed, "--rpc-url", ethereum.rpcUrl, "--json");

    const out = jsonOf(run) as {
      ok: boolean;
      sent: Array<Record<string, unknown>>;
    };
    expect(out.ok).toBe(true);
    expect(out.sent[0]).toMatchObject({
      what: `cook on Pot ${plan.pot}`,
      status: "success",
      from: signer.address,
    });
    expect(out.sent[0]!.moves).toEqual(expect.arrayContaining([expect.any(Object)]));
    expect(out.sent[0]!.leftInPot).toEqual(expect.any(Array));
    expect(await ethereum.balanceOf(usdc, RECIPIENT)).toBe(AMOUNT);
    expect(await ethereum.balanceOf(usdt, RECIPIENT)).toBe(AMOUNT);

    // Sent again, it is the same transaction: read back, not resent.
    const before = await nonce();
    const again = jsonOf(await sauce("send", signed, "--rpc-url", ethereum.rpcUrl, "--json")) as {
      sent: Array<{ hash: string; status: string }>;
    };
    expect(again.sent[0]).toMatchObject({ hash: out.sent[0]!.hash, status: "success" });
    expect(await nonce()).toBe(before);
    expect(await ethereum.balanceOf(usdc, RECIPIENT)).toBe(AMOUNT);
  }, 120_000);

  it("refuses a cook that would revert, and sends nothing", async () => {
    const cook = await cookFor(FUNDED * 10n);
    const before = await nonce();
    const signed = await sign(cook, before, 1_000_000n);

    const run = await sauce("send", signed, "--rpc-url", ethereum.rpcUrl);

    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/not sent — it would revert/);
    expect(await nonce()).toBe(before);
  }, 120_000);
});

const RPC_URL = "http://127.0.0.1:65533/";
const KITCHEN = address(v12SvmKitchenProgramId());
/** A sweep out of the Pot's token account that returns what it moved. */
const SWEEP = [
  "function main(tokenProgram: Account, source: Account<Writable>, dest: Account<Writable>, authority: Account<Signer>, amount: Uint256): Uint256 {",
  "  transfer(MINT, tokenProgram, source, dest, authority, amount);",
  "  return amount;",
  "}",
  "",
].join("\n");

describeSvm("sauce send: sauce tx's cook, signed elsewhere, on Solana", () => {
  let harness: EngineHarness;
  let shim: SolanaShim;
  let work: string;
  let sweep: string;
  // The external signer: a keypair only this test holds.
  let owner: KeyPairSigner;
  let pot: SvmAddress;
  let source: SvmAddress;
  let dest: SvmAddress;
  const mint = randomAddress();
  const mintDefine = `MINT=${bytesToHex(new Uint8Array(getAddressCodec().encode(mint)))}`;

  const cookFor = async (amount: bigint): Promise<{ transaction: string; createsPot?: boolean }> =>
    jsonOf(
      await sauce(
        ...["tx", sweep, "--chain", "solana", "--owner", owner.address, "--define", mintDefine],
        ...["--account", `tokenProgram=${TOKEN_PROGRAM}`, "--account", `source=${source}`],
        ...["--account", `dest=${dest}`, "--account", "authority=pot"],
        ...["--rpc-url", RPC_URL, "--args", amount.toString()],
      ),
    ) as { transaction: string; createsPot?: boolean };
  const signed = async (base64: string): Promise<string> =>
    getBase64EncodedWireTransaction(
      await signTransaction(
        [owner.keyPair],
        getTransactionDecoder().decode(getBase64Encoder().encode(base64)),
      ),
    );

  beforeAll(async () => {
    harness = await startEngine(
      1_700_000_000n,
      ENGINE_SO as string,
      address(v12SvmEngineProgramId()),
    );
    owner = await generateKeyPairSigner();
    harness.svm.airdrop(owner.address, lamports(5_000_000_000n));
    setMint(harness, mint, 6);
    pot = (await derivePotPda(KITCHEN, owner.address, new Uint8Array(32))).address;
    source = setTokenAccount(harness, randomAddress(), mint, pot, 1_000n);
    dest = setTokenAccount(harness, randomAddress(), mint, randomAddress(), 0n);
    work = mkdtempSync(join(tmpdir(), "sauce-send-solana-"));
    sweep = join(work, "sweep.sauce.ts");
    writeFileSync(sweep, SWEEP);
    shim = solanaShim(harness.svm, RPC_URL);
    shim.install();
  }, 120_000);
  afterAll(() => {
    shim?.restore();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  it("refuses an unsigned transaction and one changed after it was signed", async () => {
    const cook = await cookFor(400n);
    const sent = shim.sent.length;
    const unsigned = await sauce("send", cook.transaction, "--rpc-url", RPC_URL);
    expect(unsigned.code).toBe(2);
    expect(unsigned.stderr).toContain(`is not signed by its fee payer ${owner.address}`);
    // One byte of the message changed after signing: its signature no longer verifies.
    const wire = new Uint8Array(getBase64Encoder().encode(await signed(cook.transaction)));
    wire[wire.length - 1] ^= 1;
    const changed = await sauce("send", Buffer.from(wire).toString("base64"), "--rpc-url", RPC_URL);
    expect(changed.code).toBe(2);
    expect(changed.stderr).toMatch(/signature does not verify/);
    expect(shim.sent.length).toBe(sent);
  }, 120_000);

  it("sends the cook it was given, signed: the Pot created in it, tokens moved, main's return", async () => {
    const cook = await cookFor(400n);
    expect(cook.createsPot).toBe(true);
    const wire = await signed(cook.transaction);

    const run = await sauce("send", wire, "--rpc-url", RPC_URL, "--json");

    const out = jsonOf(run) as { ok: boolean; chain: string; sent: Array<Record<string, unknown>> };
    expect(out).toMatchObject({ ok: true, chain: "solana" });
    expect(out.sent[0]).toMatchObject({
      what: `cook on Pot ${pot}`,
      status: "success",
      feePayer: owner.address,
    });
    expect(hexToBigInt(out.sent[0]!.returns as Hex)).toBe(400n);
    expect(out.sent[0]!.tokenChanges).toEqual(
      expect.arrayContaining([expect.objectContaining({ account: dest })]),
    );
    expect(tokenAmount(harness, dest)).toBe(400n);
    expect(harness.svm.getAccount(pot).exists).toBe(true);
    // The owner signed what was sent, and the command added no signature of its own.
    expect(Object.keys(shim.sent.at(-1)!.signatures)).toEqual([owner.address]);

    // Sent again, it is the same transaction: read back, not resent.
    const sent = shim.sent.length;
    const again = jsonOf(await sauce("send", wire, "--rpc-url", RPC_URL, "--json")) as {
      sent: Array<{ hash: string; status: string }>;
    };
    expect(again.sent[0]).toMatchObject({ hash: out.sent[0]!.hash, status: "success" });
    expect(shim.sent.length).toBe(sent);
    expect(tokenAmount(harness, dest)).toBe(400n);
  }, 120_000);

  it("sends a transaction that runs no Sauce program: a plain transfer, with no return to read", async () => {
    const recipient = randomAddress();
    const transfer = await buildExecuteTransaction({
      payer: owner,
      instructions: [
        getTransferSolInstruction({ source: owner, destination: recipient, amount: 1_000_000n }),
      ],
      latestBlockhash: {
        blockhash: harness.svm.latestBlockhash() as Blockhash,
        lastValidBlockHeight: 1_000_000n,
      },
    });

    const run = await sauce(
      ...["send", getBase64EncodedWireTransaction(transfer), "--rpc-url", RPC_URL, "--json"],
    );

    const out = jsonOf(run) as { sent: Array<Record<string, unknown>> };
    expect(out.sent[0]).toMatchObject({ what: "transaction 1", status: "success" });
    expect(out.sent[0]).not.toHaveProperty("returns");
    expect(out.sent[0]!.lamportChanges).toEqual(
      expect.arrayContaining([expect.objectContaining({ account: recipient, delta: "1000000" })]),
    );
    expect(harness.svm.getBalance(recipient)).toBe(1_000_000n);
  }, 120_000);

  it("refuses a cook that would fail, and sends nothing", async () => {
    const cook = await cookFor(5_000n);
    const sent = shim.sent.length;

    const run = await sauce("send", await signed(cook.transaction), "--rpc-url", RPC_URL);

    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/not sent — it would fail/);
    expect(shim.sent.length).toBe(sent);
  }, 120_000);
});
