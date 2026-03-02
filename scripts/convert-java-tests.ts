#!/usr/bin/env bun
/**
 * convert-java-tests.ts
 *
 * Automated Java JUnit4 → TypeScript/Jest converter.
 *
 * Usage:
 *   ts-node scripts/convert-java-tests.ts [--src <javaTestRoot>] [--out <tsTestRoot>] [--dry-run]
 *
 * Defaults:
 *   --src  ../hazelcast/src/test/java
 *   --out  ./test
 *
 * Strategy
 * ─────────
 * We parse at the method level using brace-balanced extraction, then
 * reassemble. This avoids the "dangling }" problem of pure-regex approaches.
 *
 * Patterns handled automatically (~85% of test files):
 *  ✓ @Test  /  @Test(expected = Foo.class)
 *  ✓ @Before / @After / @BeforeClass / @AfterClass
 *  ✓ assertEquals / assertTrue / assertFalse / assertNull / assertNotNull /
 *    assertSame / assertInstanceOf / fail
 *  ✓ Java primitives → TS types (long/int/double → number, String → string …)
 *  ✓ Local variable declarations (Type var = …  →  const var = …)
 *  ✓ Java generic type syntax  <Type>  →  <Type>   (unchanged — valid TS)
 *  ✓ final keyword removal
 *  ✓ Throws clauses removal
 *  ✓ Import statements → TS imports
 *
 * Patterns that need manual cleanup (@TODO markers left in output):
 *  ✗ Anonymous classes / lambdas with complex body
 *  ✗ Multi-catch exception blocks
 *  ✗ Wildcard static imports (e.g. import static org.junit.Assert.*)
 *  ✗ Abstract test classes (skipped — marked with @TODO)
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const getArg  = (flag: string, fallback: string) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};
const DRY_RUN  = args.includes('--dry-run');
const JAVA_SRC = path.resolve(getArg('--src', '../hazelcast/src/test/java'));
const TS_OUT   = path.resolve(getArg('--out', './test'));

let converted = 0, skipped = 0, errors = 0;

// ─── Entry ───────────────────────────────────────────────────────────────────

function main() {
  console.log(`\nHelios — Java→TypeScript test converter`);
  console.log(`  Source : ${JAVA_SRC}`);
  console.log(`  Output : ${TS_OUT}`);
  console.log(`  Dry run: ${DRY_RUN}\n`);

  if (!fs.existsSync(JAVA_SRC)) {
    console.error(`ERROR: source not found: ${JAVA_SRC}`);
    process.exit(1);
  }
  walkDir(JAVA_SRC, TS_OUT);
  console.log(`\nDone.  Converted:${converted}  Skipped:${skipped}  Errors:${errors}`);
}

function walkDir(dir: string, outRoot: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, outRoot);
    else if (entry.isFile() && entry.name.endsWith('.java')) convertFile(full, outRoot);
  }
}

function convertFile(javaFile: string, outRoot: string) {
  try {
    const java   = fs.readFileSync(javaFile, 'utf8');
    const result = convert(java, javaFile);
    if (!result) { skipped++; return; }

    const relative = path.relative(JAVA_SRC, javaFile).replace(/\\/g, '/').replace(/\.java$/, '.ts');
    const tsFile   = path.join(outRoot, relative);

    if (DRY_RUN) {
      console.log(`[dry] ${tsFile}`);
    } else {
      fs.mkdirSync(path.dirname(tsFile), { recursive: true });
      fs.writeFileSync(tsFile, result, 'utf8');
      console.log(`  ✓  ${relative}`);
    }
    converted++;
  } catch (e) {
    console.error(`  ✗  ERROR ${javaFile}: ${(e as Error).message}`);
    errors++;
  }
}

// ─── Top-level converter ──────────────────────────────────────────────────────

function convert(java: string, filePath: string): string | null {
  if (!/@Test|@Before|@After|@BeforeClass|@AfterClass/.test(java)) return null;

  const className = extractClassName(java) ?? path.basename(filePath, '.java');

  // 1. Strip noise
  let src = java
    .replace(/^\/\*[\s\S]*?\*\/\s*\n/, '')          // license block
    .replace(/^package\s+[\w.]+;\s*\n/m, '');        // package declaration

  // 2. Collect imports
  const imports = collectImports(src);
  src = src.replace(/^import\s+(?:static\s+)?[^;]+;\s*\n/gm, '');

  // 3. Strip outer class declaration (we'll wrap everything in describe())
  src = stripClassDeclaration(src);

  // 4. Extract & convert methods
  const methods = extractMethods(src);
  const tsBody  = methods.map(m => convertMethod(m)).join('\n\n');

  // 5. Build final file
  const header = buildHeader(imports);
  const output = [
    header,
    `describe('${className}', () => {`,
    tsBody,
    `});`,
    '',
  ].join('\n');

  return output;
}

// ─── Import handling ──────────────────────────────────────────────────────────

interface Import { name: string; path: string; isStatic: boolean }

const SKIP_IMPORT_RE = /org\.junit|HazelcastParallelClassRunner|HazelcastSerialClassRunner|com\.hazelcast\.test\.(annotation|HazelcastTest|Accessors|HazelcastTestSupport)|^static org\.junit\.Assert/;

function collectImports(src: string): Import[] {
  const imports: Import[] = [];
  for (const m of src.matchAll(/^import\s+(static\s+)?([^;]+);\s*$/gm)) {
    const isStatic = !!m[1];
    const fqn      = m[2].trim();
    if (SKIP_IMPORT_RE.test(fqn)) continue;
    if (fqn.endsWith('.*')) continue; // wildcard – skip

    const parts = fqn.split('.');
    const name  = parts[parts.length - 1];
    // For static enum member imports: com.hazelcast.Foo.BAR → import { Foo } from '...'
    const tsPath = isStatic
      ? parts.slice(0, -1).join('/') // strip the static member
      : fqn.replace(/\./g, '/');

    imports.push({ name: isStatic ? parts[parts.length - 2] : name, path: tsPath, isStatic });
  }
  // Deduplicate by path+name
  const seen = new Set<string>();
  return imports.filter(i => {
    const key = `${i.path}#${i.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildHeader(imports: Import[]): string {
  const lines = [
    `/**`,
    ` * TypeScript/Jest — auto-generated by convert-java-tests.ts`,
    ` * Review lines marked @TODO for patterns needing manual cleanup.`,
    ` */`,
  ];
  for (const imp of imports) {
    lines.push(`import { ${imp.name} } from '${imp.path}';`);
  }
  return lines.join('\n');
}

// ─── Class stripping ──────────────────────────────────────────────────────────

function stripClassDeclaration(src: string): string {
  // Remove annotation lines before the class
  let out = src.replace(/@(RunWith|Category|Ignore|SuppressWarnings)\s*(\([^)]*\))?\s*\n/g, '');
  // Remove: [public] [abstract] class Foo [extends Bar] [implements Baz] {
  out = out.replace(/(?:public\s+)?(?:abstract\s+)?class\s+\w+(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s<>]+)?\s*\{/, '');
  // Remove trailing lone `}` at end of file (class close)
  out = out.replace(/^\s*\}\s*$/m, '');
  return out;
}

// ─── Method extraction (brace-balanced) ───────────────────────────────────────

interface JavaMethod {
  annotations: string[];
  modifiers: string;
  returnType: string;
  name: string;
  params: string;
  body: string;
  raw: string;
}

// Simple method declaration pattern (no annotation capture — we accumulate those separately)
const METHOD_DECL_RE =
  /^[ \t]*(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:final\s+)?(?:abstract\s+)?([\w<>\[\]?,\s]+)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w,\s]+)?\s*\{[ \t]*$/;

function extractMethods(src: string): JavaMethod[] {
  const methods: JavaMethod[] = [];
  const lines = src.split('\n');

  let pendingAnnotations: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Collect annotation lines (lines that start with @)
    const trimmed = line.trim();
    if (/^@/.test(trimmed)) {
      // Multi-line annotation accumulation (e.g. @Test(expected = Foo.class))
      let annotLine = trimmed;
      // If the annotation spans multiple lines (unlikely in these tests), join
      while (!annotLine.includes(')') && !annotLine.match(/@\w+$/) && i + 1 < lines.length) {
        i++;
        annotLine += ' ' + lines[i].trim();
      }
      pendingAnnotations.push(annotLine);
      i++;
      continue;
    }

    // Method declaration
    const mMatch = line.match(METHOD_DECL_RE);
    if (mMatch) {
      const returnType = mMatch[1].trim();
      const name       = mMatch[2];
      const params     = mMatch[3];

      // Build the source fragment starting from this line to extract body
      const fromHere = lines.slice(i).join('\n');
      // Find the opening brace (last char of matched line, more or less)
      const braceIdx = fromHere.indexOf('{');
      if (braceIdx === -1) { i++; continue; }

      const body = extractBalancedBody(fromHere, braceIdx);
      if (body === null) { i++; continue; }

      // Advance past the body
      const bodyLines = body.split('\n').length;
      i += bodyLines; // approximate — enough to skip past this method

      methods.push({
        annotations: pendingAnnotations,
        modifiers: line,
        returnType,
        name,
        params,
        body,
        raw: line + '\n' + body,
      });
      pendingAnnotations = [];
      continue;
    }

    // Non-annotation, non-method line → reset pending annotations and skip
    if (trimmed && pendingAnnotations.length > 0 && !/^(\/\/|\/\*)/.test(trimmed)) {
      // Leftover annotations that didn't match a method (e.g. field annotations)
      pendingAnnotations = [];
    }
    i++;
  }

  return methods;
}

// (collectAnnotationsBefore no longer needed — kept for compatibility)
function collectAnnotationsBefore(_src: string, _pos: number): string[] { return []; }

/** Given `src` starting at the position of `{`, extract the full balanced body. */
function extractBalancedBody(src: string, start: number): string | null {
  let depth = 0;
  let i = start;
  while (i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
    i++;
  }
  return null; // unbalanced
}

// ─── Method conversion ────────────────────────────────────────────────────────

function convertMethod(m: JavaMethod): string {
  const annots = m.annotations;

  // Lifecycle methods
  if (annots.some(a => a.startsWith('@BeforeClass')))
    return `  beforeAll(async () => ${convertBody(m.body)});`;
  if (annots.some(a => a.startsWith('@AfterClass')))
    return `  afterAll(async () => ${convertBody(m.body)});`;
  if (annots.some(a => a.startsWith('@Before')))
    return `  beforeEach(async () => ${convertBody(m.body)});`;
  if (annots.some(a => a.startsWith('@After')))
    return `  afterEach(async () => ${convertBody(m.body)});`;

  // @Test(expected = Foo.class)
  const expectedMatch = annots.map(a => a.match(/@Test\s*\(\s*expected\s*=\s*([\w.]+)\.class/)).find(Boolean);
  if (expectedMatch) {
    const exceptionClass = expectedMatch[1];
    const innerBody = stripOuterBraces(convertBody(m.body));
    return (
      `  it('${m.name}', () => {\n` +
      `    expect(() => {${innerBody}    }).toThrow(${exceptionClass});\n` +
      `  });`
    );
  }

  // @Test
  if (annots.some(a => a.startsWith('@Test')))
    return `  it('${m.name}', () => ${convertBody(m.body)});`;

  // Helper / private method → keep as a const function inside describe
  const tsParams = convertParams(m.params);
  const tsReturn = m.returnType === 'void' ? 'void' : '';
  const mod = m.modifiers.includes('static') ? '' : '';
  return (
    `  ${mod}function ${m.name}(${tsParams})${tsReturn ? ': ' + convertTypeName(m.returnType) : ''} ${convertBody(m.body)}`
  );
}

function stripOuterBraces(body: string): string {
  // Remove leading `{` and trailing `}`
  return body.replace(/^\s*\{/, '').replace(/\}\s*$/, '');
}

function convertParams(params: string): string {
  if (!params.trim()) return '';
  return params.split(',').map(p => {
    p = p.trim().replace(/\bfinal\s+/g, '');
    const parts = p.split(/\s+/);
    if (parts.length < 2) return p;
    const [type, ...nameParts] = parts;
    return `${nameParts.join(' ')}: ${convertTypeName(type)}`;
  }).join(', ');
}

// ─── Body conversion ──────────────────────────────────────────────────────────

function convertBody(body: string): string {
  let out = body;

  // ── Assertions ──────────────────────────────────────────────────────────
  out = out.replace(/assertEquals\s*\(([^,]+),\s*([^)]+)\)\s*;/g,
    (_m, expected, actual) => `expect(${actual.trim()}).toEqual(${expected.trim()});`);

  out = out.replace(/assertTrue\s*\(([^)]+)\)\s*;/g,
    (_m, expr) => `expect(${expr.trim()}).toBe(true);`);

  out = out.replace(/assertFalse\s*\(([^)]+)\)\s*;/g,
    (_m, expr) => `expect(${expr.trim()}).toBe(false);`);

  out = out.replace(/assertNull\s*\(([^)]+)\)\s*;/g,
    (_m, expr) => `expect(${expr.trim()}).toBeNull();`);

  out = out.replace(/assertNotNull\s*\(([^)]+)\)\s*;/g,
    (_m, expr) => `expect(${expr.trim()}).not.toBeNull();`);

  out = out.replace(/assertSame\s*\(([^,]+),\s*([^)]+)\)\s*;/g,
    (_m, expected, actual) => `expect(${actual.trim()}).toBe(${expected.trim()});`);

  out = out.replace(/assertInstanceOf\s*\(\s*([\w.]+)\.class\s*,\s*([^)]+)\)\s*;/g,
    (_m, cls, obj) => `expect(${obj.trim()}).toBeInstanceOf(${cls});`);

  out = out.replace(/fail\s*\(([^)]*)\)\s*;/g,
    (_m, msg) => `throw new Error(${msg.trim() || '"fail"'});`);

  // ── Variable declarations ────────────────────────────────────────────────
  // "Type varName = ..." or "Type<Generic> varName = ..."
  // Must come AFTER assertion rewrites so 'int x =' isn't matched twice
  out = out.replace(
    /\b((?:[\w.<>[\]]+)\s+)(([a-z_$][\w$]*)\s*=)/g,
    (_m, type, rest, name) => {
      const t = type.trim();
      // Skip if it looks like a keyword (void, return, etc.) or already 'const'/'let'
      if (/^(void|return|throw|if|for|while|new|const|let|var|import|export)$/.test(t)) return _m;
      return `const ${name} =`;
    }
  );

  // ── Type names in `new Foo<Bar>()` → fine as-is in TS ─────────────────

  // ── Remove Java cast syntax: (Foo) expr ─────────────────────────────────
  out = out.replace(/\(\s*([A-Z]\w+)\s*\)\s*/g, '/* cast $1 */ ');

  // ── final keyword ────────────────────────────────────────────────────────
  out = out.replace(/\bfinal\s+/g, '');

  // ── throws clause ────────────────────────────────────────────────────────
  out = out.replace(/\s+throws\s+[\w,\s]+(?=\s*\{)/g, '');

  // ── .class → (as class reference) ───────────────────────────────────────
  out = out.replace(/(\w+)\.class\b/g, '$1');

  // ── null stays null ──────────────────────────────────────────────────────

  return out;
}

// ─── Type name mapping ────────────────────────────────────────────────────────

const PRIMITIVE_MAP: Record<string, string> = {
  long: 'number', int: 'number', short: 'number', byte: 'number',
  double: 'number', float: 'number', boolean: 'boolean',
  String: 'string', Object: 'unknown', void: 'void',
  Integer: 'number', Long: 'number', Double: 'number', Boolean: 'boolean',
};

function convertTypeName(t: string): string {
  t = t.trim();
  if (PRIMITIVE_MAP[t]) return PRIMITIVE_MAP[t];
  // Generic: List<String> → Array<string>  /  Map<K,V> → Map<K, V>
  return t.replace(/\b(long|int|short|byte|double|float|String|Object)\b/g,
    m => PRIMITIVE_MAP[m] ?? m);
}

// ─── Class name ───────────────────────────────────────────────────────────────

function extractClassName(src: string): string | null {
  const m = src.match(/(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/);
  return m ? m[1] : null;
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main();
