/**
 * The Pot the SDK derives for an intent is the solver's shared Pot, not a second one.
 *
 * The solver deploys one Pot per Portal: owner = `Portal.executor()`, salt zero, through the
 * released Kitchen. An SDK route cooking anywhere else would cook on a Pot nothing deploys or
 * funds. The Executor address was read on-chain (`executor()` on every chain the Portal is deployed
 * on); Pot addresses use Kitchen 1.1.0 release initcode. These predictions require that Kitchen
 * implementation and are not claims of live deployment.
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

/** eco-routes 2.12.0, the Portal `@eco-foundation/routes-ts` 3.2.24 records on every EVM chain. */
const PROD_PORTAL = "0xEC000769A73b70e16f361a442292500b3BCf4A85";
const PROD_EXECUTOR = "0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082";
const SHARED_POT = "0xDd330394620fBFF4D0AdcfA33B0D7b3622Db15B0";

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

  // Every canonical EVM chain the registry deploys the Portal on: one Portal, so one Executor and
  // one Pot. Arc included — it had a Portal of its own before this generation.
  it.each([
    "ethereum",
    "optimism",
    "unichain",
    "polygon",
    "monad",
    "ronin",
    "arc",
    "base",
    "plasma",
    "arbitrum",
  ])("is the Pot an intent to %s cooks on by default", (chain) => {
    expect(ecoRoutesPortal(chain)).toBe(PROD_PORTAL);
    expect(destinationPot(chain)).toBe(SHARED_POT);
  });
});
