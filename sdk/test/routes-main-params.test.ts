/**
 * `main`'s parameter list reaches the compiler as written.
 *
 * The route adapter used to annotate every unannotated `main` parameter with `: Uint256`, splitting
 * the list on commas. A trailing comma after the last parameter — what Prettier writes for a list
 * that wraps — left an empty piece, which became `: Uint256` on its own: `refundTo: Uint256, :
 * Uint256`, a parse error in a program that was fine. The compiler already reads an unannotated
 * parameter as a number, so there is nothing to add.
 */
import { compileWithRs } from "../src/routes/rs-compile.js";
import { compileSauceRoute } from "../src/routes/sauce-route.js";

const EXECUTION = {
  pot: "0x1111111111111111111111111111111111111111",
  engine: "0x2222222222222222222222222222222222222222",
} as const;

const compiled = (source: string): readonly number[] =>
  Array.from(compileSauceRoute("base", source, EXECUTION).compiled.bytecode[0]!);

describe("main's parameters", () => {
  it("compiles with a trailing comma after the last parameter", () => {
    const wrapped = `function main(
  refundTo,
  amount,
) {
  require(amount > 0n);
  require(refundTo != 0n);
}`;

    expect(compiled(wrapped)).toEqual(
      compiled(
        "function main(refundTo, amount) { require(amount > 0n); require(refundTo != 0n); }",
      ),
    );
  });

  it.each([false, true])(
    "an unannotated parameter is the program an annotated `Uint256` one is (compactArgs %s)",
    (compactArgs) => {
      // Why nothing has to be added: the compiler reads an unannotated parameter as a number, the
      // same program and the same entry schema as one written `: Uint256`.
      const plain = compileWithRs({
        source: "function main(amount): void { require(amount > 0n); }",
        target: "v12",
        compactArgs,
      });
      const annotated = compileWithRs({
        source: "function main(amount: Uint256): void { require(amount > 0n); }",
        target: "v12",
        compactArgs,
      });

      expect(Array.from(plain.bytecode[0]!)).toEqual(Array.from(annotated.bytecode[0]!));
      expect(plain.entrySchema).toEqual(annotated.entrySchema);
    },
  );
});
