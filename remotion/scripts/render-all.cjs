// Renders all six module tour compositions into ../public/videos as H.264 MP4s
// (faststart-friendly yuv420p) plus a poster PNG per module, then reports sizes.
//
// NOTE: invokes the Remotion CLI via node directly (no cmd/npx shell) — Windows
// cmd mangling of backslash paths with spaces previously wrote outputs to junk
// paths like D:\Webmap\360.mp4.
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const outDir = path.join(root, '..', 'public', 'videos');
const cliEntry = path.join(root, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');

const MODULES = ['webgis', 'data', 'production', 'qaqc', 'postgis', 'reports'];

function run(args) {
    const res = spawnSync(process.execPath, [cliEntry, ...args], {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, FORCE_COLOR: '1' },
    });
    if (res.status !== 0) process.exit(res.status || 1);
}

fs.mkdirSync(outDir, { recursive: true });

for (const id of MODULES) {
    const mp4 = path.join(outDir, `tour-${id}.mp4`);
    const poster = path.join(outDir, `tour-${id}-poster.png`);
    console.log(`\n=== Rendering ${id} → ${mp4} ===`);
    run([
        'render',
        path.join(root, 'src', 'index.ts'),
        id,
        mp4,
        '--codec=h264',
        '--crf=19',
        '--pixel-format=yuv420p',
        '--overwrite',
    ]);
    console.log(`=== Still ${id} poster ===`);
    run(['still', path.join(root, 'src', 'index.ts'), id, poster, '--frame=0', '--overwrite']);
}

console.log('\n=== Rendered assets ===');
for (const id of MODULES) {
    for (const kind of ['mp4', 'poster.png']) {
        const f = path.join(outDir, `tour-${id}.${kind}`);
        if (fs.existsSync(f)) {
            const mb = (fs.statSync(f).size / 1024 / 1024).toFixed(2);
            console.log(`  ${f}  (${mb} MB)`);
        }
    }
}
console.log('\nDone.');