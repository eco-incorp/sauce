// Run with `node --test .github/scripts/release-version.test.mjs` (CI's `checks` job does).
// Each case builds a scratch repository, so the calculation is held to real `git` behaviour: tag
// ordering, merge-base, merge commits. The expected versions are written out, not derived.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { baselineTag, bump, classify, nextRelease } from "./release-version.mjs";

const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function repo() {
  const cwd = mkdtempSync(join(tmpdir(), "release-version-"));
  dirs.push(cwd);
  const git = (...args) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd,
      encoding: "utf8",
    }).trim();
  git("init", "-q", "-b", "main");
  return {
    cwd,
    git,
    commit: (message) => git("commit", "-q", "--allow-empty", "-m", message),
    tag: (name) => git("tag", name),
  };
}

describe("which commits drive which bump", () => {
  const cases = [
    ["fix: a", "patch"],
    ["fix(cli): a", "patch"],
    ["perf(sdk): a", "patch"],
    ["revert: feat: a", "patch"],
    ["feat: a", "minor"],
    ["feat(sdk): a", "minor"],
    ["feat!: a", "major"],
    ["feat(sdk)!: a", "major"],
    ["fix!: a", "major"],
    ["chore!: a", "major"],
    ["refactor: a\n\nBREAKING CHANGE: the thing moved", "major"],
    ["docs: a\n\n* BREAKING-CHANGE: bullet spelling", "major"],
    ["fix: a\n\nBREAKING CHANGES\nfollowed by the note", "major"],
    ["docs: a", null],
    ["chore: a", null],
    ["ci: a", null],
    ["test: a", null],
    ["refactor: a", null],
    ["style: a", null],
    ["build: a", null],
    // Not a conventional header: never a release by its type.
    ["feature: a", null],
    ["Update README", null],
    // The header is not scanned for the footer, and a mention is not a footer.
    ["fix: handle BREAKING CHANGE text in input", "patch"],
    ["feat: a\n\nThis is not a BREAKING CHANGE: it only mentions one", "minor"],
  ];
  for (const [message, level] of cases) {
    it(`${JSON.stringify(message)} -> ${level}`, () => {
      assert.equal(classify(message)?.level ?? null, level);
    });
  }

  it("a footer's note is the paragraph after the marker", () => {
    const parsed = classify("feat(sdk): a\n\nBREAKING CHANGE: the one\nthing\n\nCloses #3");
    assert.equal(parsed.breakingNote, "the one\nthing");
  });
});

describe("bump", () => {
  it("resets the lower fields", () => {
    assert.equal(bump("1.4.2", "patch"), "1.4.3");
    assert.equal(bump("1.4.2", "minor"), "1.5.0");
    assert.equal(bump("1.4.2", "major"), "2.0.0");
    assert.equal(bump("0.99.18", "major"), "1.0.0");
  });
});

describe("baselineTag", () => {
  it("is the highest stable version as numbers, not text or date", () => {
    assert.equal(baselineTag(["v1.0.9", "v1.0.10", "v0.99.18", "v1.0.2"]), "v1.0.10");
    assert.equal(baselineTag(["v0.99.18", "v1.0.0"]), "v1.0.0");
  });
  it("ignores prereleases and tags of another shape", () => {
    assert.equal(baselineTag(["v1.0.0", "v2.0.0-rc.1", "compiler-v9.0.0", "1.5.0", ""]), "v1.0.0");
    assert.equal(baselineTag(["v2.0.0-rc.1"]), undefined);
  });
});

