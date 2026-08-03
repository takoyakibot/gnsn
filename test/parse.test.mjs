// 仕様書 7 節「受け入れ基準」の検証。依存パッケージなしで動く。
//   node --test test/

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parse } from '../parse.js';
import { matchKey, norm } from '../names.js';
import {
  ascensionDone,
  attach,
  bandOf,
  buildIndex,
  LAST_ASCENSION_LEVEL,
  LEVEL_BANDS,
  resonance,
  stats,
  talentDone,
  unknownNames,
} from '../roster.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const PC = read('test/fixtures/roster-pc.txt');
const SP = read('test/fixtures/roster-sp.txt');
const DATA = JSON.parse(read('data/characters.json'));
const INDEX = buildIndex(DATA);

// --- 基準 1: PC 版・スマホ版のどちらからも同一の 51 件が得られる ----------

test('PC 版から 51 件を取得できる', () => {
  const { characters, format } = parse(PC);
  assert.equal(characters.length, 51);
  assert.equal(format, 'PC');
});

test('スマホ版から 51 件を取得できる', () => {
  const { characters, format } = parse(SP);
  assert.equal(characters.length, 51);
  assert.equal(format, 'SP');
});

test('PC 版とスマホ版の解析結果が完全に一致する', () => {
  assert.deepEqual(parse(PC).characters, parse(SP).characters);
});

test('先頭 10 件が仕様書の期待値と一致する', () => {
  assert.deepEqual(parse(PC).characters.slice(0, 10), [
    { name: '兹白', level: 90, constellation: 0 },
    { name: 'ドゥリン', level: 90, constellation: 0 },
    { name: 'ドール（女）', level: 90, constellation: 0 },
    { name: 'ドール（男）', level: 90, constellation: 0 },
    { name: '七七', level: 90, constellation: 2 },
    { name: '旅人', level: 90, constellation: 6 },
    { name: 'セトス', level: 90, constellation: 6 },
    { name: '久岐忍', level: 90, constellation: 2 },
    { name: 'サンドローネ', level: 80, constellation: 3 },
    { name: 'リンネア', level: 80, constellation: 0 },
  ]);
});

// --- 基準 2: 全角括弧と半角括弧が同一キャラとして照合される ---------------

test('ドール（女）と ドール(女) が同一キャラとして照合される', () => {
  assert.equal(matchKey('ドール（女）'), matchKey('ドール(女)'));
  assert.equal(norm('ドール(女)'), 'ドール（女）');

  const [full] = attach([{ name: 'ドール（女）', level: 90, constellation: 0 }], INDEX);
  const [half] = attach([{ name: 'ドール(女)', level: 90, constellation: 0 }], INDEX);
  assert.equal(full.known, true);
  assert.equal(half.known, true);
  assert.deepEqual(
    { e: full.element, w: full.weapon, r: full.rarity },
    { e: half.element, w: half.weapon, r: half.rarity },
  );
});

test('異体字（兹白 / 茲白、雲菫 / 雲堇）を吸収する', () => {
  assert.equal(matchKey('兹白'), matchKey('茲白'));
  assert.equal(matchKey('雲菫'), matchKey('雲堇'));
  for (const n of ['兹白', '茲白', '雲菫', '雲堇']) {
    const [c] = attach([{ name: n, level: 90, constellation: 0 }], INDEX);
    assert.equal(c.known, true, `${n} が照合できない`);
  }
});

// --- 基準 3: 途中に異物が混ざっても前後のキャラが取得できる ---------------

test('入力の途中に異物を挿入しても前後のキャラが正しく取得できる', () => {
  const lines = PC.split('\n');
  const at = lines.indexOf('サンドローネ') + 1;
  const broken = [
    ...lines.slice(0, at),
    'ZZ_GARBAGE_ZZ',
    '�',
    '9999',
    ...lines.slice(at),
  ].join('\n');

  const { characters, junk } = parse(broken);
  assert.deepEqual(characters, parse(PC).characters, '異物の前後でキャラが失われている');
  assert.ok(junk.includes('ZZ_GARBAGE_ZZ'));
  assert.ok(junk.includes('9999'));
});

test('解析を打ち切らず末尾まで読み切る（異物が先頭にあっても同じ）', () => {
  const { characters } = parse(`ゴミ\n???\n${PC}`);
  assert.equal(characters.length, 51);
});

// --- 基準 4: 破棄されたトークンを確認できる -------------------------------

test('PC 版末尾の 11 が junk に落ちる', () => {
  assert.ok(parse(PC).junk.includes('11'));
});

test('スマホ版には 11 が現れない', () => {
  assert.equal(parse(SP).junk.includes('11'), false);
});

test('名前が欠落した Lv 行を黙って捨てない', () => {
  const { characters, junk } = parse('Lv.90\nLv.80\n七七 2');
  assert.equal(characters.length, 1);
  assert.ok(junk.some((j) => j.includes('名前なし')));
});

// --- 基準 5: 元素不明のキャラを推測で埋めない -----------------------------

test('データに無い名前は known:false になり推測値で埋まらない', () => {
  const [c] = attach([{ name: '実装前の新キャラ', level: 1, constellation: 0 }], INDEX);
  assert.equal(c.known, false);
  assert.equal(c.element, '?');
  assert.equal(c.weapon, '?');
  assert.equal(c.rarity, null);
  assert.deepEqual(unknownNames([c]), ['実装前の新キャラ']);
});

test('検証用ロスターの 51 件はすべて属性データに存在する', () => {
  const attached = attach(parse(PC).characters, INDEX);
  assert.deepEqual(unknownNames(attached), []);
});

