/**
 * Repo map cache.
 *
 * Stores symbol data as JSON in .pi/cache/repomap.json.
 * Uses file mtime as the primary freshness signal, with
 * git HEAD hash as a secondary check.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Symbol } from "./parser.ts";

export interface CachedFile {
	mtime: number;
	language: string;
	symbols: Symbol[];
	imports: string[];
	refs: string[];
}

export interface RepoMap {
	version: string;
	generated: string;
	gitHead: string | null;
	files: Record<string, CachedFile>;
}

const CACHE_VERSION = "1";

/**
 * Resolve the cache file path for a project.
 */
function cachePath(cwd: string): string {
	return path.join(cwd, ".pi", "cache", "repomap.json");
}

/**
 * Load the cached repo map, or null if missing/corrupt.
 */
export function load(cwd: string): RepoMap | null {
	const p = cachePath(cwd);
	if (!fs.existsSync(p)) return null;

	try {
		const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
		if (raw.version !== CACHE_VERSION) return null;
		// Only trust caches written by this process. Prevents loading
		// a malicious cache shipped inside a cloned repository.
		if (raw._token !== getSessionToken()) return null;
		return raw as RepoMap;
	} catch {
		return null;
	}
}

// Random token written with each cache save, checked on load.
// Prevents trusting caches written by a different process
// (e.g., a malicious repo shipping a .pi/cache/repomap.json).
let sessionToken: string | null = null;

function getSessionToken(): string {
	if (!sessionToken) {
		sessionToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
	}
	return sessionToken;
}

/**
 * Save a repo map to the cache.
 */
export function save(cwd: string, map: RepoMap): void {
	const p = cachePath(cwd);
	const dir = path.dirname(p);
	fs.mkdirSync(dir, { recursive: true });

	const output = { ...map, _token: getSessionToken() };
	const tmp = `${p}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(output), "utf-8");
	fs.renameSync(tmp, p);
}

/**
 * Find files that need re-scanning.
 *
 * Compares current file mtimes against the cached values.
 * Returns the set of relative paths that changed, plus
 * any new files not in the cache.
 *
 * If gitHead changed, returns null to signal a full rebuild.
 */
export function findStaleFiles(
	cwd: string,
	cached: RepoMap,
	currentGitHead: string | null,
	currentFiles: Map<string, number>,
): Set<string> | null {
	// If git HEAD changed, recommend full rebuild. The mtime check
	// will still catch most changes, but branch switches can reset
	// mtimes without changing content. Better safe than stale.
	if (currentGitHead && cached.gitHead && currentGitHead !== cached.gitHead) {
		return null;
	}

	const stale = new Set<string>();

	// Files that changed or are new
	for (const [filePath, mtime] of currentFiles) {
		const entry = cached.files[filePath];
		if (!entry || entry.mtime < mtime) {
			stale.add(filePath);
		}
	}

	return stale;
}

/**
 * Check if a cache exists for a project.
 */
export function exists(cwd: string): boolean {
	return fs.existsSync(cachePath(cwd));
}
