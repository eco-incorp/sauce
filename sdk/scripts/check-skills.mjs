#!/usr/bin/env node
// Checks the agent skills this package ships (`skills/<name>/` at the package root) against the
// package itself, so a change that moves an API, a name, a CLI flag or a behaviour fails here
// instead of shipping skills that describe something else.
//
//   node sdk/scripts/check-skills.mjs [--skills <dir>]
//
// `--skills` checks a skills directory other than this repository's `skills/`: the package it
// checks against is the one that directory resolves `@eco-incorp/sauce` to, as its runners would.
// `check-packed-package.mjs` points it at the skills `sauce skills install` wrote into a project
// from the packed tarball, which is what an agent reads (and Node runs a runner from a project, not
// from under node_modules, where it does not strip TypeScript).
//
// Per skill:
//   1. SKILL.md frontmatter follows the Agent Skills specification (agentskills.io): `name` is
//      1-64 lowercase letters, digits and hyphens and equals its directory; `description` says when
//      to use it ("Use when"), fits 1024 characters and is a safe YAML plain scalar;
//   2. every file reads the same for every agent and every release: no version numbers or release
//      talk, no agent's name or install path, no engine internals (opcodes, mnemonics, stack
//      effects, bytecode bytes), no placeholder or unrecorded address, no Portal or prover outside
//      the intents skill, no RPC endpoint, no description of Sauce as a multicall, and nothing that
//      tells the reader to copy, adapt or start from an example (the agent writes each program
//      itself: COPY_FRAMING), no skill named in code (`sauce-<name>`) that the package does not
//      ship; and every protocol document with a swap template opens with the one
//      pointer to `sauce-swaps`;
//   3. the `sauce-examples` index lists every example file on disk and nothing else, each example
//      is referenced by its own skill, and every program and actions document names the chains it
//      is checked on there, one of them at least a chain the release supports; a contract's ABI
//      (`.json`, a JSON array) is a module a program beside it imports, not an example of its own;
//   4. every program's header says how to run it: a usage line (`--chain <chain>`) whose `--args`
//      are `main`'s parameters by name, `<name>` each, in order; a line per parameter
//      (`//   name: Type  meaning and units`); and an example line on a supported chain with real
//      values. The program compiles through the `sauce` command on each chain its index row names,
//      run exactly as its usage line says (defines, intent flags, `main`'s arguments), and on its
//      example's chain as the example says, offline; every actions document (`.json`) names no
//      chain and lowers through `sauce actions` on each chain its row names; and the cook either
//      builds through `sauce tx`, on a chain the release supports (`chainSupport`), or — on a
//      preview chain — is refused, with that chain's chain-support request in the refusal, as the
//      skills tell an agent it will be;
//   5. every `sauce …` command line in a skill names a real command and only flags it takes;
//   6. every ```sauce block compiles (```sauce chain=a,b through the command, ```sauce target=evm|svm
//      raw) or, as ```sauce fails, does not; every ```json chain=a,b block is an actions document
//      `sauce actions` lowers on those chains (```json fails chain=a: refused there); every ```ts
//      block and every runner (`*.mts`) typechecks, and every runner EXECUTES with the network
//      disabled;
//   7. every `@eco-incorp/sauce/...` subpath and `node_modules/@eco-incorp/sauce/...` path exists,
//      and every identifier in inline code is one the package declares;
//   8. every generated reference (the globals index, the chains, the protocol index and registry
//      files) is what `gen-skills-references.mjs` writes from the registries, everything the globals
//      index lists compiles on its chains, and every global a skill uses is listed;
//   9. the SauceScript reference (sauce-script/references) compiles every example it gives and is
//      refused every form it rejects, with the messages it quotes;
//  10. the actions reference (sauce-actions/references) is what `gen-skills-actions.mjs` renders
//      from the actions JSON Schema the package ships;
//  11. every example program is either executed by a suite CI runs, named in
//      `skills-check/executed.json`, or listed there as compile-only with the reason;
//  12. every example program writes what the registry names by its name: no recorded address as
//      a literal, no hand-built selector of a function a binding declares (LOW_LEVEL_CALLS).
import { spawnSync } from "node:child_process";
import {
  existsSync,
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
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

import { renderActionsReference } from "./gen-skills-actions.mjs";
import {
  GENERATED_DIRS,
  renderSkillsReferences,
  skillsReferences,
} from "./gen-skills-references.mjs";
import { checkBuiltins, checkBuiltinsJson } from "./skills-check/builtins.mjs";
import {
  executedExamplesProblems,
  namedProgramProblems,
  registryNames,
} from "../../docs/scripts/example-programs.mjs";

// ---- Arguments and resolution -------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY = resolve(HERE, "../..");
const skillsFlag = process.argv.indexOf("--skills");
if (skillsFlag >= 0 && !process.argv[skillsFlag + 1]) {
  throw new Error("--skills requires a skills directory");
}
const SKILLS_DIR =
  skillsFlag < 0 ? join(REPOSITORY, "skills") : resolve(process.argv[skillsFlag + 1]);
const INDEX_SKILL = "sauce-examples";
const INTENTS_SKILL = "sauce-intents";
const PKG = "@eco-incorp/sauce";

const failures = [];
const fail = (where, message) => failures.push(`${where}: ${message}`);
const rel = (path) => relative(process.cwd(), path) || ".";
const read = (path) => readFileSync(path, "utf8");
const stripAnsi = (text) => stripVTControlCharacters(String(text));
// The compiler's diagnostics are drawn as a tree; keep the lines that say something.
const diagnostic = (text) =>
  stripAnsi(text)
    .split("\n")
    .map((line) => line.replace(/^[\s│├╰─▶×╭╮╯╴·|]+/, "").trim())
    .filter(
      (line) => line && !/^(compiling the program failed|compilation failed|-->|\d+ \|)/.test(line),
    )
    .slice(0, 4)
    .join(" / ");
const counts = {
  skills: 0,
  files: 0,
  programRuns: 0,
  commands: 0,
  sauce: 0,
  sauceFails: 0,
  ts: 0,
  runners: 0,
  indexed: 0,
  subpaths: 0,
  identifiers: 0,
  addresses: 0,
  refusals: 0,
};

function walk(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, predicate, out);
    else if (predicate(path)) out.push(path);
  }
  return out;
}

if (!existsSync(SKILLS_DIR)) {
  console.error(`no skills directory at ${SKILLS_DIR}`);
  process.exit(2);
}
// The package resolves by its own name from inside it, as the skills' runners resolve it.
const requireFromSkills = createRequire(join(SKILLS_DIR, "resolve.cjs"));
const load = (specifier) => import(pathToFileURL(requireFromSkills.resolve(specifier)).href);
const packageRoot = (entry, name) => {
  for (let dir = dirname(entry); dir !== dirname(dir); dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest) && JSON.parse(read(manifest)).name === name) return dir;
  }
  throw new Error(`no package.json named ${name} above ${entry}`);
};
const SDK_DIR = packageRoot(requireFromSkills.resolve(PKG), PKG);
const sdkPkg = JSON.parse(read(join(SDK_DIR, "package.json")));
const exportKeys = Object.keys(sdkPkg.exports);
const sdk = await load(PKG);
const compilerApi = await load(`${PKG}/compiler`);
const deploymentsApi = await load(`${PKG}/deployments`);
const ecoRoutes = await load(`${PKG}/protocols/eco-routes`);
const { runCli } = await import(pathToFileURL(join(SDK_DIR, "sdk/dist/cli/run.js")).href);
// Which chains the command builds transactions on: the CLI's own policy, which the package exports
// none of, read from the bin's module as `runCli` is.
const support = await import(pathToFileURL(join(SDK_DIR, "sdk/dist/cli/support.js")).href);
// TypeScript and Node's typings: the package's own TypeScript, and the first @types/node found
// beside it, in the SDK workspace, or in the directory the check runs from.
const ts = createRequire(join(SDK_DIR, "package.json"))("typescript");
const NODE_TYPES = (() => {
  for (const from of [SDK_DIR, join(SDK_DIR, "sdk"), process.cwd()]) {
    try {
      const manifest = createRequire(join(from, "package.json")).resolve(
        "@types/node/package.json",
      );
      return dirname(packageRoot(manifest, "@types/node"));
    } catch {}
  }
  throw new Error("no @types/node to typecheck the skills' TypeScript against");
})();

// anvil's first dev account: a real, well-known address for the developer's inputs (an owner, a
// recipient, a creator) in an offline check. It is never written into a skill.
const DEV = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const DEADLINE = String(Math.floor(Date.now() / 1000) + 86_400);

// ---- The sauce command, in-process ----------------------------------------------------------------
async function sauce(argv) {
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
    readText: (path) => read(path),
    readModule: (path) => {
      try {
        return readFileSync(path);
      } catch (error) {
        if (["ENOENT", "ENOTDIR", "EISDIR"].includes(error.code)) return undefined;
        throw error;
      }
    },
    writeText: () => {
      throw new Error("the skills check writes no file through the command");
    },
    run: () => {
      throw new Error("the skills check runs no package manager");
    },
    promptPassword: () => Promise.reject(new Error("no terminal")),
    confirm: async () => undefined,
  };
  const code = await runCli(argv, io);
  return { code, stdout, stderr };
}

