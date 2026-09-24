#!/usr/bin/env node
// npm run pin:engine -- <id>: writes a published build's size and digest into
// its recipe, which is what the kit trusts. The tag is worked out from the
// recipe's commits and patches exactly as the stage script works it out, so a
// recipe whose pin moved after the build was published finds no release.
// The size and digest are GitHub's own, from the release asset API.
//
// Run it as the project's account:
//   GH_TOKEN=$(gh auth token -u Zanaris274) npm run pin:engine -- lostcity-274
// Spec: docs/superpowers/specs/2026-09-19-single-player-builds-design.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactFile, BUILDS_REPO, readRecipe, recipeTag } from '../src/shared/engines.ts';
import { patchHash, readPatches } from './stage-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
if (!id) throw new Error('usage: npm run pin:engine -- <id>');
const path = join(root, 'engines', `${id}.json`);
const raw = JSON.parse(readFileSync(path, 'utf8'));
const recipe = readRecipe(raw);
if (!recipe) throw new Error(`engines/${id}.json is not a recipe the kit can read`);

const tag = recipeTag(recipe, patchHash(readPatches(join(root, recipe.patches))));
const file = artifactFile(recipe.id);
const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
if (process.env.GH_TOKEN) headers.authorization = `Bearer ${process.env.GH_TOKEN}`;

const response = await fetch(`https://api.github.com/repos/${BUILDS_REPO}/releases/tags/${encodeURIComponent(tag)}`, { headers });
if (response.status === 404) throw new Error(`no release ${tag}: dispatch the Engines workflow for ${id} first`);
if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${tag}`);
const release = await response.json();
const asset = release.assets?.find(a => a.name === file);
if (!asset) throw new Error(`release ${tag} has no ${file}`);
const digest = typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') ? asset.digest.slice('sha256:'.length) : null;
if (!digest) throw new Error(`GitHub reports no sha-256 for ${file} in ${tag}`);

raw.artifact = { tag, file, size: asset.size, sha256: digest };
if (!readRecipe(raw)) throw new Error(`the pinned recipe would not read back: ${JSON.stringify(raw.artifact)}`);
writeFileSync(path, `${JSON.stringify(raw, null, 4)}\n`);
console.log(`[pin] engines/${id}.json now pins ${tag}: ${asset.size} bytes, sha-256 ${digest}`);
