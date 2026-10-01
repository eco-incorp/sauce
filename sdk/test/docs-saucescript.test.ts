/**
 * The SauceScript reference (`docs/api/saucescript.md`) and its builtins (`docs/api/builtins.json`),
 * held to the compiler this package ships, so neither can rot.
 *
 *  - Every builtin's example compiles on each target it lists, and its `unavailable` program fails
 *    on that target with the error it names.
 *  - Every example in the reference's tables is part of a program that compiles on each target its
 *    row claims: a builtin's example, or a language case (`docs-saucescript.cases.ts`).
 *  - Every error the reference quotes is one the compiler gives: some rejected program's message
 *    matches it, `…` and `N` standing for the elided text and a number.
 *  - Every language case does what it says.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "../src/compiler.js";
import { resolveSdkModule, resolveSdkPackage } from "../src/embedded/resolve.js";
import {
  EXTRA_ABIS,
  LANGUAGE_CASES,
  type LanguageCase,
  type Target,
} from "./docs-saucescript.cases.js";

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/api");
const REFERENCE = readFileSync(join(DOCS, "saucescript.md"), "utf8");

interface Builtin {
  readonly name: string;
  readonly group: string;
  readonly signature: string;
  readonly targets: readonly Target[];
  readonly example: Readonly<Partial<Record<Target, string>>>;
  readonly unavailable?: Readonly<Partial<Record<Target, { program: string; error: string }>>>;
  readonly contracts?: readonly string[];
}
const BUILTINS = JSON.parse(readFileSync(join(DOCS, "builtins.json"), "utf8")) as {
  readonly abis: Readonly<Record<string, string>>;
  readonly builtins: readonly Builtin[];
};
const ABIS: Readonly<Record<string, string>> = { ...BUILTINS.abis, ...EXTRA_ABIS };

/** A program and what it needs resolved. */
interface Program {
  readonly source: string;
  readonly contracts?: readonly string[];
  readonly files?: Readonly<Record<string, string>>;
  readonly abiFiles?: Readonly<Record<string, string>>;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const utf8 = new TextEncoder();

/** The compiler's message for `program` on `target`, or `undefined` when it compiles. */
function rejection(program: Program, target: Target): string | undefined {
  const modules: Record<string, string> = { "main.js": program.source, ...program.files };
  for (const [path, abi] of Object.entries(program.abiFiles ?? {})) modules[path] = ABIS[abi]!;
  try {
    compile({
      target,
      entry: "main.js",
      // The compiler joins a relative import against its importer: `./lib.ts` from `main.js`.
      resolve: (path) => {
        const own = modules[path.replace(/^\.\//, "")];
        return own !== undefined ? utf8.encode(own) : resolveSdkModule(path);
      },
      resolvePackage: (specifier) => resolveSdkPackage(specifier),
      inlineContracts: program.contracts?.map((name) => [name, ABIS[name]!] as [string, string]),
    });
    return undefined;
  } catch (error) {
    return String((error as Error).message).replace(ANSI, "");
  }
}

/** Backticks and line breaks are presentation: compare the words. */
const plain = (text: string) => text.replace(/`/g, "").replace(/\s+/g, " ").trim();

/** A quoted error as a pattern: `…` is elided text, `N` a number, `<what>` a placeholder. */
function quotePattern(quote: string): RegExp {
  const parts = plain(quote)
    .split(/(…|<[^>]+>|\bN\b)/)
    .map((part) =>
      part === "…" || part.startsWith("<")
        ? "[\\s\\S]*?"
        : part === "N"
          ? "\\d+"
          : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
  return new RegExp(parts.join(""));
}

/** The reference with fenced code removed, and the spans of its inline code. */
function codeSpans(text: string): { readonly start: number; readonly end: number }[] {
  const spans: { start: number; end: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "`") continue;
    let run = 1;
    while (text[i + run] === "`") run++;
    const close = text.indexOf("`".repeat(run), i + run);
    // A span does not cross a blank line.
    if (close === -1 || text.slice(i, close).includes("\n\n")) {
      i += run - 1;
      continue;
    }
    spans.push({ start: i, end: close + run });
    i = close + run - 1;
  }
  return spans;
}

/** Every quoted error in the reference: text between double quotes outside inline code. */
function quotedErrors(text: string): string[] {
  const spans = codeSpans(text);
  const inCode = (at: number) => spans.some((span) => at >= span.start && at < span.end);
  const quotes: string[] = [];
  let open = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"' || inCode(i)) continue;
    if (open === -1) open = i;
    else {
      quotes.push(text.slice(open + 1, i));
      open = -1;
    }
  }
  return quotes;
}

/** A table row's cells, `|` inside inline code kept. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let fence = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === "`") {
      let run = 1;
      while (line[i + run] === "`") run++;
      fence = fence === 0 ? run : fence === run ? 0 : fence;
      cell += "`".repeat(run);
      i += run - 1;
    } else if (ch === "\\" && line[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (ch === "|" && fence === 0) {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  return out.slice(1);
}

/** The inline code of one cell, in order. */
function inlineCode(cell: string): string[] {
  return codeSpans(cell).map(({ start, end }) =>
    cell.slice(start, end).replace(/^`+ ?| ?`+$/g, ""),
  );
}

interface ExampleRow {
  readonly section: string;
  readonly row: string;
  readonly fragments: readonly string[];
  readonly targets: readonly Target[];
}

/**
 * Every row of a table with an `Example` column. Its targets are its own `Targets` cell, or else
 * its section's: `(EVM)` or `(SVM)` in the heading, both otherwise.
 */
function exampleRows(text: string): ExampleRow[] {
  const rows: ExampleRow[] = [];
  let heading = "";
  let header: string[] | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("#")) heading = line;
    if (!line.startsWith("|")) {
      header = undefined;
      continue;
    }
    const row = cells(line);
    if (header === undefined) {
      header = row;
      continue;
    }
    if (row.every((cell) => /^:?-+:?$/.test(cell))) continue;
    const example = header.indexOf("Example");
    if (example < 0) continue;
    const claim = header.includes("Targets") ? row[header.indexOf("Targets")]! : heading;
    const targets: Target[] = /\bBoth\b/.test(claim)
      ? ["evm", "svm"]
      : /\bEVM\b/.test(claim) && !/\bSVM\b/.test(claim)
        ? ["evm"]
        : /\bSVM\b/.test(claim) && !/\bEVM\b/.test(claim)
          ? ["svm"]
          : ["evm", "svm"];
    rows.push({ section: heading, row: row[0]!, fragments: inlineCode(row[example]!), targets });
  }
  return rows;
}

