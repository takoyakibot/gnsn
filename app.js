// 画面まわり。解析・照合のロジックは parse.js / roster.js / names.js にある。

import { parse } from './parse.js';
import {
  ascensionDone,
  attach,
  bandOf,
  buildIndex,
  LAST_ASCENSION_LEVEL,
  LEVEL_BANDS,
  stats,
  talentDone,
  unknownNames,
  UNKNOWN,
  VARIABLE,
} from './roster.js';
import { availableToday, columnFor, COST_COLUMNS, costRows, describe } from './materials.js';
import { matchKey } from './names.js';

const STORAGE_KEY = 'gnsn.roster.v1';
// 編成メモ / 育成予定の選択は所持キャラとは別に保存する。ロスターを貼り直しても
// 選択が残るようにしたいので、パース結果とは混ぜない。
const SELECTION_KEY = 'gnsn.selection.v1';
// 育成の済み印。キャラ名 -> { level, talent }
const PROGRESS_KEY = 'gnsn.progress.v1';
// 画面の開き具合。絞り込みを開いたままにしたい人が毎回開き直さずに済むように。
const UI_KEY = 'gnsn.ui.v1';
const ELEMENTS = ['炎', '水', '風', '雷', '草', '氷', '岩', VARIABLE, UNKNOWN];
const WEAPONS = ['片手剣', '両手剣', '長柄武器', '弓', '法器', UNKNOWN];
// 並び順。先頭が既定。visible() の comparators のキーと対応している。
const SORTS = [
  ['level', 'レベル順'],
  ['constellation', '凸順'],
  ['element', '元素順'],
  ['rarity', 'レアリティ順'],
  ['name', '名前順'],
];
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

/**
 * 育成の済み印。キャラ名 -> { level, talent }。
 * 進捗を細かく追う道具にはしないので、持つのは「終わったかどうか」だけ。
 * 何をいつやれとは言わず、済んだ分の素材を視界から外すためだけに使う。
 */
const progressStore = {
  load() {
    try {
      const v = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? 'null');
      if (!v || typeof v !== 'object') return {};
      const out = {};
      for (const [name, flags] of Object.entries(v)) {
        out[name] = { level: Boolean(flags?.level), talent: Boolean(flags?.talent) };
      }
      return out;
    } catch {
      return {};
    }
  },
  save(progress) {
    try {
      // 何も印が付いていないキャラは保存しない（消したぶんが残り続けないように）
      const trimmed = Object.fromEntries(
        Object.entries(progress).filter(([, f]) => f.level || f.talent),
      );
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(trimmed));
    } catch {
      /* 保存できなくても表示は続ける */
    }
  },
  clear() {
    try {
      localStorage.removeItem(PROGRESS_KEY);
    } catch {
      /* noop */
    }
  },
};

/**
 * 絞り込みパネルの開閉。既定は閉じる。
 * 追従させている都合で、開いたままだと狭い画面では一覧を覆ってしまうため、
 * 「開けておきたい」と自分で開いた人にだけ開いた状態を返す。
 */
const uiStore = {
  loadFilterOpen() {
    try {
      return JSON.parse(localStorage.getItem(UI_KEY) ?? 'null')?.filterOpen === true;
    } catch {
      return false;
    }
  },
  saveFilterOpen(open) {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ filterOpen: Boolean(open) }));
    } catch {
      /* 保存できなくても表示は続ける */
    }
  },
};

const state = {
  index: new Map(),
  saved: null, // { characters, format, savedAt }
  attached: [],
  elements: new Set(),
  weapons: new Set(),
  // レベル帯は「隠す帯」を持つ（元素・武器種の絞り込みとは逆向き）
  hiddenBands: new Set(),
  sort: 'level',
  team: [], // 表示名の配列
  // 素材データは初回に素材を開いたときだけ取りに行く。棚の描画には要らないので
  // 起動時に読むと 100KB 超を無駄に運ぶことになる。
  materials: null,
  costs: null,
  progress: {},
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
  renderBandFilter();
  renderSortChips();
}

