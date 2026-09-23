# @clementprevot/pi-git-editor-guard

A [Pi](https://pi.dev) extension that keeps git from hanging the coding agent on an editor: commands that would open an interactive TTY editor (`rebase --continue` after a conflict, a bare `commit`, an interactive rebase, ...) are rewritten in place with `GIT_EDITOR=true` so git keeps its prepared message and finishes immediately.

## Why

Agents manage rebases all the time, and the classic failure is `git rebase --continue` after resolving a conflict opens the editor (e.g. VIM) to confirm the commit message. In the agent's non-interactive shell that editor either errors out or, worse, just sits there while the agent waits on a command that will never finish. The fix is well known (`GIT_EDITOR=true`, which overrides `core.editor` and `EDITOR`), but it relies on the model remembering it every single time. This guard makes forgetting impossible.

## Install

```bash
pi install npm:@clementprevot/pi-git-editor-guard
```

Updates ship with `pi update --extensions`. The extension applies to your next session (quit and relaunch or issue a `/reload` command).

## How it works

On every bash tool call, the extension:

1. Splits the command chain into subcommands (respecting quotes and preserving the original separators).
2. Classifies each one: does this git command open an editor, and is that editor already handled?
3. When an editor is missing, prefixes the subcommand in place; the rewritten command is what executes and what the session records.

### Covered commands

- `git rebase --continue` and interactive rebases (`-i`, `--interactive`): `GIT_EDITOR=true`, plus `GIT_SEQUENCE_EDITOR=true` when the todo list is involved (`--edit-todo` needs only the sequence editor)
- `git commit` without a message flag (`-m`, `-F`, `--no-edit`, `-C`, ...) or `git commit --amend` alone
- `git merge`, including `git merge --continue`
- `git cherry-pick --continue` and `git revert -e`
- `git tag -a`/`-s` without `-m` (git then fails fast with a clear "no tag message" error instead of hanging)
- `git notes` without `-m`

### Left alone

- Commands that already set their own editor: `GIT_EDITOR=`, `GIT_SEQUENCE_EDITOR=`, or `-c core.editor=...`. An explicit choice is respected, even the one that would hang.
- Any command that is not git, including `echo git rebase --continue` and comments.

The rewrite is a no-op when git would not have opened an editor anyway (`GIT_EDITOR=true` on `git rebase main` changes nothing), so the guard errs on the side of prefixing.

## Configuration

None. The rewrite is deterministic, always safe in a non-interactive shell, and needs no user interaction during a rebase.

## License

MIT
