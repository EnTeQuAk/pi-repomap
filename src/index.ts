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

export default function (pi: ExtensionAPI) {
	// Inject repo map as context on every prompt
	pi.on("before_agent_start", async (_event, ctx) => {
		let map: cache.RepoMap;
		try {
			map = buildMap(ctx.cwd);
		} catch (err) {
			console.error(`[repomap] buildMap failed: ${err}`);
			return;
		}

		const fileCount = Object.keys(map.files).length;
		if (fileCount === 0) return;

		const contextWindow = ctx.model?.contextWindow;
		const formatted = formatForLLM(map, { contextWindow });

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
		description: "Show repo map status or rebuild",
		handler: async (args, ctx) => {
			const force = args?.includes("--force") ?? false;

			if (force) {
				const start = Date.now();
				const map = buildMap(ctx.cwd, true);
				const fileCount = Object.keys(map.files).length;
				const symbolCount = Object.values(map.files).reduce(
					(sum, f) => sum + f.symbols.length,
					0,
				);
				const duration = Date.now() - start;
				ctx.ui.notify(
					`Rebuilt repo map: ${fileCount} files, ${symbolCount} symbols (${duration}ms)`,
					"success",
				);
			} else {
				ctx.ui.notify(getStatus(ctx.cwd), "info");
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
		],
		parameters: Type.Object({
			action: StringEnum(["status", "rebuild", "outline"] as const),
			file: Type.Optional(
				Type.String({ description: "File path for outline action" }),
			),
		}),

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

					const fullPath = `${ctx.cwd}/${filePath}`;
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
					throw new Error(`Unknown action: ${params.action}`);
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("repomap "));
			text += theme.fg("muted", args.action);
			if (args.file) text += " " + theme.fg("dim", args.file);
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const text = result.content[0];
			const msg = text?.type === "text" ? text.text : "";

			if (result.isError) {
				return new Text(theme.fg("error", msg), 0, 0);
			}

			return new Text(theme.fg("success", "✓ ") + theme.fg("muted", msg), 0, 0);
		},
	});

	// Show status in footer
	pi.on("session_start", async (_event, ctx) => {
		const status = getStatus(ctx.cwd);
		ctx.ui.setStatus("repomap", status);
	});
}
