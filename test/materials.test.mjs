// 突破素材・天賦素材の検証。依存パッケージなしで動く。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parse } from '../parse.js';
import { matchKey } from '../names.js';
import { availableToday, columnFor, costRows, describe, domainWeekday } from '../materials.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const CHARACTERS = JSON.parse(read('data/characters.json'));
const FILE = JSON.parse(read('data/materials.json'));
const MATERIALS = FILE.characters;
const COSTS = FILE.costs;
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
  const allowed = new Set(['name', 'from', 'domain', 'days', 'region', 'entrance', 'motif', 'motifDraft']);
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
  assert.deepEqual(m.ascension.local, [{ name: '絶雲の唐辛子', from: '璃月' }]);
  assert.deepEqual(m.ascension.boss, [{ name: '常燃の火種', from: '爆炎樹' }]);
  assert.deepEqual(m.ascension.common, [{ name: 'スライム' }]);
  assert.deepEqual(m.talent.book.map((b) => b.name), ['「勤労」']);
  assert.deepEqual(m.talent.weeklyBoss, [{ name: '東風の爪', from: '風魔龍' }]);
  assert.deepEqual(m.talent.crown, [{ name: '知恵の冠', from: '期間限定イベント報酬' }]);
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
    {
      name: '「勤労」',
      domain: '深炎の底',
      region: '璃月',
      entrance: '太山府',
      days: ['火曜', '金曜', '日曜'],
      motif: '麦',
    },
  ]);
});

test('すべての天賦本が秘境名・地域・入口・曜日を持つ', () => {
  // 素材名も秘境名も覚えていない人が「モンドの忘却の峡谷」で辿れるようにするため、
  // 地域と入口が欠けていないことを検査する。
  const bad = [];
  eachGroup(({ name, key, items }) => {
    if (key !== 'book') return;
    for (const i of items) {
      if (!i.domain || !i.region || !i.entrance || !i.days?.length) bad.push(`${name}: ${i.name}`);
    }
  });
  assert.deepEqual(bad, []);
});

test('秘境名から「熟知秘境：」が落ちている', () => {
  const bad = [];
  eachGroup(({ name, key, items }) => {
    if (key !== 'book') return;
    for (const i of items) if (/^熟知秘境/.test(i.domain)) bad.push(`${name}: ${i.domain}`);
  });
  assert.deepEqual(bad, []);
});

test('図柄は書いてあるものだけ付き、未確認には印が立つ', () => {
  // うろ覚えの図柄を確定情報として出さないため、未確認は motifDraft で区別する。
  const bad = [];
  eachGroup(({ name, key, items }) => {
    if (key !== 'book') return;
    for (const i of items) {
      if (i.motif !== undefined && !String(i.motif).trim()) bad.push(`${name}: ${i.name} の図柄が空文字`);
      if (i.motifDraft !== undefined && i.motif === undefined) {
        bad.push(`${name}: ${i.name} に図柄なしで印だけ付いている`);
      }
      if (String(i.motif ?? '').startsWith('?')) bad.push(`${name}: ${i.name} の ? が剥がれていない`);
    }
  });
  assert.deepEqual(bad, []);
});

test('図柄は実物を見て書いた 20 件が確定で入り、未判読の 1 件は空のまま', () => {
  const books = new Map();
  eachGroup(({ key, items }) => {
    if (key !== 'book') return;
    for (const i of items) if (!books.has(i.name)) books.set(i.name, i);
  });
  assert.equal(books.size, 21);

  const withMotif = [...books.values()].filter((b) => b.motif);
  assert.equal(withMotif.length, 20);
  assert.equal(withMotif.filter((b) => b.motifDraft).length, 0, '未確認のまま残っている');

  // 見て分からなかったものは埋めない
  assert.equal(books.get('「紛争」').motif, undefined);

  // 地域ごとに傾向が出ている（モンドは器物、スメールは花、フォンテーヌは巻物）
  assert.equal(books.get('「自由」').motif, '風車');
  assert.equal(books.get('「忠言」').motif, '鈴蘭');
  assert.equal(books.get('「正義」').motif, '巻物剣');
});

