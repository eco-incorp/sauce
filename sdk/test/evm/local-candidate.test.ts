import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { potFromReleasedBytecode } from "./pot-address.js";
import { v12PredictPot } from "../../src/deployments/pot.js";

const artifacts = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/artifacts");
const owner = "0x0000000000000000000000000000000000000141" as const;

describe("current factory harness prediction", () => {
  it("uses the helper namespace, not historical Pot creation code", () => {
    if (!existsSync(resolve(artifacts, "V12EngineGate.json"))) return;
    const gate = JSON.parse(readFileSync(resolve(artifacts, "V12EngineGate.json"), "utf8"));
    expect(potFromReleasedBytecode(owner)).toBe(v12PredictPot(owner, undefined, gate.kitchen));
  });
});