/** A fragment as a pattern over a program: `…` is any code, and spacing is free. */
function fragmentPattern(fragment: string): RegExp {
  const parts = fragment
    .trim()
    .split(/(…)/)
    .map((part) =>
      part === "…"
        ? "[\\s\\S]*?"
        : part
            .trim()
            .split(/\s+/)
            .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("\\s*"),
    );
  return new RegExp(parts.join("\\s*"));
}

/** Every program the reference's examples may live in, with the targets it compiles on. */
function compiledPrograms(): { readonly source: string; readonly target: Target }[] {
  const programs: { source: string; target: Target }[] = [];
  for (const builtin of BUILTINS.builtins) {
    for (const target of builtin.targets) {
      programs.push({ source: builtin.example[target]!, target });
    }
  }
  for (const c of LANGUAGE_CASES.filter((c) => c.error === undefined)) {
    for (const target of c.targets) programs.push({ source: c.source, target });
  }
  return programs;
}

const programOf = (c: LanguageCase): Program => c;

describe("builtins.json", () => {
  it("documents every builtin once, with an example on each target it lists", () => {
    const names = BUILTINS.builtins.map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(68);
    for (const builtin of BUILTINS.builtins) {
      expect(builtin.targets.length).toBeGreaterThan(0);
      for (const target of builtin.targets) expect(builtin.example[target]).toBeDefined();
    }
  });

  describe.each(BUILTINS.builtins.map((b) => [b.name, b] as const))("%s", (_name, builtin) => {
    it.each(builtin.targets.map((t) => [t]))("compiles on %s", (target) => {
      const program = { source: builtin.example[target]!, contracts: builtin.contracts };
      expect(rejection(program, target)).toBeUndefined();
    });

    const unavailable = Object.entries(builtin.unavailable ?? {}) as [
      Target,
      { program: string; error: string },
    ][];
    if (unavailable.length > 0) {
      it.each(unavailable)("is rejected on %s", (target, { program, error }) => {
        const message = rejection({ source: program, contracts: builtin.contracts }, target);
        expect(message).toBeDefined();
        expect(plain(message!)).toContain(plain(error));
      });
    }
  });
});

describe("the language cases", () => {
  it.each(LANGUAGE_CASES.flatMap((c) => c.targets.map((t) => [c.name, t, c] as const)))(
    "%s (%s)",
    (_name, target, c) => {
      const message = rejection(programOf(c), target);
      if (c.error === undefined) expect(message).toBeUndefined();
      else {
        expect(message).toBeDefined();
        expect(plain(message!)).toContain(plain(c.error));
      }
    },
  );
});

describe("the reference", () => {
  it("is version-free and names no internal document", () => {
    expect(REFERENCE).not.toMatch(/\b\d+\.\d+\.\d+\b/);
    expect(REFERENCE).not.toMatch(/intrinsics\.json|gaps\.md|verification\.md/);
  });

  const rows = exampleRows(REFERENCE);
  const programs = compiledPrograms();

  it("has examples to check", () => {
    expect(rows.length).toBeGreaterThan(60);
  });

  it.each(rows.map((row) => [`${row.section} | ${row.row}`, row] as const))(
    "example compiles on each target it claims: %s",
    (_name, row) => {
      expect(row.fragments.length).toBeGreaterThan(0);
      for (const fragment of row.fragments) {
        const pattern = fragmentPattern(fragment);
        for (const target of row.targets) {
          const found = programs.some((p) => p.target === target && pattern.test(p.source));
          if (!found) throw new Error(`no ${target} program compiles \`${fragment}\``);
        }
      }
    },
  );

  // Every rejection the reference quotes, against every message the compiler gives for one.
  const messages = [
    ...BUILTINS.builtins.flatMap((b) =>
      Object.entries(b.unavailable ?? {}).map(([target, { program }]) =>
        rejection({ source: program, contracts: b.contracts }, target as Target),
      ),
    ),
    ...LANGUAGE_CASES.filter((c) => c.error !== undefined).flatMap((c) =>
      c.targets.map((target) => rejection(programOf(c), target)),
    ),
  ]
    .filter((message): message is string => message !== undefined)
    .map(plain);

  it.each(quotedErrors(REFERENCE).map((quote) => [quote]))(
    "the compiler gives the quoted error: %s",
    (quote) => {
      const pattern = quotePattern(quote);
      expect(messages.some((message) => pattern.test(message))).toBe(true);
    },
  );
});
