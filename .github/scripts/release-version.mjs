#!/usr/bin/env node
// Computes the next SDK version from Conventional Commit history. No dependencies, no network, no
// side effects beyond what is named below: `publish.yml` runs it as the plan step, and anyone can
// run it locally as the dry run (`node .github/scripts/release-version.mjs`).
//
// RULES. The ones eco-incorp/v12's `.releaserc.js` applies, which are semantic-release's defaults
// plus the `!` marker its parser misses:
//   feat                                         -> minor
//   fix, perf, revert                            -> patch
//   a `!` before the colon, or a `BREAKING CHANGE:` footer, on a commit of ANY type -> major
//   everything else (docs, chore, ci, test, refactor, style, build)                  -> no release
// "Breaking" here is the SDK's own: a change SDK USERS would notice (a SauceScript program that
// stops compiling or runs differently, a removed or renamed export, command, flag or MCP tool). An
// engine, compiler or Kitchen major that the SDK absorbs, with no change for its users, is NOT one:
// it is a `feat` or `fix` here. A commit text cannot tell the two apart, so a computed major is
// REFUSED unless the caller passes `--allow-major`, which is a person saying users will notice.
// (v12 caps majors at a minor during its private beta; this is the public SDK's equivalent: a major
// is a decision, never a side effect of a footer.)
//
// BASELINE. The highest `vX.Y.Z` tag by semver, found by tag name and NOT by reachability from the
// branch. semantic-release only looks at tags in the branch's history, and `v1.0.0` is not: it was
// cut from a changelog commit that landed on `main` as a different commit (#260). The commits
// counted are `<tag>..HEAD`: everything HEAD has that the tag does not, which for a tag on the
// side of the branch is what happened on main since they diverged. Prerelease tags
// (`v2.0.0-rc.1`) are ignored.
//
// Merge commits are skipped: the commits a merge brings in are counted on their own, and a merge's
// own message is not a change.
//
// REGISTRY. Given `--published <file>` (the output of `npm view @eco-incorp/sauce versions --json`),
// the plan is also held to npm: the baseline tag must be published and be the newest stable version
// there, or nothing is planned. See `checkPublished`. A local run without it skips the check.
//
// OVERRIDE. `--release-as X.Y.Z` replaces the computed number, never the decision to release (and
// a major, computed or given, needs `--allow-major` all the same): a
// merged commit message cannot be edited, so a breaking footer that was undone in the same PR, or a
// revert of a `feat!`, would otherwise force a major onto npm for good.
//
// OUTPUT. JSON on stdout. With `--notes <file>`, the release notes as Markdown. Under GitHub
// Actions it also sets the step outputs `released`, `version`, `tag` and `level`, and appends a
// summary. It never tags, pushes or publishes.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Semver's own grammar: no leading zeros (`1.01.0` is not a version, and `npm version` would
// silently turn it into 1.1.0 while the tag kept the zero), and every part a safe integer.
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const isVersion = (value) =>
  typeof value === "string" &&
  VERSION.test(value) &&
  value.split(".").every((part) => Number.isSafeInteger(Number(part)));
const isTag = (value) => typeof value === "string" && value[0] === "v" && isVersion(value.slice(1));
// conventional-changelog-conventionalcommits' header pattern, with the type required.
const HEADER = /^(\w+)(?:\((.*)\))?(!)?: (.*)$/;
// Matched the way conventional-commits-parser matches it: a leading `*` bullet (GitHub's squash
// UI writes one) or whitespace in place of the colon both count.
const BREAKING_FOOTER = /^[\s|*]*BREAKING[ -]CHANGES?[:\s]\s*([^\n]*(?:\n(?!\s*$)[^\n]*)*)/m;
const LEVEL_OF_TYPE = { feat: "minor", fix: "patch", perf: "patch", revert: "patch" };
const RANK = { patch: 1, minor: 2, major: 3 };
const SECTIONS = [
  ["feat", "Features"],
  ["fix", "Bug Fixes"],
  ["perf", "Performance"],
  ["revert", "Reverts"],
];

