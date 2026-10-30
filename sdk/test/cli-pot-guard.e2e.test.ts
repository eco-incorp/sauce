/**
 * Commands authenticate deployed Pot code and retain its persisted execution binding before funding,
 * signing or cooking. Prediction alone never authorizes a deployment-and-cook plan.
 *
 * Uses the real gated stack and, for new deployments, SAUCE_LOCAL_CANDIDATE. Runtime/profile
 * adversaries are covered by cli-create3.e2e and evm/create3-binding.e2e; this suite checks command
 * refusals, whole-plan preflight and the absence of transaction/store mutations on refusal.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encodeFunctionData,
  getAddress,
  parseEther,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import type { Approver, SetupStep } from "../src/cli/approvals.js";
import { CliError } from "../src/cli/args.js";
import { requireKitchenPredicts, requirePlanSendable, sendAndWait } from "../src/cli/chain.js";
import { runCommand, type RunInput } from "../src/cli/commands.js";
import { fundingFor } from "../src/cli/inputs.js";
import { keeping } from "../src/cli/keep.js";
import { withPotCandidate, type PotCandidate } from "../src/cli/pot-binding.js";
import { potSalt, v12PredictPot, v12PredictSharedPot } from "../src/deployments/pot.js";
import { nodeIo, type CliIo } from "../src/cli/run.js";
import { v12KitchenAbi, v12PotAbi } from "../src/evm/engine.js";
import {
  deployPot,
  describeEvm,
  erc20,
  fixture,
  interceptingEndpoint,
  jsonOf,
  registered,
  sauce,
  sauceWith,
  startChain,
  type LocalChain,
} from "./cli-anvil.js";
import { gateAnchors } from "./evm/gated-engine.js";

const PROGRAM = "function main(x: Uint256): Uint256 {\n  return x + 1;\n}\n";
const NO_TERMINAL: Partial<CliIo> = { canAsk: () => false, confirm: async () => undefined };
const candidateFile = process.env.SAUCE_LOCAL_CANDIDATE;
const candidateTest = candidateFile ? it : it.skip;

describeEvm("the Pot is authenticated before command side effects", () => {
  let local: LocalChain;
  let work: string;
  let program: string;
  let kitchen: Address;
  let candidate: PotCandidate | undefined;
  let usdc: Address;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-pot-guard-e2e-"));
    program = join(work, "next.sauce.ts");
    writeFileSync(program, PROGRAM);
    candidate = candidateFile
      ? (JSON.parse(readFileSync(candidateFile, "utf8")) as PotCandidate)
      : undefined;
    kitchen = getAddress(gateAnchors().kitchen);
    local = await startChain("ethereum");
    usdc = await local.plant(fixture("MockERC20"), registered(local.chain, "USDC"));
  }, 120_000);
  afterAll(async () => {
    await local?.stop();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  interface Owner {
    readonly key: Hex;
    readonly address: Address;
    readonly label: string;
    readonly salt: Hex;
    readonly pot: Address;
  }

  async function owner(label: string): Promise<Owner> {
    const key = generatePrivateKey();
    const address = privateKeyToAccount(key).address;
    await local.testClient.setBalance({ address, value: parseEther("10") });
    const salt = potSalt(label);

    return { key, address, label, salt, pot: getAddress(v12PredictPot(address, salt, kitchen)) };
  }

  /** Fixture deployment authenticates actual code before persisting its binding. */
  async function deployedOwner(label: string): Promise<Owner> {
    const who = await owner(label);
    const pot = await deployPot(local, who.address, who.salt);
    expect(local.pots.recordsOf(local.chain.id, pot)[0]?.binding).toBeDefined();

    return { ...who, pot };
  }

  const descriptorFlags = () => (candidateFile ? ["--pot-binding", candidateFile] : []);
  const flags = (rpcUrl = local.rpcUrl) => [
    "--chain",
    "ethereum",
    "--rpc-url",
    rpcUrl,
    "--pots",
    local.pots.dir,
  ];
  const inScope = <T>(body: () => Promise<T>): Promise<T> =>
    keeping({ stores: { pots: local.pots }, say: () => undefined }, () =>
      withPotCandidate(candidate, body),
    );

  const command = (each: string, who: Owner, ...more: string[]) =>
    sauceWith(
      NO_TERMINAL,
      ...(each === "pot --deploy"
        ? ["pot", "--deploy"]
        : each === "pot"
          ? ["pot"]
          : [each, program]),
      ...flags(),
      ...descriptorFlags(),
      ...(each === "run" || each === "sign" || each === "pot --deploy"
        ? ["--private-key", who.key]
        : ["--owner", who.address]),
      ...(each === "run" ? ["--yes"] : []),
      "--salt",
      who.label,
      ...(each.startsWith("pot") ? [] : ["--args", "41"]),
      ...more,
    );

  const onPot = (each: string, who: Owner, pot: Address, ...more: string[]) =>
    sauceWith(
      NO_TERMINAL,
      each,
      program,
      ...flags(),
      ...descriptorFlags(),
      "--pot",
      pot,
      ...(each === "run" || each === "sign" ? ["--private-key", who.key] : []),
      ...(each === "run" ? ["--yes"] : []),
      "--args",
      "41",
      ...more,
    );

  async function unchanged(who: Owner, balance: bigint, code: Hex | undefined, nonce = 0) {
    expect(await local.publicClient.getTransactionCount({ address: who.address })).toBe(nonce);
    expect(String(await local.publicClient.getBalance({ address: who.address }))).toBe(
      String(balance),
    );
    expect(await local.publicClient.getCode({ address: who.pot })).toBe(code);
  }

  const signedBy = (who: Owner, tx: { to: Address; data: Hex; value: bigint }, nonce: number) =>
    privateKeyToAccount(who.key).signTransaction({
      ...tx,
      chainId: local.chain.id,
      nonce,
      gas: 1_000_000n,
      maxFeePerGas: 100_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    });

  const cookOn = (pot: Address, engine: Address) => ({
    to: pot,
    data: encodeFunctionData({
      abi: v12PotAbi,
      functionName: "cook",
      args: [engine, "0x00"],
    }),
    value: 0n,
  });
  const send = (...signed: Hex[]) =>
    sauceWith(NO_TERMINAL, "send", ...signed, ...flags(), ...descriptorFlags(), "--json");
  const malformed = (signature: string) => ({
    to: kitchen,
    data: `${toFunctionSelector(signature)}${"00".repeat(8)}` as Hex,
    value: 0n,
  });
  const deployment = (
    who: Owner,
    kind: "private" | "private-fixed-router" | "shared" = "private",
  ) => ({
    to: kitchen,
    data: encodeFunctionData({
      abi: v12KitchenAbi,
      functionName: kind === "shared" ? "deploySharedPot" : "deployPot",
      args:
        kind === "shared"
          ? [who.salt]
          : kind === "private-fixed-router"
            ? [who.address, who.salt, true]
            : [who.address, who.salt],
    } as never),
    value: 0n,
  });

  candidateTest(
    "explicitly deploys and persists before tx, simulation, signing and cooking",
    async () => {
      const fresh = await owner("normal-explicit");
      expect(jsonOf(await command("pot --deploy", fresh))).toMatchObject({
        pot: fresh.pot,
        deployPot: { status: "success" },
      });
      const records = local.pots.recordsOf(local.chain.id, fresh.pot);
      expect(records[0]?.binding).toMatchObject({
        scheme: "create3",
        compiler: candidate!.compiler,
        engine: candidate!.engine,
      });
      for (const each of ["tx", "simulate", "sign", "run"]) {
        const json = each === "tx" ? [] : ["--json"];
        const result = await command(each, fresh, ...json);
        const out = jsonOf(result);
        if (each === "simulate") expect(out).toMatchObject({ ok: true, returned: "42" });
        if (each === "run")
          expect(out).toMatchObject({ pot: fresh.pot, cook: { status: "success" } });
        expect(out.deployPot).toBeUndefined();
        expect((await onPot(each, fresh, fresh.pot, ...json)).code).toBe(0);
      }
      expect(local.pots.recordsOf(local.chain.id, fresh.pot)).toEqual(records);
      expect(await local.publicClient.getTransactionCount({ address: fresh.address })).toBe(3);
    },
    180_000,
  );

  it("uses an existing authenticated binding without a deployment descriptor or repinning", async () => {
    const fresh = await deployedOwner("existing-binding");
    const records = local.pots.recordsOf(local.chain.id, fresh.pot);
    const code = await local.publicClient.getCode({ address: fresh.pot });
    for (const each of ["tx", "simulate", "sign", "run"]) {
      const result = await sauceWith(
        NO_TERMINAL,
        each,
        program,
        ...flags(),
        "--pot",
        fresh.pot,
        ...(each === "run" || each === "sign" ? ["--private-key", fresh.key] : []),
        ...(each === "run" ? ["--yes"] : []),
        "--args",
        "41",
        ...(each === "tx" ? [] : ["--json"]),
      );
      const out = jsonOf(result);
      if (each === "simulate") expect(out).toMatchObject({ ok: true, returned: "42" });
      if (each === "run") expect(out).toMatchObject({ cook: { status: "success" } });
      expect(out.deployPot).toBeUndefined();
    }
    expect(await local.publicClient.getTransactionCount({ address: fresh.address })).toBe(1);
    expect(await local.publicClient.getCode({ address: fresh.pot })).toBe(code);
    expect(local.pots.recordsOf(local.chain.id, fresh.pot)).toEqual(records);
  }, 180_000);

  it.each(["tx", "simulate", "sign", "run"])(
    "refuses %s on missing code without deploying, funding or recording a Pot",
    async (each) => {
      const fresh = await owner(`missing-${each}`);
      const balance = await local.publicClient.getBalance({ address: fresh.address });
      const result = await command(
        each,
        fresh,
        ...(each === "run" ? ["--fund", "native:0.001"] : []),
      );
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(local.pots.recordsOf(local.chain.id, fresh.pot)).toEqual([]);
      expect(String(await local.publicClient.getBalance({ address: fresh.pot }))).toBe("0");
      await unchanged(fresh, balance, undefined);
    },
    120_000,
  );

  candidateTest.each(["unknown", "foreign-profile"] as const)(
    "refuses a deployed Pot with %s provenance before producing a cook or changing the store",
    async (provenance) => {
      const fresh = await owner(provenance);
      const tx = deployment(fresh);
      await local.send(local.deployer, tx.to, tx.data);
      const code = await local.publicClient.getCode({ address: fresh.pot });
      expect(code).toBeDefined();
      const balance = await local.publicClient.getBalance({ address: fresh.address });
      const descriptor = join(work, `${provenance}.json`);
      if (provenance === "foreign-profile") {
        writeFileSync(
          descriptor,
          JSON.stringify({ ...candidate, profileHash: `0x${"00".repeat(32)}` }),
        );
      }
      await local.mint(usdc, fresh.address, 10_000_000n);
      for (const each of ["tx", "simulate", "sign", "run"]) {
        const refused = await sauceWith(
          NO_TERMINAL,
          each,
          program,
          ...flags(),
          "--pot",
          fresh.pot,
          ...(provenance === "foreign-profile" ? ["--pot-binding", descriptor] : []),
          ...(each === "sign" || each === "run" ? ["--private-key", fresh.key] : []),
          ...(each === "run" ? ["--yes", "--fund", "USDC:1"] : []),
          "--args",
          "41",
        );
        expect(refused.code).toBe(1);
        expect(refused.stdout).toBe("");
        expect(local.pots.recordsOf(local.chain.id, fresh.pot)).toEqual([]);
        await unchanged(fresh, balance, code);
      }
      expect(String(await local.balanceOf(usdc, fresh.address))).toBe("10000000");
      expect(String(await local.balanceOf(usdc, fresh.pot))).toBe("0");
      expect(
        String(
          await local.publicClient.readContract({
            address: usdc,
            abi: erc20,
            functionName: "allowance",
            args: [fresh.address, fresh.pot],
          }),
        ),
      ).toBe("0");
    },
    120_000,
  );

  it.each(["sign", "run"])(
    "refuses %s from the wrong owner without changing a valid binding",
    async (each) => {
      const fresh = await deployedOwner(`wrong-owner-${each}`);
      const stranger = await owner(`stranger-${each}`);
      const records = local.pots.recordsOf(local.chain.id, fresh.pot);
      const code = await local.publicClient.getCode({ address: fresh.pot });
      const balance = await local.publicClient.getBalance({ address: stranger.address });
      const refused = await onPot(
        each,
        stranger,
        fresh.pot,
        ...(each === "run" ? ["--fund", "native:0.001"] : []),
      );
      expect(refused.code).toBe(1);
      expect(refused.stdout).toBe("");
      expect(await local.publicClient.getTransactionCount({ address: fresh.address })).toBe(0);
      expect(String(await local.publicClient.getBalance({ address: fresh.pot }))).toBe("0");
      expect(local.pots.recordsOf(local.chain.id, fresh.pot)).toEqual(records);
      await unchanged({ ...stranger, pot: fresh.pot }, balance, code);
    },
    120_000,
  );

  it("refuses a raw cook before deployment, including its attached native value", async () => {
    const fresh = await owner("send-before-deploy");
    const balance = await local.publicClient.getBalance({ address: fresh.address });
    const cook = { ...cookOn(fresh.pot, fresh.address), value: 1_234n };
    await expect(
      inScope(() =>
        sendAndWait(local.publicClient, local.rpcUrl, privateKeyToAccount(fresh.key), cook),
      ),
    ).rejects.toBeInstanceOf(CliError);
    expect((await send(await signedBy(fresh, cook, 0))).code).toBe(1);
    expect(String(await local.publicClient.getBalance({ address: fresh.pot }))).toBe("0");
    expect(local.pots.recordsOf(local.chain.id, fresh.pot)).toEqual([]);
    await unchanged(fresh, balance, undefined);
  }, 120_000);

  it.each(["empty", "malformed"] as const)(
    "preflights a later %s transaction before sending an earlier transfer",
    async (refused) => {
      const fresh = await owner(`batch-${refused}`);
      const recipient = privateKeyToAccount(generatePrivateKey()).address;
      const balance = await local.publicClient.getBalance({ address: fresh.address });
      const step =
        refused === "empty"
          ? cookOn(fresh.pot, fresh.address)
          : malformed("function deployPot(address owner, bytes32 salt)");
      const result = await send(
        await signedBy(fresh, { to: recipient, data: "0x", value: 1_000n }, 0),
        await signedBy(fresh, step, 1),
      );
      expect(result.code).toBe(1);
      expect(String(await local.publicClient.getBalance({ address: recipient }))).toBe("0");
      expect(local.pots.recordsOf(local.chain.id, fresh.pot)).toEqual([]);
      await unchanged(fresh, balance, undefined);
    },
    120_000,
  );

  it.each([
    "function deployPot(address owner, bytes32 salt)",
    "function deployPot(address owner, bytes32 salt, bool routerFixed)",
    "function deploySharedPot(bytes32 salt)",
  ])(
    "refuses malformed %s calldata without sending",
    async (signature) => {
      const fresh = await owner("malformed-alone");
      const balance = await local.publicClient.getBalance({ address: fresh.address });
      await expect(
        inScope(() =>
          sendAndWait(
            local.publicClient,
            local.rpcUrl,
            privateKeyToAccount(fresh.key),
            malformed(signature),
          ),
        ),
      ).rejects.toBeInstanceOf(CliError);
      await unchanged(fresh, balance, undefined);
    },
    60_000,
  );

  candidateTest.each(["private", "private-fixed-router", "shared"] as const)(
    "refuses an unsigned %s deployment-and-cook plan before either transaction sends",
    async (kind) => {
      const fresh = await owner(`plan-${kind}`);
      const pot =
        kind === "shared"
          ? v12PredictSharedPot(fresh.salt, kitchen)
          : v12PredictPot(fresh.address, fresh.salt, kitchen, kind === "private-fixed-router");
      const tx = deployment(fresh, kind);
      const balance = await local.publicClient.getBalance({ address: fresh.address });
      await inScope(async () => {
        await expect(
          requirePlanSendable(local.publicClient, [{ tx, what: "deploy" }]),
        ).resolves.toBeUndefined();
        await expect(
          requirePlanSendable(local.publicClient, [
            { tx, what: "deploy" },
            { tx: cookOn(pot, getAddress(candidate!.engine)), what: "cook" },
          ]),
        ).rejects.toMatchObject({ step: 1 });
      });
      const refused = await send(
        await signedBy(fresh, tx, 0),
        await signedBy(fresh, cookOn(pot, getAddress(candidate!.engine)), 1),
      );
      expect(refused.code).toBe(1);
      expect(await local.publicClient.getCode({ address: pot })).toBeUndefined();
      expect(local.pots.recordsOf(local.chain.id, pot)).toEqual([]);
      await unchanged(fresh, balance, undefined);
    },
    120_000,
  );

  candidateTest(
    "refuses explicit deployment when the selected Kitchen has no code",
    async () => {
      const fresh = await owner("no-kitchen");
      const balance = await local.publicClient.getBalance({ address: fresh.address });
      const code = await local.publicClient.getCode({ address: kitchen });
      await local.testClient.setCode({ address: kitchen, bytecode: "0x" });
      try {
        await expect(
          inScope(() =>
            requireKitchenPredicts(local.publicClient, local.chain, fresh.address, fresh.salt),
          ),
        ).rejects.toBeInstanceOf(CliError);
        expect((await command("pot --deploy", fresh)).code).toBe(1);
        expect(local.pots.recordsOf(local.chain.id, fresh.pot)).toEqual([]);
        await unchanged(fresh, balance, undefined);
      } finally {
        await local.testClient.setCode({ address: kitchen, bytecode: code! });
      }
    },
    120_000,
  );

  candidateTest.each([false, true])(
    "stops replay after a landed deployment's Pot disappears (later cook: %s)",
    async (withCook) => {
      const fresh = await owner(`landed-missing-${withCook}`);
      const recipient = privateKeyToAccount(generatePrivateKey()).address;
      const landing = await signedBy(fresh, deployment(fresh), 0);
      const landed = jsonOf(await send(landing)) as { sent: Array<{ hash: string }> };
      const records = local.pots.recordsOf(local.chain.id, fresh.pot);
      expect(records[0]?.binding).toBeDefined();
      const code = await local.publicClient.getCode({ address: fresh.pot });
      const balance = await local.publicClient.getBalance({ address: fresh.address });
      await local.testClient.setCode({ address: fresh.pot, bytecode: "0x" });
      try {
        const result = await send(
          landing,
          await signedBy(fresh, { to: recipient, data: "0x", value: 1_000n }, 1),
          ...(withCook
            ? [await signedBy(fresh, cookOn(fresh.pot, getAddress(candidate!.engine)), 2)]
            : []),
        );
        expect(result.code).toBe(1);
        const out = JSON.parse(result.stdout);
        expect(out).toMatchObject({
          ok: false,
          sent: [
            { status: "success", hash: landed.sent[0]!.hash },
            { status: "failed", hash: "" },
          ],
        });
        expect(out.sent).toHaveLength(2);
        expect(String(await local.publicClient.getBalance({ address: recipient }))).toBe("0");
        expect(local.pots.recordsOf(local.chain.id, fresh.pot)).toEqual(records);
        await unchanged(fresh, balance, undefined, 1);
      } finally {
        await local.testClient.setCode({ address: fresh.pot, bytecode: code! });
      }
    },
    120_000,
  );

  candidateTest.each([false, true])(
    "refuses zero-owner deployment before funding (fixed Router: %s)",
    async (fixed) => {
      const fresh = await owner(`zero-owner-${fixed}`);
      const balance = await local.publicClient.getBalance({ address: fresh.address });
      const pot = v12PredictSharedPot(fresh.salt, kitchen);
      const tx = deployment(
        { ...fresh, address: zeroAddress },
        fixed ? "private-fixed-router" : "private",
      );
      const transfer = { to: pot, data: "0x" as Hex, value: 1_000n };
      await expect(
        inScope(() =>
          requirePlanSendable(local.publicClient, [
            { tx: transfer, what: "fund" },
            { tx, what: "deploy" },
          ]),
        ),
      ).rejects.toMatchObject({ step: 1 });
      expect(
        (await send(await signedBy(fresh, transfer, 0), await signedBy(fresh, tx, 1))).code,
      ).toBe(1);
      expect(String(await local.publicClient.getBalance({ address: pot }))).toBe("0");
      expect(await local.publicClient.getCode({ address: pot })).toBeUndefined();
      expect(local.pots.recordsOf(local.chain.id, pot)).toEqual([]);
      await unchanged(fresh, balance, undefined);
    },
    120_000,
  );

  it("rechecks the cook before sending an approved funding allowance", async () => {
    const fresh = await deployedOwner("fund-then-gone");
    await local.mint(usdc, fresh.address, 10_000_000n);
    const records = local.pots.recordsOf(local.chain.id, fresh.pot);
    const code = await local.publicClient.getCode({ address: fresh.pot });
    const balance = await local.publicClient.getBalance({ address: fresh.address });
    const asked: string[] = [];
    const approver: Approver = {
      auto: true,
      canAsk: false,
      approve: async (action) => {
        asked.push(action);
        await local.testClient.setCode({ address: fresh.pot, bytecode: "0x" });
        return true;
      },
    };
    const account = privateKeyToAccount(fresh.key);
    const input: RunInput = {
      file: program,
      text: PROGRAM,
      chain: local.chain,
      defines: {},
      target: { owner: fresh.address, salt: fresh.salt },
      args: { from: "--args", values: ["41"] },
      rpcUrl: local.rpcUrl,
      account,
      approver,
      fund: fundingFor({
        chain: local.chain,
        rpcUrl: local.rpcUrl,
        fund: ["USDC:1"],
        mode: "allowance",
        sweep: false,
        send: true,
        account,
        approver,
      }),
    };
    try {
      await expect(inScope(() => runCommand(input, nodeIo()))).rejects.toBeInstanceOf(CliError);
      expect(asked).toHaveLength(1);
      expect(
        String(
          await local.publicClient.readContract({
            address: usdc,
            abi: erc20,
            functionName: "allowance",
            args: [fresh.address, fresh.pot],
          }),
        ),
      ).toBe("0");
      expect(String(await local.balanceOf(usdc, fresh.address))).toBe("10000000");
      expect(String(await local.balanceOf(usdc, fresh.pot))).toBe("0");
      expect(local.pots.recordsOf(local.chain.id, fresh.pot)).toEqual(records);
      await unchanged(fresh, balance, undefined);
    } finally {
      await local.testClient.setCode({ address: fresh.pot, bytecode: code! });
    }
  }, 120_000);

  it("rechecks the cook before sending a rehearsed funding transfer", async () => {
    const fresh = await deployedOwner("transfer-then-gone");
    await local.mint(usdc, fresh.address, 10_000_000n);
    const records = local.pots.recordsOf(local.chain.id, fresh.pot);
    const code = await local.publicClient.getCode({ address: fresh.pot });
    const balance = await local.publicClient.getBalance({ address: fresh.address });
    const transfer = toFunctionSelector("function transfer(address to, uint256 amount)");
    let gone = false;
    const endpoint = await interceptingEndpoint(local.rpcUrl, async (request) => {
      if (gone || request.method !== "eth_call") return;
      const call = request.params?.[0] as { to?: Address; data?: Hex; input?: Hex };
      if (call.to === undefined || getAddress(call.to) !== usdc) return;
      if (!(call.data ?? call.input ?? "0x").startsWith(transfer)) return;
      gone = true;
      await local.testClient.setCode({ address: fresh.pot, bytecode: "0x" });
    });
    const account = privateKeyToAccount(fresh.key);
    const approver: Approver = { auto: true, canAsk: false, approve: async () => true };
    const input: RunInput = {
      file: program,
      text: PROGRAM,
      chain: local.chain,
      defines: {},
      target: { owner: fresh.address, salt: fresh.salt },
      args: { from: "--args", values: ["41"] },
      rpcUrl: endpoint.url,
      account,
      approver,
      fund: fundingFor({
        chain: local.chain,
        rpcUrl: endpoint.url,
        fund: ["USDC:1"],
        mode: "transfer",
        sweep: false,
        send: true,
        account,
        approver,
      }),
    };
    try {
      await expect(inScope(() => runCommand(input, nodeIo()))).rejects.toBeInstanceOf(CliError);
      expect(gone).toBe(true);
      expect(String(await local.balanceOf(usdc, fresh.address))).toBe("10000000");
      expect(String(await local.balanceOf(usdc, fresh.pot))).toBe("0");
      expect(local.pots.recordsOf(local.chain.id, fresh.pot)).toEqual(records);
      await unchanged(fresh, balance, undefined);
    } finally {
      await endpoint.stop();
      await local.testClient.setCode({ address: fresh.pot, bytecode: code! });
    }
  }, 120_000);

  it("preflights a refused setup cook before sending any setup transfer", async () => {
    const fresh = await deployedOwner("setup-refused");
    const absent = await owner("setup-absent");
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const balance = await local.publicClient.getBalance({ address: fresh.address });
    const records = local.pots.recordsOf(local.chain.id, fresh.pot);
    const code = await local.publicClient.getCode({ address: fresh.pot });
    const binding = records[0]!.binding!;
    const transfer = { to: recipient, data: "0x" as Hex, value: 1_000n };
    const refused = cookOn(absent.pot, getAddress(binding.engine));
    const setup: RunInput["setup"] = async (reach) =>
      [transfer, refused].map(
        (tx) =>
          ({
            action: `send to ${tx.to}`,
            reason: "setup before cook",
            offer: "Send",
            estimate: "gas",
            planned: {
              what: "setup",
              chainId: local.chain.id,
              to: tx.to,
              data: tx.data,
              value: `0x${tx.value.toString(16)}`,
            },
            send: () => reach.cook!.send!(tx),
          }) satisfies SetupStep,
      );
    await expect(
      inScope(() =>
        runCommand(
          {
            file: program,
            text: PROGRAM,
            chain: local.chain,
            defines: {},
            target: { pot: fresh.pot },
            args: { from: "--args", values: ["41"] },
            rpcUrl: local.rpcUrl,
            account: privateKeyToAccount(fresh.key),
            approver: { auto: true, canAsk: false, approve: async () => true },
            setup,
          },
          nodeIo(),
        ),
      ),
    ).rejects.toBeInstanceOf(CliError);
    expect(String(await local.publicClient.getBalance({ address: recipient }))).toBe("0");
    expect(local.pots.recordsOf(local.chain.id, fresh.pot)).toEqual(records);
    await unchanged(fresh, balance, code);
  }, 120_000);

  it("retains a landed transfer's raw result when a later deployment is malformed", async () => {
    const fresh = await owner("malformed-after");
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const first = await signedBy(fresh, { to: recipient, data: "0x", value: 1_000n }, 0);
    const landed = jsonOf(await send(first)) as { sent: Array<{ hash: string }> };
    const balance = await local.publicClient.getBalance({ address: fresh.address });
    const result = await send(
      first,
      await signedBy(fresh, malformed("function deployPot(address owner, bytes32 salt)"), 1),
    );
    expect(result.code).toBe(1);
    const out = JSON.parse(result.stdout);
    expect(out).toMatchObject({
      ok: false,
      sent: [
        { status: "success", hash: landed.sent[0]!.hash },
        { status: "failed", hash: "" },
      ],
    });
    expect(out.sent).toHaveLength(2);
    expect(String(await local.publicClient.getBalance({ address: recipient }))).toBe("1000");
    expect(local.pots.recordsOf(local.chain.id, fresh.pot)).toEqual([]);
    await unchanged(fresh, balance, undefined, 1);
  }, 120_000);
});

