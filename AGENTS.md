# Agent instructions

## Commit messages

Every commit in this repository uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<optional scope>): <description>

<optional body>

<optional footer(s)>
```

- **type** is one of:
  - `feat`: a new feature.
  - `fix`: a bug fix.
  - `docs`: documentation only, including the white papers.
  - `style`: formatting with no change in meaning.
  - `refactor`: a code change that neither fixes a bug nor adds a feature.
  - `perf`: makes something faster.
  - `test`: adds or fixes tests.
  - `build`: the build system or dependencies.
  - `ci`: CI configuration.
  - `chore`: anything else.
  - `revert`: undoes an earlier commit.
- **scope** is optional and names the part of the repo, e.g. `dashboard` (`apps/dashboard`) or `paper` (`white-papers/`).
- **description** is in the imperative mood ("add", not "added"), lower case, with no full stop, and short enough that the whole first line stays within 72 characters.
- **Breaking changes** add `!` after the type or scope (`feat(dashboard)!: ...`) and explain the change in a `BREAKING CHANGE:` footer.
- A commit that spans several types is split into separate commits where practical. Otherwise it uses the type of the most significant change.

Examples:

```
feat(dashboard): scope key permissions to single items
fix(dashboard): keep scope choice when switching tenant
docs(paper): describe item-level permissions
test(dashboard): cover malformed permission strings
```

Pull request titles follow the same format, since they often become the squash-merge commit message.
