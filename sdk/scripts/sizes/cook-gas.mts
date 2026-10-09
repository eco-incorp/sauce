// Where a cook's gas goes, measured: the intrinsic cost and the calldata, the Pot's and the Kitchen's
// work around the engine, the engine's own interpretation of the program, and each call the program
// makes, with every storage write and log, from anvil's opcode trace.
//
//   SAUCE_V12_RUNTIME_CREATION_HEX=<file> ../../../mcp/node_modules/.bin/tsx cook-gas.mts \
//     [--usdc] [one-hop] [one-hop-in-a-try] [two-hops] [-e '<source>']
//   ../../../mcp/node_modules/.bin/tsx cook-gas.mts --rpc <url> --hash <tx>
//
// The named programs are `intent-compiles-to.e2e`'s, cooked as it cooks them: on an anvil with the
// released gated stack and eco-routes' Portal, from the owner's Pot, which holds exactly what it
// sends; `-e` cooks a program of your own with their `main` arguments `(amount, delivered,
// beneficiary, refundTo)`. The token is the suites' MockERC20 at USDC's address, or with `--usdc`
// USDC's own proxy and FiatToken implementation from the captured Ethereum state
// (`actions/tests/state`). `--rpc` and `--hash` break down any transaction on a node that keeps
// opcode traces (anvil `--steps-tracing`); `SAUCE_COOK_STEPS=<dir>` keeps each trace. The engine's
// instructions are found by its dispatch (a jump through a table indexed by the next program byte),
// which a new engine release may change. Run from a built tree (`pnpm build`), from this directory;
// tsx is the one the workspace carries for `mcp` and `actions`.
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  concatHex,
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

const HERE = dirname(fileURLToPath(import.meta.url));

/** One opcode step of a geth-style trace. */
interface Step {
  readonly pc: number;
  readonly op: string;
  readonly gas: number;
  readonly gasCost: number;
  readonly depth: number;
  readonly stack?: readonly string[];
}

/** What one frame spent on itself, by kind, and the calls it made. */
interface Frame {
  readonly kind: string;
  readonly code: string;
  readonly storage: string;
  readonly depth: number;
  readonly firstGas: number;
  remaining: number;
  /** Gas by kind of opcode: `sstore`, `sload`, `tstore`, `tload`, `keccak`, `log`, `account`,
   *  `call` (a call's own cost, net of a stipend), `other` (the rest: interpretation). */
  readonly spent: Record<string, number>;
  readonly sstores: { slot: string; cost: number }[];
  readonly logs: { topics: number; data: number; cost: number }[];
  readonly keccaks: { bytes: number; cost: number }[];
  readonly calls: { frame?: Frame; kind: string; to: string; input: number; cost: number }[];
  /** Each opcode's count and gas in this frame, its calls' own costs included. */
  readonly ops: Map<string, { count: number; gas: number }>;
  /** Its own steps' gas between one call and the next: before the first, between each, after the
   *  last. */
  readonly segments: number[];
  /** The engine's instructions, where this frame interprets a program: each one's opcode, its
   *  offset in the program, and everything it cost, its calls whole. */
  readonly instructions: { op: number; at: number; gas: number }[];
  /** What the frame spent before its first instruction. */
  beforeFirst: number;
  lastLoad: number;
}

const CALLS = new Set(["CALL", "CALLCODE", "DELEGATECALL", "STATICCALL", "CREATE", "CREATE2"]);
const ACCOUNT = new Set(["BALANCE", "EXTCODESIZE", "EXTCODEHASH", "EXTCODECOPY", "SELFBALANCE"]);

const top = (step: Step, index: number): bigint =>
  BigInt(step.stack![step.stack!.length - 1 - index]!);
const addressOf = (word: bigint): string => getAddress(`0x${word.toString(16).padStart(40, "0")}`);

