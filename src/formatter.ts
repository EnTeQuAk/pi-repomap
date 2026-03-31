/**
 * Format a repo map as compact, LLM-readable text.
 *
 * Three tiers of detail to maximize visibility within a token budget:
 * - Full outline: top-scoring files get complete symbol trees
 * - Exports only: mid-tier files show just their public API
 * - File listing: remaining files shown as name + symbol count
 */

import type { RepoMap, CachedFile } from "./cache.ts";
import type { Symbol } from "./parser.ts";

// Rough token estimate: 1 token per ~4 characters.
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** Keywords that indicate a symbol is exported/public. */
const EXPORT_KEYWORDS = new Set(["export", "pub"]);

/** Is a symbol exported or public based on its context keywords? */
function isExported(sym: Symbol, language: string): boolean {
	if (language === "go") {
		// Go: capitalized names are exported
		return sym.name.length > 0 && sym.name[0] === sym.name[0].toUpperCase() && sym.name[0] !== sym.name[0].toLowerCase();
	}
	if (language === "python") {
		// Python: top-level symbols without leading underscore
		return sym.depth === 0 && !sym.name.startsWith("_");
	}
	// TS/JS/Rust: look for export/pub in context
	return sym.context.some((c) => EXPORT_KEYWORDS.has(c));
}

// -- Per-file formatting at different detail levels --

/** Full outline with all symbols and nesting. */
function formatFull(filePath: string, file: CachedFile): string {
	const lines: string[] = [filePath];

	for (const sym of file.symbols) {
		const indent = " ".repeat(sym.depth + 1);
		const ctx = sym.context.join(" ");
		const range = sym.line === sym.endLine ? "" : ` L${sym.line}-${sym.endLine}`;
		const label = ctx ? `${ctx} ${sym.name}` : sym.name;
		lines.push(`${indent}${label}${range}`);
	}

	return lines.join("\n");
}

/** Exports-only: just top-level public symbols. */
function formatExports(filePath: string, file: CachedFile): string {
	const exported = file.symbols.filter((s) => isExported(s, file.language) && s.depth === 0);

	if (exported.length === 0) {
		return `${filePath} (${file.symbols.length} symbols)`;
	}

	const lines: string[] = [filePath];
	for (const sym of exported) {
		const ctx = sym.context.join(" ");
		const label = ctx ? `${ctx} ${sym.name}` : sym.name;
		lines.push(` ${label}`);
	}

	const hidden = file.symbols.length - exported.length;
	if (hidden > 0) {
		lines.push(` ... ${hidden} more`);
	}

	return lines.join("\n");
}

/** One-line summary: just file path and symbol count. */
function formatSummary(filePath: string, file: CachedFile): string {
	return `${filePath} (${file.symbols.length})`;
}

// -- Preamble that teaches the LLM how to read and use the map --

function preamble(totalFiles: number, totalSymbols: number): string {
	return `# Repository Map (${totalFiles} files, ${totalSymbols} symbols)

Structural overview of the codebase, ranked by cross-file importance.
Top files show full symbol trees; lower tiers show exports or just
file names. Use \`repomap outline <path>\` to expand any file.
`;
}

export interface FormatOptions {
	/** Max tokens for the entire map. Scales with context window if not set. */
	tokenBudget?: number;
	/** Model context window size in tokens. Used to auto-scale budget. */
	contextWindow?: number;
}

/**
 * Compute the token budget.
 *
 * When no explicit budget is set, use ~3% of the model's context window,
 * clamped between 2048 and 16384. Falls back to 4096 when context
 * window is unknown.
 */
function resolveBudget(options: FormatOptions): number {
	if (options.tokenBudget) return options.tokenBudget;
	if (options.contextWindow) {
		return Math.min(16384, Math.max(2048, Math.floor(options.contextWindow * 0.03)));
	}
	return 4096;
}

interface ScoredFile {
	filePath: string;
	file: CachedFile;
	score: number;
}

/**
 * Build a weighted directed graph from cross-file references, then
 * run PageRank to score file importance.
 *
 * Edge: file A references identifier X defined in file B -> edge A->B.
 * Weight: sqrt(ref count) to dampen high-frequency mentions.
 * Identifiers defined in >5 files are skipped (too generic: "get", "id").
 *
 * Follows aider's approach but without the networkx dependency.
 */
