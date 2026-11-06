// Run with `node --test .github/scripts/release-version.test.mjs` (CI's `checks` job does).
// Each case builds a scratch repository, so the calculation is held to real `git` behaviour: tag
// ordering, merge-base, merge commits. The expected versions are written out, not derived.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
      assert.equal(nextRelease({ cwd: r.cwd, allowMajor: true }).version, "2.0.0", message);
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
    const { notes, version } = nextRelease({
      cwd: r.cwd,
      repository: "eco-incorp/sauce",
      allowMajor: true,
    });
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

describe("against npm", () => {
  function released(...extra) {
    const r = repo();
    r.commit("chore: init");
    r.tag("v1.0.0");
    for (const message of extra) r.commit(message);
    return r;
  }

  it("plans normally when the baseline is published and the newest there", () => {
    const r = released("fix: a");
    assert.equal(nextRelease({ cwd: r.cwd, published: ["0.99.18", "1.0.0"] }).version, "1.0.1");
    // `npm view <pkg> versions --json` prints a bare string when there is one version.
    assert.equal(nextRelease({ cwd: r.cwd, published: "1.0.0" }).version, "1.0.1");
    // A prerelease above the baseline is not a stable release, so it is not "published ahead".
    const rc = ["1.0.0", "1.1.0-rc.1"];
    assert.equal(nextRelease({ cwd: r.cwd, published: rc }).version, "1.0.1");
  });

  // The recovery hazard: run A publishes 1.0.1 from commit A and its release job fails, so no tag.
  // Main moves on to B. A fresh dispatch plans 1.0.1 AGAIN (the baseline is still v1.0.0), finds it
  // on npm, skips the publish, and would tag B, which the tarball does not contain.
  it("publish succeeded, tag failed, main advanced: the redispatch refuses; the original commit is the recovery", () => {
    const r = released("fix: A");
    const commitA = r.git("rev-parse", "HEAD");
    assert.equal(nextRelease({ cwd: r.cwd, published: ["1.0.0"] }).version, "1.0.1");

    r.commit("fix: B");
    // Without npm the plan is the same number for a different commit: this is the hazard itself.
    assert.equal(nextRelease({ cwd: r.cwd }).version, "1.0.1");
    // With npm it is refused, naming the recovery.
    assert.throws(
      () => nextRelease({ cwd: r.cwd, published: ["1.0.0", "1.0.1"] }),
      /npm has 1\.0\.1, newer than the newest tag v1\.0\.0.*never tagged.*Re-run the failed jobs/,
    );

    // Tagging the commit the tarball was built from makes B a release of its own.
    r.git("tag", "v1.0.1", commitA);
    const next = nextRelease({ cwd: r.cwd, published: ["1.0.0", "1.0.1"] });
    assert.equal(next.version, "1.0.2");
    assert.deepEqual(
      next.commits.map((c) => c.subject),
      ["B"],
    );
  });

  it("refuses when npm is ahead even if no commit would release", () => {
    const r = released("docs: a");
    assert.throws(() => nextRelease({ cwd: r.cwd, published: ["1.0.0", "1.0.1"] }), /never tagged/);
  });

  it("refuses a baseline tag npm does not have: a hand-pushed tag is not a release", () => {
    const r = released("fix: a");
    r.tag("v1.0.1");
    r.commit("fix: b");
    assert.throws(
      () => nextRelease({ cwd: r.cwd, published: ["1.0.0"] }),
      /v1\.0\.1 is tagged but 1\.0\.1 is not on npm/,
    );
  });

  it("an empty or missing answer from npm is a refusal, not a skipped check", () => {
    const r = released("fix: a");
    for (const published of [[], null, "", {}]) {
      assert.throws(
        () => nextRelease({ cwd: r.cwd, published }),
        /is not on npm/,
        String(published),
      );
    }
  });
});

describe("a manual version", () => {
  function revertedMajor() {
    const r = repo();
    r.commit("chore: init");
    r.tag("v1.0.0");
    r.commit("feat(sdk)!: rename it");
    r.commit("revert: feat(sdk)!: rename it");
    return r;
  }

  it("replaces the number a revert of a breaking change would still force", () => {
    const r = revertedMajor();
    assert.equal(nextRelease({ cwd: r.cwd, allowMajor: true }).version, "2.0.0");
    const release = nextRelease({ cwd: r.cwd, releaseAs: "1.1.0", repository: "eco-incorp/sauce" });
    assert.equal(release.version, "1.1.0");
    assert.equal(release.tag, "v1.1.0");
    assert.equal(release.computedVersion, "2.0.0");
    assert.ok(release.notes.endsWith("compare/v1.0.0...v1.1.0\n"));
  });

  it("is not reported as an override when it equals the computed number", () => {
    const r = revertedMajor();
    assert.equal(
      nextRelease({ cwd: r.cwd, releaseAs: "2.0.0", allowMajor: true }).computedVersion,
      undefined,
    );
  });

  it("must be X.Y.Z and above the newest release", () => {
    const r = revertedMajor();
    for (const bad of ["1.0.0", "0.99.19", "v1.1.0", "1.1", "1.1.0-rc.1"]) {
      assert.throws(() => nextRelease({ cwd: r.cwd, releaseAs: bad }), /--release-as/, bad);
    }
  });

  it("never forces a release that no commit drives", () => {
    const r = repo();
    r.commit("chore: init");
    r.tag("v1.0.0");
    r.commit("docs: a");
    assert.throws(
      () => nextRelease({ cwd: r.cwd, releaseAs: "1.0.1" }),
      /no commit since v1\.0\.0/,
    );
  });
});

