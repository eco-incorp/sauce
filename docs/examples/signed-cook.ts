// Sign pay.sauce.ts only for an already deployed, verified and persisted service binding.
// This module performs no RPC or signing on import. Supply the binding's Base client and owner.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { routes } from "@eco-incorp/sauce";
import { v12ReleaseSet } from "@eco-incorp/sauce/deployments";
import {
  checkSignedCookPot,
  cookNonceMasks,
  encodeCookSigned,
  encodeInvalidateNonces,
  randomCookNonce,
  signedCookTypedData,
  verifyPotBinding,
  verifySignedCook,
  type EvmPotBindingInput,
  type SignedCookExecution,
} from "@eco-incorp/sauce/evm/engine";
import { bytesToHex, concatHex, getAddress, type PrivateKeyAccount, type PublicClient } from "viem";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "pay.sauce.ts"), "utf8");

export async function signPayCook(
  client: PublicClient,
  input: EvmPotBindingInput,
  owner: PrivateKeyAccount,
  maxExecutionFee: bigint,
) {
  const binding = await verifyPotBinding(client, input);
  if (binding.chainId !== 8453 || binding.compiler !== v12ReleaseSet().compiler) {
    throw new Error("Use this example's exact Base compiler/engine pair");
  }
  if (getAddress(owner.address) !== getAddress(binding.owner)) {
    throw new Error("The signer must own the verified Pot");
  }
  const check = await checkSignedCookPot(client, binding.pot, binding);
  if (!check.ok) throw new Error(check.reason);

  const pay = routes.compileSauceProgram("base", source);
  const program = concatHex([
    bytesToHex(pay.bytecode),
    bytesToHex(routes.encodeEntryArguments(pay, [binding.owner, 1_000_000n])),
  ]);
  const cook: SignedCookExecution = {
    chainId: binding.chainId,
    pot: binding.pot,
    engine: binding.engine,
    compiler: binding.compiler,
    program,
    value: 0n,
    maxExecutionFee,
    nonce: randomCookNonce(),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
  };
  const signature = await owner.signTypedData(signedCookTypedData(cook));
  if (!(await verifySignedCook({ ...cook, signature, owner: binding.owner }, client))) {
    throw new Error("The owner's signature does not verify");
  }
  if (await verifySignedCook({ ...cook, value: 1n, signature, owner: binding.owner }, client)) {
    throw new Error("A signature verified for a value it does not cover");
  }

  const transaction = encodeCookSigned({ ...cook, signature });
  const cancellations = cookNonceMasks([cook.nonce]).map(({ word, mask }) => ({
    to: binding.pot,
    data: encodeInvalidateNonces(word, mask),
  }));

  return { binding, cook, signature, transaction, cancellations };
}
