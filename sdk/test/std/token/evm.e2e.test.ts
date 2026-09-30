/**
 * `@sauce/token` EXECUTION on the real V12 EVM engine, compiled by the published
 * `@eco-incorp/sauce-compiler`. The counterpart of the sibling `svm.e2e.test.ts`: the same
 * library, the same known balance, read back through a genuine ERC20 instead of a genuine SPL
 * account — which is what makes the pair a cross-target differential rather than two unrelated tests.
 *
 * The token is OpenZeppelin's `ERC20Mock` (an unrestricted-`mint` ERC20), solc 0.8.27 / cancun, taken
 * from the sauce repo's own `v12-evm/test/mocks/MockERC20.sol` — the SAME contract its conformance
 * differential deploys. Its creation bytecode is vendored at `fixtures/MockERC20.json` so this suite
 * needs no Solidity toolchain at test time; regenerate with `cd <sauce>/v12-evm && forge build` and
 * copy `abi` + `bytecode.object` out of `out/MockERC20.sol/MockERC20.json`.
 *
 * THE WRITES ARE SafeERC20, and the matrix at the bottom is what shows it: each write against a
 * token that returns `true`, `false`, nothing, or something that is not an ABI `bool` (a word of 2,
 * one byte, 31 bytes, 64 bytes), against an address with no code, and against an honest token
 * refusing. Every cell runs through OpenZeppelin's `SafeERC20` itself, through the library, through
 * `src/token/safe.ts` (the spelling the SDK emits into routes), and through each route-body syntax a
 * program writes by hand — `USDC.transfer(...)`, `Token(addr).transfer(...)` and a bound
 * `const t = Token(addr); t.transfer(...)`, compiled by `compileSauceRoute` — and every one must
 * land it identically. The raw `IERC20.at(addr)` binding runs beside them as the contrast: it is
 * what the route syntax used to lower to, and it gets the no-return and `false` cells wrong. The
 * shipped `plain-transfer` recipe runs too, at the registry's own USDC address. The misbehaving
 * tokens and the OpenZeppelin reference are the other
 * `fixtures/*.sol`, vendored beside them as `{ abi, creationCode }` compiled by
 * `solc 0.8.36 --optimize` (each file says how).
 *
 * GATED on SAUCE_RUST_V12_RUNTIME — the EVM half of the same engine-lineage finding the sibling
 * `svm.e2e.test.ts` documents, and a REAL FINDING, not a convenience:
 *
 *   The V12 runtime this repo can produce — `sdk/dist/artifacts/V12RuntimeBytecode.json`, wrapped
 *   by `sync-engine-artifacts` from the pinned EVM release's creation code — came from the
 *   `release/beta` engine lineage, while the published Rust compiler emits for the `main` lineage. Their opcode
 *   tables have diverged: 0xB0–0xB5 are `IF/IF_2/JUMP/JUMP_2/JUMP_BACK/JUMP_BACK_2` on the pin but
 *   `JUMP/JUMP_I` on main, and 0x88–0x8A (`MLOAD`/`MSTORE`/`MALLOC` — which every value-returning
 *   program's epilogue uses) are `do_unknown` on the pin. A `balanceOf` program compiled by the
 *   published compiler therefore does not run on the pinned runtime: it either returns EMPTY or dies
 *   with MemoryOOG. Repinning `sauce` is the real fix and is out of this suite's scope.
 *
 * So: point SAUCE_RUST_V12_RUNTIME at a file of `main`-lineage DEPLOYED runtime hex to run these.
 * `hnc -r` cannot produce it — Runtime.huff's CONSTRUCTOR returns its own bytecode, so the deployed
 * runtime is only known at deployment time — so deploy the creation bytecode and read the code back.
 * CI does exactly this, from the pinned v12-evm release's `runtime.creation.hex` (the tag lives in
 * `scripts/sync-engine-artifacts.mjs`, so it does not go stale here); by hand, from a local sauce
 * checkout:
 *   cd <sauce>/v12-evm && anvil --port 8799 --silent &
 *   KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80  # anvil's first account
 *   ADDR=$(cast send --rpc-url http://127.0.0.1:8799 --private-key $KEY --create \
 *     "0x$(hnc -s . -b v12/Runtime.huff | tr -d '[:space:]')" --json | jq -r .contractAddress)
 *   cast code "$ADDR" --rpc-url http://127.0.0.1:8799 > /tmp/v12-runtime.hex
 *   SAUCE_RUST_V12_RUNTIME=/tmp/v12-runtime.hex pnpm --filter './sdk' test
 * Also needs `anvil` on PATH (Foundry, which CI already installs).
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  numberToHex,
  parseAbi,
  zeroAddress,
} from "viem";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compileStdToken } from "./harness.js";
import { startGatedEngine } from "../../evm/gated-engine.js";
import type { GatedEngine } from "../../evm/gated-engine.js";
import { safeApproveStatements, safeTransferStatements } from "../../../src/token/safe.js";
import { compileSauceRoute } from "../../../src/routes/sauce-route.js";
import { registryTokenAddress } from "../../../src/routes/token-registry.js";
import { requireChain } from "../../../src/chains/canonical.js";
import { buildPlainTransfer } from "../../../src/recipes/cctp-transfer.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;

/** Skips unless a main-lineage runtime is supplied — see the header for why the repo's own pin won't do. */
const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;

