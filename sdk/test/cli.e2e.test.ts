/**
 * The `sauce` command against a chain: what it prints, sent, lands. On a local anvil with the
 * released gated stack (`evm/gated-engine.ts`, deployed from the pinned creation code), and the
 * released engine installed at the address the SDK records, so the CLI runs with no override:
 *
 *   1. `sauce tx --rpc-url` before the Pot exists says so, and names the `sauce pot` to run;
 *   2. `sauce pot` prints the Kitchen.deployPot transaction — sent, it lands the Pot it predicted;
 *   3. the Pot is funded with a standard ERC-20 and a USDT-shaped one (no return values), planted
 *      at the registry's USDC and USDT addresses so the program names them as the SDK does;
 *   4. `sauce tx --rpc-url` reads the Kitchen's (non-zero) fee and the Pot's owner; its
 *      `{ to, data, value }`, sent from the owner with viem, pays the recipient in both tokens;
 *   5. the `cast send` line `sauce tx` prints is run VERBATIM through a shell — only its two
 *      `<…>` placeholders filled — and its effect asserted too.
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
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { requireChain } from "../src/chains/canonical.js";
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
/** The example the `sauce-run` agent skill ships: executing it here keeps it from rotting. */
const PAY = join(HERE, "../../skills/sauce-run/examples/pay.sauce.ts");

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

const PORT = 8700 + (Number(process.env.JEST_WORKER_ID ?? "1") % 100);
const RPC_URL = `http://127.0.0.1:${PORT}`;
const CHAIN = requireChain("ethereum");

const transport = http(RPC_URL, { fetchOptions: { headers: { connection: "close" } } });
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: DEPLOYER, transport });
const ownerClient = createWalletClient({ account: OWNER, transport });

const erc20 = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
]);

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

