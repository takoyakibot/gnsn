// 画面まわり。解析・照合のロジックは parse.js / roster.js / names.js にある。

import { parse } from './parse.js';
import { attach, buildIndex, resonance, stats, unknownNames, UNKNOWN, VARIABLE } from './roster.js';
import { availableToday, describe, moraRows } from './materials.js';
import { matchKey } from './names.js';

const STORAGE_KEY = 'gnsn.roster.v1';
// 編成メモ / 育成予定の選択は所持キャラとは別に保存する。ロスターを貼り直しても
// 選択が残るようにしたいので、パース結果とは混ぜない。
const SELECTION_KEY = 'gnsn.selection.v1';
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

const selectionStore = {
  load() {
    try {
      const v = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? 'null');
      return Array.isArray(v) ? v.filter((n) => typeof n === 'string') : [];
    } catch {
      return [];
    }
  },
  save(names) {
    try {
      localStorage.setItem(SELECTION_KEY, JSON.stringify(names));
    } catch {
      /* 保存できなくても表示は続ける */
    }
  },
  clear() {
    try {
      localStorage.removeItem(SELECTION_KEY);
    } catch {
      /* noop */
    }
  },
};

const state = {
  index: new Map(),
  saved: null, // { characters, format, savedAt }
  attached: [],
  elements: new Set(),
  weapons: new Set(),
  sort: 'level',
  team: [], // 表示名の配列
  // 素材データは初回に素材を開いたときだけ取りに行く。棚の描画には要らないので
  // 起動時に読むと 100KB 超を無駄に運ぶことになる。
  materials: null,
  mora: null,
  materialsError: null,
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
  // 所持キャラに 1 人もいない値はチップを出さない。元素不明が 0 人なら「?」も出ない。
  // 判定は絞り込み前の全件に対して行う（絞り込むほどチップが消えて戻せなくなるのを防ぐ）。
  const build = (host, values, selected, field, isElement) => {
    const present = new Set(state.attached.map((c) => c[field]));
    for (const v of [...selected]) if (!present.has(v)) selected.delete(v);

    host.replaceChildren();
    for (const v of values.filter((v) => present.has(v))) {
      const b = chip(v, selected.has(v), isElement ? v : null);
      b.addEventListener('click', () => {
        selected.has(v) ? selected.delete(v) : selected.add(v);
        renderFilters();
        renderShelf();
      });
      host.append(b);
    }
  };
  build($('element-filter'), ELEMENTS, state.elements, 'element', true);
  build($('weapon-filter'), WEAPONS, state.weapons, 'weapon', false);
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

    // 素材は別ボタンにする。カード本体のクリックは編成の出し入れのままにしておきたい。
    // button の入れ子は不正な HTML なので、ラッパの中で兄弟として並べる。
    const matBtn = document.createElement('button');
    matBtn.type = 'button';
    matBtn.className = 'mat-btn';
    matBtn.textContent = '素材';
    matBtn.title = `${c.name} の突破素材・天賦素材`;
    matBtn.setAttribute('aria-label', `${c.name} の突破素材・天賦素材`);
    matBtn.addEventListener('click', () => openMaterials(c));

    const wrap = document.createElement('div');
    wrap.className = 'card-wrap';
    wrap.append(card, matBtn);
    shelf.append(wrap);
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
  selectionStore.save(state.team);
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
      slot.textContent = '空き枠';
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
      members.length === 0 ? '棚のカードを押すと枠に入ります。' : '元素共鳴なし';
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

// --- 素材（突破・天賦） ----------------------------------------------------

async function loadMaterials() {
  if (state.materials || state.materialsError) return;
  try {
    const res = await fetch('./data/materials.json');
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    // 照合キーで引けるようにしておく。キャラ名の揺れの扱いを棚と揃える。
    state.mora = data.mora;
    state.materials = new Map(
      Object.entries(data.characters).map(([name, v]) => [matchKey(name), v]),
    );
  } catch {
    state.materialsError = 'キャラ素材データ（data/materials.json）を読み込めませんでした。';
  }
}

function materialGroup(label, items) {
  const row = document.createElement('div');
  row.className = 'mat-group';
  const name = document.createElement('span');
  name.textContent = label;
  const list = document.createElement('div');
  list.className = 'mat-items';
  for (const it of items) {
    const chip = document.createElement('span');
    chip.className = 'mat-item';
    const b = document.createElement('b');
    b.textContent = it.name;
    chip.append(b);
    // ボス素材は素材名だけでは何を殴ればいいのか分からないので入手元を添える。
    if (it.from) {
      const from = document.createElement('span');
      from.className = 'mat-from';
      from.textContent = it.from;
      chip.append(document.createTextNode(' '), from);
    }
    list.append(chip);
  }
  row.append(name, list);
  return row;
}

function materialBlock(heading, group, extras = []) {
  const frag = document.createDocumentFragment();
  const h = document.createElement('h4');
  h.append(document.createTextNode(heading));
  for (const el of extras) h.append(document.createTextNode(' '), el);
  frag.append(h);

  if (group.missing) {
    const p = document.createElement('p');
    p.className = 'dlg-missing';
    // 「素材が要らない」ではなく「genshin-db にデータが無い」。推測で埋めない。
    p.textContent = 'genshin-db にデータがありません。';
    frag.append(p);
    return frag;
  }
  for (const s of group.sections) frag.append(materialGroup(s.label, s.items));
  return frag;
}

function badge(text, isToday) {
  const b = document.createElement('span');
  b.className = isToday ? 'badge today' : 'badge';
  b.textContent = text;
  return b;
}

async function openMaterials(character) {
  await loadMaterials();
  const dialog = $('mat-dialog');

  $('mat-title').textContent = character.name;
  $('mat-sub').textContent =
    `${character.element} · ${character.weapon} · ${character.rarity === null ? '★?' : `★${character.rarity}`}`;

  const body = $('mat-body');
  body.replaceChildren();

  if (state.materialsError) {
    const p = document.createElement('p');
    p.className = 'dlg-missing';
    p.textContent = state.materialsError;
    body.append(p);
    dialog.showModal();
    return;
  }

  const entry = state.materials?.get(matchKey(character.name));
  if (!entry) {
    const p = document.createElement('p');
    p.className = 'dlg-missing';
    p.textContent = 'このキャラの素材データは収録されていません。新キャラの実装直後か、HoYoLAB 側の表記がデータと異なる場合に起きます。';
    body.append(p);
    dialog.showModal();
    return;
  }

  const { ascension, talent, common } = describe(entry);
  body.append(materialBlock('突破素材', ascension));

  // 天賦本の秘境と曜日。「今日回れるか」は小さなバッジに留める（主軸にしない）。
  const extras = [];
  if (talent.domain) extras.push(badge(talent.domain, false));
  if (talent.days?.length) {
    extras.push(badge(talent.days.map((d) => d.replace('曜', '')).join('・'), false));
    if (availableToday(talent.days, new Date())) extras.push(badge('今日', true));
  }
  body.append(materialBlock('天賦素材', talent, extras));

  // 雑魚ドロップは突破と天賦で同じなので、まとめて一度だけ出す。
  if (common?.length) {
    body.append(materialBlock('共通', { missing: false, sections: [{ label: 'ドロップ元', items: common }] }));
  }

  if (talent.days?.length) {
    const note = document.createElement('p');
    note.className = 'dlg-note';
    note.textContent = '秘境の曜日は端末の日付と 04:00 切り替わりで判定しています。';
    body.append(note);
  }

  dialog.showModal();
}

// --- モラ早見表 ------------------------------------------------------------
//
// モラの必要額は全キャラ共通なので、キャラごとには持たせず一枚の表にしている。

function moraTable(caption, rows) {
  const frag = document.createDocumentFragment();
  const h = document.createElement('h4');
  h.textContent = caption;
  frag.append(h);

  const table = document.createElement('table');
  table.className = 'mora-table';
  const head = document.createElement('tr');
  for (const label of ['段階', '必要', '累計']) {
    const th = document.createElement('th');
    th.textContent = label;
    head.append(th);
  }
  table.append(head);

  for (const r of rows) {
    const tr = document.createElement('tr');
    for (const value of [r.label, r.amount.toLocaleString('ja-JP'), r.total.toLocaleString('ja-JP')]) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    table.append(tr);
  }
  frag.append(table);
  return frag;
}

async function openMora() {
  await loadMaterials();
  const dialog = $('mora-dialog');
  const body = $('mora-body');
  body.replaceChildren();

  if (state.materialsError || !state.mora) {
    const p = document.createElement('p');
    p.className = 'dlg-missing';
    p.textContent = state.materialsError ?? 'モラのデータを読み込めませんでした。';
    body.append(p);
    dialog.showModal();
    return;
  }

  const { ascension, talent } = moraRows(state.mora);
  body.append(moraTable('突破', ascension));
  body.append(moraTable('天賦（1 つあたり）', talent));

  const note = document.createElement('p');
  note.className = 'dlg-note';
  const perTalent = talent.at(-1)?.total ?? 0;
  note.textContent =
    `戦闘天賦は 3 つあるので、すべて Lv.10 まで上げるなら天賦だけで ${(perTalent * 3).toLocaleString('ja-JP')} モラ。` +
    ' 全キャラ共通の値です。';
  body.append(note);

  dialog.showModal();
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
}

function showRoster(saved) {
  state.saved = saved;
  state.attached = attach(saved.characters, state.index);
  // 所持キャラから消えた選択は落とす（貼り直しで手放したキャラが残らないように）
  const before = state.team.length;
  state.team = state.team.filter((n) => state.attached.some((c) => c.name === n));
  if (state.team.length !== before) selectionStore.save(state.team);

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
    // junk（解析できなかった行）は画面には出さない。PC 版末尾の `11` のような
    // 意味のない残骸まで並べても読む側の役に立たないため。
    const { characters, format } = parse(text);
    if (characters.length === 0) {
      $('import-note').textContent =
        'キャラを 1 件も取得できませんでした。「Lv.90」のような行を含む形でコピーできているか確認してください。';
      return;
    }
    const saved = { characters, format, savedAt: Date.now() };
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
    selectionStore.clear();
    state.team = [];
    showRoster({ characters: [], format: null });
    $('input').value = '';
    showImport();
  });
  $('team-clear').addEventListener('click', () => {
    state.team = [];
    selectionStore.save(state.team);
    renderTeam();
    renderShelf();
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
  $('mat-close').addEventListener('click', () => $('mat-dialog').close());
  $('mora-btn').addEventListener('click', openMora);
  $('mora-close').addEventListener('click', () => $('mora-dialog').close());
  $('mora-dialog').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });
  // 背景クリックで閉じる（dialog 本体のクリックは中身に当たるので座標では見ない）
  $('mat-dialog').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
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

  state.team = selectionStore.load().slice(0, TEAM_SIZE);

  const saved = store.load();
  if (saved) showRoster(saved);
  else showImport();
}

main();
