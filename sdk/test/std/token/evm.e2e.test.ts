/**
 * `@sauce/token` EXECUTION on the real V12 EVM engine, compiled by the published
 * `@eco-incorp/sauce-compiler-wasm`. The counterpart of the sibling `svm.e2e.test.ts`: the same
 * library, the same known balance, read back through a genuine ERC20 instead of a genuine SPL
 * account — which is what makes the pair a cross-target differential rather than two unrelated tests.
 *
 * The token is OpenZeppelin's `ERC20Mock` (an unrestricted-`mint` ERC20), solc 0.8.27 / cancun, taken
 * from the sauce repo's own `v12-evm/test/mocks/MockERC20.sol` — the SAME contract its conformance
 * differential deploys. Its creation bytecode is vendored at `fixtures/MockERC20.json` so this suite
 * needs no Solidity toolchain at test time; regenerate with `cd <sauce>/v12-evm && forge build` and
 * copy `abi` + `bytecode.object` out of `out/MockERC20.sol/MockERC20.json`.
 *
 * GATED on SAUCE_RUST_V12_RUNTIME — the EVM half of the same engine-lineage finding the sibling
 * `svm.e2e.test.ts` documents, and a REAL FINDING, not a convenience:
 *
 *   The V12 runtime this repo can produce — `sdk/dist/artifacts/V12RuntimeBytecode.json`, generated
 *   by `sync-engine-artifacts` from the pinned `sauce` git dep — comes from the `release/beta`
 *   engine lineage, while the published Rust compiler emits for the `main` lineage. Their opcode
 *   tables have diverged: 0xB0–0xB5 are `IF/IF_2/JUMP/JUMP_2/JUMP_BACK/JUMP_BACK_2` on the pin but
 *   `JUMP/JUMP_I` on main, and 0x88–0x8A (`MLOAD`/`MSTORE`/`MALLOC` — which every value-returning
 *   program's epilogue uses) are `do_unknown` on the pin. A `balanceOf` program compiled by the
 *   published compiler therefore does not run on the pinned runtime: it either returns EMPTY or dies
 *   with MemoryOOG. Repinning `sauce` is the real fix and is out of this suite's scope.
 *
 * So: point SAUCE_RUST_V12_RUNTIME at a file of `main`-lineage DEPLOYED runtime hex to run these —
 *   cd <sauce>/v12-evm && hnc -s . -r v12/Runtime.huff > /tmp/v12-runtime.hex
 *   SAUCE_RUST_V12_RUNTIME=/tmp/v12-runtime.hex pnpm --filter './sdk' test
 * Also needs `anvil` on PATH (Foundry, which CI already installs).
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createTestClient, createWalletClient, encodeFunctionData, http, parseAbi } from 'viem';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { compileStdToken } from './harness.js';

const RUNTIME_HEX_PATH = process.env.SAUCE_RUST_V12_RUNTIME;

/** Skips unless a main-lineage runtime is supplied — see the header for why the repo's own pin won't do. */
const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const MOCK_ERC20 = JSON.parse(readFileSync(join(FIXTURES, 'MockERC20.json'), 'utf8')) as { creationCode: Hex };

/** Anvil's first dev account — the deployer, and the caller of every transaction here. */
const DEPLOYER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

/** Where the V12 runtime is etched. A fixed address keeps the engine out of the deploy nonce order. */
const ENGINE: Address = '0x00000000000000000000000000000000000000ee';

/** Per-worker port so concurrent jest workers never share a node. */
const PORT = 8600 + (Number(process.env.JEST_WORKER_ID ?? '1') % 100);
const RPC_URL = `http://127.0.0.1:${PORT}`;

const STARTUP_TIMEOUT_MS = 20_000;
const GAS_LIMIT = 10_000_000n;

/** The same known balance the SVM half plants — multi-byte, and `u64` because an SPL amount is one. */
const TOKEN_BALANCE = 0x0000_00ab_cdef_1234n;
const APPROVED = 0x0000_0000_dead_beefn;
const TRANSFERRED = 0x1234n;

