// Compiles cross-chain-intent.sauce.ts — a program that measures its Pot and opens an intent
// carrying what it measured — for Base, and builds the cook that runs it: what `sauce run` sends.
//
// The SauceScript is its own file rather than a template literal so it is the same text the README
// shows and the same text you can compile yourself. Everything here is offline: the owner and the
// recipient are fixtures, and nothing is sent.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { routes, v12PredictPot } from "@eco-incorp/sauce";
import { v12EngineAddress } from "@eco-incorp/sauce/deployments";
import { v12Pot } from "@eco-incorp/sauce/evm/engine";
import { bytesToHex, concatHex, getAddress } from "viem";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "cross-chain-intent.sauce.ts"),
  "utf8",
);

// Offline fixtures: the Pot's owner, who also creates the intent, and who it pays on Ethereum.
const owner = "0x4444444444444444444444444444444444444444";
const recipient = "0x6666666666666666666666666666666666666666";

// The program names its intent's creator, `refundTo`, from its arguments; the deadlines and the salt
// take their defaults, as the program runs. The Portal, the prover and the vault are the SDK's.
export const program = routes.compileSauceProgram("base", source);

// main(recipient, minAmount, refundTo), encoded as `--args` encodes them and appended to the
// program: forward whatever the Pot holds once it is at least 1 USDC, refundable to the owner.
export const args = routes.encodeEntryArguments(program, [recipient, 1_000_000n, owner]);
const payload = concatHex([bytesToHex(program.bytecode), bytesToHex(args)]);

// The cook, which the owner sends to the Pot. Its value is the Kitchen's executionFee(), read at
// run time.
const pot = v12PredictPot(owner, `0x${"00".repeat(32)}`);
const cook = { to: pot, data: v12Pot.encodeCook(getAddress(v12EngineAddress()), payload) };

console.log(`Cross-chain intent program: ${program.bytecode.length} bytes`);
console.log(`cook to ${cook.to}: ${(cook.data.length - 2) / 2} bytes`);