// The gate above is a local-developer convenience, never a CI outcome: a skipped suite and a passing
// one are the same line in jest's summary, which is how these two went unrun for their whole life.
// CI supplies the engine (see .github/workflows/ci.yml) — so in CI, an absent one is a failure.
if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI. This suite must never skip here — see the " +
      '"Fetch the v12 engines" step in .github/workflows/ci.yml.',
  );
}

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string): { creationCode: Hex } =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as { creationCode: Hex };

const MOCK_ERC20 = fixture("MockERC20");
/** `transfer`/`transferFrom`/`approve` return `false` and move nothing. */
const FALSE_RETURN_ERC20 = fixture("FalseReturnERC20");
/** USDT: the writes return NOTHING, and `approve` refuses a nonzero -> nonzero change. */
const NO_RETURN_ERC20 = fixture("NoReturnERC20");
/** The writes take effect, then return exactly the bytes the token was constructed with. */
const ODD_RETURN_ERC20 = fixture("OddReturnERC20");
/** OpenZeppelin's own `SafeERC20`, run on the same cells as the reference. */
const SAFE_ERC20_REFERENCE = fixture("SafeERC20Reference");

const referenceAbi = parseAbi([
  "function transfer(address token, address to, uint256 amount)",
  "function transferFrom(address token, address from, address to, uint256 amount)",
  "function approve(address token, address spender, uint256 amount)",
  "function raw(address target, bytes data)",
]);

/** Anvil's first dev account — the deployer, and the caller of every transaction here. */
const DEPLOYER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

/**
 * The acting account, resolved by `startGatedEngine` in `beforeAll`.
 *
 * It is the POT, not the engine. A released engine refuses any caller that is not a Pot it can
 * re-derive, so every program now runs under `Pot.cook` — and `ctx.self()`, `msg.sender` for a CPI,
 * and therefore the holder of any balance a program moves, are all the Pot. That is a change of
 * ACTOR, not just of transport: the assertions below name it wherever they used to name the engine.
 */
let sauce: GatedEngine;

/** Per-worker port so concurrent jest workers never share a node. */
const PORT = 8600 + (Number(process.env.JEST_WORKER_ID ?? "1") % 100);
const RPC_URL = `http://127.0.0.1:${PORT}`;

const STARTUP_TIMEOUT_MS = 20_000;
const GAS_LIMIT = 10_000_000n;

/** The same known balance the SVM half plants — multi-byte, and `u64` because an SPL amount is one. */
const TOKEN_BALANCE = 0x0000_00ab_cdef_1234n;
const APPROVED = 0x0000_0000_dead_beefn;
const TRANSFERRED = 0x1234n;

const HOLDER: Address = "0x0000000000000000000000000000000000000002";
const RECIPIENT: Address = "0x0000000000000000000000000000000000000003";
const SPENDER: Address = "0x0000000000000000000000000000000000000004";

const erc20Abi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function transferFrom(address from, address to, uint256 value) returns (bool)",
]);

// Built at module scope: viem clients are lazy (no socket until a request), so this costs nothing on
// a skipped run and keeps the harness down to the two things that are actually per-run state.
// `connection: close` is load-bearing, not tidiness: Node's global fetch pools keep-alive sockets
// that outlive the suite, which trips jest's "worker process failed to exit gracefully" force-exit.
// Anvil is local, so pooling buys nothing here.
const transport = http(RPC_URL, { fetchOptions: { headers: { connection: "close" } } });
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: DEPLOYER, transport });

/** An address as the SauceScript bigint literal the entries bake in (the EVM arm takes plain values). */
const literal = (value: Address): string => `${value}n`;

const toHex = (bytes: Uint8Array): Hex => `0x${Buffer.from(bytes).toString("hex")}`;

const waitForRpc = (deadline: number): Promise<void> =>
  Date.now() >= deadline
    ? Promise.reject(new Error(`anvil did not come up on ${RPC_URL}`))
    : publicClient
        .getChainId()
        .then(() => undefined)
        .catch(() =>
          new Promise((resolve) => setTimeout(resolve, 100)).then(() => waitForRpc(deadline)),
        );

