/**
 * Documentation consistency check for `docs/Production Setup/`.
 *
 * WHY THIS EXISTS
 *   The v35 pass corrected a migration count that had been wrong since `0036`
 *   was written — it still said `0001`-`0035` while nine migrations sat on
 *   disk, and the commercial topology document contradicted the operations
 *   document about whether the NAS worker was tenant-isolated. Nothing caught
 *   either, because no check compared the documentation against the
 *   repository.
 *
 *   That is v33 §3's "a claim that cannot fail" one level up: the docs stated
 *   facts about the database, and nothing could falsify them.
 *
 * WHAT IT ASSERTS
 *   1. Every migration number named in prose exists in `supabase/migrations/`.
 *   2. Every "complete set is 0001-00NN" claim names the real highest file.
 *      A range that stops short is allowed only when the same line mentions the
 *      highest file, which is the shape of an upgrade instruction.
 *   3. Every intra-doc `#anchor` link resolves to a heading in its target.
 *      Renumbering a section orphans its inbound links.
 *   4. Every relative link resolves on disk.
 *
 * Run: `npm run docs:verify`
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not `new URL('..', import.meta.url).pathname`: the latter is
// percent-encoded and this repo path contains a space.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DOCS = join(ROOT, 'docs', 'Production Setup');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const problems = [];
const notes = [];

// 1. Highest migration that exists.
const migFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));
const highest = migFiles.map((f) => Number(f.slice(0, 4))).sort((a, b) => b - a)[0];

// 2. Every doc that names a migration range must name the real one.
const mdFiles = ['README.md', '01-Infrastructure.md', '02-Operations.md', '03-Reference.md', 'CHANGELOG.md'];
for (const f of [...mdFiles, 'guide.html']) {
  const text = readFileSync(join(DOCS, f), 'utf8');
  for (const m of text.matchAll(/00(3[5-9]|4[0-9])/g)) {
    const n = Number(`00${m[1]}`);
    if (n > highest) problems.push(`${f}: names migration 00${n}, but the highest on disk is ${highest}`);
  }
  // A range claim like `0001`-`0035` / `0001` through `0042`.
  //
  // Only a claim about the COMPLETE set is a defect. A range that stops short of
  // the highest file is legitimate in an upgrade instruction ("on an install that
  // already has `0001`-`0043`, apply `0044` alone"), so those are skipped.
  for (const line of text.split('\n')) {
    const range = line.match(/0001`?\s*(?:-|–|through|to)\s*`?00(\d{2})/);
    if (!range) continue;
    const endsAt = Number(range[1]);
    if (endsAt === highest) continue;
    if (line.includes(`00${highest}`)) continue; // an upgrade instruction, not a full-set claim
    problems.push(
      `${f}: claims the complete set ends at 00${endsAt}, but the highest on disk is ${highest} :: ${line.trim().slice(0, 90)}`
    );
  }
}

// 3. Migration numbers named in prose must correspond to a real file.
const known = new Set(migFiles.map((f) => f.slice(0, 4)));
for (const f of mdFiles) {
  const text = readFileSync(join(DOCS, f), 'utf8');
  for (const m of text.matchAll(/`00(\d{2})[a-z_]/g)) {
    if (!known.has(`00${m[1]}`)) problems.push(`${f}: names migration 00${m[1]} which is not on disk`);
  }
}

// 4. Every intra-doc anchor link, from ANY file, must resolve in its target.
//    Renumbering a section orphans its inbound links, and a docs pass that
//    renumbers without this check silently breaks the cross-references.
const slugsOf = (file) =>
  [...readFileSync(join(DOCS, file), 'utf8').matchAll(/^#{2,4}\s+(.+)$/gm)].map((h) =>
    h[1]
      .toLowerCase()
      .replace(/[`*]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
  );

for (const f of [...mdFiles, 'guide.html']) {
  const text = readFileSync(join(DOCS, f), 'utf8');
  for (const m of text.matchAll(/\]\((0\d-[A-Za-z-]+\.md)#([a-z0-9-]+)\)/g)) {
    const [, file, anchor] = m;
    if (!slugsOf(file).includes(anchor)) {
      problems.push(`${f} links to ${file}#${anchor}, which is not a heading in that file`);
    }
  }
}

// 5. Every relative doc link must resolve on disk.
for (const f of mdFiles) {
  const text = readFileSync(join(DOCS, f), 'utf8');
  for (const m of text.matchAll(/\]\((?!https?:)([^)#]+\.(?:md|sql|pdf))\)/g)) {
    const target = m[1].startsWith('..') ? join(ROOT, 'docs', m[1].replace('../', '')) : join(DOCS, m[1]);
    if (!existsSync(target)) problems.push(`${f}: link target does not exist -> ${m[1]}`);
  }
}

console.log(`highest migration on disk: ${highest} (${migFiles.length} files)`);
if (notes.length) console.log(notes.join('\n'));
if (problems.length) {
  console.log(`\n${problems.length} PROBLEM(S):`);
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
console.log('\ndocs verification passed');