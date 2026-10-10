/**
 * A registry call run through viem — `read`, `simulate` and `write` on a `ContractCall` — against a
 * local anvil standing in for Base (chain 8453). Nothing reaches a live chain: the contract is
 * Uniswap's own `UniswapV3Factory` bytecode from `@uniswap/v3-core`, deployed here, and its state is
 * then replayed onto the factory's REGISTRY address (code and every storage slot, from
 * `anvil_dumpState`), so `Base.UniswapV3.Factory` reads it exactly where the SDK points.
 *
 * Needs `anvil` on PATH: skipped without it locally, and a failure in CI, where Foundry is set up.
 */
import { spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  hexToBytes,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, mainnet } from "viem/chains";

import { Base } from "../src/index.js";
import { freePortSync, spawnAnvil } from "./anvil-process.js";

const ANVIL = spawnSync("anvil", ["--version"]).status === 0;
const describeAnvil = ANVIL ? describe : describe.skip;
// A skipped suite and a passing one are the same line in jest's summary: in CI, where Foundry is
// installed, an absent anvil is a failure rather than a silent no-op.
if (!ANVIL && process.env.CI) throw new Error("anvil is not on PATH in CI — this suite must run.");

// Anvil's first well-known development key: a local test account, funded at genesis.
const DEPLOYER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
/** A port from the OS, so no other suite or checkout meets this one on it (`anvil-process.ts`). */
const PORT = freePortSync();
const transport = http(`http://127.0.0.1:${PORT}`);
const publicClient = createPublicClient({ chain: base, transport });
const walletClient = createWalletClient({ account: DEPLOYER, chain: base, transport });
const testClient = createTestClient({ mode: "anvil", transport });

const { bytecode: FACTORY_CREATION } = JSON.parse(
  readFileSync(
    createRequire(import.meta.url).resolve(
      "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json",
    ),
    "utf8",
  ),
) as { bytecode: Hex };

const USDC = Base.USDC.address;
const WETH = Base.WETH.address;

let anvil: ChildProcess | undefined;
/** The factory as deployed here — the address `.at(...)` reaches. */
let deployed: Address;

describeAnvil("ContractCall viem helpers, against a local Base", () => {
  beforeAll(async () => {
    anvil = await spawnAnvil(PORT, ["--chain-id", "8453"]);
    const hash = await walletClient.sendTransaction({ data: FACTORY_CREATION, to: null });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    deployed = receipt.contractAddress!;
  }, 30_000);

  afterAll(async () => {
    if (anvil === undefined || anvil.exitCode !== null) return;
    const exited = once(anvil, "exit");
    anvil.kill();
    await exited;
  });

  it("simulate, then write, a state-changing method; read the view it changed", async () => {
    const factory = Base.UniswapV3.Factory.at(deployed);

    const simulated = await factory.createPool(USDC, WETH, 500).simulate(publicClient, {
      account: DEPLOYER.address,
    });
    const predicted: Address = simulated.result;
    expect(predicted).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const hash = await factory.createPool(USDC, WETH, 500).write(walletClient);
    expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");

    const pool: Address = await factory.getPool(USDC, WETH, 500).read(publicClient);
    expect(pool).toBe(predicted);
  });

  it("reads at the REGISTRY address, once that address holds the factory's code and state", async () => {
    const registry = Base.UniswapV3.Factory.address!;
    expect(registry).not.toBe(deployed);
    const dumped = gunzipSync(hexToBytes(await testClient.dumpState()));
    const accounts = (
      JSON.parse(new TextDecoder().decode(dumped)) as {
        accounts: Record<string, { code: Hex; storage: Record<Hex, Hex> }>;
      }
    ).accounts;
    const state = accounts[deployed.toLowerCase()] ?? accounts[deployed];
    expect(state).toBeDefined();
    await testClient.setCode({ address: registry, bytecode: state!.code });
    for (const [index, value] of Object.entries(state!.storage)) {
      await testClient.setStorageAt({ address: registry, index: index as Hex, value });
    }

    const viaRegistry = await Base.UniswapV3.Factory.getPool(USDC, WETH, 500).read(publicClient);
    const viaDeployment = await Base.UniswapV3.Factory.at(deployed)
      .getPool(USDC, WETH, 500)
      .read(publicClient);
    expect(viaRegistry).toBe(viaDeployment);
    expect(viaRegistry).not.toBe("0x0000000000000000000000000000000000000000");
  });

  it("read runs a state-changing method as an eth_call: its result, nothing sent", async () => {
    const factory = Base.UniswapV3.Factory.at(deployed);
    const wouldCreate: Address = await factory.createPool(USDC, WETH, 3000).read(publicClient);
    expect(wouldCreate).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(await factory.getPool(USDC, WETH, 3000).read(publicClient)).toBe(
      "0x0000000000000000000000000000000000000000",
    );
  });

  it("a client without a chain is asked for its chain id, and accepted when it matches", async () => {
    const bare = createPublicClient({ transport });
    const pool = await Base.UniswapV3.Factory.at(deployed).getPool(USDC, WETH, 500).read(bare);
    expect(pool).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("a client on another chain is refused before anything is sent", async () => {
    const elsewhere = createPublicClient({ chain: mainnet, transport });
    await expect(
      Base.UniswapV3.Factory.at(deployed).getPool(USDC, WETH, 500).read(elsewhere),
    ).rejects.toThrow(/the client is on chain 1, but this call is base's \(chain 8453\)/);
  });

  it("simulate and write refuse a view method, which read covers", async () => {
    const call = Base.UniswapV3.Factory.at(deployed).getPool(USDC, WETH, 500) as unknown as {
      simulate(client: unknown, options: unknown): Promise<unknown>;
      write(client: unknown): Promise<unknown>;
    };
    await expect(call.simulate(publicClient, { account: DEPLOYER.address })).rejects.toThrow(
      /getPool is view — use read\(client\)/,
    );
    await expect(call.write(walletClient)).rejects.toThrow(/getPool is view — use read\(client\)/);
  });
});
