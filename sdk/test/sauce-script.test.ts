/**
 * The SauceScript declarations an editor loads for a program file, and the plugin beside them,
 * through a real TypeScript language service set up as `sauce init`'s `programs/tsconfig.json`
 * sets it up: every program the package ships, and the three an agent wrote in a project of its own
 * (copied unchanged into `fixtures/sauce-script/demo`), check with no error at all — and a real
 * mistake in one still does not.
 *
 * The declarations are built here from the sources, as `scripts/gen-sauce-script-types.mjs` builds
 * them into `dist/`; the packed check runs the shipped ones, in an editor's own tsserver.
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { sauceScriptTsconfig } from "../src/cli/init.js";
import { sauceScriptDeclarations } from "../src/sauce-script/declarations.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SDK = join(HERE, "..");
const ROOT = join(SDK, "..");
const plugin = createRequire(import.meta.url)("../sauce-script/ts-plugin.cjs") as ((modules: {
  typescript: typeof ts;
}) => { create(info: { languageService: ts.LanguageService }): ts.LanguageService }) & {
  isFalsePositive(
    diagnostic: ts.Diagnostic,
    flatten: typeof ts.flattenDiagnosticMessageText,
  ): boolean;
};

const programs = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : programs(path);

    return name.endsWith(".sauce.ts") ? [path] : [];
  });

/** Every program the package ships, and the agent's three. */
const CORPUS = [
  ...programs(join(ROOT, "skills")),
  ...programs(join(ROOT, "docs")),
  ...programs(join(HERE, "fixtures/sauce-script/demo")),
];

let work: string;
let declarations: string;

