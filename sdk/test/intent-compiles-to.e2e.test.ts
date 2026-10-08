/**
 * What `hop(...).then(...)` compiles to. `@sauce/intents`' class runs while the file compiles, so a
 * hop leaves the program only its run-time work: the intent, encoded once, its vault read, the
 * payment into it, and the publish. This suite writes that residual program out from the real
 * thing rather than by hand: each file is compiled as the SDK compiles it and cooked on anvil
 * through eco-routes' own Portal, its calls read back from the cook's call trace, the intent
 * decoded from its `publish`, and every value that changes with `main`'s arguments (two runs,
 * different arguments) marked as a hole, `«amount»`. The printouts are `fixtures/intent-compiles-to/
 * *.folded.txt`, which #61's description quotes; `SAUCE_FOLDED_WRITE=1` rewrites them.
 *
 * It holds the class to encoding the intent ONCE: `intentVaultAddress` and `publish` take the same
 * `(uint64, bytes, Reward)`, and the two calls carry the same bytes. And it builds a template of
 * each intent — its constant bytes written into the program, each hole a word spliced in, so
 * nothing is ABI-encoded as it runs — which must publish the class's intent byte for byte; the
 * gas of both is logged, the measurement #61 reports.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite (`cli-anvil.ts`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { concatHex, decodeFunctionData, parseAbi, type Address, type Hex } from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { v12EngineAddress } from "../src/deployments/index.js";
import { v12Pot } from "../src/evm/engine.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { decodeRouteEvm } from "../src/routes/encode.js";
import { encodeEntryArguments } from "../src/routes/entry.js";
import { buildSauceEvmCall } from "../src/routes/sauce-calls.js";
import { compileSauceProgram, type CompiledSauceProgram } from "../src/routes/sauce-route.js";
import {
  deployPot,
  describeEvm,
  FEE,
  fixture,
  placePortal,
  registered,
  startChain,
  type LocalChain,
} from "./cli-anvil.js";
import { freePort } from "./pools-anvil.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures/intent-compiles-to");
const SALT = `0x${"5a".repeat(32)}` as Hex;
/** One opening time and salt, so each file builds the same intent whenever it compiles. */
const OPTIONS = { intents: { executionFee: 777n, openedAt: 1_900_000_000n, salt: SALT } };
const MAIN =
  "function main(amount: Uint256, delivered: Uint256, beneficiary: Address, refundTo: Address)";
const HOP =
  "Base.hop({ send: { token: USDC, amount }, receive: { token: USDC, amount: delivered }, refundee: refundTo })";

const PROGRAMS = {
  "one-hop": `${MAIN} {
  await ${HOP};
  USDC.transfer(beneficiary, delivered);
}`,
  "one-hop-in-a-try": `${MAIN} {
  try {
    await ${HOP};
    USDC.transfer(beneficiary, delivered);
  } catch (e) {
    USDC.transfer(refundTo, delivered);
  }
}`,
  "two-hops": `${MAIN} {
  await ${HOP};
  await Optimism.hop({ send: { token: USDC, amount: delivered }, receive: { token: USDC, amount: delivered - 1000 }, refundee: refundTo });
  USDC.transfer(beneficiary, delivered - 1000);
}`,
} as const;

/** Three sets of `main`'s arguments, each its own intent: two to find the holes, one to compare. */
const REFUND_TO = 0x4444444444444444444444444444444444444444n;
const ARGUMENTS = [
  [1_234_567n, 1_200_001n, 0x6666666666666666666666666666666666666666n, REFUND_TO],
  [
    2_345_678n,
    2_300_002n,
    0x7777777777777777777777777777777777777777n,
    0x4545454545454545454545454545454545454545n,
  ],
  [3_456_789n, 3_400_003n, 0x8888888888888888888888888888888888888888n, REFUND_TO],
] as const;
const HOLES = ["amount", "delivered", "beneficiary", "refundTo"] as const;

/** One frame of a `callTracer` trace. */
interface Frame {
  readonly type: string;
  readonly to: Address;
  readonly input: Hex;
  readonly calls?: readonly Frame[];
}
const flat = (frame: Frame): Frame[] => [frame, ...(frame.calls ?? []).flatMap(flat)];

