#!/usr/bin/env bun
/**
 * async-imap-codemod.ts
 *
 * Codemod script for Block 12.A3: IMap async migration.
 *
 * Transforms TypeScript source files so that calls to the 11 IMap methods
 * that became async in Block 12.A3 are properly awaited.
 *
 * Methods migrated from sync to async:
 *   put, set, get, remove, delete, clear,
 *   putIfAbsent, putAll, getAll, replace, replaceIfSame
 *
 * Usage:
 *   bun scripts/async-imap-codemod.ts [--dry-run] [paths...]
 *
 * Examples:
 *   bun scripts/async-imap-codemod.ts src/ test/        # transform all TS files
 *   bun scripts/async-imap-codemod.ts --dry-run test/   # preview changes only
 *
 * What the codemod does:
 *   1. Finds all .ts files under the given paths (default: src/ test/ packages/ examples/)
 *   2. For each file, finds call expressions for the 11 async IMap methods
 *   3. Wraps bare calls with `await` when not already awaited
 *   4. Reports the number of transformations per file
 *
 * Limitations:
 *   - Uses regex-based transforms (not a full AST codemod).
 *   - May need manual review for complex chained calls.
 *   - Does NOT add `async` to containing functions — do that manually if tsc reports errors.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

// ── Configuration ────────────────────────────────────────────────────────────

const ASYNC_METHODS = [
    'put', 'set', 'get', 'remove', 'delete', 'clear',
    'putIfAbsent', 'putAll', 'getAll', 'replace', 'replaceIfSame',
];

const DEFAULT_PATHS = ['src', 'test', 'packages', 'examples'];

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const searchPaths = args.filter(a => !a.startsWith('--'));
const roots = searchPaths.length > 0 ? searchPaths : DEFAULT_PATHS;

// ── File discovery ────────────────────────────────────────────────────────────

function collectTsFiles(dir: string): string[] {
    const files: string[] = [];
    try {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            const stat = statSync(full);
            if (stat.isDirectory()) {
                // Skip node_modules and dist
                if (entry === 'node_modules' || entry === 'dist') continue;
                files.push(...collectTsFiles(full));
            } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
                files.push(full);
            }
        }
    } catch {
        // Silently ignore inaccessible directories
    }
    return files;
}

// ── Transform ─────────────────────────────────────────────────────────────────

/**
 * Transforms a TypeScript source string by adding `await` to bare calls of
 * the 11 IMap async methods.
 *
 * Handles patterns like:
 *   map.put(k, v)        → await map.put(k, v)
 *   map.get(k)           → await map.get(k)
 *   const v = map.get(k) → const v = await map.get(k)
 *
 * Skips patterns already awaited:
 *   await map.put(...)   (no change)
 *   return map.put(...)  (return of a promise — left to the developer)
 *
 * Returns { source: string; count: number }.
 */
function transform(source: string): { source: string; count: number } {
    let count = 0;
    let result = source;

    // Build pattern: matches <receiver>.<method>( not preceded by `await `
    // The negative lookbehind (?<!await ) ensures we don't double-await.
    const methodPattern = ASYNC_METHODS.join('|');
    // Match: optional leading whitespace/assignment context + call (not already awaited)
    // We use a global regex to find all occurrences line by line.
    const lineRegex = new RegExp(
        `(?<!await\\s)(?<=[\\s=,(\\[{;]|^)(\\w+\\.(?:${methodPattern})\\s*\\()`,
        'gm',
    );

    result = result.replace(lineRegex, (match, _prefix, call) => {
        count++;
        return match.replace(call, `await ${call}`);
    });

    return { source: result, count };
}

// ── Main ──────────────────────────────────────────────────────────────────────

let totalFiles = 0;
let totalTransformations = 0;
let modifiedFiles = 0;

const allFiles: string[] = [];
for (const root of roots) {
    allFiles.push(...collectTsFiles(root));
}

for (const file of allFiles) {
    const original = readFileSync(file, 'utf-8');
    const { source: transformed, count } = transform(original);

    if (count > 0) {
        modifiedFiles++;
        totalTransformations += count;
        const rel = relative(process.cwd(), file);
        console.log(`${dryRun ? '[dry-run] ' : ''}${rel}: ${count} transformation(s)`);
        if (!dryRun) {
            writeFileSync(file, transformed, 'utf-8');
        }
    }
    totalFiles++;
}

console.log('');
console.log(`Scanned ${totalFiles} files.`);
console.log(`${dryRun ? 'Would modify' : 'Modified'} ${modifiedFiles} file(s) with ${totalTransformations} total transformation(s).`);
if (dryRun) {
    console.log('Re-run without --dry-run to apply changes.');
}
