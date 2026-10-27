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
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { versionTableOf } from "../../sdk/scripts/lib/sdk-releases.mjs";
import {
  defineFlagProblems,
  executedExamplesProblems,
  inputProblems,
  namedProgramProblems,
  registryNames,
} from "./example-programs.mjs";
import { bigintLiteralProblems } from "./integer-literals.mjs";
import {
  DEPLOYMENTS_PAGE,
  releaseAddresses,
  releaseAddressProblems,
} from "./release-addresses.mjs";
import { simulateWordingProblems } from "./simulate-wording.mjs";

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
  "docs/changelog.md",
].map((path) => join(root, path));
// The changelog is a page of the manual like any other: its links, fragments and fenced integers are
// checked with the rest, and it is held to the releases below.
if (!existsSync(join(root, "docs/changelog.md"))) {
  throw new Error("docs/changelog.md: missing; the manual records every release in its changelog");
}
// The agent skills ship in the package, and link to their own supporting files.
manual.push(...markdownFiles(join(root, "skills")));
for (const directory of ["concepts", "guides", "api", "reference", "examples"]) {
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
// The LiteSVM the testing guide installs is the one the testing kit takes: the package's pin.
{
  const pin = JSON.parse(readFileSync(join(root, "sdk/runtime/package.json"), "utf8")).dependencies
    .litesvm;
  const guide = readFileSync(join(root, "docs/guides/testing.md"), "utf8");
  const named = [...guide.matchAll(/litesvm@(\S+)/g)].map((match) => match[1]);
  if (named.length === 0 || named.some((version) => version !== pin)) {
    throw new Error(
      `docs/guides/testing.md installs litesvm@${named.join(", litesvm@")}; the package pins ${pin}`,
    );
  }
}
// No page teaches a define: `--define` and `--defines` are the command's low-level flags, and a value
// a reader supplies is a `main` argument (`example-programs.mjs`). The manual and its examples; the
// skills are skills:check's.
{
  const taught = [
    join(root, "README.md"),
    join(root, "docs/README.md"),
    join(root, "docs/changelog.md"),
    ...["concepts", "guides", "api", "examples"].flatMap((directory) =>
      markdownFiles(join(root, "docs", directory)),
    ),
    ...readdirSync(join(root, "docs/examples"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => join(root, "docs/examples", name)),
  ].flatMap((file) =>
    defineFlagProblems({ where: file.slice(root.length + 1), text: readFileSync(file, "utf8") }),
  );
  if (taught.length) throw new Error(`Low-level flags taught:\n${taught.join("\n")}`);
}
// A run with no key and nothing sent is a simulation, and the manual says so
// (`simulate-wording.mjs`): the README, every page and every example. The skills are skills:check's.
{
  const pages = [
    join(root, "README.md"),
    ...markdownFiles(join(root, "docs")),
    ...readdirSync(join(root, "docs/examples"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => join(root, "docs/examples", name)),
  ];
  const problems = pages.flatMap((file) =>
    simulateWordingProblems({
      where: relative(root, file).split("\\").join("/"),
      text: readFileSync(file, "utf8"),
    }),
  );
  if (problems.length) throw new Error(`Simulate, never rehearse:\n${problems.join("\n")}`);
  console.log(`Wording: ${pages.length} files say simulate`);
}

// ---- The manual's shape: one place per fact, and a reader never sent into the skills ----------------
// The skills are written for agents and carry their own copy of every fact; the manual carries the
// reader's. Each stands alone, so the manual never links into `skills/` (and the skills checker
// refuses the reverse). `docs/reference/` is generated from the same registries as the skills'
// references; the hand-written pages are each listed once in the index, and none is only links.
{
  const docs = join(root, "docs");
  const page = (file) => relative(root, file).split("\\").join("/");
  const prose = (file) => readFileSync(file, "utf8").replace(/```[^]*?```/g, "");
  const links = (file) =>
    [...prose(file).matchAll(/\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)]
      .map(([, label, target]) => ({ label, target: target.replace(/^<|>$/g, "") }))
      .filter(({ target }) => !/^[a-z]+:/i.test(target))
      .map(({ label, target }) => {
        const path = target.split(/[?#]/)[0];

        return {
          label,
          to: path ? page(resolve(dirname(file), decodeURIComponent(path))) : page(file),
        };
      });
  const shape = [];
  const readerPages = [join(root, "README.md"), ...markdownFiles(docs)];
  for (const file of readerPages) {
    for (const { to } of links(file))
      if (to.startsWith("skills/"))
        shape.push(`${page(file)}: links ${to}; the manual never sends a reader into skills/`);
    for (const [span] of prose(file).matchAll(/`(?:\.\.\/)*skills\/[^`]*`/g))
      shape.push(
        `${page(file)}: names the path ${span}; the manual never sends a reader into skills/`,
      );
  }
  // The generated reference is reached from its own indexes; every other page is in the index once.
  const generated = (path) => /^docs\/reference\/(chains|protocols)\//.test(path);
  // The index's entries are its list items, `- [Page](path): what it is for`, one line a page; its
  // prose may link a page as well.
  const index = join(docs, "README.md");
  const listed = readFileSync(index, "utf8")
    .split("\n")
    .filter((line) => /^- \[/.test(line))
    .map((line) => /^- \[[^\]]*\]\(([^)#\s]+)/.exec(line)?.[1])
    .filter((target) => target !== undefined && !/^[a-z]+:/i.test(target))
    .map((target) => page(resolve(docs, target)));
  for (const file of markdownFiles(docs)) {
    const path = page(file);
    if (file === index || generated(path)) continue;
    const times = listed.filter((to) => to === path).length;
    if (times !== 1)
      shape.push(`docs/README.md: lists ${path} ${times} times; the index lists each page once`);
  }
  // Every page opens with a plain-words intro, a blockquote after its title and its breadcrumb
  // line, before anything else: the manual is for people (CLAUDE.md). A generated page gets its
  // intro from its generator, under the note that opens it.
  for (const file of markdownFiles(docs)) {
    const lines = readFileSync(file, "utf8").split("\n");
    let at = lines.findIndex((line) => line.startsWith("# ")) + 1;
    const skipBlank = () => {
      while (lines[at] === "") at++;
    };
    skipBlank();
    if (/^(\*\*[^*]+\*\* · )?\[[^\]]*\]\([^)]*\)( · |$)/.test(lines[at] ?? "")) {
      at++;
      skipBlank();
    }
    if (!(lines[at] ?? "").startsWith("> "))
      shape.push(
        `${page(file)}: opens with no plain-words intro; begin with a short blockquote after its title and breadcrumb` +
          (lines[0].startsWith("<!-- Generated") ? " (in its generator)" : ""),
      );
  }
  // The manual is in four parts, Diátaxis's: the index places every page under one of its four
  // sections, and the page says which on its breadcrumb line, `**How-to guide** · [Documentation]…`,
  // so a reader knows what kind of page it is and a page stays in that mode (CLAUDE.md).
  const generatedPage = (file) => readFileSync(file, "utf8").startsWith("<!-- Generated");
  /** The first line after a page's title: its breadcrumb. */
  const crumbOf = (file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    const title = lines.findIndex((one) => one.startsWith("# "));
    return lines.slice(title + 1).find((one) => one !== "") ?? "";
  };
  const KINDS = {
    Tutorials: "Tutorial",
    "How-to guides": "How-to guide",
    Concepts: "Concept",
    Reference: "Reference",
  };
  let part;
  for (const line of readFileSync(index, "utf8").split("\n")) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      part = heading[1];
      if (!(part in KINDS))
        shape.push(
          `docs/README.md: "## ${part}" is not one of the manual's parts: ${Object.keys(KINDS).join(", ")}`,
        );
      continue;
    }
    const entry = /^- \[[^\]]*\]\(([^)#\s]+)/.exec(line);
    if (!entry || /^[a-z]+:/i.test(entry[1])) continue;
    const file = resolve(docs, entry[1]);
    const path = page(file);
    const kind = KINDS[part];
    if (kind === undefined) {
      shape.push(`docs/README.md: lists ${path} outside the four parts`);
      continue;
    }
    if (!existsSync(file)) continue;
    if (!crumbOf(file).startsWith(`**${kind}** · `))
      shape.push(
        `${path}: is listed under ${part}, so its breadcrumb line starts \`**${kind}** · \`` +
          (generatedPage(file) ? " (in its generator)" : ""),
      );
  }
  // A page the index does not list, a chain's or a protocol's, says its part as well.
  for (const file of markdownFiles(docs)) {
    if (file === index) continue;
    if (!Object.values(KINDS).some((kind) => crumbOf(file).startsWith(`**${kind}** · `)))
      shape.push(
        `${page(file)}: its breadcrumb line names no part of the manual: ${Object.values(KINDS).join(", ")}`,
      );
  }
  // A page that is mostly links sends its reader on instead of telling them. The indexes are lists,
  // and so is the command reference, which opens with a link to every command's section.
  const lists = new Set([
    "docs/README.md",
    "docs/examples/README.md",
    "docs/reference/chains.md",
    "docs/reference/cli.md",
    "docs/reference/protocols.md",
  ]);
  for (const file of readerPages) {
    const path = page(file);
    if (lists.has(path) || generated(path)) continue;
    const words = prose(file)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .split(/\s+/)
      .filter(Boolean).length;
    const count = links(file).length;
    if (count * 100 > words * 3)
      shape.push(`${path}: ${count} links in ${words} words; say it here, and link less`);
  }
  // The skills guide names every skill the package ships, and only those.
  const shipped = readdirSync(join(root, "skills"), { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(root, "skills", entry.name, "SKILL.md")),
    )
    .map((entry) => entry.name)
    .sort();
  const guide = [
    ...readFileSync(join(docs, "guides", "skills.md"), "utf8").matchAll(/^\| `(sauce-[a-z-]+)`/gm),
  ]
    .map(([, name]) => name)
    .sort();
  if (guide.join() !== shipped.join())
    shape.push(
      `docs/guides/skills.md: its table names ${guide.join(", ")}; the package ships ${shipped.join(", ")}`,
    );
  // In the repository, the generated reference is what the generator renders now. An installed
  // package ships what the repository held, which the packed check compares file by file.
  if (packageArgument < 0) {
    const { freshDocsReference } = await import(
      pathToFileURL(join(root, "sdk", "scripts", "gen-skills-references.mjs")).href
    );
    const { files, extra } = await freshDocsReference();
    for (const file of files.filter((one) => one.stale))
      shape.push(
        `${page(file.path)}: stale; rebuild the SDK (its generator writes docs/reference)`,
      );
    for (const path of extra) shape.push(`${page(path)}: generated by nothing; rebuild the SDK`);
  }
  if (shape.length) throw new Error(`The manual's shape:\n${shape.join("\n")}`);
  console.log(
    `The manual's shape: ${readerPages.length} pages, none into skills/, each in the index once`,
  );
}

// ---- Every tutorial leads on, and the changelog records every release -------------------------------
// A tutorial is one step of the learning path, so it ends with `## Next` naming the following step
// (CLAUDE.md). The changelog's version table has a row for each release set the SDK pins
// (`sdk/src/deployments/releases.json`), and an entry for each SDK release in it, so a bump that
// lands its releases without saying what changed fails here.
{
  const docs = join(root, "docs");
  const problems = [];
  const outsideFences = (file) => readFileSync(file, "utf8").replace(/```[^]*?```/g, "");
  const tutorials = [];
  let part;
  for (const line of readFileSync(join(docs, "README.md"), "utf8").split("\n")) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) part = heading[1];
    const entry = /^- \[[^\]]*\]\(([^)#\s]+)/.exec(line);
    if (part === "Tutorials" && entry && !/^[a-z]+:/i.test(entry[1])) tutorials.push(entry[1]);
  }
  if (tutorials.length === 0) problems.push("docs/README.md: lists no page under ## Tutorials");
  for (const target of tutorials) {
    const file = resolve(docs, target);
    // A page that does not exist is the link check's to report.
    if (existsSync(file) && !/^## Next\s*$/m.test(outsideFences(file)))
      problems.push(
        `${relative(root, file).split("\\").join("/")}: is listed under ## Tutorials, so it ends with a \`## Next\` heading naming the next step`,
      );
  }

  // The table under `## Which versions work together` has a row whose Compiler, v12-evm,
  // kitchen-evm, v12-svm and kitchen-svm cells are the versions of each released row. A row is not
  // out yet when the sync would refuse it: a `null` engine id, Kitchen, Pot init-code hash or asset
  // digest in any of its components. Such a row needs no table row. Every table row whose SDK cell
  // is a version has its `## SDK <version>` entry; a row whose SDK cell is `Unreleased` needs none.
  // The quote router pin names a kitchen-evm release, which the page names outside code. The
  // installed package ships no releases.json, and its run skips this.
  const pinned = join(root, "sdk/src/deployments/releases.json");
  if (existsSync(pinned)) {
    const releases = JSON.parse(readFileSync(pinned, "utf8"));
    const COMPONENTS = ["v12-evm", "kitchen-evm", "v12-svm", "kitchen-svm"];
    const pending = (entry) =>
      ["engine", "kitchen", "potInitCodeHash"].some((key) => entry?.[key] === null) ||
      Object.values(entry?.assets ?? {}).some((digest) => digest === null);
    const changelog = outsideFences(join(docs, "changelog.md"));
    // The table as the build reads it (`sdk/scripts/lib/sdk-releases.mjs`): every line of it a row,
    // each row's cells versions, the Unreleased one included.
    let table;
    try {
      table = versionTableOf(changelog);
    } catch (error) {
      problems.push(error.message);
    }
    if (table) {
      for (const row of releases.releases) {
        if (COMPONENTS.some((component) => pending(row[component]))) continue;
        // A component with no version is one no release publishes: its cell is not compared, and
        // the row's other cells still are.
        const want = { compiler: row.compiler };
        for (const component of COMPONENTS) {
          const version = row[component]?.version;
          if (typeof version === "string" && version !== "") want[component] = version;
        }
        if (!table.some((entry) => Object.keys(want).every((key) => entry[key] === want[key])))
          problems.push(
            `docs/changelog.md: no row of the table under ## Which versions work together has ${Object.entries(
              want,
            )
              .map(([key, version]) => `${key} ${version}`)
              .join(", ")} (releases.json, compiler ${row.compiler})`,
          );
      }
      const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      for (const { sdk } of table)
        if (
          /^\d+\.\d+\.\d+$/.test(sdk) &&
          !new RegExp(`^## SDK ${escaped(sdk)}(?= |$)`, "m").test(changelog)
        )
          problems.push(
            `docs/changelog.md: has no "## SDK ${sdk}" heading (its row in the table under ## Which versions work together)`,
          );
    }
    const quote = releases.quoteRouter;
    if (quote && !pending(quote) && typeof quote.version === "string" && quote.version !== "") {
      if (!changelog.split(/\s+/).join(" ").includes(`kitchen-evm ${quote.version}`))
        problems.push(
          `docs/changelog.md: never names "kitchen-evm ${quote.version}" outside code fences (releases.json, quoteRouter)`,
        );
    }
  }
  if (problems.length) throw new Error(`Tutorials and the changelog:\n${problems.join("\n")}`);
  console.log(
    `Tutorials: ${tutorials.length} end with ## Next; the changelog covers every pinned release`,
  );
}

// The release's addresses are the same on every chain, so the manual writes them on one generated
// page and points there everywhere else, examples and their comments included
// (`release-addresses.mjs`). The skills are skills:check's.
{
  const files = (path) =>
    readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
      const child = join(path, entry.name);
      return entry.isDirectory() ? files(child) : [child];
    });
  const addresses = releaseAddresses({
    deployments: await import(pathToFileURL(join(root, "sdk/dist/deployments/index.js")).href),
  });
  const pages = [join(root, "README.md"), ...files(join(root, "docs"))]
    .map((file) => relative(root, file).split("\\").join("/"))
    .filter((path) => path !== DEPLOYMENTS_PAGE);
  const problems = pages.flatMap((path) =>
    releaseAddressProblems({
      where: path,
      text: readFileSync(join(root, path), "utf8"),
      addresses,
      home: DEPLOYMENTS_PAGE,
    }),
  );
  if (problems.length) throw new Error(`Release addresses:\n${problems.join("\n")}`);
  console.log(
    `Release addresses: ${addresses.size} written only in ${DEPLOYMENTS_PAGE}, ${pages.length} files checked`,
  );
}

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
// An example no suite executes yet, with why; and a name an example reads that nothing declares,
// example -> name -> why. Each entry fails once its example no longer needs it.
const EXECUTION_EXCEPTIONS = {};
const INPUT_EXCEPTIONS = {};
// Compiled is not run: each example also names, in `executed.json`, the suites that execute it on
// an engine. Tests do not ship, so the installed package's run skips this.
if (packageArgument < 0) {
  const problems = executedExamplesProblems({
    repository,
    examplesRoot: examples,
    examples: sauceExamples,
    manifest: join(examples, "executed.json"),
    compileOnly: false,
    pending: EXECUTION_EXCEPTIONS,
  });
  if (problems.length)
    throw new Error(`SauceScript examples not executed:\n${problems.join("\n")}`);
  const pending = Object.keys(EXECUTION_EXCEPTIONS).length;
  console.log(
    `SauceScript examples: ${sauceExamples.length - pending} executed by the suites named, ` +
      `${pending} pending (EXECUTION_EXCEPTIONS)`,
  );
}
// What the registry names, a program writes by its name: no recorded address as a literal, no
// selector of a function a binding declares built by hand. None of these examples is low-level.
// And every value a program reads has a visible source: an input is a `main` parameter
// (`example-programs.mjs`). An exception is INPUT_EXCEPTIONS's, above: example -> name -> why, and
// one nothing needs fails.
{
  const sdk = await import(pathToFileURL(join(root, "sdk/dist/index.js")).href);
  const protocols = await Promise.all(
    sdk
      .listProtocolSlugs()
      .map(async (slug) => [
        slug,
        await import(pathToFileURL(join(root, "sdk/dist/protocols", slug, "index.js")).href),
      ]),
  );
  const builtins = JSON.parse(
    readFileSync(join(root, "skills/sauce-script/references/builtins.json"), "utf8"),
  );
  const ts = createRequire(join(root, "package.json"))("typescript");
  const names = registryNames(sdk, protocols, builtins);
  const problems = sauceExamples.flatMap((name) => {
    const where = `docs/examples/${name}`;
    const source = readFileSync(join(examples, name), "utf8");
    const allowed = INPUT_EXCEPTIONS[name] ?? {};
    const used = new Set();
    return [
      ...namedProgramProblems({ where, source, names }),
      ...inputProblems({ where, source, ts, names, allowed, used }),
      ...Object.keys(allowed)
        .filter((input) => !used.has(input))
        .map((input) => `check-docs.mjs INPUT_EXCEPTIONS: ${where} no longer reads ${input}`),
    ];
  });
  for (const name of Object.keys(INPUT_EXCEPTIONS)) {
    if (!sauceExamples.includes(name)) {
      problems.push(`check-docs.mjs INPUT_EXCEPTIONS: ${name} is not an example`);
    }
  }
  if (problems.length) throw new Error(`SauceScript examples:\n${problems.join("\n")}`);
  console.log(
    `SauceScript examples: ${sauceExamples.length} name what the registry records, and show their inputs`,
  );
}
// SauceScript writes its integers plainly, `3000` and never `3000n` (`integer-literals.mjs`): the
// `.sauce.ts` examples and the manual's SauceScript fences, ```js (and ```sauce), and every fence of
// a page generated from the skills, which renders their SauceScript as ```ts. TypeScript — the `.ts`
// examples and a written page's ```ts fences, closures included — keeps the `n` tsc needs. An
// exception is INTEGER_EXCEPTIONS's: file -> literal as written -> why; one nothing needs fails.
const INTEGER_EXCEPTIONS = {};
{
  const ts = createRequire(join(root, "package.json"))("typescript");
  const used = new Map();
  const problems = [];
  const hold = (where, source, line) => {
    if (!used.has(where)) used.set(where, new Set());
    const allowed = INTEGER_EXCEPTIONS[where] ?? {};
    problems.push(
      ...bigintLiteralProblems({ where, source, ts, line, allowed, used: used.get(where) }),
    );
  };
  for (const name of sauceExamples) {
    hold(`docs/examples/${name}`, readFileSync(join(examples, name), "utf8"), 1);
  }
  let fences = 0;
  for (const path of manual) {
    const file = relative(root, path);
    if (file !== "README.md" && !file.startsWith("docs/")) continue;
    const text = readFileSync(path, "utf8");
    const generated = text.startsWith("<!-- Generated");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const open = /^\s*(```+)(\S*)/.exec(lines[i]);
      if (!open) continue;
      let end = i + 1;
      while (end < lines.length && !lines[end].trimStart().startsWith(open[1])) end++;
      if (["js", "sauce"].includes(open[2]) || (generated && /^(ts|typescript)$/.test(open[2]))) {
        fences++;
        hold(file, lines.slice(i + 1, end).join("\n"), i + 2);
      }
      i = end;
    }
  }
  for (const [file, literals] of Object.entries(INTEGER_EXCEPTIONS)) {
    for (const literal of Object.keys(literals)) {
      if (!used.get(file)?.has(literal)) {
        problems.push(`check-docs.mjs INTEGER_EXCEPTIONS: ${file} no longer writes ${literal}`);
      }
    }
  }
  if (problems.length) throw new Error(`SauceScript integers:\n${problems.join("\n")}`);
  console.log(
    `SauceScript integers: ${sauceExamples.length} examples and ${fences} fences write them plainly`,
  );
}
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

// Every SauceScript program in the repository as an editor in a checkout shows it: typed by the
// root tsconfig.json, with the plugin loaded beside the workspace's TypeScript, and no error. The
// installed package's run skips it: the packed check holds a consumer's project the same way.
if (packageArgument < 0) {
  const { checkRepositoryEditor } = await import(
    new URL("../../sdk/scripts/check-editor.mjs", import.meta.url)
  );
  const programs = await checkRepositoryEditor({
    root: repository,
    tsserverPath: createRequire(join(repository, "package.json")).resolve(
      "typescript/lib/tsserver.js",
    ),
  });
  console.log(`SauceScript in an editor: ${programs} programs typed, with no error`);
}