/** A value's 32-byte word, as hex digits. */
const word = (value: bigint): string => value.toString(16).padStart(64, "0");

const TRANSFER = parseAbi(["function transfer(address to, uint256 amount)"]);

/** The route's salt in a `publish` call's calldata. */
const saltOf = (input: Hex): bigint =>
  BigInt(
    decodeRouteEvm(
      (decodeFunctionData({ abi: PortalABI, data: input }).args as unknown as [bigint, Hex])[1],
    ).salt,
  );

describeEvm("what a hop compiles to", () => {
  let local: LocalChain;
  let portal: Address;
  let usdc: Address;
  let pot: Address;

  beforeAll(async () => {
    local = await startChain("ethereum", await freePort());
    ({ portal } = await placePortal(local));
    usdc = await local.plant(fixture("MockERC20"), registered(local.chain, "USDC"));
    pot = await deployPot(local);
  }, 180_000);

  afterAll(async () => {
    await local?.stop();
  });

  /** Cooks `program` with `args` on the owner's Pot, funded with the amount it sends: its gas, and
   *  the calls the cook made. */
  const cook = async (program: CompiledSauceProgram, args: readonly bigint[]) => {
    const values = args.map((value, i) =>
      program.entryParams[i]!.type === "Address"
        ? `0x${value.toString(16).padStart(40, "0")}`
        : value,
    );
    const payload = concatHex([
      `0x${Buffer.from(program.bytecode).toString("hex")}`,
      `0x${Buffer.from(encodeEntryArguments(program, values)).toString("hex")}`,
    ]);
    await local.mint(usdc, pot, args[0]!);
    const call = buildSauceEvmCall({
      pot,
      engine: v12EngineAddress() as Hex,
      program: payload,
      value: FEE,
    });
    const hash = await local.send(local.owner, call.to as Address, call.data, call.value);
    const { gasUsed } = await local.publicClient.getTransactionReceipt({ hash });
    const trace = (await local.publicClient.request({
      method: "debug_traceTransaction" as never,
      params: [hash, { tracer: "callTracer" }] as never,
    })) as Frame;
    const calls = flat(trace).slice(1);
    const to = (address: Address, selector: string) =>
      calls.find(
        (frame) =>
          frame.to.toLowerCase() === address.toLowerCase() && frame.input.startsWith(selector),
      )!;

    return {
      gas: gasUsed,
      calls,
      vault: to(portal, "0x0742ebe4"),
      transfer: to(usdc, "0xa9059cbb"),
      publish: to(portal, "0x645c890c"),
    };
  };

  /** Where each hole's word is in the encoded intent: `main`'s arguments, and the salt. */
  const holesIn = (intent: string, args: readonly bigint[], salt: bigint) => {
    const found: { at: number; name: string }[] = [];
    for (const [name, value] of [
      ...HOLES.map((hole, i) => [hole, args[i]!] as const),
      ["salt", salt] as const,
    ]) {
      for (
        let at = intent.indexOf(word(value));
        at >= 0;
        at = intent.indexOf(word(value), at + 2)
      ) {
        if (at % 2 === 0) found.push({ at: at / 2, name });
      }
    }
    return found.sort((x, y) => x.at - y.at);
  };

  for (const [name, source] of Object.entries(PROGRAMS)) {
    it(`${name}: the residual program, encoding the intent once`, async () => {
      const program = compileSauceProgram("ethereum", source, OPTIONS);
      const first = await cook(program, ARGUMENTS[0]);
      const second = await cook(program, ARGUMENTS[1]);

      // Encoded once: the vault read and the publish carry the same bytes.
      const intent = first.publish.input.slice(10);
      expect(first.vault.input.slice(10)).toBe(intent);

      const [destination, routeBytes, reward] = decodeFunctionData({
        abi: PortalABI,
        data: first.publish.input,
      }).args as [bigint, Hex, Reward];
      const route = decodeRouteEvm(routeBytes);
      const holes = holesIn(intent, ARGUMENTS[0], BigInt(route.salt));
      // Every byte but the holes is the same in the second run: nothing else depends on `main`.
      const blank = (text: string, found: { at: number }[]) =>
        found.reduce(
          (out, { at }) => out.slice(0, at * 2) + "_".repeat(64) + out.slice(at * 2 + 64),
          text,
        );
      const otherIntent = second.publish.input.slice(10);
      const otherHoles = holesIn(otherIntent, ARGUMENTS[1], saltOf(second.publish.input));
      expect(blank(otherIntent, otherHoles)).toBe(blank(intent, holes));

      const folded = render({ name, program, destination, route, reward, first, holes });
      const path = join(FIXTURES, `${name}.folded.txt`);
      if (process.env.SAUCE_FOLDED_WRITE === "1") writeFileSync(path, folded);
      expect(folded).toBe(readFileSync(path, "utf8"));

      // The template: the same intent, nothing ABI-encoded as it runs. From one state, the class's
      // cook and the template's publish the same bytes.
      const template = compileSauceProgram("ethereum", templateOf(name, intent, holes), OPTIONS);
      const snapshot = await local.testClient.snapshot();
      const byClass = await cook(program, ARGUMENTS[2]);
      await local.testClient.revert({ id: snapshot });
      const byTemplate = await cook(template, ARGUMENTS[2]);
      expect(byTemplate.publish.input).toBe(byClass.publish.input);
      console.log(
        `${name}: ${program.bytecode.length} bytes, cook ${byClass.gas} gas; ` +
          `template ${template.bytecode.length} bytes, cook ${byTemplate.gas} gas`,
      );
    }, 300_000);
  }

  /** The template of an encoded intent: its constant bytes, each hole a word. */
  const templateOf = (name: string, intent: string, holes: { at: number; name: string }[]) => {
    const parts: string[] = [];
    let last = 0;
    for (const { at, name: hole } of holes) {
      if (at > last) parts.push(`hex\`${intent.slice(last * 2, at * 2)}\``);
      parts.push(`abi.encode(${hole})`);
      last = at + 32;
    }
    if (last * 2 < intent.length) parts.push(`hex\`${intent.slice(last * 2)}\``);
    const encoded = parts.reduce((joined, part) => `${joined}.concat(${part})`);
    // As the class publishes it: its salt from the transaction's count of intents, then the vault
    // read, the payment and the publish, inside the `try` where the file has one.
    const publish = [
      `const intent = ${encoded};`,
      'const [vault] = abi.decode(evm.static(PORTAL, hex`0742ebe4`.concat(intent)), ["Address"]);',
      "transfer(USDC, vault, amount);",
      "evm.call(PORTAL, 0, hex`645c890c`.concat(intent));",
    ];
    const body = name.includes("try")
      ? [
          "try {",
          ...publish.map((line) => `  ${line}`),
          "} catch (e) {",
          "  USDC.transfer(refundTo, delivered);",
          "}",
        ]
      : publish;

    return [
      'import { transfer } from "@sauce/token";',
      `const PORTAL = ${portal};`,
      "const NONCE = 0x91da66d2ed07997bae5bcd0c9e8b6e7824eb17d69e494553b5ad7ec46532b578;",
      `const BASE_SALT = ${SALT};`,
      `${MAIN} {`,
      "  const opened = evm.tload(NONCE) + 1;",
      "  evm.tstore(NONCE, opened);",
      "  const salt = crypto.keccak256(abi.encode(BASE_SALT, opened));",
      ...body.map((line) => `  ${line}`),
      "}",
      "",
    ].join("\n");
  };

  /** The residual program, as SauceScript-like text: the intent with its holes, and the calls. */
  const render = (given: {
    readonly name: string;
    readonly program: CompiledSauceProgram;
    readonly destination: bigint;
    readonly route: ReturnType<typeof decodeRouteEvm>;
    readonly reward: Reward;
    readonly first: Awaited<ReturnType<typeof cook>>;
    readonly holes: readonly { at: number; name: string }[];
  }): string => {
    const { name, program, destination, route, reward, first, holes } = given;
    const base = requireChain("base");
    const labels = new Map<string, string>([
      [portal.toLowerCase(), "Portal"],
      [String(registered(base, "USDC")).toLowerCase(), "USDC(base)"],
      [usdc.toLowerCase(), "USDC(ethereum)"],
      [String(v12EngineAddress()).toLowerCase(), "engine"],
    ]);
    const named = (address: string): string =>
      labels.get(`0x${address.slice(-40)}`.toLowerCase()) ??
      `0x${address.slice(-40)}`.toLowerCase();
    const values = new Map<bigint, string>(HOLES.map((hole, i) => [ARGUMENTS[0][i]!, `«${hole}»`]));
    const marked = (value: bigint): string => values.get(value) ?? `${value}`;
    const body = program.bodies.find((each) => each.path.length === 0)!;
    const intentBytes = (first.publish.input.length - 10) / 2;
    const engineFrames = first.calls.filter(
      (frame) =>
        frame.type === "DELEGATECALL" &&
        frame.to.toLowerCase() === String(v12EngineAddress()).toLowerCase(),
    );

    const intent = [
      "const intent = abi.encode(",
      `  ${destination}, // destination: ${requireChain(Number(destination)).slug}`,
      "  route: abi.encode({",
      "    salt: «salt», // keccak256(abi.encode(baseSalt, ++count)), as it runs",
      `    deadline: ${route.deadline},`,
      `    portal: ${named(route.portal)},`,
      `    nativeAmount: ${route.nativeAmount}, // the destination Kitchen's fee`,
      `    tokens: [${route.tokens.map((t) => `{ token: ${named(t.token)}, amount: ${marked(t.amount)} }`).join(", ")}],`,
      "    calls: [",
      ...route.calls.map((call) => {
        if (call.data.startsWith("0xa9059cbb")) {
          const [to, amount] = decodeFunctionData({ abi: TRANSFER, data: call.data }).args;
          return `      { target: ${named(call.target)}, data: transfer(${named(to)} /* the shared Pot */, ${marked(amount)}), value: ${call.value} },`;
        }
        const [engine, code] = decodeFunctionData({ abi: v12Pot.abi, data: call.data }).args as [
          Address,
          Hex,
        ];
        const args = (code.slice(2 + body.bytecode.length * 2).match(/.{64}/g) ?? []).map((w) =>
          marked(BigInt(`0x${w}`)),
        );
        return `      { target: ${named(call.target)} /* the shared Pot */, data: cook(${named(engine)}, <body: ${body.bytecode.length} bytes> ‖ [${args.join(", ")}]), value: ${call.value} },`;
      }),
      "    ],",
      "  }),",
      `  reward: { deadline: ${reward.deadline}, creator: ${marked(BigInt(reward.creator))}, prover: ${named(reward.prover)}, nativeAmount: ${reward.nativeAmount},`,
      `            tokens: [${reward.tokens.map((t) => `{ token: ${named(t.token)}, amount: ${marked(t.amount)} }`).join(", ")}] },`,
      ");",
      'const [vault] = abi.decode(evm.static(Portal, hex`0742ebe4` ++ intent), ["Address"]); // intentVaultAddress',
      "USDC.transfer(vault, «amount»);",
      "evm.call(Portal, 0, hex`645c890c` ++ intent); // publish",
    ];
    // A second engine frame is a block run as a program of its own: the `try` the publish is in.
    const lines =
      engineFrames.length > 1
        ? [
            `try { // a program of its own, ${(engineFrames[1]!.input.length - 2) / 2} bytes to the engine`,
            ...intent.map((line) => `  ${line}`),
            "} catch (e) { /* the try's handler, here on the source too */ }",
          ]
        : intent;

    return [
      `// ${name}: the program is ${program.bytecode.length} bytes; the intent ${intentBytes} bytes, encoded once (holes: ${[...new Set(holes.map((hole) => hole.name))].join(", ")})`,
      ...lines,
      "",
    ].join("\n");
  };
});

/** The reward `publish` is given, as viem decodes it. */
interface Reward {
  readonly deadline: bigint;
  readonly creator: Address;
  readonly prover: Address;
  readonly nativeAmount: bigint;
  readonly tokens: readonly { readonly token: Address; readonly amount: bigint }[];
}