const HOLDER: Address = '0x0000000000000000000000000000000000000002';
const RECIPIENT: Address = '0x0000000000000000000000000000000000000003';
const SPENDER: Address = '0x0000000000000000000000000000000000000004';

const erc20Abi = parseAbi([
  'function mint(address to, uint256 amount)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);

// Built at module scope: viem clients are lazy (no socket until a request), so this costs nothing on
// a skipped run and keeps the harness down to the two things that are actually per-run state.
// `connection: close` is load-bearing, not tidiness: Node's global fetch pools keep-alive sockets
// that outlive the suite, which trips jest's "worker process failed to exit gracefully" force-exit.
// Anvil is local, so pooling buys nothing here.
const transport = http(RPC_URL, { fetchOptions: { headers: { connection: 'close' } } });
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: 'anvil', transport });
const walletClient = createWalletClient({ account: DEPLOYER, transport });

/** An address as the SauceScript bigint literal the entries bake in (the EVM arm takes plain values). */
const literal = (value: Address): string => `${value}n`;

const toHex = (bytes: Uint8Array): Hex => `0x${Buffer.from(bytes).toString('hex')}`;

const waitForRpc = (deadline: number): Promise<void> =>
  Date.now() >= deadline
    ? Promise.reject(new Error(`anvil did not come up on ${RPC_URL}`))
    : publicClient
        .getChainId()
        .then(() => undefined)
        .catch(() => new Promise((resolve) => setTimeout(resolve, 100)).then(() => waitForRpc(deadline)));

/** Wait for `hash` to land, rejecting with `what` when it reverted. */
const confirm = (hash: Hex, what: string): Promise<void> =>
  publicClient
    .waitForTransactionReceipt({ hash })
    .then(({ status }) => (status === 'success' ? undefined : Promise.reject(new Error(`${what} reverted`))));

/** Send `data` to `to` from the deployer and wait for it to land. */
const sendTo = (to: Address, data: Hex, what: string): Promise<void> =>
  walletClient.sendTransaction({ account: DEPLOYER, chain: null, to, data, gas: GAS_LIMIT }).then((hash) => confirm(hash, what));

const mintTo = (token: Address, holder: Address, amount: bigint): Promise<void> =>
  sendTo(token, encodeFunctionData({ abi: erc20Abi, functionName: 'mint', args: [holder, amount] }), 'mint');

const balanceOf = (token: Address, holder: Address): Promise<bigint> =>
  publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [holder] });

/** Compile `entry` for the EVM and STATIC-call the engine with it, returning its 256-bit result. */
const call = (entry: string): Promise<bigint> =>
  publicClient
    .call({ to: ENGINE, data: toHex(compileStdToken(entry, 'evm').bytecode), gas: GAS_LIMIT })
    .then(({ data }) => BigInt(data ?? '0x0'));

/** Compile `entry` for the EVM and run it as a TRANSACTION, so its writes stick. */
const send = (entry: string): Promise<void> => sendTo(ENGINE, toHex(compileStdToken(entry, 'evm').bytecode), 'the engine');

/** Deploy the vendored ERC20 creation code, returning its address. */
const deployToken = (): Promise<Address> =>
  walletClient
    .sendTransaction({ account: DEPLOYER, chain: null, data: MOCK_ERC20.creationCode, gas: GAS_LIMIT })
    .then((hash) => publicClient.waitForTransactionReceipt({ hash }))
    .then(({ contractAddress }) => contractAddress ?? Promise.reject(new Error('the ERC20 deployment produced no address')));

/**
 * Boot anvil, etch the runtime at [`ENGINE`] (hnc emits DEPLOYED bytecode, so there is no constructor
 * to run), and deploy the ERC20.
 */
const startEvm = (): Promise<{ anvil: ChildProcess; token: Address }> => {
  const anvil = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
  const runtime = readFileSync(RUNTIME_HEX_PATH as string, 'utf8').trim().replace(/^0x/, '');

  return waitForRpc(Date.now() + STARTUP_TIMEOUT_MS)
    .then(() => testClient.setCode({ address: ENGINE, bytecode: `0x${runtime}` }))
    .then(deployToken)
    .then((token) => ({ anvil, token }));
};

