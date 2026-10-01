/**
 * `potRouterUpdate` against a stub client — the decisions it makes from what it reads, with no
 * chain. `router.e2e.test.ts` runs it against a real Kitchen and Pot on anvil.
 */
import { decodeFunctionData, getAddress, type Address, type Hex } from "viem";

import { v12KitchenAddress } from "../../src/deployments/index.js";
import { SAUCE_INTENT_POT_SALT, v12PredictPot } from "../../src/deployments/pot.js";
import { potRouterUpdate, v12PotAbi, type PotRouterClient } from "../../src/evm/engine.js";

const OWNER = "0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082" as Address;
const OLD_ROUTER = "0x1111111111111111111111111111111111111111" as Address;
const NEW_ROUTER = "0x2222222222222222222222222222222222222222" as Address;

/** A client answering the four Pot reads and the Kitchen's `router()` from a table. */
const stub = (answers: {
  pot: Address;
  potRouter: Address;
  kitchenRouter: Address;
  owner?: Address;
  salt?: Hex;
}): PotRouterClient & { reads: string[] } => {
  const reads: string[] = [];
  const kitchen = getAddress(v12KitchenAddress());
  const readContract = (async ({
    address,
    functionName,
  }: {
    address: Address;
    functionName: string;
  }) => {
    reads.push(`${address}.${functionName}`);
    if (getAddress(address) === kitchen && functionName === "router") return answers.kitchenRouter;
    if (getAddress(address) !== getAddress(answers.pot)) throw new Error(`read of ${address}`);
    return {
      router: answers.potRouter,
      kitchen,
      owner: answers.owner ?? OWNER,
      userSalt: answers.salt ?? SAUCE_INTENT_POT_SALT,
    }[functionName];
  }) as unknown as PotRouterClient["readContract"];

  return { readContract, reads };
};

const POT = v12PredictPot(OWNER) as Address;

describe("potRouterUpdate", () => {
  it("returns nothing for a Pot already on its Kitchen's Router", async () => {
    const client = stub({ pot: POT, potRouter: NEW_ROUTER, kitchenRouter: NEW_ROUTER });
    expect(await potRouterUpdate(client, POT)).toBeUndefined();
  });

  it("compares Routers regardless of address casing", async () => {
    const client = stub({
      pot: POT,
      potRouter: NEW_ROUTER.toLowerCase() as Address,
      kitchenRouter: getAddress(NEW_ROUTER),
    });
    expect(await potRouterUpdate(client, POT)).toBeUndefined();
  });

  it("returns the owner's setRouter call, naming the Kitchen's Router, for a Pot behind it", async () => {
    const client = stub({ pot: POT, potRouter: OLD_ROUTER, kitchenRouter: NEW_ROUTER });
    const update = await potRouterUpdate(client, POT);
    expect(update?.to).toBe(getAddress(POT));
    const call = decodeFunctionData({ abi: v12PotAbi, data: update!.data });
    expect(call.functionName).toBe("setRouter");
    expect(call.args).toEqual([NEW_ROUTER]);
    // The Kitchen is the one the Pot names, and the Router is the one that Kitchen names.
    expect(client.reads).toContain(`${getAddress(v12KitchenAddress())}.router`);
  });

  it("refuses a Pot whose address does not derive under the pinned Pot init-code hash", async () => {
    // What a Pot minted before the Router moved into Pot storage looks like from here: it answers
    // the same reads (same Kitchen, owner and salt) but sits at an address another Pot bytecode
    // derives, and has no setRouter to call.
    const foreign = "0x00000000000000000000000000000000DeaDBeef" as Address;
    const client = stub({ pot: foreign, potRouter: OLD_ROUTER, kitchenRouter: NEW_ROUTER });
    await expect(potRouterUpdate(client, foreign)).rejects.toThrow(
      /not a Pot of the pinned Kitchen release/,
    );
  });
});