/**
 * 並び順。元素・武器種と違って必ず 1 つだけ選ばれている状態なので、
 * 押すと切り替わる（もう一度押しても外れない）。
 */
function renderSortChips() {
  const host = $('sort-filter');
  host.replaceChildren();
  for (const [key, label] of SORTS) {
    const b = chip(label, state.sort === key);
    b.addEventListener('click', () => {
      if (state.sort === key) return;
      state.sort = key;
      renderSortChips();
      renderShelf();
    });
    host.append(b);
  }
}

/**
 * レベル帯は「押すと隠れる」除外方式。元素・武器種と向きが逆なので、
 * 取り消し線と文言で区別できるようにしている。
 */
function renderBandFilter() {
  const host = $('level-filter');
  const counts = new Map();
  for (const c of state.attached) {
    const band = bandOf(c.level);
    if (band) counts.set(band.key, (counts.get(band.key) ?? 0) + 1);
  }
  for (const key of [...state.hiddenBands]) if (!counts.has(key)) state.hiddenBands.delete(key);

  host.replaceChildren();
  for (const band of LEVEL_BANDS.filter((b) => counts.has(b.key))) {
    const hidden = state.hiddenBands.has(band.key);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = hidden ? 'chip excluded' : 'chip';
    b.textContent = `${band.label} (${counts.get(band.key)})`;
    b.setAttribute('aria-pressed', String(hidden));
    b.setAttribute('aria-label', `Lv.${band.label} を${hidden ? '表示' : '非表示'}にする`);
    b.title = b.getAttribute('aria-label');
    b.addEventListener('click', () => {
      hidden ? state.hiddenBands.delete(band.key) : state.hiddenBands.add(band.key);
      renderBandFilter();
      renderShelf();
    });
    host.append(b);
  }
}

function visible() {
  const { elements, weapons, hiddenBands, sort } = state;
  const rows = state.attached.filter(
    (c) =>
      (elements.size === 0 || elements.has(c.element)) &&
      (weapons.size === 0 || weapons.has(c.weapon)) &&
      !hiddenBands.has(bandOf(c.level)?.key),
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

    // 元素・武器種・レベル・凸・レアリティを 1 行に収める。
    // 折り返さない幅をグリッド側（--card-min）で確保している。
    const meta = document.createElement('div');
    meta.className = 'meta';
    const el = document.createElement('span');
    el.className = 'el';
    el.textContent = c.element;
    const rarity = c.rarity === null ? '★?' : `★${c.rarity}`;
    meta.append(el, document.createTextNode(`·${c.weapon} Lv.${c.level} ${c.constellation}凸 ${rarity}`));

    card.append(name, meta);
    card.addEventListener('click', () => toggleTeam(c.name));
    shelf.append(card);
  }

  $('filter-count').textContent =
    rows.length === state.attached.length
      ? `${rows.length} 体`
      : `${rows.length} / ${state.attached.length} 体`;
  renderFilterDigest();
}

/**
 * 畳んだ絞り込みパネルの見出しに出す要約。
 * 開かなくても「今どう絞ってあるか」が読めないと、件数が減っている理由が
 * 分からないまま一覧を見ることになる。
 */
