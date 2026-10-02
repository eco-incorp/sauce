/**
 * `sauce skills install | update | status` and `sauce init`: one packaged source of Agent Skills,
 * written where each coding agent reads them, with a record of what was written so that a package
 * upgrade and a user's edit are told apart.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { initProject, sauceScriptTsconfig } from "../src/cli/init.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import {
  DEFAULT_AGENTS,
  INSTALL_RECORD,
  installTarget,
  PACKAGED_SKILLS,
  parseAgents,
  statusOf,
  targetsFor,
  updateTarget,
  withoutBlock,
  type SkillsSource,
} from "../src/cli/skills.js";

const SDK = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = JSON.parse(readFileSync(join(SDK, "..", "package.json"), "utf8")) as {
  name: string;
  version: string;
};

let work: string;
let project: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "sauce-skills-"));
  project = join(work, "project");
  mkdirSync(project);
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

const read = (path: string): string => readFileSync(join(project, path), "utf8");
const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), text);
};

async function sauce(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    ...nodeIo(),
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
    run: () => 0,
  };

  return { code: await runCli(argv, io), stdout, stderr };
}

/** A package of two skills at `version`, whose files a test can then change. */
function packageAt(version: string): SkillsSource {
  const dir = join(work, "packaged");
  if (!existsSync(dir)) {
    mkdirSync(join(dir, "alpha", "examples"), { recursive: true });
    mkdirSync(join(dir, "beta"), { recursive: true });
    writeFileSync(
      join(dir, "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: Does alpha things.\n---\n\nalpha v1\n",
    );
    writeFileSync(join(dir, "alpha", "examples", "one.sauce.ts"), "one v1\n");
    writeFileSync(
      join(dir, "beta", "SKILL.md"),
      "---\nname: beta\ndescription: Does beta things.\n---\n\nbeta v1\n",
    );
  }

  return { dir, packageName: "@eco-incorp/sauce", version };
}

describe("where each agent's skills go", () => {
  it("claude reads .claude/skills; codex, cursor, copilot and gemini share .agents/skills", () => {
    expect(targetsFor(["claude"])).toEqual([
      { kind: "directory", path: join(".claude", "skills"), agents: ["claude"] },
    ]);
    expect(targetsFor(["codex", "cursor", "copilot", "gemini"])).toEqual([
      {
        kind: "directory",
        path: join(".agents", "skills"),
        agents: ["codex", "cursor", "copilot", "gemini"],
      },
    ]);
    expect(targetsFor(["agents-md"])).toEqual([
      { kind: "directory", path: join(".agents", "skills"), agents: ["agents-md"] },
      { kind: "index", path: "AGENTS.md", agents: ["agents-md"] },
    ]);
  });

  it("writes each target's files where the agent reads them, with the record of what it wrote", () => {
    const source = packageAt("1.0.0");
    for (const target of targetsFor(["claude", "codex", "agents-md"])) {
      installTarget(project, source, target);
    }
    for (const dir of [".claude/skills", ".agents/skills"]) {
      expect(read(`${dir}/alpha/SKILL.md`)).toMatch(/alpha v1/);
      expect(read(`${dir}/alpha/examples/one.sauce.ts`)).toBe("one v1\n");
      expect(read(`${dir}/beta/SKILL.md`)).toMatch(/beta v1/);
      expect(JSON.parse(read(`${dir}/${INSTALL_RECORD}`))).toMatchObject({
        package: "@eco-incorp/sauce",
        version: "1.0.0",
        files: {
          "alpha/SKILL.md": expect.stringMatching(/^[0-9a-f]{64}$/),
          "alpha/examples/one.sauce.ts": expect.stringMatching(/^[0-9a-f]{64}$/),
          "beta/SKILL.md": expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      });
    }
    const index = read("AGENTS.md");
    expect(index).toMatch(
      /^<!-- sauce-skills:begin @eco-incorp\/sauce@1\.0\.0 sha256=[0-9a-f]{64} -->$/m,
    );
    expect(index).toContain("- **alpha** (`.agents/skills/alpha/SKILL.md`): Does alpha things.");
    expect(index).toContain("- **beta** (`.agents/skills/beta/SKILL.md`): Does beta things.");
    expect(index.trimEnd().endsWith("<!-- sauce-skills:end -->")).toBe(true);
  });

  it("`all` is every agent that reads a skills directory: two directories, no AGENTS.md index", () => {
    expect(parseAgents(["all"])).toEqual(["claude", "codex", "cursor", "copilot", "gemini"]);
    expect(parseAgents(["all"])).toEqual(DEFAULT_AGENTS);
    expect(targetsFor(DEFAULT_AGENTS).map((target) => [target.kind, target.path])).toEqual([
      ["directory", join(".claude", "skills")],
      ["directory", join(".agents", "skills")],
    ]);
    // The index block only when asked for.
    expect(parseAgents(["all,agents-md"])).toEqual([...DEFAULT_AGENTS, "agents-md"]);
    expect(parseAgents(["codex", "codex"])).toEqual(["codex"]);
    expect(parseAgents([])).toBeUndefined();
  });
});

describe("the packaged skills", () => {
  // https://agentskills.io/specification: the frontmatter every agent above reads.
  const skills = readdirSync(PACKAGED_SKILLS, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory(),
  );

  it("ships at least the sauce-cli skill", () => {
    expect(skills.map((entry) => entry.name)).toContain("sauce-cli");
  });

  it("updates an install from before the rename: sauce-run goes, sauce-cli comes", () => {
    // The skills as a package shipped them before sauce-cli was sauce-run.
    const old = join(work, "before-rename");
    cpSync(PACKAGED_SKILLS, old, { recursive: true });
    cpSync(join(old, "sauce-cli"), join(old, "sauce-run"), { recursive: true });
    rmSync(join(old, "sauce-cli"), { recursive: true });
    const skillFile = join(old, "sauce-run", "SKILL.md");
    writeFileSync(
      skillFile,
      readFileSync(skillFile, "utf8").replace("name: sauce-cli", "name: sauce-run"),
    );
    const before: SkillsSource = { dir: old, packageName: MANIFEST.name, version: "0.0.1" };
    const now: SkillsSource = {
      dir: PACKAGED_SKILLS,
      packageName: MANIFEST.name,
      version: "0.0.2",
    };
    for (const target of targetsFor(DEFAULT_AGENTS)) {
      installTarget(project, before, target);
      expect(existsSync(join(project, target.path, "sauce-run", "SKILL.md"))).toBe(true);
      updateTarget(project, now, target, false);
      expect(existsSync(join(project, target.path, "sauce-run"))).toBe(false);
      expect(readFileSync(join(project, target.path, "sauce-cli", "SKILL.md"), "utf8")).toBe(
        readFileSync(join(PACKAGED_SKILLS, "sauce-cli", "SKILL.md"), "utf8"),
      );
      expect(statusOf(project, now, target).state).toBe("up to date");
    }
  });

  it.each(skills.map((entry) => entry.name))(
    "%s follows the Agent Skills specification",
    (name) => {
      const text = readFileSync(join(PACKAGED_SKILLS, name, "SKILL.md"), "utf8");
      const frontmatter = /^---\n([^]*?)\n---\n/.exec(text);
      expect(frontmatter).not.toBeNull();
      const fields = Object.fromEntries(
        frontmatter![1]!.split("\n").map((line) => {
          const at = line.indexOf(":");

          return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
        }),
      ) as Record<string, string>;
      // name: 1-64 characters, lowercase letters, digits and hyphens, no leading, trailing or
      // doubled hyphen, and the same as its directory.
      expect(fields.name).toBe(name);
      expect(fields.name!.length).toBeLessThanOrEqual(64);
      expect(fields.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      // description: present, at most 1024 characters.
      expect(fields.description?.length ?? 0).toBeGreaterThan(0);
      expect(fields.description!.length).toBeLessThanOrEqual(1024);
      // Every file it links to ships beside it.
      for (const [, link] of text.matchAll(/\]\(([^)#:]+)\)/g)) {
        expect([link, existsSync(join(PACKAGED_SKILLS, name, link!))]).toEqual([link, true]);
      }
    },
  );
});

describe("install, update and status over a package upgrade", () => {
  it("installs once; a second install changes nothing and says the skills are up to date", () => {
    const source = packageAt("1.0.0");
    const [target] = targetsFor(["claude"]);
    expect(installTarget(project, source, target!).lines[0]).toBe(
      `installed claude (${join(".claude", "skills")})`,
    );
    const before = read(".claude/skills/alpha/SKILL.md");
    expect(installTarget(project, source, target!).lines).toEqual([
      `skills are up to date (claude (${join(".claude", "skills")}))`,
    ]);
    expect(read(".claude/skills/alpha/SKILL.md")).toBe(before);
    expect(statusOf(project, source, target!).state).toBe("up to date");
  });

  it("after an upgrade, install says to run update and changes nothing; update adds, changes and removes", () => {
    const old = packageAt("1.0.0");
    const [target] = targetsFor(["claude"]);
    installTarget(project, old, target!);
    // The package moves on: alpha changes, beta is retired, gamma is new.
    writeFileSync(
      join(old.dir, "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: A.\n---\n\nalpha v2\n",
    );
    rmSync(join(old.dir, "beta"), { recursive: true });
    mkdirSync(join(old.dir, "gamma"));
    writeFileSync(
      join(old.dir, "gamma", "SKILL.md"),
      "---\nname: gamma\ndescription: G.\n---\n\ngamma\n",
    );
    const upgraded = { ...old, version: "1.1.0" };

    expect(installTarget(project, upgraded, target!).lines).toEqual([
      `skills are outdated for claude (${join(".claude", "skills")}): installed from 1.0.0, the ` +
        "package has 1.1.0; run `sauce skills update`",
    ]);
    expect(read(".claude/skills/alpha/SKILL.md")).toMatch(/alpha v1/);
    expect(existsSync(join(project, ".claude/skills/gamma"))).toBe(false);
    const status = statusOf(project, upgraded, target!);
    expect(status.state).toBe("outdated");
    expect(status.files.map((file) => [file.path, file.change])).toEqual([
      [join(".claude", "skills", "alpha", "SKILL.md"), "update"],
      [join(".claude", "skills", "alpha", "examples", "one.sauce.ts"), "current"],
      [join(".claude", "skills", "beta", "SKILL.md"), "remove"],
      [join(".claude", "skills", "gamma", "SKILL.md"), "add"],
    ]);

    const report = updateTarget(project, upgraded, target!, false);
    expect(report.lines[0]).toBe(
      `claude (${join(".claude", "skills")}): added 1, updated 1, removed 1, kept 0 modified`,
    );
    expect(read(".claude/skills/alpha/SKILL.md")).toMatch(/alpha v2/);
    expect(read(".claude/skills/gamma/SKILL.md")).toMatch(/gamma/);
    // The retired skill goes, directory and all.
    expect(existsSync(join(project, ".claude/skills/beta"))).toBe(false);
    expect(JSON.parse(read(`.claude/skills/${INSTALL_RECORD}`)).version).toBe("1.1.0");
    expect(statusOf(project, upgraded, target!).state).toBe("up to date");
  });

  it("keeps a file the user edited, showing the change, and replaces it only with --force", () => {
    const old = packageAt("1.0.0");
    const [target] = targetsFor(["claude"]);
    installTarget(project, old, target!);
    write(
      ".claude/skills/alpha/SKILL.md",
      "---\nname: alpha\ndescription: Does alpha things.\n---\n\nmy own notes\n",
    );
    writeFileSync(
      join(old.dir, "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: A.\n---\n\nalpha v2\n",
    );
    const upgraded = { ...old, version: "1.1.0" };

    const status = statusOf(project, upgraded, target!);
    const edited = status.files.find((file) => file.change === "modified")!;
    expect(edited.path).toBe(join(".claude", "skills", "alpha", "SKILL.md"));
    expect(edited.diff).toContain("- alpha v2");
    expect(edited.diff).toContain("+ my own notes");

    const kept = updateTarget(project, upgraded, target!, false);
    expect(kept.lines[0]).toMatch(/kept 1 modified$/);
    expect(kept.lines.join("\n")).toContain("+ my own notes");
    expect(read(".claude/skills/alpha/SKILL.md")).toMatch(/my own notes/);
    // Still reported as the user's after the update.
    expect(statusOf(project, upgraded, target!).state).toBe("modified");

    updateTarget(project, upgraded, target!, true);
    expect(read(".claude/skills/alpha/SKILL.md")).toMatch(/alpha v2/);
    expect(statusOf(project, upgraded, target!).state).toBe("up to date");
  });

  it("refuses a record that names a file outside the skills directory, even with --force", () => {
    const source = packageAt("1.0.0");
    const [target] = targetsFor(["claude"]);
    installTarget(project, source, target!);
    // Outside the project entirely, with the digest the crafted record claims for it.
    const victim = join(work, "victim.txt");
    writeFileSync(victim, "keep me\n");
    const sha256 = createHash("sha256").update("keep me\n").digest("hex");
    const record = JSON.parse(read(`.claude/skills/${INSTALL_RECORD}`));
    for (const key of ["../../victim.txt", "/etc/hosts", "alpha/../../../victim.txt", "a\\b"]) {
      write(
        `.claude/skills/${INSTALL_RECORD}`,
        JSON.stringify({ ...record, files: { ...record.files, [key]: sha256 } }),
      );
      for (const force of [false, true]) {
        expect(() => updateTarget(project, source, target!, force)).toThrow(
          new RegExp(
            `lists '${key.replace(/[\\.^$|?*+()[\]{}/]/g, "\\$&")}', which is not a file inside`,
          ),
        );
      }
      expect(() => statusOf(project, source, target!)).toThrow(/sauce did not write it/);
    }
    expect(readFileSync(victim, "utf8")).toBe("keep me\n");
  });

  it("does not write or delete through a symbolic link", () => {
    const source = packageAt("1.0.0");
    const [target] = targetsFor(["claude"]);
    const elsewhere = join(work, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(join(project, ".claude", "skills"), { recursive: true });
    symlinkSync(elsewhere, join(project, ".claude", "skills", "alpha"));
    expect(() => installTarget(project, source, target!)).toThrow(
      /goes through the symbolic link \.claude\/skills\/alpha: sauce does not write or delete/,
    );
    expect(readdirSync(elsewhere)).toEqual([]);
    // And an installed file swapped for a link is neither rewritten nor removed through it.
    rmSync(join(project, ".claude"), { recursive: true });
    installTarget(project, source, target!);
    rmSync(join(project, ".claude/skills/beta"), { recursive: true });
    symlinkSync(elsewhere, join(project, ".claude/skills/beta"));
    writeFileSync(join(elsewhere, "SKILL.md"), "not sauce's\n");
    rmSync(join(source.dir, "beta"), { recursive: true });
    expect(() => updateTarget(project, { ...source, version: "1.1.0" }, target!, true)).toThrow(
      /symbolic link/,
    );
    expect(readFileSync(join(elsewhere, "SKILL.md"), "utf8")).toBe("not sauce's\n");
  });

  it("never overwrites a file it did not write, even on the first install", () => {
    const source = packageAt("1.0.0");
    write(".agents/skills/alpha/SKILL.md", "someone else's\n");
    write(".agents/skills/mine/SKILL.md", "a project's own skill\n");
    const [target] = targetsFor(["codex"]);
    const report = installTarget(project, source, target!);
    expect(report.lines.join("\n")).toContain(
      `kept       ${join(".agents", "skills", "alpha", "SKILL.md")} (already there, and different)`,
    );
    expect(read(".agents/skills/alpha/SKILL.md")).toBe("someone else's\n");
    expect(statusOf(project, source, target!).state).toBe("modified");
    updateTarget(project, source, target!, true);
    expect(read(".agents/skills/mine/SKILL.md")).toBe("a project's own skill\n");
  });

  it("updates only its own block of AGENTS.md, and keeps an edit made inside it", () => {
    const old = packageAt("1.0.0");
    write("AGENTS.md", "# My project\n\nOur own rules.\n");
    const index = targetsFor(["agents-md"]).find((target) => target.kind === "index")!;
    installTarget(project, old, index);
    expect(read("AGENTS.md")).toMatch(
      /^# My project\n\nOur own rules\.\n\n<!-- sauce-skills:begin /,
    );
    write("AGENTS.md", `${read("AGENTS.md")}\n## Later, ours too\n`);

    writeFileSync(
      join(old.dir, "beta", "SKILL.md"),
      "---\nname: beta\ndescription: Beta, renamed.\n---\n\nbeta\n",
    );
    const upgraded = { ...old, version: "1.1.0" };
    expect(statusOf(project, upgraded, index).state).toBe("outdated");
    updateTarget(project, upgraded, index, false);
    const text = read("AGENTS.md");
    expect(text).toContain("Beta, renamed.");
    expect(text.startsWith("# My project\n\nOur own rules.\n\n")).toBe(true);
    expect(text.trimEnd().endsWith("## Later, ours too")).toBe(true);
    expect(withoutBlock(text)).toBe("# My project\n\nOur own rules.\n\n## Later, ours too\n");

    write("AGENTS.md", text.replace("Beta, renamed.", "Beta, as we describe it."));
    expect(statusOf(project, upgraded, index).state).toBe("modified");
    const kept = updateTarget(project, upgraded, index, false);
    expect(kept.lines[0]).toMatch(/kept 1 modified$/);
    expect(read("AGENTS.md")).toContain("Beta, as we describe it.");
    updateTarget(project, upgraded, index, true);
    expect(read("AGENTS.md")).toContain("Beta, renamed.");
  });
});

describe("the commands", () => {
  const dir = (): string[] => ["--dir", project];

  it("installs for every agent by default, verbatim, and a second run is a no-op", async () => {
    const first = await sauce("skills", "install", ...dir());
    expect(first.code).toBe(0);
    const shared = `codex, cursor, copilot, gemini (${join(".agents", "skills")})`;
    expect(first.stdout).toContain(`installed claude (${join(".claude", "skills")})`);
    expect(first.stdout).toContain(`installed ${shared}`);
    expect(first.stdout).toContain(
      `wrote      ${join(".agents", "skills", "sauce-cli", "SKILL.md")}`,
    );
    for (const skills of [".claude/skills", ".agents/skills"]) {
      expect(readFileSync(join(project, skills, "sauce-cli/SKILL.md"), "utf8")).toBe(
        readFileSync(join(PACKAGED_SKILLS, "sauce-cli", "SKILL.md"), "utf8"),
      );
    }
    // No AGENTS.md index unless asked for.
    expect(existsSync(join(project, "AGENTS.md"))).toBe(false);
    const second = await sauce("skills", "install", ...dir());
    expect(second.stdout).toBe(
      `skills are up to date (claude (${join(".claude", "skills")}))\n` +
        `skills are up to date (${shared})\n`,
    );
    // One agent named alone gets the one directory it reads.
    const only = join(work, "only");
    mkdirSync(only);
    await sauce("skills", "install", "--agent", "gemini", "--dir", only);
    expect(existsSync(join(only, ".agents/skills/sauce-cli/SKILL.md"))).toBe(true);
    expect(existsSync(join(only, ".claude"))).toBe(false);
  });

  it("status exits 0 when current, 1 when outdated, and lists a local edit either way", async () => {
    expect((await sauce("skills", "status", ...dir())).code).toBe(1);
    await sauce("skills", "install", "--agent", "claude,agents-md", ...dir());
    const current = await sauce("skills", "status", ...dir());
    expect(current.code).toBe(0);
    expect(current.stdout).toContain(
      `claude (${join(".claude", "skills")}): up to date (${MANIFEST.version})`,
    );
    expect(current.stdout).toContain(`agents-md (AGENTS.md): up to date (${MANIFEST.version})`);

    write(".claude/skills/sauce-cli/SKILL.md", "edited\n");
    const edited = await sauce("skills", "status", ...dir());
    expect(edited.code).toBe(0);
    expect(edited.stdout).toMatch(
      /: modified\n {2}modified {2}\.claude\/skills\/sauce-cli\/SKILL\.md/,
    );

    // An install that predates a file the package ships now is outdated.
    const record = JSON.parse(read(`.agents/skills/${INSTALL_RECORD}`));
    delete record.files["sauce-cli/examples/split.sauce.ts"];
    write(`.agents/skills/${INSTALL_RECORD}`, JSON.stringify(record));
    rmSync(join(project, ".agents/skills/sauce-cli/examples/split.sauce.ts"));
    const outdated = await sauce("skills", "status", ...dir());
    expect(outdated.code).toBe(1);
    expect(outdated.stdout).toContain(
      `add       ${join(".agents", "skills", "sauce-cli", "examples", "split.sauce.ts")}`,
    );
    const update = await sauce("skills", "update", ...dir());
    expect(update.code).toBe(0);
    expect(update.stdout).toMatch(/added 1, updated 0, removed 0, kept 0 modified/);
    expect(update.stdout).toMatch(/kept 1 modified/);
    expect((await sauce("skills", "status", ...dir())).code).toBe(0);
  });

  it("names a wrong subcommand, agent or flag", async () => {
    expect((await sauce("skills")).stderr).toMatch(/missing subcommand: install, update or status/);
    expect((await sauce("skills", "check")).stderr).toMatch(/unknown subcommand 'check'/);
    expect((await sauce("skills", "install", "--agent", "vim", ...dir())).stderr).toMatch(
      /--agent: 'vim' is not one of claude, codex, cursor, copilot, gemini, agents-md, all/,
    );
    const forced = await sauce("skills", "install", "--force", ...dir());
    expect(forced.code).toBe(2);
    expect(forced.stderr).toMatch(/--force goes with update; install never overwrites/);
    expect((await sauce("skills", "update", ...dir())).stderr).toMatch(
      /no agent skills are installed in .*: run `sauce skills install`/,
    );
  });
});

describe("sauce init", () => {
  const source = (): SkillsSource => ({
    dir: PACKAGED_SKILLS,
    packageName: MANIFEST.name,
    version: MANIFEST.version,
  });

  it("scaffolds a project pinning this exact version, with AGENTS.md and each agent's skills", async () => {
    const dir = join(work, "My App");
    const run = await sauce("init", dir, "--agent", "claude,gemini,agents-md");
    expect(run.code).toBe(0);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(manifest.name).toBe("my-app");
    expect(manifest.dependencies).toEqual({ [MANIFEST.name]: MANIFEST.version });
    // The TypeScript the programs' editor plugin runs in: the range the package itself takes.
    expect(manifest.devDependencies).toEqual({
      typescript: (MANIFEST as { dependencies?: Record<string, string> }).dependencies?.typescript,
    });
    // The programs directory: its own TypeScript project, of SauceScript alone.
    expect(JSON.parse(readFileSync(join(dir, "programs/tsconfig.json"), "utf8"))).toEqual(
      sauceScriptTsconfig(MANIFEST.name),
    );
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("Write programs in `programs/`");
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toMatch(/^sauce\.config\.json$/m);
    const config = JSON.parse(readFileSync(join(dir, "sauce.config.example.json"), "utf8"));
    for (const url of Object.values(config.rpcUrls as Record<string, string>)) {
      expect(url).toMatch(/^<[^<>]+>$/);
    }
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    expect(readFileSync(join(dir, "GEMINI.md"), "utf8")).toBe("@./AGENTS.md\n");
    const agentsMd = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(agentsMd).toMatch(/^# AGENTS\.md\n/);
    // The command is `sauce`, and the instructions say how to get it.
    expect(agentsMd).toContain(`installed once with\n  \`npm i -g ${MANIFEST.name}\``);
    expect(agentsMd).not.toMatch(/npx sauce/);
    expect(agentsMd).toContain("<!-- sauce-skills:begin ");
    for (const skills of [".claude/skills", ".agents/skills"]) {
      expect(existsSync(join(dir, skills, "sauce-cli", "SKILL.md"))).toBe(true);
    }
    expect(run.stdout).toMatch(/Next:\n {2}cd .*My App\n {2}npm install\n/);
  });

  it("is idempotent, and overwrites nothing without --force", async () => {
    const dir = join(work, "app");
    await sauce("init", dir);
    // By default every agent: both skills directories, both instruction pointers, no index block.
    for (const file of [".claude/skills/sauce-cli/SKILL.md", ".agents/skills/sauce-cli/SKILL.md"]) {
      expect(existsSync(join(dir, file))).toBe(true);
    }
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    expect(readFileSync(join(dir, "GEMINI.md"), "utf8")).toBe("@./AGENTS.md\n");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).not.toContain("sauce-skills:begin");
    const again = await sauce("init", dir);
    expect(again.code).toBe(0);
    expect(again.stdout).toMatch(/unchanged +AGENTS\.md/);
    expect(again.stdout).toMatch(/skills are up to date/);
    writeFileSync(join(dir, "package.json"), "{}\n");
    const refused = await sauce("init", dir);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/already has files init would overwrite:\n {2}package\.json\n/);
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe("{}\n");
    expect((await sauce("init", dir, "--force")).code).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).dependencies).toEqual({
      [MANIFEST.name]: MANIFEST.version,
    });
  });

  it("writes into a non-empty directory when nothing would be overwritten", () => {
    const dir = join(work, "existing");
    mkdirSync(dir);
    writeFileSync(join(dir, "README.md"), "mine\n");
    const result = initProject(dir, source(), ["claude", "agents-md"], false);
    expect(result.files.every((entry) => entry.state === "wrote")).toBe(true);
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("mine\n");
  });

  it("--tsconfig writes only a directory's SauceScript project, for programs init did not place", async () => {
    const programs = join(project, "contracts", "sauce");
    const first = await sauce("init", programs, "--tsconfig");
    expect([first.code, first.stderr]).toEqual([0, ""]);
    expect(first.stdout).toContain(`wrote      ${join(programs, "tsconfig.json")}`);
    expect(JSON.parse(readFileSync(join(programs, "tsconfig.json"), "utf8"))).toEqual(
      sauceScriptTsconfig(MANIFEST.name),
    );
    // Nothing else: no package.json, no skills.
    expect(readdirSync(programs)).toEqual(["tsconfig.json"]);
    expect(existsSync(join(project, "package.json"))).toBe(false);
    expect((await sauce("init", programs, "--tsconfig")).stdout).toContain("unchanged");
    writeFileSync(join(programs, "tsconfig.json"), "{}\n");
    const kept = await sauce("init", programs, "--tsconfig");
    expect(kept.code).toBe(1);
    expect(kept.stderr).toMatch(/already exists with other content: pass --force/);
    expect((await sauce("init", programs, "--tsconfig", "--force")).stdout).toContain("overwrote");
    expect((await sauce("init", programs, "--tsconfig", "--agent", "claude")).code).toBe(2);
  });

  it("is the tsconfig.json the CLI guide shows, field for field", () => {
    const guide = readFileSync(join(SDK, "..", "docs", "guides", "cli.md"), "utf8");
    const shown = /The file it writes is this[^]*?```json\n([^]*?)```/.exec(guide)?.[1];
    expect(shown).toBeDefined();
    expect(JSON.parse(shown!)).toEqual(sauceScriptTsconfig(MANIFEST.name));
  });

  it("runs npm install only when asked", async () => {
    let ran: { command: string; args: readonly string[]; cwd: string } | undefined;
    let stdout = "";
    const dir = join(work, "installed");
    const code = await runCli(["init", dir, "--install"], {
      ...nodeIo(),
      stdout: (text) => void (stdout += text),
      stderr: () => undefined,
      run: (command, args, cwd) => {
        ran = { command, args, cwd };

        return 0;
      },
    });
    expect(code).toBe(0);
    expect(ran).toEqual({ command: "npm", args: ["install"], cwd: dir });
    expect(stdout).toContain(`Running npm install in ${dir}`);
    expect(stdout).not.toMatch(/^ {2}npm install$/m);
  });
});
