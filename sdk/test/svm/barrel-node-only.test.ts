/**
 * `@eco-incorp/sauce/svm` runs in a browser; `@eco-incorp/sauce/svm/engine-artifacts` is Node-only
 * (it hands a local LiteSVM harness filesystem paths). The barrel must therefore not re-export it —
 * one `export *` would put `node:fs` back under every `./svm` import. `check-browser-bundles.mjs`
 * catches that by bundling; this names the cause.
 */
import * as artifacts from "../../src/svm/engine-artifacts.js";
import * as svm from "../../src/svm/index.js";

describe("the ./svm barrel", () => {
  it("re-exports none of the Node-only engine-artifacts helpers", () => {
    const leaked = Object.keys(artifacts).filter((name) => name in svm);
    expect(Object.keys(artifacts).length).toBeGreaterThan(0);
    expect(leaked).toEqual([]);
  });
});
