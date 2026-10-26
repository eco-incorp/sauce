/**
 * `lexical-scope.ts`: where a name the program declares is its own, as the compiler scopes it.
 */
import { collectPatternBinders, walk, type AstNode } from "../src/routes/ast-walk.js";
import { bindingOf, shadowed, walkScoped } from "../src/routes/lexical-scope.js";
import { parseSauce } from "../src/routes/parse.js";

/** For each read of `name` in `source`, in order: whether the program declares it there. */
function owned(source: string, name: string): boolean[] {
  const program = parseSauce(source);
  const bindings = new Set<AstNode>();
  const bind = (node: AstNode): void => {
    bindings.add(node);
  };
  walk(program, (n) => {
    if (n.type === "VariableDeclarator") collectPatternBinders(n.id, bind);
    if (n.type === "CatchClause") collectPatternBinders(n.param, bind);
    for (const param of (n.params as AstNode[] | undefined) ?? [])
      collectPatternBinders(param, bind);
    if (n.type === "FunctionDeclaration" && n.id) bind(n.id as AstNode);
    if (n.type === "ImportSpecifier") bind(n.local as AstNode);
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

  it("a destructured element, from the end of its declarator, never its default or source", () => {
    expect(
      owned("function main(t) { if (t) { const [a, x] = x; return x; } return x; }", "x"),
    ).toEqual([false, true, false]);
    expect(owned("function main(t) { const [x = x] = t; return x; }", "x")).toEqual([false, true]);
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

/** For each read of `name` in `source`, in order: the line the binder it reads is declared on. */
function binders(source: string, name: string): (number | undefined)[] {
  const program = parseSauce(source);
  const declared = new Set<AstNode>();
  walk(program, (n) => {
    if (n.type === "VariableDeclarator") collectPatternBinders(n.id, (id) => declared.add(id));
    if (n.type === "CatchClause") collectPatternBinders(n.param, (id) => declared.add(id));
    for (const param of (n.params as AstNode[] | undefined) ?? [])
      collectPatternBinders(param, (id) => declared.add(id));
    if (n.type === "FunctionDeclaration" && n.id) declared.add(n.id as AstNode);
  });
  const reads: [number, number | undefined][] = [];
  walkScoped(program, (n, at) => {
    if (n.type !== "Identifier" || n.name !== name || declared.has(n)) return;
    const binder = bindingOf(at, name, n.start);
    reads.push([
      n.start,
      binder === undefined ? undefined : source.slice(0, binder.start).split("\n").length,
    ]);
  });
  return reads.sort(([a], [b]) => a - b).map(([, line]) => line);
}

describe("lexical scope: which binding a read is of", () => {
  it("names the nearest declaration: a loop's binding over the parameter it shares its name with", () => {
    const source = [
      "function main(a, legs) {", // 1
      "  const x = a;", // 2
      "  for (const a of legs) {", // 3
      "    x(a);", // 4
      "  }", // 5
      "  return a;", // 6
      "}", // 7
    ].join("\n");
    expect(binders(source, "a")).toEqual([1, 3, 1]);
    expect(binders(source, "legs")).toEqual([1]);
  });

  it("is undefined for a name nothing declares there, and for another function's parameter", () => {
    expect(binders("function f(x) { return x; }\nfunction g() { return x; }", "x")).toEqual([
      1,
      undefined,
    ]);
  });

  it("tells apart two bindings of one name in sibling and nested blocks", () => {
    const source = [
      "function main(c) {", // 1
      "  if (c) {", // 2
      "    const p = 1;", // 3
      "    t(p);", // 4
      "  } else {", // 5
      "    const p = 2;", // 6
      "    t(p);", // 7
      "  }", // 8
      "}", // 9
    ].join("\n");
    expect(binders(source, "p")).toEqual([3, 6]);
  });
});
