// パース結果（名前 / Lv / 凸）とキャラ属性データを突き合わせる。
// DOM に触らないので Node からテストできる。

import { matchKey } from './names.js';

export const VARIABLE = '可変';
export const UNKNOWN = '?';

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
