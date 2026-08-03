// パース結果（名前 / Lv / 凸）とキャラ属性データを突き合わせる。
// DOM に触らないので Node からテストできる。

import { matchKey } from './names.js';

export const VARIABLE = '可変';
export const UNKNOWN = '?';

/**
 * レベル帯。Lv.90 が上限なので 10 刻みで 9 帯。
 * 元素・武器種の絞り込みと違い、こちらは「選んだ帯を隠す」除外方式で使う。
 */
export const LEVEL_BANDS = [
  { key: '81-90', label: '90〜81', min: 81, max: 90 },
  { key: '71-80', label: '80〜71', min: 71, max: 80 },
  { key: '61-70', label: '70〜61', min: 61, max: 70 },
  { key: '51-60', label: '60〜51', min: 51, max: 60 },
  { key: '41-50', label: '50〜41', min: 41, max: 50 },
  { key: '31-40', label: '40〜31', min: 31, max: 40 },
  { key: '21-30', label: '30〜21', min: 21, max: 30 },
  { key: '11-20', label: '20〜11', min: 11, max: 20 },
  { key: '1-10', label: '10〜1', min: 1, max: 10 },
];

/** そのレベルが属する帯。範囲外（想定外の値）なら null。 */
export function bandOf(level) {
  return LEVEL_BANDS.find((b) => level >= b.min && level <= b.max) ?? null;
}

/**
 * 最後の突破は Lv.80 -> 81 で起きる。Lv.81 以上なら突破素材はもう要らない。
 */
export const LAST_ASCENSION_LEVEL = 81;

/**
 * 突破素材がもう要らないか。
 * レベルが 81 以上か、利用者が「レベル育成済み」に印を付けていれば要らない。
 */
export function ascensionDone(character, progress) {
  return character.level >= LAST_ASCENSION_LEVEL || Boolean(progress?.level);
}

/** 天賦素材がもう要らないか。判断材料はレベルには無いので印だけで決める。 */
export function talentDone(character, progress) {
  return Boolean(progress?.talent);
}

/** characters.json から照合キー索引を作る。 */
export function buildIndex(data) {
  const index = new Map();
  for (const [name, attrs] of Object.entries(data)) index.set(matchKey(name), { name, ...attrs });
  return index;
}

/**
 * 所持キャラに属性を結合する。
 * 見つからない名前は推測で埋めず known:false とし、元素・武器種を「?」にする。
 */
export function attach(characters, index) {
  return characters.map((c) => {
    const hit = index.get(matchKey(c.name));
    return hit
      ? { ...c, element: hit.element, weapon: hit.weapon, rarity: hit.rarity, known: true }
      : { ...c, element: UNKNOWN, weapon: UNKNOWN, rarity: null, known: false };
  });
}

/** 属性データに存在しなかった名前。画面に出して利用者が報告できるようにする。 */
export function unknownNames(attached) {
  return [...new Set(attached.filter((c) => !c.known).map((c) => c.name))];
}

export function stats(attached) {
  return {
    total: attached.length,
    fiveStar: attached.filter((c) => c.rarity === 5).length,
    maxLevel: attached.filter((c) => c.level === 90).length,
    maxConstellation: attached.filter((c) => c.constellation === 6).length,
    unknown: attached.filter((c) => !c.known).length,
  };
}
