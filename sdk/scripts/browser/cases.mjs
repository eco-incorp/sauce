// The compiles `check-browser-compile.mjs` runs twice — in Node, and bundled into a page in headless
// Chromium — and compares byte for byte. It imports the package BY NAME, exactly as an application
// does, so what runs is the package's public `exports`. Kept free of anything environment-specific:
// the same text is the Node run and the browser run.
import { ready, routes, deposit } from "@eco-incorp/sauce";
import {
  compile,
  decodeCompactArguments,
  encodeCompactArguments,
  resolveSdkModule,
} from "@eco-incorp/sauce/compiler";
import { settleSource } from "@eco-incorp/sauce/recipes";
import { compileProgram, parseProgram } from "@eco-incorp/sauce/actions";

const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const utf8 = (text) => new TextEncoder().encode(text);
const EXECUTION = {
  pot: "0x2222222222222222222222222222222222222222",
  engine: "0x3333333333333333333333333333333333333333",
};

/** What a compile says before `ready()` has resolved — only meaningful where the wasm is async. */
export function beforeReady() {
  const attempts = {
    compile: () =>
      compile({ target: "evm", resolve: () => utf8("function main(): Uint256 { return 1n; }") }),
    route: () => routes.compileSauceRoute("base", "function main() { return 1n; }", EXECUTION),
  };

  return Object.fromEntries(
    Object.entries(attempts).map(([name, attempt]) => {
      try {
        attempt();

        return [name, "compiled"];
      } catch (error) {
        return [name, String(error?.message ?? error)];
      }
    }),
  );
}

/** Every compile, as hex. `source` goes to `ready()`: omitted, the wasm resolves beside its module. */
export async function run(source) {
  await ready(source);

  // The README's route example, verbatim: `Base(() => { USDC.approve(...) }, options).reward(...)`.
  // Imported only now, because building the route compiles it.
  const { built } = await import("./readme-route.mjs");

  // A raw compile with compact entry arguments, on both targets, round-tripped through the codec.
  const raw = {};
  const entry = utf8("function main(x: Uint256, y: Uint256): Uint256 { return x * y + 1n; }");
  for (const target of ["evm", "svm"]) {
    const artifact = compile({ target, compactArgs: true, resolve: () => entry });
    const payload = encodeCompactArguments(artifact.entrySchema, [6n, 7n]);
    raw[target] = {
      bytecode: hex(artifact.bytecode),
      entryEncoding: artifact.entryEncoding,
      entrySchema: hex(artifact.entrySchema),
      payload: hex(payload),
      decoded: decodeCompactArguments(artifact.entrySchema, payload).map(String),
      manifest: artifact.manifest ?? null,
    };
  }

  // The settle recipe, reproduced the way a partner does: the embedded source, the SDK's resolver.
  const settleText = utf8(settleSource());
  const settle = compile({
    target: "evm",
    entry: "settle.sauce.ts",
    resolve: (path) => (path === "settle.sauce.ts" ? settleText : resolveSdkModule(path)),
  });

  // A swap through `@sauce/router` (the embedded library, its pool ABIs and `@sauce/token`, which it
  // imports), and a deposit builder (a protocol twin).
  const swapRoute = routes.compileSauceRoute(
    "base",
    [
      'import { uniswapV2, uniswapV3 } from "@sauce/router";',
      'import { balanceOf } from "@sauce/token";',
      "function main() {",
      "  const usdc = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913n;",
      "  const weth = 0x4200000000000000000000000000000000000006n;",
      "  const out = uniswapV2(0x1111111111111111111111111111111111111111n, usdc, weth,",
      "    balanceOf(usdc, ctx.self()), 0n, 0n, ctx.self());",
      "  uniswapV3(0x4444444444444444444444444444444444444444n, weth, usdc, out, 0n, 0n, ctx.self());",
      "}",
    ].join("\n"),
    EXECUTION,
  );
  const depositRoute = routes.compileSauceRoute(
    "base",
    deposit.depositSource({
      protocol: "aave-v3",
      action: "supply",
      target: "0x1111111111111111111111111111111111111111",
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      amount: 1_000_000n,
    }),
    EXECUTION,
  );

  // An actions program.
  const action = compileProgram(
    parseProgram({
      version: 1,
      chainId: 8453,
      actions: [
        { type: "balanceOf", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
        {
          type: "approve",
          token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          spender: "0x1111111111111111111111111111111111111111",
        },
      ],
    }),
  );

  return {
    readme: {
      bytecode: built.compiled.bytecode.map(hex),
      intentHash: built.hash().intentHash,
    },
    raw,
    settle: hex(settle.bytecode),
    swap: swapRoute.compiled.bytecode.map(hex),
    deposit: depositRoute.compiled.bytecode.map(hex),
    action: hex(action.bytecode),
  };
}