describe("offline prediction never authenticates an execution binding", () => {
  const OWNER = getAddress("0x5a0Ce0000000000000000000000000000000Beef");
  let work: string;
  let program: string;
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "sauce-pot-guard-offline-"));
    program = join(work, "next.sauce.ts");
    writeFileSync(program, PROGRAM);
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it.each([
    ["tx", ["--value", "1234"]],
    ["sign", ["--max-fee", "1234"]],
  ])("%s refuses to produce a cook without online authentication", async (each, more) => {
    const result = await sauce(
      each,
      program,
      "--chain",
      "ethereum",
      "--offline",
      "--owner",
      OWNER,
      ...more,
      "--args",
      "41",
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
  });

  it("pot permits prediction without returning an authenticated binding", async () => {
    const result = jsonOf(await sauce("pot", "--chain", "ethereum", "--offline", "--owner", OWNER));
    expect(result).toMatchObject({ owner: OWNER });
    expect(result.binding).toBeUndefined();
    expect(result.deployed).not.toBe(true);
  });

  it.each([
    ["pot", () => ["pot"], []],
    ["tx --fund", () => ["tx", program, "--value", "1234", "--fund", "USDC:1"], ["--args", "41"]],
    ["sign", () => ["sign", program, "--max-fee", "1234"], ["--args", "41"]],
  ] as const)("%s refuses owner zero without an endpoint or output", async (_, words, tail) => {
    const result = await sauce(
      ...words(),
      "--chain",
      "ethereum",
      "--offline",
      "--owner",
      zeroAddress,
      ...tail,
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
  });
});
