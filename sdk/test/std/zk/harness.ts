/**
 * The chain `@sauce/zk`'s execution suites run on: an anvil with the released gated engine and
 * Kitchen and v12 #571's Router, whose fallback runs the handler a Pot registered for a selector,
 * and the owner's Private Pot, funded so a handler's cook can pay the Kitchen's fee.
 *
 * A suite stands up the coprocessor's own contracts beside it (their runtimes captured from the
 * chain, only the proof verifier mocked), installs `@sauce/zk`'s handlers on the Pot with the
 * program the SDK writes for the package, cooks the programs that make requests, and calls back as
 * the coprocessor does.
 *
 * GATED twice, as `@sauce/async`'s suite is: on SAUCE_V12_RUNTIME_CREATION_HEX, and on
 * SAUCE_V12_ROUTER_CREATION_HEX, #571's Router creation code, which no release publishes yet. A
 * `.catch` that reads its reason needs an engine built from the compiler's tree until the release
 * carries the fix (`@sauce/async`'s suite says which).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";

import {
  bytesToHex,
  concat,
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  parseEther,
  toHex,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  type TestClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { encodeEntryArguments } from "../../../src/routes/entry.js";
import { handlersInstallSource, packageInstall } from "../../../src/routes/handlers.js";
import { compileSauceProgram } from "../../../src/routes/sauce-route.js";
import { routerUnderTest, startGatedEngine, type GatedEngine } from "../../evm/gated-engine.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const ROUTER = routerUnderTest();

/** `describe` where the engine and #571's Router are given, `describe.skip` elsewhere (CI). */
export const describeOnRouter = RUNTIME_HEX_PATH && ROUTER !== undefined ? describe : describe.skip;

/** Anvil's first two dev accounts: the Kitchen's owner and the Pot's, and a stranger. */
export const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
export const STRANGER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

/** The Kitchen's fee: non-zero, so a callback's single fee can be counted. */
export const FEE = 1_234n;

const potAbi = parseAbi(["function cook(address engine, bytes program) payable returns (bytes)"]);
const kitchenAbi = parseAbi(["function setExecutionFee(uint256 fee)"]);

/** A transaction's outcome: a revert is an answer, not a throw. */
export interface Sent {
  readonly ok: boolean;
  readonly hash: Hex;
  readonly logs: readonly Log[];
  readonly gasUsed: bigint;
  readonly contractAddress: Address | null | undefined;
}

export interface ZkChain {
  readonly slug: string;
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly publicClient: PublicClient;
  readonly testClient: TestClient;
  readonly stack: GatedEngine;
  readonly owner: WalletClient;
  readonly stranger: WalletClient;
  /** A wallet for `account`, funded with ten ether. */
  wallet(account: PrivateKeyAccount): Promise<WalletClient>;
  /** A wallet sending as `address`, whose key the suite does not hold, funded with ten ether. */
  impersonate(address: Address): Promise<WalletClient>;
  send(from: WalletClient, to: Address | undefined, data: Hex, value?: bigint): Promise<Sent>;
  /** `source` compiled by the SDK for the chain, with `args` for its `main`. */
  compiled(source: string, args?: readonly unknown[]): Hex;
  /** `program` cooked on the owner's Pot, paying the fee. */
  cook(program: Hex): Promise<Sent>;
  /** `specifier`'s handlers, installed with the program the SDK writes for the package. */
  installPackage(specifier: string): Promise<readonly Hex[]>;
  /** What a call reverts with, replayed as an `eth_call`. */
  revertOf(from: Address, to: Address, data: Hex, value?: bigint): Promise<Hex>;
  /** A word of the Pot's storage. */
  slot(at: Hex): Promise<bigint>;
  /** The gas the first call into `to` starting with `selector` used, from `hash`'s call trace. */
  callGas(hash: Hex, to: Address, selector: Hex): Promise<bigint>;
  stop(): Promise<void>;
}

/** A program's `require(cond, message)` reverts with the message's bytes as they are. */
export const text = (data: Hex): string => Buffer.from(data.slice(2), "hex").toString("utf8");