/** Wait for `hash` to land, rejecting with `what` when it reverted. */
const confirm = (hash: Hex, what: string): Promise<void> =>
  publicClient
    .waitForTransactionReceipt({ hash })
    .then(({ status }) =>
      status === "success" ? undefined : Promise.reject(new Error(`${what} reverted`)),
    );

/** Send `data` to `to` from the deployer and wait for it to land. */
const sendTo = (to: Address, data: Hex, what: string): Promise<void> =>
  walletClient
    .sendTransaction({ account: DEPLOYER, chain: null, to, data, gas: GAS_LIMIT })
    .then((hash) => confirm(hash, what));

const mintTo = (token: Address, holder: Address, amount: bigint): Promise<void> =>
  sendTo(
    token,
    encodeFunctionData({ abi: erc20Abi, functionName: "mint", args: [holder, amount] }),
    "mint",
  );

const balanceOf = (token: Address, holder: Address): Promise<bigint> =>
  publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [holder],
  });

/** Compile `entry` for the EVM and STATIC-call the engine with it, returning its 256-bit result. */
const call = (entry: string): Promise<bigint> =>
  publicClient
    .call({
      // `account` is mandatory now, not decoration: `cook` is onlyOwner, and an eth_call with no
      // `from` reverts with NotOwner() before a single opcode runs.
      account: DEPLOYER.address,
      data: sauce.cookData(toHex(compileStdToken(entry, "evm").bytecode)),
      gas: GAS_LIMIT,
      to: sauce.pot,
      value: sauce.fee,
    })
    // `call`, never `readContract`: `cook` bubbles the runtime's output verbatim with no ABI
    // wrapper, so decoding it as the declared `bytes` return reads the result word as an offset.
    .then(({ data }) => BigInt(data ?? "0x0"));

/** Compile `entry` for the EVM and run it as a TRANSACTION, so its writes stick. */
const send = (entry: string): Promise<void> =>
  sendTo(sauce.pot, sauce.cookData(toHex(compileStdToken(entry, "evm").bytecode)), "the Pot");

/** `send`, reporting whether the transaction landed instead of rejecting when it did not. */
const attempt = (entry: string): Promise<"success" | "reverted"> =>
  walletClient
    .sendTransaction({
      account: DEPLOYER,
      chain: null,
      to: sauce.pot,
      data: sauce.cookData(toHex(compileStdToken(entry, "evm").bytecode)),
      gas: GAS_LIMIT,
    })
    .then((hash) => publicClient.waitForTransactionReceipt({ hash }))
    .then(({ status }) => status);

/** Deploy `creationCode`, returning the contract's address. */
const deploy = (creationCode: Hex): Promise<Address> =>
  walletClient
    .sendTransaction({
      account: DEPLOYER,
      chain: null,
      data: creationCode,
      gas: GAS_LIMIT,
    })
    .then((hash) => publicClient.waitForTransactionReceipt({ hash }))
    .then(
      ({ contractAddress }) =>
        contractAddress ?? Promise.reject(new Error("the ERC20 deployment produced no address")),
    );

/** Deploy the vendored ERC20 creation code, returning its address. */
const deployToken = (): Promise<Address> => deploy(MOCK_ERC20.creationCode);

/**
 * Boot anvil, stand up the gated engine (see `gated-engine.ts` — Kitchen at its baked address, then
 * a real Pot minted from it), and deploy the ERC20.
 *
 * CREATION code, not deployed runtime: the engine's constructor appends its own address as a
 * trailing code word and `EVAL` reads it back, so an etched copy has a dangling self-reference that
 * fails silently rather than loudly.
 */
const startEvm = async (): Promise<{ anvil: ChildProcess; token: Address }> => {
  const anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  const creationCode = readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex;

  await waitForRpc(Date.now() + STARTUP_TIMEOUT_MS);
  sauce = await startGatedEngine(
    { publicClient, testClient, walletClient },
    DEPLOYER.address,
    creationCode,
  );

  return { anvil, token: await deployToken() };
};

/**
 * Await the exit rather than firing a bare `kill()`: an un-awaited kill leaves the child alive long
 * enough to trip jest's "did not exit" warning, and a stray anvil would hold the port for the next run.
 */
const stopEvm = (anvil: ChildProcess): Promise<void> => {
  if (anvil.exitCode !== null) return Promise.resolve();

  const exited = once(anvil, "exit");
  anvil.kill();

  return exited.then(() => undefined);
};

// ---------------------------------------------------------------------------------------------------
// SafeERC20: every write, against every way a token can answer it
// ---------------------------------------------------------------------------------------------------

/** What every write in the matrix moves. */
const AMOUNT = 0x5a0en;
/** The allowance a USDT-shaped token has to be reset from before it accepts a new one. */
const STANDING = 7n;

