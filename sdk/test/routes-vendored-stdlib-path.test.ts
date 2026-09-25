/**
 * `rs-compile.ts#vendoredStdlibPath` — which of two same-looking specifier shapes the resolver is
 * looking at.
 *
 * The compiler hands `resolve` an importer-joined specifier prefixed with ".", so a vendored
 * package's own relative import (`./erc20.abi.json`) arrives as `"."` + its absolute location under
 * the stdlib root, indistinguishable at a glance from a genuine `./rel` written by an entry
 * program. Getting it wrong either way is silent: serve a genuine `./rel` as a filesystem-root path
 * and it resolves to nothing, or decline a real stdlib import and `@sauce/token` stops resolving.
 *
 * NOT a sandbox, and this suite deliberately does not pretend otherwise: `makeResolve` serves any
 * ABSOLUTE path directly, one branch earlier, so nothing here contains anything. The root test is
 * how the two shapes are told apart, not a permission check.
 */
import { join } from "node:path";
import { VENDORED_STD_ROOT, vendoredStdlibPath } from "../src/routes/rs-compile.js";

describe("vendoredStdlibPath", () => {
  it("strips the compiler's '.' prefix off an absolute path inside the stdlib root", () => {
    const abs = join(VENDORED_STD_ROOT, "token", "erc20.abi.json");
    expect(vendoredStdlibPath(`.${abs}`)).toBe(abs);
  });

  it("declines a genuine './rel' — that one belongs to baseDirs, not the filesystem root", () => {
    expect(vendoredStdlibPath("./helper.js")).toBeUndefined();
    expect(vendoredStdlibPath("./sub/helper.js")).toBeUndefined();
  });

  it("declines a stripped path that lands outside the stdlib root", () => {
    // Falls through to `baseDirs` rather than being read straight off disk. Note this is the
    // disambiguation working, not an escape being blocked — see the file header.
    expect(vendoredStdlibPath("./../../etc/passwd")).toBeUndefined();
    expect(vendoredStdlibPath(".//etc/passwd")).toBeUndefined();
  });

  it("declines anything that is not './'-prefixed at all", () => {
    expect(vendoredStdlibPath("@sauce/token")).toBeUndefined();
    expect(vendoredStdlibPath(join(VENDORED_STD_ROOT, "token", "token.evm.js"))).toBeUndefined();
    expect(vendoredStdlibPath("")).toBeUndefined();
    expect(vendoredStdlibPath(".")).toBeUndefined();
  });
});
