// 突破素材・天賦素材の検証。依存パッケージなしで動く。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parse } from '../parse.js';
import { matchKey } from '../names.js';
import { aggregate, availableToday, describe, domainWeekday, moraRows } from '../materials.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const CHARACTERS = JSON.parse(read('data/characters.json'));
const FILE = JSON.parse(read('data/materials.json'));
const MATERIALS = FILE.characters;
const MORA = FILE.mora;
const PC = read('test/fixtures/roster-pc.txt');

const GROUP_KEYS = ['gem', 'boss', 'local', 'common', 'book', 'weeklyBoss', 'crown'];
const eachGroup = (fn) => {
  for (const [name, entry] of Object.entries(MATERIALS)) {
    for (const [section, group] of Object.entries(entry)) {
      for (const key of GROUP_KEYS) {
        if (group[key]) fn({ name, section, key, items: group[key] });
      }
    }
  }
};

// --- データの整合性 -------------------------------------------------------

test('検証用ロスターの 51 件すべてに素材データがある', () => {
  const index = new Set(Object.keys(MATERIALS).map(matchKey));
  const missing = parse(PC).characters.filter((c) => !index.has(matchKey(c.name)));
  assert.deepEqual(missing.map((c) => c.name), []);
});

test('素材データのキーはすべて characters.json に存在する', () => {
  const known = new Set(Object.keys(CHARACTERS).map(matchKey));
  const orphans = Object.keys(MATERIALS).filter((n) => !known.has(matchKey(n)));
  assert.deepEqual(orphans, []);
});

test('素材は { name } か { name, from } の形だけを持つ（数量は持たない）', () => {
  const bad = [];
  eachGroup(({ name, section, key, items }) => {
    for (const item of items) {
      const keys = Object.keys(item).sort().join(',');
      if (keys !== 'name' && keys !== 'from,name') bad.push(`${name}/${section}/${key}: ${keys}`);
      if (!item.name) bad.push(`${name}/${section}/${key}: name が空`);
    }
  });
  assert.deepEqual(bad, []);
});

test('モラはキャラ側に持たない（全キャラ共通の早見表に切り出してある）', () => {
  const withMora = Object.entries(MATERIALS).filter(([, e]) =>
    Object.values(e).some((g) => 'mora' in g),
  );
  assert.deepEqual(withMora.map(([n]) => n), []);
});

test('レアリティ段階は畳まれている（宝石・天賦本・共通素材は 1 つ）', () => {
  const bad = [];
  eachGroup(({ name, section, key, items }) => {
    if (['gem', 'book', 'common'].includes(key) && items.length !== 1) {
      bad.push(`${name}/${section}/${key}: ${items.map((i) => i.name).join(' / ')}`);
    }
  });
  assert.deepEqual(bad, []);
});

test('宝石名にレアリティ段階の接尾辞が残っていない', () => {
  const bad = [];
  eachGroup(({ name, key, items }) => {
    if (key !== 'gem') return;
    for (const i of items) if (/·(砕屑|欠片|塊)$/.test(i.name)) bad.push(`${name}: ${i.name}`);
  });
  assert.deepEqual(bad, []);
});

test('天賦本名に「の教え/導き/哲学」が残っていない', () => {
  const bad = [];
  eachGroup(({ name, key, items }) => {
    if (key !== 'book') return;
    for (const i of items) if (/の(教え|導き|哲学)$/.test(i.name)) bad.push(`${name}: ${i.name}`);
  });
  assert.deepEqual(bad, []);
});

test('ボス素材・週ボス素材には入手元が付く', () => {
  const bad = [];
  eachGroup(({ name, section, key, items }) => {
    if (!['boss', 'weeklyBoss'].includes(key)) return;
    for (const i of items) if (!i.from) bad.push(`${name}/${section}/${key}/${i.name}`);
  });
  assert.deepEqual(bad, []);
});

test('入手元に「がドロップ」「挑戦報酬」「（Lv.XX以上）」が残っていない', () => {
  const bad = [];
  eachGroup(({ name, key, items }) => {
    for (const i of items) {
      const target = key === 'common' ? i.name : i.from;
      if (target && /(ドロップ|挑戦報酬|Lv\.\d+以上)/.test(target)) bad.push(`${name}: ${target}`);
    }
  });
  assert.deepEqual(bad, []);
});

test('香菱の素材が期待どおり', () => {
  const m = MATERIALS['香菱'];
  assert.deepEqual(m.ascension.gem, [{ name: '炎願のアゲート' }]);
  assert.deepEqual(m.ascension.local, [{ name: '絶雲の唐辛子' }]);
  assert.deepEqual(m.ascension.boss, [{ name: '常燃の火種', from: '爆炎樹' }]);
  assert.deepEqual(m.ascension.common, [{ name: 'スライム' }]);
  assert.deepEqual(m.talent.book, [{ name: '「勤労」' }]);
  assert.deepEqual(m.talent.weeklyBoss, [{ name: '東風の爪', from: '風魔龍' }]);
  assert.deepEqual(m.talent.crown, [{ name: '知恵の冠' }]);
});