/**
 * Await the exit rather than firing a bare `kill()`: an un-awaited kill leaves the child alive long
 * enough to trip jest's "did not exit" warning, and a stray anvil would hold the port for the next run.
 */
const stopEvm = (anvil: ChildProcess): Promise<void> => {
  if (anvil.exitCode !== null) return Promise.resolve();

  const exited = once(anvil, 'exit');
  anvil.kill();

  return exited.then(() => undefined);
};

describeEvm('@sauce/token e2e: the EVM arm against a real ERC20', () => {
  let anvil: ChildProcess;
  let token: Address;

  beforeAll(async () => {
    ({ anvil, token } = await startEvm());
    await mintTo(token, HOLDER, TOKEN_BALANCE);
  }, 60_000);

  afterAll(() => (anvil ? stopEvm(anvil) : undefined));

  it('balanceOf reads the holder’s balance off the deployed ERC20', async () => {
    const entry = `import { balanceOf } from "@sauce/token"; function main(): Uint256 { return balanceOf(${literal(token)}, ${literal(HOLDER)}); }`;

    // The same value the SVM half reads off a real SPL account — compared over the FULL 256-bit word,
    // since the library types `balanceOf` `Uint256`.
    expect(await call(entry)).toBe(TOKEN_BALANCE);
  });

  it('totalSupply and decimals read the token’s own state', async () => {
    const supply = `import { totalSupply } from "@sauce/token"; function main(): Uint256 { return totalSupply(${literal(token)}); }`;
    const decimals = `import { decimals } from "@sauce/token"; function main(): Uint256 { return decimals(${literal(token)}); }`;

    expect(await call(supply)).toBe(TOKEN_BALANCE);
    expect(await call(decimals)).toBe(18n);
  });

  it('approve then allowance round-trips through the ERC20’s allowance map', async () => {
    await send(
      `import { approve } from "@sauce/token"; function main(): void { approve(${literal(token)}, ${literal(SPENDER)}, ${APPROVED}n); }`,
    );

    // Read it back with the library's own `allowance`: the write and the read agree on the ERC20
    // surface, which a one-sided test could not show. The approver is the ENGINE (the `msg.sender` of
    // the CALL), so that is the owner the allowance is keyed under.
    const allowance = `import { allowance } from "@sauce/token"; function main(): Uint256 { return allowance(${literal(token)}, ${literal(ENGINE)}, ${literal(SPENDER)}); }`;

    expect(await call(allowance)).toBe(APPROVED);
  });

  it('transfer moves the engine’s own balance', async () => {
    // `transfer` spends the caller's balance, and the caller here is the engine — so fund it first.
    await mintTo(token, ENGINE, TOKEN_BALANCE);
    await send(
      `import { transfer } from "@sauce/token"; function main(): void { transfer(${literal(token)}, ${literal(RECIPIENT)}, ${TRANSFERRED}n); }`,
    );

    expect(await balanceOf(token, RECIPIENT)).toBe(TRANSFERRED);
    expect(await balanceOf(token, ENGINE)).toBe(TOKEN_BALANCE - TRANSFERRED);
  });

  it('transferFrom spends an allowance the engine was granted', async () => {
    // The deployer approves the engine and holds the funds, then the library's `transferFrom` pulls
    // from the deployer — the allowance path, which `transfer` above does not exercise.
    await mintTo(token, DEPLOYER.address, TRANSFERRED);
    await sendTo(
      token,
      encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ENGINE, APPROVED] }),
      'approve',
    );
    await send(
      `import { transferFrom } from "@sauce/token"; function main(): void { transferFrom(${literal(token)}, ${literal(DEPLOYER.address)}, ${literal(RECIPIENT)}, ${TRANSFERRED}n); }`,
    );

    // The `transfer` case above already moved one `TRANSFERRED` to the recipient.
    expect(await balanceOf(token, RECIPIENT)).toBe(TRANSFERRED * 2n);
  });
});
