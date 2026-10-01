import {
  compileProgram,
  parseProgram,
  programIntent,
  ProgramError,
  serializeProgram,
} from "@eco-incorp/sauce/actions";

// A program as it would arrive from another service: JSON text. It has no chainId: its tokens are
// registry symbols and its pool is found by key, through Uniswap V3's factory, so it compiles for
// any chain where those names exist. The amount is a runtime argument.
const json = `{
  "version": 1,
  "actions": [
    { "type": "argument", "name": "amount" },
    {
      "type": "uniswapV3Swap",
      "factory": "UniswapV3.Factory",
      "fee": 500,
      "tokenIn": "USDC",
      "tokenOut": "WETH",
      "amountOutMin": "1",
      "recipient": "self"
    }
  ]
}`;
const program = parseProgram(json);
if (serializeProgram(program) !== JSON.stringify(JSON.parse(json))) {
  throw new Error("Expected the canonical text to be the input's");
}

// Every problem is reported at once, each with its path.
try {
  parseProgram({ ...program, actions: [{ type: "approve", amount: 5, token: "usdc" }] });
  throw new Error("Expected the program to be rejected");
} catch (error) {
  if (!(error instanceof ProgramError) || error.issues.length !== 3) throw error;
}

// One document, two chains: the same SauceScript, each chain's own tokens and factory.
const onBase = compileProgram(program, { chain: "base" });
const onEthereum = compileProgram(program, { chain: "ethereum" });
if (onBase.source !== onEthereum.source) throw new Error("Expected one source for both chains");
if (onBase.source.indexOf("UniswapV3.Factory.getPool(USDC, WETH, 500n)") < 0) {
  throw new Error("Expected the pool to be read from the factory while the program runs");
}
const same = onBase.bytecode.every((byte, i) => byte === onEthereum.bytecode[i]);
if (same && onBase.bytecode.length === onEthereum.bytecode.length) {
  throw new Error("Expected each chain's addresses in its bytecode");
}

// One compiled program, many amounts: the `argument` is appended to the bytecode at run time.
const payload = onBase.payload({ amount: 1_000_000_000n });
if (payload.length !== onBase.bytecode.length + 32) throw new Error("Expected one ABI word");

// A chain that lacks a name refuses the program, naming the chain, the name and its path.
try {
  compileProgram(program, { chain: "avalanche" });
  throw new Error("Expected Avalanche, which registers no token symbols, to refuse the names");
} catch (error) {
  if (!(error instanceof ProgramError) || error.chain?.slug !== "avalanche") throw error;
  if (!error.issues.some((issue) => issue.path === "actions[1].tokenIn")) throw error;
}

// As an intent on Base. A route takes no runtime arguments, so the swap spends the Pot's USDC
// balance, read when it runs, instead of the argument. Offline fixtures throughout.
const executionFee = 1_000n;
const built = programIntent(
  { version: 1, actions: [{ type: "balanceOf", token: "USDC" }, program.actions[1]!] },
  {
    chain: "base",
    execution: {
      pot: "0x2222222222222222222222222222222222222222",
      engine: "0x3333333333333333333333333333333333333333",
      value: executionFee,
    },
    nativeAmount: executionFee,
    portal: "0x4444444444444444444444444444444444444444",
    deadline: 2_000_000_000n,
  },
).reward({
  source: "ethereum",
  creator: "0x5555555555555555555555555555555555555555",
  prover: "0x6666666666666666666666666666666666666666",
  deadline: 2_000_003_600n,
  nativeAmount: executionFee,
});
if (built.destination.slug !== "base") throw new Error("Expected a Base route");

console.log("Program bytes on Base:", onBase.bytecode.length, "with an argument:", payload.length);
console.log("Action intent:", built.hash().intentHash);