describe("nextRelease", () => {
  it("patch-only commits give the next patch of the published 1.0.0", () => {
    const r = repo();
    r.commit("feat: before the release");
    r.tag("v1.0.0");
    r.commit("fix(cli): a");
    r.commit("docs: b");
    r.commit("perf: c");
    r.commit("chore: d");
    const release = nextRelease({ cwd: r.cwd });
    assert.equal(release.version, "1.0.1");
    assert.equal(release.tag, "v1.0.1");
    assert.equal(release.level, "patch");
    assert.deepEqual(
      release.commits.map((c) => c.subject),
      ["c", "a"],
    );
  });

  it("a feat gives the next minor, whatever else is there", () => {
    const r = repo();
    r.commit("chore: init");
    r.tag("v1.4.2");
    r.commit("fix: a");
    r.commit("feat: b");
    r.commit("docs: c");
    assert.equal(nextRelease({ cwd: r.cwd }).version, "1.5.0");
  });

  it("a breaking change gives the next major, by header or by footer", () => {
    for (const message of ["feat(sdk)!: a", "fix: a\n\nBREAKING CHANGE: b"]) {
      const r = repo();
      r.commit("chore: init");
      r.tag("v1.4.2");
      r.commit("feat: small");
      r.commit(message);
      assert.equal(nextRelease({ cwd: r.cwd }).version, "2.0.0", message);
    }
  });

  it("releases nothing when no commit since the tag drives one", () => {
    const r = repo();
    r.commit("feat: shipped");
    r.tag("v1.0.0");
    r.commit("docs: a");
    r.commit("ci: b");
    r.commit("test: c");
    const release = nextRelease({ cwd: r.cwd });
    assert.equal(release.released, false);
    assert.equal(release.version, undefined);
    assert.equal(release.tag, undefined);
    assert.equal(release.previousTag, "v1.0.0");
  });

  it("does not count what was released: commits before the tag never bump", () => {
    const r = repo();
    r.commit("feat!: old, already in 1.0.0");
    r.tag("v1.0.0");
    r.commit("docs: a");
    assert.equal(nextRelease({ cwd: r.cwd }).released, false);
  });

  // The real shape of eco-incorp/sauce: v1.0.0 was cut from a commit on a side branch (a changelog
  // commit), and main got the same change as a different commit. semantic-release would not see
  // that tag at all and would count from v0.99.18.
  it("takes a baseline tag that is not an ancestor of the branch, counting what main has that the tag does not", () => {
    const r = repo();
    r.commit("feat: counted in 0.99.18");
    r.tag("v0.99.18");
    r.commit("feat!: shipped in 1.0.0");
    r.git("switch", "-q", "-c", "release");
    r.commit("docs(changelog): release 1.0.0");
    r.tag("v1.0.0");
    r.git("switch", "-q", "main");
    r.commit("docs(changelog): release 1.0.0 (#260)");
    r.commit("fix: after the release");
    const release = nextRelease({ cwd: r.cwd });
    assert.equal(release.previousTag, "v1.0.0");
    assert.equal(release.version, "1.0.1");
    assert.deepEqual(
      release.commits.map((c) => c.subject),
      ["after the release"],
    );
  });

  it("skips merge commits and counts the commits they brought in", () => {
    const r = repo();
    r.commit("chore: init");
    r.tag("v1.0.0");
    r.git("switch", "-q", "-c", "topic");
    r.commit("docs: only docs on the branch");
    r.git("switch", "-q", "main");
    r.commit("ci: main moves");
    // The merge's own message parses as a fix. It is not a change; the commits it brought in are.
    r.git("merge", "-q", "--no-ff", "topic", "-m", "fix: a merge titled like a fix");
    assert.equal(nextRelease({ cwd: r.cwd }).released, false);
  });

  it("refuses to guess when there is no stable tag", () => {
    const r = repo();
    r.commit("feat: a");
    r.tag("v2.0.0-rc.1");
    assert.throws(() => nextRelease({ cwd: r.cwd }), /no vX\.Y\.Z tag/);
  });

  it("writes release notes: breaking first, then each class, with a compare link", () => {
    const r = repo();
    r.commit("chore: init");
    r.tag("v1.0.0");
    r.commit("fix(cli): repair it");
    r.commit("feat(sdk): add it");
    r.commit("refactor(sdk)!: move it\n\nBREAKING CHANGE: import from the new path");
    const { notes, version } = nextRelease({ cwd: r.cwd, repository: "eco-incorp/sauce" });
    assert.equal(version, "2.0.0");
    const lines = notes.split("\n");
    assert.equal(lines[0], "### ⚠ BREAKING CHANGES");
    assert.match(lines[2], /^\* \*\*sdk:\*\* import from the new path \([0-9a-f]{7}\)$/);
    assert.ok(lines.indexOf("### Features") < lines.indexOf("### Bug Fixes"));
    assert.match(notes, /\* \*\*sdk:\*\* add it \(/);
    assert.match(notes, /\* \*\*cli:\*\* repair it \(/);
    assert.ok(notes.endsWith("compare/v1.0.0...v2.0.0\n"));
  });
});

describe("the command line", () => {
  const script = fileURLToPath(new URL("./release-version.mjs", import.meta.url));
  const run = (cwd, env = {}, entry = script, ...args) =>
    execFileSync(process.execPath, [entry, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: "", ...env },
    });

  it("prints the plan as JSON, writes the notes and sets the step outputs", () => {
    const r = repo();
    r.commit("chore: init");
    r.tag("v1.0.0");
    r.commit("fix: a");
    const out = join(r.cwd, ".git", "gh-output");
    const notes = join(r.cwd, ".git", "notes.md");
    const plan = JSON.parse(run(r.cwd, { GITHUB_OUTPUT: out }, script, "--notes", notes));
    assert.equal(plan.version, "1.0.1");
    assert.equal(
      readFileSync(out, "utf8"),
      "released=true\nversion=1.0.1\ntag=v1.0.1\nlevel=patch\n",
    );
    assert.match(readFileSync(notes, "utf8"), /### Bug Fixes\n\n\* a \(/);
  });

  it("sets released=false and an empty version when nothing drives a release", () => {
    const r = repo();
    r.commit("chore: init");
    r.tag("v1.0.0");
    r.commit("docs: a");
    const out = join(r.cwd, ".git", "gh-output");
    run(r.cwd, { GITHUB_OUTPUT: out });
    assert.equal(readFileSync(out, "utf8"), "released=false\nversion=\ntag=\nlevel=\n");
  });

  // Run through a symlink to the script, as macOS's /tmp is: it must still do its work.
  it("runs when started through a symlinked path", () => {
    const r = repo();
    r.commit("chore: init");
    r.tag("v1.0.0");
    r.commit("feat: a");
    const link = join(r.cwd, "link.mjs");
    symlinkSync(script, link);
    assert.equal(JSON.parse(run(r.cwd, {}, link)).version, "1.1.0");
  });
});