const waitForRpc = async (deadline: number): Promise<void> => {
  for (;;) {
    try {
      await publicClient.getChainId();
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`anvil did not come up on ${RPC_URL}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
};

const landed = async (hash: Hex): Promise<void> => {
  const { status } = await publicClient.waitForTransactionReceipt({ hash });
  if (status !== "success") throw new Error(`transaction ${hash} reverted`);
};

const deployCode = async (creationCode: Hex): Promise<Hex> => {
  const hash = await walletClient.sendTransaction({ chain: null, data: creationCode });
  const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash });
  const code = await publicClient.getCode({ address: contractAddress! });
  if (!code) throw new Error("a token deployment produced no code");

  return code;
};

const balanceOf = (token: Address, holder: Address): Promise<bigint> =>
  publicClient.readContract({
    address: token,
    abi: erc20,
    functionName: "balanceOf",
    args: [holder],
  });

describeEvm("sauce, sent to a chain", () => {
  let anvil: ChildProcess;
  let work: string;
  let usdc: Address;
  let usdt: Address;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-cli-e2e-"));
    anvil = spawn("anvil", ["--port", String(PORT), "--chain-id", String(CHAIN.id), "--silent"], {
      stdio: "ignore",
    });
    await waitForRpc(Date.now() + 20_000);
    const creationCode = readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex;
    const sauceStack = await startGatedEngine(
      { publicClient, walletClient, testClient },
      DEPLOYER.address,
      creationCode,
    );
    // The CLI names the engine the SDK records; put the deployed one there.
    await installEngineAt(
      { publicClient, testClient },
      sauceStack.engine,
      getAddress(v12EngineAddress()),
    );
    await landed(
      await walletClient.sendTransaction({
        chain: null,
        to: gateAnchors().kitchen,
        data: encodeFunctionData({
          abi: parseAbi(["function setExecutionFee(uint256)"]),
          functionName: "setExecutionFee",
          args: [FEE],
        }),
      }),
    );

    // The registry's tokens, as code at their registered addresses: a standard OpenZeppelin ERC-20
    // as USDC, and a USDT-shaped one whose writes return nothing as USDT.
    const registered = (symbol: string): Address =>
      getAddress(numberToHex(registryTokenAddress(CHAIN, symbol)!, { size: 20 }));
    usdc = registered("USDC");
    usdt = registered("USDT");
    const usdtCreation = `${fixture("NoReturnERC20")}${encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "uint8" }],
      ["Tether USD", "USDT", 6],
    ).slice(2)}` as Hex;
    await testClient.setCode({ address: usdc, bytecode: await deployCode(fixture("MockERC20")) });
    await testClient.setCode({ address: usdt, bytecode: await deployCode(usdtCreation) });
  }, 120_000);

  afterAll(async () => {
    rmSync(work, { recursive: true, force: true });
    if (anvil !== undefined && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  const defines = (recipient: Address): string[] => [
    "--define",
    `RECIPIENT=${recipient}`,
    "--define",
    `AMOUNT=${AMOUNT}`,
  ];

  let pot: Address;

  it("says the Pot is not deployed yet, and how to deploy it", async () => {
    const run = await sauce(
      "tx",
      PAY,
      "--owner",
      OWNER.address,
      ...defines(RECIPIENT),
      "--rpc-url",
      RPC_URL,
    );
    expect(run.stderr).toBe("");
    expect(run.stdout).toContain(`value  ${FEE}`);
    expect(run.stdout).toContain(
      `It is NOT deployed. Deploy it first (sauce pot --owner ${OWNER.address} --chain ethereum), then fund it.`,
    );
    expect(run.stdout).not.toContain(RPC_URL);
  }, 60_000);

  it("`sauce pot` gives the deploy transaction, and it lands the Pot it predicted", async () => {
    const out = jsonOf(
      await sauce("pot", "--owner", OWNER.address, "--chain", "ethereum", "--json"),
    );
    pot = out.pot as Address;
    expect(await publicClient.getCode({ address: pot })).toBeUndefined();
    // Anyone may send it: the deployer does, and the Pot is still the owner's.
    await landed(
      await walletClient.sendTransaction({
        chain: null,
        to: out.to as Address,
        data: out.data as Hex,
        value: BigInt(out.value as string),
      }),
    );
    expect(await publicClient.getCode({ address: pot })).toMatch(/^0x[0-9a-f]{2,}/);
    const owner = await publicClient.readContract({
      address: pot,
      abi: parseAbi(["function owner() view returns (address)"]),
      functionName: "owner",
    });
    expect(owner).toBe(OWNER.address);
  }, 60_000);

  it("`sauce tx`, sent as printed, pays the recipient in USDC and USDT from the Pot", async () => {
    for (const token of [usdc, usdt]) {
      await landed(
        await walletClient.sendTransaction({
          chain: null,
          to: token,
          data: encodeFunctionData({ abi: erc20, functionName: "mint", args: [pot, FUNDED] }),
        }),
      );
    }
    const out = jsonOf(
      await sauce(
        "tx",
        PAY,
        "--owner",
        OWNER.address,
        ...defines(RECIPIENT),
        "--rpc-url",
        RPC_URL,
        "--json",
      ),
    );
    expect(out).toMatchObject({
      chain: "ethereum",
      to: pot,
      value: FEE.toString(),
      pot: { address: pot, owner: OWNER.address, deployed: true },
    });
    const kitchenBefore = await publicClient.getBalance({ address: gateAnchors().kitchen });

    await landed(
      await ownerClient.sendTransaction({
        chain: null,
        to: out.to as Address,
        data: out.data as Hex,
        value: BigInt(out.value as string),
      }),
    );

    expect(await balanceOf(usdc, RECIPIENT)).toBe(AMOUNT);
    expect(await balanceOf(usdt, RECIPIENT)).toBe(AMOUNT);
    expect(await balanceOf(usdc, pot)).toBe(FUNDED - AMOUNT);
    expect(await balanceOf(usdt, pot)).toBe(FUNDED - AMOUNT);
    expect(await publicClient.getBalance({ address: gateAnchors().kitchen })).toBe(
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
      RPC_URL,
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
      const command = line!.replace("<RPC_URL>", RPC_URL).replace("<PRIVATE_KEY>", OWNER_KEY);

      const cast = spawnSync("sh", ["-c", command], { encoding: "utf8" });
      expect(cast.stderr).toBe("");
      expect(cast.status).toBe(0);
      expect(cast.stdout).toMatch(/status\s+1 \(success\)/);

      expect(await balanceOf(usdt, SECOND_RECIPIENT)).toBe(AMOUNT);
      expect(await balanceOf(usdt, pot)).toBe(FUNDED - 2n * AMOUNT);
    },
    60_000,
  );
});