/** Never deployed to. A call to it "succeeds" and returns nothing, which is the whole hazard. */
const NO_CODE: Address = "0x000000000000000000000000000000000000c0de";

/** The raw returndata `OddReturnERC20` is built to answer every write with. */
const ODD_RETURNS = {
  "a word of 2": `0x${"00".repeat(31)}02`,
  "the single byte 0x01": "0x01",
  "31 bytes that pad to 1": `0x${"00".repeat(30)}01`,
  "64 bytes whose first word is 1": `0x${"00".repeat(31)}01${"00".repeat(32)}`,
} as const satisfies Record<string, Hex>;

type OddReturn = keyof typeof ODD_RETURNS;
type Write = "transfer" | "transferFrom" | "approve";
type Status = "success" | "reverted";

/**
 * Every kind of token the matrix writes to. Each run deploys a FRESH instance, so every spelling of
 * a cell starts from identical state without anything having to be rolled back between them.
 */
const TOKENS = {
  /** OpenZeppelin: returns `true`, reverts on a real failure. */
  standard: () => deploy(MOCK_ERC20.creationCode),
  falseReturn: () => deploy(FALSE_RETURN_ERC20.creationCode),
  noReturn: () =>
    deploy(
      `${NO_RETURN_ERC20.creationCode}${encodeAbiParameters(
        [{ type: "string" }, { type: "string" }, { type: "uint8" }],
        ["Tether USD", "USDT", 6],
      ).slice(2)}` as Hex,
    ),
  oddReturn: (odd: OddReturn) =>
    deploy(
      `${ODD_RETURN_ERC20.creationCode}${encodeAbiParameters(
        [{ type: "bytes" }],
        [ODD_RETURNS[odd]],
      ).slice(2)}` as Hex,
    ),
  noCode: () =>
    publicClient
      .getCode({ address: NO_CODE })
      .then((code) =>
        code === undefined ? NO_CODE : Promise.reject(new Error(`${NO_CODE} has code`)),
      ),
} satisfies Record<string, (odd: OddReturn) => Promise<Address>>;

interface Cell {
  readonly write: Write;
  readonly token: keyof typeof TOKENS;
  /** What an `oddReturn` token answers with. */
  readonly odd?: OddReturn;
  readonly given?: keyof typeof GIVEN;
  /** The recipient (`transfer`/`transferFrom`) or spender (`approve`), when not the default. */
  readonly to?: Address;
  readonly expected: Status;
}

const targetOf = (cell: Cell): Address =>
  cell.to ?? (cell.write === "approve" ? SPENDER : RECIPIENT);

/** The cell's write as ERC-20 arguments, in declaration order. `transferFrom` pulls from the deployer. */
const argsOf = (cell: Cell): readonly [Address, bigint] | readonly [Address, Address, bigint] =>
  cell.write === "transferFrom"
    ? [DEPLOYER.address, targetOf(cell), AMOUNT]
    : [targetOf(cell), AMOUNT];

const calldataOf = (cell: Cell): Hex =>
  encodeFunctionData({ abi: erc20Abi, functionName: cell.write, args: argsOf(cell) as never });

const approveData = (spender: Address, amount: bigint): Hex =>
  encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] });

/** A raw, UNCHECKED `evm.call` of `data` — what a write is before any SafeERC20 check. */
const rawCall = (token: Address, data: Hex): string =>
  `function main(): void { const data = hex\`${data.slice(2)}\`; evm.call(${literal(token)}, 0n, data); }`;

/**
 * One way of issuing a write. `actor` is the address it runs AS — whose balance moves, whose
 * allowance is set — so a cell's starting state can be put on whichever one is being tested.
 */
interface Spelling {
  readonly name: string;
  readonly actor: () => Address;
  /** Which writes it can express at all. */
  readonly writes: readonly Write[];
  readonly write: (cell: Cell, token: Address) => Promise<Status>;
  /** Issue `data` from the actor with nothing checked, for setting up a starting state. */
  readonly raw: (token: Address, data: Hex) => Promise<void>;
}

let reference: Address;

const potRaw = (token: Address, data: Hex): Promise<void> => send(rawCall(token, data));

/** OpenZeppelin's `SafeERC20` itself, deployed as `fixtures/SafeERC20Reference.sol`. */
const OPENZEPPELIN: Spelling = {
  name: "OpenZeppelin SafeERC20 (the reference)",
  actor: () => reference,
  writes: ["transfer", "transferFrom", "approve"],
  write: (cell, token) =>
    walletClient
      .sendTransaction({
        account: DEPLOYER,
        chain: null,
        to: reference,
        data: encodeFunctionData({
          abi: referenceAbi,
          functionName: cell.write,
          args: [token, ...argsOf(cell)] as never,
        }),
        gas: GAS_LIMIT,
      })
      .then((hash) => publicClient.waitForTransactionReceipt({ hash }))
      .then(({ status }) => status),
  raw: (token, data) =>
    sendTo(
      reference,
      encodeFunctionData({ abi: referenceAbi, functionName: "raw", args: [token, data] }),
      "the reference's raw call",
    ),
};

