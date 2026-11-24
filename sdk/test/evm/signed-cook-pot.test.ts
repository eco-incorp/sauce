/**
 * `checkSignedCookPot` against a stub client — which Pots take signed cooks, decided from what a Pot
 * answers and where its address derives, with no chain. `signed-cook.e2e.test.ts` runs it against
 * real Pots on anvil.
 */
import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { sdkCompilerVersion, v12KitchenAddress } from "../../src/deployments/index.js";
import { DEFAULT_POT_SALT, v12PredictPot } from "../../src/deployments/pot.js";
import { checkSignedCookPot } from "../../src/evm/engine.js";

const OWNER = "0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082" as Address;
const KITCHEN = getAddress(v12KitchenAddress());
/** The release this SDK compiles for: the Kitchen that mints its Pots. */
const CURRENT = { compiler: sdkCompilerVersion() };

/** A client answering as a Pot does: its owner, Kitchen and salts, and the code at its address. */
const stub = (answers: {
  owner: Address;
  routerFixed?: boolean;
  code?: Hex;
}): Pick<PublicClient, "readContract" | "getCode"> => {
  const gateSalt = keccak256(
    answers.routerFixed === true
      ? encodeAbiParameters(
          [{ type: "address" }, { type: "bytes32" }, { type: "bool" }],
          [answers.owner, DEFAULT_POT_SALT, true],
        )
      : encodeAbiParameters(
          [{ type: "address" }, { type: "bytes32" }],
          [answers.owner, DEFAULT_POT_SALT],
        ),
  );

  return {
    getCode: async () => answers.code ?? "0x60",
    readContract: async ({ functionName }: { functionName: string }) =>
      ({ owner: answers.owner, kitchen: KITCHEN, userSalt: DEFAULT_POT_SALT, gateSalt })[
        functionName
      ],
  } as unknown as Pick<PublicClient, "readContract" | "getCode">;
};

describe("checkSignedCookPot", () => {
  it("takes 1.3.0 and 1.4.0 Private Pots, refuses earlier ones by version", async () => {
    // kitchen-evm 1.4.0: a CREATE3 Pot, mutable Router or fixed.
    expect(
      await checkSignedCookPot(
        stub({ owner: OWNER }),
        v12PredictPot(OWNER, DEFAULT_POT_SALT, CURRENT) as Address,
      ),
    ).toEqual({ ok: true, owner: OWNER });
    expect(
      await checkSignedCookPot(
        stub({ owner: OWNER, routerFixed: true }),
        v12PredictPot(OWNER, DEFAULT_POT_SALT, { ...CURRENT, routerFixed: true }) as Address,
      ),
    ).toEqual({ ok: true, owner: OWNER });
    // kitchen-evm 1.3.0: a CREATE2 Pot, which carries cookSigned too.
    expect(
      await checkSignedCookPot(
        stub({ owner: OWNER }),
        v12PredictPot(OWNER, DEFAULT_POT_SALT, { compiler: "2.6.2" }) as Address,
      ),
    ).toEqual({ ok: true, owner: OWNER });
    // kitchen-evm 1.2.0: a Pot from before signed cooks, refused by its release's version.
    const old = await checkSignedCookPot(
      stub({ owner: OWNER }),
      v12PredictPot(OWNER, DEFAULT_POT_SALT, { compiler: "2.5.0" }) as Address,
    );
    expect(old.ok).toBe(false);
    expect(old.ok === false && old.reason).toContain("kitchen-evm 1.2.0, before signed cooks");
  });

  it("refuses a Shared Pot, an address no release derives and an address with no code", async () => {
    const shared = await checkSignedCookPot(
      stub({ owner: zeroAddress, routerFixed: true }),
      v12PredictPot(zeroAddress, DEFAULT_POT_SALT, CURRENT) as Address,
    );
    expect(shared.ok === false && shared.reason).toContain("is a Shared Pot");

    const foreign = "0x00000000000000000000000000000000DeaDBeef" as Address;
    const unknown = await checkSignedCookPot(stub({ owner: OWNER }), foreign);
    expect(unknown.ok === false && unknown.reason).toContain("is not a Pot of any Kitchen release");

    const empty = await checkSignedCookPot(
      stub({ owner: OWNER, code: "0x" }),
      v12PredictPot(OWNER, DEFAULT_POT_SALT, CURRENT) as Address,
    );
    expect(empty.ok === false && empty.reason).toContain("has no code");
  });
});
