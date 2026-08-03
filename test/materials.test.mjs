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

/**
 * 全キャラ・全節の素材グループを走査する。
 * talentByElement は元素ごとに一段深いので、そこも降りること
 * （降りないと旅人の元素別データが検査から漏れる）。
 */
const eachGroup = (fn) => {
  const visit = (name, section, group) => {
    for (const key of GROUP_KEYS) {
      if (group[key]) fn({ name, section, key, items: group[key] });
    }
  };
  for (const [name, entry] of Object.entries(MATERIALS)) {
    for (const [section, group] of Object.entries(entry)) {
      if (section === 'talentByElement') {
        for (const [element, sub] of Object.entries(group)) visit(name, `天賦(${element})`, sub);
      } else {
        visit(name, section, group);
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

test('素材が持つのは名前・入手元・秘境・曜日だけ（数量は持たない）', () => {
  const allowed = new Set(['name', 'from', 'domain', 'days']);
  const bad = [];
  eachGroup(({ name, section, key, items }) => {
    for (const item of items) {
      const extra = Object.keys(item).filter((k) => !allowed.has(k));
      if (extra.length) bad.push(`${name}/${section}/${key}: ${extra.join(',')}`);
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

test('レアリティ段階は畳まれている（宝石・共通素材は 1 つ）', () => {
  const bad = [];
  eachGroup(({ name, section, key, items }) => {
    if (['gem', 'common'].includes(key) && items.length !== 1) {
      bad.push(`${name}/${section}/${key}: ${items.map((i) => i.name).join(' / ')}`);
    }
  });
  assert.deepEqual(bad, []);
});

test('天賦本は通常キャラは 1 系統、旅人だけ 3 系統', () => {
  const bad = [];
  eachGroup(({ name, section, key, items }) => {
    if (key !== 'book') return;
    const expected = section.startsWith('天賦(') ? 3 : 1;
    if (items.length !== expected) {
      bad.push(`${name}/${section}: ${items.length} 系統（${items.map((i) => i.name).join(' / ')}）`);
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
  assert.deepEqual(m.talent.book.map((b) => b.name), ['「勤労」']);
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

test('天賦本には秘境名と曜日が素材ごとに付く', () => {
  // 系統ごとに曜日が違い、旅人は 1 元素で 3 系統を必要とする。グループ単位で持つと
  // どの系統がいつ回れるのかが表せない。
  assert.deepEqual(MATERIALS['香菱'].talent.book, [
    { name: '「勤労」', domain: '熟知秘境：深炎の底', days: ['火曜', '金曜', '日曜'] },
  ]);
});

test('すべての天賦本が秘境名と曜日を持つ', () => {
  const bad = [];
  eachGroup(({ name, key, items }) => {
    if (key !== 'book') return;
    for (const i of items) if (!i.domain || !i.days?.length) bad.push(`${name}: ${i.name}`);
  });
  assert.deepEqual(bad, []);
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
// --- 旅人の元素別天賦 -----------------------------------------------------

test('旅人の天賦素材が元素別に入っている', () => {
  const t = MATERIALS['旅人'].talentByElement;
  assert.ok(t, '旅人に元素別の天賦素材がない');
  // 氷はゲーム内未実装で genshin-db にも空のエントリしかないため入らない
  assert.deepEqual(Object.keys(t), ['風', '草', '雷', '岩', '水', '炎']);
  assert.equal(MATERIALS['旅人'].talent, undefined, '元素別と単一の天賦が二重に入っている');
});

test('旅人は 1 元素につき天賦本 3 系統を要し、系統ごとに曜日が違う', () => {
  const anemo = MATERIALS['旅人'].talentByElement['風'];
  assert.equal(anemo.book.length, 3, '天賦本が 3 系統になっていない');
  const days = anemo.book.map((b) => b.days.join('/'));
  assert.equal(new Set(days).size, 3, '系統ごとに曜日が分かれていない');
  for (const b of anemo.book) assert.ok(b.domain, `${b.name} に秘境がない`);
});

test('旅人の元素別天賦はそれぞれ週ボス素材と冠を持つ', () => {
  for (const [element, group] of Object.entries(MATERIALS['旅人'].talentByElement)) {
    assert.equal(group.weeklyBoss?.length, 1, `${element}: 週ボス素材がない`);
    assert.ok(group.weeklyBoss[0].from, `${element}: 週ボス素材に入手元がない`);
    assert.deepEqual(group.crown, [{ name: '知恵の冠' }], `${element}: 冠がない`);
  }
});

test('旅人の元素別天賦は元素ごとに違う素材になる', () => {
  const books = Object.values(MATERIALS['旅人'].talentByElement).map((g) =>
    g.book.map((b) => b.name).join(','),
  );
  assert.equal(new Set(books).size, books.length, '元素をまたいで天賦本が重複している');
});

test('空と蛍も旅人と同じ元素別天賦を持つ', () => {
  assert.deepEqual(MATERIALS['空'].talentByElement, MATERIALS['旅人'].talentByElement);
  assert.deepEqual(MATERIALS['蛍'].talentByElement, MATERIALS['旅人'].talentByElement);
});

// --- describe() -----------------------------------------------------------

test('describe() はデータの無い節を missing として返す', () => {
  const d = describe(MATERIALS['ドール（女）']);
  assert.equal(d.ascension.missing, true);
  assert.deepEqual(d.ascension.sections, []);
  assert.equal(d.talents.length, 1);
  assert.equal(d.talents[0].missing, false);
  assert.ok(d.talents[0].sections.length > 0);
});

test('describe() は空エントリでも落ちない', () => {
  const d = describe(undefined);
  assert.equal(d.ascension.missing, true);
  assert.deepEqual(d.talents, [{ element: null, missing: true, sections: [] }]);
  assert.equal(d.common, null);
});

test('describe() は突破と天賦で同じドロップ元を一度だけ返す', () => {
  const d = describe(MATERIALS['香菱']);
  assert.deepEqual(d.common, [{ name: 'スライム' }]);
  assert.equal(d.ascension.sections.some((s) => s.key === 'common'), false);
  assert.equal(d.talents[0].sections.some((s) => s.key === 'common'), false);
});

test('describe() は片方しか無い場合もドロップ元を拾う', () => {
  assert.deepEqual(describe(MATERIALS['ドール（女）']).common, [{ name: '部族竜戦士' }]);
});

test('describe() の節は定義順に並ぶ', () => {
  const d = describe(MATERIALS['香菱']);
  assert.deepEqual(d.ascension.sections.map((s) => s.key), ['gem', 'boss', 'local']);
  assert.deepEqual(d.talents[0].sections.map((s) => s.key), ['book', 'weeklyBoss', 'crown']);
});

test('describe() はドロップ元が食い違えば各節に残す', () => {
  const entry = {
    ascension: { gem: [{ name: 'X' }], common: [{ name: 'スライム' }] },
    talent: { book: [{ name: '「Y」' }], common: [{ name: 'ヒルチャール' }] },
  };
  const d = describe(entry);
  assert.equal(d.common, null);
  assert.ok(d.ascension.sections.some((s) => s.key === 'common'));
  assert.ok(d.talents[0].sections.some((s) => s.key === 'common'));
});

test('describe() は元素可変キャラの天賦を元素ごとの節に分ける', () => {
  const d = describe(MATERIALS['旅人']);
  assert.deepEqual(d.talents.map((t) => t.element), ['風', '草', '雷', '岩', '水', '炎']);
  for (const t of d.talents) {
    assert.equal(t.missing, false);
    // 元素ごとにドロップ元が違うので共通化されず各節に残る
    assert.ok(t.sections.some((s) => s.key === 'common'), `${t.element}: ドロップ元がない`);
  }
  assert.equal(d.common, null, '元素別なのにドロップ元が共通化されている');
});

// --- aggregate() ----------------------------------------------------------

const pick = (...names) => names.map((name) => ({ name, entry: MATERIALS[name] }));

test('aggregate() は同じ素材を 1 つに畳んで必要なキャラを並べる', () => {
  const { sections } = aggregate(pick('香菱', 'ベネット'));
  const crown = sections.find((s) => s.key === 'crown');
  assert.equal(crown.items.length, 1, '冠が 2 行に割れている');
  assert.equal(crown.items[0].name, '知恵の冠');
  assert.deepEqual(crown.items[0].characters, ['香菱', 'ベネット']);
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
});

test('aggregate() は入手元を保つ', () => {
  const { sections } = aggregate(pick('香菱'));
  const boss = sections.find((s) => s.key === 'boss');
  assert.equal(boss.items[0].name, '常燃の火種');
  assert.equal(boss.items[0].from, '爆炎樹');
});

test('aggregate() は天賦本の秘境と曜日を素材ごとに保つ', () => {
  const { sections } = aggregate(pick('香菱'));
  const book = sections.find((s) => s.key === 'book');
  assert.equal(book.items[0].domain, '熟知秘境：深炎の底');
  assert.deepEqual(book.items[0].days, ['火曜', '金曜', '日曜']);
});

test('aggregate() は元素可変キャラの天賦をまとめず、黙って落とさない', () => {
  // 旅人は 6 元素 × 3 系統で 18 系統になる。まとめに入れると本題が埋もれるので
  // 突破だけを扱い、天賦は名前を返して画面で断る。
  const r = aggregate(pick('旅人'));
  assert.deepEqual(r.elementVariant, ['旅人']);
  assert.deepEqual(r.sections.map((s) => s.key), ['gem', 'local', 'common']);
  assert.equal(r.sections.some((s) => s.key === 'book'), false);
  // 「データが無い」わけではないので partial には入れない
  assert.deepEqual(r.partial, []);
});

test('aggregate() はデータの欠けを黙って飲み込まない', () => {
  const r = aggregate([...pick('ドール（女）'), { name: '未収録キャラ', entry: undefined }]);
  assert.deepEqual(r.noData, ['未収録キャラ']);
  assert.deepEqual(r.partial, [{ name: 'ドール（女）', lacking: ['突破'] }]);
});

test('aggregate() は空でも落ちない', () => {
  assert.deepEqual(aggregate([]), {
    sections: [],
    noData: [],
    partial: [],
    elementVariant: [],
  });
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