/** A direct `@sauce/token` call, as SauceScript that imports the library writes it. */
const SAUCE_TOKEN: Spelling = {
  name: "@sauce/token",
  actor: () => sauce.pot,
  writes: ["transfer", "transferFrom", "approve"],
  write: (cell, token) => {
    const args = [token, ...argsOf(cell)].map((arg) =>
      typeof arg === "bigint" ? `${arg}n` : literal(arg),
    );

    return attempt(
      `import { ${cell.write} } from "@sauce/token"; function main(): void { ${cell.write}(${args.join(", ")}); }`,
    );
  },
  raw: potRaw,
};

/**
 * `safe.ts`, as the SDK emits it into a route: the amount in a run-time local, the way the nesting
 * emitters carry a measured one. It has no `transferFrom`, because nothing the SDK emits pulls.
 */
const SAFE_TS: Spelling = {
  name: "safe.ts",
  actor: () => sauce.pot,
  writes: ["transfer", "approve"],
  write: (cell, token) => {
    const emit = cell.write === "approve" ? safeApproveStatements : safeTransferStatements;
    const statements = emit(
      "w_",
      literal(token),
      { literal: BigInt(targetOf(cell)) },
      { local: "amt" },
    );

    return attempt(`function main(): void {\nconst amt = ${AMOUNT}n;\n${statements.join("\n")}\n}`);
  },
  raw: potRaw,
};

/** Send `data` to the Pot, reporting whether it landed. */
const attemptCall = (data: Hex): Promise<Status> =>
  walletClient
    .sendTransaction({ account: DEPLOYER, chain: null, to: sauce.pot, data, gas: GAS_LIMIT })
    .then((hash) => publicClient.waitForTransactionReceipt({ hash }))
    .then(({ status }) => status);

/**
 * `body` through `compileSauceRoute`, the path every route-body token spelling takes, returning the
 * `cook` call it builds — the route call itself, not a re-encoding of its program. The token is
 * handed in as the `USDC` override, so the symbol syntax resolves to the cell's own token.
 */
const routeCall = (body: string, token: Address): Hex => {
  const { calls } = compileSauceRoute(
    "base",
    body,
    { pot: sauce.pot, engine: sauce.engine },
    { tokens: { USDC: token } },
  );

  return calls[0]!.data;
};

/** A cell's ERC-20 arguments as SauceScript literals. */
const argText = (cell: Cell): string =>
  argsOf(cell)
    .map((arg) => (typeof arg === "bigint" ? `${arg}n` : literal(arg)))
    .join(", ");

/** A route-body spelling of every write, as `body(write, tokenLiteral, args)` writes it. */
const routeSpelling = (
  name: string,
  body: (write: Write, token: string, args: string) => string,
): Spelling => ({
  name,
  actor: () => sauce.pot,
  writes: ["transfer", "transferFrom", "approve"],
  write: (cell, token) =>
    attemptCall(routeCall(body(cell.write, literal(token), argText(cell)), token)),
  raw: potRaw,
});

/** `USDC.transfer(to, amount)` — the registry-symbol syntax. */
const SYMBOL = routeSpelling("USDC.<write>(...)", (write, _, args) => `USDC.${write}(${args});`);

/** `Token(addr).transfer(to, amount)` — the any-address wrapper. */
const FACTORY = routeSpelling(
  "Token(addr).<write>(...)",
  (write, token, args) => `Token(${token}).${write}(${args});`,
);

/** `const t = Token(addr); t.transfer(to, amount)` — the wrapper bound once, then called. */
const BOUND = routeSpelling(
  "const t = Token(addr); t.<write>(...)",
  (write, token, args) => `const t = Token(${token});\nt.${write}(${args});`,
);

/**
 * The typed binding the sugar used to lower to, and which an explicit `IERC20.at(addr)` still is:
 * the raw ABI call, which decodes the declared `bool`. Not a SafeERC20 spelling — it is here to
 * show the two cells that made the sugar unsafe.
 */
const TYPED = routeSpelling(
  "IERC20.at(addr).<write>(...)",
  (write, token, args) =>
    `import { IERC20 } from "./artifacts/IERC20.json";\n` +
    `function main() { IERC20.at(${token}).${write}(${args}); }`,
);

/** The same write with nothing checked, for showing that a refusal is the check's, not the token's. */
const UNCHECKED: Spelling = {
  name: "an unchecked evm.call",
  actor: () => sauce.pot,
  writes: ["transfer", "transferFrom", "approve"],
  write: (cell, token) => attempt(rawCall(token, calldataOf(cell))),
  raw: potRaw,
};

