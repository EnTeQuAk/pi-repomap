/**
 * pi-repomap: Tree-sitter powered repository map for pi coding agent.
 *
 * Generates a cached symbol map of the current repository using
 * tree-sitter with Zed's outline queries, and injects it as LLM
 * context on every prompt.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

import * as cache from "./cache.ts";
import { scan, getGitHead, type ScannedFile } from "./scanner.ts";
import { detectLanguage, isSupportedFile } from "./languages.ts";
import { extractSymbols } from "./parser.ts";
import { formatForLLM, formatFileOutline } from "./formatter.ts";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Build or incrementally update the repo map for a project.
 */
function buildMap(cwd: string, force: boolean = false): cache.RepoMap {
	const gitHead = getGitHead(cwd);
	const existing = force ? null : cache.load(cwd);

	if (existing) {
		// Collect current file mtimes for staleness check
		const result = scan(cwd);
		const currentFiles = new Map<string, number>();
		for (const f of result.files) {
			currentFiles.set(f.path, f.mtime);
		}

		const stale = cache.findStaleFiles(cwd, existing, gitHead, currentFiles);

		if (stale === null) {
			// Git HEAD changed, full rebuild
			return fullBuild(cwd, result, gitHead);
		}

		if (stale.size === 0) {
			// Nothing changed
			return existing;
		}

		// Incremental: re-scan only stale files, merge with cache
		const incremental = scan(cwd, stale);
		const merged = mergeResults(existing, incremental.files, currentFiles);
		merged.gitHead = gitHead;
		merged.generated = new Date().toISOString();
		cache.save(cwd, merged);
		return merged;
	}

	// No cache, full scan
	const result = scan(cwd);
	return fullBuild(cwd, result, gitHead);
}

function fullBuild(
	cwd: string,
	result: ReturnType<typeof scan>,
	gitHead: string | null,
): cache.RepoMap {
	const files: Record<string, cache.CachedFile> = {};
	for (const f of result.files) {
		files[f.path] = {
			mtime: f.mtime,
			language: f.language,
			symbols: f.symbols.symbols,
			imports: f.imports,
			refs: f.refs,
		};
	}

	const map: cache.RepoMap = {
		version: "1",
		generated: new Date().toISOString(),
		gitHead,
		files,
	};

	cache.save(cwd, map);
	return map;
}

/**
 * Merge incrementally scanned files into an existing cache.
 * Removes files that no longer exist.
 */
function mergeResults(
	existing: cache.RepoMap,
	updated: ScannedFile[],
	currentFiles: Map<string, number>,
): cache.RepoMap {
	const files = { ...existing.files };

	// Remove deleted files
	for (const key of Object.keys(files)) {
		if (!currentFiles.has(key)) {
			delete files[key];
		}
	}

	// Apply updates
	for (const f of updated) {
		files[f.path] = {
			mtime: f.mtime,
			language: f.language,
			symbols: f.symbols.symbols,
			imports: f.imports,
			refs: f.refs,
		};
	}

	return { ...existing, files };
}

/**
 * Get a short status summary of the repo map.
 */
function getStatus(cwd: string): string {
	const map = cache.load(cwd);
	if (!map) return "No repo map. Run /repomap to generate.";

	const fileCount = Object.keys(map.files).length;
	const symbolCount = Object.values(map.files).reduce(
		(sum, f) => sum + f.symbols.length,
		0,
	);
	const age = timeSince(new Date(map.generated));

	return `Repo map: ${fileCount} files, ${symbolCount} symbols (generated ${age} ago)`;
}

function timeSince(date: Date): string {
	const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
	return `${Math.floor(seconds / 86400)}d`;
}

// --- Extension entry point ---

// Configuration interface
interface RepoMapConfig {
	refreshStrategy: "auto" | "always" | "files" | "manual" | "never";
	tokenBudget?: number;
}

// Default configuration
const DEFAULT_CONFIG: RepoMapConfig = {
	refreshStrategy: "auto",
};

// State to track last injection to determine when to refresh
let lastInjection: { gitHead: string | null; fileCount: number; timestamp: number } | null = null;