test('突破のボス素材と天賦の週ボス素材が別々に分類される', () => {
  // 兹白 は突破が 悪夢の枯骸、天賦が 昇揚のサンプル「王族」。typeText は同じなので
  // 出現箇所で分けないと混ざる。
  const z = MATERIALS['兹白'];
  assert.deepEqual(z.ascension.boss, [{ name: '悪夢の枯骸', from: '昏き魘夢の主' }]);
  assert.deepEqual(z.talent.weeklyBoss, [
    { name: '昇揚のサンプル「王族」', from: '扉に通ずる対局' },
  ]);
});

test('天賦本には秘境名と曜日が付く', () => {
  const t = MATERIALS['香菱'].talent;
  assert.equal(t.domain, '熟知秘境：深炎の底');
  assert.deepEqual(t.days, ['火曜', '金曜', '日曜']);
});

test('冠は天賦本と混ざらない', () => {
  assert.deepEqual(MATERIALS['香菱'].talent.crown, [{ name: '知恵の冠' }]);
  assert.equal(MATERIALS['香菱'].talent.book.some((i) => i.name === '知恵の冠'), false);
});

test('旅人は突破素材のみ・ドールは天賦素材のみ（推測で埋めない）', () => {
  assert.ok(MATERIALS['旅人'].ascension, '旅人に突破素材がない');
  assert.equal(MATERIALS['旅人'].talent, undefined, '旅人に天賦素材が捏造されている');
  assert.ok(MATERIALS['ドール（女）'].talent, 'ドール（女）に天賦素材がない');
  assert.equal(MATERIALS['ドール（女）'].ascension, undefined, 'ドール（女）に突破素材が捏造されている');
});

test('旅人と空の素材が一致する（別名解決）', () => {
  assert.deepEqual(MATERIALS['旅人'], MATERIALS['空']);
});

// --- describe() -----------------------------------------------------------

test('describe() はデータの無い節を missing として返す', () => {
  const d = describe(MATERIALS['旅人']);
  assert.equal(d.ascension.missing, false);
  assert.ok(d.ascension.sections.length > 0);
  assert.equal(d.talent.missing, true);
  assert.deepEqual(d.talent.sections, []);
});

test('describe() は空エントリでも落ちない', () => {
  const d = describe(undefined);
  assert.equal(d.ascension.missing, true);
  assert.equal(d.talent.missing, true);
  assert.equal(d.common, null);
});

test('describe() は突破と天賦で同じドロップ元を一度だけ返す', () => {
  const d = describe(MATERIALS['香菱']);
  assert.deepEqual(d.common, [{ name: 'スライム' }]);
  // 共通化できたので各節からは消える
  assert.equal(d.ascension.sections.some((s) => s.key === 'common'), false);
  assert.equal(d.talent.sections.some((s) => s.key === 'common'), false);
});

test('describe() は片方しか無い場合もドロップ元を拾う', () => {
  assert.deepEqual(describe(MATERIALS['旅人']).common, [{ name: 'ヒルチャール' }]);
  assert.deepEqual(describe(MATERIALS['ドール（女）']).common, [{ name: '部族竜戦士' }]);
});

test('describe() の節は定義順に並ぶ', () => {
  const d = describe(MATERIALS['香菱']);
  assert.deepEqual(d.ascension.sections.map((s) => s.key), ['gem', 'boss', 'local']);
  assert.deepEqual(d.talent.sections.map((s) => s.key), ['book', 'weeklyBoss', 'crown']);
});

test('describe() はドロップ元が食い違えば各節に残す', () => {
  const entry = {
    ascension: { gem: [{ name: 'X' }], common: [{ name: 'スライム' }] },
    talent: { book: [{ name: '「Y」' }], common: [{ name: 'ヒルチャール' }] },
  };
  const d = describe(entry);
  assert.equal(d.common, null);
  assert.ok(d.ascension.sections.some((s) => s.key === 'common'));
  assert.ok(d.talent.sections.some((s) => s.key === 'common'));
});

// --- aggregate() ----------------------------------------------------------

const pick = (...names) => names.map((name) => ({ name, entry: MATERIALS[name] }));

test('aggregate() は同じ素材を 1 つに畳んで必要なキャラを並べる', () => {
  // 香菱 と ベネット は元素も国も同じで、共通素材（スライム）と冠が重なる
  const { sections } = aggregate(pick('香菱', 'ベネット'));
  const crown = sections.find((s) => s.key === 'crown');
  assert.equal(crown.items.length, 1, '冠が 2 行に割れている');
  assert.deepEqual(crown.items[0], {
    name: '知恵の冠',
    from: null,
    characters: ['香菱', 'ベネット'],
  });
});