// --- 基準 6: 元素可変キャラを含む編成で共鳴を誤判定しない -----------------

test('旅人・ドールは元素可変として扱われる', () => {
  for (const n of ['旅人', 'ドール（男）', 'ドール（女）']) {
    const [c] = attach([{ name: n, level: 90, constellation: 0 }], INDEX);
    assert.equal(c.element, '可変', `${n} が可変になっていない`);
  }
});

test('可変キャラ 2 人だけでは共鳴と判定しない', () => {
  const team = attach(
    [
      { name: '旅人', level: 90, constellation: 6 },
      { name: 'ドール（女）', level: 90, constellation: 0 },
      { name: '七七', level: 90, constellation: 2 },
      { name: '香菱', level: 80, constellation: 1 },
    ],
    INDEX,
  );
  assert.deepEqual(resonance(team), []);
});

test('元素不明キャラ 2 人だけでは共鳴と判定しない', () => {
  const team = attach(
    [
      { name: '未収録A', level: 1, constellation: 0 },
      { name: '未収録B', level: 1, constellation: 0 },
    ],
    INDEX,
  );
  assert.deepEqual(resonance(team), []);
});

test('同一元素が 2 人いれば共鳴ありと判定する', () => {
  const team = attach(
    [
      { name: '香菱', level: 80, constellation: 1 }, // 炎
      { name: 'ベネット', level: 80, constellation: 5 }, // 炎
      { name: '旅人', level: 90, constellation: 6 }, // 可変
      { name: '七七', level: 90, constellation: 2 }, // 氷
    ],
    INDEX,
  );
  assert.deepEqual(resonance(team), [{ element: '炎', count: 2 }]);
});

// --- 照合キーの健全性 -----------------------------------------------------

test('属性データ全件で照合キーが衝突しない', () => {
  const seen = new Map();
  for (const name of Object.keys(DATA)) {
    const key = matchKey(name);
    assert.equal(seen.has(key), false, `${seen.get(key)} と ${name} が同じキーになる`);
    seen.set(key, name);
  }
});

// --- レベル帯 -------------------------------------------------------------

test('レベル帯は Lv.1〜90 を隙間も重なりもなく覆う', () => {
  for (let level = 1; level <= 90; level++) {
    const hit = LEVEL_BANDS.filter((b) => level >= b.min && level <= b.max);
    assert.equal(hit.length, 1, `Lv.${level} が ${hit.length} 個の帯に該当する`);
  }
});

test('レベル帯の境界が正しい', () => {
  assert.equal(bandOf(90).label, '90〜81');
  assert.equal(bandOf(81).label, '90〜81');
  assert.equal(bandOf(80).label, '80〜71');
  assert.equal(bandOf(63).label, '70〜61');
  assert.equal(bandOf(10).label, '10〜1');
  assert.equal(bandOf(1).label, '10〜1');
});

test('範囲外のレベルは帯なしになる', () => {
  assert.equal(bandOf(0), null);
  assert.equal(bandOf(91), null);
});

test('検証用ロスターの全員がいずれかの帯に入る', () => {
  const orphans = parse(PC).characters.filter((c) => bandOf(c.level) === null);
  assert.deepEqual(orphans.map((c) => `${c.name}(Lv.${c.level})`), []);
});

test('帯を除外すると該当キャラだけが消える', () => {
  const characters = parse(PC).characters;
  const hidden = new Set(['1-10']);
  const shown = characters.filter((c) => !hidden.has(bandOf(c.level)?.key));
  const removed = characters.filter((c) => hidden.has(bandOf(c.level)?.key));
  assert.ok(removed.length > 0, 'Lv.1〜10 のキャラが検証データに居ない');
  assert.equal(shown.length + removed.length, characters.length);
  assert.equal(removed.every((c) => c.level <= 10), true);
  assert.equal(shown.every((c) => c.level > 10), true);
});

// --- 育成の済み判定 -------------------------------------------------------

test('最後の突破は Lv.81 で起きる', () => {
  assert.equal(LAST_ASCENSION_LEVEL, 81);
});

test('Lv.81 以上なら印が無くても突破は済み扱い', () => {
  assert.equal(ascensionDone({ level: 81 }, undefined), true);
  assert.equal(ascensionDone({ level: 90 }, undefined), true);
  assert.equal(ascensionDone({ level: 80 }, undefined), false);
});

test('Lv.80 以下でも印を付ければ突破は済み扱い', () => {
  assert.equal(ascensionDone({ level: 80 }, { level: true }), true);
  assert.equal(ascensionDone({ level: 1 }, { level: true }), true);
  assert.equal(ascensionDone({ level: 80 }, { level: false }), false);
});

test('天賦はレベルでは判定せず印だけで決まる', () => {
  assert.equal(talentDone({ level: 90 }, undefined), false, 'Lv.90 で天賦済みにされている');
  assert.equal(talentDone({ level: 90 }, { talent: true }), true);
  assert.equal(talentDone({ level: 1 }, { talent: true }), true);
});

test('検証用ロスターで突破済みになるのは Lv.81 以上の 8 人', () => {
  const done = parse(PC).characters.filter((c) => ascensionDone(c, undefined));
  assert.equal(done.length, 8);
  assert.equal(done.every((c) => c.level >= 81), true);
});

test('統計値が数え上げられる', () => {
  const s = stats(attach(parse(PC).characters, INDEX));
  assert.equal(s.total, 51);
  assert.equal(s.unknown, 0);
  assert.ok(s.fiveStar > 0 && s.maxLevel > 0 && s.maxConstellation > 0);
});
