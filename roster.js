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

/**
 * 元素共鳴の判定。同一元素が 2 人以上いれば共鳴あり。
 * 「可変」と「?」は元素が確定しないので判定から除外する。
 */
export function resonance(team) {
  const counts = new Map();
  for (const c of team) {
    if (!c || c.element === VARIABLE || c.element === UNKNOWN) continue;
    counts.set(c.element, (counts.get(c.element) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([element, count]) => ({ element, count }))
    .sort((a, b) => b.count - a.count || a.element.localeCompare(b.element, 'ja'));
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
