// HoYoLAB「全キャラクター」画面のコピー文字列を解析する。
// PC 版とスマートフォン版で形式が異なるため両方に対応する。
//
// 方針: ホワイトリスト。期待するパターンに一致した行だけを拾い、
// それ以外は破棄して次へ進む（解析を打ち切らない）。画像コピーに伴う
// 異物は末尾に来るとは限らず、途中で混ざったときに打ち切ると以降が全損する。

import { norm } from './names.js';

const SKIP = /^(全キャラクター|レベルが高い順|フィルター)$/;
const LV = /^Lv\.(\d+)$/;
const CONSTELLATION = /^[0-6]$/;
const NAME_WITH_CONSTELLATION = /^(.+?) ([0-6])$/;

// 制御文字・私用領域・置換文字。スマホ版は画像も一緒にコピーされるため混入する。
const GARBAGE_CHARS = /[\u0000-\u001F\u007F\uE000-\uF8FF\uFFFD]/g;

/**
 * 前処理。制御文字・私用領域を落として行単位に整える。
 *
 * 先に行分割してから制御文字を除去すること。順序を逆にすると改行自体が
 * 制御文字として消え、入力全体が 1 行に潰れて何も取得できなくなる。
 */
function normalizeLines(text) {
  return text
    .split(/\r?\n/)
    .map((s) =>
      s
        .replace(GARBAGE_CHARS, "")
        .replace(/\u3000/g, " ") // 全角スペースを半角へ
        .replace(/[ \t]+/g, " ")
        .trim(),
    )
    .filter((s) => s && !SKIP.test(s) && !/^※/.test(s));
}

/**
 * @param {string} text 貼り付けられた生テキスト
 * @returns {{characters: {name:string, level:number, constellation:number}[],
 *            junk: string[], format: 'PC'|'SP'|null}}
 */
export function parse(text) {
  const lines = normalizeLines(text);
  const characters = [];
  const junk = [];
  let format = null;
  let i = 0;

  while (i < lines.length) {
    const lv = lines[i].match(LV);
    if (!lv) {
      junk.push(lines[i]); // 異物は破棄して継続
      i++;
      continue;
    }

    const level = Number(lv[1]);
    i++;
    if (i >= lines.length) {
      junk.push(`Lv.${level}（名前なし）`);
      break;
    }
    if (LV.test(lines[i])) {
      // Lv が連続している = 名前が欠落している。黙って捨てず記録する。
      junk.push(`Lv.${level}（名前なし）`);
      continue;
    }

    let constellation = 0;
    let name = null;

    if (CONSTELLATION.test(lines[i])) {
      // PC 版: 凸数が名前の前の独立行にある
      constellation = Number(lines[i]);
      i++;
      format ??= 'PC';
      if (i < lines.length && !LV.test(lines[i])) {
        name = lines[i];
        i++;
      } else {
        junk.push(`Lv.${level} 凸${constellation}（名前なし）`);
      }
    } else {
      // スマホ版: 「名前 凸数」または「名前」のみ
      const m = lines[i].match(NAME_WITH_CONSTELLATION);
      if (m) {
        name = m[1];
        constellation = Number(m[2]);
        format ??= 'SP';
      } else {
        name = lines[i];
      }
      i++;
    }

    if (name) characters.push({ name: norm(name), level, constellation });
  }

  return { characters, junk, format };
}