function renderFilterDigest() {
  const parts = [];
  if (state.elements.size) parts.push([...state.elements].join('・'));
  if (state.weapons.size) parts.push([...state.weapons].join('・'));
  if (state.hiddenBands.size) parts.push(`${state.hiddenBands.size} 帯を非表示`);
  // 既定の並び順は言わない（変えているときだけ畳んだ見出しに出す）
  if (state.sort !== SORTS[0][0]) {
    const label = SORTS.find(([k]) => k === state.sort)?.[1];
    if (label) parts.push(label);
  }
  $('filter-digest').textContent = parts.length ? parts.join(' / ') : '';
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

/**
 * 育成の済み印。付けるとそのキャラの素材が一覧から消える。
 * レベルは Lv.81 以上なら最後の突破が済んでいるので、印に関係なく済み扱いにする。
 */
function progressChecks(c) {
  const box = document.createElement('div');
  box.className = 'progress';
  const flags = state.progress[c.name] ?? { level: false, talent: false };
  const autoLevel = c.level >= LAST_ASCENSION_LEVEL;

  const add = (key, label, checked, disabled, title) => {
    const wrap = document.createElement('label');
    wrap.className = disabled ? 'done-check auto' : 'done-check';
    wrap.title = title;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.disabled = disabled;
    input.addEventListener('change', () => {
      const next = { ...(state.progress[c.name] ?? { level: false, talent: false }) };
      next[key] = input.checked;
      state.progress[c.name] = next;
      progressStore.save(state.progress);
      renderTeam();
    });
    wrap.append(input, document.createTextNode(label));
    box.append(wrap);
  };

  add(
    'level',
    'Lv済',
    autoLevel || flags.level,
    autoLevel,
    autoLevel
      ? `Lv.${LAST_ASCENSION_LEVEL} 以上なので突破は済んでいます`
      : 'レベル育成が終わっていれば印を付けてください（突破素材が一覧から消えます）',
  );
  add(
    'talent',
    '天賦済',
    flags.talent,
    false,
    '天賦育成が終わっていれば印を付けてください（天賦素材が一覧から消えます）',
  );
  return box;
}

/** そのキャラの素材をもう出さなくてよいか。 */
const doneFlags = (c) => ({
  ascension: ascensionDone(c, state.progress[c.name]),
  talent: talentDone(c, state.progress[c.name]),
});

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

      // 素材はここで見る。棚のカードは編成の出し入れだけに使う。
      const matBtn = document.createElement('button');
      matBtn.type = 'button';
      matBtn.className = 'mat-btn';
      matBtn.textContent = '素材';
      matBtn.title = `${c.name} の突破素材・天賦素材`;
      matBtn.setAttribute('aria-label', `${c.name} の突破素材・天賦素材`);
      matBtn.addEventListener('click', () => openMaterials(c));

      slot.append(name, meta, matBtn, progressChecks(c));
    } else {
      slot.textContent = '空き枠';
    }
    host.append(slot);
  }

  renderPickedMaterials(members);
}

/**
 * 選択中のキャラに必要な素材を、枠と同じ 4 列で出す。枠の下のアコーディオン。
 *
 * 列は枠と同じグリッド定義を共有しているので、キャラの並びと縦に揃い、
 * 幅が狭くなったときも枠と同じところで折り返す。
 * 開いたときに初めて素材データを取りに行く（棚の描画には要らないため）。
 */
