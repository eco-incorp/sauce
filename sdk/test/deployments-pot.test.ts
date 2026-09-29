/**
 * The Pot the SDK derives for an intent is the solver's shared Pot, not a second one.
 *
 * The solver deploys one Pot per Portal: owner = `Portal.executor()`, salt zero, through the
 * released Kitchen. An SDK route cooking anywhere else would cook on a Pot nothing deploys or
 * funds. Executor addresses were read on-chain; Pot addresses use Kitchen 1.1.0 release initcode.
 * These predictions require that Kitchen implementation and are not claims of live deployment.
 *
 * Each pinned Pot is checked twice: `v12PredictPot` derives it from the init-code hash
 * `addresses.json` records, and `evm/pot-address.ts` derives it again from the released `V12Pot.json`
 * creation code itself, an independent source. A Kitchen release that moves the Pot bytecode fails
 * both until the pins are re-read.
 */
import { v12KitchenAddress } from "../src/deployments/index.js";
import { SAUCE_INTENT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";
import { ecoRoutesExecutorOf, ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import { destinationPot } from "../src/routes/intent-pot.js";
import { potFromReleasedBytecode } from "./evm/pot-address.js";

const PROD_PORTAL = "0xEC000064576f9C95a8623Bc0eff3db6d296ea6df";
const PROD_EXECUTOR = "0x645dADD5Bf354526b68A2befd9A305F7E03b91Ca";
const SHARED_POT = "0x48e8316d8084Ea76098257f32C431263b171744a";

describe("the intent Pot is the solver's shared Pot", () => {
  it("uses salt zero", () => {
    expect(SAUCE_INTENT_POT_SALT).toBe(`0x${"00".repeat(32)}`);
  });

  it("derives the production Portal's Executor", () => {
    expect(ecoRoutesExecutorOf(PROD_PORTAL)).toBe(PROD_EXECUTOR);
  });

  it("predicts the Pot the released Kitchen mints for that Executor", () => {
    expect(v12KitchenAddress()).toBe("0x19845b22989150E6B09dE55a661295Dd9188506b");
    expect(v12PredictPot(PROD_EXECUTOR)).toBe(SHARED_POT);
  });

  it("is the Pot the released Pot creation code derives", () => {
    expect(potFromReleasedBytecode(PROD_EXECUTOR)).toBe(SHARED_POT);
  });

  it.each(["base", "optimism", "arbitrum"])(
    "is the Pot an intent to %s cooks on by default",
    (chain) => {
      expect(ecoRoutesPortal(chain)).toBe(PROD_PORTAL);
      expect(destinationPot(chain)).toBe(SHARED_POT);
    },
  );
});

describe("Arc has its own Portal, so its own Executor and Pot", () => {
  // Portal.executor() was read on Arc at block 23293162. The Pot uses Kitchen 1.1.0 initcode.
  const ARC_PORTAL = "0xEC002CA16cE20c2a9F3C6200EF04E7d92a3dfBD8";
  const ARC_EXECUTOR = "0x95b2d45F49c68a54BDBa0356fc3034751A43b3D4";
  const ARC_POT = "0x4edfB4576F91A9c2fE9aA50f669B7C81E4B82955";

  it("derives the Executor Arc's Portal reports", () => {
    expect(ecoRoutesPortal("arc")).toBe(ARC_PORTAL);
    expect(ecoRoutesExecutorOf(ARC_PORTAL)).toBe(ARC_EXECUTOR);
  });

  it("predicts the Pot for Arc's Executor under the released Kitchen", () => {
    expect(v12PredictPot(ARC_EXECUTOR)).toBe(ARC_POT);
    expect(destinationPot("arc")).toBe(ARC_POT);
    expect(ARC_POT).not.toBe(SHARED_POT);
  });

  it("is the Pot the released Pot creation code derives", () => {
    expect(potFromReleasedBytecode(ARC_EXECUTOR)).toBe(ARC_POT);
  });
});