export default function (pi: ExtensionAPI) {
	// Load configuration
	function getConfig(): RepoMapConfig {
		// TODO: Add proper configuration loading when pi supports it
		// For now, use defaults
		return DEFAULT_CONFIG;
	}

	function shouldInjectRepoMap(ctx: ExtensionContext, map: cache.RepoMap): boolean {
		const config = getConfig();
		const strategy = config.refreshStrategy;

		if (strategy === "never") return false;
		if (strategy === "manual") return false;
		if (strategy === "always") return true;

		const gitHead = getGitHead(ctx.cwd);
		const fileCount = Object.keys(map.files).length;
		const now = Date.now();

		// First injection or strategy is "files"/"auto"
		if (!lastInjection) return true;
		
		if (strategy === "files") {
			// Only inject when git head or file count changes
			return lastInjection.gitHead !== gitHead || lastInjection.fileCount !== fileCount;
		}

		if (strategy === "auto") {
			// Smart refresh: inject if files changed OR it's been >5min since last injection
			const timeSinceLastInjection = now - lastInjection.timestamp;
			const filesChanged = lastInjection.gitHead !== gitHead || lastInjection.fileCount !== fileCount;
			const timeLimitExceeded = timeSinceLastInjection > 5 * 60 * 1000; // 5 minutes

			return filesChanged || timeLimitExceeded;
		}

		return false;
	}

	// Inject repo map as context based on refresh strategy
	pi.on("before_agent_start", (_event, ctx) => {
		let map: cache.RepoMap;
		try {
			map = buildMap(ctx.cwd);
		} catch (err) {
			console.error(`[repomap] buildMap failed: ${String(err)}`);
			return;
		}

		const fileCount = Object.keys(map.files).length;
		if (fileCount === 0) return;

		if (!shouldInjectRepoMap(ctx, map)) return;

		const config = getConfig();
		const contextWindow = ctx.model?.contextWindow;
		const tokenBudget = config.tokenBudget;
		const formatted = formatForLLM(map, { contextWindow, tokenBudget });

		// Update last injection state
		lastInjection = {
			gitHead: getGitHead(ctx.cwd),
			fileCount,
			timestamp: Date.now(),
		};

		return {
			message: {
				customType: "repomap",
				content: formatted,
				display: false,
			},
		};
	});

	// /repomap command for manual control
	pi.registerCommand("repomap", {
		description: "Show repo map status, rebuild, or configure refresh strategy",
		// eslint-disable-next-line @typescript-eslint/require-await
		handler: async (args, ctx) => {
			const force = args?.includes("--force") ?? false;
			const showConfig = args?.includes("--config") ?? false;

			if (showConfig) {
				const config = getConfig();
				const lines = [
					"## Repo Map Configuration",
					"",
					`**Refresh Strategy:** ${config.refreshStrategy}`,
					"- `auto` - Smart refresh (files changed or 5min timeout)",
					"- `always` - Every prompt (heavy context usage)",
					"- `files` - Only when files change",
					"- `manual` - Only via /repomap command",
					"- `never` - Disable completely",
					"",
					`**Token Budget:** ${config.tokenBudget ?? "auto (3% of context window)"}`,
					"",
					"To configure, add to your pi settings:",
					"```json",
					`{`,
					`  "repomap": {`,
					`    "refreshStrategy": "auto",`,
					`    "tokenBudget": 4096`,
					`  }`,
					`}`,
					"```",
				];

				if (lastInjection) {
					const age = Math.floor((Date.now() - lastInjection.timestamp) / 1000);
					lines.push("", `**Last injection:** ${age}s ago (${lastInjection.fileCount} files)`);
				}

				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			if (force) {
				const start = Date.now();
				const map = buildMap(ctx.cwd, true);
				const fileCount = Object.keys(map.files).length;
				const symbolCount = Object.values(map.files).reduce(
					(sum, f) => sum + f.symbols.length,
					0,
				);
				const duration = Date.now() - start;

				// Force inject the rebuilt map
				const config = getConfig();
				const contextWindow = ctx.model?.contextWindow;
				const tokenBudget = config.tokenBudget;
				const formatted = formatForLLM(map, { contextWindow, tokenBudget });

				lastInjection = {
					gitHead: getGitHead(ctx.cwd),
					fileCount,
					timestamp: Date.now(),
				};

				// Send as user message to inject into context
				pi.sendUserMessage(`<repo_map>\n${formatted}\n</repo_map>`);

				ctx.ui.notify(
					`Rebuilt and injected repo map: ${fileCount} files, ${symbolCount} symbols (${duration}ms)`,
					"info",
				);
			} else {
				const config = getConfig();
				const status = getStatus(ctx.cwd);
				const strategy = config.refreshStrategy;

				ctx.ui.notify(
					`${status}\n\n**Refresh strategy:** ${strategy}${strategy === "never" ? " (disabled)" : ""}\n\nUse \`/repomap --config\` for configuration options or \`/repomap --force\` to rebuild.`,
					"info",
				);
			}
		},
	});

	// repomap tool for LLM use
	pi.registerTool({
		name: "repomap",
		label: "Repo Map",
		description:
			"Query or rebuild the repository symbol map. Actions: status (check map freshness), rebuild (force regenerate), outline (get symbol outline for a specific file)",
		promptSnippet: "Query the repository symbol map for codebase structure overview",
		promptGuidelines: [
			"The repo map in your context shows a structural overview of the codebase. Use `repomap outline <file>` to see full symbol details for any file, especially files listed in the summary tiers.",
			"Prefer `repomap outline` over `find` or `ls` when exploring code structure. The outline gives you symbols, nesting, and line numbers in one call.",
			"Repo map injection is controlled by refreshStrategy (auto/always/files/manual/never). Use 'auto' (default) for smart refresh balancing context efficiency with freshness.",
		],
		parameters: Type.Object({
			action: StringEnum(["status", "rebuild", "outline"] as const),
			file: Type.Optional(
				Type.String({ description: "File path for outline action" }),
			),
		}),

		// eslint-disable-next-line @typescript-eslint/require-await
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			switch (params.action) {
				case "status": {
					return {
						content: [{ type: "text", text: getStatus(ctx.cwd) }],
						details: {},
					};
				}

				case "rebuild": {
					const start = Date.now();
					const map = buildMap(ctx.cwd, true);
					const fileCount = Object.keys(map.files).length;
					const symbolCount = Object.values(map.files).reduce(
						(sum, f) => sum + f.symbols.length,
						0,
					);
					const duration = Date.now() - start;
					return {
						content: [
							{
								type: "text",
								text: `Rebuilt repo map: ${fileCount} files, ${symbolCount} symbols (${duration}ms)`,
							},
						],
						details: { fileCount, symbolCount, duration },
					};
				}

				case "outline": {
					if (!params.file) {
						throw new Error("file parameter required for outline action");
					}

					// Normalize path (strip leading @, resolve relative)
					const filePath = params.file.replace(/^@/, "");

					if (!isSupportedFile(filePath)) {
						throw new Error(
							`Unsupported file type: ${filePath}`,
						);
					}

					const language = detectLanguage(filePath);
					if (!language) {
						throw new Error(`Cannot detect language for: ${filePath}`);
					}

					let fullPath: string;
					try {
						fullPath = fs.realpathSync(path.resolve(ctx.cwd, filePath));
					} catch {
						throw new Error(`Cannot resolve path: ${filePath}`);
					}
					if (!fullPath.startsWith(fs.realpathSync(ctx.cwd) + "/")) {
						throw new Error(`Path escapes project directory: ${filePath}`);
					}
					let content: string;
					try {
						content = fs.readFileSync(fullPath, "utf-8");
					} catch {
						throw new Error(`Cannot read file: ${filePath}`);
					}

					const result = extractSymbols(content, language);
					if (!result) {
						throw new Error(`Failed to parse: ${filePath}`);
					}

					const outline = formatFileOutline(filePath, {
						mtime: Date.now(),
						language,
						symbols: result.symbols,
						imports: [],
						refs: [],
					});

					return {
						content: [{ type: "text", text: outline }],
						details: {},
					};
				}

				default:
					throw new Error(`Unknown action: ${String(params.action)}`);
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("repomap "));
			text += theme.fg("muted", args.action);
			if (args.file) text += " " + theme.fg("dim", String(args.file));
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const text = result.content[0];
			const msg = text?.type === "text" ? text.text : "";

			// Determine if this is an error result from the message content
			const isError = msg.toLowerCase().includes("error") || msg.toLowerCase().includes("cannot");

			if (isError) {
				return new Text(theme.fg("error", msg), 0, 0);
			}

			return new Text(theme.fg("success", "✓ ") + theme.fg("muted", msg), 0, 0);
		},
	});

	// Show status in footer
	pi.on("session_start", (_event, ctx) => {
		const status = getStatus(ctx.cwd);
		ctx.ui.setStatus("repomap", status);
	});
}