async function renderPickedMaterials(members) {
  const box = $('picked-mats');
  const summary = $('picked-mats-summary');
  const body = $('picked-mats-body');

  box.hidden = members.length === 0;
  if (members.length === 0) {
    box.open = false;
    body.replaceChildren();
    return;
  }

  summary.textContent = `選択中の ${members.length} 人に必要な素材`;
  if (!box.open) return; // 開くまでは中身を作らない（データも読まない）

  await loadMaterials();
  body.replaceChildren();

  if (state.materialsError) {
    const p = document.createElement('p');
    p.className = 'dlg-missing';
    p.textContent = state.materialsError;
    body.append(p);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'picked-cols';

  // 空き枠のぶんも列を作る。数が揃っていないと枠と縦がずれる。
  for (let i = 0; i < TEAM_SIZE; i++) {
    const c = members[i];
    const col = document.createElement('div');
    col.className = c ? 'mat-col' : 'mat-col empty';
    if (!c) {
      grid.append(col);
      continue;
    }

    col.style.setProperty('--el', elementVar(c.element));
    const head = document.createElement('div');
    head.className = 'mat-col-name';
    head.textContent = c.name;
    col.append(head);

    const entry = state.materials?.get(matchKey(c.name));
    if (!entry) {
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = '素材データがありません。';
      col.append(p);
      grid.append(col);
      continue;
    }

    // 行は必ず全部出す。間引くと列ごとに高さが変わって隣と見比べられなくなる。
    const EMPTY = { done: '育成済み', missing: 'データなし', variant: '元素別（素材ボタン）', none: '—' };
    for (const r of columnFor(entry, doneFlags(c))) {
      if (r.items.length) {
        col.append(materialGroup(r.label, r.items, r.key, true));
        continue;
      }
      const row = document.createElement('div');
      row.className = 'mat-group';
      const label = document.createElement('span');
      label.textContent = r.label;
      const blank = document.createElement('div');
      blank.className = 'mat-items';
      const ph = document.createElement('span');
      ph.className = 'mat-empty';
      ph.textContent = EMPTY[r.state] ?? '—';
      blank.append(ph);
      row.append(label, blank);
      col.append(row);
    }
    grid.append(col);
  }

  body.append(grid);
}

// --- 素材（突破・天賦） ----------------------------------------------------

async function loadMaterials() {
  if (state.materials || state.materialsError) return;
  try {
    const res = await fetch('./data/materials.json');
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    // 照合キーで引けるようにしておく。キャラ名の揺れの扱いを棚と揃える。
    state.costs = data.costs;
    state.materials = new Map(
      Object.entries(data.characters).map(([name, v]) => [matchKey(name), v]),
    );
  } catch {
    state.materialsError = 'キャラ素材データ（data/materials.json）を読み込めませんでした。';
  }
}

/**
 * 素材の 1 行。label の右にチップを並べる。
 *
 * compact は枠の下の列で使う。列は幅が狭いので、天賦本の秘境と地域は省き、
 * はみ出したぶんは折り返さずに省略記号で切って tooltip に全文を入れる。
 * 折り返すと行の高さが列ごとに変わり、隣の列と見比べられなくなる。
 */
function materialGroup(label, items, kind, compact = false) {
  const row = document.createElement('div');
  row.className = 'mat-group';
  const name = document.createElement('span');
  name.textContent = label;
  const list = document.createElement('div');
  list.className = 'mat-items';
  for (const it of items) {
    const chip = document.createElement('span');
    chip.className = 'mat-item';
    // 種別ごとに色を付ける。素材名を覚えていなくても種類で見分けられるように。
    if (kind) chip.dataset.kind = kind;

    const parts = [it.name];
    const b = document.createElement('b');
    b.textContent = it.name;
    chip.append(b);

    // 天賦本の図柄。正式名称（図柄）の形にして、どちらが正式名称かを取り違えないようにする。
    if (it.motif) {
      const motif = document.createElement('span');
      motif.className = it.motifDraft ? 'mat-motif draft' : 'mat-motif';
      motif.textContent = it.motifDraft ? `（${it.motif}?）` : `（${it.motif}）`;
      chip.append(motif);
      parts.push(motif.textContent);
    }
    // ボス素材は素材名だけでは何を殴ればいいのか分からないので入手元を添える。
    // 天賦本の秘境も同じ枠だが、列では幅を食うので省く。
    const from = it.region ? `${it.region}・${it.domain ?? ''}`.replace(/・$/, '') : it.from;
    if (from) {
      parts.push(`← ${from}`);
      if (!compact) {
        const el = document.createElement('span');
        el.className = 'mat-from';
        el.textContent = from;
        el.title = it.entrance ? `入口: ${it.entrance}` : '';
        chip.append(document.createTextNode(' '), el);
      }
    }
    if (it.days?.length) {
      const days = it.days.map((d) => d.replace('曜', '')).join('・');
      parts.push(days);
      chip.append(document.createTextNode(` ${days}`));
      if (availableToday(it.days, new Date())) {
        chip.append(document.createTextNode(' '), badge('今日', true));
      }
    }
    // まとめ表示では、その素材が誰に必要なのかを添える。
    if (it.who?.length) {
      const who = document.createElement('span');
      who.className = 'mat-who';
      who.textContent = `（${it.who.join('・')}）`;
      chip.append(who);
      parts.push(who.textContent);
    }
    // 切れた場合に備えて、省いたぶんも含めた全文を tooltip に入れる。
    if (compact) chip.title = parts.join(' ');
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

  if (group.done) {
    const p = document.createElement('p');
    p.className = 'dlg-missing';
    p.textContent = '育成済みなので表示していません。';
    frag.append(p);
    return frag;
  }
  if (group.missing) {
    const p = document.createElement('p');
    p.className = 'dlg-missing';
    // 「素材が要らない」ではなく「genshin-db にデータが無い」。推測で埋めない。
    p.textContent = 'genshin-db にデータがありません。';
    frag.append(p);
    return frag;
  }
  for (const s of group.sections) frag.append(materialGroup(s.label, s.items, s.key));
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

  const done = doneFlags(character);
  const { ascension, talents, common } = describe(entry, done);
  body.append(materialBlock('突破素材', ascension));

  // 元素可変キャラは天賦素材が元素ごとに別物なので、元素ごとに節を分ける。
  for (const t of talents) {
    body.append(materialBlock(t.element ? `天賦素材（${t.element}）` : '天賦素材', t));
  }

  // 雑魚ドロップが突破と天賦で同じ場合だけ、まとめて一度だけ出す。
  if (common?.length) {
    body.append(materialBlock('共通', { missing: false, sections: [{ label: 'ドロップ元', items: common }] }));
  }

  const note = document.createElement('p');
  note.className = 'dlg-note';
  note.textContent = '秘境の曜日は端末の日付と 04:00 切り替わりで判定しています。';
  if (talents.length > 1) {
    note.textContent =
      `天賦素材は元素ごとに別の素材が必要です（${talents.map((t) => t.element).join('・')}）。` +
      ' ' + note.textContent;
  }
  body.append(note);

  dialog.showModal();
}

// --- 育成早見表 --------------------------------------------------------------
//
// 段階ごとの必要数は、素材の名前こそキャラで違うが「どのレアリティを何個」という
// 構造は全キャラ共通。名前を覚えていなくても「Lv.7 なら紫の天賦本が 4 つ」と
// 分かるように、種別とレアリティだけの表にしている。

function costTableEl(caption, section, data) {
  const frag = document.createDocumentFragment();
  const h = document.createElement("h4");
  h.textContent = caption;
  frag.append(h);

  if (!data.rows.length) {
    const p = document.createElement("p");
    p.className = "dlg-missing";
    p.textContent = "データがありません。";
    frag.append(p);
    return frag;
  }

  const columns = COST_COLUMNS[section];
  const table = document.createElement("table");
  table.className = "cost-table";

  const head = document.createElement("tr");
  for (const label of ["段階", ...columns.map(([, l]) => l), "モラ"]) {
    const th = document.createElement("th");
    th.textContent = label;
    head.append(th);
  }
  table.append(head);

  for (const row of data.rows) {
    const tr = document.createElement("tr");
    const stage = document.createElement("td");
    stage.textContent = row.label;
    tr.append(stage);

    for (const cell of row.cells) {
      const td = document.createElement("td");
      if (cell.count === 0) {
        td.className = "empty";
        td.textContent = "–";
      } else {
        // レアリティはゲーム内のアイテム背景と同じ色にする。名前より色のほうが
        // 「紫がいくつ」と数えやすい。
        const pill = document.createElement("span");
        pill.className = "rarity";
        if (cell.rarity) pill.dataset.rarity = String(cell.rarity);
        pill.textContent = String(cell.count);
        td.append(pill);
        const total = document.createElement("span");
        total.className = "cum";
        total.textContent = String(cell.total);
        td.append(total);
      }
      tr.append(td);
    }

    const mora = document.createElement("td");
    mora.className = "mora";
    mora.textContent = row.mora.toLocaleString("ja-JP");
    const cum = document.createElement("span");
    cum.className = "cum";
    cum.textContent = row.moraTotal.toLocaleString("ja-JP");
    mora.append(cum);
    tr.append(mora);
    table.append(tr);
  }

  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  wrap.append(table);
  frag.append(wrap);

  if (data.exceptions.length) {
    const p = document.createElement("p");
    p.className = "dlg-note";
    p.textContent = `${data.exceptions.join(" / ")} だけは必要数が違います。`;
    frag.append(p);
  }
  return frag;
}

async function openCosts() {
  await loadMaterials();
  const dialog = $("cost-dialog");
  const body = $("cost-body");
  body.replaceChildren();

  if (state.materialsError || !state.costs) {
    const p = document.createElement("p");
    p.className = "dlg-missing";
    p.textContent = state.materialsError ?? "早見表のデータを読み込めませんでした。";
    body.append(p);
    dialog.showModal();
    return;
  }

  const { ascension, talent } = costRows(state.costs);
  body.append(costTableEl("突破", "ascension", ascension));
  body.append(costTableEl("天賦（1 つあたり）", "talent", talent));

  const legend = document.createElement("div");
  legend.className = "legend";
  legend.append(document.createTextNode("レアリティ: "));
  for (const [r, label] of [[1, "白"], [2, "緑"], [3, "青"], [4, "紫"], [5, "金"]]) {
    const pill = document.createElement("span");
    pill.className = "rarity";
    pill.dataset.rarity = String(r);
    pill.textContent = label;
    legend.append(pill);
  }
  body.append(legend);

  const note = document.createElement("p");
  note.className = "dlg-note";
  const perTalent = talent.rows.at(-1)?.moraTotal ?? 0;
  note.textContent =
    `小さい数字はそこまでの累計です。戦闘天賦は 3 つあるので、すべて Lv.10 まで上げるなら` +
    ` 天賦だけで ${(perTalent * 3).toLocaleString("ja-JP")} モラ。全キャラ共通の値です。`;
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
  // 秒までは要らない。狭い画面ではその桁のぶんだけ見出しが 2 行になる。
  const when = saved.savedAt
    ? new Date(saved.savedAt).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
    : '';
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
  $('tagline').hidden = has;
  $('cancel-btn').hidden = true;
  for (const id of ['status-panel', 'filter-panel', 'team-panel', 'shelf-section']) {
    $(id).hidden = !has;
  }
  if (!has) {
    for (const id of ['shelf', 'team']) $(id).replaceChildren();
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
    progressStore.clear();
    state.team = [];
    state.progress = {};
    showRoster({ characters: [], format: null });
    $('input').value = '';
    showImport();
  });
  $('team-clear').addEventListener('click', () => {
    if (state.team.length === 0) return;
    const names = state.team.join(' / ');
    if (!confirm(`枠を空にします。よろしいですか？\n\n${names}`)) return;
    state.team = [];
    selectionStore.save(state.team);
    renderTeam();
    renderShelf();
  });
  // 並び順は絞り込みではないので、解除では触らない（見ている順を勝手に戻さない）
  $('reset-filter').addEventListener('click', () => {
    state.elements.clear();
    state.weapons.clear();
    state.hiddenBands.clear();
    renderFilters();
    renderShelf();
  });
  $('filter-details').open = uiStore.loadFilterOpen();
  $('filter-details').addEventListener('toggle', () => {
    uiStore.saveFilterOpen($('filter-details').open);
  });
  $('mat-close').addEventListener('click', () => $('mat-dialog').close());
  // 開いた瞬間に中身を作る。閉じている間はデータも読まない。
  $('picked-mats').addEventListener('toggle', () => {
    if ($('picked-mats').open) renderTeam();
  });
  $('cost-btn').addEventListener('click', openCosts);
  $('cost-close').addEventListener('click', () => $('cost-dialog').close());
  $('cost-dialog').addEventListener('click', (e) => {
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

  state.progress = progressStore.load();
  state.team = selectionStore.load().slice(0, TEAM_SIZE);

  const saved = store.load();
  if (saved) showRoster(saved);
  else showImport();

  registerServiceWorker();
}

/**
 * ホーム画面から起動できるようにし、電波が無いときも開けるようにする。
 *
 * 中身は network-first なので、繋がっている限り常に最新を見る（sw.js 参照）。
 * 一覧の描画が終わってから登録する。起動時の取得と競合させる意味がないため。
 *
 * 安全なオリジン（https と localhost）でないと登録は失敗する。file:// で開いた
 * 場合もここで例外になるが、通常の Web ページとしては動くので黙って見送る。
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* 登録できなくても本体の動作には影響しない */
  });
}

main();
