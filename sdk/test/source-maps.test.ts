/**
 * The package's source-map rule (`scripts/lib/source-maps.mjs`), which the SDK build's prune
 * applies and the packed check holds the tarball to, on a small tree: tsc's own output, a
 * declaration map whose source ships beside one whose source does not and a JavaScript map, each
 * file ending in tsc's trailer; and every other directive form, which the prune leaves byte for byte
 * and the audit refuses.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { auditSourceMaps, directivesOf, pruneSourceMaps } from "../scripts/lib/source-maps.mjs";

const map = (file: string, sources: string[], sourceRoot = ""): string =>
  JSON.stringify({ version: 3, file, sourceRoot, sources, names: [], mappings: "" });

/** tsc's output: each file ends in its trailer, beside its map. Only `kept.d.ts.map`'s source
 *  ships; `src/dead.ts` is not packed. */
const TSC: Record<string, string> = {
  "src/kept.ts": "export const kept = 1;\n",
  "dist/kept.d.ts": "export declare const kept = 1;\n//# sourceMappingURL=kept.d.ts.map",
  "dist/kept.d.ts.map": map("kept.d.ts", ["../src/kept.ts"]),
  "dist/dead.d.ts": "export declare const dead = 1;\n//# sourceMappingURL=dead.d.ts.map",
  "dist/dead.d.ts.map": map("dead.d.ts", ["../src/dead.ts"]),
  "dist/code.js": "export const code = 1;\n//# sourceMappingURL=code.js.map\n",
  "dist/code.js.map": map("code.js", ["../src/kept.ts"]),
  "src/note.js.map": map("note.js", ["note.ts"]),
};

/** Every other directive form, most naming a map the prune drops. */
const OTHER: Record<string, string> = {
  "dist/at.js": "export const at = 1;\n//@ sourceMappingURL=code.js.map\n",
  "dist/indented.js": "export const indented = 1;\n  //# sourceMappingURL=code.js.map\n",
  "dist/block.js": "export const block = 1;\n/*# sourceMappingURL=code.js.map */\n",
  "dist/after.js": "export const after = 1; //# sourceMappingURL=code.js.map\n",
  "dist/earlier.js": "//# sourceMappingURL=code.js.map\nexport const earlier = 1;\n",
  "dist/twice.d.ts":
    "export declare const twice = 1;\n//# sourceMappingURL=gone.d.ts.map\n//# sourceMappingURL=kept.d.ts.map",
  "dist/inline.js":
    "export const inline = 1;\n//# sourceMappingURL=data:application/json;base64,e30=\n",
  "dist/missing.js": "export const missing = 1;\n//# sourceMappingURL=missing.js.map\n",
  "dist/regex.js": "export const re = /[//# sourceMappingURL=x]/;\n",
  "dist/text.js": 'export const text = "//# sourceMappingURL=nowhere.map";\n',
  "src/note.ts": "export const note = 1;\n//# sourceMappingURL=note.js.map",
};

/** What the audit refuses in `OTHER`, before the prune and after it. */
const OTHER_REFUSED = [
  "dist/after.js names code.js.map, a map the package does not ship",
  "dist/at.js names code.js.map, a map the package does not ship",
  "dist/block.js names code.js.map, a map the package does not ship",
  "dist/earlier.js names code.js.map, a map the package does not ship",
  "dist/indented.js names code.js.map, a map the package does not ship",
  "dist/inline.js carries an inline source map",
  "dist/missing.js names missing.js.map, a map the package does not ship",
  "dist/regex.js names x]/;, a map the package does not ship",
  'dist/text.js names nowhere.map";, a map the package does not ship',
  "dist/twice.d.ts names gone.d.ts.map, a map the package does not ship",
  "src/note.ts names note.js.map, a map the package does not ship",
];

/** References a join would take for the packed file beside them, and ones that climb out of the
 *  package and back in: the review's three first (an absolute directive beside a kept map, an
 *  absolute source root, a relative root with an absolute source), then a scheme and a
 *  protocol-relative URL in each place, then a backslash in each place (TypeScript reads `\` as `/`,
 *  so `\dir/..` is rooted, while a join cancels it), then a directive and a source that climb out. */
const OUTSIDE: Record<string, string> = {
  "dist/rooted.d.ts":
    "export declare const rooted = 1;\n//# sourceMappingURL=kept.d.ts.map\n//# sourceMappingURL=/kept.d.ts.map",
  "dist/root.d.ts.map": map("root.d.ts", ["kept.d.ts"], "/"),
  "dist/absolute.d.ts.map": map("absolute.d.ts", ["/kept.ts"], "../src/"),
  "dist/schemed.d.ts":
    "export declare const schemed = 1;\n//# sourceMappingURL=x:/../kept.d.ts.map\n//# sourceMappingURL=//host/kept.d.ts.map",
  "dist/scheme-root.d.ts.map": map("scheme-root.d.ts", ["kept.d.ts"], "x:/../"),
  "dist/scheme-source.d.ts.map": map("scheme-source.d.ts", ["x:/../../src/kept.ts"]),
  "dist/backslash.d.ts":
    "export declare const backslash = 1;\n//# sourceMappingURL=\\dir/../kept.d.ts.map",
  "dist/backslash-root.d.ts.map": map("backslash-root.d.ts", ["kept.d.ts"], "\\dir/../"),
  "dist/backslash-source.d.ts.map": map("backslash-source.d.ts", ["\\dir/../../src/kept.ts"]),
  "dist/climb.d.ts":
    "export declare const climb = 1;\n//# sourceMappingURL=../../package/dist/kept.d.ts.map",
  "dist/climb.d.ts.map": map("climb.d.ts", ["../../package/src/kept.ts"]),
};