/** The state a write starts from, put on the spelling's actor before the write runs. */
const GIVEN = {
  /** The actor holds what it is asked to transfer. */
  funded: (token: Address, spelling: Spelling) => mintTo(token, spelling.actor(), AMOUNT),
  /** The deployer holds the amount and has approved the actor to pull it. */
  pullApproved: (token: Address, spelling: Spelling) =>
    mintTo(token, DEPLOYER.address, AMOUNT).then(() =>
      sendTo(token, approveData(spelling.actor(), AMOUNT), "approve"),
    ),
  /** The deployer holds the amount but approved nothing, so an honest token refuses the pull. */
  pullUnapproved: (token: Address) => mintTo(token, DEPLOYER.address, AMOUNT),
  /** The actor already allows the spender a non-zero amount — the state USDT will not move from. */
  standingAllowance: (token: Address, spelling: Spelling) =>
    spelling.raw(token, approveData(SPENDER, STANDING)),
} satisfies Record<string, (token: Address, spelling: Spelling) => Promise<void>>;

/** The starting state a write needs to be able to succeed at all. */
const READY: Record<Write, keyof typeof GIVEN | undefined> = {
  transfer: "funded",
  transferFrom: "pullApproved",
  approve: undefined,
};

/**
 * The SafeERC20 contract, as rows. A write that returns an ABI `true`, or nothing from a contract,
 * lands; one that returns `false`, returns anything that is not a word equal to 1, reaches no code,
 * or is refused by the token reverts the whole cook. OpenZeppelin runs every row too, so the table
 * is the reference's observed behaviour, not this file's belief about it.
 *
 * The refusals by an HONEST token are real refusals, not the check misfiring: the USDT shape reverts
 * a transfer the actor cannot fund and a pull nobody approved, and OpenZeppelin's ERC20 reverts an
 * approve to the zero address. They show that accepting empty returndata never swallows a revert.
 */
const CELLS: readonly Cell[] = (["transfer", "transferFrom", "approve"] as const).flatMap(
  (write): Cell[] => {
    const ready = READY[write];

    return [
      { write, token: "standard", given: ready, expected: "success" },
      { write, token: "falseReturn", given: ready, expected: "reverted" },
      { write, token: "noReturn", given: ready, expected: "success" },
      ...(Object.keys(ODD_RETURNS) as OddReturn[]).map((odd): Cell => ({
        write,
        token: "oddReturn",
        odd,
        given: ready,
        expected: odd === "64 bytes whose first word is 1" ? "success" : "reverted",
      })),
      { write, token: "noCode", expected: "reverted" },
      ...(write === "transfer"
        ? [{ write, token: "noReturn", expected: "reverted" } as const]
        : write === "transferFrom"
          ? [{ write, token: "noReturn", given: "pullUnapproved", expected: "reverted" } as const]
          : [
              {
                write,
                token: "noReturn",
                given: "standingAllowance",
                expected: "success",
              } as const,
              { write, token: "standard", to: zeroAddress, expected: "reverted" } as const,
            ]),
    ];
  },
);

const title = (cell: Cell): string =>
  [
    `${cell.write} on the ${cell.token} token`,
    cell.odd && `answering ${cell.odd}`,
    cell.given && `(${cell.given})`,
    cell.to && `to ${cell.to}`,
  ]
    .filter(Boolean)
    .join(" ");

/** `it.each` rows: the title, the outcome it asserts, and the cell itself. */
const rows = (cells: readonly Cell[]) =>
  cells.map((cell) => [title(cell), cell.expected, cell] as const);

/**
 * What a write did: whether it landed, and the one quantity it exists to change — the target's
 * balance, or the actor's allowance to the spender — or `null` where there is no token to ask.
 */
interface Outcome {
  readonly status: Status;
  readonly effect: bigint | null;
}

const run = async (cell: Cell, spelling: Spelling): Promise<Outcome> => {
  const token = await TOKENS[cell.token](cell.odd as OddReturn);
  if (cell.given) await GIVEN[cell.given](token, spelling);

  const status = await spelling.write(cell, token);
  if (cell.token === "noCode") return { status, effect: null };

  const effect =
    cell.write === "approve"
      ? await publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [spelling.actor(), targetOf(cell)],
        })
      : await balanceOf(token, targetOf(cell));

  return { status, effect };
};

/** A write that lands moved exactly `AMOUNT`; one that reverted moved nothing. */
const expectedOutcome = (cell: Cell): Outcome => ({
  status: cell.expected,
  effect: cell.token === "noCode" ? null : cell.expected === "success" ? AMOUNT : 0n,
});

