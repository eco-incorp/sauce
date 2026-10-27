// The changelog's "Which versions work together" table as data: every SDK and the compiler,
// engines and Kitchens it pinned. `versionTableOf` reads every row, which `pnpm docs:check` holds to
// `releases.json` (`docs/scripts/check-docs.mjs`); `sdkReleasesOf` the released ones, which a refusal
// of a Pot names (`cli/pots.ts#pairedSdkReleases`) and `gen-embedded-sources.mjs` writes into
// `src/embedded/sdk-releases.generated.ts`, so the SDK reads no docs at run time.
//
// Each row is keyed by its column's name lowercased (`sdk`, `compiler`, `v12-evm`, `kitchen-evm`,
// `v12-svm`, `kitchen-svm`), in the table's order, every version exactly as the table gives it.
// The row of the SDK not released yet (`Unreleased`) is validated, and `sdkReleasesOf` leaves it
// out: it names no version, and none is made up for it. The package's own version is no help
// there, since the release workflow stamps it only after the build.
//
// A table this cannot read throws, naming what is wrong, so the build fails rather than ship a
// refusal that names no SDK release; so does a line of it that is not a row, rather than drop the
// release it was.

const SECTION = /^## Which versions work together\s*$([^]*?)(?=^## |(?![^]))/m;
const COLUMNS = ["SDK", "Compiler", "v12-evm", "kitchen-evm", "v12-svm", "kitchen-svm"];
const VERSION = /^\d+\.\d+\.\d+$/;
const SEPARATOR = /^:?-+:?$/;
const WHERE = "docs/changelog.md";

/** A table row's cells, trimmed. */
const cellsOf = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

/**
 * Every row of `changelog`'s version table, in its order, the Unreleased one included:
 * `{ sdk, compiler, … }`.
 */
export function versionTableOf(changelog) {
  const section = SECTION.exec(changelog)?.[1];
  if (section === undefined) {
    throw new Error(`${WHERE}: no "## Which versions work together" section`);
  }
  // The table is its header and every line after it up to the first blank line, as Markdown reads
  // it: each of those is a row, written between pipes. A line there that is not one, or a row after
  // that blank line, which Markdown shows as text, is refused rather than left out.
  const lines = section.split("\n").map((line) => line.trim());
  const start = lines.findIndex((line) => line.startsWith("|"));
  const end = start < 0 ? -1 : lines.indexOf("", start);
  const table = start < 0 ? [] : lines.slice(start, end < 0 ? undefined : end);
  for (const line of table) {
    if (!line.startsWith("|") || !line.endsWith("|")) {
      throw new Error(
        `${WHERE}: the line "${line}" in the version table is not a row: a row starts and ends ` +
          'with "|"',
      );
    }
  }
  const stray =
    start < 0 ? undefined : lines.slice(start + table.length).find((line) => line.startsWith("|"));
  if (stray !== undefined) {
    throw new Error(
      `${WHERE}: the row "${stray}" follows a blank line, which ends the version table, so it is ` +
        "not read as one of its rows",
    );
  }
  const [header, separator, ...rows] = table.map(cellsOf);
  if (
    header === undefined ||
    separator === undefined ||
    !separator.every((cell) => SEPARATOR.test(cell))
  ) {
    throw new Error(`${WHERE}: the section under ## Which versions work together holds no table`);
  }
  if (header.join("|") !== COLUMNS.join("|")) {
    throw new Error(
      `${WHERE}: the table under ## Which versions work together has columns ${header.join(", ")}; ` +
        `it needs ${COLUMNS.join(", ")}`,
    );
  }
  const seen = new Set();
  const entries = [];
  for (const row of rows) {
    const sdk = row[0];
    if (row.length !== COLUMNS.length) {
      throw new Error(
        `${WHERE}: the row of ${sdk}: ${row.length} cells, and the table has ${COLUMNS.length} columns`,
      );
    }
    if (sdk !== "Unreleased" && !VERSION.test(sdk)) {
      throw new Error(`${WHERE}: a row's SDK cell, "${sdk}", is neither a version nor Unreleased`);
    }
    if (seen.has(sdk)) throw new Error(`${WHERE}: ${sdk} has two rows in the version table`);
    seen.add(sdk);
    for (const [index, column] of COLUMNS.entries()) {
      if (index > 0 && !VERSION.test(row[index])) {
        throw new Error(
          `${WHERE}: the row of ${sdk}: its ${column} cell, "${row[index]}", is not a version`,
        );
      }
    }
    entries.push(
      Object.fromEntries(COLUMNS.map((column, index) => [column.toLowerCase(), row[index]])),
    );
  }

  return entries;
}

/** Every released SDK of `changelog`'s version table, in its order: `{ sdk, compiler, … }`. */
export function sdkReleasesOf(changelog) {
  const releases = versionTableOf(changelog).filter((row) => row.sdk !== "Unreleased");
  if (releases.length === 0) {
    throw new Error(
      `${WHERE}: the table under ## Which versions work together names no released SDK`,
    );
  }

  return releases;
}
