/**
 * A compile failure, reported against the file the developer wrote.
 *
 * The compiler never sees that file. It sees the program after the SDK's passes — a bare body
 * wrapped in `main`, token and protocol syntax lowered, `@sauce/token` imports prepended — under
 * the entry name `main.js`. So its `--> main.js:5:15` names a line of a text nobody has open. This
 * maps each location back to the file where the line it quotes is still that file's own line, and
 * says so plainly where the SDK rewrote the line itself.
 */
import type { CanonicalChain } from "../chains/canonical.js";
import { wrapSauceBody } from "../routes/sauce-route.js";
import { knownTokenSymbols } from "../routes/token-registry.js";

/** The entry name `rs-compile.ts` compiles every route program under. */
const ENTRY = "main.js";
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/** `error`, a failure of compiling `text` (read from `file`) for `chain`, as a message about `file`. */
export function describeCompileError(
  error: unknown,
  file: string,
  text: string,
  chain: CanonicalChain,
): string {
  const message = (error instanceof Error ? error.message : String(error)).replace(ANSI, "");
  const loc = (error as { loc?: { line?: unknown; column?: unknown } } | null)?.loc;
  if (error instanceof SyntaxError && typeof loc?.line === "number") {
    return syntaxError(message, loc.line, Number(loc.column ?? 0), file, text);
  }

  return withHints(relocate(message, file, text), text, chain);
}

/**
 * The SDK's rewrites parse the program as JavaScript first, and that parse reports
 * `Unexpected token (3:10)` against the wrapped program. Only the wrapper moves lines before that
 * parse, so the file's own position is one line up exactly when the file is a bare body.
 */
function syntaxError(
  message: string,
  wrappedLine: number,
  column: number,
  file: string,
  text: string,
): string {
  const wrapped = wrapSauceBody(text) !== text;
  const line = wrapped ? wrappedLine - 1 : wrappedLine;
  const quoted = text.split(/\r?\n/)[line - 1];
  const reason = message.replace(/\s*\(\d+:\d+\)$/, "");
  const gutter = " ".repeat(String(line).length);
  const report =
    quoted === undefined
      ? [`error: ${reason}`, ` --> ${file}:${line}:${column + 1}`]
      : [
          `error: ${reason}`,
          `${gutter}--> ${file}:${line}:${column + 1}`,
          `${gutter} |`,
          `${line} | ${quoted}`,
          `${gutter} | ${" ".repeat(column)}^`,
        ];
  // The one syntax error the wrapper itself causes: an import in a bare body ends up inside `main`.
  if (wrapped && /'import' and 'export' may only appear at the top level/.test(reason)) {
    report.push(
      "hint: a file that imports must declare function main() rather than be a bare body",
    );
  }

  return report.join("\n");
}

const ARROW = new RegExp(`^(\\s*-->\\s*)${ENTRY.replace(".", "\\.")}:(\\d+):(\\d+)$`);
/** A quoted source line: indent, line number, text. */
const GUTTER = /^(\s*)(\d+) \| ?(.*)$/;
/** The marker line under it: the bar, the padding to the column, the carets, any label. */
const CARET = /^(\s*\| ?)( *)(\^+)(.*)$/;

/** Where a diagnostic's location lands in the file, and the file's text of that line when the
 *  diagnostic quoted the SDK's rewrite of it instead. */
interface Site {
  readonly line: number;
  readonly column: number;
  readonly text?: string;
}

/**
 * Each `--> main.js:L:C` becomes `--> <file>:L':C'`, with the quoted lines under it renumbered —
 * and, where the SDK rewrote the quoted line, replaced by the file's own line with the marker moved
 * onto the same text there. A location that cannot be placed keeps its `main.js` name, with a note
 * saying what that is.
 */
function relocate(message: string, file: string, text: string): string {
  const lines = message.split("\n");
  const own = text.split(/\r?\n/).map((line) => line.trimEnd());
  let unmapped = false;

  for (let i = 0; i < lines.length; i++) {
    const arrow = ARROW.exec(lines[i]!);
    if (arrow === null) continue;
    const line = Number(arrow[2]);
    const column = Number(arrow[3]);
    const quoted = quotedAt(lines, i, line);
    const site = quoted === undefined ? undefined : locate(own, lines, quoted, line, column);
    if (site === undefined) {
      unmapped = true;
      continue;
    }
    lines[i] = `${arrow[1]}${file}:${site.line}:${site.column}`;
    for (let j = i + 1; j < lines.length && !ARROW.test(lines[j]!); j++) {
      const gutter = GUTTER.exec(lines[j]!);
      if (gutter === null) continue;
      const number = Number(gutter[2]) + site.line - line;
      const body = j === quoted && site.text !== undefined ? site.text : gutter[3];
      lines[j] = `${renumber(gutter[1]!, gutter[2]!, number)} | ${body}`;
      const caret = j === quoted && site.text !== undefined ? CARET.exec(lines[j + 1] ?? "") : null;
      if (caret !== null) {
        lines[j + 1] = `${caret[1]}${" ".repeat(site.column - 1)}${caret[3]}${caret[4]}`;
      }
    }
  }
  if (unmapped) {
    lines.push(
      `note: ${ENTRY} is ${file} as the SDK rewrote it (a bare body wrapped in main, token, ` +
        "protocol and intent syntax lowered, imports added), and the line above is one of those " +
        "rewrites rather than a line of the file.",
    );
  }

  return lines.join("\n");
}

