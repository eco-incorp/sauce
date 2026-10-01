// What `sauce pot` and `sauce tx` do, from TypeScript and offline: owner -> the owner's Pot -> the
// Pot's deploy transaction -> a program compiled for its chain -> its main(...) arguments -> the
// cook transaction. Also locates the packaged Solana binaries a LiteSVM harness loads. Sends
// nothing.
//
//   node cook.mts --owner <Pot owner> --recipient <address>
import { existsSync, statSync } from "node:fs";

import { destinationExecutionFee, routes, v12GateKitchen, v12PredictPot } from "@eco-incorp/sauce";
import { v12EngineAddress } from "@eco-incorp/sauce/deployments";
import { v12Pot, v12PotAbi } from "@eco-incorp/sauce/evm/engine";
import { svmEngineArtifacts } from "@eco-incorp/sauce/svm/engine-artifacts";
import { bytesToHex, concatHex, decodeFunctionData, getAddress, keccak256 } from "viem";

type Address = `0x${string}`;
function address(name: string): Address {
  const i = process.argv.indexOf(`--${name}`);
  const value = i === -1 ? undefined : process.argv[i + 1];
  if (value === undefined || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error(`pass --${name} <address>`);
  return getAddress(value);
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

// 1. The owner's Pot: derived from the owner through the released Kitchen, deployed once.
const owner = address("owner");
const salt = `0x${"00".repeat(32)}` as const; // one Pot per owner and salt
const pot = v12PredictPot(owner, salt);
const deploy = routes.sauceEvmDeployPotCall({ kitchen: v12GateKitchen(), owner, salt });
// Send deploy ({ to, data, value }) where the chain has no code at `pot`.

// 2. The program, compiled for its chain with that chain's names, as `sauce compile` does.
const source = `function main(recipient: Address, floor: Uint256) {
  const held = USDC.balanceOf(ctx.self());
  require(held >= floor, "the Pot holds less than floor");
  USDC.transfer(recipient, held);
}`;
const program = routes.compileSauceProgram("base", source);

// 3. main(recipient, floor): encoded as `--args` encodes them, appended to the program.
const args = routes.encodeEntryArguments(program, [address("recipient"), 1_000_000n]);
const payload = concatHex([bytesToHex(program.bytecode), bytesToHex(args)]);

// 4. The cook, sent by the owner. Its value is the Kitchen's executionFee(), read at run time.
const engine = getAddress(v12EngineAddress());
const cook = { to: pot, data: v12Pot.encodeCook(engine, payload) };
const feeRead = destinationExecutionFee(); // { to, data, decode }: an eth_call on the same chain
const decoded = decodeFunctionData({ abi: v12PotAbi, data: cook.data });
check(
  decoded.functionName === "cook" && decoded.args?.[1] === payload,
  "the cook carries program and arguments",
);
check(deploy.to === getAddress(v12GateKitchen()), "the Pot is deployed through the Kitchen");

// 5. Solana: the packaged engine and Kitchen binaries a local harness loads (Node-only paths).
const artifacts = svmEngineArtifacts("devnet");
for (const path of Object.values(artifacts)) {
  check(existsSync(path) && statSync(path).size > 0, `packaged artifact ${path}`);
}

console.log(`Pot ${pot} (deploy via ${deploy.target}); program keccak ${keccak256(payload)}`);
console.log(`cook to ${cook.to}: ${(cook.data.length - 2) / 2} bytes; fee read from ${feeRead.to}`);
console.log(`LiteSVM inputs: ${Object.keys(artifacts).join(", ")}`);
