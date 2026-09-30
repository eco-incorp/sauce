/**
 * The `sauce` command against a chain: what it prints, sent, lands. On local anvils running the
 * released gated stack (`evm/gated-engine.ts`, deployed from the pinned creation code), with the
 * released engine installed at the address the SDK records, so the CLI runs with no override.
 *
 * Ethereum, the example the `sauce-run` skill ships (`pay.sauce.ts`):
 *   1. `sauce tx --rpc-url` before the Pot exists says so, and names the `sauce pot` to run;
 *   2. `sauce pot` prints the Kitchen.deployPot transaction — sent, it lands the Pot it predicted;
 *   3. the Pot is funded with a standard ERC-20 and a USDT-shaped one (no return values), planted
 *      at the registry's USDC and USDT addresses so the program names them as the SDK does;
 *   4. `sauce tx --rpc-url` reads the Kitchen's (non-zero) fee and the Pot's owner; its
 *      `{ to, data, value }`, sent from the owner with viem, pays the recipient in both tokens;
 *   5. the `cast send` line `sauce tx` prints is run VERBATIM through a shell — only its two
 *      `<…>` placeholders filled — and its effect asserted too.
 *
 * Base and Arbitrum, the skill's `split.sauce.ts`: ONE source with a typed `main(token: Address,
 * recipients: Address[], amount: Uint256, alsoUsdc: bool)`, compiled for each chain (so `USDC` is
 * each chain's own), its arguments encoded by `sauce tx --args`, executed on each chain's anvil.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite (CLAUDE.md), and a hard
 * failure without it — or without `cast` — in CI.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  numberToHex,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type TestClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { requireChain, type CanonicalChain } from "../src/chains/canonical.js";
import { v12EngineAddress } from "../src/deployments/index.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";
import { gateAnchors, installEngineAt, startGatedEngine } from "./evm/gated-engine.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;
if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI. This suite must never skip there — see the " +
      '"Fetch the v12 engines" step in .github/workflows/ci.yml.',
  );
}
const HAS_CAST = spawnSync("cast", ["--version"], { stdio: "ignore" }).status === 0;
if (!HAS_CAST && process.env.CI) {
  throw new Error("`cast` is not on PATH in CI: Foundry is installed there, so this is a failure.");
}

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "std/token/fixtures");
const fixture = (name: string): Hex =>
  (JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as { creationCode: Hex })
    .creationCode;
/** The examples the `sauce-run` agent skill ships: executing them here keeps them from rotting. */
const EXAMPLES = join(HERE, "../../skills/sauce-run/examples");
const PAY = join(EXAMPLES, "pay.sauce.ts");
const SPLIT = join(EXAMPLES, "split.sauce.ts");

/** Anvil's first two dev accounts: the Kitchen's owner, and the Pot's. Public keys, local only. */
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OWNER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const DEPLOYER = privateKeyToAccount(DEPLOYER_KEY);
const OWNER = privateKeyToAccount(OWNER_KEY);

const RECIPIENT: Address = "0x6666666666666666666666666666666666666666";
const SECOND_RECIPIENT: Address = "0x7777777777777777777777777777777777777777";
const AMOUNT = 1_000_000n;
const FUNDED = 10_000_000n;
/** Non-zero, so the fee `--rpc-url` reads is one a cook provably pays. */
const FEE = 1_234n;

const WORKER = Number(process.env.JEST_WORKER_ID ?? "1") % 50;

const erc20 = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
]);
const USDT_CREATION = `${fixture("NoReturnERC20")}${encodeAbiParameters(
  [{ type: "string" }, { type: "string" }, { type: "uint8" }],
  ["Tether USD", "USDT", 6],
).slice(2)}` as Hex;

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function sauce(...argv: string[]): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    ...nodeIo(),
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  };

  return { code: await runCli(argv, io), stdout, stderr };
}

const jsonOf = (run: Run): Record<string, unknown> => {
  if (run.code !== 0) throw new Error(`sauce exited ${run.code}: ${run.stderr}`);

  return JSON.parse(run.stdout) as Record<string, unknown>;
};

