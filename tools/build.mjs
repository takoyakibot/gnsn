// genshin-db から data/characters.json を生成する。
//
// このスクリプトはビルド時にしか動かない。生成した JSON をコミットし、
// サイト本体は実行時に外部へ一切問い合わせない。
//
//   npm ci && npm run build:data
//
// 新キャラ実装時にだけ回す。失敗したら JSON を書かずに非ゼロ終了する
// （黙って古いデータのまま成功させない）。

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import gdb from 'genshin-db';
import { matchKey } from '../names.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JP = { resultLanguage: 'Japanese', queryLanguages: ['Japanese'] };

// genshin-db は元素可変キャラを「無」として持っている。
// 該当は 空 / 蛍 / ドール（男）/ ドール（女）の 4 件のみで、他に「無」はいない。
// 単一元素として扱うと元素共鳴の判定を誤るため専用値へ置き換える。
const VARIABLE_ELEMENT = '可変';

function fail(message, detail) {
  console.error(`\n[build:data] 失敗: ${message}`);
  if (detail?.length) for (const d of detail) console.error(`  - ${d}`);
  console.error('\ndata/characters.json は更新していない。\n');
  process.exit(1);
}

// --- genshin-db から抽出 ---------------------------------------------------

const names = gdb.characters('names', { ...JP, matchCategories: true });
if (!Array.isArray(names) || names.length === 0) {
  fail('genshin-db からキャラ一覧を取得できなかった');
}

const characters = {};
const unresolved = [];

for (const name of names) {
  const c = gdb.characters(name, JP);
  if (!c?.name || !c.elementText || !c.weaponText || !c.rarity) {
    unresolved.push(name);
    continue;
  }
  characters[c.name] = {
    element: c.elementText === '無' ? VARIABLE_ELEMENT : c.elementText,
    weapon: c.weaponText,
    rarity: c.rarity,
  };
}

if (unresolved.length) {
  fail('属性を取得できないキャラがいる', unresolved);
}

// --- 別名テーブルの適用 ----------------------------------------------------
//
// HoYoLAB の表記が genshin-db の表記と意味的に異なるものだけを持つ。
// 全角半角・異体字といった機械的な揺れは matchKey() が吸収するのでここには書かない。
// 例: HoYoLAB は旅人を「旅人」と表示するが、genshin-db は「空」「蛍」で持っている。

const aliases = JSON.parse(readFileSync(join(ROOT, 'tools/aliases.json'), 'utf8'));
const badAliases = [];

for (const [hoyolabName, gdbName] of Object.entries(aliases)) {
  const target = characters[gdbName];
  if (!target) {
    badAliases.push(`${hoyolabName} -> ${gdbName}（参照先が genshin-db に存在しない）`);
    continue;
  }
  characters[hoyolabName] = { ...target };
}

if (badAliases.length) {
  fail('別名テーブルの参照先が壊れている', badAliases);
}

// --- 照合キーの衝突検査 ----------------------------------------------------
//
// matchKey() が異なる 2 キャラを同じキーへ潰してしまうと、静かに誤った属性が出る。

const seen = new Map();
const collisions = [];
for (const name of Object.keys(characters)) {
  const key = matchKey(name);
  if (seen.has(key)) collisions.push(`${seen.get(key)} と ${name} が同じキー "${key}" になる`);
  else seen.set(key, name);
}

if (collisions.length) {
  fail('照合キーが衝突している。names.js の VARIANTS を見直すこと', collisions);
}

// --- 書き出し --------------------------------------------------------------

const sorted = Object.fromEntries(
  Object.keys(characters)
    .sort((a, b) => a.localeCompare(b, 'ja'))
    .map((k) => [k, characters[k]]),
);

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(join(ROOT, 'data/characters.json'), `${JSON.stringify(sorted, null, 1)}\n`, 'utf8');

const variable = Object.entries(sorted).filter(([, v]) => v.element === VARIABLE_ELEMENT);

console.log(`[build:data] ${Object.keys(sorted).length} 件を data/characters.json に書き出した`);
console.log(`  genshin-db から ${names.length} 件`);
for (const [from, to] of Object.entries(aliases)) console.log(`  別名解決: ${from} <- ${to}`);
console.log(`  元素可変として扱う: ${variable.map(([k]) => k).join(' / ')}`);
