import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_TARGETS = [
    'README.md',
    'package.json',
    'src',
    'test',
    'examples',
    'docs/baseline',
];

const TEXT_EXTENSIONS = new Set(['.ts', '.js', '.md', '.json', '.yml', '.yaml']);

const BANNED_PATTERNS = [
    { label: 'HeliosClient', regex: /\bHeliosClient\b/ },
    { label: 'ClientConfig', regex: /\bClientConfig\b/ },
    { label: 'DEFERRED_CLIENT_FEATURES', regex: /\bDEFERRED_CLIENT_FEATURES\b/ },
    { label: '@zenystx/helios-core/client', regex: /@zenystx\/helios-core\/client(?:\b|\/)/ },
    { label: './client', regex: /(^|["'`\s])\.\/client(?=(["'`\s/]|$))/ },
    { label: './client/config', regex: /\.\/client\/config(?=(["'`\s]|$))/ },
];

const shouldSkipPath = (path: string): boolean => {
    return path.includes('/node_modules/')
        || path.startsWith('node_modules/')
        || path.includes('/dist/')
        || path.startsWith('dist/')
        || path.startsWith('plans/')
        || path.startsWith('docs/plans/');
};

const shouldScanFile = (path: string): boolean => {
    if (shouldSkipPath(path)) {
        return false;
    }

    for (const extension of TEXT_EXTENSIONS) {
        if (path.endsWith(extension)) {
            return true;
        }
    }

    return path === 'README.md' || path === 'package.json';
};

const collectFiles = async (entryPath: string): Promise<string[]> => {
    const absolutePath = join(ROOT, entryPath);
    const entryStat = await stat(absolutePath);
    if (entryStat.isFile()) {
        return shouldScanFile(entryPath) ? [entryPath] : [];
    }

    const files: string[] = [];
    for (const child of await readdir(absolutePath)) {
        const childPath = join(entryPath, child);
        if (shouldSkipPath(childPath)) {
            continue;
        }
        files.push(...await collectFiles(childPath));
    }
    return files;
};

const failures: string[] = [];

for (const target of SCAN_TARGETS) {
    const files = await collectFiles(target);
    for (const file of files) {
        const absolutePath = join(ROOT, file);
        const content = await readFile(absolutePath, 'utf8');
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? '';
            for (const pattern of BANNED_PATTERNS) {
                if (pattern.regex.test(line)) {
                    failures.push(`${relative(ROOT, absolutePath)}:${index + 1}: banned token ${pattern.label}`);
                }
            }
        }
    }
}

if (failures.length > 0) {
    console.error('HeliosClient-removal scan failed:');
    for (const failure of failures) {
        console.error(`- ${failure}`);
    }
    process.exit(1);
}

console.log('HeliosClient-removal scan passed.');