/** One anvil standing in for `chain`, with the released gated stack on it. */
interface LocalChain {
  readonly chain: CanonicalChain;
  readonly rpcUrl: string;
  readonly publicClient: PublicClient;
  readonly deployer: WalletClient;
  readonly owner: WalletClient;
  readonly testClient: TestClient;
  /** Sends `data` to `to` from `from`, and waits for it to succeed. */
  send(from: WalletClient, to: Address, data: Hex, value?: bigint): Promise<void>;
  /** Deploys `creationCode` and moves its runtime to `at` (a registry token address), or leaves it. */
  plant(creationCode: Hex, at?: Address): Promise<Address>;
  mint(token: Address, to: Address, amount: bigint): Promise<void>;
  balanceOf(token: Address, holder: Address): Promise<bigint>;
  stop(): Promise<void>;
}

async function startChain(slug: string, port: number): Promise<LocalChain> {
  const chain = requireChain(slug);
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil: ChildProcess = spawn(
    "anvil",
    ["--port", String(port), "--chain-id", String(chain.id), "--silent"],
    { stdio: "ignore" },
  );
  // `connection: close`: pooled keep-alive sockets would outlive the suite.
  const transport = http(rpcUrl, { fetchOptions: { headers: { connection: "close" } } });
  const publicClient = createPublicClient({ transport });
  const testClient = createTestClient({ mode: "anvil", transport });
  const deployer = createWalletClient({ account: DEPLOYER, transport });
  const owner = createWalletClient({ account: OWNER, transport });
  for (const deadline = Date.now() + 20_000; ;) {
    try {
      await publicClient.getChainId();
      break;
    } catch {
      if (Date.now() > deadline) throw new Error(`anvil did not come up on ${rpcUrl}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const send = async (from: WalletClient, to: Address, data: Hex, value = 0n): Promise<void> => {
    const hash = await from.sendTransaction({
      account: from.account!,
      chain: null,
      to,
      data,
      value,
    });
    const { status } = await publicClient.waitForTransactionReceipt({ hash });
    if (status !== "success") throw new Error(`a transaction to ${to} reverted`);
  };
  const plant = async (creationCode: Hex, at?: Address): Promise<Address> => {
    const hash = await deployer.sendTransaction({
      account: DEPLOYER,
      chain: null,
      data: creationCode,
    });
    const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash });
    if (at === undefined) return contractAddress!;
    const code = await publicClient.getCode({ address: contractAddress! });
    await testClient.setCode({ address: at, bytecode: code! });

    return at;
  };

  const creationCode = readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex;
  const stack = await startGatedEngine(
    { publicClient, walletClient: deployer, testClient },
    DEPLOYER.address,
    creationCode,
  );
  // The CLI names the engine the SDK records; put the deployed one there.
  await installEngineAt({ publicClient, testClient }, stack.engine, getAddress(v12EngineAddress()));
  await send(
    deployer,
    gateAnchors().kitchen,
    encodeFunctionData({
      abi: parseAbi(["function setExecutionFee(uint256)"]),
      functionName: "setExecutionFee",
      args: [FEE],
    }),
  );

  return {
    chain,
    rpcUrl,
    publicClient,
    deployer,
    owner,
    testClient,
    send,
    plant,
    mint: (token, to, amount) =>
      send(
        deployer,
        token,
        encodeFunctionData({ abi: erc20, functionName: "mint", args: [to, amount] }),
      ),
    balanceOf: (token, holder) =>
      publicClient.readContract({
        address: token,
        abi: erc20,
        functionName: "balanceOf",
        args: [holder],
      }),
    stop: async () => {
      if (anvil.exitCode !== null) return;
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    },
  };
}

/** The registry's address for `symbol` on `chain`, as the program names it. */
const registered = (chain: CanonicalChain, symbol: string): Address =>
  getAddress(numberToHex(registryTokenAddress(chain, symbol)!, { size: 20 }));

/** Deploys the owner's Pot with the transaction `sauce pot` prints, returning its address. */
async function deployPot(local: LocalChain): Promise<Address> {
  const out = jsonOf(
    await sauce("pot", "--owner", OWNER.address, "--chain", local.chain.slug, "--json"),
  );
  // Anyone may send it: the deployer does, and the Pot is still the owner's.
  await local.send(local.deployer, out.to as Address, out.data as Hex);

  return out.pot as Address;
}

describeEvm("sauce, sent to a chain", () => {
  let ethereum: LocalChain;
  let work: string;
  let usdc: Address;
  let usdt: Address;
  let pot: Address;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-cli-e2e-"));
    ethereum = await startChain("ethereum", 8700 + WORKER);
    // The registry's tokens, as code at their registered addresses: a standard OpenZeppelin ERC-20
    // as USDC, and a USDT-shaped one whose writes return nothing as USDT.
    usdc = await ethereum.plant(fixture("MockERC20"), registered(ethereum.chain, "USDC"));
    usdt = await ethereum.plant(USDT_CREATION, registered(ethereum.chain, "USDT"));
  }, 120_000);

  afterAll(async () => {
    rmSync(work, { recursive: true, force: true });
    await ethereum?.stop();
  });

  const defines = (recipient: Address): string[] => [
    "--define",
    `RECIPIENT=${recipient}`,
    "--define",
    `AMOUNT=${AMOUNT}`,
  ];

  it("says the Pot is not deployed yet, and how to deploy it", async () => {
    const run = await sauce(
      "tx",
      PAY,
      "--owner",
      OWNER.address,
      ...defines(RECIPIENT),
      "--rpc-url",
      ethereum.rpcUrl,
    );
    expect(run.stderr).toBe("");
    expect(run.stdout).toContain(`value  ${FEE}`);
    expect(run.stdout).toContain(
      `It is NOT deployed. Deploy it first (sauce pot --owner ${OWNER.address} --chain ethereum), then fund it.`,
    );
    expect(run.stdout).not.toContain(ethereum.rpcUrl);
  }, 60_000);

  it("`sauce pot` gives the deploy transaction, and it lands the Pot it predicted", async () => {
    const predicted = jsonOf(
      await sauce("pot", "--owner", OWNER.address, "--chain", "ethereum", "--json"),
    ).pot as Address;
    expect(await ethereum.publicClient.getCode({ address: predicted })).toBeUndefined();
    pot = await deployPot(ethereum);
    expect(pot).toBe(predicted);
    expect(await ethereum.publicClient.getCode({ address: pot })).toMatch(/^0x[0-9a-f]{2,}/);
    const owner = await ethereum.publicClient.readContract({
      address: pot,
      abi: parseAbi(["function owner() view returns (address)"]),
      functionName: "owner",
    });
    expect(owner).toBe(OWNER.address);
  }, 60_000);

  it("`sauce tx`, sent as printed, pays the recipient in USDC and USDT from the Pot", async () => {
    for (const token of [usdc, usdt]) await ethereum.mint(token, pot, FUNDED);
    const out = jsonOf(
      await sauce(
        "tx",
        PAY,
        "--owner",
        OWNER.address,
        ...defines(RECIPIENT),
        "--rpc-url",
        ethereum.rpcUrl,
        "--json",
      ),
    );
    expect(out).toMatchObject({
      chain: "ethereum",
      to: pot,
      value: FEE.toString(),
      pot: { address: pot, owner: OWNER.address, deployed: true },
    });
    const kitchenBefore = await ethereum.publicClient.getBalance({
      address: gateAnchors().kitchen,
    });

    await ethereum.send(
      ethereum.owner,
      out.to as Address,
      out.data as Hex,
      BigInt(out.value as string),
    );

    expect(await ethereum.balanceOf(usdc, RECIPIENT)).toBe(AMOUNT);
    expect(await ethereum.balanceOf(usdt, RECIPIENT)).toBe(AMOUNT);
    expect(await ethereum.balanceOf(usdc, pot)).toBe(FUNDED - AMOUNT);
    expect(await ethereum.balanceOf(usdt, pot)).toBe(FUNDED - AMOUNT);
    expect(await ethereum.publicClient.getBalance({ address: gateAnchors().kitchen })).toBe(
      kitchenBefore + FEE,
    );
  }, 60_000);

  it("refuses a --value below the Kitchen's fee, which the cook would revert on", async () => {
    const run = await sauce(
      "tx",
      PAY,
      "--owner",
      OWNER.address,
      ...defines(RECIPIENT),
      "--rpc-url",
      ethereum.rpcUrl,
      "--value",
      "1",
    );
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(
      new RegExp(`--value 1 is below the Kitchen's execution fee on ethereum, ${FEE} wei`),
    );
  }, 60_000);

  (HAS_CAST ? it : it.skip)(
    "the printed `cast send` line, run verbatim, lands",
    async () => {
      // The zero-import `@sauce/token` function this time, on a Pot named outright, fee given.
      const program = join(work, "usdt.sauce.ts");
      writeFileSync(program, "// @chain ethereum\ntransfer(USDT, RECIPIENT, AMOUNT);\n");
      const run = await sauce(
        "tx",
        program,
        "--pot",
        pot,
        ...defines(SECOND_RECIPIENT),
        "--value",
        String(FEE),
      );
      expect(run.stderr).toBe("");
      const line = run.stdout.split("\n").find((text) => text.startsWith("cast send "));
      expect(line).toMatch(/--rpc-url <RPC_URL> --private-key <PRIVATE_KEY>$/);
      const command = line!
        .replace("<RPC_URL>", ethereum.rpcUrl)
        .replace("<PRIVATE_KEY>", OWNER_KEY);

      const cast = spawnSync("sh", ["-c", command], { encoding: "utf8" });
      expect(cast.stderr).toBe("");
      expect(cast.status).toBe(0);
      expect(cast.stdout).toMatch(/status\s+1 \(success\)/);

      expect(await ethereum.balanceOf(usdt, SECOND_RECIPIENT)).toBe(AMOUNT);
      expect(await ethereum.balanceOf(usdt, pot)).toBe(FUNDED - 2n * AMOUNT);
    },
    60_000,
  );
});