test('図柄がすべて別の言葉になっている（見分けがつく）', () => {
  const motifs = [];
  eachGroup(({ key, items }) => {
    if (key !== 'book') return;
    for (const i of items) if (i.motif && !motifs.includes(i.motif)) motifs.push(i.motif);
  });
  assert.equal(new Set(motifs).size, motifs.length, '同じ図柄が 2 系統に付いている');
});

test('冠は天賦本と混ざらない', () => {
  assert.equal(MATERIALS['香菱'].talent.crown[0].name, '知恵の冠');
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
    assert.equal(group.crown?.[0]?.name, '知恵の冠', `${element}: 冠がない`);
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
  assert.deepEqual(d.talents, [{ element: null, missing: true, done: false, sections: [] }]);
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

// --- columnFor() ----------------------------------------------------------

const col = (name, done) => columnFor(MATERIALS[name], done);
const stateOf = (rows, key) => rows.find((r) => r.key === key).state;
const itemsOf = (rows, key) => rows.find((r) => r.key === key).items;

test('columnFor() は該当が無くても行を必ず全部返す', () => {
  // 行を間引くと列ごとに高さが変わって隣の列と見比べられなくなる。
  const keys = ['gem', 'boss', 'local', 'book', 'weeklyBoss', 'crown', 'common'];
  for (const name of ['香菱', '旅人', 'ドール（女）']) {
    assert.deepEqual(col(name).map((r) => r.key), keys, `${name} の行が欠けている`);
  }
  assert.deepEqual(columnFor(undefined).map((r) => r.key), keys);
});

test('columnFor() は普通のキャラなら全行が埋まる', () => {
  const rows = col('香菱');
  assert.equal(rows.every((r) => r.state === 'ok'), true);
  assert.equal(rows.every((r) => r.items.length > 0), true);
});

test('columnFor() は育成済みの行を空にして理由を残す', () => {
  const rows = col('香菱', { ascension: true });
  assert.equal(stateOf(rows, 'gem'), 'done');
  assert.deepEqual(itemsOf(rows, 'gem'), [], '突破素材が残っている');
  assert.equal(stateOf(rows, 'book'), 'ok', '天賦素材まで消えている');
});

test('columnFor() は両方済みなら全行が空になる', () => {
  const rows = col('香菱', { ascension: true, talent: true });
  assert.equal(rows.every((r) => r.items.length === 0), true);
  assert.equal(rows.every((r) => r.state === 'done'), true);
});

test('columnFor() は元素可変キャラの天賦を variant として空にする', () => {
  // 旅人は 6 元素 × 3 系統で列に収まらない。黙って落とさず素材ダイアログへ送る。
  const rows = col('旅人');
  assert.equal(stateOf(rows, 'gem'), 'ok', '突破素材まで消えている');
  assert.equal(stateOf(rows, 'book'), 'variant');
  assert.deepEqual(itemsOf(rows, 'book'), []);
});

test('columnFor() はデータの欠けを missing として区別する', () => {
  const rows = col('ドール（女）');
  assert.equal(stateOf(rows, 'gem'), 'missing');
  assert.equal(stateOf(rows, 'book'), 'ok');
});

test('columnFor() は元から要らない行を none として区別する', () => {
  // 旅人は突破にボス素材が無い。データが無いのとは違う。
  assert.equal(stateOf(col('旅人'), 'boss'), 'none');
});

test('columnFor() は隠したドロップ元をデータなし扱いしない', () => {
  // ドロップ元は突破と天賦の両方から来る。突破済みで隠れているだけのものを
  // 「データなし」と出すと、収録漏れと区別がつかなくなる。
  assert.equal(stateOf(col('香菱', { ascension: true, talent: true }), 'common'), 'done');
  // 旅人は Lv.90 想定で突破済み、天賦は元素別。どちらもデータはある。
  assert.equal(stateOf(col('旅人', { ascension: true }), 'common'), 'done');
  assert.equal(stateOf(col('旅人'), 'common'), 'ok');
});

test('columnFor() は空エントリでも落ちない', () => {
  const rows = columnFor(undefined);
  assert.equal(rows.every((r) => r.items.length === 0), true);
  assert.equal(stateOf(rows, 'gem'), 'missing');
});

test('columnFor() は入手元・図柄・曜日をそのまま渡す', () => {
  const book = itemsOf(col('香菱'), 'book')[0];
  assert.equal(book.name, '「勤労」');
  assert.equal(book.motif, '麦');
  assert.equal(book.region, '璃月');
  assert.deepEqual(book.days, ['火曜', '金曜', '日曜']);
});

test('早見表は突破 6 段階・天賦 9 段階', () => {
  assert.equal(COSTS.ascension.rows.length, 6);
  assert.equal(COSTS.talent.rows.length, 9);
});

test('早見表のモラが従来どおり', () => {
  assert.deepEqual(
    COSTS.ascension.rows.map((r) => r.mora),
    [20000, 40000, 60000, 80000, 100000, 120000],
  );
  assert.deepEqual(
    COSTS.talent.rows.map((r) => r.mora),
    [12500, 17500, 25000, 30000, 37500, 120000, 260000, 450000, 700000],
  );
});

test('早見表は素材の種別とレアリティと個数を持つ', () => {
  // 1 段階目は 宝石★2×1 / 特産品×3 / 共通素材★1×3
  assert.deepEqual(COSTS.ascension.rows[0].items, [
    { kind: 'common', rarity: 1, count: 3 },
    { kind: 'gem', rarity: 2, count: 1 },
    { kind: 'local', rarity: null, count: 3 },
  ]);
  // Lv.10 は 天賦本★4×16 / 共通素材★3×12 / 冠★5×1 / 週ボス★5×2
  assert.deepEqual(COSTS.talent.rows.at(-1).items, [
    { kind: 'book', rarity: 4, count: 16 },
    { kind: 'common', rarity: 3, count: 12 },
    { kind: 'crown', rarity: 5, count: 1 },
    { kind: 'weeklyBoss', rarity: 5, count: 2 },
  ]);
});

test('早見表の例外は旅人だけ（突破にボス素材が無い）', () => {
  assert.deepEqual(COSTS.ascension.exceptions, ['空', '蛍']);
});

test('costRows() が段階ラベルと累計を返す', () => {
  const { ascension, talent } = costRows(COSTS);
  assert.equal(ascension.rows.length, 6);
  assert.equal(ascension.rows[0].label, '1段階');
  assert.equal(ascension.rows.at(-1).label, '6段階');
  assert.equal(ascension.rows.at(-1).moraTotal, 420000);
  assert.equal(talent.rows[0].label, 'Lv.2');
  assert.equal(talent.rows.at(-1).label, 'Lv.10');
  assert.equal(talent.rows.at(-1).moraTotal, 1652500);
});

test('costRows() は種別ごとに累計する', () => {
  const { ascension } = costRows(COSTS);
  const gem = (i) => ascension.rows[i].cells.find((c) => c.kind === 'gem');
  // 宝石は 1 / 3 / 6 / 3 / 6 / 6 で累計 25
  assert.deepEqual(ascension.rows.map((_, i) => gem(i).count), [1, 3, 6, 3, 6, 6]);
  assert.equal(gem(5).total, 25);
  // 段階が上がるとレアリティも上がる
  assert.deepEqual(ascension.rows.map((_, i) => gem(i).rarity), [2, 3, 3, 4, 4, 5]);
});

test('costRows() は無い種別を 0 として返す', () => {
  const { talent } = costRows(COSTS);
  const crown = talent.rows[0].cells.find((c) => c.kind === 'crown');
  assert.equal(crown.count, 0);
  assert.equal(crown.rarity, null);
});

test('costRows() は空でも落ちない', () => {
  assert.deepEqual(costRows(undefined), {
    ascension: { rows: [], exceptions: [] },
    talent: { rows: [], exceptions: [] },
  });
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
