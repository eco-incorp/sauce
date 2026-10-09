/**
 * The generated half of the SauceScript declarations an editor loads for a program file
 * (`*.sauce.ts`) — the package's `./sauce-script` types export, `dist/sauce-script/index.d.ts`:
 *
 * - every chain as its chain id, with the `Portal` that opens an intent there and its namespaces
 *   (`chainId == Base`, `Base.hop({ … })`, `Base.UniswapV3.Factory`);
 * - every `<Namespace>_<Contract>` define a chain sets;
 * - every JSON ABI the SDK serves (`./artifacts/IERC20.json`, `./protocols/<slug>/<Export>.json`)
 *   as a module whose contract is typed from its ABI;
 * - every `@sauce/` library the SDK serves but `@sauce/token` (`@sauce/router`), as a module of
 *   its exported functions, typed from their own SauceScript annotations, and its exported classes
 *   (`@sauce/async`'s `Promise`) and values, whose members take and answer anything;
 * - then the catch-alls: another JSON ABI, another `@sauce/` library.
 *
 * The language itself — types, builtins, value methods, `@sauce/token` — is the hand-written
 * `sdk/sauce-script/builtins.d.ts`; the token symbols and the namespaces' contracts are
 * `routes/source-globals.generated.ts`'s own declarations, referenced rather than copied.
 *
 * ONE SOURCE for the names: `routes.sourceGlobals`, what `sauce globals` prints, over every
 * canonical chain, so an editor and the compile agree on what a program may name. Build tooling:
 * `scripts/gen-sauce-script-types.mjs` writes it, and nothing imports it at run time.
 */
import IERC20 from "../artifacts/IERC20.json" with { type: "json" };
import ISauceRouter from "../artifacts/ISauceRouter.json" with { type: "json" };
import { CANONICAL_CHAINS } from "../chains/canonical.js";
import { PROTOCOL_ABIS, STD_SOURCES } from "../embedded/sources.generated.js";
import type { AstNode } from "../routes/ast-walk.js";
import { parseSauce } from "../routes/parse.js";
import { sourceGlobals } from "../routes/source-globals.js";

interface AbiParameter {
  readonly name?: string;
  readonly type: string;
  readonly components?: readonly AbiParameter[];
}