/** The frames of `steps`, each with what it spent on itself, from the gas between its steps. */
function framesOf(steps: readonly Step[], to: string): Frame {
  const frame = (
    kind: string,
    code: string,
    storage: string,
    depth: number,
    gas: number,
  ): Frame => ({
    kind,
    code,
    storage,
    depth,
    firstGas: gas,
    remaining: 0,
    spent: {},
    sstores: [],
    logs: [],
    keccaks: [],
    calls: [],
    ops: new Map(),
    segments: [0],
    instructions: [],
    beforeFirst: 0,
    lastLoad: 0,
  });
  const root = frame("CALL", to, to, steps[0]!.depth, steps[0]!.gas);
  const open: Frame[] = [root];
  /** The call steps waiting for their frame to return: the caller, the step, its child. */
  const pending: { caller: Frame; at: number; child: Frame; call: Frame["calls"][number] }[] = [];
  const add = (into: Frame, kind: string, gas: number) => {
    into.spent[kind] = (into.spent[kind] ?? 0) + gas;
  };
  const charge = (into: Frame, gas: number) => {
    const last = into.instructions[into.instructions.length - 1];
    if (last === undefined) into.beforeFirst += gas;
    else last.gas += gas;
  };
  const count = (into: Frame, op: string, gas: number) => {
    const seen = into.ops.get(op) ?? { count: 0, gas: 0 };
    into.ops.set(op, { count: seen.count + 1, gas: seen.gas + gas });
  };

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    const next = steps[i + 1];
    const here = open[open.length - 1]!;
    if (next !== undefined && next.depth > step.depth && CALLS.has(step.op)) {
      // A call into code: its cost is known when the frame it opens returns.
      const target = step.op.startsWith("CREATE") ? "(created)" : addressOf(top(step, 1));
      const storage = step.op === "DELEGATECALL" || step.op === "CALLCODE" ? here.storage : target;
      const input = step.op.startsWith("CREATE")
        ? Number(top(step, 2))
        : Number(top(step, step.op === "CALL" || step.op === "CALLCODE" ? 4 : 3));
      const child = frame(step.op, target, storage, next.depth, next.gas);
      const call = { frame: child, kind: step.op, to: target, input, cost: 0 };
      here.calls.push(call);
      pending.push({ caller: here, at: i, child, call });
      open.push(child);
      continue;
    }
    const leaves = next === undefined || next.depth < step.depth;
    const cost = leaves ? step.gasCost : step.gas - next.gas;
    count(here, step.op, cost);
    if (step.op === "CALLDATALOAD") here.lastLoad = Number(top(step, 0));
    // The engine's dispatch: the next opcode byte, read from the program, doubled, its handler's
    // address read from a table in memory, and jumped to.
    const ops = [4, 3, 2, 1].map((back) => steps[i - back]?.op).join(" ");
    if (step.op === "JUMP" && ops === "SHL MLOAD PUSH1 SHR") {
      here.instructions.push({ op: Number(top(steps[i - 4]!, 1)), at: here.lastLoad, gas: 0 });
    }
    if (!CALLS.has(step.op)) charge(here, cost);
    if (CALLS.has(step.op)) here.segments.push(0);
    else here.segments[here.segments.length - 1]! += cost;
    if (leaves) {
      const halted = ["STOP", "RETURN", "REVERT", "SELFDESTRUCT"].includes(step.op);
      here.remaining = halted ? step.gas - step.gasCost : 0;
    }
    if (step.op === "SSTORE") {
      here.sstores.push({ slot: `0x${top(step, 0).toString(16)}`, cost });
      add(here, "sstore", cost);
    } else if (step.op === "SLOAD") add(here, "sload", cost);
    else if (step.op === "TSTORE") add(here, "tstore", cost);
    else if (step.op === "TLOAD") add(here, "tload", cost);
    else if (step.op === "KECCAK256") {
      here.keccaks.push({ bytes: Number(top(step, 1)), cost });
      add(here, "keccak", cost);
    } else if (step.op.startsWith("LOG")) {
      here.logs.push({ topics: Number(step.op.slice(3)), data: Number(top(step, 1)), cost });
      add(here, "log", cost);
    } else if (ACCOUNT.has(step.op)) add(here, "account", cost);
    else if (CALLS.has(step.op)) {
      // A call that ran no code (an account without any, or a precompile): all of it is its own.
      const target = step.op.startsWith("CREATE") ? "(created)" : addressOf(top(step, 1));
      here.calls.push({ kind: step.op, to: target, input: 0, cost });
      add(here, "call", cost);
      charge(here, cost);
    } else add(here, "other", cost);

    if (leaves && next !== undefined) {
      open.pop();
      const waiting = pending.pop()!;
      // The caller paid everything between the call step and its next step; the child consumed
      // what it was given less what it returned. The rest is the call's own (net of a stipend).
      const total = steps[waiting.at]!.gas - next.gas;
      const consumed = waiting.child.firstGas - waiting.child.remaining;
      waiting.call.cost = total - consumed;
      add(waiting.caller, "call", total - consumed);
      count(waiting.caller, steps[waiting.at]!.op, total - consumed);
      waiting.caller.segments.push(0);
      charge(waiting.caller, total);
    }
  }

  return root;
}

