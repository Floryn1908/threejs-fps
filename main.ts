// main.ts — Emberline entrypoint for make.fun threejs-fps-02.
// Copies game/ and screenshots/ into $MAKEFUN_OUTPUT_DIR (default /output) and
// writes /output/dossier.json with buildDossier from vendor/makefun-threejs.ts.
// Node 22, stdlib only. Run: MAKEFUN_OUTPUT_DIR=out node main.ts
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoDir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');

const gameDir = join(repoDir, 'game');
const shotsDir = join(repoDir, 'screenshots');

if (!existsSync(gameDir)) {
  console.error(`game/ not found in ${repoDir}`);
  process.exit(1);
}
if (!existsSync(shotsDir)) {
  console.error(`screenshots/ not found in ${repoDir}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
cpSync(gameDir, join(outDir, 'game'), { recursive: true });
cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });

// Deterministic check: the vendor three.js files must be present.
for (const f of ['game/vendor/three/three.module.min.js', 'game/vendor/three/three.core.min.js']) {
  if (!existsSync(join(repoDir, f))) {
    console.error(`missing vendored file: ${f}`);
    process.exit(1);
  }
}

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);

const parsed = JSON.parse(new TextDecoder().decode(dossier));
const shots = readdirSync(join(outDir, 'screenshots')).sort();
console.log(`dossier written: ${join(outDir, 'dossier.json')} (${dossier.length} bytes)`);
console.log(`screenshots: ${shots.join(', ')}`);
console.log(`dossier text bytes: ${Buffer.byteLength(parsed.text ?? '', 'utf8')} / 163840`);
console.log(`dossier images: ${(parsed.images ?? []).length}`);
