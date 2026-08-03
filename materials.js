// 突破素材・天賦素材の並びとラベル。data/materials.json の読み替えだけを担い、
// DOM に触らないので Node からテストできる。
//
// 「今日これをやれ」と指示する道具にはしない方針なので、ここでやるのは
// 「何を集めるのか」を並べることだけ。所持数・必要数・進捗は扱わない。
// レアリティの段階もビルド時に畳んであるので、ここでは扱わない。

export const WEEKDAYS = ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜'];

/** 突破素材の表示順とラベル。data/materials.json のキーに対応する。 */
export const ASCENSION_SECTIONS = [
  ['gem', '宝石'],
  ['boss', 'ボス素材'],
  ['local', '特産品'],
];

/** 天賦素材の表示順とラベル。 */
export const TALENT_SECTIONS = [
  ['book', '天賦本'],
  ['weeklyBoss', '週ボス素材'],
  ['crown', '冠'],
];

/** 突破と天賦で共通の雑魚ドロップ。ビルド時にドロップ元の敵名へ畳んである。 */
export const COMMON_SECTION = ['common', 'ドロップ元'];

/**
 * 秘境の曜日判定に使う日付。天賦本の秘境は 04:00 に切り替わるため、
 * それより前は前日として扱う。端末のローカル日付を基準にしている
 * （サーバ選択までは見ないので、実際のリセット時刻とは最大 1 時間ずれうる）。
 */
export function domainWeekday(now) {
  const shifted = new Date(now.getTime());
  if (shifted.getHours() < 4) shifted.setDate(shifted.getDate() - 1);
  return WEEKDAYS[shifted.getDay()];
}

/**
 * その天賦本が今日入手できるか。
 * days が無ければ判定不能として false を返す。
 */
export function availableToday(days, now) {
  if (!Array.isArray(days) || days.length === 0) return false;
  return days.includes(domainWeekday(now));
}

const sectionsOf = (group, order) =>
  order
    .filter(([key]) => group?.[key]?.length)
    .map(([key, label]) => ({ key, label, items: group[key] }));

const sameItems = (a, b) =>
  a.length === b.length && a.every((x, i) => x.name === b[i].name && x.from === b[i].from);

/**
 * 天賦の節を配列で返す。通常キャラは 1 件（element: null）、旅人のような
 * 元素可変キャラは元素ごとに 1 件ずつ。
 */
function talentGroups(entry) {
  if (entry?.talentByElement) {
    return Object.entries(entry.talentByElement).map(([element, group]) => ({ element, group }));
  }
  return [{ element: null, group: entry?.talent ?? null }];
}

/**
 * 1 キャラ分の素材を画面に出す形へ整える。
 *
 * データが無い節は `sections: []` ではなく `missing: true` を立てて、
 * 「素材が要らない」と「データが無い」を混同させない。
 *
 * ドロップ元は突破と天賦で一致するのが普通なので、その場合は `common` として
 * 一度だけ返す。食い違うキャラ（元素可変キャラは元素ごとに違う）では各節に残す。
 */
export function describe(entry, done = {}) {
  const asc = entry?.ascension ?? null;
  const talents = talentGroups(entry);

  // 天賦が 1 件のときだけドロップ元を共通化できる。元素別だと元素ごとに違う。
  const single = talents.length === 1 ? talents[0].group : null;
  const ascCommon = asc?.common ?? null;
  const talCommon = single?.common ?? null;
  const shared =
    ascCommon && talCommon
      ? sameItems(ascCommon, talCommon)
        ? ascCommon
        : null
      : talents.length === 1
        ? (ascCommon ?? talCommon)
        : null;

  // 共通化できた場合だけ各節から取り除く（食い違うなら両方に残して差を見せる）
  const withCommon = (order) => (shared ? order : [...order, COMMON_SECTION]);

  // 育成が済んでいる節は「データが無い」とは区別して done で返す。
  return {
    ascension: {
      missing: !asc,
      done: Boolean(done.ascension),
      sections: done.ascension ? [] : sectionsOf(asc, withCommon(ASCENSION_SECTIONS)),
    },
    talents: talents.map(({ element, group }) => ({
      element,
      missing: !group,
      done: Boolean(done.talent),
      sections: done.talent ? [] : sectionsOf(group, withCommon(TALENT_SECTIONS)),
    })),
    common: done.ascension && done.talent ? null : shared,
  };
}

/**
 * 1 キャラ分を 1 列に並べるための行。describe() の結果を平らにするだけ。
 *
 * 枠の並びに合わせて 4 列で見せるので、列の中は「突破 → 天賦 → 共通」の縦並びになる。
 * 元素可変キャラは元素ごとに 3 系統 × 6 元素で列に収まらないため、列では出さずに
 * 素材ダイアログへ送る（黙って落とさず note を返す）。
 */
export function columnFor(entry, done = {}) {
  const d = describe(entry, done);
  const rows = [];
  const notes = [];

  if (d.ascension.done) notes.push('突破は育成済み');
  else if (d.ascension.missing) notes.push('突破素材のデータなし');
  else rows.push(...d.ascension.sections);

  const variant = d.talents.length > 1;
  if (d.talents[0]?.done) notes.push('天賦は育成済み');
  else if (variant) notes.push('天賦は元素別（素材ボタンで見られます）');
  else if (d.talents[0]?.missing) notes.push('天賦素材のデータなし');
  else rows.push(...d.talents[0].sections);

  if (d.common?.length) rows.push({ key: 'common', label: 'ドロップ元', items: d.common });

  return { rows, notes };
}

/** 早見表の列の順とラベル。 */
export const COST_COLUMNS = {
  ascension: [
    ['gem', '宝石'],
    ['boss', 'ボス素材'],
    ['local', '特産品'],
    ['common', '共通素材'],
  ],
  talent: [
    ['book', '天賦本'],
    ['common', '共通素材'],
    ['weeklyBoss', '週ボス素材'],
    ['crown', '冠'],
  ],
};

/**
 * 段階ごとの必要数の早見表。素材の名前はキャラごとに違うが、
 * 「どのレアリティを何個」という構造は全キャラ共通なので表にできる。
 *
 * 累計も返す（そこまでに何個要るのかが知りたくなるため）。
 */
export function costRows(costs) {
  const build = (section, label) => {
    const table = costs?.[section];
    if (!table?.rows?.length) return { rows: [], exceptions: [] };
    const columns = COST_COLUMNS[section];
    const running = new Map();
    let mora = 0;

    const rows = table.rows.map((row, i) => {
      mora += row.mora;
      const cells = columns.map(([kind]) => {
        const item = row.items.find((x) => x.kind === kind);
        if (!item) return { kind, rarity: null, count: 0, total: running.get(kind) ?? 0 };
        const total = (running.get(kind) ?? 0) + item.count;
        running.set(kind, total);
        return { kind, rarity: item.rarity, count: item.count, total };
      });
      return { label: label(i), cells, mora: row.mora, moraTotal: mora };
    });

    return { rows, exceptions: table.exceptions ?? [] };
  };

  return {
    ascension: build('ascension', (i) => `${i + 1}段階`),
    talent: build('talent', (i) => `Lv.${i + 2}`),
  };
}