/** An anvil for `slug` at `chainId` on `port`, with the gated stack on #571's Router. */
export async function startZkChain(slug: string, chainId: number, port: number): Promise<ZkChain> {
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil: ChildProcess = spawn(
    "anvil",
    ["--port", String(port), "--chain-id", String(chainId), "--silent"],
    { stdio: "ignore" },
  );
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ transport });
  const testClient = createTestClient({ mode: "anvil", transport });
  for (const deadline = Date.now() + 20_000; ;) {
    try {
      await publicClient.getChainId();
      break;
    } catch {
      if (Date.now() > deadline) throw new Error(`anvil did not come up on ${rpcUrl}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const owner = createWalletClient({ account: OWNER, transport });
  const stranger = createWalletClient({ account: STRANGER, transport });
  const stack = await startGatedEngine(
    { publicClient, walletClient: owner, testClient },
    OWNER.address,
    readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex,
    { routerCreationCode: ROUTER },
  );

  const send = async (
    from: WalletClient,
    to: Address | undefined,
    data: Hex,
    value = 0n,
  ): Promise<Sent> => {
    const hash = await from.sendTransaction({
      account: from.account!,
      chain: null,
      to,
      data,
      value,
      gas: 15_000_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return {
      ok: receipt.status === "success",
      hash,
      logs: receipt.logs,
      gasUsed: receipt.gasUsed,
      contractAddress: receipt.contractAddress,
    };
  };
  const compiled = (source: string, args: readonly unknown[] = []): Hex => {
    const program = compileSauceProgram(slug, source);

    return bytesToHex(concat([program.bytecode, encodeEntryArguments(program, args as never)]));
  };
  const cook = (program: Hex) =>
    send(
      owner,
      stack.pot,
      encodeFunctionData({ abi: potAbi, functionName: "cook", args: [stack.engine, program] }),
      FEE,
    );

  const fee = await send(
    owner,
    stack.kitchen,
    encodeFunctionData({ abi: kitchenAbi, functionName: "setExecutionFee", args: [FEE] }),
  );
  if (!fee.ok) throw new Error("the Kitchen's fee could not be set");
  // The Router pays a handler's fee from the Pot's balance.
  await testClient.setBalance({ address: stack.pot, value: parseEther("10") });

  return {
    slug,
    chainId,
    rpcUrl,
    publicClient,
    testClient,
    stack,
    owner,
    stranger,
    async wallet(account) {
      await testClient.setBalance({ address: account.address, value: parseEther("10") });

      return createWalletClient({ account, transport });
    },
    async impersonate(address) {
      await testClient.impersonateAccount({ address });
      await testClient.setBalance({ address, value: parseEther("10") });

      return createWalletClient({ account: address, transport });
    },
    send,
    compiled,
    cook,
    async installPackage(specifier) {
      const install = packageInstall(slug, specifier);
      const source = handlersInstallSource(install.handlers, specifier, install.interfaces);
      const installed = await cook(compiled(source));
      if (!installed.ok) throw new Error(`${specifier}'s handlers could not be installed`);

      return install.handlers.map((handler) => handler.selector);
    },
    async revertOf(from, to, data, value = 0n) {
      const response = (await (
        await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_call",
            params: [{ from, to, data, value: toHex(value), gas: toHex(15_000_000n) }, "latest"],
          }),
        })
      ).json()) as { result?: Hex; error?: { data?: Hex } };
      if (response.error === undefined) throw new Error("the call did not revert");

      return response.error.data ?? "0x";
    },
    async slot(at) {
      return BigInt((await publicClient.getStorageAt({ address: stack.pot, slot: at })) ?? "0x0");
    },
    async callGas(hash, to, selector) {
      interface Frame {
        to?: string;
        input?: string;
        gasUsed?: string;
        calls?: Frame[];
      }
      const trace = (await publicClient.request({
        method: "debug_traceTransaction" as never,
        params: [hash, { tracer: "callTracer" }] as never,
      })) as Frame;
      const find = (frame: Frame): Frame | undefined =>
        frame.to?.toLowerCase() === to.toLowerCase() && frame.input?.startsWith(selector)
          ? frame
          : (frame.calls ?? []).map(find).find((found) => found !== undefined);
      const frame = find(trace);
      if (frame?.gasUsed === undefined) throw new Error(`no call into ${to} with ${selector}`);

      return BigInt(frame.gasUsed);
    },
    async stop() {
      if (anvil.exitCode === null) {
        const exited = once(anvil, "exit");
        anvil.kill();
        await exited;
      }
    },
  };
}
