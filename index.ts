/**
 * Rewrites git commands that would open an editor: in the agent's
 * non-interactive shell the editor (usually vim) hangs until someone kills
 * the session. Prefixing the command with GIT_EDITOR=true (and
 * GIT_SEQUENCE_EDITOR=true for interactive rebases) keeps git's prepared
 * message and lets the command finish immediately.
 */
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const GIT_EDITOR = "GIT_EDITOR=true";
export const SEQUENCE_EDITOR = "GIT_SEQUENCE_EDITOR=true";

// Global flags that consume the next token as their value.
const GLOBAL_FLAGS_WITH_VALUE = new Set([
	"-C",
	"-c",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--super-prefix",
	"--exec-path",
]);

// Split a command chain into parts, keeping the separator that followed each
// part so the rewritten command keeps its original structure.
export function splitChain(command: string): Array<{ cmd: string; sep: string }> {
	const parts: Array<{ cmd: string; sep: string }> = [];
	let current = "";
	let quote: string | undefined;
	let i = 0;
	// Whitespace right after a separator joins the separator itself, so a
	// rewritten chain keeps `a && b` spacing instead of collapsing to `a&&b`.
	const trailingWhitespace = () => {
		let ws = "";
		while (i < command.length && /\s/.test(command[i])) {
			ws += command[i];
			i++;
		}
		return ws;
	};
	const flush = (sep: string) => {
		const trimmed = current.trim();
		if (trimmed) parts.push({ cmd: trimmed, sep: current.slice(current.trimEnd().length) + sep });
		current = "";
	};
	while (i < command.length) {
		const ch = command[i];
		if (quote) {
			current += ch;
			if (ch === quote) quote = undefined;
			i++;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			current += ch;
			i++;
			continue;
		}
		const two = command.slice(i, i + 2);
		if (two === "&&" || two === "||") {
			i += 2;
			flush(two + trailingWhitespace());
			continue;
		}
		if (ch === ";" || ch === "|" || ch === "\n") {
			i++;
			flush(ch + trailingWhitespace());
			continue;
		}
		current += ch;
		i++;
	}
	flush("");
	return parts;
}

export function stripAssignments(cmd: string): string {
	let c = cmd.trim();
	while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(c)) {
		const space = c.indexOf(" ");
		if (space === -1) return "";
		c = c.slice(space + 1);
	}
	return c;
}

// Tokens after `git`, skipping global flags (and their values). Undefined when
// the command is not a git command.
export function gitSubcommandTokens(cmd: string): string[] | undefined {
	const tokens = stripAssignments(cmd).split(/\s+/).filter(Boolean);
	if (tokens[0] !== "git") return undefined;
	let i = 1;
	while (i < tokens.length) {
		const token = tokens[i];
		if (GLOBAL_FLAGS_WITH_VALUE.has(token)) {
			i += 2;
			continue;
		}
		if (token.startsWith("-")) {
			i++;
			continue;
		}
		return tokens.slice(i);
	}
	return undefined;
}

// Suppression is per editor: GIT_EDITOR (or -c core.editor) covers the
// message editor, GIT_SEQUENCE_EDITOR only the rebase todo list, so one
// being set never masks a missing other.
function editorCoverage(cmd: string): { message: boolean; sequence: boolean } {
	const tokens = cmd.split(/\s+/);
	return {
		message:
			tokens.some((t) => /^GIT_EDITOR=/.test(t)) || tokens.some((t) => t.includes("core.editor")),
		sequence: tokens.some((t) => /^GIT_SEQUENCE_EDITOR=/.test(t)),
	};
}

const hasLong = (flags: string[], name: string) =>
	flags.some((f) => f === name || f.startsWith(`${name}=`));

// Short flags can carry an attached value (`-mmsg`), so a prefix match is the
// point; `--message` never matches `^-m`.
const hasShort = (flags: string[], short: string) => flags.some((f) => f.startsWith(short));

const hasMessageFlag = (flags: string[]) =>
	flags.some(
		(f) =>
			/^-m/.test(f) ||
			/^-F/.test(f) ||
			/^-C/.test(f) ||
			f === "--no-edit" ||
			f.startsWith("--message") ||
			f.startsWith("--file") ||
			f.startsWith("--reuse-message") ||
			f.startsWith("--reedit-message"),
	);

// Editor assignments the command still needs: empty when the command is not a
// git command, cannot open an editor, or already sets its editor.
export function missingEditorVars(cmd: string): string[] {
	const rest = gitSubcommandTokens(cmd);
	if (!rest) return [];
	const coverage = editorCoverage(cmd);
	const [sub, ...flags] = rest;
	const need: string[] = [];
	const wantEditor = () => {
		if (!coverage.message && !need.includes(GIT_EDITOR)) need.push(GIT_EDITOR);
	};
	const wantSequence = () => {
		if (!coverage.sequence && !need.includes(SEQUENCE_EDITOR)) need.push(SEQUENCE_EDITOR);
	};

	if (sub === "rebase") {
		const todoList = hasLong(flags, "-i") || hasLong(flags, "--interactive");
		if (todoList) wantEditor();
		if (todoList || hasLong(flags, "--edit-todo")) wantSequence();
		if (flags.includes("--continue")) wantEditor();
	} else if (sub === "commit" || sub === "merge") {
		if (!hasMessageFlag(flags) || flags.includes("--continue")) wantEditor();
	} else if (sub === "revert" || sub === "cherry-pick") {
		if (flags.includes("--continue") || hasLong(flags, "-e") || hasLong(flags, "--edit")) wantEditor();
	} else if (sub === "tag") {
		const annotated =
			hasShort(flags, "-a") ||
			hasLong(flags, "--annotate") ||
			hasShort(flags, "-s") ||
			hasLong(flags, "--sign") ||
			hasLong(flags, "-e") ||
			hasLong(flags, "--edit");
		if (annotated && !hasMessageFlag(flags)) wantEditor();
	} else if (sub === "notes") {
		if (!hasMessageFlag(flags)) wantEditor();
	}
	return need;
}

export function rewriteCommand(command: string): string {
	return splitChain(command)
		.map(({ cmd, sep }) => {
			const vars = missingEditorVars(cmd);
			return (vars.length ? `${vars.join(" ")} ${cmd}` : cmd) + sep;
		})
		.join("");
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", (event) => {
		if (!isToolCallEventType("bash", event)) return;
		const command = event.input.command;
		if (!command) return;
		const rewritten = rewriteCommand(command);
		if (rewritten !== command) event.input.command = rewritten;
	});
}