function scoreFiles(entries: [string, CachedFile][]): ScoredFile[] {
	const filePaths = entries.map(([p]) => p);
	const fileSet = new Set(filePaths);

	// Build: identifier name -> set of files that define it
	const definedIn = new Map<string, Set<string>>();
	for (const [filePath, file] of entries) {
		for (const sym of file.symbols) {
			if (sym.depth > 0) continue;
			let files = definedIn.get(sym.name);
			if (!files) {
				files = new Set();
				definedIn.set(sym.name, files);
			}
			files.add(filePath);
		}
	}

	// Build weighted edge list: source -> [{target, weight}]
	const edges = new Map<string, Map<string, number>>();
	for (const p of filePaths) edges.set(p, new Map());

	for (const [referencerPath, file] of entries) {
		const refCounts = new Map<string, number>();
		for (const refName of file.refs) {
			refCounts.set(refName, (refCounts.get(refName) ?? 0) + 1);
		}

		for (const [refName, count] of refCounts) {
			const definers = definedIn.get(refName);
			if (!definers || definers.size > 5) continue;

			const weight = Math.sqrt(count);
			for (const definer of definers) {
				if (definer === referencerPath) continue;
				const outEdges = edges.get(referencerPath)!;
				outEdges.set(definer, (outEdges.get(definer) ?? 0) + weight);
			}
		}
	}

	// PageRank: iterative power method
	const ranks = pageRank(filePaths, edges);

	const scored = entries.map(([filePath, file]) => {
		const rank = ranks.get(filePath) ?? 0;
		const exportedCount = file.symbols.filter((s) => isExported(s, file.language)).length;
		// Combine PageRank with local signals as tiebreakers
		const score = rank * 10000 + exportedCount * 10 + file.symbols.length;
		return { filePath, file, score };
	});
	scored.sort((a, b) => b.score - a.score);
	return scored;
}

/**
 * PageRank via iterative power method.
 *
 * Standard algorithm: each node distributes its rank to outgoing edges
 * proportional to edge weight. Damping factor 0.85, converges in ~20
 * iterations for typical codebases.
 */
function pageRank(
	nodes: string[],
	edges: Map<string, Map<string, number>>,
	damping: number = 0.85,
	iterations: number = 20,
): Map<string, number> {
	const n = nodes.length;
	if (n === 0) return new Map();

	const base = (1 - damping) / n;
	let ranks = new Map<string, number>();
	for (const node of nodes) ranks.set(node, 1 / n);

	for (let i = 0; i < iterations; i++) {
		const next = new Map<string, number>();
		for (const node of nodes) next.set(node, base);

		for (const node of nodes) {
			const outEdges = edges.get(node);
			if (!outEdges || outEdges.size === 0) {
				// Dangling node: distribute rank evenly
				const share = (damping * (ranks.get(node) ?? 0)) / n;
				for (const target of nodes) {
					next.set(target, (next.get(target) ?? 0) + share);
				}
				continue;
			}

			const rank = ranks.get(node) ?? 0;
			let totalWeight = 0;
			for (const w of outEdges.values()) totalWeight += w;

			for (const [target, weight] of outEdges) {
				const share = damping * rank * (weight / totalWeight);
				next.set(target, (next.get(target) ?? 0) + share);
			}
		}

		ranks = next;
	}

	return ranks;
}

/**
 * Format the full repo map for LLM consumption.
 *
 * Allocates the token budget across three tiers:
 * 1. Full outlines for the highest-scoring files (~60% of budget)
 * 2. Exports-only for mid-tier files (~25% of budget)
 * 3. One-line summaries for the rest (~15% of budget)
 */
export function formatForLLM(map: RepoMap, options: FormatOptions = {}): string {
	const budget = resolveBudget(options);
	const entries = Object.entries(map.files);

	if (entries.length === 0) {
		return "# Repository Map\n\nNo supported source files found.";
	}

	const scored = scoreFiles(entries);
	const totalFiles = entries.length;
	const totalSymbols = entries.reduce((sum, [, f]) => sum + f.symbols.length, 0);

	const header = preamble(totalFiles, totalSymbols);
	let output = header;
	let tokens = estimateTokens(header);

	// Tier 1: full outlines, up to ~60% of budget
	const fullBudget = budget * 0.6;
	let idx = 0;

	while (idx < scored.length) {
		const block = "\n" + formatFull(scored[idx].filePath, scored[idx].file);
		const blockTokens = estimateTokens(block);

		if (tokens + blockTokens > fullBudget && idx > 0) break;

		output += block;
		tokens += blockTokens;
		idx++;
	}

	// Tier 2: exports-only, up to ~85% of budget
	const exportsBudget = budget * 0.85;

	if (idx < scored.length) {
		output += "\n";
	}

	while (idx < scored.length) {
		const block = "\n" + formatExports(scored[idx].filePath, scored[idx].file);
		const blockTokens = estimateTokens(block);

		if (tokens + blockTokens > exportsBudget && idx > 0) break;

		output += block;
		tokens += blockTokens;
		idx++;
	}

	// Tier 3: one-line summaries for what's left, filling remaining budget
	if (idx < scored.length) {
		output += "\n";
	}

	const summaryStart = idx;
	while (idx < scored.length) {
		const line = "\n" + formatSummary(scored[idx].filePath, scored[idx].file);
		const lineTokens = estimateTokens(line);

		if (tokens + lineTokens > budget) break;

		output += line;
		tokens += lineTokens;
		idx++;
	}

	// Footer: count of anything that didn't fit at all
	const hidden = scored.length - idx;
	if (hidden > 0) {
		const hiddenSymbols = scored.slice(idx).reduce((sum, e) => sum + e.file.symbols.length, 0);
		output += `\n\n${hidden} more files (${hiddenSymbols} symbols) not shown.`;
	}

	return output;
}

/**
 * Format a single file's outline (for the outline tool action).
 * Always uses full detail regardless of budget.
 */
export function formatFileOutline(filePath: string, file: CachedFile): string {
	return formatFull(filePath, file);
}
