/**
 * `lexical-scope.ts`: where a name the program declares is its own, as the compiler scopes it.
 */
import { walk, type AstNode } from "../src/routes/ast-walk.js";
import { shadowed, walkScoped } from "../src/routes/lexical-scope.js";
import { parseSauce } from "../src/routes/parse.js";

/** For each read of `name` in `source`, in order: whether the program declares it there. */
function owned(source: string, name: string): boolean[] {
  const program = parseSauce(source);
  const bindings = new Set<AstNode>();
  walk(program, (n) => {
    if (n.type === "VariableDeclarator") bindings.add(n.id as AstNode);
    if (n.type === "CatchClause" && n.param) bindings.add(n.param as AstNode);
    for (const param of (n.params as AstNode[] | undefined) ?? []) bindings.add(param);
    if (n.type === "FunctionDeclaration" && n.id) bindings.add(n.id as AstNode);
    if (n.type === "ImportSpecifier") bindings.add(n.local as AstNode);
  });
  const reads: [number, boolean][] = [];
  walkScoped(program, (n, at) => {
    if (n.type === "Identifier" && n.name === name && !bindings.has(n)) {
      reads.push([n.start, shadowed(at, name, n.start)]);
    }
  });
  return reads.sort(([a], [b]) => a - b).map(([, own]) => own);
}

describe("lexical scope: where a declared name is the program's", () => {
  it("a module's declaration, everywhere in the module, in any order", () => {
    expect(owned("function main() { return x; }\nconst x = 1;", "x")).toEqual([true]);
    expect(owned("function main() { return x(); }\nfunction x() { return 1; }", "x")).toEqual([
      true,
    ]);
    expect(owned('import { x } from "./m.js";\nfunction main() { return x; }', "x")).toEqual([
      true,
    ]);
  });

  it("a parameter, everywhere in its function and nowhere else", () => {
    expect(owned("function f(x) { return x; }\nfunction g() { return x; }", "x")).toEqual([
      true,
      false,
    ]);
    expect(owned("function f() { const g = (x) => x; return x; }", "x")).toEqual([true, false]);
  });

  it("a block's let or const, from the end of its declarator to the end of the block", () => {
    expect(
      owned(
        "function main(c) { if (c) { const y = x; const x = y + x; return x; } return x; }",
        "x",
      ),
    ).toEqual([false, false, true, false]);
    expect(owned("function main() { { let x = 1; x = x + 1; } return x; }", "x")).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("a function a block declares, everywhere in the block", () => {
    expect(owned("function main() { { y(x); function x() {} } return x; }", "x")).toEqual([
      true,
      false,
    ]);
  });

  it("a for (let …) binding, in the whole loop", () => {
    expect(
      owned("function main() { for (let x = 0; x < 3; x++) { t(x); } return x; }", "x"),
    ).toEqual([true, true, true, false]);
  });

  it("a for … of or for … in binding, in the body only", () => {
    expect(owned("function main() { for (const x of x) { t(x); } return x; }", "x")).toEqual([
      false,
      true,
      false,
    ]);
    expect(owned("function main() { for (const x in x) { t(x); } return x; }", "x")).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("a catch clause's parameter, in its body only", () => {
    expect(owned("function main() { try { t(x); } catch (x) { t(x); } return x; }", "x")).toEqual([
      false,
      true,
      false,
    ]);
  });
});
