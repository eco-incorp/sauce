/**
 * `potRouterUpdate` against a stub client — the decisions it makes from what it reads, with no
 * chain. `router.e2e.test.ts` runs it against a real Kitchen and Pot on anvil.
 */
import { decodeFunctionData, getAddress, zeroAddress, type Address, type Hex } from "viem";

import { v12KitchenAddress, v12RouterAddress } from "../../src/deployments/index.js";
import { DEFAULT_POT_SALT, v12PredictPot } from "../../src/deployments/pot.js";
import { potRouterUpdate, v12PotAbi, type PotRouterClient } from "../../src/evm/engine.js";

const OWNER = "0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082" as Address;
const OLD_ROUTER = "0x1111111111111111111111111111111111111111" as Address;
const NEW_ROUTER = "0x2222222222222222222222222222222222222222" as Address;
/** The Router this release pins: the only one `potRouterUpdate` proposes. */
const RELEASE_ROUTER = getAddress(v12RouterAddress());

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
      userSalt: answers.salt ?? DEFAULT_POT_SALT,
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

  it("returns the owner's setRouter call, naming the Router this release pins, for a Pot behind it", async () => {
    const client = stub({ pot: POT, potRouter: OLD_ROUTER, kitchenRouter: RELEASE_ROUTER });
    const update = await potRouterUpdate(client, POT);
    expect(update?.to).toBe(getAddress(POT));
    const call = decodeFunctionData({ abi: v12PotAbi, data: update!.data });
    expect(call.functionName).toBe("setRouter");
    expect(call.args).toEqual([RELEASE_ROUTER]);
    // The Kitchen is the one the Pot names, and the Router is the one that Kitchen names.
    expect(client.reads).toContain(`${getAddress(v12KitchenAddress())}.router`);
  });

  it("returns nothing where the Kitchen names a Router this release does not pin, however far behind the Pot is", async () => {
    // A Kitchen rolled past this SDK: a pairing of a Pot with a Router none of this SDK's releases
    // qualified is advice it does not give. The Kitchen is asked, and what it names is not proposed.
    const client = stub({ pot: POT, potRouter: OLD_ROUTER, kitchenRouter: NEW_ROUTER });
    expect(NEW_ROUTER).not.toBe(RELEASE_ROUTER);
    expect(await potRouterUpdate(client, POT)).toBeUndefined();
    expect(client.reads).toContain(`${getAddress(v12KitchenAddress())}.router`);
  });

  it("proposes only this release's Router, where the Kitchen hands it out", async () => {
    // The two Routers of the 1.4.0 and 1.5.0 Kitchens, literal: the installed release's is the second.
    const R1 = getAddress("0xcc5e707d3c063Faae1e0dAf2C6CBc2Fd076AE759");
    const R2 = getAddress("0xBbBaB15200b9031fB7Fd31811Cb62b6F83DF24e6");
    expect(RELEASE_ROUTER).toBe(R2);
    // A dynamic Pot minted on R1, on a chain whose Kitchen now hands out R2: the owner's setRouter(R2).
    const switched = await potRouterUpdate(
      stub({ pot: POT, potRouter: R1, kitchenRouter: R2 }),
      POT,
    );
    expect(switched?.to).toBe(getAddress(POT));
    const call = decodeFunctionData({ abi: v12PotAbi, data: switched!.data });
    expect([call.functionName, call.args]).toEqual(["setRouter", [R2]]);
    // Before the chain switches the Kitchen still hands out R1, which this release does not pin.
    expect(
      await potRouterUpdate(stub({ pot: POT, potRouter: R1, kitchenRouter: R1 }), POT),
    ).toBeUndefined();
    // A Router no release qualified: nothing.
    const BEEF = "0x000000000000000000000000000000000000bEEF" as Address;
    expect(
      await potRouterUpdate(stub({ pot: POT, potRouter: R1, kitchenRouter: BEEF }), POT),
    ).toBeUndefined();
  });

  it("returns nothing for a Pot of an earlier release", async () => {
    // A kitchen-evm 1.3.0 Pot keeps the Router it has, and the SDK pins no Router of an earlier
    // release to propose: it answers nothing, and never asks the Kitchen for its Router.
    const earlier = v12PredictPot(OWNER, DEFAULT_POT_SALT, { compiler: "2.6.2" }) as Address;
    const client = stub({ pot: earlier, potRouter: OLD_ROUTER, kitchenRouter: NEW_ROUTER });
    expect(await potRouterUpdate(client, earlier)).toBeUndefined();
    expect(client.reads).not.toContain(`${getAddress(v12KitchenAddress())}.router`);
  });

  it("returns nothing for a fixed-Router Pot, whose Router cannot change", async () => {
    // `setRouter` on a Pot minted with its Router fixed reverts RouterFixed(): no call to propose,
    // and the Kitchen's Router is never asked for. The Router the Pot has differs from it here, so
    // only the kind keeps this from being a proposal.
    const fixed = v12PredictPot(OWNER, DEFAULT_POT_SALT, { routerFixed: true }) as Address;
    const client = stub({ pot: fixed, potRouter: OLD_ROUTER, kitchenRouter: NEW_ROUTER });
    expect(await potRouterUpdate(client, fixed)).toBeUndefined();
    expect(client.reads).not.toContain(`${getAddress(v12KitchenAddress())}.router`);
  });

  it("returns nothing for a Shared Pot, whose Router cannot change", async () => {
    // A Shared Pot (the zero owner) always has its Router fixed, in every release.
    const shared = v12PredictPot(zeroAddress, DEFAULT_POT_SALT) as Address;
    const client = stub({
      pot: shared,
      potRouter: OLD_ROUTER,
      kitchenRouter: NEW_ROUTER,
      owner: zeroAddress,
    });
    expect(await potRouterUpdate(client, shared)).toBeUndefined();
    expect(client.reads).not.toContain(`${getAddress(v12KitchenAddress())}.router`);
  });

  it("refuses an address no release's Pot identity derives", async () => {
    // What a contract that answers the same reads (same Kitchen, owner and salt) but is no Pot of
    // any release looks like from here: its address derives under no release's Pot identity.
    const foreign = "0x00000000000000000000000000000000DeaDBeef" as Address;
    const client = stub({ pot: foreign, potRouter: OLD_ROUTER, kitchenRouter: NEW_ROUTER });
    await expect(potRouterUpdate(client, foreign)).rejects.toThrow(
      /not a Pot of a Kitchen release this SDK knows/,
    );
  });
});