test('aggregate() は違う素材を別行にする', () => {
  const { sections } = aggregate(pick('香菱', '兹白'));
  const gem = sections.find((s) => s.key === 'gem');
  assert.deepEqual(
    gem.items.map((i) => [i.name, i.characters]),
    [
      ['炎願のアゲート', ['香菱']],
      ['堅牢なトパーズ', ['兹白']],
    ],
  );
});

test('aggregate() の節は定義順に並び、空の節は出ない', () => {
  const { sections } = aggregate(pick('香菱'));
  assert.deepEqual(sections.map((s) => s.key), [
    'gem',
    'boss',
    'local',
    'book',
    'weeklyBoss',
    'crown',
    'common',
  ]);
  // 旅人は天賦データが無いので天賦側の節が出ない
  const t = aggregate(pick('旅人'));
  assert.deepEqual(t.sections.map((s) => s.key), ['gem', 'local', 'common']);
});

test('aggregate() は入手元を保つ', () => {
  const { sections } = aggregate(pick('香菱'));
  const boss = sections.find((s) => s.key === 'boss');
  assert.deepEqual(boss.items[0], { name: '常燃の火種', from: '爆炎樹', characters: ['香菱'] });
});

test('aggregate() は秘境をまとめ、同じ秘境のキャラを並べる', () => {
  const { domains } = aggregate(pick('香菱', '兹白'));
  assert.equal(domains.length, 2);
  const fire = domains.find((d) => d.domain === '熟知秘境：深炎の底');
  assert.deepEqual(fire.characters, ['香菱']);
  assert.deepEqual(fire.days, ['火曜', '金曜', '日曜']);
});

test('aggregate() はデータの欠けを黙って飲み込まない', () => {
  const r = aggregate([
    ...pick('旅人', 'ドール（女）'),
    { name: '未収録キャラ', entry: undefined },
  ]);
  assert.deepEqual(r.noData, ['未収録キャラ']);
  assert.deepEqual(r.partial, [
    { name: '旅人', lacking: ['天賦'] },
    { name: 'ドール（女）', lacking: ['突破'] },
  ]);
});

test('aggregate() は空でも落ちない', () => {
  assert.deepEqual(aggregate([]), { sections: [], domains: [], noData: [], partial: [] });
});

test('aggregate() は同じキャラを二重に数えない', () => {
  // 共通素材は突破と天賦の両方に入っているので、素朴に集めると 2 回入る
  const { sections } = aggregate(pick('香菱'));
  const common = sections.find((s) => s.key === 'common');
  assert.deepEqual(common.items[0].characters, ['香菱']);
});

// --- モラ早見表 -----------------------------------------------------------

test('モラ早見表は突破 6 段階・天賦 9 段階', () => {
  assert.deepEqual(MORA.ascension, [20000, 40000, 60000, 80000, 100000, 120000]);
  assert.deepEqual(MORA.talent, [12500, 17500, 25000, 30000, 37500, 120000, 260000, 450000, 700000]);
});

test('moraRows() が段階ラベルと累計を返す', () => {
  const { ascension, talent } = moraRows(MORA);
  assert.equal(ascension.length, 6);
  assert.deepEqual(ascension[0], { label: '1段階', amount: 20000, total: 20000 });
  assert.deepEqual(ascension.at(-1), { label: '6段階', amount: 120000, total: 420000 });
  assert.equal(talent[0].label, 'Lv.2');
  assert.equal(talent.at(-1).label, 'Lv.10');
  assert.equal(talent.at(-1).total, 1652500);
});

test('moraRows() は空でも落ちない', () => {
  assert.deepEqual(moraRows(undefined), { ascension: [], talent: [] });
});

// --- 秘境の曜日 -----------------------------------------------------------

test('04:00 より前は前日として扱う', () => {
  // 2026-07-28 は火曜
  assert.equal(domainWeekday(new Date('2026-07-28T05:00:00')), '火曜');
  assert.equal(domainWeekday(new Date('2026-07-28T03:59:00')), '月曜');
  assert.equal(domainWeekday(new Date('2026-07-28T04:00:00')), '火曜');
});

test('曜日が一致すれば今日入手できると判定する', () => {
  const days = ['火曜', '金曜', '日曜'];
  assert.equal(availableToday(days, new Date('2026-07-28T10:00:00')), true); // 火
  assert.equal(availableToday(days, new Date('2026-07-29T10:00:00')), false); // 水
  assert.equal(availableToday(days, new Date('2026-07-29T02:00:00')), true); // 水の 2 時 = 火扱い
});

test('曜日データが無ければ判定不能として false', () => {
  assert.equal(availableToday(undefined, new Date()), false);
  assert.equal(availableToday([], new Date()), false);
});
