const CRM_BASE_URL = "https://crm.bank.ozon.ru";
const CHATZONE_BASE_URL = "https://chatzone.o3t.ru/ozon/messages/@";

let drillStore = new Map();
let assignedTooltipStore = new Map();
let activeDrawerDocs = [];
let activeDrawerMode = 'executors';
let selectedSlotIdx = null;
let cellSeq = 0;
let logsArray = [];

// Хранилище для дедлайнов и документов в работе (ASSIGNED)
let rawOverdueDocs = [];
let rawDueTodayDocs = [];
let rawAssignedDocs = [];
let filteredOverdueDocs = [];
let filteredDueTodayDocs = [];

// Состояние выбора документов и поиска операторов для назначения в двух аккордеонах
const ASSIGN_STATE = {
  Overdue: {
    selectedAlertIds: new Set(),
    selectedOperator: null, // { id, fullName, upn }
    searchResults: [],
    isAssigning: false,
    debounceTimer: null
  },
  DueToday: {
    selectedAlertIds: new Set(),
    selectedOperator: null, // { id, fullName, upn }
    searchResults: [],
    isAssigning: false,
    debounceTimer: null
  }
};

const OPERATOR_STATUS_MAP = {
  ONLINE: { label: 'Готов', cls: 'st-ONLINE' },
  BREAK: { label: 'Перерыв', cls: 'st-BREAK' },
  OFFLINE: { label: 'Не в сети', cls: 'st-OFFLINE' },
  POSTPROCESSING: { label: 'Постобработка', cls: 'st-POSTPROCESSING' },
  TRAINING: { label: 'Тренинг', cls: 'st-TRAINING' },
  UNKNOWN_STATUS: { label: 'Неизвестен', cls: 'st-UNKNOWN_STATUS' }
};

const TICKET_STATUS_MAP = {
  ACKNOWLEDGED: 'Просмотрен',
  ASSIGNED: 'В работе',
  CLOSED: 'Завершен',
  CREATED: 'В очереди',
  ON_HOLD: 'На удержании',
  TRANSFERRED_TO_DEVELOPMENT: 'Передано в разработку',
  WAITING_FOR_CUSTOMER: 'Ожидает ответа от клиента'
};

function formatTicketStatusRu(rawStatus) {
  if (!rawStatus) return '—';
  return TICKET_STATUS_MAP[rawStatus] || rawStatus;
}

function formatOperatorHtml(d, includeGroup = true) {
  const label = getOperatorLabel(d);
  const grp = getOperatorGroup(d);
  if (label === 'Не назначен') {
    const grpPart = includeGroup ? ` <span style="color:var(--o3-text-sec); font-weight:400;">(${grp})</span>` : '';
    return `<span style="color:var(--o3-red); font-weight:700;">🚨 Не назначен</span>${grpPart}`;
  }
  return includeGroup ? `${label} (${grp})` : label;
}

