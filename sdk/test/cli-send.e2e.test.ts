/**
 * `sauce send`: what `sauce tx` built, signed by a signer the command never sees — a throwaway key
 * standing in for a KMS or a hardware wallet — then broadcast, confirmed and reported.
 *
 * Ethereum, on an anvil running the released gated stack (`cli-anvil.ts`): `sauce tx`'s plan for an
 * owner with no Pot yet (Kitchen.deployPot, then the cook), signed with consecutive nonces. Sent in
 * order, the deployment lands and a cook signed short of gas is refused, unsent; signed again with
 * room, it pays the recipient and reports what moved and what stayed in the Pot. Sent twice, it is
 * read back, not resent. A cook that would revert is refused before it is broadcast. A transaction
 * the chain had, pending, then dropped is said to be gone, not waited out.
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
import { decodeCursor } from "../src/cli/svm-plan.js";
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

  it("says a transaction it saw, then lost, was reorged or dropped, rather than wait it out", async () => {
    const rpc = ethereum.publicClient.request as unknown as (args: {
      method: string;
      params: unknown[];
    }) => Promise<unknown>;
    const before = await nonce();
    const fees = await ethereum.publicClient.estimateFeesPerGas();
    const signed = await signer.signTransaction({
      chainId: 1,
      type: "eip1559",
      to: RECIPIENT,
      value: 1n,
      nonce: before,
      gas: 21_000n,
      maxFeePerGas: fees.maxFeePerGas * 2n,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    await rpc({ method: "evm_setAutomine", params: [false] });
    try {
      const hash = (await rpc({ method: "eth_sendRawTransaction", params: [signed] })) as Hex;
      // The chain has it, pending: sauce send reads it back rather than send it again, and waits.
      const sending = sauce("send", signed, "--rpc-url", ethereum.rpcUrl, "--json");
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await rpc({ method: "anvil_dropTransaction", params: [hash] });

      const run = await sending;

      expect(run.code).toBe(1);
      expect(run.stderr).toMatch(
        new RegExp(`${hash} was seen, then not found: reorged or dropped`),
      );
      expect(await nonce()).toBe(before);
    } finally {
      await rpc({ method: "evm_setAutomine", params: [true] });
    }
  }, 60_000);
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

  it("builds no cook its simulation says would fail, and hands none out", async () => {
    // More than the Pot's account holds.
    const run = await sauce(
      ...["tx", sweep, "--chain", "solana", "--owner", owner.address, "--define", mintDefine],
      ...["--account", `tokenProgram=${TOKEN_PROGRAM}`, "--account", `source=${source}`],
      ...["--account", `dest=${dest}`, "--account", "authority=pot"],
      ...["--rpc-url", RPC_URL, "--args", "5000"],
    );
    expect(run.code).toBe(1);
    const out = JSON.parse(run.stdout) as {
      transaction?: string;
      transactions: unknown[];
      fails: string;
      logs: string[];
      cursor: string;
    };
    expect(out.transaction).toBeUndefined();
    expect(out.transactions).toEqual([]);
    expect(out.fails).toMatch(/insufficient funds|0x1/);
    expect(out.logs.length).toBeGreaterThan(0);
    // Nothing handed out: the plan remembers no cook that could land.
    expect(decodeCursor(out.cursor).cook).toBeUndefined();
  }, 120_000);

  it("refuses a cook that would fail by the time it is sent, and sends nothing", async () => {
    const cook = await cookFor(500n);
    // The Pot's account is emptied between the cook's building and its sending.
    setTokenAccount(harness, source, mint, pot, 0n);
    const sent = shim.sent.length;

    const run = await sauce("send", await signed(cook.transaction), "--rpc-url", RPC_URL);

    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/not sent — it would fail/);
    expect(shim.sent.length).toBe(sent);
  }, 120_000);
});

/** A program staged in a code buffer and naming more accounts than a transaction lists. */
const WIDE_ACCOUNTS = 40;
const WIDE = [
  `function main(${Array.from({ length: WIDE_ACCOUNTS }, (_, i) => `a${i}: Account`).join(", ")}): Uint256 {`,
  `  const blob = hex\`${"ab".repeat(1500)}\`;`,
  "  require(blob.length == 1500);",
  "  return 7;",
  "}",
  "",
].join("\n");

interface Step {
  readonly step: string;
  readonly transactions?: ReadonlyArray<{ what: string; transaction: string; feePayer: string }>;
  readonly cursor?: string;
  readonly wait?: string;
  readonly plan: ReadonlyArray<{ step: string; state: string }>;
}

