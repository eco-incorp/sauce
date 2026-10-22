/**
 * The Pot the SDK derives for an owner is the one the released Kitchen mints.
 *
 * Pot addresses use Kitchen 1.2.0 release initcode. These predictions require that Kitchen
 * implementation and are not claims of live deployment.
 *
 * Each pinned Pot is checked twice: `v12PredictPot` derives it from the init-code hash
 * `addresses.json` records, and `evm/pot-address.ts` derives it again from the released `V12Pot.json`
 * creation code itself, an independent source. A Kitchen release that moves the Pot bytecode fails
 * both until the pins are re-read.
 */
import { v12KitchenAddress } from "../src/deployments/index.js";
import { DEFAULT_POT_SALT, v12PredictPot } from "../src/deployments/pot.js";
import { potFromReleasedBytecode } from "./evm/pot-address.js";

const OWNER = "0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082";
const POT = "0x6340080a1967a03cAAD490a170828d4C59EE5983";

describe("an owner's default Pot", () => {
  it("uses salt zero", () => {
    expect(DEFAULT_POT_SALT).toBe(`0x${"00".repeat(32)}`);
  });

  it("predicts the Pot the released Kitchen mints for the owner", () => {
    expect(v12KitchenAddress()).toBe("0x19845b22989150E6B09dE55a661295Dd9188506b");
    expect(v12PredictPot(OWNER)).toBe(POT);
  });

  it("is the Pot the released Pot creation code derives", () => {
    expect(potFromReleasedBytecode(OWNER)).toBe(POT);
  });
});
