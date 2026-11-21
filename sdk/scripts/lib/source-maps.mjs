/**
 * The package's rule for source maps, which the SDK build's prune (`../prune-source-maps.mjs`)
 * applies and the packed check (`../check-packed-package.mjs`) holds the tarball to: a map ships
 * only as a `.d.ts.map` whose every source ships too, so Go to Definition lands in a shipped `.ts`;
 * no other map ships, and no `sourceMappingURL` in a packed file names a map that does not. `packed`
 * is npm's own list of what the package ships (`npm pack --json`), never a reading of `files`.
 *
 * A directive is found as Node finds one (`kSourceMappingURLMagicComment` in its
 * `lib/internal/source_map/source_map_cache.js`): anywhere in the text, after code too, in a line
 * or a block comment, its URL running to the next whitespace; Node takes a file's last. The pattern
 * is Node's widened to what other readers take: `@` beside `#` (TypeScript's
 * `tryGetSourceMappingURL` reads `//@ `), and no blank required before `sourceMappingURL`. Readers
 * differ in which directive of a file they take (Node the last anywhere, TypeScript the last line
 * comment, a reader with a narrower pattern an earlier one), so every directive is held to the rule:
 * the last, which Node takes, and each before it.
 *
 * A reference (a directive's URL, a map's `sourceRoot`, each of its `sources`) counts only as a
 * relative path inside the package. One that is absolute (`/x`), protocol-relative (`//host/x`),
 * has a scheme (`file:`, `webpack:`, a drive's `C:`) or holds a backslash (which TypeScript reads
 * as `/`, so `\dir/..` is rooted) is refused before anything is joined: TypeScript and Node
 * resolve it away from the file that names it, outside the package, while `posix.join` would make
 * it the packed file beside that file. One that resolves above the package's root is refused too.
 * tsc writes none of these.
 *
 * The pattern finds text, not comments: it also matches inside a string, a regular expression
 * (`/[//# …]/`) or a longer comment. So the prune changes one form only, the trailer tsc writes
 * (`TRAILER`), in a workspace's build output, when it drops the map the trailer names. Every other
 * directive the rule refuses stays as it is, for the audit to name.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";

/** The packed files a directive is looked for in: JavaScript and TypeScript, declarations included. */
const SCANNED = /\.(?:[cm]?js|[cm]?ts)$/;
/** A file in a `dist` folder, a workspace's build output: the only files the prune changes. */
const GENERATED = /(?:^|\/)dist\//;
/** A directive: `//` or `/*`, then `#` or `@`, then `sourceMappingURL=` and its URL. */
const DIRECTIVE = /\/([*/])[#@]\s*sourceMappingURL=(\S+)/g;
/** The trailer tsc writes: `//# sourceMappingURL=<name>.map` at column zero, `<name>` a plain file
 *  name beside the file, as the file's last line, followed by at most one newline. */
const TRAILER = /(?<=^|\n)\/\/# sourceMappingURL=([\w.-]+\.map)\n?$/;

/** Every `sourceMappingURL` directive in `text`, in order: a `line` or a `block` comment, the URL it
 *  names, and where it starts. The last is the one Node takes. */
export function directivesOf(text) {
  return [...text.matchAll(DIRECTIVE)].map((match) => ({
    kind: match[1] === "/" ? "line" : "block",
    url: match[2],
    start: match.index,
  }));
}

/** What `url`, written in the packed file `path`, names, as a packed path. */
const named = (path, url) => posix.normalize(posix.join(posix.dirname(path), url));
/** A reference that is no relative path: absolute or protocol-relative (a leading `/`), with a
 *  scheme, or holding a backslash anywhere, which TypeScript reads as `/` and a join does not. */
const NOT_RELATIVE = /^(?:\/|[A-Za-z][A-Za-z0-9+.-]*:)|\\/;
/** A path `named` gives that goes above the package's root, where no packed file is. */
const ABOVE_ROOT = /^\.\.(?:\/|$)/;

/**
 * Why the packed map `path` (its text, `text`) may not ship, or `undefined` when it may: a
 * `.d.ts.map` naming at least one source, its source root and each source a relative path, each
 * source resolving inside the package to a file in `packed`.
 */
export function mapRefusal(path, text, packed) {
  if (!path.endsWith(".d.ts.map")) return `${path} is a source map other than a declaration map`;
  let map;
  try {
    map = JSON.parse(text);
  } catch {
    return `${path} is not JSON`;
  }
  const sources = Array.isArray(map.sources) ? map.sources : [];
  if (sources.length === 0) return `${path} names no source`;
  const root = typeof map.sourceRoot === "string" ? map.sourceRoot : "";
  if (NOT_RELATIVE.test(root)) {
    return `${path} has the source root ${root}, which is not a relative path`;
  }
  for (const source of sources.map(String)) {
    if (NOT_RELATIVE.test(source)) {
      return `${path} names the source ${source}, which is not a relative path`;
    }
    const resolved = named(path, posix.join(root, source));
    if (ABOVE_ROOT.test(resolved)) {
      return `${path} names ${resolved}, which resolves outside the package`;
    }
    if (!packed.has(resolved)) return `${path} names ${resolved}, which the package does not ship`;
  }

  return undefined;
}

/** Why a directive naming `url` in the packed file `path` may not ship, or `undefined` when it
 *  names a map the package keeps (`kept`). */
function directiveRefusal(path, url, kept) {
  if (url.startsWith("data:")) return `${path} carries an inline source map`;
  if (NOT_RELATIVE.test(url)) return `${path} names ${url}, which is not a relative path`;
  const resolved = named(path, url);
  if (ABOVE_ROOT.test(resolved)) return `${path} names ${url}, which resolves outside the package`;

  return kept.has(resolved) ? undefined : `${path} names ${url}, a map the package does not ship`;
}

/**
 * Everything the files `npm pack` lists (`packed`, under `root`) ship against the rule, one line
 * each, maps first: a refused map, then each directive naming no map the package keeps. An inline
 * `data:` map is refused: it would ship a map no rule holds, its sources unchecked.
 */
export function auditSourceMaps(root, packed) {
  const sorted = [...packed].sort();
  const maps = sorted
    .filter((path) => path.endsWith(".map"))
    .map((path) => [path, mapRefusal(path, readFileSync(join(root, path), "utf8"), packed)]);
  const kept = new Set(maps.filter(([, refusal]) => refusal === undefined).map(([path]) => path));
  const directives = sorted
    .filter((path) => SCANNED.test(path))
    .flatMap((path) =>
      directivesOf(readFileSync(join(root, path), "utf8")).map(({ url }) =>
        directiveRefusal(path, url, kept),
      ),
    );

  return [...maps.map(([, refusal]) => refusal), ...directives].filter(
    (refusal) => refusal !== undefined,
  );
}

/**
 * Deletes every packed map the rule refuses, and takes tsc's trailer (`TRAILER`) off each build
 * output file whose trailer names one of them. It changes nothing else: any other directive the
 * rule refuses stays, for `auditSourceMaps` to name. Deterministic; a second run changes nothing.
 */
export function pruneSourceMaps(root, packed) {
  const sorted = [...packed].sort();
  const maps = sorted.filter((path) => path.endsWith(".map"));
  const removed = maps.filter(
    (path) => mapRefusal(path, readFileSync(join(root, path), "utf8"), packed) !== undefined,
  );
  for (const path of removed) rmSync(join(root, path));
  const dropped = new Set(removed);
  let stripped = 0;
  for (const path of sorted.filter((each) => GENERATED.test(each) && SCANNED.test(each))) {
    const file = join(root, path);
    const text = readFileSync(file, "utf8");
    const trailer = TRAILER.exec(text);
    if (trailer === null || !dropped.has(named(path, trailer[1]))) continue;
    writeFileSync(file, text.slice(0, trailer.index));
    stripped += 1;
  }

  return { kept: maps.length - removed.length, removed, stripped };
}