describeSvm("sauce send: a staged Solana cook as a plan of steps, signed elsewhere", () => {
  let harness: EngineHarness;
  let shim: SolanaShim;
  let work: string;
  let wide: string;
  let owner: KeyPairSigner;
  const accounts = Array.from({ length: WIDE_ACCOUNTS }, () => randomAddress());
  const flags = accounts.flatMap((at, i) => ["--account", `a${i}=${at}`]);

  const signAll = async (step: Step): Promise<string[]> =>
    Promise.all(
      (step.transactions ?? []).map(async ({ transaction }) =>
        getBase64EncodedWireTransaction(
          await signTransaction(
            [owner.keyPair],
            getTransactionDecoder().decode(getBase64Encoder().encode(transaction)),
          ),
        ),
      ),
    );
  /** `sauce send` with a cursor: what was sent, and the next step. */
  const send = async (
    cursor: string,
    ...argv: string[]
  ): Promise<{ ok: boolean; sent: Array<Record<string, unknown>>; next: Step }> =>
    jsonOf(
      await sauce("send", ...argv, "--cursor", cursor, "--rpc-url", RPC_URL, "--json"),
    ) as unknown as { ok: boolean; sent: Array<Record<string, unknown>>; next: Step };
  const planFor = async (salt: string): Promise<Step> =>
    jsonOf(
      await sauce(
        ...["tx", wide, "--chain", "solana", "--owner", owner.address, "--salt", salt],
        ...flags,
        ...["--rpc-url", RPC_URL],
      ),
    ) as unknown as Step;

  beforeAll(async () => {
    harness = await startEngine(
      1_700_000_000n,
      ENGINE_SO as string,
      address(v12SvmEngineProgramId()),
    );
    owner = await generateKeyPairSigner();
    harness.svm.airdrop(owner.address, lamports(50_000_000_000n));
    work = mkdtempSync(join(tmpdir(), "sauce-send-plan-"));
    wide = join(work, "wide.sauce.ts");
    writeFileSync(wide, WIDE);
    shim = solanaShim(harness.svm, RPC_URL);
    shim.install();
  }, 120_000);
  afterAll(() => {
    shim?.restore();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  it("runs setup, cook and close, rebuilding what expired and only that", async () => {
    const first = await planFor("plan");
    expect(first.step).toBe("setup");
    const whats = first.transactions!.map((tx) => tx.what);
    expect(whats.slice(0, 2)).toEqual(["creating the Pot", "creating the code buffer"]);
    expect(whats).toEqual(
      expect.arrayContaining([
        "writing bytes 0… of the program",
        "finalizing the code buffer",
        "creating the lookup table",
        "extending the lookup table",
      ]),
    );
    expect(first.transactions!.every((tx) => tx.feePayer === owner.address)).toBe(true);
    expect(first.plan.map((stage) => [stage.step, stage.state])).toEqual([
      ["setup", "next"],
      ["cook", "later"],
      ["close", "later"],
    ]);

    // A slow signer: three land, and the rest wait past their blockhash.
    const signed = await signAll(first);
    const partial = await send(first.cursor!, ...signed.slice(0, 3));
    expect(partial.ok).toBe(true);
    expect(partial.next.step).toBe("setup");
    const left = partial.next.transactions!.map((tx) => tx.what);
    expect(left).toEqual(whats.slice(3));
    shim.expire();
    const stale = await sauce(
      ...["send", ...signed.slice(3), "--cursor", partial.next.cursor!],
      ...["--rpc-url", RPC_URL, "--json"],
    );
    expect(stale.code).toBe(1);
    const refused = JSON.parse(stale.stdout) as {
      sent: Array<{ status: string; reason: string }>;
      next: Step;
    };
    expect(refused.sent[0]!.reason).toMatch(/blockhash has expired/);
    // Built again, fresh: the same transactions, none of what landed.
    expect(refused.next.transactions!.map((tx) => tx.what)).toEqual(left);

    const setup = await send(refused.next.cursor!, ...(await signAll(refused.next)));
    expect(setup.ok).toBe(true);
    expect(setup.next.step).toBe("cook");
    expect(setup.next.transactions!.map((tx) => tx.what)).toEqual([
      expect.stringMatching(/^cook on Pot /),
    ]);

    const cooked = await send(setup.next.cursor!, ...(await signAll(setup.next)));
    expect(cooked.ok).toBe(true);
    expect(cooked.sent[0]).toMatchObject({
      status: "success",
      returnType: "Uint256",
      returned: "7",
    });
    expect(cooked.next.step).toBe("close");

    const closed = await send(cooked.next.cursor!, ...(await signAll(cooked.next)));
    expect(closed.ok).toBe(true);
    expect(closed.sent[0]!.what).toBe("closing the code buffer");
    expect(closed.next.step).toBe("done");
    expect(closed.next.cursor).toBeUndefined();
    // Every transaction the shim took, the owner signed and paid for, and only the owner.
    expect(shim.sent.every((tx) => Object.keys(tx.signatures).join() === owner.address)).toBe(true);
  }, 300_000);

  it("never builds a second cook while one handed out can still land", async () => {
    const first = await planFor("guard");
    const setup = await send(first.cursor!, ...(await signAll(first)));
    expect(setup.next.step).toBe("cook");
    const cookCursor = setup.next.cursor!;
    // Asked again with nothing sent: the cook handed out can still land, so none is built.
    const asked = await send(cookCursor);
    expect(asked.next.transactions).toBeUndefined();
    expect(asked.next.wait).toMatch(/can still land until block height/);
    // It lands another way; past its blockhash, the cluster shows the cook ran, and the plan
    // moves on to the close rather than build another.
    const [cook] = await signAll(setup.next);
    expect((await sauce("send", cook!, "--rpc-url", RPC_URL)).code).toBe(0);
    harness.svm.warpToSlot(harness.svm.getClock().slot + 200n);
    const after = await send(cookCursor);
    expect(after.next.step).toBe("close");
  }, 300_000);

  it("confirms what was broadcast another way, and gives up on a cook with close", async () => {
    const first = await planFor("abandon");
    const setup = await send(first.cursor!, ...(await signAll(first)));
    expect(setup.next.step).toBe("cook");
    // The setup's last transaction, already landed, confirmed by its signature: nothing resent.
    const sent = shim.sent.length;
    const confirmed = await send(
      setup.next.cursor!,
      "--signature",
      String(setup.sent.at(-1)!.hash),
    );
    expect(confirmed.sent[0]).toMatchObject({ status: "success" });
    expect(shim.sent.length).toBe(sent);
    // Given up while the cook handed out can still land: the close waits for that first.
    const early = await send(setup.next.cursor!, "--close");
    expect(early.next.step).toBe("close");
    expect(early.next.transactions).toBeUndefined();
    expect(early.next.wait).toMatch(/can still land until block height/);
    // Past its blockhash, the cook never having landed, the close comes; after it, the plan is done.
    harness.svm.warpToSlot(harness.svm.getClock().slot + 200n);
    const giving = await send(setup.next.cursor!, "--close");
    expect(giving.next.transactions!.map((tx) => tx.what)).toEqual(["closing the code buffer"]);
    const closed = await send(giving.next.cursor!, ...(await signAll(giving.next)));
    expect(closed.next.step).toBe("done");
    expect(closed.next.plan.find((stage) => stage.step === "cook")!.state).toBe("given up");
  }, 300_000);

  it("learns how a cook broadcast another way went from its signature, and moves on at once", async () => {
    const first = await planFor("by-signature");
    const setup = await send(first.cursor!, ...(await signAll(first)));
    expect(setup.next.step).toBe("cook");
    const [cook] = await signAll(setup.next);
    const broadcast = jsonOf(
      await sauce("send", cook!, "--rpc-url", RPC_URL, "--json"),
    ) as unknown as { sent: Array<{ hash: string }> };
    // Its signature tells the plan the cook ran: the close comes now, not once its blockhash has
    // passed and the owner's transactions show it.
    const confirmed = await send(setup.next.cursor!, "--signature", broadcast.sent[0]!.hash);
    expect(confirmed.sent[0]).toMatchObject({ status: "success", returned: "7" });
    expect(confirmed.next.step).toBe("close");
    expect(confirmed.next.plan.find((stage) => stage.step === "cook")!.state).toBe("done");
  }, 300_000);

  it("keeps a cook refused after its blockhash expired as handed out, and builds a fresh one only past it", async () => {
    const first = await planFor("expired-cook");
    const setup = await send(first.cursor!, ...(await signAll(first)));
    const [cook] = await signAll(setup.next);
    // The signer took too long: past its blockhash, the signed cook is refused, never sent.
    harness.svm.warpToSlot(harness.svm.getClock().slot + 200n);
    const stale = await sauce(
      ...["send", cook!, "--cursor", setup.next.cursor!, "--rpc-url", RPC_URL, "--json"],
    );
    expect(stale.code).toBe(1);
    const refused = JSON.parse(stale.stdout) as { sent: Array<{ reason: string }>; next: Step };
    expect(refused.sent[0]!.reason).toMatch(/blockhash has expired/);
    // The cluster shows no cook on that blockhash: the next step is a fresh one.
    expect(refused.next.step).toBe("cook");
    expect(refused.next.transactions).toHaveLength(1);
    const cooked = await send(refused.next.cursor!, ...(await signAll(refused.next)));
    expect(cooked.sent[0]).toMatchObject({ status: "success", returned: "7" });
  }, 300_000);

  it("splits a setup past one step's transactions into steps", async () => {
    const big = join(work, "big.sauce.ts");
    writeFileSync(
      big,
      [
        "function main(): Uint256 {",
        `  const blob = hex\`${"cd".repeat(31_000)}\`;`,
        "  require(blob.length == 31000);",
        "  return 9;",
        "}",
        "",
      ].join("\n"),
    );
    const first = jsonOf(
      await sauce(
        ...["tx", big, "--chain", "solana", "--owner", owner.address, "--salt", "big"],
        ...["--rpc-url", RPC_URL],
      ),
    ) as unknown as Step;
    expect(first.transactions).toHaveLength(32);
    const second = await send(first.cursor!, ...(await signAll(first)));
    expect(second.next.step).toBe("setup");
    expect(second.next.transactions!.at(-1)!.what).toBe("finalizing the code buffer");
    const third = await send(second.next.cursor!, ...(await signAll(second.next)));
    expect(third.next.step).toBe("cook");
  }, 300_000);
});
