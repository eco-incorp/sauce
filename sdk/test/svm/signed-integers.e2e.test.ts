/**
 * SauceScript's signed integers, EXECUTED on the released Solana engine in LiteSVM: the same
 * programs and the same words as `evm/signed-integers.e2e.test.ts`
 * (`../signed-integer-cases.ts`), so the two targets are held to one set of answers.
 *
 * Engine-gated like every other SVM execution suite: skipped locally when the engine artifacts are
 * absent, a failure in CI, which supplies them.
 */
import { compile } from "../../src/compiler.js";
import { REVERTS, SIGNED_CASES } from "../signed-integer-cases.js";
import {
  execute,
  expectFail,
  expectOk,
  startEngine,
  svmArtifactsPresent,
  toBigInt,
} from "./engine-harness.js";

if (!svmArtifactsPresent && process.env.CI) {
  throw new Error(
    "SAUCE_RUST_ENGINE_SO / SAUCE_KITCHEN_SO / SAUCE_KITCHEN_IDL_JSON are unset or missing in CI. " +
      'This suite must never skip here — see the "Fetch the v12 engines" step in ' +
      ".github/workflows/ci.yml.",
  );
}

const describeSvm = svmArtifactsPresent ? describe : describe.skip;

/** `main`'s parameters as the ABI-v1 entry encoding takes scalars: one 32-byte big-endian word each. */
const words = (args: readonly bigint[]): Uint8Array =>
  Uint8Array.from(Buffer.from(args.map((a) => a.toString(16).padStart(64, "0")).join(""), "hex"));

describeSvm("SauceScript's Int256, executed through the released Solana engine", () => {
  for (const { group, name, source, args, returns, signed, evmOnly } of SIGNED_CASES) {
    if (evmOnly) continue;

    it(`${group}: ${name}`, async () => {
      const artifact = compile({
        target: "svm",
        resolve: () => new TextEncoder().encode(source),
      });
      const payload = {
        bytecode: Uint8Array.from([...artifact.bytecode, ...words(args)]),
        manifest: artifact.manifest!,
      };
      const harness = await startEngine(1_700_000_000n);
      const result = await execute(harness, payload, {});

      if (returns === REVERTS) {
        expectFail(result);
      } else {
        const word = toBigInt(expectOk(result).returnData);
        expect(signed ? BigInt.asIntN(256, word) : word).toBe(returns);
      }
    });
  }
});
