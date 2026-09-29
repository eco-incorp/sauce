/**
 * The Pot the SDK derives for an intent is the solver's shared Pot, not a second one.
 *
 * The solver deploys one Pot per Portal: owner = `Portal.executor()`, salt zero, through the
 * released Kitchen. An SDK route cooking anywhere else would cook on a Pot nothing deploys or
 * funds. The addresses below were read from the chain, not derived here: the production Portal's
 * `executor()`, and the released Kitchen's `predictPot(executor, 0)`, which returned the same Pot on
 * Base, OP Mainnet and Arbitrum One.
 */
import { SAUCE_INTENT_POT_SALT, v12GateKitchen, v12PredictPot } from "../src/deployments/pot.js";
import { ecoRoutesExecutorOf, ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import { destinationPot } from "../src/routes/intent-pot.js";

const PROD_PORTAL = "0xEC000064576f9C95a8623Bc0eff3db6d296ea6df";
const PROD_EXECUTOR = "0x645dADD5Bf354526b68A2befd9A305F7E03b91Ca";
const SHARED_POT = "0x8C5eFf4e8a953AE5EA92190346985Dfa23db7e62";

describe("the intent Pot is the solver's shared Pot", () => {
  it("uses salt zero", () => {
    expect(SAUCE_INTENT_POT_SALT).toBe(`0x${"00".repeat(32)}`);
  });

  it("derives the production Portal's Executor", () => {
    expect(ecoRoutesExecutorOf(PROD_PORTAL)).toBe(PROD_EXECUTOR);
  });

  it("predicts the Pot the released Kitchen reports for that Executor", () => {
    expect(v12GateKitchen()).toBe("0x19845b22989150E6B09dE55a661295Dd9188506b");
    expect(v12PredictPot(PROD_EXECUTOR)).toBe(SHARED_POT);
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
  // Read from Arc (rpc.mainnet.arc.io) on 2026-09-28: Portal.executor() at block 23293162, and the
  // released Kitchen's predictPot(executor, 0) at block 23293350, which returned this Pot. The Pot
  // had no code then: the solver (or anyone) must deploy it before an intent to Arc can execute.
  const ARC_PORTAL = "0xEC002CA16cE20c2a9F3C6200EF04E7d92a3dfBD8";
  const ARC_EXECUTOR = "0x95b2d45F49c68a54BDBa0356fc3034751A43b3D4";
  const ARC_POT = "0xBDbbf86bC1D8afE1b382Eee56f5d733AC7bd43a5";

  it("derives the Executor Arc's Portal reports", () => {
    expect(ecoRoutesPortal("arc")).toBe(ARC_PORTAL);
    expect(ecoRoutesExecutorOf(ARC_PORTAL)).toBe(ARC_EXECUTOR);
  });

  it("predicts the Pot Arc's Kitchen reports for that Executor", () => {
    expect(v12PredictPot(ARC_EXECUTOR)).toBe(ARC_POT);
    expect(destinationPot("arc")).toBe(ARC_POT);
    expect(ARC_POT).not.toBe(SHARED_POT);
  });
});
