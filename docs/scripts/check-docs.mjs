import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageArgument = process.argv.indexOf("--package-root");
if (packageArgument >= 0 && !process.argv[packageArgument + 1]) {
  throw new Error("--package-root requires an installed package directory");
}
const root = packageArgument < 0 ? repository : resolve(process.argv[packageArgument + 1]);
function markdownFiles(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? markdownFiles(child) : entry.name.endsWith(".md") ? [child] : [];
  });
}
const manual = [
  "README.md",
  ...(packageArgument < 0
    ? ["CLAUDE.md", "sdk/README.md", "actions/README.md", "dev-tools/README.md"]
    : []),
  "docs/README.md",
].map((path) => join(root, path));
// The agent skills ship in the package, and link to their own supporting files.
manual.push(...markdownFiles(join(root, "skills")));
for (const directory of ["concepts", "guides", "api", "examples"]) {
  manual.push(...markdownFiles(join(root, "docs", directory)));
}
const failures = [];
for (const file of manual) {
  const content = readFileSync(file, "utf8").replace(/```[^]*?```/g, "");
  for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].replace(/^<|>$/g, "");
    // Documentation links stay relative so they render in the repository, on the npm page and
    // inside the published tarball. An absolute URL back into this repository pins a branch and
    // breaks the tarball copy, so it is rejected even once the repository is public.
    if (/^https:\/\/github\.com\/eco-incorp\/sauce\/(blob|tree)\/[^/]+\/docs\//.test(target)) {
      failures.push(
        `${file}: link to documentation by relative path, not by repository URL: ${target}`,
      );
    }
    if (/^[a-z]+:/i.test(target)) continue;
    const [path, fragment] = target.split(/[?#]/);
    const destination = path ? resolve(dirname(file), decodeURIComponent(path)) : file;
    if (!existsSync(destination)) {
      failures.push(`${file}: ${target}`);
      continue;
    }
    if (fragment && destination.endsWith(".md")) {
      const headings = [...readFileSync(destination, "utf8").matchAll(/^#{1,6}\s+(.+)$/gm)].map(
        (heading) =>
          heading[1]
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s_-]/gu, "")
            .replace(/\s/g, "-"),
      );
      if (!headings.includes(decodeURIComponent(fragment))) failures.push(`${file}: ${target}`);
    }
  }
}
if (failures.length) throw new Error(`Broken manual links:\n${failures.join("\n")}`);
console.log(`Manual links: ${manual.length} files checked`);

const examples = join(root, "docs/examples");
// `.sauce.ts` files are SauceScript, not TypeScript: they are compiled by the Sauce compiler from
// the `.ts` example beside them, never by tsc, and running them through Node would be meaningless.
const sources = readdirSync(examples)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".sauce.ts"))
  .sort();

// A SauceScript example must be the SAME TEXT the README shows. Nothing else checks this: the
// README's TypeScript fences are extracted, compiled and run below, but a ```js fence is not, so a
// program quoted by hand could drift from the file that is actually compiled.
const sauceExamples = readdirSync(examples).filter((name) => name.endsWith(".sauce.ts"));
// Quoted somewhere in the manual, not only the README: a guide's ```js fence is just as able to
// drift from the file that actually compiles, and just as unchecked otherwise.
const quotable = [join(root, "README.md"), ...manual.filter((file) => file.endsWith(".md"))].map(
  (file) => readFileSync(file, "utf8"),
);
for (const name of sauceExamples) {
  const body = readFileSync(join(examples, name), "utf8").trim();
  if (!quotable.some((text) => text.includes(body))) {
    throw new Error(
      `No manual page contains docs/examples/${name} verbatim — quote the file, do not retype it`,
    );
  }
}
console.log(`SauceScript examples: ${sauceExamples.length} quoted verbatim in the manual`);
// Keep examples under the package so Node resolves its public self-reference exports.
const temporary = mkdtempSync(join(root, ".sauce-doc-examples-"));
const input = join(temporary, "src");
const output = join(temporary, "dist");
try {
  mkdirSync(input);
  for (const source of sources) {
    writeFileSync(join(input, source), readFileSync(join(examples, source)));
  }
  const readmeExamples = [
    ...readFileSync(join(root, "README.md"), "utf8").matchAll(/```ts\n([^]*?)```/g),
  ];
  if (!readmeExamples.length) throw new Error("README is missing its TypeScript example");
  for (const [index, example] of readmeExamples.entries()) {
    const source = `readme-${index + 1}.ts`;
    writeFileSync(join(input, source), example[1]);
    sources.push(source);
  }
  execFileSync(
    process.execPath,
    [
      createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"),
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--strict",
      "--skipLibCheck",
      "--rootDir",
      input,
      "--outDir",
      output,
      ...sources.map((name) => join(input, name)),
    ],
    { cwd: root, stdio: "inherit" },
  );
  // A `.ts` example reads its SauceScript sibling by a path relative to itself, exactly as it would
  // in an installed package, so the sibling has to sit beside the COMPILED file too.
  for (const name of sauceExamples) {
    writeFileSync(join(output, name), readFileSync(join(examples, name)));
  }
  for (const source of sources) {
    execFileSync(process.execPath, [join(output, source.replace(/\.ts$/, ".js"))], {
      cwd: root,
      stdio: "inherit",
    });
  }
  console.log(`Executable examples: ${sources.length} typechecked and passed`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
