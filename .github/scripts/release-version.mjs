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
// v12 caps breaking changes at a minor during its private beta. The SDK is public and past 1.0, so
// there is no cap here: a breaking change is a major.
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
// OUTPUT. JSON on stdout. With `--notes <file>`, the release notes as Markdown. Under GitHub
// Actions it also sets the step outputs `released`, `version`, `tag` and `level`, and appends a
// summary. It never tags, pushes or publishes.
import { execFileSync } from "node:child_process";
import { appendFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
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
  return tags
    .filter((tag) => TAG.test(tag))
    .sort((a, b) => {
      const [x, y] = [a, b].map((tag) => TAG.exec(tag).slice(1).map(Number));
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    })[0];
}

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/**
 * What a release cut from `head` would be. `released: false` when no commit since the baseline
 * drives one. Throws when there is no baseline tag, rather than guessing a first version.
 */
export function nextRelease({ cwd = process.cwd(), head = "HEAD", repository } = {}) {
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
  if (commits.length === 0) return { released: false, current, previousTag: tag, commits };
  const level = commits.reduce((top, c) => (RANK[c.level] > RANK[top] ? c.level : top), "patch");
  const version = bump(current, level);
  return {
    released: true,
    current,
    version,
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

function main(argv) {
  const notesPath = argv[argv.indexOf("--notes") + 1];
  const result = nextRelease({ repository: process.env.GITHUB_REPOSITORY });
  const { notes: releaseNotes, ...summary } = result;
  if (argv.includes("--notes") && releaseNotes) writeFileSync(notesPath, releaseNotes);
  console.log(JSON.stringify(summary, null, 2));

  const headline = result.released
    ? `Next release: **${result.version}** (${result.level}), after ${result.previousTag}, from ${result.commits.length} commit(s).`
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