/** The release level one commit message drives, with the pieces the notes need; null if none. */
export function classify(message) {
  const [header, ...rest] = message.replace(/\r\n/g, "\n").trimEnd().split("\n");
  const match = HEADER.exec(header);
  const footer = BREAKING_FOOTER.exec(rest.join("\n"));
  const breaking = match?.[3] === "!" || footer !== null;
  const type = match?.[1];
  const level = breaking ? "major" : (LEVEL_OF_TYPE[type] ?? null);
  if (level === null) return null;
  return {
    level,
    type,
    scope: match?.[2],
    subject: match?.[4] ?? header,
    breaking,
    breakingNote: footer?.[1]?.trim() || undefined,
  };
}

export function bump(version, level) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** The highest stable `vX.Y.Z` among `tags`, compared as numbers, or undefined. */
export function baselineTag(tags) {
  return tags.filter(isTag).sort((a, b) => {
    const [x, y] = [a, b].map((tag) => tag.slice(1).split(".").map(Number));
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
  })[0];
}

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const compare = (a, b) => {
  const [x, y] = [a, b].map((version) => version.split(".").map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/**
 * Holds the baseline tag to what npm has, so a tag is never trusted on its own. Throws unless
 * `baseline` (a bare `X.Y.Z`) is published AND is the newest stable version there:
 *  - a tag whose version npm lacks was pushed by hand, or its publish never happened, and planning
 *    from it would skip that version for good;
 *  - a newer version on npm was published and never tagged (a run that failed between the two).
 *    Planning again would compute that same version, skip its publish, and tag whatever commit
 *    main is at now, not the one the tarball was built from. npm records no `gitHead` for this
 *    package, so nothing could tell the two apart afterwards: this refuses instead.
 */
export function checkPublished({ baseline, published }) {
  const stable = [published].flat().filter(isVersion);
  if (!stable.includes(baseline)) {
    throw new Error(
      `v${baseline} is tagged but ${baseline} is not on npm: a tag alone is not a release, so nothing is planned from it`,
    );
  }
  const ahead = stable.filter((version) => compare(version, baseline) > 0).sort(compare);
  if (ahead.length) {
    throw new Error(
      `npm has ${ahead.at(-1)}, newer than the newest tag v${baseline}: it was published and never tagged. Planning again would tag a commit its tarball was not built from. Re-run the failed jobs of the run that published it, or tag the commit that run built`,
    );
  }
}

/** A manual version must be a plain X.Y.Z above the baseline (which is npm's newest, once checked). */
function checkReleaseAs({ releaseAs, baseline }) {
  if (!isVersion(releaseAs)) throw new Error(`--release-as ${releaseAs} is not a plain X.Y.Z`);
  if (compare(releaseAs, baseline) <= 0) {
    throw new Error(`--release-as ${releaseAs} is not above the newest release, v${baseline}`);
  }
}

/**
 * What a release cut from `head` would be. `released: false` when no commit since the baseline
 * drives one. Throws when there is no baseline tag, rather than guessing a first version, and,
 * when `published` (the versions npm has) is given, on any disagreement with it, see
 * `checkPublished`. `releaseAs` replaces the computed number for a release that is computed anyway.
 */
export function nextRelease({
  cwd = process.cwd(),
  head = "HEAD",
  repository,
  published,
  releaseAs,
  allowMajor = false,
} = {}) {
  const tag = baselineTag(git(cwd, "tag", "--list", "v*").split("\n"));
  if (!tag) throw new Error("no vX.Y.Z tag to release from: refusing to guess a first version");
  const log = git(cwd, "log", "--no-merges", "--format=%H%x1f%B%x1e", `${tag}..${head}`);
  const commits = log
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, message] = entry.split("\x1f");
      return { sha, ...classify(message) };
    })
    .filter((commit) => commit.level);

  const current = tag.slice(1);
  // `!== undefined`: a null or empty answer from npm is a failed read, and must refuse, not skip.
  if (published !== undefined) checkPublished({ baseline: current, published });
  if (commits.length === 0) {
    if (releaseAs)
      throw new Error(`--release-as ${releaseAs}: no commit since ${tag} drives a release`);
    return { released: false, current, previousTag: tag, commits };
  }
  const level = commits.reduce((top, c) => (RANK[c.level] > RANK[top] ? c.level : top), "patch");
  const computed = bump(current, level);
  if (releaseAs) checkReleaseAs({ releaseAs, baseline: current });
  const version = releaseAs ?? computed;
  if (!allowMajor && Number(version.split(".")[0]) > Number(current.split(".")[0])) {
    const why = commits
      .filter((c) => c.breaking)
      .map((c) => `  ${c.sha.slice(0, 7)} ${c.type ?? ""}: ${c.subject}`);
    throw new Error(
      `${version} is a major bump and this is the SDK's own version: a major is only for a change SDK users would notice (SauceScript, exports, the CLI, MCP tools), never for an engine or compiler major the SDK absorbs. Commits marked breaking:\n${why.join("\n") || "  (none: --release-as asked for it)"}\nIf users WOULD notice, run again with allow_major. If not, the marker is wrong: publish a minor or patch with release_as, and reword the commits.`,
    );
  }
  return {
    released: true,
    current,
    version,
    ...(version !== computed && { computedVersion: computed }),
    tag: `v${version}`,
    level,
    previousTag: tag,
    commits,
    notes: notes({ commits, version, previousTag: tag, repository }),
  };
}