// Each command and the flags its --help lists; a command with verbs (`sauce intent fill`), each
// verb under `<command> <verb>`, from the verbs its own --help lists.
const COMMANDS = new Map();
{
  const flagsOf = (help) => {
    const flags = new Set([...help.matchAll(/^\s+(?:-(\w), )?--([\w-]+)/gm)].map((m) => m[2]));
    for (const short of help.matchAll(/^\s+-(\w), --/gm)) flags.add(`-${short[1]}`);
    return flags;
  };
  const { stdout } = await sauce(["--help"]);
  const names = [...stdout.matchAll(/^ {2}([a-z]+) {2,}/gm)].map((m) => m[1]);
  for (const name of names) {
    const help = (await sauce([name, "--help"])).stdout;
    COMMANDS.set(name, flagsOf(help));
    const verbs = /^Verbs\b.*\n((?: {2}[a-z]+ {2,}.*\n)+)/m.exec(help)?.[1] ?? "";
    for (const [, verb] of verbs.matchAll(/^ {2}([a-z]+) {2,}/gm)) {
      COMMANDS.set(`${name} ${verb}`, flagsOf((await sauce([name, verb, "--help"])).stdout));
    }
  }
  if (COMMANDS.size === 0) fail("sauce --help", "lists no command");
}

/** `text` split into shell words: whitespace-separated, with '…', "…" and a `<placeholder>` of
 *  several words kept whole. */
function shellWords(text) {
  const SPACE = "\u0000";
  const held = text.replace(/<[^<>]*>/g, (placeholder) => placeholder.replace(/\s/g, SPACE));
  const words = [];
  for (const m of held.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)) {
    words.push((m[1] ?? m[2] ?? m[3]).replaceAll(SPACE, " "));
  }
  return words;
}

/** Every `sauce …` invocation in `lines` (shell or comment text), continuations joined. */
function commandLines(lines) {
  const joined = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/^\s*\/\/\s?/, "").replace(/\s+#.*$/, "");
    const text = current === null ? line.trim() : `${current} ${line.trim()}`;
    if (current === null && !/^(?:npx\s+(?:--no\s+--\s+)?)?sauce\s/.test(text)) continue;
    if (text.endsWith("\\")) {
      current = text.slice(0, -1).trim();
      continue;
    }
    current = null;
    joined.push(text.replace(/^npx\s+(?:--no\s+--\s+)?/, ""));
  }
  return joined.map((line) => shellWords(line).slice(1));
}

/** Fails an invocation that names no command, or a flag its command does not take. */
/** `argv` with a command's verb joined to it: `intent fill …` is the command `intent fill`. */
function joinVerb(argv) {
  const [first, second, ...more] = argv;

  return COMMANDS.has(`${first} ${second}`) ? [`${first} ${second}`, ...more] : argv;
}

function checkCommand(where, given) {
  const argv = joinVerb(given);
  const [name, ...rest] = argv;
  // `sauce <command> --help` stands for any command.
  if (/^<[^>]+>$/.test(name ?? "")) return true;
  counts.commands++;
  const flags = COMMANDS.get(name);
  if (flags === undefined) {
    fail(where, `\`sauce ${argv.join(" ")}\`: '${name}' is not a sauce command`);
    return false;
  }
  let ok = true;
  for (const word of rest) {
    if (word === "--args") break;
    const flag = /^(--[\w-]+|-\w)(?:=.*)?$/.exec(word)?.[1];
    if (flag === undefined) continue;
    const key = flag.startsWith("--") ? flag.slice(2) : flag;
    if (!flags.has(key)) {
      fail(where, `\`sauce ${name}\` takes no ${flag} (\`sauce ${name} --help\`)`);
      ok = false;
    }
  }
  return ok;
}

// ---- Skills ---------------------------------------------------------------------------------------
/** Fenced blocks with their info string, the file and the line the body starts on. */
function fencedBlocks(text, file) {
  const blocks = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^```(\S*)\s*(.*)$/.exec(lines[i]);
    if (!open || open[1] === "") continue;
    const start = i + 1;
    let end = start;
    while (end < lines.length && !/^```\s*$/.test(lines[end])) end++;
    blocks.push({
      file,
      lang: open[1],
      info: open[2].trim().split(/\s+/).filter(Boolean),
      body: lines.slice(start, end).join("\n"),
      line: start + 1,
    });
    i = end;
  }
  return blocks;
}
function parseSkill(dir) {
  const path = join(SKILLS_DIR, dir, "SKILL.md");
  const text = read(path);
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const front = {};
  for (const line of match?.[1].split("\n") ?? []) {
    const kv = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (kv) front[kv[1]] = kv[2].trim();
  }
  const blocks = fencedBlocks(text, path);
  // The ```sauce blocks of its references, compiled like its own.
  const referenceBlocks = walk(join(SKILLS_DIR, dir, "references"), (f) => f.endsWith(".md"))
    .sort()
    .flatMap((file) => fencedBlocks(read(file), file).filter((b) => b.lang === "sauce"));
  const prose = text.replace(/^```[\s\S]*?^```\s*$/gm, "");
  const examplesDir = join(SKILLS_DIR, dir, "examples");
  const files = existsSync(examplesDir) ? readdirSync(examplesDir).sort() : [];
  return {
    dir,
    path,
    text,
    front,
    hasFront: !!match,
    blocks,
    referenceBlocks,
    prose,
    examples: files.map((f) => join(examplesDir, f)),
    runners: files.filter((f) => f.endsWith(".mts")).map((f) => join(examplesDir, f)),
    programs: files.filter((f) => f.endsWith(".sauce.ts")).map((f) => join(examplesDir, f)),
    // A `.json` example is an actions document, or — a JSON array — a contract's ABI that a
    // program beside it imports (`import IOracle from "./IOracle.json"`): a module, not an example.
    documents: files
      .filter((f) => f.endsWith(".json") && !isAbi(join(examplesDir, f)))
      .map((f) => join(examplesDir, f)),
    abis: files
      .filter((f) => f.endsWith(".json") && isAbi(join(examplesDir, f)))
      .map((f) => join(examplesDir, f)),
  };
}
/** Whether a `.json` file is a contract's ABI: a JSON array, which is no actions document. */
function isAbi(file) {
  try {
    return Array.isArray(JSON.parse(read(file)));
  } catch {
    return false;
  }
}

const skills = readdirSync(SKILLS_DIR)
  .filter((d) => statSync(join(SKILLS_DIR, d)).isDirectory())
  .sort()
  .map((dir) => {
    if (!existsSync(join(SKILLS_DIR, dir, "SKILL.md"))) {
      fail(rel(join(SKILLS_DIR, dir)), "is a skills directory entry with no SKILL.md");
      return undefined;
    }
    return parseSkill(dir);
  })
  .filter((skill) => skill !== undefined);
counts.skills = skills.length;
if (skills.length === 0) fail(rel(SKILLS_DIR), "no skills found");

