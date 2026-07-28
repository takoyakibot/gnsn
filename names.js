// キャラ名の正規化。パーサ・ビルドスクリプト・描画の全てで同じ関数を使うこと。
// ここがズレると PC とスマホで挙動が変わるバグが生まれる。

// 異体字。攻略サイトや IME によって表記が割れるものだけを持つ。
// 左（HoYoLAB / genshin-db で見かける字）→ 右（照合キー上の代表字）。
const VARIANTS = {
  兹: '茲', // 兹白 / 茲白
  菫: '堇', // 雲菫 / 雲堇
};

/**
 * 表示用の正規化。括弧を全角へ寄せる（HoYoLAB PC 版・genshin-db の表記に合わせる）。
 * 画面にはこの形で出す。
 */
export function norm(s) {
  return s
    .replace(/[(（]/g, '（')
    .replace(/[)）]/g, '）')
    .trim();
}

/**
 * 照合用のキー。表示名の揺れ（全角半角・空白・異体字）を吸収して一意な文字列にする。
 * 全 120 キャラで衝突しないことを test/ で検証している。
 */
export function matchKey(s) {
  const t = s
    .normalize('NFKC')
    .replace(/[\s　]/g, '')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')');
  return Array.from(t, (ch) => VARIANTS[ch] ?? ch).join('');
}