interface AbiEntry {
  readonly type: string;
  readonly name?: string;
  readonly inputs?: readonly AbiParameter[];
  readonly outputs?: readonly AbiParameter[];
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED = new Set(
  (
    "break case catch class const continue debugger default delete do else enum export extends " +
    "false finally for function if import in instanceof new null return super switch this throw " +
    "true try typeof var void while with yield let static implements interface package private " +
    "protected public await"
  ).split(" "),
);

/** An ABI parameter as a SauceScript value: what a call takes (`input`), or returns. */
function valueType(parameter: AbiParameter, input: boolean): string {
  const array = /^(.*)\[\d*\]$/.exec(parameter.type);
  if (array) {
    const element = valueType({ ...parameter, type: array[1]! }, input);

    return input
      ? `(ReadonlyArray<${element}> | SauceArray<${element}>)`
      : `SauceArray<${element}>`;
  }
  if (/^(u?int\d*|address|bytes\d+)$/.test(parameter.type)) return input ? "SauceInt" : "bigint";
  if (parameter.type === "bool") return "boolean";
  if (/^(bytes|string)$/.test(parameter.type)) return input ? "SauceData" : "SauceBytes";
  if (parameter.type === "tuple") {
    const fields = parameter.components ?? [];
    if (fields.length === 0 || fields.some((field) => !IDENTIFIER.test(field.name ?? ""))) {
      return "any";
    }

    return `{ ${fields.map((field) => `readonly ${field.name}: ${valueType(field, input)}`).join("; ")} }`;
  }

  return "any";
}

/** What a method returns: one value, or the record of several, by position and by name. */
function resultType(outputs: readonly AbiParameter[]): string {
  if (outputs.length === 0) return "void";
  if (outputs.length === 1) return valueType(outputs[0]!, false);
  const tuple = `[${outputs.map((field) => valueType(field, false)).join(", ")}]`;
  const named = outputs.filter((field) => IDENTIFIER.test(field.name ?? ""));
  const unique = new Set(named.map((field) => field.name)).size === named.length;

  return named.length > 0 && unique
    ? `${tuple} & { ${named.map((field) => `readonly ${field.name}: ${valueType(field, false)}`).join("; ")} }`
    : tuple;
}

const paramName = (field: AbiParameter, index: number): string =>
  IDENTIFIER.test(field.name ?? "") && !RESERVED.has(field.name!) ? field.name! : `arg${index}`;

/** An ABI's functions as a bound contract's methods, each call's result catchable. */
function bindingType(abi: unknown): string {
  const entries = (
    Array.isArray(abi) ? abi : ((abi as { abi?: unknown[] }).abi ?? [])
  ) as AbiEntry[];
  const functions = entries.filter(
    (entry) => entry.type === "function" && IDENTIFIER.test(entry.name ?? ""),
  );
  if (functions.length === 0) return "SauceBinding";
  const methods = functions.map((method) => {
    const args = (method.inputs ?? [])
      .map((field, index) => `${paramName(field, index)}: ${valueType(field, true)}`)
      .join(", ");

    return `      ${method.name}(${args}): SauceCall<${resultType(method.outputs ?? [])}>;`;
  });

  return `{\n${methods.join("\n")}\n    }`;
}

/** A SauceScript annotation (`Address`, `Uint256[]`, `Account<Writable>`) as the declared type of a
 *  library function's parameter (`input`) or result. An unannotated parameter is a number. */
function annotatedType(annotation: string | undefined, input: boolean): string {
  if (annotation === undefined) return input ? "SauceInt" : "any";
  const type = annotation.trim();
  const array = /^(.*)\[\]$/.exec(type);
  if (array) {
    const element = annotatedType(array[1], input);

    return input
      ? `(ReadonlyArray<${element}> | SauceArray<${element}>)`
      : `SauceArray<${element}>`;
  }
  if (/^(Address|Uint256|u?int\d*|number|bigint)$/.test(type)) return input ? "SauceInt" : "bigint";
  if (/^(bool|boolean)$/.test(type)) return "boolean";
  if (/^(bytes|string)$/.test(type)) return input ? "SauceData" : "SauceBytes";
  if (/^Account\b/.test(type) || type === "void") return type;

  return "any";
}

/**
 * An exported class of a library, as the compiler runs it while it compiles: its constructor, its
 * methods and getters, static or not, each taking and answering anything, since the class works on
 * values the compiler knows rather than typed ones. A member whose name starts with `_`, and a
 * computed one (`[Symbol.dispose]`), is the class's own and left out.
 */
function classDeclaration(declared: AstNode): string {
  const members = ((declared.body as AstNode).body as AstNode[]).flatMap((member) => {
    const key = member.key as AstNode | undefined;
    const name = typeof key?.name === "string" ? key.name : undefined;
    if (member.type !== "MethodDefinition" || member.computed === true || name === undefined) {
      return [];
    }
    if (member.kind === "constructor") return ["    constructor(...args: any[]);"];
    if (name.startsWith("_")) return [];
    const statics = member.static === true ? "static " : "";
    if (member.kind === "get") return [`    ${statics}readonly ${name}: any;`];

    return [`    ${statics}${name}(...args: any[]): any;`];
  });

  return [
    `  export class ${(declared.id as AstNode).name as string} {`,
    "    [field: string]: any;",
    ...members,
    "  }",
  ].join("\n");
}

/**
 * The `@sauce/<name>` libraries the SDK serves, each as a module of its exported functions, every
 * target's arm merged (a function whose arms differ is overloaded). `@sauce/token` is left to
 * builtins.d.ts, which declares its functions as the globals a program calls with no import.
 */
function libraryModules(): string[] {
  const libraries = new Map<string, Set<string>>();
  for (const [path, source] of Object.entries(STD_SOURCES)) {
    const arm = /^([\w-]+)\/\1\.(evm|svm)\.js$/.exec(path);
    if (arm === null || arm[1] === "token") continue;
    const functions = libraries.get(arm[1]!) ?? new Set<string>();
    libraries.set(arm[1]!, functions);
    const annotation = (node: unknown): string | undefined => {
      const type = (node as { typeAnnotation?: AstNode } | undefined)?.typeAnnotation;

      return type === undefined ? undefined : source.slice(type.start, type.end);
    };
    for (const statement of (parseSauce(source) as unknown as { body: AstNode[] }).body) {
      const declared = statement.declaration as AstNode | undefined;
      if (statement.type === "ExportNamedDeclaration" && declared?.type === "ClassDeclaration") {
        functions.add(classDeclaration(declared));
        continue;
      }
      // An exported value (`export const Random = new RandomProtocol();`), which the compiler runs:
      // anything, as a class's members are.
      if (statement.type === "ExportNamedDeclaration" && declared?.type === "VariableDeclaration") {
        for (const declarator of declared.declarations as AstNode[]) {
          const id = declarator.id as AstNode;
          if (typeof id.name === "string") functions.add(`  export const ${id.name}: any;`);
        }
        continue;
      }
      if (statement.type !== "ExportNamedDeclaration" || declared?.type !== "FunctionDeclaration") {
        continue;
      }
      const params = (declared.params as AstNode[]).map(
        (param, index) =>
          `${typeof param.name === "string" ? param.name : `arg${index}`}: ` +
          annotatedType(annotation(param.typeAnnotation), true),
      );
      const result = annotatedType(annotation(declared.returnType), false);
      functions.add(
        `  export function ${(declared.id as AstNode).name as string}(${params.join(", ")}): ${result};`,
      );
    }
  }

  return [...libraries].flatMap(([name, functions]) => [
    `/** \`@sauce/${name}\`, a SauceScript library the package serves. */`,
    `declare module "@sauce/${name}" {`,
    ...[...functions].sort(),
    "}",
    "",
  ]);
}

/** The generated `index.d.ts`. */
export function sauceScriptDeclarations(): string {
  const namespaces = new Set<string>();
  const defines = new Set<string>();
  const tokens = new Set<string>();
  let chains: ReadonlyArray<{ readonly key: string }> = [];
  for (const chain of CANONICAL_CHAINS) {
    const globals = sourceGlobals(chain);
    chains = globals.chains;
    for (const ns of globals.protocols) namespaces.add(ns.namespace);
    for (const name of Object.keys(globals.defines)) defines.add(name);
    for (const token of globals.tokens) tokens.add(token.symbol);
  }
  const sources = 'import("../routes/source-globals.generated.js")';
  const served: Array<[string, unknown]> = [
    ["artifacts/IERC20.json", IERC20],
    ["artifacts/ISauceRouter.json", ISauceRouter],
    ...Object.entries(PROTOCOL_ABIS).map(([path, text]): [string, unknown] => [
      `protocols/${path}`,
      JSON.parse(text),
    ]),
  ];

  return [
    "// GENERATED by sdk/scripts/gen-sauce-script-types.mjs from the SDK's registries — do not",
    "// edit. SauceScript's names for an editor (builtins.d.ts is the language). A script: every",
    "// declaration in it is global.",
    '/// <reference path="./builtins.d.ts" />',
    '/// <reference path="../routes/source-globals.generated.d.ts" />',
    "",
    "/** A contract call's result; `.catch(() => …)` gives a value for when the call fails. */",
    "type SauceCall<R> = R & { catch<T>(handler: () => T): R | T };",
    "",
    "/** A contract an ABI types: its methods, called at an address. */",
    "interface SauceContractOf<B> {",
    "  at(address: SauceInt): B;",
    "  view(address: SauceInt): B;",
    "  lib(address: SauceInt): B;",
    "}",
    "",
    "/** Opening an intent on a chain, as a typed closure in a host file opens one too. */",
    `type SauceOpensIntent = ${sources}.SauceIntentChain;`,
    "",
    "/** A chain: its `hop` opens an intent there",
    " *  (`await Base.hop({ send: { token, amount }, receive: { token, amount }, refundee })`); its",
    " *  namespaces qualify an accessor to that chain (`Base.UniswapV3.Factory`). */",
    "interface SauceChain extends SauceOpensIntent {",
    ...[...namespaces].sort().map((ns) => `  readonly ${ns}: ${sources}.${ns}Source;`),
    "}",
    "",
    "/** A chain's name is its chain id, `chainId == Base` decided while compiling, and its members. */",
    ...chains.map((chain) => `declare const ${chain.key}: bigint & SauceChain;`),
    "",
    "/** A protocol contract's address on the chain a program is compiled for: a define. */",
    ...[...defines]
      .filter((name) => !tokens.has(name) && name !== "chainId" && name !== "CHAIN_ID")
      .sort()
      .map((name) => `declare const ${name}: bigint;`),
    "",
    ...served.flatMap(([path, abi]) => {
      const name = path
        .split("/")
        .pop()!
        .replace(/\.json$/, "");

      return [
        `declare module "*/${path}" {`,
        `  const ${name}: SauceContractOf<${bindingType(abi)}>;`,
        `  export default ${name};`,
        `  export { ${name} };`,
        "}",
      ];
    }),
    "",
    ...libraryModules(),
    // Last: of the patterns a specifier matches TypeScript takes the first declared, so these
    // catch only what no module above names.
    '/** A JSON ABI beside the program, imported as a contract: `import ERC20 from "./ERC20.json"`. */',
    'declare module "*.json" {',
    "  const contract: SauceContract;",
    "  export default contract;",
    "}",
    "",
    "/** A `@sauce/<name>` library these declarations do not describe: any import from it. */",
    'declare module "@sauce/*";',
    "",
  ].join("\n");
}