/** `number` in the gutter `indent` + `old` occupied, keeping the bar where it was. */
function renumber(indent: string, old: string, number: number): string {
  const digits = String(number);

  return `${indent.slice(0, Math.max(0, indent.length - (digits.length - old.length)))}${digits}`;
}

/** The index of the line quoting source line `line`, among the lines following the arrow at `at`. */
function quotedAt(lines: readonly string[], at: number, line: number): number | undefined {
  for (let j = at + 1; j < lines.length && !ARROW.test(lines[j]!); j++) {
    const gutter = GUTTER.exec(lines[j]!);
    if (gutter !== null && Number(gutter[2]) === line) return j;
  }

  return undefined;
}

const NAME = /[A-Za-z_$][\w$]*/g;
const MULTILINE = /^[/|] /;

/** Where `needle` occurs in `text` as a whole token — not inside a longer name. */
function occurrences(text: string, needle: string): number[] {
  const found: number[] = [];
  const isName = (ch: string | undefined): boolean => ch !== undefined && /[\w$]/.test(ch);
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    const whole =
      !(isName(needle[0]) && isName(text[at - 1])) &&
      !(isName(needle[needle.length - 1]) && isName(text[at + needle.length]));
    if (whole) found.push(at);
  }

  return found;
}

/**
 * Where the rewritten `line`:`column` is in the file. The SDK only ever adds lines AHEAD of the
 * file's own, so the answer is at or before `line`:
 *
 *   1. the quoted line is still a line of the file — the nearest such line, same column;
 *   2. the SDK rewrote it (`USDC.transfer(to, x)` became `__sauce_transfer(USDC, to, x)`) — the
 *      marked text, found exactly once on the file's line sharing the most names with the quoted
 *      one. A tie is not guessed at.
 */
function locate(
  own: readonly string[],
  lines: readonly string[],
  quoted: number,
  line: number,
  column: number,
): Site | undefined {
  const body = GUTTER.exec(lines[quoted]!)![3]!.trimEnd();
  // A span over several lines draws its left edge in front of the source: `/ ` opens it and `| `
  // continues it, so the quoted source starts two columns in.
  const spanned = MULTILINE.test(body);
  const text = spanned ? body.slice(2) : body;
  if (text.trim() === "") return undefined;
  const exact = own.flatMap((ownText, index) =>
    ownText === text && index < line ? [index + 1] : [],
  );
  if (exact.length > 0) return { line: exact[exact.length - 1]!, column };
  if (spanned) return undefined;

  const caret = CARET.exec(lines[quoted + 1] ?? "");
  if (caret === null) return undefined;
  const marked = text.slice(column - 1, column - 1 + caret[3]!.length);
  if (!/[\w$]/.test(marked)) return undefined;
  const names = new Set(text.match(NAME));
  const candidates = own.flatMap((ownText, index) => {
    const at = occurrences(ownText, marked);
    if (index >= line || at.length !== 1) return [];
    const shared = [...new Set(ownText.match(NAME))].filter((name) => names.has(name)).length;

    return [{ line: index + 1, column: at[0]! + 1, text: ownText, shared }];
  });
  const best = Math.max(...candidates.map((candidate) => candidate.shared));
  const winners = candidates.filter((candidate) => candidate.shared === best);

  return winners.length === 1
    ? { line: winners[0]!.line, column: winners[0]!.column, text: winners[0]!.text }
    : undefined;
}

/** What to pass the command for a failure whose SDK message names an API option instead. */
const HINTS: ReadonlyArray<readonly [RegExp, (match: RegExpExecArray) => string]> = [
  [/needs a `deadline`/, () => "pass --intent-deadline <unix seconds>"],
  [/needs a `creator`/, () => "pass --intent-creator <address>"],
  [/`intents\.executionFee`/, () => "pass --intent-execution-fee <wei>"],
  [
    /`([A-Za-z_$][\w$]*)` is not a declared variable/,
    (match) => `if ${match[1]} is a value you supply, pass --define ${match[1]}=<value>`,
  ],
];

/** `SYM.transfer(`-shaped uses: the token syntax, which only a registered symbol takes. */
const TOKEN_USE =
  /(?<![\w$.])([A-Z][A-Z0-9]*)\s*\.\s*(?:transfer|transferFrom|approve|balanceOf)\s*\(/g;

/**
 * Token syntax on a symbol the chain does not register reaches the compiler as a method call on an
 * undeclared name, and fails as one. Name the actual cause: which symbols the chain has, and how to
 * spell a token it does not.
 */
function unregisteredTokens(text: string, chain: CanonicalChain): string[] {
  if (chain.kind !== "evm") return [];
  const known = new Set(knownTokenSymbols(chain));
  const declared = (name: string): boolean =>
    new RegExp(`\\b(?:const|let|var|function|import)\\b[^;\\n]*\\b${name}\\b`).test(text);
  const unknown = [...new Set([...text.matchAll(TOKEN_USE)].map((match) => match[1]!))].filter(
    (symbol) => !known.has(symbol) && !declared(symbol),
  );

  return unknown.map(
    (symbol) =>
      `${symbol} is not a registered token on ${chain.slug} (it has ${[...known].join(", ") || "none"}): ` +
      `write Token(${symbol}_ADDRESS).transfer(…) and pass --define ${symbol}_ADDRESS=0x…`,
  );
}

function withHints(message: string, text: string, chain: CanonicalChain): string {
  const hints = [
    ...HINTS.flatMap(([pattern, hint]) => {
      const match = pattern.exec(message);

      return match === null ? [] : [hint(match)];
    }),
    ...unregisteredTokens(text, chain),
  ];

  return [message, ...hints.map((hint) => `hint: ${hint}`)].join("\n");
}
