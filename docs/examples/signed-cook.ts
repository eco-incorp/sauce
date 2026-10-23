// A cook the Pot's owner signs and another account sends: pay.sauce.ts, compiled for Base, signed
// as EIP-712 typed data, checked, and encoded as the Pot's `cookSigned` call. Then the call that
// cancels the same signature. `sauce sign pay.sauce.ts --chain base --wallet <name> --args …`
// builds the same.
//
// Everything here is offline: a throwaway key signs, and nothing is sent. Before signing for a real
// Pot, `checkSignedCookPot(client, pot)` reads whether it takes signed cooks (a Pot created before
// signed cooks, or a Shared Pot, does not).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { routes, v12PredictPot } from "@eco-incorp/sauce";
import { v12EngineAddress } from "@eco-incorp/sauce/deployments";
import {
  cookNonceMasks,
  cookNonceWordBit,
  encodeCookSigned,
  encodeInvalidateNonces,
  randomCookNonce,
  signedCookTypedData,
  verifySignedCook,
  type SignedCookExecution,
} from "@eco-incorp/sauce/evm/engine";
import { bytesToHex, concatHex, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const owner = privateKeyToAccount(generatePrivateKey());

// The program and its arguments are signed together: pay 1 USDC (6 decimals) to the recipient.
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "pay.sauce.ts"), "utf8");
const pay = routes.compileSauceProgram("base", source);
const recipient = "0x4444444444444444444444444444444444444444";
const program = concatHex([
  bytesToHex(pay.bytecode),
  bytesToHex(routes.encodeEntryArguments(pay, [recipient, 1_000_000n])),
]);

const cook: SignedCookExecution = {
  chainId: 8453,
  pot: v12PredictPot(owner.address),
  engine: getAddress(v12EngineAddress()),
  program,
  // What the sender must send with it; the Pot pays the Kitchen's fee from its own balance.
  value: 0n,
  // The most of the Kitchen's fee the Pot pays. Read the Kitchen's executionFee() and sign at or
  // above it; this round number is a fixture.
  maxExecutionFee: 10_000_000_000_000n,
  // A random nonce never collides with another signature you have out.
  nonce: randomCookNonce(),
  // Ten minutes from now, inclusive. Keep deadlines short.
  deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
  // Left out, anyone may send it; name an address to let only that account send it.
};

const signature = await owner.signTypedData(signedCookTypedData(cook));
if (!(await verifySignedCook({ ...cook, signature, owner: owner.address }))) {
  throw new Error("The owner's signature does not verify");
}
// Another value is another cook: the same signature does not cover it.
if (await verifySignedCook({ ...cook, value: 1n, signature, owner: owner.address })) {
  throw new Error("A signature verified for a value it does not cover");
}

// Any account sends this, with exactly `value`, and pays the gas.
const transaction = encodeCookSigned({ ...cook, signature });
if (transaction.to !== cook.pot || transaction.value !== 0n) {
  throw new Error("cookSigned goes to the Pot with the signed value");
}

// The owner cancels it by setting its nonce's bit: one invalidateNonces call per word.
const { word, bit } = cookNonceWordBit(cook.nonce);
const [cancel] = cookNonceMasks([cook.nonce]);
if (cancel === undefined || cancel.word !== word || cancel.mask !== 1n << BigInt(bit)) {
  throw new Error("A nonce's word and mask");
}
const cancellation = { to: cook.pot, data: encodeInvalidateNonces(cancel.word, cancel.mask) };

console.log(`signed cook for ${cook.pot}: ${transaction.data.length / 2 - 1} bytes of calldata`);
console.log(`cancel nonce word ${word}, bit ${bit}: ${cancellation.data.slice(0, 10)}`);