const line = (c, text) => `* ${c.scope ? `**${c.scope}:** ` : ""}${text} (${c.sha.slice(0, 7)})`;

function notes({ commits, version, previousTag, repository }) {
  const out = [];
  const breaking = commits.filter((c) => c.breaking);
  if (breaking.length) {
    out.push("### ⚠ BREAKING CHANGES", "");
    for (const c of breaking) out.push(line(c, c.breakingNote ?? c.subject));
    out.push("");
  }
  for (const [type, title] of SECTIONS) {
    const section = commits.filter((c) => c.type === type);
    if (!section.length) continue;
    out.push(`### ${title}`, "");
    for (const c of section) out.push(line(c, c.subject));
    out.push("");
  }
  // A breaking commit of a type with no section above (`docs!:`, `chore!:`) is listed only under
  // BREAKING CHANGES, which is where its consumer-visible effect belongs.
  if (repository) {
    out.push(
      `**Full Changelog**: https://github.com/${repository}/compare/${previousTag}...v${version}`,
    );
  }
  return out.join("\n").trimEnd() + "\n";
}

/** The value of `--name <value>`, or undefined; an empty value counts as absent. */
const option = (argv, name) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1] || undefined;
};

function main(argv) {
  const notesPath = option(argv, "--notes");
  const publishedPath = option(argv, "--published");
  const result = nextRelease({
    repository: process.env.GITHUB_REPOSITORY,
    published:
      publishedPath === undefined ? undefined : JSON.parse(readFileSync(publishedPath, "utf8")),
    releaseAs: option(argv, "--release-as"),
    allowMajor: argv.includes("--allow-major"),
  });
  const { notes: releaseNotes, ...summary } = result;
  if (notesPath && releaseNotes) writeFileSync(notesPath, releaseNotes);
  console.log(JSON.stringify(summary, null, 2));
  if (!publishedPath) console.error("npm was not consulted (no --published): a local dry run.");

  const headline = result.released
    ? `Next release: **${result.version}** (${result.level}), after ${result.previousTag}, from ${result.commits.length} commit(s).${
        result.computedVersion
          ? ` Overridden: the commits alone give ${result.computedVersion}.`
          : ""
      }`
    : `No release: nothing since ${result.previousTag} drives one.`;
  console.error(headline.replaceAll("**", ""));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `released=${result.released}`,
        `version=${result.version ?? ""}`,
        `tag=${result.tag ?? ""}`,
        `level=${result.level ?? ""}`,
        "",
      ].join("\n"),
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `${headline}\n\n${releaseNotes ? `<details><summary>Release notes</summary>\n\n${releaseNotes}\n</details>\n` : ""}`,
    );
  }
}

// Resolved on both sides: a symlinked workspace path (macOS /tmp) would otherwise never match and
// the script would exit 0 having printed nothing.
if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