describeEvm("@sauce/token e2e: the EVM arm against a real ERC20", () => {
  let anvil: ChildProcess;
  let token: Address;

  beforeAll(async () => {
    ({ anvil, token } = await startEvm());
    await mintTo(token, HOLDER, TOKEN_BALANCE);
  }, 60_000);

  afterAll(() => (anvil ? stopEvm(anvil) : undefined));

  it("balanceOf reads the holder’s balance off the deployed ERC20", async () => {
    const entry = `import { balanceOf } from "@sauce/token"; function main(): Uint256 { return balanceOf(${literal(token)}, ${literal(HOLDER)}); }`;

    // The same value the SVM half reads off a real SPL account — compared over the FULL 256-bit word,
    // since the library types `balanceOf` `Uint256`.
    expect(await call(entry)).toBe(TOKEN_BALANCE);
  });

  it("totalSupply and decimals read the token’s own state", async () => {
    const supply = `import { totalSupply } from "@sauce/token"; function main(): Uint256 { return totalSupply(${literal(token)}); }`;
    const decimals = `import { decimals } from "@sauce/token"; function main(): Uint256 { return decimals(${literal(token)}); }`;

    expect(await call(supply)).toBe(TOKEN_BALANCE);
    expect(await call(decimals)).toBe(18n);
  });

  it("approve then allowance round-trips through the ERC20’s allowance map", async () => {
    await send(
      `import { approve } from "@sauce/token"; function main(): void { approve(${literal(token)}, ${literal(SPENDER)}, ${APPROVED}n); }`,
    );

    // Read it back with the library's own `allowance`: the write and the read agree on the ERC20
    // surface, which a one-sided test could not show. The approver is the POT (the `msg.sender` of
    // the CALL), so that is the owner the allowance is keyed under.
    const allowance = `import { allowance } from "@sauce/token"; function main(): Uint256 { return allowance(${literal(token)}, ${literal(sauce.pot)}, ${literal(SPENDER)}); }`;

    expect(await call(allowance)).toBe(APPROVED);
  });

  it("transfer moves the Pot’s own balance", async () => {
    // `transfer` spends the caller's balance, and the caller here is the engine — so fund it first.
    await mintTo(token, sauce.pot, TOKEN_BALANCE);
    await send(
      `import { transfer } from "@sauce/token"; function main(): void { transfer(${literal(token)}, ${literal(RECIPIENT)}, ${TRANSFERRED}n); }`,
    );

    expect(await balanceOf(token, RECIPIENT)).toBe(TRANSFERRED);
    expect(await balanceOf(token, sauce.pot)).toBe(TOKEN_BALANCE - TRANSFERRED);
  });

  it("transferFrom spends an allowance the Pot was granted", async () => {
    // The deployer approves the engine and holds the funds, then the library's `transferFrom` pulls
    // from the deployer — the allowance path, which `transfer` above does not exercise.
    await mintTo(token, DEPLOYER.address, TRANSFERRED);
    await sendTo(
      token,
      encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [sauce.pot, APPROVED] }),
      "approve",
    );
    await send(
      `import { transferFrom } from "@sauce/token"; function main(): void { transferFrom(${literal(token)}, ${literal(DEPLOYER.address)}, ${literal(RECIPIENT)}, ${TRANSFERRED}n); }`,
    );

    // The `transfer` case above already moved one `TRANSFERRED` to the recipient.
    expect(await balanceOf(token, RECIPIENT)).toBe(TRANSFERRED * 2n);
  });

  // Every spelling of one contract: OpenZeppelin's, the std library's for SauceScript that imports
  // it, `safe.ts`'s for what the SDK emits into a route, and the three route-body syntaxes a program
  // writes by hand, each through `compileSauceRoute`. Each must land every cell it can spell exactly
  // as the table says — and since the reference must too, every one of them is OZ's behaviour.
  describe.each([OPENZEPPELIN, SAUCE_TOKEN, SAFE_TS, SYMBOL, FACTORY, BOUND])(
    "SafeERC20 through $name",
    (spelling) => {
      beforeAll(async () => {
        reference ??= await deploy(SAFE_ERC20_REFERENCE.creationCode);
      }, 60_000);

      it.each(rows(CELLS.filter((cell) => spelling.writes.includes(cell.write))))(
        "%s -> %s",
        async (_, __, cell) => {
          expect(await run(cell, spelling)).toEqual(expectedOutcome(cell));
        },
        60_000,
      );
    },
  );

  // Why the route syntax had to move: the typed binding it used to lower to — which an explicit
  // `IERC20.at(addr)` still is — gets both cells SafeERC20 exists for wrong, in opposite directions.
  describe("the raw IERC20.at(addr) binding is not SafeERC20", () => {
    it.each([
      ["transfer", "noReturn", "reverted"],
      ["approve", "noReturn", "reverted"],
      ["transfer", "falseReturn", "success"],
      ["approve", "falseReturn", "success"],
    ] as const)(
      "%s on the %s token -> %s, where every SafeERC20 spelling does the opposite",
      async (write, token, status) => {
        const given = READY[write];
        const cell: Cell = { write, token, given, expected: status };
        const safe = CELLS.find(
          (c) => c.write === write && c.token === token && c.given === given && !c.to,
        );

        expect(safe?.expected).toBe(status === "success" ? "reverted" : "success");
        expect((await run(cell, TYPED)).status).toBe(status);
      },
      60_000,
    );
  });

  describe("a program's own names", () => {
    // The lowering imports `@sauce/token` under reserved names, so a program that declares its own
    // `transfer`/`approve` keeps them and the write still lands SafeERC20 — here on USDT, which the
    // typed call reverts on.
    it("a user-declared transfer/approve does not collide with the lowered write", async () => {
      const token = await TOKENS.noReturn();
      await mintTo(token, sauce.pot, AMOUNT);
      const body =
        "function transfer(a) { return a; }\nfunction approve(a) { return a; }\n" +
        `function main() { USDC.transfer(${literal(RECIPIENT)}, transfer(${AMOUNT}n)); ` +
        `Token(${literal(token)}).approve(${literal(SPENDER)}, approve(${AMOUNT}n)); }`;

      expect(await attemptCall(routeCall(body, token))).toBe("success");
      expect(await balanceOf(token, RECIPIENT)).toBe(AMOUNT);
    }, 60_000);
  });

  // A shipped recipe, executed: `plain-transfer.sauce.ts` resolves `USDC` from the registry, so the
  // cell's token is installed at the registry's own USDC address for the destination rather than
  // handed in. Each cell gets a fresh recipient, since the address's storage outlives its code.
  describe("the plain-transfer recipe at the registry's USDC address", () => {
    const destination = requireChain("arbitrum");
    const usdc = numberToHex(registryTokenAddress(destination, "USDC")!, { size: 20 });
    const RECIPIENTS = {
      standard: "0x00000000000000000000000000000000000000a1",
      noReturn: "0x00000000000000000000000000000000000000a2",
      falseReturn: "0x00000000000000000000000000000000000000a3",
      noCode: "0x00000000000000000000000000000000000000a4",
    } as const satisfies Record<string, Address>;

    const install = async (kind: keyof typeof RECIPIENTS) => {
      if (kind === "noCode") {
        await testClient.setCode({ address: usdc, bytecode: "0x" });
        return;
      }
      const deployed = await TOKENS[kind]();
      const code = await publicClient.getCode({ address: deployed });
      await testClient.setCode({ address: usdc, bytecode: code! });
      await mintTo(usdc, sauce.pot, AMOUNT);
    };

    it.each([
      ["standard", "success"],
      ["noReturn", "success"],
      ["falseReturn", "reverted"],
      ["noCode", "reverted"],
    ] as const)(
      "on the %s token -> %s",
      async (kind, status) => {
        await install(kind);
        const recipient = RECIPIENTS[kind];
        const built = buildPlainTransfer({
          from: "base",
          to: destination.slug,
          amount: AMOUNT,
          perMessageLimit: AMOUNT,
          recipient,
          pot: sauce.pot,
          engine: sauce.engine,
          portal: "0x2222222222222222222222222222222222222222",
          deadline: 2000n,
          creator: DEPLOYER.address,
          prover: "0x4444444444444444444444444444444444444444",
          reward: 0n,
        });

        expect(await attemptCall(built.intent.route.calls[0]!.data)).toBe(status);
        if (kind !== "noCode") {
          expect(await balanceOf(usdc, recipient)).toBe(status === "success" ? AMOUNT : 0n);
        }
      },
      60_000,
    );
  });

  describe("each refusal is the check's, not the token's", () => {
    // A LYING token does not revert on its own, so the same write issued raw, with nothing
    // inspecting what came back, has to land — or the cell it controls proves nothing.
    it.each(
      rows(
        CELLS.filter(
          (cell) =>
            cell.expected === "reverted" &&
            ["falseReturn", "oddReturn", "noCode"].includes(cell.token),
        ),
      ),
    )(
      "%s lands when nothing checks what it returns",
      async (_, __, cell) => {
        expect((await run(cell, UNCHECKED)).status).toBe("success");
      },
      60_000,
    );

    it("a plain approve over the standing allowance is what USDT refuses", async () => {
      const cell: Cell = {
        write: "approve",
        token: "noReturn",
        given: "standingAllowance",
        expected: "reverted",
      };

      expect(await run(cell, UNCHECKED)).toEqual({ status: "reverted", effect: STANDING });
    }, 60_000);
  });
});
