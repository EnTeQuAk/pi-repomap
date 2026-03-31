/**
 * Repository scanner.
 *
 * Walks git-tracked files, parses each with tree-sitter,
 * and collects symbol information per file.
 */

import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { extractSymbols, type FileSymbols } from "./parser.ts";
import { detectLanguage, isSupportedFile } from "./languages.ts";

const MAX_FILES = 2000;
// Skip files larger than 512KB; they're likely generated or vendored.
const MAX_FILE_SIZE = 512 * 1024;

export interface ScannedFile {
	/** Relative path from repo root */
	path: string;
	/** File modification time (ms since epoch) */
	mtime: number;
	/** Detected language name */
	language: string;
	/** Extracted symbols */
	symbols: FileSymbols;
}

export interface ScanResult {
	files: ScannedFile[];
	/** Number of files skipped due to errors or size limits */
	skipped: number;
	/** Number of files over MAX_FILES that were not scanned */
	truncated: number;
	/** Total scan duration in ms */
	duration: number;
}

/**
 * List git-tracked files in the repository.
 *
 * Uses `git ls-files --cached` which respects .gitignore and only
 * returns committed/staged files (no untracked temp files).
 */
function listGitFiles(cwd: string): string[] {
	try {
		const output = execFileSync("git", ["ls-files", "--cached"], {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
			maxBuffer: 10 * 1024 * 1024,
		});
		return output.split("\n").filter(Boolean);
	} catch {
		return [];
	}
}

/**
 * Get the current git HEAD commit hash.
 */
export function getGitHead(cwd: string): string | null {
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return null;
	}
}

/**
 * Scan a repository for symbols.
 *
 * Walks git-tracked files, filters for supported languages,
 * parses each file, and returns symbol data.
 *
 * Accepts an optional set of paths to limit scanning to (for incremental updates).
 */
export function scan(cwd: string, onlyPaths?: Set<string>): ScanResult {
	const start = Date.now();
	const allFiles = listGitFiles(cwd);

	// Filter to supported languages
	const candidates = allFiles.filter(isSupportedFile);
	const truncated = Math.max(0, candidates.length - MAX_FILES);
	const filesToScan = candidates.slice(0, MAX_FILES);

	const files: ScannedFile[] = [];
	let skipped = 0;

	for (const relPath of filesToScan) {
		// If incremental, skip files not in the changed set
		if (onlyPaths && !onlyPaths.has(relPath)) continue;

		const language = detectLanguage(relPath);
		if (!language) continue;

		const fullPath = `${cwd}/${relPath}`;

		let stat: fs.Stats;
		try {
			stat = fs.statSync(fullPath);
		} catch {
			skipped++;
			continue;
		}

		if (stat.size > MAX_FILE_SIZE) {
			skipped++;
			continue;
		}

		let content: string;
		try {
			content = fs.readFileSync(fullPath, "utf-8");
		} catch {
			skipped++;
			continue;
		}

		const symbols = extractSymbols(content, language);
		if (!symbols) {
			skipped++;
			continue;
		}

		files.push({
			path: relPath,
			mtime: stat.mtimeMs,
			language,
			symbols,
		});
	}

	return {
		files,
		skipped,
		truncated,
		duration: Date.now() - start,
	};
}