// Inline code spans that are code, not file paths or file names.
const FILE_LIKE = /\/|\.(md|js|mjs|ts|mts|json|so)$/;
const inlineCode = (skill) =>
  [...skill.prose.matchAll(/`([^`\n]+)`/g)]
    .map((m) => m[1].trim())
    .filter((s) => !FILE_LIKE.test(s));
// Names a skill's inline code uses although the package never declares them, per skill, each with
// why: an external contract's function, or a name that is wrong on purpose. They live here rather
// than in the skills, where a marker would mean nothing to the agent reading them, and an entry the
// skill no longer needs fails the check, so the list cannot outlive its reason.
const UNDECLARED_NAMES = {
  "sauce-script": {
    arr: "the rejected `arr.push(x)`: JavaScript's push, which SauceScript has no form of",
  },
  "sauce-chains": {
    getAccountInfo:
      "Solana's JSON-RPC method that reads an account, a node's API, not the package's",
  },
  "sauce-solana": {
    getAccountInfo:
      "Solana's JSON-RPC method that reads an account, a node's API, not the package's",
    getCreateAssociatedTokenIdempotentInstruction:
      "@solana-program/token's ATA creation, a dependency the package re-exports none of",
  },
  "sauce-intents": {
    CallFailed:
      "the eco-routes Executor's error for a route call that reverted; the registry declares the Portal's errors, not the Executor's",
    CallToEOA:
      "the eco-routes Executor's error for a call to an address with no code; the registry declares the Portal's errors, not the Executor's",
  },
};
const undeclaredUsed = new Set(); // "<skill>/<name>"
const allowed = (skill) => new Set(Object.keys(UNDECLARED_NAMES[skill.dir] ?? {}));

// ---- 1. Frontmatter ---------------------------------------------------------------------------------
// https://agentskills.io/specification: these are the fields a SKILL.md may carry.
const FRONTMATTER_FIELDS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);
for (const skill of skills) {
  const where = rel(skill.path);
  const { name, description } = skill.front;
  if (!skill.hasFront) fail(where, "missing YAML frontmatter");
  for (const key of Object.keys(skill.front)) {
    if (!FRONTMATTER_FIELDS.has(key)) fail(where, `frontmatter field '${key}' is not in the spec`);
  }
  if (name !== skill.dir)
    fail(where, `frontmatter name "${name}" must equal its directory "${skill.dir}"`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name ?? "") || (name ?? "").length > 64)
    fail(where, "name must be 1-64 lowercase letters, digits and single hyphens");
  if (!description) fail(where, "missing description");
  else {
    if (description.length > 1024)
      fail(where, `description is ${description.length} characters; the limit is 1024`);
    // A YAML plain scalar: ": " or " #" would silently change how it parses.
    if (/: | #/.test(description)) fail(where, 'description must not contain ": " or " #" (YAML)');
    if (!/\bUse when\b/.test(description))
      fail(where, 'description must say when to use it ("Use when ...")');
  }
}

// ---- 2. Wording ---------------------------------------------------------------------------------------
// Skills state how things are, never which release made them so.
const VERSION_TALK = [
  [/\b\d+\.\d+\.\d+\b/, "a version number"],
  [
    /\b(?:this|the current|the installed|the published|a later|a future|an earlier|the next) (?:version|release)\b/i,
    "release talk",
  ],
  [
    /\bchangelog\b|\bPR\s*#?\d+|\bpull request\b|\buntil\b[^.]*\b(?:ships|lands|merges|is released)\b|\b(?:since|as of|from) v?\d+\.\d+\b/i,
    "release talk",
  ],
];
// The same skill reaches every agent: no agent named, and no agent's directory assumed.
const AGENT_SPECIFIC = [
  [/\b(?:Claude|Codex|Copilot|Gemini|ChatGPT|Anthropic|OpenAI)\b|\bCursor\b/, "an agent's name"],
  [/(?:^|[^\w.])\.(?:claude|codex|cursor|github|gemini|agents)\//, "an agent's install path"],
  [/\b(?:CLAUDE|AGENTS|GEMINI)\.md\b/, "an agent's instructions file"],
];
// What the engine does underneath is not the language: describe SauceScript, never its encoding.
const ENGINE_INTERNALS = [
  [/\bop-?codes?\b/i, "opcodes"],
  [/\bmnemonics?\b/i, "mnemonics"],
  [/\bstack[- ](?:effects?|slots?|depth|machine)\b/i, "the engine's stack"],
  [
    /\b(?:SDUP|SSWAP|NEW_ARRAY|SET_INDEX|JUMP_I|JUMPI|ALLOCATE|DUP\d+|SWAP\d+|PUSH\d+)\b/,
    "a mnemonic",
  ],
  [
    /\bbytecode bytes?\b|\bprogram bytes? \d|\bbyte \d+ of the (?:program|bytecode)\b/i,
    "bytecode bytes",
  ],
  [/0x[0-9a-fA-F]{90,}/, "a bytecode dump"],
];
// Invented addresses: every address comes from the SDK or from the developer, as a <placeholder>.
// The zero address is a real value (no referrer, native ETH), so a run of zeros is not one.
const PLACEHOLDERS = [
  /0x([1-9a-fA-F])\1{39}(?![0-9a-fA-F])/,
  /0x([1-9a-fA-F])\1{2,}(?:…|\.\.\.)/,
  /0x(?:dead|beef)[0-9a-fA-F]{36}(?![0-9a-fA-F])/i,
  /\b0x[G-Zg-z_][\w]*/,
  /\b0x(?:…|\.\.\.)/,
];
const RPC_HOST =
  /(alchemy|infura|quiknode|quicknode|helius|ankr|llamarpc|drpc|blastapi|chainstack|publicnode|getblock|tenderly|solana\.com|rpc\.|\.rpc|-rpc)/i;
const NOT_PORTABLE = [[/(?:^|[\s`("'])(?:\/Users\/|\/home\/|~\/)/, "an absolute or home path"]];
// The agent writes each program itself, in SauceScript, for the task as asked: a skill teaches the
// language, the names and the patterns, and an example shows an idiom. Nothing tells the reader to
// copy an example, adapt one, start from one or choose between them. (A protocol document's
// SauceScript "templates" are a registry API, and the word alone is not this.)
const COPY_FRAMING = [
  /\bcopy (?:the closest|an? (?:example|program)|the example|this (?:example|program|file)|it)\b/i,
  /\bstart(?:ing)? from (?:it|this|the (?:closest|example)|an? example|one of the examples)\b/i,
  /\badapt(?:ing)? (?:it|this|the (?:closest|example|program)|an? (?:example|program))\b/i,
  /\bstarting point to copy\b/i,
  /\b(?:use|take) (?:it|this|one) as a template\b/i,
];
// Skills a change of their own rewrites, with the reason; an exemption no longer needed fails.
const COPY_FRAMING_EXEMPT = {};
const copyFramingUsed = new Set();
// Docs inside the installed package are not the skills': a skill carries every fact it needs in its
// SKILL.md and references/, which install with it. Only the TypeScript skill points into the package.
const PACKAGE_DOCS =
  /node_modules\/@eco-incorp\/sauce\b|@eco-incorp\/sauce\/docs\b|(?<![\w./-])docs\/(?:guides|concepts|api|examples|README)/;
const PACKAGE_SKILL = "sauce-typescript";

// Every address the SDK records, so an address in a skill is one a reader can trace.
const KNOWN_ADDRESSES = new Set();
{
  const collect = (value, depth = 0) => {
    if (depth > 8 || value === null || value === undefined) return;
    if (typeof value === "string" || typeof value === "bigint") {
      const hex = typeof value === "bigint" ? `0x${value.toString(16).padStart(40, "0")}` : value;
      if (/^0x[0-9a-fA-F]{40}$/.test(hex)) KNOWN_ADDRESSES.add(hex.toLowerCase());
      return;
    }
    if (typeof value === "object") for (const v of Object.values(value)) collect(v, depth + 1);
  };
  collect(sdk.routes.TOKEN_REGISTRY);
  const modules = await Promise.all(
    sdk.listProtocolSlugs().map((slug) => load(`${PKG}/protocols/${slug}`).catch(() => ({}))),
  );
  for (const module of modules) collect(module.deployments);
  collect(deploymentsApi.v12DeployedAddresses());
  for (const chain of sdk.CANONICAL_CHAINS) {
    for (const lookup of ["ecoRoutesPortal", "ecoRoutesExecutor"]) {
      try {
        collect(ecoRoutes[lookup](chain.slug));
      } catch {}
    }
    try {
      collect(sdk.destinationPot(chain.slug));
    } catch {}
    collect(sdk.routes.chainDefines(chain));
  }
}

// A third-party protocol's own document may name its own Portal, so the Portal rule and the
// recorded-address rule hold for what this package writes itself, not for those documents.
const PROTOCOL_DOCUMENTS = join(SKILLS_DIR, "sauce-protocols", "references");
const handWritten = (file) => !file.startsWith(PROTOCOL_DOCUMENTS + "/");
// Every generated reference, rendered from the package the skills resolve, once: section 8 holds
// the files on disk to it, and the wording rules exempt exactly these files from the Portal rule
// (they record what the registries hold, a chain's eco-routes deployment included).
const REFERENCES = await skillsReferences(
  {
    sdk,
    ecoRoutes,
    deployments: deploymentsApi,
    cctp: await load(`${PKG}/protocols/cctp`),
    compiler: compilerApi,
    support,
    loadProtocol: (slug) => load(`${PKG}/protocols/${slug}`),
  },
  (slug) => existsSync(join(PROTOCOL_DOCUMENTS, `${slug}.md`)),
);
const RENDERED = renderSkillsReferences(REFERENCES);
const GENERATED = new Set(Object.keys(RENDERED).map((name) => join(SKILLS_DIR, name)));
const isGenerated = (file) => GENERATED.has(file);
// A heading's anchor, as GitHub and the docs check derive it.
const anchors = (file) =>
  [...read(file).matchAll(/^#{1,6}\s+(.+)$/gm)].map((heading) =>
    heading[1]
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-"),
  );

/** Every skill the package ships, by name: what a `sauce-<name>` in a skill must be. */
const SKILL_NAMES = new Set(skills.map((skill) => skill.dir));

function wording(skill, file) {
  const text = read(file);
  const where = (i) => `${rel(file)}:${i + 1}`;
  text.split("\n").forEach((line, i) => {
    for (const [pattern, what] of VERSION_TALK)
      if (pattern.test(line)) fail(where(i), `mentions ${what}; state the fact without it`);
    // A generated table row is registry data, where a name is a company's own: a stock token of
    // Gemini Space Station names no agent.
    const registryRow = isGenerated(file) && line.startsWith("| `");
    for (const [pattern, what] of AGENT_SPECIFIC)
      if (!registryRow && pattern.test(line))
        fail(where(i), `names ${what}; skills are agent-neutral`);
    for (const [pattern, what] of ENGINE_INTERNALS)
      if (pattern.test(line)) fail(where(i), `describes ${what}; describe the SauceScript surface`);
    for (const pattern of PLACEHOLDERS)
      if (pattern.test(line))
        fail(where(i), "names a placeholder address; take it from the SDK or write <address>");
    for (const [pattern, what] of NOT_PORTABLE)
      if (pattern.test(line)) fail(where(i), `names ${what}`);
    // A skill named in code is one the package ships: a renamed or removed skill fails here.
    for (const m of line.matchAll(/`(sauce-[a-z0-9-]+)`/g))
      if (!SKILL_NAMES.has(m[1]))
        fail(where(i), `names the skill \`${m[1]}\`, which the package does not ship`);
    for (const m of line.matchAll(/(?:\.\.\/)+[\w@.-][\w@./-]*/g)) {
      if (!resolve(dirname(file), m[0]).startsWith(SKILLS_DIR + "/"))
        fail(where(i), `names ${m[0]}, a path that leaves the skills directory`);
    }
    for (const m of line.matchAll(/\]\(([^)\s#]*)(?:#([^)\s]*))?\)/g)) {
      const [, path, fragment] = m;
      if (/^[a-z]+:/i.test(path)) continue;
      const target = path ? resolve(dirname(file), path) : file;
      if (!existsSync(target)) fail(where(i), `links ${path}, which does not exist`);
      else if (fragment && target.endsWith(".md") && !anchors(target).includes(fragment))
        fail(where(i), `links ${path}#${fragment}, a heading ${rel(target)} does not have`);
    }
    if (skill.dir !== PACKAGE_SKILL && PACKAGE_DOCS.test(line))
      fail(
        where(i),
        `points into the package's docs; put the fact in the skill (only ${PACKAGE_SKILL} may)`,
      );
    for (const m of line.matchAll(/https?:\/\/[^\s"'`)<>]+/g)) {
      if (RPC_HOST.test(new URL(m[0]).host))
        fail(where(i), `looks like an RPC endpoint (${m[0]}); endpoints come from the developer`);
    }
    if (!handWritten(file)) return;
    if (file.endsWith(".md") && COPY_FRAMING.some((pattern) => pattern.test(line))) {
      if (Object.hasOwn(COPY_FRAMING_EXEMPT, skill.dir)) copyFramingUsed.add(skill.dir);
      else
        fail(
          where(i),
          "tells the reader to copy, adapt or start from an example; an example shows an idiom, " +
            "and the agent writes the program the task needs",
        );
    }
    if (/multicall|magic header/i.test(line) && !/\b(never|not|don't|do not|isn't)\b/i.test(line))
      fail(where(i), "describes Sauce as a multicall or with a magic header");
    if (
      skill.dir !== INTENTS_SKILL &&
      !isGenerated(file) &&
      /\b(?:Portal|portal|[Pp]rover)s?\b/.test(line)
    )
      fail(where(i), `names the Portal or a prover outside ${INTENTS_SKILL}`);
    for (const m of line.matchAll(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)) {
      counts.addresses++;
      if (!KNOWN_ADDRESSES.has(m[0].toLowerCase()))
        fail(where(i), `names ${m[0]}, which the SDK does not record; take addresses from it`);
    }
  });
}
for (const skill of skills) {
  for (const file of walk(join(SKILLS_DIR, skill.dir), (f) =>
    /\.(?:md|mjs|mts|ts|json)$/.test(f),
  )) {
    counts.files++;
    wording(skill, file);
  }
}
for (const [dir, why] of Object.entries(COPY_FRAMING_EXEMPT)) {
  if (skills.some((skill) => skill.dir === dir) && !copyFramingUsed.has(dir))
    fail(
      `check-skills.mjs COPY_FRAMING_EXEMPT`,
      `exempts ${dir} (${why}), which no longer needs it: remove the exemption`,
    );
}

// ---- 2b. A protocol document with a swap template leads a Sauce program to the Router --------------
// One line, the same in every such document: a protocol's own router template is for a pool the
// Sauce Router does not service, and a zero price limit there leaves the minimum output alone.
const SWAP_POINTER =
  "> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a " +
  "price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools " +
  "under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.";
const swapDocuments = [];
const protocolList = sdk.listProtocols();
const protocolModules = await Promise.all(
  protocolList.map((info) => load(`${PKG}/protocols/${info.slug}`).catch(() => ({}))),
);
for (const [index, info] of protocolList.entries()) {
  const path = join(PROTOCOL_DOCUMENTS, `${info.slug}.md`);
  if (!existsSync(path)) continue;
  const module = protocolModules[index];
  const templates = Object.entries(module)
    .filter(([, value]) => typeof value === "string")
    .map(([name]) => name);
  if (!["dex", "aggregator"].includes(info.category) && !templates.some((t) => /swap/i.test(t)))
    continue;
  swapDocuments.push(info.slug);
  const text = read(path);
  if (/^# [^\n]+\n\n([^\n]*)/.exec(text)?.[1] !== SWAP_POINTER)
    fail(rel(path), "swaps, so its first line after the title is SWAP_POINTER (check-skills.mjs)");
  text.split("\n").forEach((line, i) => {
    if (
      /\b(?:sqrtPriceLimitX96|limitSqrtPrice|limitSqrtP|limitPrice)\b/.test(line) &&
      /\b(?:no (?:price )?limit|any price)\b/i.test(line) &&
      !/\bonly bound\b/.test(line)
    )
      fail(
        `${rel(path)}:${i + 1}`,
        "offers no price limit without saying minOut is then the only bound",
      );
  });
}
if (swapDocuments.length === 0) fail(rel(PROTOCOL_DOCUMENTS), "no protocol document swaps");

// ---- 3. Examples and the index ---------------------------------------------------------------------
/** A fenced block's `key=value` option. */
const optionOf = (block, key) =>
  block.info.find((i) => i.startsWith(`${key}=`))?.slice(key.length + 1);
/** The chains a ```sauce or ```json block is checked on, or undefined when it names none. */
const chainsOf = (block) => optionOf(block, "chain")?.split(",");

const allExamples = new Set(); // "<skill>/examples/<file>"
for (const skill of skills)
  for (const f of skill.examples) allExamples.add(relative(SKILLS_DIR, f).split("\\").join("/"));
const index = skills.find((s) => s.dir === INDEX_SKILL);
if (index === undefined) fail(rel(SKILLS_DIR), `no ${INDEX_SKILL} index skill`);

for (const skill of skills) {
  const where = rel(skill.path);
  for (const file of skill.examples) {
    if (!/\.(?:sauce\.ts|mts|json)$/.test(file))
      fail(
        rel(file),
        "an example is a program (.sauce.ts), an actions document (.json) or a runner (.mts)",
      );
  }
  // An ABI is a module: a program beside it imports it, by the relative path that resolves to it.
  for (const abi of skill.abis) {
    const name = basename(abi);
    if (!skill.programs.some((file) => read(file).includes(`from "./${name}"`)))
      fail(rel(abi), `is a contract's ABI that no program beside it imports ("./${name}")`);
  }
  // References: `examples/<file>` (its own) or `../<skill>/examples/<file>` (another skill's).
  const refs = [
    ...skill.text.matchAll(
      /(?<![\w/.])(?:\.\.\/([\w-]+)\/)?examples\/([\w-]+(?:\.sauce\.ts|\.mts|\.json))\b/g,
    ),
  ].map((m) => `${m[1] ?? skill.dir}/examples/${m[2]}`);
  if (refs.length === 0 && skill.dir !== INDEX_SKILL) fail(where, "references no example");
  for (const ref of refs)
    if (!allExamples.has(ref)) fail(where, `references ${ref}, which does not exist`);
  for (const file of skill.examples) {
    const own = `${skill.dir}/examples/${basename(file)}`;
    if (!refs.includes(own)) fail(rel(file), "is not referenced by its skill's SKILL.md");
  }
  const checked = skill.blocks.filter(
    (b) =>
      ["ts", "sauce", "sh"].includes(b.lang) || (b.lang === "json" && chainsOf(b) !== undefined),
  );
  if (checked.length === 0 && skill.dir !== INDEX_SKILL)
    fail(where, "has no checked code block (sauce, ts, sh, or json chain=…)");
}

// The index: one row per example, `| <link to the file> | <chains> | … |` for a program.
const programChains = new Map(); // "<skill>/examples/<file>.sauce.ts" -> chain slugs
if (index !== undefined) {
  const listed = new Set();
  for (const line of index.text.split("\n")) {
    const m = /^\|\s*\[`?\.\.\/([\w-]+)\/examples\/([\w.-]+)`?\]\([^)]*\)\s*\|([^|]*)\|/.exec(line);
    if (m === null) continue;
    const entry = `${m[1]}/examples/${m[2]}`;
    if (listed.has(entry)) fail(rel(index.path), `lists ${entry} twice`);
    listed.add(entry);
    if (entry.endsWith(".sauce.ts") || entry.endsWith(".json")) {
      const chains = [...m[3].matchAll(/`([\w-]+)`/g)].map((c) => c[1]);
      if (chains.length === 0) fail(rel(index.path), `gives ${entry} no chain to check it on`);
      // Its cook is built where the release supports the chain: one of those at least, so the
      // example's transaction is checked as well as its refusal.
      else if (!chains.some((chain) => support.isSupportedChain(chain)))
        fail(rel(index.path), `gives ${entry} no supported chain, where its cook would build`);
      programChains.set(entry, chains);
    }
  }
  // An ABI is listed with the program that imports it, not as an example of its own.
  const abis = new Set(
    skills.flatMap((skill) => skill.abis.map((f) => relative(SKILLS_DIR, f).split("\\").join("/"))),
  );
  for (const example of allExamples)
    if (!listed.has(example) && !abis.has(example))
      fail(rel(index.path), `does not list ${example}`);
  for (const entry of listed)
    if (!allExamples.has(entry)) fail(rel(index.path), `lists ${entry}, which does not exist`);
}

// ---- 4-5. Programs through the command, and every command line ------------------------------------------
/** A value for a `<placeholder>`, by what it names. */
const fill = (word) =>
  word.replace(/<([^>]+)>/g, (_, what) =>
    /unix seconds|deadline/i.test(what) ? DEADLINE : /\bwei\b|\bfee\b/i.test(what) ? "0" : DEV,
  );
/** A value of `type`, for `main`'s arguments in an offline run. */
function sample(type) {
  const t = type.trim();
  if (t.endsWith("[]")) return [sample(t.slice(0, -2))];
  if (t.startsWith("{")) {
    const fields = {};
    let depth = 0;
    let start = 1;
    const body = t.slice(0, t.lastIndexOf("}"));
    for (let i = 1; i <= body.length; i++) {
      const ch = body[i];
      if (ch === "{" || ch === "[" || ch === "<") depth++;
      else if (ch === "}" || ch === "]" || ch === ">") depth--;
      if (((ch === "," || ch === ";") && depth === 0) || i === body.length) {
        const field = body.slice(start, i).trim();
        if (field) {
          const at = field.indexOf(":");
          fields[field.slice(0, at).trim()] = sample(field.slice(at + 1));
        }
        start = i + 1;
      }
    }
    return fields;
  }
  if (/^(?:Address|Account)\b/.test(t)) return DEV;
  if (/^(?:bool|boolean)$/.test(t)) return true;
  if (t === "bytes") return "0x";
  if (t === "string") return "text";
  return "1";
}

async function compileJson(file, chain, extra) {
  const run = await sauce(["compile", file, "--chain", chain, ...extra, "--json"]);
  if (run.code !== 0) return { error: diagnostic(run.stderr || run.stdout) };
  return { json: JSON.parse(run.stdout) };
}

/**
 * `sauce tx` with `argv` on `chain`, offline: on a chain the release supports it builds the cook; on
 * a preview chain it is refused before anything is read, naming the chain as one and carrying its
 * chain-support request (`chainSupportRequest`), which is what the skills say happens there.
 */
async function txOn(where, chain, argv) {
  const tx = await sauce(argv);
  if (support.chainSupport(chain) === "supported") {
    if (tx.code !== 0) fail(where, `sauce tx on ${chain} fails: ${diagnostic(tx.stderr)}`);
    else if (JSON.parse(tx.stdout).data === undefined)
      fail(where, `sauce tx on ${chain} built no cook`);
    return;
  }
  counts.refusals++;
  const request = support.chainSupportRequest(chain).newIssueUrl;
  if (
    tx.code !== 1 ||
    tx.stdout !== "" ||
    !/is refused: it involves [^\n]*\ba preview chain\b/.test(tx.stderr) ||
    !tx.stderr.includes(request)
  )
    fail(
      where,
      `sauce tx on ${chain}, a preview chain, is not refused with its chain-support request ` +
        `(exit ${tx.code}): ${diagnostic(tx.stderr || tx.stdout)}`,
    );
}

/** A program whose header predates the header rules, with the reason; an unneeded one fails. */
const HEADER_EXEMPT = {};
const headerExemptUsed = new Set();
/** Fails each of `problems`, unless the program is exempt, which then counts as needed. */
const headerProblems = (where, file, problems) => {
  const entry = relative(SKILLS_DIR, file).split("\\").join("/");
  if (problems.length === 0) return;
  if (Object.hasOwn(HEADER_EXEMPT, entry)) headerExemptUsed.add(entry);
  else for (const problem of problems) fail(where, problem);
};

/** The leading comment block of a program: its header. */
const headerOf = (file) => {
  const lines = read(file).split("\n");
  const end = lines.findIndex((line) => !line.startsWith("//"));
  return lines.slice(0, end < 0 ? lines.length : end);
};

/**
 * Runs a program's command line offline on `chain`: compiles it, and on an EVM chain builds the
 * cook (refused on a preview chain: `txOn`). `header` (once per program, on its usage line) also
 * holds the header to `main`: the usage line's `--args` are `<name>` for each of its parameters,
 * in order, and the header has a line per parameter, `//   name: Type …`.
 */
async function runUsage(where, file, argv, chain, header = false) {
  const [name, , ...rest] = argv;
  const at = rest.indexOf("--args");
  const options = at < 0 ? rest : rest.slice(0, at);
  const args = at < 0 ? undefined : rest.slice(at + 1);
  const kept = [];
  const accounts = [];
  for (let i = 0; i < options.length; i++) {
    const flag = options[i];
    const value = options[i + 1];
    if (flag === "--intent-execution-fee" && value === "auto") {
      // `auto` reads the destination's Kitchen fee through --config; offline there is no endpoint,
      // and the fee changes only the cook's value, so the run takes 0.
      kept.push(flag, "0");
      i++;
    } else if (flag === "--define" || /^--intent-/.test(flag) || flag === "--defines") {
      kept.push(flag, fill(value));
      i++;
    } else if (flag === "--account") {
      accounts.push(value.split("=")[0]);
      i++;
    } else if (flag === "--compact-args") kept.push(flag);
    else if (/^--/.test(flag) && value !== undefined && !value.startsWith("-")) i++;
  }
  if (/\.reward\(/.test(read(file)) && !kept.includes("--intent-deadline"))
    fail(
      where,
      "opens an intent, so its usage line must give --intent-deadline and --intent-creator",
    );
  const compiled = await compileJson(file, chain, kept);
  if (compiled.error !== undefined) {
    fail(where, `does not compile for ${chain}: ${compiled.error}`);
    return;
  }
  counts.programRuns++;
  const { entryParams = [], target, manifest } = compiled.json;
  if (args !== undefined && args.length !== entryParams.length) {
    fail(where, `passes ${args.length} --args, but main takes ${entryParams.length}`);
    return;
  }
  if (args === undefined && entryParams.length > 0 && name !== "compile") {
    fail(where, `main takes ${entryParams.length} arguments, and the usage passes no --args`);
    return;
  }
  if (header) {
    const problems = [];
    const names = entryParams.map((param) => `<${param.name}>`);
    if ((args ?? []).join(" ") !== names.join(" "))
      problems.push(
        `its usage line passes --args ${(args ?? []).join(" ")}; it names main's parameters, in ` +
          `order: --args ${names.join(" ")}`,
      );
    const lines = headerOf(file);
    for (const param of entryParams) {
      if (!lines.some((line) => new RegExp(`^//\\s+${param.name}: \\S`).test(line)))
        problems.push(
          `its header says nothing of \`${param.name}\`: give a line \`//   ${param.name}: ` +
            `${param.type}  what it is, and its units\``,
        );
    }
    headerProblems(where, file, problems);
  }
  if (target === "svm") {
    const slots = (manifest?.accounts ?? []).filter((a) => a.kind === "slot").map((a) => a.name);
    if (["run", "simulate", "tx"].includes(name) && slots.join() !== accounts.join())
      fail(where, `names --account ${accounts.join(", ")}, but main takes ${slots.join(", ")}`);
    return;
  }
  if (!["run", "simulate", "tx"].includes(name)) return;
  const values = (args ?? []).map((word, i) =>
    /<[^>]+>/.test(word) ? sample(entryParams[i].type) : word,
  );
  await txOn(where, chain, [
    "tx",
    file,
    "--chain",
    chain,
    ...kept,
    "--owner",
    DEV,
    "--value",
    "0",
    ...(values.length === 0 ? [] : ["--args-json", JSON.stringify(values)]),
  ]);
}

/**
 * An actions document, lowered through `sauce actions` on each of `chains`, and its cook built by
 * `sauce tx` with `main`'s arguments (its `argument` actions) sampled — as the skill tells an agent
 * to run it, and refused on a preview chain (`txOn`). A document names no chain: `--chain` picks
 * one.
 */
async function runDocument(where, file, chains) {
  let document;
  try {
    document = JSON.parse(read(file));
  } catch (error) {
    fail(where, `is not JSON: ${error.message}`);
    return;
  }
  if (!Array.isArray(document?.actions)) {
    fail(where, "is not an actions document: a JSON object with an `actions` array");
    return;
  }
  if (document.chainId !== undefined)
    fail(where, "names its chain (`chainId`); a document in a skill takes it from --chain");
  for (const chain of chains) {
    const lowered = await sauce(["actions", file, "--chain", chain, "--json"]);
    if (lowered.code !== 0) {
      fail(where, `does not lower for ${chain}: ${diagnostic(lowered.stderr || lowered.stdout)}`);
      continue;
    }
    counts.programRuns++;
    const { entryParams = [] } = JSON.parse(lowered.stdout);
    const args = entryParams.map((param) => sample(param.type));
    await txOn(where, chain, [
      "tx",
      file,
      "--chain",
      chain,
      "--owner",
      DEV,
      "--value",
      "0",
      ...(args.length === 0 ? [] : ["--args-json", JSON.stringify(args)]),
    ]);
  }
}

for (const skill of skills) {
  for (const file of skill.programs) {
    const entry = `${skill.dir}/examples/${basename(file)}`;
    const where = rel(file);
    const usage = commandLines(
      read(file)
        .split("\n")
        .filter((line) => line.startsWith("//")),
    );
    if (usage.length === 0) {
      fail(where, "has no usage line: a `//   sauce <command> <this file> …` comment");
      continue;
    }
    // The usage line takes `--chain <chain>`, and is run on every chain the index names; an
    // example line names a supported chain, with real values, and is run there.
    const usageLines = [];
    const examples = [];
    for (const given of usage) {
      if (!checkCommand(where, given)) continue;
      const argv = joinVerb(given);
      if (argv[1] !== basename(file))
        fail(where, `its usage line runs ${argv[1]}, not ${basename(file)}`);
      const chainAt = argv.indexOf("--chain");
      const named = chainAt < 0 ? undefined : argv[chainAt + 1];
      if (named === "<chain>") usageLines.push(argv);
      else if (named !== undefined && support.isSupportedChain(named))
        examples.push({ argv, chain: named });
      else
        fail(
          where,
          `its command line names --chain ${named ?? "nothing"}: the usage line takes ` +
            "`--chain <chain>` (a program names none), and an example a supported chain",
        );
    }
    if (usageLines.length === 0)
      fail(where, "has no usage line: `//   sauce <command> <this file> --chain <chain> …`");
    if (examples.length === 0)
      headerProblems(where, file, [
        "has no example line: the command again, on a supported chain with real values " +
          "(addresses the SDK records, the developer's own inputs as <placeholders>)",
      ]);
    if (/^\s*\/\/\s*@(?:chain|target)\b/m.test(read(file)))
      fail(where, "names its chain in a header; a program takes it from --chain");
    for (const [n, chain] of (programChains.get(entry) ?? []).entries()) {
      for (const argv of usageLines) await runUsage(where, file, argv, chain, n === 0);
    }
    for (const { argv, chain } of examples) await runUsage(where, file, argv, chain);
  }
  for (const file of skill.documents) {
    const entry = `${skill.dir}/examples/${basename(file)}`;
    await runDocument(rel(file), file, programChains.get(entry) ?? []);
  }
  // Every other command line: in shell blocks, inline code, and every file of the skill.
  for (const block of skill.blocks.filter((b) => ["sh", "bash", "shell"].includes(b.lang))) {
    for (const argv of commandLines(block.body.split("\n")))
      checkCommand(`${rel(skill.path)}:${block.line}`, argv);
  }
  for (const span of inlineCode(skill)) {
    for (const argv of commandLines([span])) checkCommand(rel(skill.path), argv);
  }
  for (const file of skill.runners) {
    for (const argv of commandLines(
      read(file)
        .split("\n")
        .filter((l) => /^\s*\/\//.test(l)),
    ))
      checkCommand(rel(file), argv);
  }
}

for (const [entry, why] of Object.entries(HEADER_EXEMPT)) {
  if (allExamples.has(entry) && !headerExemptUsed.has(entry))
    fail(
      "check-skills.mjs HEADER_EXEMPT",
      `exempts ${entry} (${why}), whose header now follows the rules: remove the exemption`,
    );
}

// ---- 6. SauceScript blocks ---------------------------------------------------------------------------
const SCRATCH = mkdtempSync(join(tmpdir(), "sauce-skills-check-"));
const sauceSources = []; // { where, text } for the globals check below
try {
  let n = 0;
  for (const skill of skills) {
    for (const block of [
      ...skill.blocks.filter((b) => b.lang === "sauce"),
      ...skill.referenceBlocks,
    ]) {
      const where = `${rel(block.file)}:${block.line}`;
      const mustFail = block.info.includes("fails");
      if (mustFail) counts.sauceFails++;
      else counts.sauce++;
      const option = (key) =>
        block.info.find((i) => i.startsWith(`${key}=`))?.slice(key.length + 1);
      const chains = option("chain")?.split(",");
      const defines = option("define")?.split(",") ?? [];
      sauceSources.push({ where, text: block.body, defines });
      const errors = [];
      if (chains !== undefined) {
        const file = join(SCRATCH, `block-${n++}.sauce.ts`);
        writeFileSync(file, `${block.body}\n`);
        const intents = /\.reward\(/.test(block.body)
          ? ["--intent-deadline", DEADLINE, "--intent-creator", DEV, "--intent-execution-fee", "0"]
          : [];
        for (const chain of chains) {
          const flags = [...defines.flatMap((d) => ["--define", `${d}=${DEV}`]), ...intents];
          const compiled = await compileJson(file, chain, flags);
          if (compiled.error !== undefined) errors.push(`${chain}: ${compiled.error}`);
        }
      } else {
        const target = option("target") ?? "evm";
        const entry = new TextEncoder().encode(block.body);
        try {
          compilerApi.compile({
            target,
            entry: "main.ts",
            resolve: (path) => (path === "main.ts" ? entry : compilerApi.resolveSdkModule(path)),
            resolvePackage: compilerApi.resolveSdkPackage,
          });
        } catch (error) {
          errors.push(diagnostic(error.message));
        }
      }
      if (mustFail && errors.length === 0)
        fail(where, "```sauce fails block compiled, but the skill says it is refused");
      if (!mustFail) for (const error of errors) fail(where, `does not compile: ${error}`);
    }
    for (const block of skill.blocks.filter(
      (b) => b.lang === "json" && chainsOf(b) !== undefined,
    )) {
      const where = `${rel(skill.path)}:${block.line}`;
      const mustFail = block.info.includes("fails");
      if (mustFail) counts.sauceFails++;
      else counts.sauce++;
      const file = join(SCRATCH, `document-${n++}.json`);
      writeFileSync(file, `${block.body}\n`);
      const errors = [];
      for (const chain of chainsOf(block)) {
        const lowered = await sauce(["actions", file, "--chain", chain, "--json"]);
        if (lowered.code !== 0) errors.push(`${chain}: ${diagnostic(lowered.stderr)}`);
      }
      if (mustFail && errors.length === 0)
        fail(where, "```json fails block lowered, but the skill says it is refused");
      if (!mustFail) for (const error of errors) fail(where, `does not lower: ${error}`);
    }
    for (const file of skill.programs) {
      const text = read(file);
      // The names its usage line defines are values, not tokens.
      const defines = [...text.matchAll(/--define\s+([A-Za-z_]\w*)=/g)].map((m) => m[1]);
      sauceSources.push({ where: rel(file), text, defines });
    }
  }
} finally {
  rmSync(SCRATCH, { recursive: true, force: true });
}

// ---- 6b. TypeScript: runners, then ```ts blocks ----------------------------------------------------------
const TS_OPTIONS = {
  target: ts.ScriptTarget.ES2022,
  lib: ["lib.es2023.d.ts"],
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  types: ["node"],
  typeRoots: [NODE_TYPES],
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  verbatimModuleSyntax: true,
  erasableSyntaxOnly: true,
  allowImportingTsExtensions: true,
  forceConsistentCasingInFileNames: true,
};
function diagnose(program, mapLocation) {
  for (const d of ts.getPreEmitDiagnostics(program)) {
    const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    if (!d.file) {
      fail("typescript", message);
      continue;
    }
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
    fail(mapLocation(d.file.fileName, line, character), `TS${d.code} ${message}`);
  }
}
const runners = skills.flatMap((s) => s.runners);
diagnose(
  ts.createProgram(runners, { ...TS_OPTIONS, noUnusedLocals: true }),
  (file, line, col) => `${rel(file)}:${line + 1}:${col + 1}`,
);
// Blocks are written beside the skills so they resolve the package exactly as the runners do.
const BLOCKS = join(SKILLS_DIR, ".skills-check");
rmSync(BLOCKS, { recursive: true, force: true });
mkdirSync(BLOCKS, { recursive: true });
try {
  const origin = new Map();
  for (const skill of skills) {
    skill.blocks.forEach((block, i) => {
      if (block.lang !== "ts") return;
      counts.ts++;
      const file = join(BLOCKS, `${skill.dir}__${i}.mts`);
      writeFileSync(file, `${block.body}\n`);
      origin.set(file, { skill, block });
    });
  }
  diagnose(
    ts.createProgram([...origin.keys()], {
      ...TS_OPTIONS,
      moduleDetection: ts.ModuleDetectionKind.Force,
    }),
    (file, line, col) => {
      const from = origin.get(file);
      return from
        ? `${rel(from.skill.path)}:${from.block.line + line}:${col + 1}`
        : `${rel(file)}:${line + 1}`;
    },
  );
} finally {
  rmSync(BLOCKS, { recursive: true, force: true });
}

// ---- 6c. Execute every runner, offline ------------------------------------------------------------------
for (const file of runners) {
  counts.runners++;
  for (const m of read(file).matchAll(/(?:from|import\()\s*"([^"]+)"|new URL\("([^"]+)"/g)) {
    const specifier = m[1] ?? m[2];
    // Its examples, its references, and its own SKILL.md, whose values a runner may pin.
    if (specifier.startsWith(".") && !/^\.\/|^\.\.\/references\/|^\.\.\/SKILL\.md$/.test(specifier))
      fail(rel(file), `reaches ${specifier}; a runner uses only files of its own skill`);
  }
  // The developer's inputs, exactly as the runner's usage line (`//   node <file> --flag <what>`)
  // names them: the dev account for an address, 0 for a fee in wei.
  const usage = /^\/\/\s+node \S+\.mts((?: --[\w-]+ <[^>]+>)*)\s*$/m.exec(read(file))?.[1] ?? "";
  const inputs = [...usage.matchAll(/--([\w-]+) <([^>]+)>/g)].flatMap(([, name, what]) => [
    `--${name}`,
    fill(`<${what}>`),
  ]);
  const run = spawnSync(
    process.execPath,
    ["--import", join(HERE, "skills-check", "offline-guard.mjs"), file, ...inputs],
    { encoding: "utf8", timeout: 180_000, cwd: dirname(file) },
  );
  if (run.status !== 0) {
    const lines = `${run.stderr ?? ""}${run.stdout ?? ""}`.trim().split("\n");
    const at = lines.findIndex((line) => /\b\w*Error\b|check failed/.test(line));
    const tail = (at === -1 ? lines.slice(-6) : lines.slice(at, at + 3)).join("\n    ");
    fail(rel(file), `exited ${run.status ?? run.signal}:\n    ${tail}`);
  }
}

// ---- 7. Subpaths, shipped paths, namespace members, identifiers -------------------------------------
const subpathCache = new Map();
async function subpathResolves(sub) {
  if (!subpathCache.has(sub)) {
    // A `<placeholder>` segment (e.g. `/protocols/<slug>`) stands for the export pattern's `*`.
    const key = sub === "" ? "." : `.${sub.replace(/<[^>]+>/g, "*")}`;
    const pattern = exportKeys.find((k) => k.endsWith("/*") && key.startsWith(k.slice(0, -1)));
    const ok = exportKeys.includes(key)
      ? true
      : pattern !== undefined &&
        !key.includes("*") &&
        (await load(`${PKG}${sub}`).then(
          () => true,
          () => false,
        ));
    subpathCache.set(sub, ok);
  }
  return subpathCache.get(sub);
}
for (const skill of skills) {
  for (const file of walk(join(SKILLS_DIR, skill.dir), (f) => /\.(?:md|mts|ts)$/.test(f))) {
    const text = read(file);
    for (const m of text.matchAll(
      /(?<!node_modules\/)@eco-incorp\/sauce(?![\w-])((?:\/[\w.*<>{}-]+)*)/g,
    )) {
      const sub = m[1].replace(/[.]+$/, "");
      if (/[{}]/.test(sub)) continue; // a template in a protocol document
      counts.subpaths++;
      if (!(await subpathResolves(sub)))
        fail(rel(file), `names ${PKG}${sub}, which the package does not export`);
    }
    for (const m of text.matchAll(/node_modules\/@eco-incorp\/sauce\/([\w./-]+)/g)) {
      const path = m[1].replace(/[.,)]+$/, "");
      if (!existsSync(join(SDK_DIR, path)))
        fail(rel(file), `points at node_modules/${PKG}/${path}, which the package does not ship`);
    }
  }
}

const NAMESPACES = {
  routes: sdk.routes,
  token: sdk.token,
  deposit: sdk.deposit,
  contracts: sdk.contracts,
  svmVenues: sdk.svmVenues,
};
const KNOWN = new Set();
const COMPILER_DIR = packageRoot(
  createRequire(join(SDK_DIR, "package.json")).resolve("sauce-compiler"),
  "@eco-incorp/sauce-compiler",
);
for (const file of [
  ...walk(join(SDK_DIR, "sdk", "dist"), (p) => p.endsWith(".d.ts")),
  ...walk(join(SDK_DIR, "actions", "dist"), (p) => p.endsWith(".d.ts")),
  // The MCP server's tool and input names, which a skill may name as `sauce mcp` serves them.
  ...walk(join(SDK_DIR, "mcp", "dist"), (p) => p.endsWith(".js")),
  ...walk(join(SDK_DIR, "sdk", "dist", "std"), (p) => p.endsWith(".js")),
  ...walk(join(SDK_DIR, "sdk", "dist", "artifacts"), (p) => p.endsWith(".json")),
  ...walk(join(SDK_DIR, "sdk", "dist", "protocols"), (p) => /\.(json|js)$/.test(p)),
  ...walk(join(SDK_DIR, "docs", "examples"), (p) => p.endsWith(".ts")),
  ...walk(join(COMPILER_DIR, "node"), (p) => p.endsWith(".d.ts")),
  join(SDK_DIR, "actions", "action-program.schema.json"),
  ...skills.flatMap((s) => s.examples),
  join(SKILLS_DIR, "sauce-script", "references", "builtins.md"),
].filter(existsSync)) {
  for (const m of read(file).matchAll(/[A-Za-z_$][\w$]*/g)) KNOWN.add(m[0]);
}
// SauceScript keywords and builtins, JavaScript keywords, and tool names.
for (const word of `main require throw ctx evm svm abi hex Math self catch at owner dataLen Uint256
  Address Account Writable Signer bytes bool string void true false null undefined bigint number
  boolean const let function return if else for while break continue of in new import from export
  default interface type await async typeof pnpm node npm npx tsc git cast sauce`.split(/\s+/))
  KNOWN.add(word);
for (const skill of skills) {
  const allow = allowed(skill);
  for (const span of inlineCode(skill)) {
    // A command line's words are file names and flags, checked against `--help` (5), not exports.
    if (/^(?:npx )?sauce\s/.test(span)) continue;
    for (const m of span.matchAll(
      /\b(routes|token|deposit|contracts|svmVenues)\.([A-Za-z_$][\w$]*)/g,
    )) {
      if (!(m[2] in NAMESPACES[m[1]]) && !KNOWN.has(m[2]))
        fail(rel(skill.path), `\`${m[1]}.${m[2]}\` is not in the package's ${m[1]}`);
    }
    const head = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:\(|$)/.exec(span);
    if (!head) continue;
    for (const part of head[1].split(".")) {
      if (/^[A-Z][A-Z0-9_]*$/.test(part)) continue; // ALL_CAPS: defines and constants by convention
      if (/^[A-Z][A-Za-z0-9]*_[A-Z][A-Za-z0-9]*$/.test(part)) continue; // a Namespace_Contract define
      counts.identifiers++;
      if (KNOWN.has(part)) continue;
      if (allow.has(part)) undeclaredUsed.add(`${skill.dir}/${part}`);
      else
        fail(
          rel(skill.path),
          `inline code \`${span}\` names "${part}", which the package never declares`,
        );
    }
  }
  if (/<!--\s*check:/.test(skill.text))
    fail(rel(skill.path), "carries a check marker; the checker's exceptions live in the checker");
}
for (const [dir, names] of Object.entries(UNDECLARED_NAMES)) {
  if (!skills.some((skill) => skill.dir === dir)) continue;
  for (const name of Object.keys(names))
    if (!undeclaredUsed.has(`${dir}/${name}`))
      fail(
        `check-skills.mjs UNDECLARED_NAMES`,
        `${dir} no longer names "${name}"; remove the exception`,
      );
}

// ---- 8. The index of globals: fresh, compilable, and covering every use ---------------------------------
const GLOBALS = REFERENCES.globals;
const REFERENCE = join(SKILLS_DIR, "sauce-globals", "references");
{
  const files = RENDERED;
  for (const [name, text] of Object.entries(files)) {
    const path = join(SKILLS_DIR, name);
    if (!existsSync(path) || read(path) !== text)
      fail(
        rel(path),
        "is stale: rebuild the SDK (`gen-skills-references.mjs` writes it) and commit it",
      );
  }
  for (const sub of GENERATED_DIRS) {
    for (const name of existsSync(join(SKILLS_DIR, sub)) ? readdirSync(join(SKILLS_DIR, sub)) : [])
      if (name.endsWith(".md") && !(`${sub}/${name}` in files))
        fail(rel(join(SKILLS_DIR, sub, name)), "is generated by nothing: rebuild the SDK");
  }
  // Solana writes a key in base58. Where a generated file shows a Solana key as 32 bytes of hex (the
  // value a program holds), the same line shows its base58 form: a Solana chain's own file, and a
  // registry row that links one.
  const svmFiles = REFERENCES.chains
    .filter((chain) => chain.kind === "svm")
    .map((chain) => `${chain.slug}.md`);
  for (const [name, text] of Object.entries(files)) {
    const svmFile = svmFiles.some((file) => name === `sauce-chains/references/${file}`);
    for (const [index, line] of text.split("\n").entries()) {
      if (!svmFile && !svmFiles.some((file) => line.includes(`references/${file})`))) continue;
      if (/`0x[0-9a-fA-F]{64}`/.test(line) && !/`[1-9A-HJ-NP-Za-km-z]{32,44}`/.test(line))
        fail(
          `${rel(join(SKILLS_DIR, name))}:${index + 1}`,
          "shows a Solana key in hex with no base58 beside it",
        );
    }
  }
}
{
  // Everything listed compiles on the chains it is listed for, by name and as its define.
  const perChain = new Map();
  const add = (slug, expression) =>
    (perChain.get(slug) ?? perChain.set(slug, []).get(slug)).push(expression);
  for (const contract of GLOBALS.contracts)
    for (const slug of contract.chains) {
      add(slug, contract.name);
      add(slug, contract.name.replace(".", "_"));
    }
  for (const alias of GLOBALS.aliases)
    for (const { chains } of alias.targets) for (const slug of chains) add(slug, alias.name);
  for (const entry of GLOBALS.tokens)
    for (const token of entry.tokens) add(entry.chain.slug, token.symbol);
  const program = (list) =>
    `function main() {\n${list.map((e) => `  require(${e} != 0n);`).join("\n")}\n}`;
  // An interface is called with an address and a method in the same expression, on any EVM chain.
  const evmChain = GLOBALS.chains.find((chain) => chain.kind === "evm")?.slug;
  for (const one of GLOBALS.interfaces) {
    if (one.call === undefined || evmChain === undefined) continue;
    const args = one.call.inputs
      .split(",")
      .filter((type) => type !== "")
      .map((type) => (type === "bool" ? "false" : "0n"));
    try {
      sdk.routes.compileSauceProgram(
        evmChain,
        `function main(target: Address) {\n  ${one.name}(target).${one.call.name}(${args.join(", ")});\n}`,
      );
      counts.indexed++;
    } catch (error) {
      fail(
        rel(REFERENCE),
        `lists ${one.name}, whose call does not compile: ${diagnostic(error.message)}`,
      );
    }
  }
  for (const [slug, expressions] of perChain) {
    try {
      sdk.routes.compileSauceProgram(slug, program(expressions));
      counts.indexed += expressions.length;
    } catch {
      for (const expression of expressions) {
        try {
          sdk.routes.compileSauceProgram(slug, program([expression]));
        } catch (error) {
          fail(
            rel(REFERENCE),
            `lists ${expression} on ${slug}, which does not compile there: ${diagnostic(error.message)}`,
          );
        }
      }
    }
  }

  // Every global a program, a SauceScript block or inline code uses is listed.
  const contracts = new Set(GLOBALS.contracts.map((c) => c.name));
  const aliases = new Set(GLOBALS.aliases.map((a) => a.name));
  const interfaces = new Set(GLOBALS.interfaces.map((one) => one.name));
  const namespaces = new Set([...contracts, ...aliases, ...interfaces].map((n) => n.split(".")[0]));
  const symbols = new Set(GLOBALS.tokens.flatMap((entry) => entry.tokens.map((t) => t.symbol)));
  const chainNames = new Set(GLOBALS.chains.map((c) => c.key));
  // A family's member namespaces, from the contracts its aliases name: `Uniswap` -> UniswapV2, …
  const members = new Map();
  for (const alias of GLOBALS.aliases) {
    const family = alias.name.split(".")[0];
    for (const { target } of alias.targets) {
      members.set(family, new Set([...(members.get(family) ?? []), target.split(".")[0]]));
    }
  }
  // A family name no member resolves alone, such as `Uniswap.Factory`: ambiguous, which prose may
  // say, but a program may not use.
  const ambiguous = (name) => {
    const [family, contract] = name.split(".");
    return [...(members.get(family) ?? [])].some((ns) => contracts.has(`${ns}.${contract}`));
  };
  // The globals index leaves the eco-routes namespace out: a program opens an intent with the chain
  // syntax, never by calling the Portal. The one exception is the skill that names the Portal, for
  // an intent built elsewhere: `fund-by-transfer.sauce.ts` publishes one through the registry's
  // Portal by name rather than by hand-written selectors. Each entry must still be used.
  const PORTAL_GLOBALS = new Set(["EcoRoutes.Portal"]);
  const portalGlobalsUsed = new Set();
  const inIntentsSkill = (where) => where.split(/[\\/]/).includes(INTENTS_SKILL);
  const uses = (where, text, strict, defines = []) => {
    const imported = new Set(
      [...text.matchAll(/import\s+(?:\{([^}]*)\}|([A-Za-z_$][\w$]*))\s+from/g)].flatMap((m) =>
        m[1]
          ? m[1].split(",").map((part) =>
              part
                .trim()
                .split(/\s+as\s+/)
                .pop(),
            )
          : [m[2]],
      ),
    );
    for (const m of text.matchAll(
      /(?<![\w.])([A-Z][A-Za-z0-9]*)\.([A-Z][A-Za-z0-9]*)(?:\.([A-Z][A-Za-z0-9]*))?/g,
    )) {
      const [first, second, third] = [m[1], m[2], m[3]];
      const name = chainNames.has(first) && third ? `${second}.${third}` : `${first}.${second}`;
      if (
        imported.has(first) ||
        ["Math", "Token"].includes(first) ||
        (chainNames.has(first) && !third)
      )
        continue;
      if (PORTAL_GLOBALS.has(name) && inIntentsSkill(where)) {
        portalGlobalsUsed.add(name);
        continue;
      }
      if (!strict && (!namespaces.has(name.split(".")[0]) || ambiguous(name))) continue; // prose may name what fails
      if (!contracts.has(name) && !aliases.has(name) && !interfaces.has(name))
        fail(where, `uses the global ${name}, which the index does not list`);
    }
    const declared = new Set([
      ...[...text.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\b/g)].map((m) => m[1]),
      ...defines,
    ]);
    for (const m of [
      ...text.matchAll(
        /(?<![\w.])([A-Z][A-Z0-9]{2,})\.(?:transfer|transferFrom|approve|balanceOf)\(/g,
      ),
      ...text.matchAll(/\bself\.([A-Z][A-Z0-9]{2,})\b/g),
      ...text.matchAll(
        /(?<![\w.])(?:transfer|transferFrom|approve|balanceOf|allowance)\(([A-Z][A-Z0-9]{2,})\b/g,
      ),
      ...text.matchAll(/\btoken:\s*([A-Z][A-Z0-9]{2,})\b/g),
    ]) {
      if (!declared.has(m[1]) && !symbols.has(m[1]))
        fail(where, `uses the token ${m[1]}, which the index does not list`);
    }
  };
  for (const { where, text, defines } of sauceSources) uses(where, text, true, defines);
  for (const skill of skills)
    for (const span of inlineCode(skill)) uses(rel(skill.path), span, false);
  for (const name of PORTAL_GLOBALS) {
    if (!portalGlobalsUsed.has(name))
      fail(INTENTS_SKILL, `no longer uses ${name}: drop it from the checker's PORTAL_GLOBALS`);
  }
}

// ---- 9. The SauceScript reference: every example compiles, every rejection is refused ---------------------
const REFERENCE_MD = join(SKILLS_DIR, "sauce-script", "references", "builtins.md");
const REFERENCE_JSON = join(SKILLS_DIR, "sauce-script", "references", "builtins.json");
let builtinExamples = 0;
let builtinRejections = 0;
if (!existsSync(REFERENCE_MD)) fail(rel(REFERENCE_MD), "missing: the SauceScript reference");
else {
  const found = checkBuiltins(read(REFERENCE_MD), compilerApi, fail, rel(REFERENCE_MD));
  builtinExamples += found.examples;
  builtinRejections += found.rejected;
  if (!existsSync(REFERENCE_JSON))
    fail(rel(REFERENCE_JSON), "missing: the reference's builtin list");
  else {
    const listed = checkBuiltinsJson(
      JSON.parse(read(REFERENCE_JSON)),
      compilerApi,
      fail,
      rel(REFERENCE_JSON),
    );
    builtinExamples += listed.compiled;
    builtinRejections += listed.rejected;
  }
}

// ---- 10. The actions reference: what the shipped schema renders ------------------------------------------
{
  const reference = join(SKILLS_DIR, "sauce-actions", "references", "actions.md");
  const schema = join(SDK_DIR, "actions", "action-program.schema.json");
  if (!existsSync(reference)) fail(rel(reference), "missing: the actions reference");
  else if (read(reference) !== renderActionsReference(JSON.parse(read(schema))))
    fail(
      rel(reference),
      "is stale: rebuild the SDK (`gen-skills-actions.mjs` writes it from the actions schema) and commit it",
    );
}

// ---- 11. Which example programs a suite executes ----------------------------------------------------------
// Compiling a program is not running it: `skills-check/executed.json` names the suites that execute
// each one on an engine, or says why none does yet. The suites are this repository's, so a check of
// another skills directory (`--skills`) skips it.
const examplePrograms = walk(SKILLS_DIR, (file) => file.endsWith(".sauce.ts"))
  .map((file) => relative(SKILLS_DIR, file))
  .filter((file) => /^[^/]+\/examples\/[^/]+$/.test(file));
let executedExamples = 0;
if (skillsFlag < 0) {
  const manifest = join(HERE, "skills-check", "executed.json");
  for (const problem of executedExamplesProblems({
    repository: REPOSITORY,
    examplesRoot: SKILLS_DIR,
    examples: examplePrograms,
    manifest,
  })) {
    fail(rel(manifest), problem);
  }
  executedExamples = Object.keys(JSON.parse(read(manifest)).executed).length;
}

// ---- 12. Example programs write what the registry names by its name --------------------------------------
// No address the registry records as a literal, and no hand-built selector of a function a binding
// declares (`docs/scripts/example-programs.mjs`). A deliberately low-level call is listed here:
// example -> selector -> why. An entry nothing needs any more fails.
const LOW_LEVEL_CALLS = {};
{
  const names = registryNames(
    sdk,
    await Promise.all(
      sdk.listProtocolSlugs().map(async (slug) => [slug, await load(`${PKG}/protocols/${slug}`)]),
    ),
  );
  for (const program of examplePrograms) {
    const lowLevel = LOW_LEVEL_CALLS[program] ?? {};
    const used = new Set();
    for (const problem of namedProgramProblems({
      where: rel(join(SKILLS_DIR, program)),
      source: read(join(SKILLS_DIR, program)),
      names,
      lowLevel,
      used,
    })) {
      failures.push(problem);
    }
    for (const selector of Object.keys(lowLevel)) {
      if (!used.has(selector))
        fail(
          "check-skills.mjs LOW_LEVEL_CALLS",
          `allows ${selector} in ${program}, which no longer builds it: remove the entry`,
        );
    }
  }
  for (const program of Object.keys(LOW_LEVEL_CALLS)) {
    if (!examplePrograms.includes(program))
      fail("check-skills.mjs LOW_LEVEL_CALLS", `names ${program}, which is not an example program`);
  }
}

// ---- Report ----------------------------------------------------------------------------------------------
const summary =
  `${counts.skills} skills, ${counts.files} files read; ${counts.programRuns} program runs through sauce ` +
  `(${counts.refusals} cooks refused on preview chains), ` +
  `${counts.commands} sauce command lines checked; ${counts.sauce} sauce blocks compiled, ` +
  `${counts.sauceFails} refused as documented; ${counts.ts} ts blocks typechecked; ${counts.runners} runners ` +
  `executed offline; ${counts.indexed} indexed globals compiled on their chains; ${builtinExamples} ` +
  `reference examples compiled and ${builtinRejections} rejections refused; ${counts.subpaths} subpaths, ` +
  `${counts.identifiers} inline identifiers and ${counts.addresses} addresses checked; ` +
  `${executedExamples} example programs executed by a suite; against ` +
  `${PKG}@${sdkPkg.version}`;
if (failures.length > 0) {
  console.error(
    `\nskills check FAILED (${failures.length}):\n- ${failures.join("\n- ")}\n\n${summary}`,
  );
  process.exit(1);
}
console.log(`skills check OK: ${summary}`);
