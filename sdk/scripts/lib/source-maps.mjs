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
 * literal relative path (`LITERAL`): letters, digits, `.`, `_`, `-` and `/`, not starting with `/`,
 * with no empty segment. Anything else is refused as written, before it is joined, because a path
 * join reads it as the packed file beside the one naming it while TypeScript or Node reads it
 * elsewhere: a leading `/` or `//host`, a scheme, a backslash (TypeScript's `/`), `%2e%2e` (a URL's
 * `..`), a query or a fragment (Node opens what comes before it), a space or a control character
 * (a URL drops them), `x//..` (a URL's `x/`). A directive's URL and each source must also end in a
 * file name: a URL keeps the trailing `/` of a final `.` or `..` segment, naming a directory, where
 * a path join drops it and lands on a file. Node reads a source as `sourceRoot + source` and
 * TypeScript as a path under the root, so each source must name the same file both ways; and one
 * that resolves above the package's root is refused too. tsc writes none of these. A refused value is
 * shown as a JSON string, so each refusal stays on one line and shows what is there.
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
/**
 * A literal relative path, which is all a reference may be as written: path characters only, not
 * starting with `/`, no empty segment. A path join, TypeScript and Node's URL resolution then all
 * read it as `named` does: nothing in it is decoded, cut off as a query or fragment, or read as a
 * root, a scheme or a separator, and `..` meets no empty segment.
 */
const LITERAL = /^(?!\/)(?!.*\/\/)[A-Za-z0-9._/-]+$/;
/** A path `named` gives that goes above the package's root, where no packed file is. */
const ABOVE_ROOT = /^\.\.(?:\/|$)/;
/** A file reference ending in no file name: a trailing `/`, or a final `.` or `..` segment, which a
 *  URL resolves to a directory (`x/.` is `x/`) while a path join drops it (`x/.` is `x`). */
const NO_FILE_NAME = /(?:^|\/)\.{0,2}$/;

/**
 * Why the packed map `path` (its text, `text`) may not ship, or `undefined` when it may: a
 * `.d.ts.map` naming at least one source, its source root empty or a literal relative path, each
 * source a literal relative path ending in a file name and naming the same file under the root as a
 * path (TypeScript) and as a string prefix (Node), inside the package, a file in `packed`.
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
  const root = map.sourceRoot ?? "";
  if (root !== "" && !(typeof root === "string" && LITERAL.test(root))) {
    return `${path} has the source root ${JSON.stringify(root)}, which is not a literal relative path`;
  }
  for (const source of sources) {
    if (typeof source !== "string" || !LITERAL.test(source)) {
      return `${path} names the source ${JSON.stringify(source)}, which is not a literal relative path`;
    }
    if (NO_FILE_NAME.test(source)) {
      return `${path} names the source ${JSON.stringify(source)}, which does not end in a file name`;
    }
    // TypeScript reads the source as a path under the root, Node as `sourceRoot + source`.
    const resolved = named(path, posix.join(root, source));
    const concatenated = named(path, `${root}${source}`);
    if (concatenated !== resolved) {
      return `${path} names ${resolved} under the source root ${root}, which Node reads as ${concatenated}`;
    }
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
  if (!LITERAL.test(url)) {
    return `${path} names ${JSON.stringify(url)}, which is not a literal relative path`;
  }
  if (NO_FILE_NAME.test(url)) {
    return `${path} names ${JSON.stringify(url)}, which does not end in a file name`;
  }
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
