// 画面まわり。解析・照合のロジックは parse.js / roster.js / names.js にある。

import { parse } from './parse.js';
import { attach, buildIndex, resonance, stats, unknownNames, UNKNOWN, VARIABLE } from './roster.js';

const STORAGE_KEY = 'gnsn.roster.v1';
const ELEMENTS = ['炎', '水', '風', '雷', '草', '氷', '岩', VARIABLE, UNKNOWN];
const WEAPONS = ['片手剣', '両手剣', '長柄武器', '弓', '法器', UNKNOWN];
const TEAM_SIZE = 4;

const $ = (id) => document.getElementById(id);

/**
 * localStorage には「パース結果」だけを保存し、属性を結合した後の状態は保存しない。
 * こうしておくと data/characters.json を更新した時点で、それまで ? だったキャラが
 * 貼り直しなしで解決する。結合後を保存すると ? が各ブラウザに焼き付いてしまう。
 */
const store = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      return Array.isArray(v?.characters) ? v : null;
    } catch {
      return null;
    }
  },
  save(v) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    } catch {
      /* 保存できなくても表示は続ける */
    }
  },
  clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
  },
};

const state = {
  index: new Map(),
  saved: null, // { characters, junk, format, savedAt }
  attached: [],
  elements: new Set(),
  weapons: new Set(),
  sort: 'level',
  team: [], // 表示名の配列
};

// --- 描画ヘルパ ------------------------------------------------------------

const elementVar = (el) => (el === UNKNOWN ? 'var(--el-可変)' : `var(--el-${el})`);

function chip(label, pressed, el) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = label;
  b.setAttribute('aria-pressed', String(pressed));
  if (el) b.style.setProperty('--el', elementVar(el));
  return b;
}

function renderFilters() {
  const build = (host, values, selected, isElement) => {
    host.replaceChildren();
    for (const v of values) {
      const b = chip(v, selected.has(v), isElement ? v : null);
      b.addEventListener('click', () => {
        selected.has(v) ? selected.delete(v) : selected.add(v);
        renderFilters();
        renderShelf();
      });
      host.append(b);
    }
  };
  build($('element-filter'), ELEMENTS, state.elements, true);
  build($('weapon-filter'), WEAPONS, state.weapons, false);
}

function visible() {
  const { elements, weapons, sort } = state;
  const rows = state.attached.filter(
    (c) =>
      (elements.size === 0 || elements.has(c.element)) &&
      (weapons.size === 0 || weapons.has(c.weapon)),
  );

  const byName = (a, b) => a.name.localeCompare(b.name, 'ja');
  const comparators = {
    level: (a, b) => b.level - a.level || b.constellation - a.constellation || byName(a, b),
    constellation: (a, b) => b.constellation - a.constellation || b.level - a.level || byName(a, b),
    element: (a, b) =>
      ELEMENTS.indexOf(a.element) - ELEMENTS.indexOf(b.element) || b.level - a.level || byName(a, b),
    rarity: (a, b) => (b.rarity ?? 0) - (a.rarity ?? 0) || b.level - a.level || byName(a, b),
    name: byName,
  };
  return rows.sort(comparators[sort]);
}

function renderShelf() {
  const rows = visible();
  const shelf = $('shelf');
  shelf.replaceChildren();

  for (const c of rows) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = c.known ? 'card' : 'card unknown';
    card.style.setProperty('--el', elementVar(c.element));
    card.setAttribute('aria-pressed', String(state.team.includes(c.name)));

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = c.name;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const el = document.createElement('span');
    el.className = 'el';
    el.textContent = c.element;
    meta.append(el, document.createTextNode(` · ${c.weapon}`));

    const line = document.createElement('div');
    line.className = 'meta';
    const rarity = c.rarity === null ? '★?' : `★${c.rarity}`;
    line.textContent = `Lv.${c.level} · ${c.constellation}凸 · ${rarity}`;

    card.append(name, meta, line);
    card.addEventListener('click', () => toggleTeam(c.name));
    shelf.append(card);
  }

  $('filter-count').textContent =
    rows.length === state.attached.length
      ? `${rows.length} 体`
      : `${rows.length} / ${state.attached.length} 体`;
}

function toggleTeam(name) {
  const at = state.team.indexOf(name);
  if (at >= 0) state.team.splice(at, 1);
  else if (state.team.length < TEAM_SIZE) state.team.push(name);
  else return; // 4 枠が埋まっているときは何もしない
  renderTeam();
  renderShelf();
}

