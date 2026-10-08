# Rules for every agent on the v12 class-architecture rewrite

Read DESIGN.md (this directory) first. The user approved it on 2026-10-05; do not re-open its
decisions. If something in it cannot work, message `main` with the problem and a proposal.

## Ownership
- One agent per PR. You own exactly your PR's branch and worktree. Never touch another PR's branch.
- Repo: /Users/er/Documents/Projects/v12-class/repo (a clone of eco-incorp/v12). Work in your own
  worktree: /Users/er/Documents/Projects/v12-class/<PR number>. Never share a build directory.
- Old heads of every PR branch are tagged `backup/<branch>-20261005`. Read old code from them
  (`git show backup/…:path`) and salvage what the design keeps.

## The compiler holds no SDK vocabulary
- Compiler code, error variants, error text and tests never mention chains, intents, Portal, tokens,
  USDC, rewards, vaults, Pots or any Sauce SDK name. Use invented vocabularies in tests (a shop, a
  courier). Test of every addition: could a non-Sauce host use it unchanged?
- PR BODIES and docs prose DO lead with the real use: the SDK's
  `Base.Portal.send({ token: USDC, amount }).refundee(r).receive({ … }).then(() => { … })`, shown
  with what the compiler emits for it. Then the generic mechanism, tests, stack, SDK side.
- SauceScript examples write plain integers (`1000000`, not `1000000n`).

## GitHub
- Never merge, close, retarget or approve anything in eco-incorp/v12. Never release.
- Do NOT push until `main` (the lead) has reviewed your branch and says "push". Then force-push
  (`git push --force-with-lease origin <local>:<PR branch>`), rewrite the PR body, and post one short
  comment saying the PR was rewritten for the class design (link DESIGN decisions in prose, not the file).
- Commits: Conventional Commits (`feat(compiler): …`, `test(compiler): …`, `docs: …`). No
  Co-Authored-By or any AI attribution in commits or PR bodies. Commit incrementally, on green.

## Build
- `export PATH="$HOME/.cargo/bin:$PATH"` (Homebrew rustc lacks wasm32).
- `export CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0` to keep target dirs small. Delete
  `compiler/target/debug/incremental` when it grows; stop building if the disk has under 15 GB free.
- Submodules: `git submodule update --init --recursive` in your worktree (or copy
  `v12-evm/lib/*` from /Users/er/Documents/Projects/sauce and delete each copied `.git` file).
- Gates before you report ready: in `compiler/`: `make ci`, `make test-conformance`, `make smoke`
  (wasm). Report counts. Run each heavy gate through the shared lock, one at a time machine-wide:
  `/Users/er/Documents/Projects/v12-class/gate.sh make test-conformance`. Single test files
  (`cargo test -p sauce-core --test <name>`) need no lock. Cap parallel compile jobs with
  `export CARGO_BUILD_JOBS=2`: up to eight agents share 36 GB of RAM.

## Talking to others
- `main` is the lead. Message it with design questions, and with "#<N> ready for review at <sha>"
  plus a summary (what, files, sizes, gates).
- Handoffs between stacked PRs: "#<N> usable at <sha>" (API settled enough to build on) and
  "#<N> final at <sha>". The upper PR rebases or merges the lower branch.
- Your worktree is durable (not /tmp), so unpushed commits survive a session crash. Keep notes you
  would need after a crash in NOTES.md in your worktree's root (untracked).