const CHECK_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6.5 11.5L2.5 7.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const COPY_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="8.5" height="8.5" rx="1.8" fill="currentColor"/><path d="M6 13.2H11.4C12.3941 13.2 13.2 12.3941 13.2 11.4V6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const CHATZONE_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2.5C4.686 2.5 2 4.79 2 7.62C2 9.15 2.785 10.525 4.03 11.46L3.45 13.65L6.03 12.48C6.655 12.65 7.315 12.74 8 12.74C11.314 12.74 14 10.45 14 7.62C14 4.79 11.314 2.5 8 2.5Z" stroke="currentColor" stroke-width="1.65" stroke-linejoin="round"/></svg>`;

// Инжектируем стили для колонки "В работе" и всплывающего тултипа при наведении
(function injectAssignedStyles() {
  const st = document.createElement('style');
  st.textContent = `
    th.assigned-col { background: rgba(245, 158, 11, 0.12) !important; color: var(--o3-amber, #D97706) !important; }
    .cell-btn.assigned-btn { background: rgba(245, 158, 11, 0.15); color: var(--o3-amber, #D97706); }
    .cell-btn.assigned-btn:hover { background: var(--o3-amber, #D97706); color: #fff; }
    .assigned-floating-tooltip {
      position: fixed; z-index: 9999; pointer-events: none;
      background: var(--o3-surface-elevated, #1B1E23); color: var(--o3-text, #fff);
      border: 1px solid var(--o3-border, #343942); border-radius: 12px;
      padding: 10px 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.28);
      max-width: 380px; font-size: 11.5px; display: none;
    }
    .aft-title { font-weight: 700; font-size: 12px; margin-bottom: 6px; padding-bottom: 5px; border-bottom: 1px solid var(--o3-border-light); color: var(--o3-amber, #D97706); }
    .aft-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 3px 0; border-bottom: 1px dashed var(--o3-border-light); }
    .aft-row:last-child { border-bottom: none; }
    .aft-type { font-weight: 600; color: var(--o3-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .aft-doc { color: var(--o3-text-sec); font-size: 11px; margin-left: 4px; }
    .aft-dur { font-weight: 700; color: var(--o3-blue); white-space: nowrap; font-size: 11px; }
  `;
  document.head.appendChild(st);

  const tt = document.createElement('div');
  tt.id = 'assignedFloatingTooltip';
  tt.className = 'assigned-floating-tooltip';
  document.body.appendChild(tt);
})();

function buildPersonActionButtonsHtml(upn) {
  if (!upn) return '';
  const cleanUpn = String(upn).trim();
  const username = cleanUpn.split('@')[0].trim();
  if (!username) return '';

  const safeUpn = cleanUpn.replace(/"/g, '&quot;');
  const chatUrl = `${CHATZONE_BASE_URL}${encodeURIComponent(username)}`;

  return `<span class="op-actions">
    <button type="button" class="icon-action-btn" data-copy-upn="${safeUpn}" title="Скопировать логин: ${safeUpn}">${COPY_ICON_SVG}</button>
    <a class="icon-action-btn" href="${chatUrl}" target="_blank" data-chatzone-link="1" title="Написать в Chatzone (@${username})">${CHATZONE_ICON_SVG}</a>
  </span>`;
}

// === УПРАВЛЕНИЕ ШИРИНОЙ ПЕРВОГО СТОЛБЦА МЫШКОЙ ===
function initFirstColWidth() {
  const savedW = localStorage.getItem('o3_sed_first_col_w');
  if (savedW) {
    document.documentElement.style.setProperty('--first-col-width', `${savedW}px`);
  }
}

document.addEventListener('mousedown', (e) => {
  const handle = e.target.closest('.col-resizer');
  if (!handle) return;
  e.preventDefault();
  e.stopPropagation();

  const th = handle.parentElement;
  const startX = e.clientX;
  const startWidth = th.getBoundingClientRect().width;
  handle.classList.add('resizing');

  function onMouseMove(ev) {
    const newWidth = Math.max(190, Math.min(720, Math.round(startWidth + (ev.clientX - startX))));
    document.documentElement.style.setProperty('--first-col-width', `${newWidth}px`);
    localStorage.setItem('o3_sed_first_col_w', String(newWidth));
  }

  function onMouseUp() {
    handle.classList.remove('resizing');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
});

document.addEventListener('click', (e) => {
  const chatLink = e.target.closest('[data-chatzone-link]');
  if (chatLink) {
    e.stopPropagation();
    return;
  }

  const copyBtn = e.target.closest('[data-copy-upn]');
  if (copyBtn) {
    e.preventDefault();
    e.stopPropagation();
    const upn = copyBtn.getAttribute('data-copy-upn');
    navigator.clipboard.writeText(upn).then(() => {
      copyBtn.classList.add('copied');
      copyBtn.innerHTML = CHECK_SVG;
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = COPY_ICON_SVG;
      }, 1100);
    });
  }
});

// === ВСПЛЫВАЮЩИЙ ТУЛТИП ПРИ НАВЕДЕНИИ НА ЯЧЕЙКУ "В РАБОТЕ (ASSIGNED)" ===
document.addEventListener('mouseover', (e) => {
  const btn = e.target.closest('[data-assigned-tip]');
  const tt = document.getElementById('assignedFloatingTooltip');
  if (!tt) return;

  if (!btn) {
    tt.style.display = 'none';
    return;
  }

  const key = btn.getAttribute('data-assigned-tip');
  const docs = assignedTooltipStore.get(key);
  if (!docs || !docs.length) {
    tt.style.display = 'none';
    return;
  }

  const refNow = STATE.executors.fetchedAt || new Date().toISOString();
  const sorted = [...docs].sort((a, b) => new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0));
  const maxShow = 18;
  const shown = sorted.slice(0, maxShow);

  let html = `<div class="aft-title">В работе (ASSIGNED): ${docs.length} док. (время с посл. апдейта)</div>`;
  html += shown.map(d => {
    const dur = formatStatusDuration(d.updatedAt || d.createdAt, refNow) || 'только что';
    const typeName = getDocType(d);
    const docNum = d.documentName || '';
    return `<div class="aft-row">
      <div class="aft-type">${typeName}<span class="aft-doc">${docNum ? `(${docNum})` : ''}</span></div>
      <div class="aft-dur">⏱ ${dur}</div>
    </div>`;
  }).join('');

  if (docs.length > maxShow) {
    html += `<div style="margin-top:4px; font-size:10.5px; color:var(--o3-text-sec);">...и еще ${docs.length - maxShow} док. (нажмите для полного списка)</div>`;
  }

  tt.innerHTML = html;
  tt.style.display = 'block';
});

document.addEventListener('mousemove', (e) => {
  const tt = document.getElementById('assignedFloatingTooltip');
  if (!tt || tt.style.display !== 'block') return;
  const pad = 14;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  const rect = tt.getBoundingClientRect();
  if (x + rect.width > window.innerWidth - 10) x = Math.max(10, e.clientX - rect.width - pad);
  if (y + rect.height > window.innerHeight - 10) y = Math.max(10, e.clientY - rect.height - pad);
  tt.style.left = `${x}px`;
  tt.style.top = `${y}px`;
});

// === ТЁМНАЯ И СВЕТЛАЯ ТЕМА ===
function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('o3_sed_theme', theme);
  const btn = document.getElementById('btnThemeToggle');
  if (btn) {
    btn.innerText = theme === 'dark' ? '☀️ Светлая' : '🌙 Тёмная';
  }
}

document.getElementById('btnThemeToggle').onclick = () => {
  const cur = document.body.getAttribute('data-theme') || 'light';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
};

// === КАСТОМНЫЕ МУЛЬТИСЕЛЕКТ-ФИЛЬТРЫ ===
const multiSelectRegistry = new Map();

function initMultiSelect(containerId, labelText, placeholderText, onChange) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const state = {
    containerId,
    labelText,
    placeholderText,
    options: [],
    selected: new Set(),
    onChange
  };
  multiSelectRegistry.set(containerId, state);

  el.innerHTML = `
    <div class="o3-field-label">${labelText}</div>
    <div class="o3-field-value" style="color:var(--o3-text-sec);">${placeholderText}</div>
    <span class="o3-field-arrow">▼</span>
    <div class="o3-dropdown">
      <div class="o3-dd-search-wrap">
        <input type="text" class="o3-dd-search" placeholder="Поиск...">
      </div>
      <div class="o3-dd-list"></div>
    </div>
  `;

  const searchInput = el.querySelector('.o3-dd-search');
  const dropdown = el.querySelector('.o3-dropdown');

  renderMultiSelectOptions(state, '');

  el.addEventListener('click', (e) => {
    if (e.target.closest('.o3-dropdown')) return;
    const wasOpen = el.classList.contains('open');
    closeAllMultiSelects();
    if (!wasOpen) {
      el.classList.add('open');
      if (searchInput) {
        searchInput.value = '';
        renderMultiSelectOptions(state, '');
        setTimeout(() => searchInput.focus(), 20);
      }
    }
  });

  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('.o3-dd-item');
    if (!item) return;
    const val = item.getAttribute('data-val');
    if (val === '__CLEAR_ALL__') {
      state.selected.clear();
    } else {
      if (state.selected.has(val)) state.selected.delete(val);
      else state.selected.add(val);
    }
    updateMultiSelectHeader(state);
    renderMultiSelectOptions(state, searchInput ? searchInput.value : '');
    if (state.onChange) state.onChange();
  });

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderMultiSelectOptions(state, e.target.value);
    });
  }
}

function setMultiSelectOptions(containerId, items, customLabels = {}) {
  const state = multiSelectRegistry.get(containerId);
  if (!state) return;

  state.options = items.map(v => ({
    value: String(v),
    label: customLabels[v] || String(v)
  }));

  const validValues = new Set(state.options.map(o => o.value));
  Array.from(state.selected).forEach(val => {
    if (!validValues.has(val)) state.selected.delete(val);
  });

  updateMultiSelectHeader(state);
  renderMultiSelectOptions(state, '');
}

function updateMultiSelectHeader(state) {
  const el = document.getElementById(state.containerId);
  if (!el) return;
  const valEl = el.querySelector('.o3-field-value');
  if (state.selected.size === 0) {
    valEl.textContent = state.placeholderText;
    valEl.style.color = 'var(--o3-text-sec)';
  } else {
    const labels = state.options
      .filter(o => state.selected.has(o.value))
      .map(o => o.label);
    valEl.textContent = labels.join(', ');
    valEl.style.color = 'var(--o3-text)';
  }
}

function renderMultiSelectOptions(state, searchQuery) {
  const el = document.getElementById(state.containerId);
  if (!el) return;
  const listEl = el.querySelector('.o3-dd-list');
  const q = (searchQuery || '').trim().toLowerCase();

  const filtered = state.options.filter(o => !q || o.label.toLowerCase().includes(q));

  let html = `<div class="o3-dd-item ${state.selected.size === 0 ? 'selected' : ''}" data-val="__CLEAR_ALL__">
    <span class="o3-dd-item-text">${state.placeholderText}</span>
    <span class="o3-dd-check">${CHECK_SVG}</span>
  </div>`;

  html += filtered.map(o => {
    const isSel = state.selected.has(o.value);
    return `<div class="o3-dd-item ${isSel ? 'selected' : ''}" data-val="${o.value.replace(/"/g, '&quot;')}">
      <span class="o3-dd-item-text" title="${o.label.replace(/"/g, '&quot;')}">${o.label}</span>
      <span class="o3-dd-check">${CHECK_SVG}</span>
    </div>`;
  }).join('');

  listEl.innerHTML = html;
}

function getMultiSelectValues(containerId) {
  const st = multiSelectRegistry.get(containerId);
  return st ? st.selected : new Set();
}

function resetMultiSelect(containerId) {
  const st = multiSelectRegistry.get(containerId);
  if (!st) return;
  st.selected.clear();
  updateMultiSelectHeader(st);
  renderMultiSelectOptions(st, '');
}

function closeAllMultiSelects() {
  document.querySelectorAll('.o3-field.open').forEach(el => el.classList.remove('open'));
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.o3-field')) {
    closeAllMultiSelects();
  }
  if (!e.target.closest('.op-picker-wrap')) {
    document.querySelectorAll('.op-picker-dd.open').forEach(el => el.classList.remove('open'));
  }
});

// === ЛОГИРОВАНИЕ ===
function addLog(level, message, details = null, customTime = null) {
  const timeStr = customTime || (new Date().toLocaleTimeString('ru-RU', { hour12: false }) + '.' + String(new Date().getMilliseconds()).padStart(3, '0'));
  logsArray.push({ time: timeStr, level, message, details });

  const listEl = document.getElementById('logList');
  const countEl = document.getElementById('logCount');
  const accEl = document.getElementById('logAccordion');

  if (countEl) countEl.innerText = logsArray.length;

  if (listEl) {
    const item = document.createElement('div');
    item.className = 'log-entry';
    const lvlClass = `log-${level}`;
    let html = `<span class="log-time">[${timeStr}]</span><span class="${lvlClass}">${message}</span>`;
    if (details) {
      const safeDetails = String(details).replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html += `<div class="log-details">${safeDetails}</div>`;
    }
    item.innerHTML = html;
    listEl.appendChild(item);
    listEl.scrollTop = listEl.scrollHeight;
  }

  if (level === 'error' && accEl) {
    accEl.classList.add('has-error');
    accEl.open = true;
  }
}

document.getElementById('btnClearLogs').onclick = (e) => {
  e.preventDefault();
  e.stopPropagation();
  logsArray = [];
  document.getElementById('logList').innerHTML = '';
  document.getElementById('logCount').innerText = '0';
  document.getElementById('logAccordion').classList.remove('has-error');
};

document.getElementById('btnCopyLogs').onclick = (e) => {
  e.preventDefault();
  e.stopPropagation();
  const text = logsArray.map(l => `[${l.time}] [${l.level.toUpperCase()}] ${l.message}${l.details ? '\n  -> ' + l.details : ''}`).join('\n');
  navigator.clipboard.writeText(text || 'Логи пусты').then(() => alert('Логи скопированы в буфер обмена!'));
};

const STATE = {
  executors: {
    prefix: 'ex',
    mode: 'executors',
    roleTitle: 'Исполнитель',
    dateColName: 'Дата_Закрытия',
    docs: [],
    fetchedAt: null,
    collapsedGroups: new Set(),
    expandedUsers: new Set(),
    allUsersExpanded: false,
    isMarksExpanded: true,
    lastExportRows: [],
    hasLoadedOnce: false
  },
  registrars: {
    prefix: 'rg',
    mode: 'registrars',
    roleTitle: 'Регистратор',
    dateColName: 'Дата_Создания',
    docs: [],
    fetchedAt: null,
    collapsedGroups: new Set(),
    expandedUsers: new Set(),
    allUsersExpanded: false,
    isMarksExpanded: true,
    lastExportRows: [],
    hasLoadedOnce: false
  }
};

function formatYMDToRu(ymd) {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}

function formatDateTimeRu(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return String(isoStr);
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTimeWithSecRu(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return String(isoStr);
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatTimeHMS(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) return '—';
  return dateObj.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatStatusDuration(setAtIso, referenceIso) {
  if (!setAtIso) return '';
  const start = new Date(setAtIso);
  const end = referenceIso ? new Date(referenceIso) : new Date();
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';

  const diffSec = Math.max(0, Math.floor((end - start) / 1000));
  if (diffSec < 60) return `${diffSec} сек`;
  const totalMins = Math.floor(diffSec / 60);
  if (totalMins < 60) return `${totalMins} мин`;
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs < 24) return mins > 0 ? `${hrs} ч ${mins} м` : `${hrs} ч`;
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return remHrs > 0 ? `${days} д ${remHrs} ч` : `${days} д`;
}

function getPersonStatusRender(statusInfo, fetchedAtIso, personLabel) {
  if (!personLabel || personLabel === 'Не назначен' || personLabel === 'Не указан') {
    return { html: '', text: '' };
  }
  const rawSt = (statusInfo && statusInfo.status) ? statusInfo.status : 'UNKNOWN_STATUS';
  const meta = OPERATOR_STATUS_MAP[rawSt] || OPERATOR_STATUS_MAP.UNKNOWN_STATUS;
  const dur = formatStatusDuration(statusInfo && statusInfo.setAt, fetchedAtIso);
  const durPart = dur ? ` <span class="op-status-dur">· ${dur}</span>` : '';
  const sinceTitle = (statusInfo && statusInfo.setAt)
    ? `Установлен: ${formatDateTimeWithSecRu(statusInfo.setAt)}`
    : 'Время установки статуса не найдено';

  const html = `<span class="op-status-badge ${meta.cls}" title="Статус: ${meta.label} (${sinceTitle})"><span class="op-status-dot"></span>${meta.label}${durPart}</span>`;
  const text = dur ? `${meta.label} (${dur})` : meta.label;
  return { html, text };
}

function getDocActivityDate(d, mode) {
  const t = d.ticket || {};
  const rawIso = (mode === 'registrars') ? d.createdAt : (t.closedAt || d.updatedAt || d.createdAt);
  if (!rawIso) return null;
  const dt = new Date(rawIso);
  return isNaN(dt.getTime()) ? null : dt;
}

function getDocSlotIndex(d, mode) {
  const dt = getDocActivityDate(d, mode);
  if (!dt) return -1;
  return dt.getHours() * 4 + Math.floor(dt.getMinutes() / 15);
}

function formatSlotRange(slotIdx) {
  const startMin = slotIdx * 15;
  const endMin = startMin + 15;
  const h1 = String(Math.floor(startMin / 60)).padStart(2, '0');
  const m1 = String(startMin % 60).padStart(2, '0');
  const h2 = String(Math.floor(endMin / 60) % 24).padStart(2, '0');
  const m2 = String(endMin % 60).padStart(2, '0');
  return `${h1}:${m1}–${h2}:${m2}`;
}

function formatHeadingRu(h) {
  if (h === 'INCOMING') return 'Входящий';
  if (h === 'OUTGOING') return 'Исходящий';
  return h || '—';
}

function getLegalEntity(d) {
  const name = String(d.documentName || '').trim();
  const dashIdx = name.indexOf('-');
  if (dashIdx > 0) {
    return name.slice(0, dashIdx).trim().toUpperCase();
  }
  return 'Без префикса';
}

function getOperatorLabel(d) {
  const t = d.ticket || {};
  const opInfo = d.operatorInfo || {};
  const upn = (t.operator && t.operator.upn) || '';
  if (!upn) return 'Не назначен';
  return opInfo.fullName ? `${opInfo.fullName} (${upn})` : upn;
}

function getOperatorUpn(d) {
  const t = d.ticket || {};
  return (t.operator && t.operator.upn) || '';
}

function getOperatorGroup(d) {
  return (d.operatorInfo && d.operatorInfo.groupName) || 'Без группы';
}

function getCreatorLabel(d) {
  const t = d.ticket || {};
  const crInfo = d.creatorInfo || {};
  const upn = t.creator || '';
  if (!upn) return 'Не указан';
  return crInfo.fullName ? `${crInfo.fullName} (${upn})` : upn;
}

function getCreatorUpn(d) {
  const t = d.ticket || {};
  return t.creator || '';
}

function getCreatorGroup(d) {
  return (d.creatorInfo && d.creatorInfo.groupName) || 'Без группы';
}

function getPersonByMode(d, mode) {
  return mode === 'registrars' ? getCreatorLabel(d) : getOperatorLabel(d);
}

function getPersonUpnByMode(d, mode) {
  return mode === 'registrars' ? getCreatorUpn(d) : getOperatorUpn(d);
}

function getGroupByMode(d, mode) {
  return mode === 'registrars' ? getCreatorGroup(d) : getOperatorGroup(d);
}

function getPersonStatusInfoByMode(d, mode) {
  const info = mode === 'registrars' ? d.creatorInfo : d.operatorInfo;
  if (!info) return { status: 'UNKNOWN_STATUS', setAt: null };
  return { status: info.currentStatus || 'UNKNOWN_STATUS', setAt: info.statusSetAt || null };
}

function getDocType(d) {
  return d.documentTypeName || 'Не указан';
}

function getQueueName(d) {
  const t = d.ticket || {};
  return (t.queue && t.queue.name) || 'Без очереди';
}

function getMarksArray(d) {
  const marks = Array.isArray(d.ticketMarks) ? d.ticketMarks : [];
  return marks.map(m => m && m.name).filter(Boolean);
}

function showSkeleton(prefix, show) {
  document.getElementById(`${prefix}Skeleton`).style.display = show ? 'block' : 'none';
  document.getElementById(`${prefix}Table`).style.display = show ? 'none' : 'table';
}

function setProgress(prefix, active, text = '') {
  const bar = document.getElementById(`${prefix}ProgressBar`);
  bar.classList.toggle('active', active);
  if (text) document.getElementById(`${prefix}ProgressText`).innerText = text;
}

async function findSedTab() {
  const sedTabs = await chrome.tabs.query({ url: "https://crm.bank.ozon.ru/*" });
  if (sedTabs && sedTabs.length > 0) return sedTabs[0];
  const allTabs = await chrome.tabs.query({});
  return allTabs.find(t => t.url && t.url.startsWith("https://crm.bank.ozon.ru/")) || null;
}

async function ensureConnectionAndSend(tabId, messagePayload) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['bridge.js'],
      world: 'ISOLATED'
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['injector.js'],
      world: 'MAIN'
    });
    await new Promise(r => setTimeout(r, 60));
  } catch (err) {
    addLog('warn', `Предупреждение при обновлении скрипта в tabId=${tabId}: ${err.message}`);
  }
  return chrome.tabs.sendMessage(tabId, messagePayload);
}

async function fetchWidgetData(mode) {
  const st = STATE[mode];
  const p = st.prefix;
  const dateYMD = document.getElementById(`${p}Date`).value;
  if (!dateYMD) return;

  document.getElementById(`${p}SysDate`).innerText = formatYMDToRu(dateYMD);
  showSkeleton(p, true);
  setProgress(p, true, `Подключение к crm.bank.ozon.ru и запрос документов за ${formatYMDToRu(dateYMD)}...`);

  addLog('info', `Запуск обновления виджета [${mode}] за дату ${dateYMD}`);

  const tab = await findSedTab();
  if (!tab) {
    showSkeleton(p, false);
    const msg = 'Не найдена открытая вкладка https://crm.bank.ozon.ru/! Откройте СЭД в браузере и нажмите «Обновить».';
    setProgress(p, true, msg);
    addLog('error', msg);
    return;
  }

  try {
    await ensureConnectionAndSend(tab.id, {
      target: 'INJECTOR',
      type: 'FETCH_DATE',
      payload: { dateYMD, mode }
    });
  } catch (e) {
    showSkeleton(p, false);
    setProgress(p, true, 'Ошибка связи со вкладкой СЭД: ' + e.message);
    addLog('error', 'Ошибка при отправке команды FETCH_DATE', e.stack || e.message);
  }
}

// === ФИЛЬТРАЦИЯ ДЛЯ АККОРДЕОНОВ И СТОЛБЦА "В РАБОТЕ (ASSIGNED)" ===
function filterAlertDocsByExecutorsUI(docs) {
  const p = 'ex';
  const selEntities = getMultiSelectValues(`${p}WrapEntity`);
  const selHeadings = getMultiSelectValues(`${p}WrapHeading`);
  const selDocTypes = getMultiSelectValues(`${p}WrapDocType`);
  const selGroups = getMultiSelectValues(`${p}WrapGroup`);
  const selPersons = getMultiSelectValues(`${p}WrapPerson`);
  const selQueues = getMultiSelectValues(`${p}WrapQueue`);
  const selMarks = getMultiSelectValues(`${p}WrapMark`);

  return (docs || []).filter(d => {
    if (selEntities.size > 0 && !selEntities.has(getLegalEntity(d))) return false;
    if (selHeadings.size > 0 && !selHeadings.has(d.heading || '')) return false;
    if (selDocTypes.size > 0 && !selDocTypes.has(getDocType(d))) return false;
    if (selGroups.size > 0 && !selGroups.has(getOperatorGroup(d))) return false;
    if (selPersons.size > 0 && !selPersons.has(getOperatorLabel(d))) return false;
    if (selQueues.size > 0 && !selQueues.has(getQueueName(d))) return false;

    if (selMarks.size > 0) {
      const mks = getMarksArray(d);
      let markMatched = false;
      if (selMarks.has('__ANY__') && mks.length > 0) markMatched = true;
      if (selMarks.has('__NONE__') && mks.length === 0) markMatched = true;
      if (mks.some(m => selMarks.has(m))) markMatched = true;
      if (!markMatched) return false;
    }
    return true;
  });
}

// === ЛОГИКА ВЫБОРА ДОКУМЕНТОВ И НАЗНАЧЕНИЯ ОПЕРАТОРА В АККОРДЕОНАХ ===
function getSectionFilteredDocs(section) {
  return section === 'Overdue' ? filteredOverdueDocs : filteredDueTodayDocs;
}

function updateAssignToolbarState(section) {
  const st = ASSIGN_STATE[section];
  if (!st) return;

  const docs = getSectionFilteredDocs(section);
  const validAlertIds = new Set(docs.map(d => Number(d.ticket && d.ticket.id)).filter(Boolean));

  // Очищаем чекбоксы документов, которые скрыты текущими фильтрами
  Array.from(st.selectedAlertIds).forEach(id => {
    if (!validAlertIds.has(id)) st.selectedAlertIds.delete(id);
  });

  const selCountEl = document.getElementById(`selCount${section}`);
  if (selCountEl) selCountEl.innerText = st.selectedAlertIds.size;

  const chkAllEl = document.getElementById(`chkAll${section}`);
  if (chkAllEl) {
    chkAllEl.checked = validAlertIds.size > 0 && st.selectedAlertIds.size === validAlertIds.size;
    chkAllEl.indeterminate = st.selectedAlertIds.size > 0 && st.selectedAlertIds.size < validAlertIds.size;
  }

  const btnAssignEl = document.getElementById(`btnAssign${section}`);
  if (btnAssignEl) {
    const canAssign = !st.isAssigning && st.selectedOperator && st.selectedAlertIds.size > 0;
    btnAssignEl.disabled = !canAssign;
    btnAssignEl.innerText = st.isAssigning
      ? 'Назначение...'
      : (st.selectedAlertIds.size > 0 ? `Назначить (${st.selectedAlertIds.size})` : 'Назначить');
  }
}

function renderDeadlineCardsList(docs, section) {
  if (!docs || docs.length === 0) {
    return `<div style="padding:14px; color:var(--o3-text-sec);">Документов не найдено.</div>`;
  }
  const st = ASSIGN_STATE[section];
  const sorted = [...docs].sort((a, b) => new Date(a.deadline || 0) - new Date(b.deadline || 0));

  return sorted.map(d => {
    const t = d.ticket || {};
    const alertId = Number(t.id || 0);
    const isChecked = st && alertId && st.selectedAlertIds.has(alertId);
    const corr = d.correspondent || {};
    const docTitle = d.documentName || d.id;
    const docUrl = `${CRM_BASE_URL}/sed/document/${encodeURIComponent(d.id)}`;
    const marksHtml = getMarksArray(d).map(m => `<span class="mark-pill">${m}</span>`).join('');
    const dirClass = d.heading === 'INCOMING' ? 'dir-INCOMING' : 'dir-OUTGOING';

    const creatorActions = buildPersonActionButtonsHtml(getCreatorUpn(d));
    const operatorActions = buildPersonActionButtonsHtml(getOperatorUpn(d));

    return `<div class="doc-card ${isChecked ? 'selected-doc' : ''}" data-card-alert-id="${alertId}">
      <div class="doc-top">
        <div style="display:flex; align-items:center; gap:7px;">
          ${alertId ? `<input type="checkbox" class="doc-check-input" data-doc-check="${section}" data-alert-id="${alertId}" ${isChecked ? 'checked' : ''} title="Выбрать для назначения оператора">` : ''}
          <a href="${docUrl}" target="_blank" title="Открыть карточку документа в СЭД">📄 ${docTitle} ↗</a>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          ${alertId ? `<button type="button" class="btn-single-assign" data-single-assign="${section}" data-alert-id="${alertId}" title="Назначить этот документ на выбранного сверху оператора">⚡ Назначить</button>` : ''}
          <span class="dir-badge ${dirClass}">${formatHeadingRu(d.heading)} · ЮЛ: ${getLegalEntity(d)} · ${formatTicketStatusRu(t.status)}</span>
        </div>
      </div>
      <div class="doc-meta">
        <div><strong>Дедлайн:</strong> <span style="color:var(--o3-red);font-weight:700;">${formatDateTimeRu(d.deadline)}</span> · <strong>Создан:</strong> ${formatDateTimeRu(d.createdAt)}</div>
        <div><strong>Тип:</strong> ${getDocType(d)} · <strong>Очередь:</strong> ${getQueueName(d)} · <strong>Ticket ID:</strong> ${t.id || '—'}</div>
        <div><strong>Исполнитель:</strong> ${formatOperatorHtml(d)}${operatorActions}</div>
        <div><strong>Регистратор:</strong> ${getCreatorLabel(d)} (${getCreatorGroup(d)})${creatorActions}</div>
        ${corr.fullName ? `<div><strong>Корреспондент:</strong> ${corr.fullName}</div>` : ''}
        ${marksHtml ? `<div>${marksHtml}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderDeadlineAccordions() {
  filteredOverdueDocs = filterAlertDocsByExecutorsUI(rawOverdueDocs);
  filteredDueTodayDocs = filterAlertDocsByExecutorsUI(rawDueTodayDocs);

  const bOver = document.getElementById('badgeOverdueCount');
  const bToday = document.getElementById('badgeDueTodayCount');
  if (bOver) bOver.innerText = filteredOverdueDocs.length;
  if (bToday) bToday.innerText = filteredDueTodayDocs.length;

  const lOver = document.getElementById('listOverdue');
  const lToday = document.getElementById('listDueToday');
  if (lOver) lOver.innerHTML = renderDeadlineCardsList(filteredOverdueDocs, 'Overdue');
  if (lToday) lToday.innerHTML = renderDeadlineCardsList(filteredDueTodayDocs, 'DueToday');

  updateAssignToolbarState('Overdue');
  updateAssignToolbarState('DueToday');
}

async function requestOperatorsSearch(section, queryText) {
  const ddEl = document.getElementById(`opDd${section}`);
  if (ddEl) {
    ddEl.innerHTML = `<div class="op-dd-empty">Поиск операторов в СЭД...</div>`;
    ddEl.classList.add('open');
  }

  const tab = await findSedTab();
  if (!tab) {
    if (ddEl) ddEl.innerHTML = `<div class="op-dd-empty" style="color:var(--o3-red);">Откройте вкладку crm.bank.ozon.ru</div>`;
    return;
  }

  try {
    await ensureConnectionAndSend(tab.id, {
      target: 'INJECTOR',
      type: 'SEARCH_OPERATORS',
      payload: { section, query: queryText }
    });
  } catch (err) {
    if (ddEl) ddEl.innerHTML = `<div class="op-dd-empty" style="color:var(--o3-red);">Ошибка: ${err.message}</div>`;
  }
}

function renderOperatorDropdownItems(section, items) {
  const st = ASSIGN_STATE[section];
  if (!st) return;
  st.searchResults = items || [];

  const ddEl = document.getElementById(`opDd${section}`);
  if (!ddEl) return;

  if (!items || items.length === 0) {
    ddEl.innerHTML = `<div class="op-dd-empty">Операторы не найдены</div>`;
    ddEl.classList.add('open');
    return;
  }

  ddEl.innerHTML = items.map(op => {
    const isSel = st.selectedOperator && Number(st.selectedOperator.id) === Number(op.id);
    const safeName = String(op.fullName || '').replace(/"/g, '&quot;');
    const safeUpn = String(op.upn || '').replace(/"/g, '&quot;');
    return `<div class="op-dd-option ${isSel ? 'active' : ''}" data-op-id="${op.id}" data-op-name="${safeName}" data-op-upn="${safeUpn}">
      <span class="op-dd-name">${op.fullName || op.upn}</span>
      <span class="op-dd-upn">${op.upn} · ID: ${op.id}</span>
    </div>`;
  }).join('');
  ddEl.classList.add('open');
}

function selectAssignOperator(section, op) {
  const st = ASSIGN_STATE[section];
  if (!st) return;
  st.selectedOperator = op;

  const inputEl = document.getElementById(`opInput${section}`);
  const clearEl = document.getElementById(`opClear${section}`);
  const ddEl = document.getElementById(`opDd${section}`);

  if (inputEl) {
    inputEl.value = op ? `${op.fullName} (${op.upn})` : '';
    inputEl.classList.toggle('has-selected', Boolean(op));
  }
  if (clearEl) {
    clearEl.style.display = op ? 'block' : 'none';
  }
  if (ddEl) {
    ddEl.classList.remove('open');
  }

  updateAssignToolbarState(section);
}

function setAssignStatusLine(section, text, color = 'var(--o3-blue)') {
  const el = document.getElementById(`assignStatus${section}`);
  if (!el) return;
  if (!text) {
    el.classList.remove('visible');
    el.innerHTML = '';
    return;
  }
  el.style.color = color;
  el.innerHTML = `<span>${text}</span>`;
  el.classList.add('visible');
}

async function triggerAssignTickets(section, customAlertIds = null) {
  const st = ASSIGN_STATE[section];
  if (!st || st.isAssigning) return;

  if (!st.selectedOperator || !st.selectedOperator.id) {
    alert('Сначала найдите и выберите оператора из выпадающего списка сверху!');
    const inp = document.getElementById(`opInput${section}`);
    if (inp) inp.focus();
    return;
  }

  const alertIds = customAlertIds || Array.from(st.selectedAlertIds);
  if (!alertIds.length) {
    alert('Отметьте галочками хотя бы один документ для назначения!');
    return;
  }

  const tab = await findSedTab();
  if (!tab) {
    alert('Не найдена открытая вкладка https://crm.bank.ozon.ru/!');
    return;
  }

  st.isAssigning = true;
  updateAssignToolbarState(section);
  setAssignStatusLine(section, `⏳ Назначение 0 из ${alertIds.length} док. на ${st.selectedOperator.fullName}...`);

  try {
    await ensureConnectionAndSend(tab.id, {
      target: 'INJECTOR',
      type: 'ASSIGN_TICKETS',
      payload: {
        section,
        alertIds,
        operator: st.selectedOperator
      }
    });
  } catch (err) {
    st.isAssigning = false;
    updateAssignToolbarState(section);
    setAssignStatusLine(section, `❌ Ошибка отправки команды: ${err.message}`, 'var(--o3-red)');
  }
}

function applyLocalTicketAssignment(alertIds, operator, operatorInfo) {
  const idSet = new Set((alertIds || []).map(Number));
  if (!idSet.size || !operator) return;

  const nowIso = new Date().toISOString();
  const fallbackInfo = operatorInfo || {
    operatorId: Number(operator.id),
    fullName: operator.fullName || '',
    groupId: '',
    groupName: 'Без группы',
    currentStatus: 'UNKNOWN_STATUS',
    statusSetAt: null
  };

  const updateDoc = (d) => {
    const t = d.ticket || {};
    const tid = Number(t.id);
    if (!tid || !idSet.has(tid)) return false;

    t.operator = {
      id: Number(operator.id),
      upn: operator.upn
    };
    t.status = 'ASSIGNED';
    d.updatedAt = nowIso;
    d.operatorInfo = {
      ...fallbackInfo,
      fullName: fallbackInfo.fullName || operator.fullName || ''
    };
    return true;
  };

  const newlyAssignedDocs = [];

  [rawOverdueDocs, rawDueTodayDocs].forEach(arr => {
    arr.forEach(d => {
      if (updateDoc(d)) {
        newlyAssignedDocs.push(d);
      }
    });
  });

  // Обновляем или добавляем назначенные документы в список rawAssignedDocs (столбец "В работе (ASSIGNED)")
  const existingAssignedMap = new Map();
  rawAssignedDocs.forEach(d => {
    if (d && d.id) existingAssignedMap.set(d.id, d);
    updateDoc(d);
  });

  newlyAssignedDocs.forEach(d => {
    if (d && d.id && !existingAssignedMap.has(d.id)) {
      rawAssignedDocs.push(d);
      existingAssignedMap.set(d.id, d);
    }
  });
}

function bindAssignSectionEvents(section) {
  const st = ASSIGN_STATE[section];
  const chkAllEl = document.getElementById(`chkAll${section}`);
  const inputEl = document.getElementById(`opInput${section}`);
  const clearEl = document.getElementById(`opClear${section}`);
  const ddEl = document.getElementById(`opDd${section}`);
  const btnAssignEl = document.getElementById(`btnAssign${section}`);
  const listEl = document.getElementById(`list${section}`);

  if (chkAllEl) {
    chkAllEl.addEventListener('change', (e) => {
      const docs = getSectionFilteredDocs(section);
      st.selectedAlertIds.clear();
      if (e.target.checked) {
        docs.forEach(d => {
          const aid = Number(d.ticket && d.ticket.id);
          if (aid) st.selectedAlertIds.add(aid);
        });
      }
      renderDeadlineAccordions();
    });
  }

  if (inputEl) {
    inputEl.addEventListener('focus', () => {
      // Если оператор уже выбран, при клике открываем список или ищем по текущему запросу
      const q = st.selectedOperator ? '' : inputEl.value.trim();
      if (st.searchResults.length > 0 && !q) {
        ddEl.classList.add('open');
      } else {
        requestOperatorsSearch(section, q);
      }
    });

    inputEl.addEventListener('input', (e) => {
      const val = e.target.value;
      if (st.selectedOperator) {
        st.selectedOperator = null;
        inputEl.classList.remove('has-selected');
        if (clearEl) clearEl.style.display = 'none';
        updateAssignToolbarState(section);
      }
      if (st.debounceTimer) clearTimeout(st.debounceTimer);
      st.debounceTimer = setTimeout(() => {
        requestOperatorsSearch(section, val.trim());
      }, 260);
    });
  }

  if (clearEl) {
    clearEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectAssignOperator(section, null);
      if (inputEl) {
        inputEl.focus();
        requestOperatorsSearch(section, '');
      }
    });
  }

  if (ddEl) {
    ddEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const opt = e.target.closest('.op-dd-option');
      if (!opt) return;
      const op = {
        id: Number(opt.getAttribute('data-op-id')),
        fullName: opt.getAttribute('data-op-name') || '',
        upn: opt.getAttribute('data-op-upn') || ''
      };
      selectAssignOperator(section, op);
    });
  }

  if (btnAssignEl) {
    btnAssignEl.addEventListener('click', (e) => {
      e.preventDefault();
      triggerAssignTickets(section);
    });
  }

  if (listEl) {
    listEl.addEventListener('change', (e) => {
      const chk = e.target.closest(`[data-doc-check="${section}"]`);
      if (!chk) return;
      const alertId = Number(chk.getAttribute('data-alert-id'));
      if (!alertId) return;
      if (chk.checked) st.selectedAlertIds.add(alertId);
      else st.selectedAlertIds.delete(alertId);

      const card = chk.closest('.doc-card');
      if (card) card.classList.toggle('selected-doc', chk.checked);
      updateAssignToolbarState(section);
    });

    listEl.addEventListener('click', (e) => {
      const singleBtn = e.target.closest(`[data-single-assign="${section}"]`);
      if (!singleBtn) return;
      e.preventDefault();
      e.stopPropagation();
      const alertId = Number(singleBtn.getAttribute('data-alert-id'));
      if (!alertId) return;
      triggerAssignTickets(section, [alertId]);
    });
  }
}

// Единый слушатель сообщений от injector.js
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'LIVE_LOG' && msg.payload) {
    addLog(msg.payload.level, msg.payload.message, msg.payload.details, msg.payload.time);
    return;
  }
  if (msg.type === 'LIVE_PROGRESS') {
    const mode = (msg.payload && msg.payload.mode) || 'executors';
    const p = STATE[mode].prefix;
    setProgress(p, true, msg.payload.text);
    return;
  }
  if (msg.type === 'LIVE_RESULT') {
    const mode = (msg.payload && msg.payload.mode) || 'executors';
    const st = STATE[mode];
    st.docs = msg.payload.items || [];
    st.fetchedAt = msg.payload.fetchedAt || new Date().toISOString();
    st.hasLoadedOnce = true;

    const asOfEl = document.getElementById(`${st.prefix}AsOfTime`);
    if (asOfEl) asOfEl.innerText = formatDateTimeWithSecRu(st.fetchedAt);

    setProgress(st.prefix, false);
    populateDropdowns(mode);
    renderWidgetTable(mode);
    return;
  }
  if (msg.type === 'DEADLINES_RESULT' && msg.payload) {
    rawOverdueDocs = msg.payload.overdueDocs || [];
    rawDueTodayDocs = msg.payload.dueTodayDocs || [];
    rawAssignedDocs = msg.payload.assignedDocs || [];
    populateDropdowns('executors');
    renderWidgetTable('executors');
    return;
  }
  if (msg.type === 'SEARCH_OPERATORS_RESULT' && msg.payload) {
    const { section, items } = msg.payload;
    renderOperatorDropdownItems(section, items);
    return;
  }
  if (msg.type === 'SEARCH_OPERATORS_ERROR' && msg.payload) {
    const { section, message } = msg.payload;
    const ddEl = document.getElementById(`opDd${section}`);
    if (ddEl) {
      ddEl.innerHTML = `<div class="op-dd-empty" style="color:var(--o3-red);">Ошибка: ${message}</div>`;
      ddEl.classList.add('open');
    }
    return;
  }
  if (msg.type === 'ASSIGN_TICKETS_PROGRESS' && msg.payload) {
    const { section, current, total, alertID } = msg.payload;
    setAssignStatusLine(section, `⏳ Назначение ${current} из ${total} (Ticket ID: ${alertID})...`);
    return;
  }
  if (msg.type === 'ASSIGN_TICKETS_RESULT' && msg.payload) {
    const { section, operator, operatorInfo, succeededAlertIds, failedItems } = msg.payload;
    const st = ASSIGN_STATE[section];
    if (st) {
      st.isAssigning = false;
      (succeededAlertIds || []).forEach(id => st.selectedAlertIds.delete(Number(id)));
    }

    if (succeededAlertIds && succeededAlertIds.length > 0) {
      applyLocalTicketAssignment(succeededAlertIds, operator, operatorInfo);
      populateDropdowns('executors');
      renderWidgetTable('executors');
    } else {
      updateAssignToolbarState(section);
    }

    if (!failedItems || failedItems.length === 0) {
      setAssignStatusLine(
        section,
        `✅ Назначено ${succeededAlertIds.length} док. на ${operator.fullName} (${operator.upn})`,
        'var(--o3-green)'
      );
    } else {
      setAssignStatusLine(
        section,
        `⚠️ Назначено: ${succeededAlertIds.length}, ошибок: ${failedItems.length} (см. лог внизу)`,
        'var(--o3-amber)'
      );
    }

    setTimeout(() => {
      if (ASSIGN_STATE[section] && !ASSIGN_STATE[section].isAssigning) {
        setAssignStatusLine(section, '');
      }
    }, 5000);
    return;
  }
  if (msg.type === 'LIVE_ERROR') {
    const mode = (msg.payload && msg.payload.mode) || 'executors';
    const p = STATE[mode].prefix;
    showSkeleton(p, false);
    const errText = msg.payload.message || String(msg.payload);
    setProgress(p, true, errText);
    addLog('error', `Ошибка выполнения [${mode}]: ${errText}`);
  }
});

function populateDropdowns(mode) {
  const st = STATE[mode];
  const p = st.prefix;

  const entities = new Set();
  const docTypes = new Set();
  const groups = new Set();
  const persons = new Set();
  const queues = new Set();
  const marks = new Set();

  const sourceDocs = mode === 'executors'
    ? [...st.docs, ...rawOverdueDocs, ...rawDueTodayDocs, ...rawAssignedDocs]
    : st.docs;

  sourceDocs.forEach(d => {
    entities.add(getLegalEntity(d));
    docTypes.add(getDocType(d));
    groups.add(getGroupByMode(d, mode));
    persons.add(getPersonByMode(d, mode));
    queues.add(getQueueName(d));
    getMarksArray(d).forEach(m => marks.add(m));
  });

  setMultiSelectOptions(`${p}WrapEntity`, Array.from(entities).sort());
  setMultiSelectOptions(`${p}WrapHeading`, ['INCOMING', 'OUTGOING'], {
    'INCOMING': 'Входящие (INCOMING)',
    'OUTGOING': 'Исходящие (OUTGOING)'
  });
  setMultiSelectOptions(`${p}WrapDocType`, Array.from(docTypes).sort());
  setMultiSelectOptions(`${p}WrapGroup`, Array.from(groups).sort());
  setMultiSelectOptions(`${p}WrapPerson`, Array.from(persons).sort());
  setMultiSelectOptions(`${p}WrapQueue`, Array.from(queues).sort());
  setMultiSelectOptions(`${p}WrapMark`, ['__ANY__', '__NONE__', ...Array.from(marks).sort()], {
    '__ANY__': 'С метками',
    '__NONE__': 'Без меток'
  });
}

function makeDrillCell(docsArr, title, sub, mode, extraClass = '') {
  const cnt = docsArr ? docsArr.length : 0;
  const clsAttr = extraClass ? ` class="${extraClass}"` : '';
  if (cnt === 0) return `<td class="cell-zero ${extraClass}">0</td>`;
  const key = `d_${++cellSeq}`;
  drillStore.set(key, { docs: docsArr, title, sub, mode });
  return `<td${clsAttr}><span class="cell-btn" title="Нажмите для просмотра графика активности и документов (${cnt} шт.)" data-drill="${key}">${cnt}</span></td>`;
}

// Специальная ячейка для столбца "В работе (ASSIGNED)" с поддержкой богатого тултипа при наведении
function makeAssignedCell(docsArr, title, sub) {
  const cnt = docsArr ? docsArr.length : 0;
  if (cnt === 0) return `<td class="cell-zero">0</td>`;
  const key = `as_${++cellSeq}`;
  drillStore.set(key, { docs: docsArr, title, sub, mode: 'executors' });
  assignedTooltipStore.set(key, docsArr);
  return `<td><span class="cell-btn assigned-btn" data-drill="${key}" data-assigned-tip="${key}">${cnt}</span></td>`;
}

// === ОТРИСОВКА ТАБЛИЦЫ ВИДЖЕТА (НА ЛИСТЕ ИСПОЛНИТЕЛЕЙ ДОБАВЛЕН СТОЛБЕЦ "В РАБОТЕ") ===
function renderWidgetTable(mode) {
  const st = STATE[mode];
  const p = st.prefix;
  const isExec = (mode === 'executors');

  if (isExec) {
    renderDeadlineAccordions();
    assignedTooltipStore.clear();
  }

  const dateVal = document.getElementById(`${p}Date`).value;
  const dateRu = formatYMDToRu(dateVal);

  const selEntities = getMultiSelectValues(`${p}WrapEntity`);
  const selHeadings = getMultiSelectValues(`${p}WrapHeading`);
  const selDocTypes = getMultiSelectValues(`${p}WrapDocType`);
  const selGroups = getMultiSelectValues(`${p}WrapGroup`);
  const selPersons = getMultiSelectValues(`${p}WrapPerson`);
  const selQueues = getMultiSelectValues(`${p}WrapQueue`);
  const selMarks = getMultiSelectValues(`${p}WrapMark`);

  const matchesActiveFilters = (d) => {
    if (selEntities.size > 0 && !selEntities.has(getLegalEntity(d))) return false;
    if (selHeadings.size > 0 && !selHeadings.has(d.heading || '')) return false;
    if (selDocTypes.size > 0 && !selDocTypes.has(getDocType(d))) return false;
    if (selGroups.size > 0 && !selGroups.has(getGroupByMode(d, mode))) return false;
    if (selPersons.size > 0 && !selPersons.has(getPersonByMode(d, mode))) return false;
    if (selQueues.size > 0 && !selQueues.has(getQueueName(d))) return false;

    if (selMarks.size > 0) {
      const mks = getMarksArray(d);
      let markMatched = false;
      if (selMarks.has('__ANY__') && mks.length > 0) markMatched = true;
      if (selMarks.has('__NONE__') && mks.length === 0) markMatched = true;
      if (mks.some(m => selMarks.has(m))) markMatched = true;
      if (!markMatched) return false;
    }
    return true;
  };

  const filtered = st.docs.filter(matchesActiveFilters);
  const filteredAssigned = isExec ? rawAssignedDocs.filter(matchesActiveFilters) : [];

  const marksSet = new Set();
  const groupsMap = new Map();
  const uniqueUsers = new Set();

  const grandAssigned = [];
  const grandNoMark = [];
  const grandWithMarks = [];
  const grandByMark = {};

  function ensureHierarchyNode(d) {
    const person = getPersonByMode(d, mode);
    const upn = getPersonUpnByMode(d, mode);
    const grpName = getGroupByMode(d, mode);
    const statusInfo = getPersonStatusInfoByMode(d, mode);
    const docType = getDocType(d);

    uniqueUsers.add(person);

    if (!groupsMap.has(grpName)) {
      groupsMap.set(grpName, { groupName: grpName, assigned: [], all: [], noMark: [], withMarks: [], byMark: {}, users: new Map() });
    }
    const g = groupsMap.get(grpName);

    if (!g.users.has(person)) {
      g.users.set(person, { person, upn, statusInfo, assigned: [], all: [], noMark: [], withMarks: [], byMark: {}, docTypes: new Map() });
    }
    const u = g.users.get(person);
    if (!u.upn && upn) u.upn = upn;
    if ((!u.statusInfo || u.statusInfo.status === 'UNKNOWN_STATUS') && statusInfo.status !== 'UNKNOWN_STATUS') {
      u.statusInfo = statusInfo;
    }

    if (!u.docTypes.has(docType)) {
      u.docTypes.set(docType, { docType, assigned: [], all: [], noMark: [], withMarks: [], byMark: {} });
    }
    const dt = u.docTypes.get(docType);
    return { g, u, dt };
  }

  // 1. Заполняем закрытые/созданные за выбранную дату документы
  filtered.forEach(d => {
    const docMarks = getMarksArray(d);
    const hasMk = docMarks.length > 0;
    const { g, u, dt } = ensureHierarchyNode(d);

    if (hasMk) {
      grandWithMarks.push(d);
      docMarks.forEach(mName => {
        marksSet.add(mName);
        if (!grandByMark[mName]) grandByMark[mName] = [];
        grandByMark[mName].push(d);
      });
    } else {
      grandNoMark.push(d);
    }

    g.all.push(d);
    u.all.push(d);
    dt.all.push(d);

    if (hasMk) {
      g.withMarks.push(d);
      u.withMarks.push(d);
      dt.withMarks.push(d);
      docMarks.forEach(mName => {
        if (!g.byMark[mName]) g.byMark[mName] = [];
        if (!u.byMark[mName]) u.byMark[mName] = [];
        if (!dt.byMark[mName]) dt.byMark[mName] = [];
        g.byMark[mName].push(d);
        u.byMark[mName].push(d);
        dt.byMark[mName].push(d);
      });
    } else {
      g.noMark.push(d);
      u.noMark.push(d);
      dt.noMark.push(d);
    }
  });

  // 2. На листе Исполнителей добавляем документы, которые сейчас находятся В РАБОТЕ (ASSIGNED) у человека
  if (isExec) {
    filteredAssigned.forEach(d => {
      const { g, u, dt } = ensureHierarchyNode(d);
      grandAssigned.push(d);
      g.assigned.push(d);
      u.assigned.push(d);
      dt.assigned.push(d);
    });
  }

  const sortedMarks = Array.from(marksSet).sort((a, b) => (grandByMark[b]?.length || 0) - (grandByMark[a]?.length || 0));
  const sortedGroups = Array.from(groupsMap.values()).sort((a, b) => (b.all.length + b.assigned.length) - (a.all.length + a.assigned.length));

  document.getElementById(`${p}SysTotal`).innerText = filtered.length;
  document.getElementById(`${p}SysGroups`).innerText = sortedGroups.length;
  document.getElementById(`${p}SysUsers`).innerText = uniqueUsers.size;
  document.getElementById(`${p}SysMarksCount`).innerText = sortedMarks.length;

  const thead = document.querySelector(`#${p}Table thead`);
  const tbody = document.querySelector(`#${p}Table tbody`);

  const markToggleIcon = st.isMarksExpanded ? '◀ Свернуть' : `▶ Развернуть (${sortedMarks.length})`;

  thead.innerHTML = `<tr>
    <th class="sticky-col" title="Потяните за правый край столбца для изменения ширины">
      Группа / ${st.roleTitle} / Тип док. (${dateRu})
      <div class="col-resizer" title="Потяните влево/вправо для изменения ширины первого столбца"></div>
    </th>
    ${isExec ? `<th class="assigned-col" title="Сколько сейчас документов в статусе Назначен (ASSIGNED). Наведите курсор на ячейку для деталей!">В работе (ASSIGNED)</th>` : ''}
    <th>Всего</th>
    <th>Без метки</th>
    <th class="marks-parent-col" data-toggle-marks="${mode}" title="Нажмите, чтобы свернуть или развернуть детализацию по каждой метке">
      С меткой <span style="font-size:10.5px; font-weight:500;">${markToggleIcon}</span>
    </th>
    ${st.isMarksExpanded ? sortedMarks.map(m => `<th class="mark-child-col" title="Метка: ${m}">${m}</th>`).join('') : ''}
  </tr>`;

  const expRows = [];
  let html = '';

  sortedGroups.forEach(g => {
    const isCol = st.collapsedGroups.has(g.groupName);
    const sortedUsers = Array.from(g.users.values()).sort((a, b) => (b.all.length || b.assigned.length) - (a.all.length || a.assigned.length));

    const gExp = {
      'Актуально_На': formatDateTimeWithSecRu(st.fetchedAt),
      [st.dateColName]: dateRu,
      'Группа': g.groupName,
      [st.roleTitle]: '[ИТОГО ПО ГРУППЕ]',
      'Логин_UPN': '',
      'Текущий_Статус': '',
      'Тип_Документа': 'ВСЕ ТИПЫ',
      ...(isExec ? { 'В_Работе_ASSIGNED': g.assigned.length } : {}),
      'Всего': g.all.length,
      'Без_Метки': g.noMark.length,
      'С_Меткой_Всего': g.withMarks.length
    };
    sortedMarks.forEach(m => { gExp[`Метка: ${m}`] = (g.byMark[m] || []).length; });
    expRows.push(gExp);

    const grpMarkCells = st.isMarksExpanded
      ? sortedMarks.map(m => makeDrillCell(g.byMark[m] || [], `Группа: ${g.groupName}`, `Метка: «${m}» · Дата: ${dateRu}`, mode)).join('')
      : '';

    html += `<tr class="group-row">
      <td class="sticky-col" data-grp="${g.groupName}">
        ${isCol ? '▶' : '▼'} ${g.groupName} <span class="grp-badge">${sortedUsers.length}</span>
      </td>
      ${isExec ? makeAssignedCell(g.assigned, `Группа: ${g.groupName}`, 'Сейчас в работе (ASSIGNED)') : ''}
      ${makeDrillCell(g.all, `Группа: ${g.groupName}`, `Все документы подразделения за ${dateRu}`, mode)}
      ${makeDrillCell(g.noMark, `Группа: ${g.groupName}`, `Без метки за ${dateRu}`, mode)}
      ${makeDrillCell(g.withMarks, `Группа: ${g.groupName}`, `Все с метками за ${dateRu}`, mode, 'marks-parent-cell')}
      ${grpMarkCells}
    </tr>`;

    if (!isCol) {
      sortedUsers.forEach(u => {
        const userKey = `${g.groupName}__${u.person}`;
        const isUserExp = st.expandedUsers.has(userKey);
        const sortedDocTypes = Array.from(u.docTypes.values()).sort((a, b) => (b.all.length + b.assigned.length) - (a.all.length + a.assigned.length));
        const statusRender = getPersonStatusRender(u.statusInfo, st.fetchedAt, u.person);
        const actionsHtml = buildPersonActionButtonsHtml(u.upn);

        const assignedDetailsStr = isExec
          ? u.assigned.map(ad => `${getDocType(ad)} (${formatStatusDuration(ad.updatedAt || ad.createdAt, st.fetchedAt)})`).join(', ')
          : '';

        const uExp = {
          'Актуально_На': formatDateTimeWithSecRu(st.fetchedAt),
          [st.dateColName]: dateRu,
          'Группа': g.groupName,
          [st.roleTitle]: u.person,
          'Логин_UPN': u.upn || '',
          'Текущий_Статус': statusRender.text,
          'Тип_Документа': '[ВСЕ ТИПЫ СОТРУДНИКА]',
          ...(isExec ? { 'В_Работе_ASSIGNED': u.assigned.length, 'Детали_В_Работе': assignedDetailsStr } : {}),
          'Всего': u.all.length,
          'Без_Метки': u.noMark.length,
          'С_Меткой_Всего': u.withMarks.length
        };
        sortedMarks.forEach(m => { uExp[`Метка: ${m}`] = (u.byMark[m] || []).length; });
        expRows.push(uExp);

        const usrMarkCells = st.isMarksExpanded
          ? sortedMarks.map(m => makeDrillCell(u.byMark[m] || [], u.person, `Метка: «${m}» · Дата: ${dateRu}`, mode)).join('')
          : '';

        const personDisplayHtml = u.person === 'Не назначен'
          ? `<span style="color:var(--o3-red); font-weight:700;">🚨 Не назначен</span>`
          : u.person;

        html += `<tr class="operator-row">
          <td class="sticky-col" data-usr="${userKey}" title="Нажмите, чтобы раскрыть по типам документа (${u.person})">
            <span style="color:var(--o3-text-muted); font-size:10px; margin-right:4px;">${isUserExp ? '▼' : '▶'}</span>${personDisplayHtml}${actionsHtml}${statusRender.html}
          </td>
          ${isExec ? makeAssignedCell(u.assigned, u.person, `Группа: ${g.groupName} · Сейчас в работе (ASSIGNED)`) : ''}
          ${makeDrillCell(u.all, u.person, `Группа: ${g.groupName} · Статус: ${statusRender.text || '—'} · Все документы за ${dateRu}`, mode)}
          ${makeDrillCell(u.noMark, u.person, `Группа: ${g.groupName} · Без метки за ${dateRu}`, mode)}
          ${makeDrillCell(u.withMarks, u.person, `Группа: ${g.groupName} · Все с метками за ${dateRu}`, mode, 'marks-parent-cell')}
          ${usrMarkCells}
        </tr>`;

        if (isUserExp) {
          sortedDocTypes.forEach(dt => {
            const dtExp = {
              'Актуально_На': formatDateTimeWithSecRu(st.fetchedAt),
              [st.dateColName]: dateRu,
              'Группа': g.groupName,
              [st.roleTitle]: u.person,
              'Логин_UPN': u.upn || '',
              'Текущий_Статус': statusRender.text,
              'Тип_Документа': dt.docType,
              ...(isExec ? { 'В_Работе_ASSIGNED': dt.assigned.length, 'Детали_В_Работе': '' } : {}),
              'Всего': dt.all.length,
              'Без_Метки': dt.noMark.length,
              'С_Меткой_Всего': dt.withMarks.length
            };
            sortedMarks.forEach(m => { dtExp[`Метка: ${m}`] = (dt.byMark[m] || []).length; });
            expRows.push(dtExp);

            const dtMarkCells = st.isMarksExpanded
              ? sortedMarks.map(m => makeDrillCell(dt.byMark[m] || [], `${u.person} · ${dt.docType}`, `Метка: «${m}» · Дата: ${dateRu}`, mode)).join('')
              : '';

            html += `<tr class="doctype-row">
              <td class="sticky-col" title="Тип документа: ${dt.docType}">↳ ${dt.docType}</td>
              ${isExec ? makeAssignedCell(dt.assigned, `${u.person} · ${dt.docType}`, `Сейчас в работе (ASSIGNED)`) : ''}
              ${makeDrillCell(dt.all, `${u.person} · ${dt.docType}`, `Все документы типа «${dt.docType}» за ${dateRu}`, mode)}
              ${makeDrillCell(dt.noMark, `${u.person} · ${dt.docType}`, `Без метки за ${dateRu}`, mode)}
              ${makeDrillCell(dt.withMarks, `${u.person} · ${dt.docType}`, `Все с метками за ${dateRu}`, mode, 'marks-parent-cell')}
              ${dtMarkCells}
            </tr>`;
          });
        }
      });
    }
  });

  if (sortedGroups.length > 0) {
    const totExp = {
      'Актуально_На': formatDateTimeWithSecRu(st.fetchedAt),
      [st.dateColName]: dateRu,
      'Группа': 'ВСЕ ГРУППЫ',
      [st.roleTitle]: 'ОБЩИЙ ИТОГ',
      'Логин_UPN': '',
      'Текущий_Статус': '',
      'Тип_Документа': 'ВСЕ ТИПЫ',
      ...(isExec ? { 'В_Работе_ASSIGNED': grandAssigned.length, 'Детали_В_Работе': '' } : {}),
      'Всего': filtered.length,
      'Без_Метки': grandNoMark.length,
      'С_Меткой_Всего': grandWithMarks.length
    };
    sortedMarks.forEach(m => { totExp[`Метка: ${m}`] = (grandByMark[m] || []).length; });
    expRows.push(totExp);

    const totMarkCells = st.isMarksExpanded
      ? sortedMarks.map(m => makeDrillCell(grandByMark[m] || [], `Общий итог по метке «${m}»`, `Дата: ${dateRu}`, mode)).join('')
      : '';

    html += `<tr class="total-row">
      <td class="sticky-col">ИТОГО ЗА ${dateRu}</td>
      ${isExec ? makeAssignedCell(grandAssigned, 'Все подразделения', 'Всего сейчас в работе (ASSIGNED)') : ''}
      ${makeDrillCell(filtered, `Все подразделения за ${dateRu}`, 'Общий итог за день', mode)}
      ${makeDrillCell(grandNoMark, `Без метки за ${dateRu}`, 'Общий итог за день', mode)}
      ${makeDrillCell(grandWithMarks, `Все с метками за ${dateRu}`, 'Общий итог за день', mode, 'marks-parent-cell')}
      ${totMarkCells}
    </tr>`;
  } else {
    const colSpan = (isExec ? 5 : 4) + (st.isMarksExpanded ? sortedMarks.length : 0);
    html = `<tr><td colspan="${colSpan}" style="padding:28px; color:var(--o3-text-sec);">За ${dateRu} документов по выбранным фильтрам не найдено.</td></tr>`;
  }

  tbody.innerHTML = html;
  st.lastExportRows = expRows;
  showSkeleton(p, false);
}

// === ДИАГРАММА АКТИВНОСТИ В ОКНЕ ДЕТАЛИЗАЦИИ ===
function renderActivityAnalytics(docs, mode) {
  const isReg = (mode === 'registrars');
  document.getElementById('actFirstLbl').innerText = isReg ? 'Первый созданный' : 'Первый документ';
  document.getElementById('actLastLbl').innerText = isReg ? 'Последний созданный' : 'Последний документ';
  document.getElementById('actChartTitle').innerText = isReg
    ? 'График регистрации по 15-минутным интервалам (клик по столбику фильтрует список)'
    : 'График активности по 15-минутным интервалам (клик по столбику фильтрует список)';

  const slots = new Array(96).fill(0);
  let minDate = null;
  let maxDate = null;

  docs.forEach(d => {
    const dt = getDocActivityDate(d, mode);
    if (!dt) return;
    if (!minDate || dt < minDate) minDate = dt;
    if (!maxDate || dt > maxDate) maxDate = dt;

    const slotIdx = dt.getHours() * 4 + Math.floor(dt.getMinutes() / 15);
    if (slotIdx >= 0 && slotIdx < 96) {
      slots[slotIdx]++;
    }
  });

  document.getElementById('actFirstVal').innerText = minDate ? formatTimeHMS(minDate) : '—';
  document.getElementById('actLastVal').innerText = maxDate ? formatTimeHMS(maxDate) : '—';

  if (minDate && maxDate) {
    const diffMs = maxDate - minDate;
    const totalMins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    document.getElementById('actSpanVal').innerText = hrs > 0 ? `${hrs} ч ${mins} мин` : `${mins} мин`;
  } else {
    document.getElementById('actSpanVal').innerText = '—';
  }

  let maxSlotCount = 0;
  let peakSlotIdx = -1;
  slots.forEach((cnt, idx) => {
    if (cnt > maxSlotCount) {
      maxSlotCount = cnt;
      peakSlotIdx = idx;
    }
  });

  if (maxSlotCount > 0 && peakSlotIdx >= 0) {
    document.getElementById('actPeakVal').innerText = `${formatSlotRange(peakSlotIdx)} (${maxSlotCount} шт.)`;
  } else {
    document.getElementById('actPeakVal').innerText = '—';
  }

  const barsContainer = document.getElementById('actChartBars');
  barsContainer.innerHTML = slots.map((cnt, idx) => {
    const heightPct = maxSlotCount > 0 ? Math.max(4, Math.round((cnt / maxSlotCount) * 100)) : 2;
    const rangeStr = formatSlotRange(idx);
    const isZero = cnt === 0 ? 'zero' : '';
    const isPeak = (cnt === maxSlotCount && cnt > 0) ? 'peak' : '';
    const isSel = (selectedSlotIdx === idx) ? 'selected' : '';

    return `<div class="bar-col ${isZero} ${isPeak} ${isSel}" data-slot="${idx}" title="${rangeStr} — Документов: ${cnt} шт.">
      ${cnt > 0 ? `<span class="bar-val">${cnt}</span>` : ''}
      <div class="bar-fill" style="height:${cnt > 0 ? heightPct : 2}%;"></div>
    </div>`;
  }).join('');

  document.getElementById('btnClearSlotFilter').style.display = (selectedSlotIdx !== null) ? 'inline' : 'none';
}

function openDrawer(key) {
  const item = drillStore.get(key);
  if (!item) return;
  activeDrawerDocs = item.docs;
  activeDrawerMode = item.mode || 'executors';
  selectedSlotIdx = null;

  document.getElementById('drTitle').innerText = `${item.title} (${activeDrawerDocs.length} док.)`;
  document.getElementById('drSub').innerText = item.sub;
  document.getElementById('drSearch').value = '';

  renderActivityAnalytics(activeDrawerDocs, activeDrawerMode);
  renderDrawerList('');
  document.getElementById('drillDrawer').classList.add('open');
}

function renderDrawerList(q) {
  const query = (q ?? document.getElementById('drSearch').value).trim().toLowerCase();
  const listEl = document.getElementById('drList');

  const matched = activeDrawerDocs.filter(d => {
    if (selectedSlotIdx !== null) {
      if (getDocSlotIndex(d, activeDrawerMode) !== selectedSlotIdx) return false;
    }
    if (!query) return true;
    const t = d.ticket || {};
    const corr = d.correspondent || {};
    const hay = [
      d.documentName, d.id, d.documentTypeName, t.id, t.status, formatTicketStatusRu(t.status),
      getOperatorLabel(d), getCreatorLabel(d), corr.fullName,
      ...getMarksArray(d)
    ].join(' ').toLowerCase();
    return hay.includes(query);
  });

  const sortedMatched = [...matched].sort((a, b) => {
    const da = getDocActivityDate(a, activeDrawerMode);
    const db = getDocActivityDate(b, activeDrawerMode);
    return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
  });

  const refNow = STATE.executors.fetchedAt || new Date().toISOString();

  listEl.innerHTML = sortedMatched.map(d => {
    const t = d.ticket || {};
    const corr = d.correspondent || {};
    const docTitle = d.documentName || d.id;

    const docUrl = `${CRM_BASE_URL}/sed/document/${encodeURIComponent(d.id)}`;
    const marksHtml = getMarksArray(d).map(m => `<span class="mark-pill">${m}</span>`).join('');
    const dirClass = d.heading === 'INCOMING' ? 'dir-INCOMING' : 'dir-OUTGOING';

    const creatorActions = buildPersonActionButtonsHtml(getCreatorUpn(d));
    const operatorActions = buildPersonActionButtonsHtml(getOperatorUpn(d));
    const sinceUpdateDur = formatStatusDuration(d.updatedAt || d.createdAt, refNow);

    return `<div class="doc-card">
      <div class="doc-top">
        <a href="${docUrl}" target="_blank" title="Открыть карточку документа в СЭД">📄 ${docTitle} (Открыть документ ↗)</a>
        <span class="dir-badge ${dirClass}">${formatHeadingRu(d.heading)} · ЮЛ: ${getLegalEntity(d)} · ${formatTicketStatusRu(t.status)}</span>
      </div>
      <div class="doc-meta">
        <div><strong>Тип документа:</strong> ${getDocType(d)} · <strong>Очередь:</strong> ${getQueueName(d)} · <strong>Ticket ID:</strong> ${t.id || '—'}</div>
        <div><strong>Регистратор:</strong> ${getCreatorLabel(d)} (${getCreatorGroup(d)})${creatorActions}</div>
        <div><strong>Исполнитель:</strong> ${formatOperatorHtml(d)}${operatorActions}</div>
        <div><strong>Создан:</strong> ${formatDateTimeRu(d.createdAt)} · <strong>Посл. апдейт:</strong> ${formatDateTimeRu(d.updatedAt)} (${sinceUpdateDur || 'только что'}) · <strong>Дедлайн:</strong> ${formatDateTimeRu(d.deadline)}</div>
        ${corr.fullName ? `<div><strong>Корреспондент:</strong> ${corr.fullName}</div>` : ''}
        ${marksHtml ? `<div>${marksHtml}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

document.getElementById('actChartBars').addEventListener('click', (e) => {
  const col = e.target.closest('[data-slot]');
  if (!col) return;
  const idx = parseInt(col.getAttribute('data-slot'), 10);
  selectedSlotIdx = (selectedSlotIdx === idx) ? null : idx;
  renderActivityAnalytics(activeDrawerDocs, activeDrawerMode);
  renderDrawerList();
});

document.getElementById('btnClearSlotFilter').onclick = () => {
  selectedSlotIdx = null;
  renderActivityAnalytics(activeDrawerDocs, activeDrawerMode);
  renderDrawerList();
};

function bindWidgetEvents(mode) {
  const st = STATE[mode];
  const p = st.prefix;

  const rerender = () => renderWidgetTable(mode);
  initMultiSelect(`${p}WrapEntity`, 'Юрлицо Финтеха', 'Все юрлица', rerender);
  initMultiSelect(`${p}WrapHeading`, 'Направление', 'Все направления', rerender);
  initMultiSelect(`${p}WrapDocType`, 'Тип документа', 'Все типы документов', rerender);
  initMultiSelect(`${p}WrapGroup`, mode === 'registrars' ? 'Группа регистраторов' : 'Группа исполнителей', 'Все группы', rerender);
  initMultiSelect(`${p}WrapPerson`, mode === 'registrars' ? 'Регистратор' : 'Исполнитель', mode === 'registrars' ? 'Все регистраторы' : 'Все исполнители', rerender);
  initMultiSelect(`${p}WrapQueue`, 'Очередь', 'Все очереди', rerender);
  initMultiSelect(`${p}WrapMark`, 'Метка тикета (Marks)', 'Все метки', rerender);

  document.getElementById(`${p}Table`).addEventListener('click', (e) => {
    if (e.target.closest('.col-resizer') || e.target.closest('[data-copy-upn]') || e.target.closest('[data-chatzone-link]')) {
      return;
    }

    if (e.target.closest(`[data-toggle-marks="${mode}"]`)) {
      st.isMarksExpanded = !st.isMarksExpanded;
      renderWidgetTable(mode);
      return;
    }

    const grp = e.target.closest('[data-grp]');
    if (grp) {
      const gName = grp.getAttribute('data-grp');
      if (st.collapsedGroups.has(gName)) st.collapsedGroups.delete(gName);
      else st.collapsedGroups.add(gName);
      renderWidgetTable(mode);
      return;
    }

    const usr = e.target.closest('[data-usr]');
    if (usr) {
      const uKey = usr.getAttribute('data-usr');
      if (st.expandedUsers.has(uKey)) st.expandedUsers.delete(uKey);
      else st.expandedUsers.add(uKey);
      renderWidgetTable(mode);
      return;
    }

    const cell = e.target.closest('[data-drill]');
    if (cell) {
      openDrawer(cell.getAttribute('data-drill'));
    }
  });

  document.getElementById(`${p}BtnToggleMarksCols`).onclick = () => {
    st.isMarksExpanded = !st.isMarksExpanded;
    renderWidgetTable(mode);
  };

  document.getElementById(`${p}BtnToggleDocTypes`).onclick = () => {
    st.allUsersExpanded = !st.allUsersExpanded;
    if (st.allUsersExpanded) {
      const allSource = mode === 'executors' ? [...st.docs, ...rawAssignedDocs] : st.docs;
      allSource.forEach(d => {
        st.expandedUsers.add(`${getGroupByMode(d, mode)}__${getPersonByMode(d, mode)}`);
      });
    } else {
      st.expandedUsers.clear();
    }
    renderWidgetTable(mode);
  };

  document.getElementById(`${p}Date`).addEventListener('change', () => fetchWidgetData(mode));
  document.getElementById(`${p}BtnReload`).onclick = () => fetchWidgetData(mode);

  document.getElementById(`${p}BtnStop`).onclick = async () => {
    const tab = await findSedTab();
    if (tab) chrome.tabs.sendMessage(tab.id, { target: 'INJECTOR', type: 'STOP_FETCH' }).catch(() => {});
    setProgress(p, false);
    showSkeleton(p, false);
  };

  document.getElementById(`${p}BtnReset`).onclick = () => {
    ['Entity', 'Heading', 'DocType', 'Group', 'Person', 'Queue', 'Mark'].forEach(field => {
      resetMultiSelect(`${p}Wrap${field}`);
    });
    renderWidgetTable(mode);
  };

  document.getElementById(`${p}BtnExpandGroups`).onclick = () => {
    st.collapsedGroups.clear();
    renderWidgetTable(mode);
  };
  document.getElementById(`${p}BtnCollapseGroups`).onclick = () => {
    const allSource = mode === 'executors' ? [...st.docs, ...rawAssignedDocs] : st.docs;
    allSource.forEach(d => st.collapsedGroups.add(getGroupByMode(d, mode)));
    renderWidgetTable(mode);
  };

  document.getElementById(`${p}BtnCsv`).onclick = () => {
    const dt = document.getElementById(`${p}Date`).value || 'date';
    downloadCsv(`sed_${mode}_${dt}.csv`, st.lastExportRows);
  };

  document.getElementById(`${p}BtnExpandTab`).onclick = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?widget=${mode}`) });
  };
}

function activateWidgetTab(mode) {
  const isReg = (mode === 'registrars');
  document.getElementById('tabExecutors').classList.toggle('active', !isReg);
  document.getElementById('tabRegistrars').classList.toggle('active', isReg);
  document.getElementById('widgetExecutors').style.display = isReg ? 'none' : 'block';
  document.getElementById('widgetRegistrars').style.display = isReg ? 'block' : 'none';

  const st = STATE[mode];
  if (!st.hasLoadedOnce) {
    fetchWidgetData(mode);
  }
}

document.getElementById('tabExecutors').onclick = () => activateWidgetTab('executors');
document.getElementById('tabRegistrars').onclick = () => activateWidgetTab('registrars');

document.getElementById('btnDrClose').onclick = () => document.getElementById('drillDrawer').classList.remove('open');
document.getElementById('drSearch').addEventListener('input', (e) => renderDrawerList(e.target.value));

function downloadCsv(filename, rows) {
  if (!rows || !rows.length) return alert('Нет данных для выгрузки!');
  const headers = Object.keys(rows[0]);
  const csvContent = [
    headers.join(';'),
    ...rows.map(row => headers.map(h => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(';'))
  ].join('\r\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

function exportAlertDocsCsv(docs, filename) {
  const rows = (docs || []).map(d => {
    const t = d.ticket || {};
    const corr = d.correspondent || {};
    return {
      'Номер_Документа': d.documentName || '',
      'Юрлицо_Финтеха': getLegalEntity(d),
      'Ссылка_На_Документ': `${CRM_BASE_URL}/sed/document/${encodeURIComponent(d.id)}`,
      'Дедлайн': formatDateTimeRu(d.deadline),
      'Дата_Создания': formatDateTimeRu(d.createdAt),
      'Посл_Апдейт': formatDateTimeRu(d.updatedAt),
      'Статус': formatTicketStatusRu(t.status),
      'Направление': formatHeadingRu(d.heading),
      'Тип_Документа': getDocType(d),
      'Очередь': getQueueName(d),
      'Ticket_ID': t.id || '',
      'Метки': getMarksArray(d).join(' | '),
      'Исполнитель': getOperatorLabel(d),
      'Логин_Исполнителя': getOperatorUpn(d),
      'Группа_Исполнителя': getOperatorGroup(d),
      'Регистратор': getCreatorLabel(d),
      'Логин_Регистратора': getCreatorUpn(d),
      'Корреспондент': corr.fullName || ''
    };
  });
  downloadCsv(filename, rows);
}

const btnCsvOverEl = document.getElementById('btnCsvOverdue');
if (btnCsvOverEl) {
  btnCsvOverEl.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    exportAlertDocsCsv(filteredOverdueDocs, 'sed_overdue_documents.csv');
  };
}

const btnCsvTodayEl = document.getElementById('btnCsvDueToday');
if (btnCsvTodayEl) {
  btnCsvTodayEl.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    exportAlertDocsCsv(filteredDueTodayDocs, 'sed_due_today_documents.csv');
  };
}

document.getElementById('btnDrCsv').onclick = () => {
  const rows = activeDrawerDocs.map(d => {
    const t = d.ticket || {};
    const corr = d.correspondent || {};
    return {
      'Номер_Документа': d.documentName || '',
      'Юрлицо_Финтеха': getLegalEntity(d),
      'Ссылка_На_Документ': `${CRM_BASE_URL}/sed/document/${encodeURIComponent(d.id)}`,
      'ID_Документа': d.id,
      'Направление': formatHeadingRu(d.heading),
      'Тип_Документа': getDocType(d),
      'Очередь': getQueueName(d),
      'Ticket_ID': t.id || '',
      'Статус': formatTicketStatusRu(t.status),
      'Метки': getMarksArray(d).join(' | '),
      'Регистратор': getCreatorLabel(d),
      'Логин_Регистратора': getCreatorUpn(d),
      'Группа_Регистратора': getCreatorGroup(d),
      'Исполнитель': getOperatorLabel(d),
      'Логин_Исполнителя': getOperatorUpn(d),
      'Группа_Исполнителя': getOperatorGroup(d),
      'Дата_Создания': formatDateTimeRu(d.createdAt),
      'Дата_Изменения': formatDateTimeRu(d.updatedAt),
      'Дата_Закрытия': formatDateTimeRu(t.closedAt),
      'Корреспондент': corr.fullName || ''
    };
  });
  downloadCsv(`sed_online_docs_list.csv`, rows);
};

// Инициализация при запуске
(function init() {
  initFirstColWidth();
  const savedTheme = localStorage.getItem('o3_sed_theme') || 'light';
  applyTheme(savedTheme);

  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  document.getElementById('exDate').value = ymd;
  document.getElementById('rgDate').value = ymd;

  bindWidgetEvents('executors');
  bindWidgetEvents('registrars');
  bindAssignSectionEvents('Overdue');
  bindAssignSectionEvents('DueToday');

  const params = new URLSearchParams(window.location.search);
  const startWidget = params.get('widget') === 'registrars' ? 'registrars' : 'executors';
  activateWidgetTab(startWidget);
})();

// === АВТОПРОВЕРКА ОБНОВЛЕНИЙ С GITHUB ===
// Укажите здесь ссылку на raw manifest.json вашего репозитория:
const GITHUB_MANIFEST_URL = "https://raw.githubusercontent.com/V-M221/ozon-sed-dashboard/main/manifest.json";

async function checkForGithubUpdates() {
  const localVersion = chrome.runtime.getManifest().version;
  const btnReload = document.getElementById('btnReloadExt');
  if (btnReload) {
    btnReload.innerText = `⚡ v${localVersion}`;
    btnReload.onclick = () => chrome.runtime.reload();
  }

  const btnApply = document.getElementById('btnApplyUpdate');
  if (btnApply) {
    btnApply.onclick = () => chrome.runtime.reload();
  }

  if (!GITHUB_MANIFEST_URL || GITHUB_MANIFEST_URL.includes('V-M221')) return;

  try {
    const res = await fetch(`${GITHUB_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const remoteManifest = await res.json();
    const remoteVersion = remoteManifest && remoteManifest.version;

    if (remoteVersion && remoteVersion !== localVersion) {
      const banner = document.getElementById('updateBanner');
      const textEl = document.getElementById('updateBannerText');
      if (banner && textEl) {
        textEl.innerText = `🚀 Доступна новая версия v${remoteVersion} (у вас v${localVersion})! Запустите update.bat в папке расширения и нажмите кнопку справа →`;
        banner.style.display = 'flex';
      }
    }
  } catch (e) {
    // Тихо игнорируем, если нет доступа к интернету
  }
}

checkForGithubUpdates();