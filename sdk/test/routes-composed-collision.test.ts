/**
 * `routes/composed.ts` refuses to compose a chain accessor when a contract or venue namespace key
 * would land on a name the accessor already owns: `chain`, or an intrinsic (`call`, `bind`,
 * `toString`, ...). A protocol slug that happened to be one of those would otherwise corrupt `Base`
 * itself for every consumer, at module-eval time.
 *
 * No registry protocol collides today, so the namespace tree is replaced for this file only: the
 * descriptor layer's `chainContracts` is mocked to return whatever namespaces a case plants, and
 * `composedChainGlobal` runs for real over it. Each case uses a different chain because
 * composition is memoised per name.
 */
// ESM jest exposes `jest` on `import.meta`, and every import of the modules under test must be
// dynamic and come after the mock, or the real descriptor layer is loaded first.
const { jest } = import.meta as unknown as {
  jest: { unstable_mockModule(path: string, factory: () => unknown): void };
};

let planted: Record<string, unknown> = {};
jest.unstable_mockModule("../src/descriptors/accessors.js", () => ({
  chainContracts: () => planted,
}));
const { composedChainGlobal } = await import("../src/routes/composed.js");
const { chainAccessors } = await import("../src/routes/accessors.js");

/** EVM chains only: an svm chain also composes the real venue tree, which is not under test. */
const names = Object.entries(
  chainAccessors as unknown as Record<string, { chain: { kind: string } }>,
)
  .filter(([, origin]) => origin.chain.kind === "evm")
  .map(([name]) => name)
  // Monad is kept for the token case below: it has registry tokens (USDC, WMON).
  .filter((name) => name !== "Monad");
let next = 0;
function composeWith(key: string): { name: string; compose: () => unknown } {
  const name = names[next++]!;
  planted = { [key]: { contract: "planted" } };
  return { name, compose: () => composedChainGlobal(name) };
}

describe("composedChainGlobal: a namespace that collides with the accessor is refused", () => {
  it.each(["chain"])("an accessor key: %s", (key) => {
    const { name, compose } = composeWith(key);
    expect(compose).toThrow(
      `routes/composed: '${key}' collides with another name on the '${name}' accessor`,
    );
  });

  it.each([
    "length",
    "name",
    "prototype",
    "arguments",
    "caller",
    "bind",
    "call",
    "apply",
    "toString",
    "constructor",
  ])("an intrinsic: %s", (key) => {
    const { name, compose } = composeWith(key);
    expect(compose).toThrow(
      `routes/composed: '${key}' collides with another name on the '${name}' accessor`,
    );
  });

  it("a namespace named like one of the chain's registry tokens", () => {
    planted = { USDC: { contract: "planted" } };
    expect(() => composedChainGlobal("Monad")).toThrow(
      "routes/composed: 'USDC' collides with another name on the 'Monad' accessor",
    );
  });

  it("a namespace that collides with nothing composes", () => {
    const { compose } = composeWith("Planted");
    const composed = compose() as Record<string, unknown>;
    expect(composed.Planted).toEqual({ contract: "planted" });
    expect(typeof composed).toBe("object");
  });
});