describeEvm("a typed main, compiled for Base and for Arbitrum, run with --args", () => {
  const chains: Record<string, LocalChain> = {};
  const RECIPIENTS: Address[] = [RECIPIENT, SECOND_RECIPIENT];

  beforeAll(async () => {
    chains.base = await startChain("base", 8800 + WORKER);
    chains.arbitrum = await startChain("arbitrum", 8900 + WORKER);
  }, 120_000);

  afterAll(async () => {
    for (const local of Object.values(chains)) await local.stop();
  });

  it("compiles one source into a program per chain, each naming its own USDC", async () => {
    const base = jsonOf(await sauce("compile", SPLIT, "--chain", "base", "--json"));
    const arbitrum = jsonOf(await sauce("compile", SPLIT, "--chain", "arbitrum", "--json"));
    const usdcOf = (slug: string) => registered(requireChain(slug), "USDC").slice(2).toLowerCase();
    expect(base.bytecode).toContain(usdcOf("base"));
    expect(arbitrum.bytecode).toContain(usdcOf("arbitrum"));
    expect(base.bytecode).not.toContain(usdcOf("arbitrum"));
    for (const out of [base, arbitrum]) {
      expect(out.entryEncoding).toBe("abi-v1");
      expect(out.entryParams).toEqual([
        { name: "token", type: "Address" },
        { name: "recipients", type: "Address[]" },
        { name: "amount", type: "Uint256" },
        { name: "alsoUsdc", type: "bool" },
      ]);
    }
  }, 60_000);

  for (const [slug, alsoUsdc] of [
    ["base", true],
    ["arbitrum", false],
  ] as const) {
    it(`on ${slug}, pays each recipient as the arguments say (alsoUsdc: ${alsoUsdc})`, async () => {
      const local = chains[slug]!;
      const usdc = await local.plant(fixture("MockERC20"), registered(local.chain, "USDC"));
      const token = await local.plant(fixture("MockERC20"));
      const pot = await deployPot(local);
      for (const funded of [usdc, token]) await local.mint(funded, pot, FUNDED);

      const out = jsonOf(
        await sauce(
          "tx",
          SPLIT,
          "--chain",
          slug,
          "--owner",
          OWNER.address,
          "--rpc-url",
          local.rpcUrl,
          "--json",
          "--args",
          token,
          JSON.stringify(RECIPIENTS),
          String(AMOUNT),
          String(alsoUsdc),
        ),
      );
      expect(out).toMatchObject({ to: pot, value: FEE.toString(), entryEncoding: "abi-v1" });
      await local.send(local.owner, pot, out.data as Hex, FEE);

      for (const recipient of RECIPIENTS) {
        expect(await local.balanceOf(token, recipient)).toBe(AMOUNT);
        expect(await local.balanceOf(usdc, recipient)).toBe(alsoUsdc ? AMOUNT : 0n);
      }
      expect(await local.balanceOf(token, pot)).toBe(FUNDED - 2n * AMOUNT);
      expect(await local.balanceOf(usdc, pot)).toBe(alsoUsdc ? FUNDED - 2n * AMOUNT : FUNDED);
    }, 60_000);
  }
});