describe("the command line against npm", () => {
  const script = fileURLToPath(new URL("./release-version.mjs", import.meta.url));
  const run = (cwd, ...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: "" },
    });

  it("exits non-zero, and says why, when npm is ahead of the tags", () => {
    const r = repo();
    r.commit("chore: init");
    r.tag("v1.0.0");
    r.commit("fix: a");
    const file = join(r.cwd, ".git", "published.json");
    writeFileSync(file, JSON.stringify(["1.0.0", "1.0.1"]));
    const result = run(r.cwd, "--published", file);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /published and never tagged/);
  });

  it("plans with a published list and a manual version; an empty --release-as is none", () => {
    const r = repo();
    r.commit("chore: init");
    r.tag("v1.0.0");
    r.commit("feat: a");
    const file = join(r.cwd, ".git", "published.json");
    writeFileSync(file, JSON.stringify(["0.99.18", "1.0.0"]));
    assert.equal(
      JSON.parse(run(r.cwd, "--published", file, "--release-as", "").stdout).version,
      "1.1.0",
    );
    const forced = JSON.parse(run(r.cwd, "--published", file, "--release-as", "1.5.0").stdout);
    assert.equal(forced.version, "1.5.0");
    assert.equal(forced.computedVersion, "1.1.0");
  });
});

// A major is the SDK's own: only for what SDK users would notice. An engine or compiler major that
// the SDK absorbs is written as a feat or fix, and nothing in a commit text can prove which it was,
// so a computed major is refused unless a person says users will notice.
describe("a major version", () => {
  function sdk(...messages) {
    const r = repo();
    r.commit("chore: init");
    r.tag("v1.4.2");
    for (const message of messages) r.commit(message);
    return r;
  }
  const absorbed = "feat(compiler)!: adopt compiler 3.0.0, whose engines dropped an opcode";

  it("is refused by default, naming the commits that asked for it", () => {
    const r = sdk("fix: a", absorbed);
    assert.throws(
      () => nextRelease({ cwd: r.cwd }),
      /2\.0\.0 is a major bump.*SDK users would notice.*adopt compiler 3\.0\.0.*allow_major.*release_as/s,
    );
  });

  it("is refused for a footer too, and for any commit type", () => {
    for (const message of ["refactor: a\n\nBREAKING CHANGE: engines moved", "chore!: a"]) {
      assert.throws(() => nextRelease({ cwd: sdk(message).cwd }), /is a major bump/, message);
    }
  });

  it("is allowed when a person confirms users will notice", () => {
    const release = nextRelease({ cwd: sdk(absorbed).cwd, allowMajor: true });
    assert.equal(release.version, "2.0.0");
  });

  it("an absorbed change worded as feat or fix is a minor or a patch", () => {
    assert.equal(
      nextRelease({ cwd: sdk("feat(compiler): adopt compiler 3.0.0").cwd }).version,
      "1.5.0",
    );
    assert.equal(
      nextRelease({ cwd: sdk("fix(deps): pin the engine release").cwd }).version,
      "1.4.3",
    );
  });

  it("a minor or patch needs no confirmation, whatever is marked breaking beneath it", () => {
    const r = sdk(absorbed);
    // The recovery for a wrongly marked commit: publish the number it should have been.
    assert.equal(nextRelease({ cwd: r.cwd, releaseAs: "1.5.0" }).version, "1.5.0");
  });

  it("a manual major needs the same confirmation", () => {
    const r = sdk("feat: a");
    assert.throws(() => nextRelease({ cwd: r.cwd, releaseAs: "2.0.0" }), /is a major bump/);
    assert.equal(
      nextRelease({ cwd: r.cwd, releaseAs: "2.0.0", allowMajor: true }).version,
      "2.0.0",
    );
  });

  it("the command line refuses without --allow-major and plans with it", () => {
    const r = sdk(absorbed);
    const script = fileURLToPath(new URL("./release-version.mjs", import.meta.url));
    const run = (...args) =>
      spawnSync(process.execPath, [script, ...args], {
        cwd: r.cwd,
        encoding: "utf8",
        env: { ...process.env, GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: "" },
      });
    const refused = run();
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /is a major bump/);
    assert.equal(JSON.parse(run("--allow-major").stdout).version, "2.0.0");
  });
});
