// genshin-db から data/characters.json と data/materials.json を生成する。
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
  console.error('\ndata/ の JSON は更新していない。\n');
  process.exit(1);
}

// --- 素材の分類 -----------------------------------------------------------
//
// genshin-db の素材には materialtype が無いので typeText で判別する。
// 「キャラクター育成素材」は突破のボス素材と天賦の週ボス素材の両方に付くため、
// typeText だけでは区別できない。突破コストに出たか天賦コストに出たかで分ける。
// 例: 兹白 は突破が 悪夢の枯骸、天賦が 昇揚のサンプル「王族」。

function classify(material, section) {
  switch (material.typeText) {
    case '共通貨幣':
      return 'mora';
    case 'キャラクター突破素材':
      return 'gem';
    case 'キャラと武器育成素材':
      return 'common';
    case 'キャラクター天賦素材':
      // 天賦本は秘境ドロップなので dropDomainName を持つ。持たないのは知恵の冠。
      return material.dropDomainName ? 'book' : 'crown';
    case 'キャラクター育成素材':
      return section === 'ascension' ? 'boss' : 'weeklyBoss';
    default:
      return /特産/.test(String(material.typeText)) ? 'local' : null;
  }
}

// レアリティ違いの段階を畳むための接尾辞。
// 宝石は「炎願のアゲート·砕屑 / ·欠片 / ·塊 / （無印）」、天賦本は
// 「「勤労」の教え / の導き / の哲学」のように、同じ語幹に段階が付くだけなので
// 接尾辞を落として重複を潰す。中黒は U+00B7。
const TIER_SUFFIXES = [/·砕屑$/, /·欠片$/, /·塊$/, /の教え$/, /の導き$/, /の哲学$/];

function stripTier(name) {
  for (const re of TIER_SUFFIXES) {
    if (re.test(name)) return name.replace(re, '');
  }
  return name;
}

/**
 * 素材の入手元（敵・ボスの名前）を sources の 1 件目から取る。
 *
 *   雑魚:   「スライムがドロップ」「スライム（Lv.40以上）がドロップ」  -> スライム
 *   ボス:   「爆炎樹（Lv.30以上）がドロップ」                      -> 爆炎樹
 *   週ボス: 「風魔龍（Lv.70以上）挑戦報酬」                        -> 風魔龍
 *
 * 共通素材はこれで 3 段階を 1 つに畳む（段階ごとに語幹が違うため接尾辞では畳めない。
 * sources はレベル条件だけが異なるので、それを落とせば一致する）。
 * ボス・週ボスは素材名を残したまま「どこで採れるか」を添えるのに使う。
 */
// 想定している sources の書式。ここに当てはまらないものは黙って通さず
// ビルドを失敗させる（変な文字列がそのまま画面に出るのを防ぐ）。
// レベル条件は括弧の後置（風魔龍（Lv.70以上））と前置（Lv.30以上の守護者・堕天）の
// 両方があるので、どちらも落とす。
const SOURCE_PATTERNS = [
  /^(?:Lv\.\d+以上の)?(.+?)(?:（Lv\.\d+以上）)?(?:が|から)ドロップ$/,
  /^(?:Lv\.\d+以上の)?(.+?)(?:（Lv\.\d+以上）)?挑戦報酬$/,
  // 炎元素旅人の週ボス枠（星と炎の礎石）はボスではなく任務報酬で手に入る
  /^(.+?)をクリアした後に獲得$/,
];

