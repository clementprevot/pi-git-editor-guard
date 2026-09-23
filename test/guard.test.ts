import assert from "node:assert/strict";
import { test } from "node:test";

import {
	GIT_EDITOR,
	SEQUENCE_EDITOR,
	missingEditorVars,
	rewriteCommand,
	splitChain,
	stripAssignments,
} from "../index.ts";

test("splitChain keeps the separator that followed each part", () => {
	assert.deepEqual(splitChain("a && b; c | d || e\necho 'x; y'"), [
		{ cmd: "a", sep: " && " },
		{ cmd: "b", sep: "; " },
		{ cmd: "c", sep: " | " },
		{ cmd: "d", sep: " || " },
		{ cmd: "e", sep: "\n" },
		{ cmd: "echo 'x; y'", sep: "" },
	]);
});

test("stripAssignments removes leading variable assignments", () => {
	assert.equal(stripAssignments("FOO=1 BAR=2 git status"), "git status");
	assert.equal(stripAssignments("git status"), "git status");
	assert.equal(stripAssignments("FOO=1"), "");
});

test("rebase --continue asks for GIT_EDITOR", () => {
	assert.deepEqual(missingEditorVars("git rebase --continue"), [GIT_EDITOR]);
	assert.deepEqual(missingEditorVars("git rebase main"), []);
	assert.deepEqual(missingEditorVars("git rebase --abort"), []);
});

test("interactive rebase asks for both editors", () => {
	assert.deepEqual(missingEditorVars("git rebase -i HEAD~3"), [GIT_EDITOR, SEQUENCE_EDITOR]);
	assert.deepEqual(missingEditorVars("git rebase --interactive --autostash main"), [GIT_EDITOR, SEQUENCE_EDITOR]);
	assert.deepEqual(missingEditorVars("git rebase --edit-todo"), [SEQUENCE_EDITOR]);
});

test("commit asks for GIT_EDITOR unless a message flag covers it", () => {
	assert.deepEqual(missingEditorVars("git commit"), [GIT_EDITOR]);
	assert.deepEqual(missingEditorVars("git commit --amend"), [GIT_EDITOR]);
	assert.deepEqual(missingEditorVars("git commit -m 'fix: thing'"), []);
	assert.deepEqual(missingEditorVars("git commit -mmsg"), []);
	assert.deepEqual(missingEditorVars("git commit -F msg.txt"), []);
	assert.deepEqual(missingEditorVars("git commit --amend --no-edit"), []);
	assert.deepEqual(missingEditorVars("git commit -C HEAD"), []);
});

test("merge, cherry-pick, revert, tag, notes behave per their own rules", () => {
	assert.deepEqual(missingEditorVars("git merge feature"), [GIT_EDITOR]);
	assert.deepEqual(missingEditorVars("git merge --no-edit feature"), []);
	assert.deepEqual(missingEditorVars("git merge -m 'merge' feature"), []);
	assert.deepEqual(missingEditorVars("git merge --continue"), [GIT_EDITOR]);
	assert.deepEqual(missingEditorVars("git cherry-pick abc123"), []);
	assert.deepEqual(missingEditorVars("git cherry-pick --continue"), [GIT_EDITOR]);
	assert.deepEqual(missingEditorVars("git revert -e abc123"), [GIT_EDITOR]);
	assert.deepEqual(missingEditorVars("git revert abc123"), []);
	assert.deepEqual(missingEditorVars("git tag v1"), []);
	assert.deepEqual(missingEditorVars("git tag -a v1"), [GIT_EDITOR]);
	assert.deepEqual(missingEditorVars("git tag -a v1 -m 'release'"), []);
	assert.deepEqual(missingEditorVars("git tag -s v1"), [GIT_EDITOR]);
	assert.deepEqual(missingEditorVars("git notes add abc123"), [GIT_EDITOR]);
	assert.deepEqual(missingEditorVars("git notes add -m 'note' abc123"), []);
});

test("commands that already set an editor are left alone", () => {
	assert.deepEqual(missingEditorVars("GIT_EDITOR=true git rebase --continue"), []);
	assert.deepEqual(missingEditorVars("GIT_SEQUENCE_EDITOR=true git rebase -i HEAD~3"), [GIT_EDITOR]);
	assert.deepEqual(missingEditorVars("EDITOR=vim git commit"), [GIT_EDITOR]);
	assert.deepEqual(missingEditorVars("git -c core.editor=vim rebase --continue"), []);
	assert.deepEqual(missingEditorVars("git -c core.editor=true commit"), []);
});

test("non-git commands are ignored", () => {
	assert.deepEqual(missingEditorVars("echo git rebase --continue"), []);
	assert.deepEqual(missingEditorVars("rg foo"), []);
	assert.deepEqual(missingEditorVars("# git rebase --continue"), []);
});

test("rewriteCommand prefixes only the parts that need it and preserves separators", () => {
	assert.equal(
		rewriteCommand("git add -A && git rebase --continue && git push"),
		`git add -A && ${GIT_EDITOR} git rebase --continue && git push`,
	);
	assert.equal(
		rewriteCommand("git commit -m 'x'; git commit"),
		`git commit -m 'x'; ${GIT_EDITOR} git commit`,
	);
});

test("rewriteCommand is idempotent", () => {
	const once = rewriteCommand("git rebase --continue");
	assert.equal(rewriteCommand(once), once);
});
