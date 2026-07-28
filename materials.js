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
 * 1 キャラ分の素材を画面に出す形へ整える。
 *
 * データが無い節は `sections: []` ではなく `missing: true` を立てて、
 * 「素材が要らない」と「データが無い」を混同させない。
 *
 * ドロップ元は突破と天賦で一致するのが普通なので、その場合は `common` として
 * 一度だけ返す。食い違うキャラが現れたときだけ各節の中に残す。
 */
export function describe(entry) {
  const asc = entry?.ascension ?? null;
  const tal = entry?.talent ?? null;

  const ascCommon = asc?.common ?? null;
  const talCommon = tal?.common ?? null;
  const shared =
    ascCommon && talCommon
      ? sameItems(ascCommon, talCommon)
        ? ascCommon
        : null
      : (ascCommon ?? talCommon);

  // 共通化できた場合だけ各節から取り除く（食い違うなら両方に残して差を見せる）
  const withCommon = (order) => (shared ? order : [...order, COMMON_SECTION]);

  return {
    ascension: {
      missing: !asc,
      sections: sectionsOf(asc, withCommon(ASCENSION_SECTIONS)),
    },
    talent: {
      missing: !tal,
      sections: sectionsOf(tal, withCommon(TALENT_SECTIONS)),
      domain: tal?.domain ?? null,
      days: tal?.days ?? null,
    },
    common: shared,
  };
}

/**
 * モラの段階ごと早見表。全キャラ共通の値なのでキャラを渡す必要はない。
 * 累計も返す（早見表として見るとき、そこまでにいくら要るかが知りたくなる）。
 */
export function moraRows(mora) {
  const rows = (values, label) => {
    let running = 0;
    return (values ?? []).map((amount, i) => {
      running += amount;
      return { label: label(i), amount, total: running };
    });
  };
  return {
    ascension: rows(mora?.ascension, (i) => `${i + 1}段階`),
    talent: rows(mora?.talent, (i) => `Lv.${i + 2}`),
  };
}