let root: string;
/** The tree's files still on disk: what npm would pack now. */
const packed = (): Set<string> =>
  new Set(
    [...Object.keys(TSC), ...Object.keys(OTHER)].filter((path) => existsSync(join(root, path))),
  );
const read = (path: string): string => readFileSync(join(root, path), "utf8");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sauce-source-maps-"));
  for (const [path, text] of Object.entries({ ...TSC, ...OTHER })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the package's source-map rule", () => {
  it("finds a directive as Node does: # or @, line or block, indented, after code, inline, in a regular expression, in a string", () => {
    expect(
      Object.fromEntries(
        Object.entries(OTHER).map(([path, text]) => [
          path,
          directivesOf(text).map(({ kind, url }) => `${kind} ${url}`),
        ]),
      ),
    ).toEqual({
      "dist/at.js": ["line code.js.map"],
      "dist/indented.js": ["line code.js.map"],
      "dist/block.js": ["block code.js.map"],
      "dist/after.js": ["line code.js.map"],
      "dist/earlier.js": ["line code.js.map"],
      "dist/twice.d.ts": ["line gone.d.ts.map", "line kept.d.ts.map"],
      "dist/inline.js": ["line data:application/json;base64,e30="],
      "dist/missing.js": ["line missing.js.map"],
      "dist/regex.js": ["line x]/;"],
      "dist/text.js": ['line nowhere.map";'],
      "src/note.ts": ["line note.js.map"],
    });
  });

  it("refuses a JavaScript map, a declaration map naming an unshipped source, and every directive naming no kept map, the last and each before it", () => {
    expect(auditSourceMaps(root, packed())).toEqual([
      "dist/code.js.map is a source map other than a declaration map",
      "dist/dead.d.ts.map names src/dead.ts, which the package does not ship",
      "src/note.js.map is a source map other than a declaration map",
      ...OTHER_REFUSED.slice(0, 3),
      "dist/code.js names code.js.map, a map the package does not ship",
      "dist/dead.d.ts names dead.d.ts.map, a map the package does not ship",
      ...OTHER_REFUSED.slice(3),
    ]);
  });

  it("deletes the refused maps and takes tsc's trailer off the build files naming them, and a second run changes nothing", () => {
    expect(pruneSourceMaps(root, packed())).toEqual({
      kept: 1,
      removed: ["dist/code.js.map", "dist/dead.d.ts.map", "src/note.js.map"],
      stripped: 2,
    });
    expect(read("dist/code.js")).toBe("export const code = 1;\n");
    expect(read("dist/dead.d.ts")).toBe("export declare const dead = 1;\n");
    expect(read("dist/kept.d.ts")).toBe(TSC["dist/kept.d.ts"]);
    expect(existsSync(join(root, "dist/kept.d.ts.map"))).toBe(true);
    const pruned = [...packed()].map(read);
    expect(pruneSourceMaps(root, packed())).toEqual({ kept: 1, removed: [], stripped: 0 });
    expect([...packed()].map(read)).toEqual(pruned);
  });

  it("leaves every other directive form byte for byte, a regular expression and a string included, for the audit to refuse", () => {
    pruneSourceMaps(root, packed());
    for (const [path, text] of Object.entries(OTHER)) {
      expect([path, read(path)]).toEqual([path, text]);
    }
    expect(auditSourceMaps(root, packed())).toEqual(OTHER_REFUSED);
  });

  it("takes a reference only as a relative path inside the package: absolute, schemed, with a backslash or climbing out, it is refused", () => {
    for (const [path, text] of Object.entries(OUTSIDE)) writeFileSync(join(root, path), text);
    const files = new Set([
      "src/kept.ts",
      "dist/kept.d.ts",
      "dist/kept.d.ts.map",
      ...Object.keys(OUTSIDE),
    ]);
    expect(auditSourceMaps(root, files)).toEqual([
      "dist/absolute.d.ts.map names the source /kept.ts, which is not a relative path",
      "dist/backslash-root.d.ts.map has the source root \\dir/../, which is not a relative path",
      "dist/backslash-source.d.ts.map names the source \\dir/../../src/kept.ts, which is not a relative path",
      "dist/climb.d.ts.map names ../package/src/kept.ts, which resolves outside the package",
      "dist/root.d.ts.map has the source root /, which is not a relative path",
      "dist/scheme-root.d.ts.map has the source root x:/../, which is not a relative path",
      "dist/scheme-source.d.ts.map names the source x:/../../src/kept.ts, which is not a relative path",
      "dist/backslash.d.ts names \\dir/../kept.d.ts.map, which is not a relative path",
      "dist/climb.d.ts names ../../package/dist/kept.d.ts.map, which resolves outside the package",
      "dist/rooted.d.ts names /kept.d.ts.map, which is not a relative path",
      "dist/schemed.d.ts names x:/../kept.d.ts.map, which is not a relative path",
      "dist/schemed.d.ts names //host/kept.d.ts.map, which is not a relative path",
    ]);
    // The prune deletes the refused maps and keeps the one beside them. None of these files ends in
    // tsc's trailer, so it edits none of them.
    expect(pruneSourceMaps(root, files)).toEqual({
      kept: 1,
      removed: [
        "dist/absolute.d.ts.map",
        "dist/backslash-root.d.ts.map",
        "dist/backslash-source.d.ts.map",
        "dist/climb.d.ts.map",
        "dist/root.d.ts.map",
        "dist/scheme-root.d.ts.map",
        "dist/scheme-source.d.ts.map",
      ],
      stripped: 0,
    });
    for (const path of Object.keys(OUTSIDE).filter((each) => !each.endsWith(".map"))) {
      expect([path, read(path)]).toEqual([path, OUTSIDE[path]]);
    }
  });
});