/** Everything a frame and the frames under it consumed. */
const consumedBy = (frame: Frame): number => frame.firstGas - frame.remaining;
/** What a frame spent on itself, its calls' own costs left out (each call is a row of its own). */
const selfOf = (frame: Frame): number =>
  Object.entries(frame.spent)
    .filter(([kind]) => kind !== "call")
    .reduce((sum, [, gas]) => sum + gas, 0);
/** A call's whole cost to its caller: its own, and what the callee consumed. */
const totalOf = (call: Frame["calls"][number]): number =>
  call.cost + (call.frame === undefined ? 0 : consumedBy(call.frame));

/** Calldata's cost: 4 per zero byte, 16 per other, and the EIP-7623 floor of 10 per token. */
function calldataOf(input: Hex) {
  const bytes = Buffer.from(input.slice(2), "hex");
  const zero = bytes.filter((byte) => byte === 0).length;
  const nonzero = bytes.length - zero;
  return {
    bytes: bytes.length,
    zero,
    nonzero,
    gas: 4 * zero + 16 * nonzero,
    floor: 21_000 + 10 * (zero + 4 * nonzero),
  };
}

/** A transaction's gas, broken down. */
async function breakdown(client: PublicClient, hash: Hex, labels: Map<string, string>) {
  const tx = await client.getTransaction({ hash });
  const receipt = await client.getTransactionReceipt({ hash });
  const trace = (await client.request({
    method: "debug_traceTransaction" as never,
    params: [hash, { disableStorage: true, enableMemory: false }] as never,
  })) as { structLogs: Step[] };
  if (trace.structLogs.length === 0) {
    throw new Error("the node kept no opcode trace: run anvil with --steps-tracing");
  }
  const changes = (await client.request({
    method: "debug_traceTransaction" as never,
    params: [hash, { tracer: "prestateTracer", tracerConfig: { diffMode: true } }] as never,
  })) as {
    pre: Record<string, { storage?: Record<string, Hex> }>;
    post: Record<string, { storage?: Record<string, Hex> }>;
  };
  const steps = trace.structLogs;
  // `SAUCE_COOK_STEPS=<dir>` keeps each opcode trace, for a closer look than this one.
  const keep = process.env.SAUCE_COOK_STEPS;
  if (keep !== undefined) writeFileSync(join(keep, `${hash}.json`), JSON.stringify(steps));
  const root = framesOf(steps, getAddress(tx.to!));
  const calldata = calldataOf(tx.input);
  const intrinsic = Number(tx.gas) - steps[0]!.gas;
  const execution = consumedBy(root);
  const refund = intrinsic + execution - Number(receipt.gasUsed);
  const name = (address: string) => labels.get(getAddress(address)) ?? getAddress(address);

  const gas = (value: number) => value.toLocaleString("en-US");
  const intrinsicNote = `${calldata.bytes} bytes of calldata: ${calldata.zero} zero × 4, ${calldata.nonzero} non-zero × 16`;
  const floorNote = `the EIP-7623 floor is ${gas(calldata.floor)}, ${calldata.floor <= Number(receipt.gasUsed) ? "below the total" : "ABOVE the total: the transaction pays the floor, and these rows do not"}`;

  // The summary: the transaction, what the Pot and the Kitchen do around the engine, the engine's
  // own work, and each call the engine makes, whole.
  const summary: string[] = ["| Where | Gas | What |", "| --- | ---: | --- |"];
  const line = (where: string, value: number, what = "") =>
    summary.push(`| ${where} | ${gas(value)} | ${what} |`);
  line("intrinsic", 21_000, "the transaction");
  line("calldata", calldata.gas, `${intrinsicNote}; ${floorNote}`);
  if (intrinsic !== 21_000 + calldata.gas)
    line("intrinsic, unaccounted", intrinsic - 21_000 - calldata.gas);
  const kinds = (frame: Frame) =>
    Object.entries(frame.spent)
      .filter(([kind, value]) => kind !== "call" && value !== 0)
      .sort(([, a], [, b]) => b - a)
      .map(([kind, value]) => `${kind} ${gas(value)}`)
      .join(", ");
  let sum = 21_000 + calldata.gas + (intrinsic - 21_000 - calldata.gas);
  line(`${name(root.code)}, its own steps`, selfOf(root), kinds(root));
  sum += selfOf(root);
  let engine: Frame | undefined;
  for (const call of root.calls) {
    if (call.frame !== undefined && name(call.to) === "engine") {
      engine = call.frame;
      line(`${call.kind} engine, the call`, call.cost, `${call.input} bytes in`);
      const between = engine.calls.map((inner) => `${name(inner.to)}`);
      const segments = engine.segments
        .map((value, at) =>
          at === 0
            ? `${gas(value)} before ${between[0] ?? "the end"}`
            : `${gas(value)} after ${between[at - 1]}`,
        )
        .join(", ");
      line(
        "engine, its own steps",
        selfOf(engine),
        `${kinds(engine)}; between its calls: ${segments}`,
      );
      sum += call.cost + selfOf(engine);
      for (const inner of engine.calls) {
        line(
          `engine → ${inner.kind} ${name(inner.to)} ${callName(inner)}`,
          totalOf(inner),
          callNote(inner),
        );
        sum += totalOf(inner);
      }
      continue;
    }
    line(`${call.kind} ${name(call.to)} ${callName(call)}`, totalOf(call), callNote(call));
    sum += totalOf(call);
  }
  line("refund", -refund, "storage cleared (EIP-3529)");
  sum -= refund;
  line(
    "total",
    Number(receipt.gasUsed),
    sum === Number(receipt.gasUsed)
      ? "the receipt's, and the sum of the rows"
      : `the receipt's; the rows sum to ${gas(sum)}`,
  );

  function callName(call: Frame["calls"][number]): string {
    return call.frame === undefined ? "(no code)" : "";
  }
  function callNote(call: Frame["calls"][number]): string {
    const parts = [`${gas(call.cost)} the call itself`];
    if (call.frame !== undefined) {
      parts.push(`${gas(consumedBy(call.frame))} the callee (${call.input} bytes in)`);
      const under = (frame: Frame): Frame[] => [
        frame,
        ...frame.calls.flatMap((c) => (c.frame === undefined ? [] : under(c.frame))),
      ];
      const frames = under(call.frame);
      const writes = frames.flatMap((f) => f.sstores.map((w) => `SSTORE ${w.cost}`));
      const logs = frames.flatMap((f) =>
        f.logs.map((l) => `LOG${l.topics} of ${l.data} bytes ${gas(l.cost)}`),
      );
      const loads = frames.reduce((n, f) => n + (f.spent.sload ?? 0), 0);
      const hashes = frames.flatMap((f) => f.keccaks);
      if (writes.length > 0) parts.push(writes.join(", "));
      if (loads > 0) parts.push(`SLOAD ${gas(loads)}`);
      if (logs.length > 0) parts.push(logs.join(", "));
      if (hashes.length > 0) {
        parts.push(
          `keccak ${gas(hashes.reduce((n, k) => n + k.cost, 0))} over ${hashes.map((k) => k.bytes).join("+")} bytes`,
        );
      }
    }
    return parts.join("; ");
  }

  // The tree: every frame's own steps and every call's own cost.
  const lines: string[] = ["| Frame | Gas | What |", "| --- | ---: | --- |"];
  const row = (what: string, value: number, note = "") =>
    lines.push(`| ${what} | ${gas(value)} | ${note} |`);
  const describe = (frame: Frame, path: string) => {
    const writes = frame.sstores.map(
      (write) => `SSTORE ${name(frame.storage)}[${write.slot.slice(0, 10)}…] ${write.cost}`,
    );
    const logs = frame.logs.map(
      (log) => `LOG${log.topics}, ${log.data} bytes of data, ${gas(log.cost)}`,
    );
    const hashes =
      frame.keccaks.length === 0
        ? []
        : [`keccak over ${frame.keccaks.map((k) => k.bytes).join("+")} bytes`];
    row(path, selfOf(frame), [kinds(frame), ...writes, ...logs, ...hashes].join("; "));
    for (const call of frame.calls) {
      row(
        `${path} → ${call.kind} ${name(call.to)}, the call`,
        call.cost,
        call.frame === undefined ? "no code ran" : `${call.input} bytes in`,
      );
      if (call.frame !== undefined) describe(call.frame, `${path} → ${name(call.to)}`);
    }
  };
  describe(root, name(root.code));

  // What the engine's own steps are, by opcode.
  const opcodes =
    engine === undefined
      ? ""
      : [...engine.ops.entries()]
          .filter(([op]) => !CALLS.has(op))
          .sort(([, a], [, b]) => b.gas - a.gas)
          .slice(0, 12)
          .map(([op, seen]) => `${op} ${seen.count}× ${gas(seen.gas)}`)
          .join(", ") +
        ` (${gas([...engine.ops.values()].reduce((n, seen) => n + seen.count, 0))} steps in all)`;

  const writes: string[] = [];
  for (const account of new Set([...Object.keys(changes.pre), ...Object.keys(changes.post)])) {
    const before = changes.pre[account]?.storage ?? {};
    const after = changes.post[account]?.storage ?? {};
    for (const slot of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const was = BigInt(before[slot] ?? "0x0");
      const is = BigInt(after[slot] ?? "0x0");
      if (was !== is) writes.push(`${name(account)} ${slot.slice(0, 10)}…: ${was} → ${is}`);
    }
  }

  // What the engine's instructions cost, by opcode (v12-evm's OPCODES.md names them): each one from
  // its dispatch to the next, a call it makes whole.
  let instructions = "";
  if (engine !== undefined && engine.instructions.length > 0) {
    const byOp = new Map<number, { op: number; at: number; gas: number }[]>();
    for (const each of engine.instructions) byOp.set(each.op, [...(byOp.get(each.op) ?? []), each]);
    const hex = (value: number) => `0x${value.toString(16).padStart(2, "0")}`;
    instructions = [
      `${engine.instructions.length} instructions; ${gas(engine.beforeFirst)} before the first (the engine's start and the gate)`,
      ...[...byOp.entries()]
        .map(([op, each]) => ({ op, each, total: each.reduce((n, one) => n + one.gas, 0) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 16)
        .map(
          ({ op, each, total }) =>
            `- ${hex(op)} ×${each.length}: ${gas(total)}` +
            (each.length <= 6
              ? ` (${each.map((one) => `${gas(one.gas)} at ${hex(one.at)}`).join(", ")})`
              : ""),
        ),
    ].join("\n");
  }

  return {
    instructions,
    summary: summary.join("\n"),
    table: lines.join("\n"),
    opcodes,
    writes,
    total: Number(receipt.gasUsed),
  };
}

const SALT = `0x${"5a".repeat(32)}` as Hex;
const OPTIONS = { intents: { executionFee: 777n, openedAt: 1_900_000_000n, salt: SALT } };
const MAIN =
  "function main(amount: Uint256, delivered: Uint256, beneficiary: Address, refundTo: Address)";
const HOP =
  "Base.hop({ send: { token: USDC, amount }, receive: { token: USDC, amount: delivered }, refundee: refundTo })";
const PROGRAMS: Record<string, string> = {
  "one-hop": `${MAIN} {
  ${HOP}.then(() => {
    USDC.transfer(beneficiary, delivered);
  });
}`,
  "one-hop-in-a-try": `${MAIN} {
  try {
    ${HOP}
      .then(() => {
        USDC.transfer(beneficiary, delivered);
      })
      .catch((e) => {
        USDC.transfer(refundTo, delivered);
      });
  } catch (e) {
    USDC.transfer(refundTo, delivered);
  }
}`,
  "two-hops": `${MAIN} {
  ${HOP}.then(() => {
    Optimism.hop({ send: { token: USDC, amount: delivered }, receive: { token: USDC, amount: delivered - 1000 }, refundee: refundTo }).then(() => {
      USDC.transfer(beneficiary, delivered - 1000);
    });
  });
}`,
};
const ARGUMENTS = [
  1_234_567n,
  1_200_001n,
  "0x6666666666666666666666666666666666666666",
  "0x4444444444444444444444444444444444444444",
] as const;

/** USDC's proxy and FiatToken implementation, and the proxy's storage, as captured on Ethereum. */
function capturedUsdc() {
  const state = JSON.parse(
    gunzipSync(
      readFileSync(join(HERE, "../../../actions/tests/state/actions.genesis.json.gz")),
    ).toString(),
  ) as { alloc?: Record<string, { code?: Hex; storage?: Record<Hex, Hex> }> };
  const alloc = Object.fromEntries(
    Object.entries(state.alloc ?? state).map(([address, account]) => [
      address.toLowerCase(),
      account as { code?: Hex; storage?: Record<Hex, Hex> },
    ]),
  );
  const proxy = alloc["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"]!;
  const implementation = "0x43506849d7c04f9138d1a2050bbf3a0c054402dd";

  return { proxy, implementation, code: alloc[implementation]!.code! };
}

/** One breakdown, as Markdown. */
const report = (title: string, measured: Awaited<ReturnType<typeof breakdown>>): string =>
  [
    `## ${title}`,
    measured.summary,
    `The engine's own steps, by opcode: ${measured.opcodes}`,
    `The engine's instructions, by opcode (v12-evm's OPCODES.md names them), a call's whole cost in the instruction that makes it:\n${measured.instructions}`,
    `Storage written:\n${measured.writes.map((write) => `- ${write}`).join("\n")}`,
    measured.table,
    "",
  ].join("\n\n");

async function main(argv: string[]) {
  const flag = (name: string) => {
    const at = argv.indexOf(name);
    return at < 0 ? undefined : argv[at + 1];
  };
  if (flag("--hash") !== undefined) {
    const { v12EngineAddress, v12KitchenAddress, v12KitchenImplementationAddress } =
      await import("../../src/deployments/index.js");
    const client = createPublicClient({ transport: http(flag("--rpc")) });
    const labels = new Map([
      [getAddress(v12EngineAddress()), "engine"],
      [getAddress(v12KitchenAddress()), "Kitchen"],
      [getAddress(v12KitchenImplementationAddress()), "Kitchen implementation"],
    ]);
    console.log(report(flag("--hash")!, await breakdown(client, flag("--hash") as Hex, labels)));
    return;
  }

  // Every anvil the harness starts keeps opcode traces: an `anvil` first on PATH adds the flag.
  const shim = mkdtempSync(join(tmpdir(), "cook-gas-"));
  const real = process.env
    .PATH!.split(":")
    .map((dir) => join(dir, "anvil"))
    .find((path) => existsSync(path));
  writeFileSync(join(shim, "anvil"), `#!/bin/sh\nexec ${real} --steps-tracing "$@"\n`);
  chmodSync(join(shim, "anvil"), 0o755);
  process.env.PATH = `${shim}:${process.env.PATH}`;

  const { v12EngineAddress, v12KitchenImplementationAddress } =
    await import("../../src/deployments/index.js");
  const { encodeEntryArguments } = await import("../../src/routes/entry.js");
  const { buildSauceEvmCall } = await import("../../src/routes/sauce-calls.js");
  const { compileSauceProgram } = await import("../../src/routes/sauce-route.js");
  const { gateAnchors } = await import("../../test/evm/gated-engine.js");
  const anvil = await import("../../test/cli-anvil.js");
  const { freePort } = await import("../../test/pools-anvil.js");

  const realUsdc = argv.includes("--usdc");
  // `-e '<source>'` cooks a program of your own, with the same arguments.
  const given = flag("-e");
  const names = argv.filter(
    (arg, at) => !arg.startsWith("-") && argv[at - 1] !== "-e" && argv[at - 1] !== "--rpc",
  );
  if (given !== undefined) PROGRAMS["-e"] = given;
  const local = await anvil.startChain("ethereum", await freePort());
  try {
    const { portal, executor } = await anvil.placePortal(local);
    const usdc = anvil.registered(local.chain, "USDC");
    if (realUsdc) {
      const captured = capturedUsdc();
      await local.testClient.setCode({ address: usdc, bytecode: captured.proxy.code! });
      for (const [slot, value] of Object.entries(captured.proxy.storage ?? {})) {
        await local.testClient.setStorageAt({ address: usdc, index: slot as Hex, value });
      }
      await local.testClient.setCode({
        address: captured.implementation as Address,
        bytecode: captured.code,
      });
    } else await local.plant(anvil.fixture("MockERC20"), usdc);
    const pot = await anvil.deployPot(local);
    const kitchen = gateAnchors().kitchen;
    const labels = new Map<string, string>([
      [getAddress(pot), "Pot"],
      [getAddress(kitchen), "Kitchen"],
      [getAddress(String(v12EngineAddress())), "engine"],
      [getAddress(portal), "Portal"],
      [getAddress(executor), "Executor"],
      [getAddress(usdc), "USDC"],
      [getAddress("0x43506849d7c04f9138d1a2050bbf3a0c054402dd"), "FiatToken"],
    ]);
    labels.set(getAddress(v12KitchenImplementationAddress()), "Kitchen implementation");

    const chosen = given !== undefined ? [...names, "-e"] : names;
    for (const name of chosen.length === 0 ? Object.keys(PROGRAMS) : chosen) {
      const program = compileSauceProgram("ethereum", PROGRAMS[name]!, OPTIONS);
      const payload = concatHex([
        `0x${Buffer.from(program.bytecode).toString("hex")}`,
        `0x${Buffer.from(encodeEntryArguments(program, [...ARGUMENTS])).toString("hex")}`,
      ]);
      if (realUsdc) {
        // FiatToken keeps a holder's balance in `balanceAndBlacklistStates`, slot 9.
        await local.testClient.setStorageAt({
          address: usdc,
          index: keccak256(
            encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [pot, 9n]),
          ),
          value: `0x${ARGUMENTS[0].toString(16).padStart(64, "0")}`,
        });
        if ((await local.balanceOf(usdc, pot)) !== ARGUMENTS[0]) {
          throw new Error("USDC's balance slot is not where FiatToken keeps it");
        }
      } else await local.mint(usdc, pot, ARGUMENTS[0]);
      const call = buildSauceEvmCall({
        pot,
        engine: v12EngineAddress() as Hex,
        program: payload,
        value: anvil.FEE,
      });
      const hash = await local.send(local.owner, call.to as Address, call.data, call.value);
      const receipt = await local.publicClient.getTransactionReceipt({ hash });
      const vault = receipt.logs.find((log) => getAddress(log.address) === getAddress(usdc))
        ?.topics[2];
      if (vault !== undefined) labels.set(getAddress(`0x${vault.slice(-40)}`), "the vault");
      const measured = await breakdown(local.publicClient as PublicClient, hash, labels);
      console.log(
        report(
          `${name}${realUsdc ? " (USDC's own code)" : ""}: the program ${program.bytecode.length} bytes`,
          measured,
        ),
      );
    }
  } finally {
    await local.stop();
  }
}

await main(process.argv.slice(2));
