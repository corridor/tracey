# Committing guidelines

Adopted from the owner's team guidelines. A commit should tell a reviewer what changed, why it
mattered, and enough about the investigation to understand its scope.

## Commit message

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
type(area): describe the change

Why this change was needed, when the title does not make that clear.
```

- **type**: `feat`, `fix`, `refactor` most often; `test`, `docs`, `chore`, `perf`, `build` when
  they describe the actual change.
- **area**: the part of tracey touched. Suggested areas: `model`, `adapters`, `detect`,
  `insights`, `timeline`, `graph`, `diff`, `json`, `inspector`, `web`, `vscode`, `cli`,
  `desktop`, `design`, `perf`, `ci`, `roadmap`, `guides`, `architecture`. Add new ones as
  packages appear.
- **Title**: at most 72 characters; states the outcome in concrete language.
- **Body**: mainly the **why**, not an inventory of files. Explain the problem, constraint, or
  tradeoff, especially when the diff can't show it. A small clear change may need only a title.
- Link an issue when one exists, but use the area for the affected part.
- For a fix, add `Caused By: <commit>` in the footer when the introducing commit is known.
- Describe breaking changes and migration consequences explicitly.
- Good reference: <https://cbea.ms/git-commit/>

Examples:

```text
feat(detect): identify OpenInference spans by span kind
fix(timeline): keep selection when the viewport is resized
perf(model): store span times in typed arrays
docs(roadmap): mark fixture collection as next step
```

### Record the investigation

If a one-off script, query, or search established the scope of the change, put the smallest
useful example in the body: the pattern or essential command and what it found. Not a
transcript, not a throwaway script, no credentials or private trace data.

```text
refactor(model): remove nested span objects

Tree-shaped spans cost allocations on every parse and blocked transfer to
workers as typed arrays.

Impact check: rg -n 'span\.children' packages/ found the view and insight
references updated here.
```

For performance work, include the measurement that justified it (fixture size, before/after
numbers) in the body.

## Atomic commits

- Each commit leaves the repo working: builds, relevant checks pass, and nothing needs a later
  commit to repair it. A commit may touch several packages when they must change together.
- For a larger change: first commit behaviour-preserving refactors, then make the functional
  change in phases that can each stand alone (add new path, move callers over, remove old path).
  If a phase can't stand alone, combine it with its dependent code.
- Atomic but meaningful: avoid one huge commit hiding independent changes, and avoid a long
  series of tiny commits that must be mentally reassembled. Group by a coherent outcome at the
  smallest boundary where everything still works. Keep unrelated cleanup separate.
- Before committing, review the staged diff and run the checks relevant to that commit
  (commands will be listed in `AGENTS.md` once the toolchain exists).
- Work on a branch, not on `master`.
- Commits made by an AI agent end with the attribution trailer the harness specifies.
