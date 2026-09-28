import {
  compileProgram,
  parseProgram,
  programIntent,
  ProgramError,
  serializeProgram,
} from "@eco-incorp/sauce/actions";

// A program as it would arrive from another service: JSON text. Base USDC; the spender is a fixture.
const json = `{
  "version": 1,
  "chainId": 8453,
  "actions": [
    { "type": "balanceOf", "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    {
      "type": "approve",
      "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "spender": "0x1111111111111111111111111111111111111111"
    }
  ]
}`;
const program = parseProgram(json);
if (serializeProgram(program) !== JSON.stringify(JSON.parse(json))) {
  throw new Error("Expected the canonical text to be the input's");
}

// Every problem is reported at once, each with its path.
try {
  parseProgram({ ...program, actions: [{ type: "approve", amount: 5 }] });
  throw new Error("Expected the program to be rejected");
} catch (error) {
  if (!(error instanceof ProgramError) || error.issues.length !== 3) throw error;
}

// Standalone: the approval spends whatever USDC the Pot holds when it runs.
const { bytecode } = compileProgram(program);

// One compiled program, many amounts: an `argument` is appended to the bytecode at run time.
const reusable = compileProgram({
  version: 1,
  chainId: 8453,
  actions: [
    { type: "argument", name: "amount" },
    {
      type: "approve",
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      spender: "0x1111111111111111111111111111111111111111",
    },
  ],
});
const payload = reusable.payload({ amount: 1_000_000n });
if (payload.length !== reusable.bytecode.length + 32) throw new Error("Expected one ABI word");

// As an intent: the route runs on the program's chain, Base. Offline fixtures throughout.
const executionFee = 1_000n;
const built = programIntent(program, {
  execution: {
    pot: "0x2222222222222222222222222222222222222222",
    engine: "0x3333333333333333333333333333333333333333",
    value: executionFee,
  },
  nativeAmount: executionFee,
  portal: "0x4444444444444444444444444444444444444444",
  deadline: 2_000_000_000n,
}).reward({
  source: "ethereum",
  creator: "0x5555555555555555555555555555555555555555",
  prover: "0x6666666666666666666666666666666666666666",
  deadline: 2_000_003_600n,
  nativeAmount: executionFee,
});
if (built.destination.slug !== "base") throw new Error("Expected a Base route");

console.log("Program bytes:", bytecode.length, "with an argument:", payload.length);
console.log("Action intent:", built.hash().intentHash);