beforeAll(() => {
  // The layout dist/ has: sauce-script/{index,builtins}.d.ts beside routes/.
  work = mkdtempSync(join(tmpdir(), "sauce-script-"));
  mkdirSync(join(work, "sauce-script"));
  mkdirSync(join(work, "routes"));
  declarations = join(work, "sauce-script/index.d.ts");
  writeFileSync(declarations, sauceScriptDeclarations());
  copyFileSync(join(SDK, "sauce-script/builtins.d.ts"), join(work, "sauce-script/builtins.d.ts"));
  copyFileSync(
    join(SDK, "src/routes/source-globals.generated.ts"),
    join(work, "routes/source-globals.generated.d.ts"),
  );
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A language service over `files` with `programs/tsconfig.json`'s options, the plugin applied
 *  (`withPlugin`) as tsserver applies it. */
function service(files: Readonly<Record<string, string>>, withPlugin = true): ts.LanguageService {
  const config = sauceScriptTsconfig("@eco-incorp/sauce").compilerOptions as Record<
    string,
    unknown
  >;
  // The declarations are a root here; a project resolves them through the package's exports.
  const { options, errors } = ts.convertCompilerOptionsFromJson({ ...config, types: [] }, work);
  expect(errors).toEqual([]);
  const roots = [declarations, ...Object.keys(files)];
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => roots,
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) => {
      const text = files[name] ?? (ts.sys.fileExists(name) ? ts.sys.readFile(name) : undefined);

      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => work,
    getDefaultLibFileName: (settings) => ts.getDefaultLibFilePath(settings),
    fileExists: (name) => name in files || ts.sys.fileExists(name),
    readFile: (name) => files[name] ?? ts.sys.readFile(name),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const languageService = ts.createLanguageService(host);

  return withPlugin ? plugin({ typescript: ts }).create({ languageService }) : languageService;
}

const report = (languageService: ts.LanguageService, file: string): string[] =>
  [
    ...languageService.getSyntacticDiagnostics(file),
    ...languageService.getSemanticDiagnostics(file),
  ].map((diagnostic) => {
    const where =
      diagnostic.file === undefined
        ? ""
        : `:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1}`;

    return `${file.slice(ROOT.length + 1)}${where} TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
  });

const textOf = (paths: readonly string[]): Record<string, string> =>
  Object.fromEntries(paths.map((path) => [path, readFileSync(path, "utf8")]));

describe("SauceScript in an editor", () => {
  it("checks every shipped program, and the agent's three, with no error", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(14);
    const checked = service(textOf(CORPUS));
    expect(CORPUS.flatMap((file) => report(checked, file))).toEqual([]);
    expect(checked.getProgram()!.getGlobalDiagnostics()).toEqual([]);
  });

  it("needs the plugin only for what no declaration can say, and it removes nothing else", () => {
    const bare = service(textOf(CORPUS), false);
    const left = CORPUS.flatMap((file) => bare.getSemanticDiagnostics(file));
    expect(left.length).toBeGreaterThan(0);
    // Each is a bigint index, a number beside a bigint, or an undeclared define — and the plugin
    // says so of every one.
    for (const diagnostic of left) {
      expect([2538, 2365, 2367, 2322, 2345, 2304, 2552]).toContain(diagnostic.code);
      expect(plugin.isFalsePositive(diagnostic, ts.flattenDiagnosticMessageText)).toBe(true);
    }
  });

  it("checks every builtin's example in the SauceScript reference with no error", () => {
    const reference = JSON.parse(
      readFileSync(join(ROOT, "skills/sauce-script/references/builtins.json"), "utf8"),
    ) as {
      intrinsics: Array<{ name: string; example: Partial<Record<"evm" | "svm", string>> }>;
    };
    const examples = Object.fromEntries(
      reference.intrinsics.flatMap(({ name, example }, index) =>
        Object.entries(example).map(([target, text]) => [
          join(work, `builtin-${index}-${target}.sauce.ts`),
          `// ${name} (${target})\n${text}\n`,
        ]),
      ),
    );
    expect(Object.keys(examples).length).toBeGreaterThan(reference.intrinsics.length);
    const checked = service(examples);
    const shown = Object.keys(examples).flatMap((file) =>
      checked
        .getSemanticDiagnostics(file)
        .map(
          (d) =>
            `${examples[file]!.split("\n")[0]} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`,
        ),
    );
    expect(shown).toEqual([]);
  });

  it("declares every function @sauce/token exports, on either arm, and nothing it does not", () => {
    const exported = (file: string): string[] =>
      [
        ...readFileSync(join(SDK, "src/std/token", file), "utf8").matchAll(
          /^export function (\w+)/gm,
        ),
      ].map((match) => match[1]!);
    const library = [...new Set([...exported("token.evm.js"), ...exported("token.svm.js")])].sort();
    const builtins = readFileSync(join(SDK, "sauce-script/builtins.d.ts"), "utf8");
    const module = /declare module "@sauce\/token" \{([^}]*)\}/.exec(builtins)![1]!;
    const declared = [...module.matchAll(/export const (\w+)/g)].map((match) => match[1]!).sort();
    expect(declared).toEqual(library);
    // And each is the global a program calls with no import.
    for (const name of library) expect(builtins).toContain(`declare function ${name}(`);
  });

  it("still reports a real mistake: a misspelled builtin, a wrong argument count, an unknown method", () => {
    const program = (name: string, body: string): Record<string, string> => ({
      [join(work, `${name}.sauce.ts`)]: body,
    });
    // A property that does not exist: TS2339, or TS2551 when TypeScript has a name to suggest.
    const missing = [2339, 2551];
    const cases: Array<[string, string, readonly number[]]> = [
      ["slef", "function main() { const me = ctx.slef(); }\n", missing],
      ["mulDiv", "function main() { const x = Math.mulDiv(1n, 2n); }\n", [2554]],
      ["getPol", "function main() { UniswapV3.Factory.getPol(1n, 2n, 3n); }\n", missing],
      [
        "swapV9",
        'import { ISauceRouter } from "./artifacts/ISauceRouter.json";\nfunction main() { ISauceRouter.at(ctx.self()).swapV9(); }\n',
        missing,
      ],
      ["lowercase", "function main() { require(recipent != 0n); }\n", [2304, 2552]],
      ["require", "function main() { require(); }\n", [2554]],
      [
        "router",
        'import { uniswapV3 } from "@sauce/router";\nfunction main() { uniswapV3(1n, 2n); }\n',
        [2554],
      ],
      [
        "routerName",
        'import { uniswapV9 } from "@sauce/router";\nfunction main() { uniswapV9(); }\n',
        [2305, 2724],
      ],
      ["send", "Base.Portal.sends({ token: USDC, amount: 1n }).then(() => {});\n", missing],
      ["then", "Base.Portal.send({ token: USDC, amount: 1n }).than(() => {});\n", missing],
    ];
    for (const [name, body, codes] of cases) {
      const files = program(name, body);
      const reported = service(files)
        .getSemanticDiagnostics(Object.keys(files)[0]!)
        .map((diagnostic) => diagnostic.code);
      expect([name, reported.some((code) => codes.includes(code))]).toEqual([name, true]);
    }
  });
});