function renderTeam() {
  const host = $('team');
  host.replaceChildren();
  const members = state.team.map((n) => state.attached.find((c) => c.name === n)).filter(Boolean);

  for (let i = 0; i < TEAM_SIZE; i++) {
    const c = members[i];
    const slot = document.createElement('div');
    slot.className = c ? 'slot filled' : 'slot';
    if (c) {
      slot.style.setProperty('--el', elementVar(c.element));
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = c.name;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${c.element} · Lv.${c.level} · ${c.constellation}凸`;
      slot.append(name, meta);
    } else {
      slot.textContent = 'カードを選択';
    }
    host.append(slot);
  }

  const box = $('resonance');
  box.replaceChildren();
  const found = resonance(members);
  if (found.length === 0) {
    const s = document.createElement('span');
    s.className = 'none';
    s.textContent =
      members.length === 0 ? '棚のカードを押すと編成に入ります。' : '元素共鳴なし';
    box.append(s);
  } else {
    box.append(document.createTextNode('元素共鳴: '));
    for (const r of found) {
      const s = document.createElement('b');
      s.style.color = elementVar(r.element);
      s.textContent = `${r.element}（${r.count}人）`;
      box.append(s, document.createTextNode(' '));
    }
  }

  const variable = members.filter((c) => c.element === VARIABLE || c.element === UNKNOWN);
  if (variable.length) {
    const n = document.createElement('div');
    n.className = 'note';
    n.textContent = `${variable.map((c) => c.name).join(' / ')} は元素が確定しないため共鳴判定から除外しています。`;
    box.append(n);
  }
}

function renderStatus() {
  const { saved, attached } = state;
  const s = stats(attached);

  const host = $('stats');
  host.replaceChildren();
  const cells = [
    ['所持数', s.total],
    ['★5', s.fiveStar],
    ['Lv.90', s.maxLevel],
    ['満凸', s.maxConstellation],
  ];
  for (const [label, value] of cells) {
    const d = document.createElement('div');
    d.className = 'stat';
    const b = document.createElement('b');
    b.textContent = String(value);
    const sp = document.createElement('span');
    sp.textContent = label;
    d.append(b, sp);
    host.append(d);
  }

  const format = saved.format === 'PC' ? 'PC 版' : saved.format === 'SP' ? 'スマホ版' : '不明';
  const when = saved.savedAt ? new Date(saved.savedAt).toLocaleString('ja-JP') : '';
  $('status-note').textContent = `${format}の形式として解析${when ? ` · ${when}` : ''}`;

  // 属性データに無かった名前。黙って ? にせず、報告できる形で出す。
  const unknown = unknownNames(attached);
  const ubox = $('unknown-box');
  ubox.replaceChildren();
  ubox.hidden = unknown.length === 0;
  if (unknown.length) {
    ubox.append(
      document.createTextNode(
        `属性データに無い名前が ${unknown.length} 件あります（元素・武器種は ? のまま表示しています）。新キャラの実装直後か、HoYoLAB 側の表記がデータと異なる場合に起きます: `,
      ),
    );
    for (const n of unknown) {
      const code = document.createElement('code');
      code.textContent = n;
      ubox.append(code);
    }
  }

  // 破棄したトークン。黙って捨てない。
  const jbox = $('junk-box');
  jbox.replaceChildren();
  const junk = saved.junk ?? [];
  jbox.hidden = junk.length === 0;
  if (junk.length) {
    jbox.append(document.createTextNode(`解析できず破棄した行が ${junk.length} 件あります: `));
    for (const j of junk.slice(0, 40)) {
      const code = document.createElement('code');
      code.textContent = j;
      jbox.append(code);
    }
    if (junk.length > 40) jbox.append(document.createTextNode(`ほか ${junk.length - 40} 件`));
  }
}

function showRoster(saved) {
  state.saved = saved;
  state.attached = attach(saved.characters, state.index);
  state.team = state.team.filter((n) => state.attached.some((c) => c.name === n));

  const has = state.attached.length > 0;
  $('import-panel').hidden = has;
  $('cancel-btn').hidden = true;
  for (const id of ['status-panel', 'filter-panel', 'team-panel', 'shelf-section']) {
    $(id).hidden = !has;
  }
  if (!has) {
    for (const id of ['shelf', 'team', 'resonance']) $(id).replaceChildren();
    return;
  }

  renderStatus();
  renderFilters();
  renderTeam();
  renderShelf();
}

function showImport() {
  $('import-panel').hidden = false;
  $('cancel-btn').hidden = !state.saved;
  $('input').focus();
}

// --- 起動 ------------------------------------------------------------------

async function main() {
  $('parse-btn').addEventListener('click', () => {
    const text = $('input').value;
    if (!text.trim()) {
      $('import-note').textContent = 'テキストが空です。';
      return;
    }
    const { characters, junk, format } = parse(text);
    if (characters.length === 0) {
      $('import-note').textContent =
        'キャラを 1 件も取得できませんでした。「Lv.90」のような行を含む形でコピーできているか確認してください。';
      return;
    }
    const saved = { characters, junk, format, savedAt: Date.now() };
    store.save(saved);
    $('input').value = '';
    $('import-note').textContent = '';
    showRoster(saved);
    window.scrollTo({ top: 0 });
  });

  $('reimport-btn').addEventListener('click', showImport);
  $('cancel-btn').addEventListener('click', () => {
    $('import-panel').hidden = true;
  });
  $('clear-btn').addEventListener('click', () => {
    store.clear();
    state.team = [];
    showRoster({ characters: [], junk: [], format: null });
    $('input').value = '';
    showImport();
  });
  $('sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderShelf();
  });
  $('reset-filter').addEventListener('click', () => {
    state.elements.clear();
    state.weapons.clear();
    renderFilters();
    renderShelf();
  });

  try {
    const res = await fetch('./data/characters.json');
    if (!res.ok) throw new Error(String(res.status));
    state.index = buildIndex(await res.json());
  } catch {
    // データが読めなくても解析と一覧表示は成立する（全員 ? になる）
    $('import-note').textContent =
      'キャラ属性データを読み込めませんでした。元素・武器種は ? で表示されます。';
  }

  const saved = store.load();
  if (saved) showRoster(saved);
  else showImport();
}

main();