function dropSource(name) {
  const raw = gdb.materials(name, JP)?.sources?.[0];
  if (!raw) return null;
  for (const re of SOURCE_PATTERNS) {
    const m = raw.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

// 素材名だけでは何を殴ればいいのか分からないので、入手元を添える種別。
const WITH_SOURCE = new Set(['boss', 'weeklyBoss']);

/**
 * ボス以外の入手元。素材名を覚えていない人でも「どこで手に入るのか」が分かるようにする。
 *
 *   特産品: typeText が「璃月地域の特産」なので地域名を取る
 *   冠:     sources が「期間限定イベント報酬」
 *
 * 宝石は sources が「冒険の証·討伐タブ表示」などの汎用文で入手元にならないため付けない
 * （元素ボス全般から出るので単一の入手元が存在しない）。
 */
function otherSource(material, kind) {
  if (kind === 'local') {
    const region = String(material.typeText).match(/^(.+?)地域の特産$/);
    return region ? region[1] : null;
  }
  if (kind === 'crown') return material.sources?.[0] ?? null;
  return null;
}

// 畳んだ結果が 1 つになるべき種別。命名規則が変わったら気づけるようにする。
//
// 天賦本は含めない。旅人は 1 元素あたり 3 系統すべてを必要とするため
// （風なら「自由」「抗争」「詩文」）、1 つに畳めるのは通常キャラだけ。
// 畳み損ねは MUST_COLLAPSE ではなく「接尾辞が残っていないか」で検出する。
const MUST_COLLAPSE = { gem: '宝石', common: '共通素材' };

/**
 * costs（ascend1..6 もしくは lvl2..10）を素材種別ごとに畳み込む。
 * 数量とレアリティ段階は持たない。「何を集めるのか」だけを並べる辞書なので、
 * 個数管理や段階別の内訳は扱わない。モラは全キャラ共通なので別テーブルに切り出す。
 * 素材が 1 つも無ければ null を返す（genshin-db 側にデータが無いキャラがいる）。
 */
function collect(costs, section, characterName, problems) {
  const groups = {}; // 種別 -> Map(畳んだ名前 -> 付随情報)

  for (const items of Object.values(costs ?? {})) {
    for (const { name } of items) {
      const material = gdb.materials(name, JP);
      if (!material) {
        problems.push(`${characterName}: 素材 "${name}" が genshin-db の materials に無い`);
        continue;
      }
      const kind = classify(material, section);
      if (!kind) {
        problems.push(`${characterName}: 素材 "${name}" を分類できない（typeText=${material.typeText}）`);
        continue;
      }
      if (kind === 'mora') continue; // 別テーブルへ

      // 共通素材はドロップ元の敵名へ、それ以外は段階の接尾辞を落として畳む。
      const collapsed = kind === 'common' ? dropSource(name) : stripTier(name);
      if (!collapsed) {
        problems.push(`${characterName}: 素材 "${name}" の入手元が取れない`);
        continue;
      }
      if (kind !== 'common' && TIER_SUFFIXES.some((re) => re.test(collapsed))) {
        problems.push(
          `${characterName}: 素材 "${name}" の段階接尾辞を落としきれていない（${collapsed}）。` +
            'tools/build.mjs の TIER_SUFFIXES を見直すこと',
        );
        continue;
      }

      const extra = {};
      if (WITH_SOURCE.has(kind)) {
        const from = dropSource(name);
        if (!from) {
          problems.push(`${characterName}: 素材 "${name}" の入手元が取れない`);
          continue;
        }
        extra.from = from;
      } else {
        const from = otherSource(material, kind);
        if (from) extra.from = from;
      }
      // 天賦本は系統ごとに秘境の曜日が違う。旅人は 1 元素で 3 系統を必要とし、
      // 系統ごとに別の曜日になるため、グループ単位ではなく素材ごとに持たせる。
      if (kind === 'book') {
        if (!material.dropDomainName) {
          problems.push(`${characterName}: 天賦本 "${name}" に秘境情報が無い`);
          continue;
        }
        const place = TALENT_DOMAINS.get(material.dropDomainName);
        if (!place) {
          problems.push(
            `${characterName}: 天賦本 "${name}" の秘境「${material.dropDomainName}」の地域が引けない`,
          );
          continue;
        }
        // 「熟知秘境：」は全部に付くので落とす。地域と入口が図柄の代わりになる。
        extra.domain = material.dropDomainName.replace(/^熟知秘境：/, '');
        extra.region = place.region;
        extra.entrance = place.entrance;
        extra.days = material.daysOfWeek ?? null;
        // 図柄はまだ書かれていないものが多い。空なら持たせない。
        // draft は「未確認」で、画面では ? を添えて薄く出す。
        const motif = BOOK_MOTIFS.get(collapsed);
        if (motif) {
          extra.motif = motif.text;
          if (motif.draft) extra.motifDraft = true;
        }
        seenBooks.add(collapsed);
      }

      groups[kind] ??= new Map();
      groups[kind].set(collapsed, extra);
    }
  }

  for (const [kind, label] of Object.entries(MUST_COLLAPSE)) {
    if (groups[kind] && groups[kind].size !== 1) {
      problems.push(
        `${characterName}: ${label}が 1 つに畳めない（${[...groups[kind].keys()].join(' / ')}）。` +
          'tools/build.mjs の TIER_SUFFIXES / dropSource() を見直すこと',
      );
    }
  }

  if (Object.keys(groups).length === 0) return null;
  return Object.fromEntries(
    Object.entries(groups).map(([kind, items]) => [
      kind,
      [...items].map(([name, extra]) => ({ name, ...extra })),
    ]),
  );
}

/**
 * genshin-db は元素可変キャラの天賦を元素別に持っている。
 * `characters` 側は「空 / 蛍」だが、`talents` 側は「旅人 (風元素)」のような名前で、
 * 同じ名前では引けない。ここで元素ごとの一覧を作る。
 *
 *   { 旅人: { 風: '旅人 (風元素)', 岩: '旅人 (岩元素)', ... } }
 *
 * 氷はゲーム内に未実装で、genshin-db にも空のエントリしかないため落とす。
 */
/**
 * 天賦秘境の名前 -> 地域と入口。
 *
 * 素材名も秘境名も覚えていない人向けに「モンドの忘却の峡谷」という辿り方を出せるようにする。
 * genshin-db の秘境名は難易度の末尾（`熟知秘境：深炎の底 I`）が付くので落として突き合わせる。
 * 公式のアイコン画像は二次創作ガイドラインで使えないため、図柄の代わりが地域と入口になる。
 */
/**
 * 天賦本の図柄（日本語）。tools/book-motifs.json を地域ごとの入れ子から平らにする。
 *
 * 公式のアイコン画像は二次創作ガイドラインで使えないので、言葉で置き換える。
 * 空文字は「まだ書いていない」で、画面には出さない。うろ覚えの図柄を出すくらいなら
 * 何も出さないほうがよい（間違った図柄は名前だけのときより質が悪い）。
 */
function bookMotifs() {
  const raw = JSON.parse(readFileSync(join(ROOT, 'tools/book-motifs.json'), 'utf8'));
  const flat = new Map();
  for (const [region, group] of Object.entries(raw)) {
    if (region.startsWith('_')) continue;
    for (const [book, value] of Object.entries(group)) {
      const text = String(value).trim();
      if (!text) {
        flat.set(book, null); // 未記入。キーの検査には使うが画面には出さない
        continue;
      }
      // 先頭の ? は「未確認」。実物を見て確かめたら消す運用。
      const draft = text.startsWith('?');
      flat.set(book, { text: draft ? text.slice(1).trim() : text, draft });
    }
  }
  return flat;
}

function talentDomains() {
  const map = new Map();
  for (const name of gdb.domains('names', { ...JP, matchCategories: true })) {
    const d = gdb.domains(name, JP);
    if (d?.domainText !== '天賦育成素材') continue;
    const base = d.name.replace(/\s+[IVX]+$/, '');
    if (!map.has(base)) map.set(base, { region: d.regionName, entrance: d.entranceName });
  }
  return map;
}

function elementVariants() {
  const map = new Map();
  for (const name of gdb.talents('names', { ...JP, matchCategories: true })) {
    const m = name.match(/^(.+?) \((.+?)元素\)$/);
    if (!m) continue;
    const [, base, element] = m;
    // costs が空のものは未実装。持たせると「素材なし」と区別できなくなる。
    if (!Object.keys(gdb.talents(name, JP)?.costs ?? {}).length) continue;
    if (!map.has(base)) map.set(base, new Map());
    map.get(base).set(element, name);
  }
  return map;
}

/**
 * 段階ごとの必要数の早見表。
 *
 * 素材の「名前」はキャラごとに違うが、「どの種別のレアリティ何をいくつ」という構造は
 * 全キャラ共通。名前を覚えていなくても「Lv.7 なら紫の天賦本が 4 つ」と分かるように、
 * 種別とレアリティだけの表として書き出す。
 *
 * 共通でないキャラが現れたら気づけるよう、全員分を突き合わせて検証する。
 * 旅人だけは突破にボス素材が無く別パターンになるので、少数派として名前を控える。
 */
function costTable(names, talentAliases, problems) {
  const rowsOf = (costs, section) =>
    Object.values(costs ?? {}).map((items) => {
      const row = { mora: 0, items: [] };
      for (const { name, count } of items) {
        const material = gdb.materials(name, JP);
        const kind = material ? classify(material, section) : null;
        if (!kind) continue;
        if (kind === 'mora') row.mora += count;
        else row.items.push({ kind, rarity: material.rarity ?? null, count });
      }
      row.items.sort((a, b) => a.kind.localeCompare(b.kind));
      return row;
    });

  const collect = (section) => {
    const patterns = new Map();
    for (const name of names) {
      const costs =
        section === 'ascension'
          ? gdb.characters(name, JP)?.costs
          : gdb.talents(talentAliases[name] ?? name, JP)?.costs;
      const rows = rowsOf(costs, section);
      // 中身が空／モラ 0 のみはデータが無いキャラ（ドール）。比較対象にしない。
      if (!rows.length || rows.every((r) => r.mora === 0 && r.items.length === 0)) continue;
      const key = JSON.stringify(rows);
      patterns.set(key, (patterns.get(key) ?? []).concat(name));
    }
    return patterns;
  };

  const table = {};
  for (const section of ['ascension', 'talent']) {
    const patterns = collect(section);
    if (patterns.size === 0) {
      problems.push(`${section} の必要数を 1 件も取得できなかった`);
      continue;
    }
    // 多数派を代表にする。3 通り以上に割れたら想定外なので気づけるように失敗させる。
    const sorted = [...patterns].sort((a, b) => b[1].length - a[1].length);
    if (sorted.length > 2) {
      const detail = sorted.map(([, who]) => `${who.length}体`).join(' / ');
      problems.push(`${section} の必要数が ${sorted.length} 通りに割れている（${detail}）。早見表を共通化できない`);
      continue;
    }
    const [[key, majority], minority] = sorted;
    table[section] = {
      rows: JSON.parse(key),
      exceptions: minority ? minority[1] : [],
    };
    if (minority && minority[1].length > majority.length) {
      problems.push(`${section} の多数派が逆転している。早見表の代表を見直すこと`);
    }
  }
  return table;
}

// --- genshin-db から抽出 ---------------------------------------------------

const names = gdb.characters('names', { ...JP, matchCategories: true });
if (!Array.isArray(names) || names.length === 0) {
  fail('genshin-db からキャラ一覧を取得できなかった');
}

const characters = {};
const materials = {};
const unresolved = [];
const problems = [];

// characters 側の名前 -> talents 側の基準名（元素可変キャラの橋渡し）
const talentAliases = JSON.parse(readFileSync(join(ROOT, 'tools/talent-aliases.json'), 'utf8'));
const VARIANTS_BY_BASE = elementVariants();
const TALENT_DOMAINS = talentDomains();
const BOOK_MOTIFS = bookMotifs();
const seenBooks = new Set(); // 実在する天賦本の系統（図柄テーブルの検査に使う）

for (const [character, base] of Object.entries(talentAliases)) {
  if (!VARIANTS_BY_BASE.has(base)) {
    problems.push(`talent-aliases.json: ${character} -> ${base} の元素別天賦が genshin-db に無い`);
  }
}
if (problems.length) {
  fail('天賦の別名テーブルの参照先が壊れている', problems);
}

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

  // 素材は突破と天賦で別に集める。データが無いキャラもいるので節ごとに省略可とする。
  // 例: ドール（男/女）は突破コストがモラ 0 のみ。
  const ascension = collect(c.costs, 'ascension', c.name, problems);

  // 天賦は元素可変キャラだけ元素別に分かれている。talents 側の名前が characters 側と
  // 異なる（空 / 蛍 に対して 旅人 (風元素)）ため、talent-aliases.json で橋渡しする。
  const talentBase = talentAliases[c.name] ?? c.name;
  const variants = VARIANTS_BY_BASE.get(talentBase);
  let talent = null;
  let talentByElement = null;

  if (variants) {
    talentByElement = {};
    for (const [element, talentName] of variants) {
      const got = collect(gdb.talents(talentName, JP)?.costs, 'talent', `${c.name}(${element})`, problems);
      if (got) talentByElement[element] = got;
    }
    if (Object.keys(talentByElement).length === 0) talentByElement = null;
  } else {
    talent = collect(gdb.talents(talentBase, JP)?.costs, 'talent', c.name, problems);
  }

  if (ascension || talent || talentByElement) {
    materials[c.name] = {
      ...(ascension ? { ascension } : {}),
      ...(talent ? { talent } : {}),
      ...(talentByElement ? { talentByElement } : {}),
    };
  }
}

if (unresolved.length) {
  fail('属性を取得できないキャラがいる', unresolved);
}

if (problems.length) {
  fail('素材を分類できないものがある。tools/build.mjs の classify() を見直すこと', problems);
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
  if (materials[gdbName]) materials[hoyolabName] = structuredClone(materials[gdbName]);
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

const byName = (source) =>
  Object.fromEntries(
    Object.keys(source)
      .sort((a, b) => a.localeCompare(b, 'ja'))
      .map((k) => [k, source[k]]),
  );

const sorted = byName(characters);
const sortedMaterials = byName(materials);

// 図柄テーブルのキーが実在する天賦本と一致しているか検査する。
// 名前を書き間違えても黙って無視されると、図柄が出ない理由が分からなくなる。
const motifKeys = new Set(BOOK_MOTIFS.keys());
const strayMotifs = [...motifKeys].filter((k) => !seenBooks.has(k));
const missingMotifs = [...seenBooks].filter((k) => !motifKeys.has(k));
if (strayMotifs.length || missingMotifs.length) {
  fail('tools/book-motifs.json のキーが天賦本と噛み合っていない', [
    ...strayMotifs.map((k) => `${k}: そんな天賦本は無い`),
    ...missingMotifs.map((k) => `${k}: 図柄テーブルに項目が無い`),
  ]);
}

const costs = costTable(names, talentAliases, problems);
if (problems.length) {
  fail('段階ごとの必要数を共通化できない', problems);
}

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(join(ROOT, 'data/characters.json'), `${JSON.stringify(sorted, null, 1)}\n`, 'utf8');
writeFileSync(
  join(ROOT, 'data/materials.json'),
  `${JSON.stringify({ costs, characters: sortedMaterials }, null, 1)}\n`,
  'utf8',
);

const variable = Object.entries(sorted).filter(([, v]) => v.element === VARIABLE_ELEMENT);
const noAscension = Object.entries(sortedMaterials).filter(([, v]) => !v.ascension);
const noTalent = Object.entries(sortedMaterials).filter(([, v]) => !v.talent && !v.talentByElement);
const byElement = Object.entries(sortedMaterials).filter(([, v]) => v.talentByElement);
const noMaterials = Object.keys(sorted).filter((k) => !sortedMaterials[k]);

console.log(`[build:data] ${Object.keys(sorted).length} 件を data/characters.json に書き出した`);
console.log(`  genshin-db から ${names.length} 件`);
for (const [from, to] of Object.entries(aliases)) console.log(`  別名解決: ${from} <- ${to}`);
console.log(`  元素可変として扱う: ${variable.map(([k]) => k).join(' / ')}`);
console.log(`[build:data] ${Object.keys(sortedMaterials).length} 件を data/materials.json に書き出した`);
for (const [section, label] of [['ascension', '突破'], ['talent', '天賦']]) {
  const t = costs[section];
  if (!t) continue;
  const ex = t.exceptions.length ? `（例外: ${t.exceptions.join(' / ')}）` : '';
  console.log(`  ${label}早見表: ${t.rows.length} 段階${ex}`);
}
if (noAscension.length) console.log(`  突破素材データなし: ${noAscension.map(([k]) => k).join(' / ')}`);
if (noTalent.length) console.log(`  天賦素材データなし: ${noTalent.map(([k]) => k).join(' / ')}`);
for (const [name, v] of byElement) {
  console.log(`  天賦素材が元素別: ${name}（${Object.keys(v.talentByElement).join(' / ')}）`);
}
if (noMaterials.length) console.log(`  素材データなし: ${noMaterials.join(' / ')}`);
