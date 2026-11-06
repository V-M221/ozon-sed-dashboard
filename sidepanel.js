const CRM_BASE_URL = "https://crm.bank.ozon.ru";
const CHATZONE_BASE_URL = "https://chatzone.o3t.ru/ozon/messages/@";
const CHATZONE_POSTS_API_URL = "https://chatzone.o3t.ru/api/v4/posts";
const CHATZONE_TARGET_CHANNEL_ID = "qdgf4un9p3f6mp543oi9uqne9c";

let drillStore = new Map();
let assignedTooltipStore = new Map();
let activeDrawerDocs = [];
let activeDrawerMode = 'executors';
let selectedSlotIdx = null;
let cellSeq = 0;
let logsArray = [];

let rawOverdueDocs = [];
let rawDueTodayDocs = [];
let rawAssignedDocs = [];
let rawHoldDocs = [];
let rawClosedInternalRequestDocs = [];
let rawInternalRequestsInWork = [];
let rawInternalRequestsOnHold = [];
let filteredOverdueDocs = [];
let filteredDueTodayDocs = [];
let isDeadlinesLoading = false;
let isDueDateSingleLoading = false;

const ASSIGN_STATE = {
  Overdue: { selectedAlertIds: new Set(), selectedOperator: null, searchResults: [], isAssigning: false, debounceTimer: null },
  DueToday: { selectedAlertIds: new Set(), selectedOperator: null, searchResults: [], isAssigning: false, debounceTimer: null }
};

// Состояние модального окна рассылки уведомлений в Chatzone ("Дополнительные теги")
const PUSH_MODAL_STATE = {
  section: 'DueToday',
  docs: [],
  queuesList: [], // [{ queueKey, queueName, docs }]
  extraOperatorsByQueue: new Map(), // queueKey -> Map(upn -> { id, fullName, upn, tag })
  debounceTimers: new Map(),
  isSending: false
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
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

const STOPWATCH_ICON_SVG = `<svg class="o3-svg-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 1C9.44772 1 9 1.44772 9 2C9 2.55228 9.44772 3 10 3H14C14.5523 3 15 2.55228 15 2C15 1.44772 14.5523 1 14 1H10Z" fill="currentColor"/><path d="M19.7071 3.29289C19.3166 2.90237 18.6834 2.90237 18.2929 3.29289C17.9024 3.68342 17.9024 4.31658 18.2929 4.70711L19.2929 5.70711C19.6834 6.09763 20.3166 6.09763 20.7071 5.70711C21.0976 5.31658 21.0976 4.68342 20.7071 4.29289L19.7071 3.29289Z" fill="currentColor"/><path d="M12 22C17.5842 22 21 18.5842 21 13C21 7.4158 17.5842 4 12 4C6.4158 4 3 7.4158 3 13C3 18.5842 6.4158 22 12 22ZM15.8 9.6L13.8396 12.2139C13.9428 12.4552 14 12.7209 14 13C14 14.1046 13.1046 15 12 15C10.8954 15 10 14.1046 10 13C10 11.8954 10.8954 11 12 11C12.081 11 12.1609 11.0048 12.2394 11.0142L14.2 8.4C14.5314 7.95817 15.1582 7.86863 15.6 8.2C16.0418 8.53137 16.1314 9.15817 15.8 9.6Z" fill="currentColor"/></svg>`;
const BELL_ICON_SVG = `<svg class="o3-svg-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 4C13 3.44772 12.5523 3 12 3C11.4477 3 11 3.44772 11 4C7.33114 4.3927 6.65279 7.03586 6.1079 9.11821C5.91732 9.84651 5.74307 10.5124 5.46291 11C5.29239 11.2968 5.09424 11.5495 4.89986 11.7975C4.4393 12.3849 4 12.9452 4 14C3.99998 16 6.99107 18 12 18C17.0089 18 20 16 20 14C20 12.9496 19.5524 12.3896 19.085 11.8048C18.885 11.5545 18.6813 11.2997 18.5076 11C18.2223 10.5077 18.0479 9.83368 17.8573 9.09717C17.3196 7.01851 16.6531 4.39152 13 4Z" fill="currentColor"/><path d="M9.30324 19C8.94643 18.9786 8.93152 19.4088 9.13668 19.701C9.68323 20.4796 10.8712 21 12 21C13.1436 21 14.3291 20.4662 14.8711 19.6705C15.0716 19.376 15.0524 18.975 14.6965 19.0003C14.6965 19.0003 13.5134 19.1875 12 19.1875C10.5031 19.1875 9.30324 19 9.30324 19Z" fill="currentColor"/></svg>`;
const ASSIGN_ICON_SVG = `<svg class="o3-svg-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3C9 3 7 5 7 8C7 11 9 13 12 13C15 13 17 11 17 8C17 5 15 3 12 3Z" fill="currentColor"/><path d="M7.50001 14C8.12006 14.002 8.4838 14.1733 8.90908 14.3734C9.51262 14.6576 10.2401 15 12 15C13.7574 15 14.4853 14.6569 15.0883 14.3726C15.5147 14.1716 15.8787 14 16.5 14C17.8675 14 17.7271 15 17 15.1366C15.5359 15.4116 15 16.1699 15 18C15 20.3972 14.5403 20.9555 12.2983 20.9974C12.197 20.9991 12.0947 21 11.9913 21C6.5 21 4 18.5 4 17.5C4 16.5 6.5 13.9967 7.50001 14Z" fill="currentColor"/><path d="M20 17C20 16.4477 19.5523 16 19 16C18.4477 16 18 16.4477 18 17V18H17C16.4477 18 16 18.4477 16 19C16 19.5523 16.4477 20 17 20H18V21C18 21.5523 18.4477 22 19 22C19.5523 22 20 21.5523 20 21V20H21C21.5523 20 22 19.5523 22 19C22 18.4477 21.5523 18 21 18H20V17Z" fill="currentColor"/></svg>`;
const DOC_ICON_SVG = `<svg class="o3-svg-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 12.0063C4 7.32539 4 5.07735 5.12315 3.99769C6.16098 3.00004 8.15971 3.00003 12.0017 3C12.5023 3 13.5006 3 14 3.09991C15.0142 3.3028 15.5 3.5 17.5 5.5C19.5 7.5 19.7028 8.01415 19.9 9C20 9.5 20.0028 11.7514 19.9972 12.2514C19.9473 16.7726 19.9232 18.9573 18.8194 20.0129C17.7873 20.9999 15.8235 21 12 21C8.18547 21 6.15464 20.9999 5.12139 20.0081C4 18.9317 4 16.6871 4 12.0063ZM8 10C8 10.5523 8.44771 11 9 11H15C15.5523 11 16 10.5523 16 10C16 9.44771 15.5523 9 15 9H9C8.44771 9 8 9.44771 8 10ZM9 13C8.44771 13 8 13.4477 8 14C8 14.5523 8.44771 15 9 15H13C13.5523 15 14 14.5523 14 14C14 13.4477 13.5523 13 13 13H9Z" fill="currentColor"/></svg>`;

const INCOMING_ARROW_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M12.5 3.5L3.5 12.5M3.5 12.5H10.5M3.5 12.5V5.5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const OUTGOING_ARROW_SVG = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3.5 12.5L12.5 3.5M12.5 3.5H5.5M12.5 3.5V10.5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function getHeadingBadgeHtml(heading) {
  const isInc = heading === 'INCOMING';
  const dirClass = isInc ? 'dir-INCOMING' : 'dir-OUTGOING';
  const titleText = formatHeadingRu(heading);
  const iconSvg = isInc ? INCOMING_ARROW_SVG : OUTGOING_ARROW_SVG;
  return `<span class="dir-badge dir-icon-badge ${dirClass}" title="Направление: ${titleText}">${iconSvg}</span>`;
}

function upnToTag(upn) {
  if (!upn) return '';
  const clean = String(upn).split('@')[0].trim();
  return clean ? `@${clean}` : '';
}

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

function initCustomDimensions() {
  const savedColW = localStorage.getItem('o3_sed_first_col_w');
  if (savedColW) document.documentElement.style.setProperty('--first-col-width', `${savedColW}px`);

  const savedTblH = localStorage.getItem('o3_sed_table_h');
  if (savedTblH) document.documentElement.style.setProperty('--table-height', `${savedTblH}px`);

  const savedDrwW = localStorage.getItem('o3_sed_drawer_w');
  if (savedDrwW) document.documentElement.style.setProperty('--drawer-width', `${savedDrwW}px`);
}

document.addEventListener('mousedown', (e) => {
  const colHandle = e.target.closest('.col-resizer');
  if (colHandle) {
    e.preventDefault();
    e.stopPropagation();
    const th = colHandle.parentElement;
    const startX = e.clientX;
    const startWidth = th.getBoundingClientRect().width;
    colHandle.classList.add('resizing');

    function onMoveCol(ev) {
      const newW = Math.max(190, Math.min(720, Math.round(startWidth + (ev.clientX - startX))));
      document.documentElement.style.setProperty('--first-col-width', `${newW}px`);
      localStorage.setItem('o3_sed_first_col_w', String(newW));
    }
    function onUpCol() {
      colHandle.classList.remove('resizing');
      document.removeEventListener('mousemove', onMoveCol);
      document.removeEventListener('mouseup', onUpCol);
    }
    document.addEventListener('mousemove', onMoveCol);
    document.addEventListener('mouseup', onUpCol);
    return;
  }

  const tblHandle = e.target.closest('.table-height-resizer');
  if (tblHandle) {
    e.preventDefault();
    const wrap = tblHandle.previousElementSibling;
    if (!wrap) return;
    const startY = e.clientY;
    const startHeight = wrap.getBoundingClientRect().height;
    tblHandle.classList.add('resizing');

    function onMoveTbl(ev) {
      const newH = Math.max(200, Math.min(window.innerHeight - 100, Math.round(startHeight + (ev.clientY - startY))));
      document.documentElement.style.setProperty('--table-height', `${newH}px`);
      localStorage.setItem('o3_sed_table_h', String(newH));
    }
    function onUpTbl() {
      tblHandle.classList.remove('resizing');
      document.removeEventListener('mousemove', onMoveTbl);
      document.removeEventListener('mouseup', onUpTbl);
    }
    document.addEventListener('mousemove', onMoveTbl);
    document.addEventListener('mouseup', onUpTbl);
    return;
  }

  const drwHandle = e.target.closest('#drawerResizer');
  if (drwHandle) {
    e.preventDefault();
    const drawer = document.getElementById('drillDrawer');
    const startX = e.clientX;
    const startWidth = drawer.getBoundingClientRect().width;
    drwHandle.classList.add('resizing');

    function onMoveDrw(ev) {
      const newW = Math.max(310, Math.min(window.innerWidth - 180, Math.round(startWidth - (ev.clientX - startX))));
      document.documentElement.style.setProperty('--drawer-width', `${newW}px`);
      localStorage.setItem('o3_sed_drawer_w', String(newW));
    }
    function onUpDrw() {
      drwHandle.classList.remove('resizing');
      document.removeEventListener('mousemove', onMoveDrw);
      document.removeEventListener('mouseup', onUpDrw);
    }
    document.addEventListener('mousemove', onMoveDrw);
    document.addEventListener('mouseup', onUpDrw);
  }
});

function bindSyncAccordions() {
  const accOver = document.getElementById('accOverdue');
  const accToday = document.getElementById('accDueToday');
  if (!accOver || !accToday) return;

  let isSyncing = false;
  accOver.addEventListener('toggle', () => {
    if (isSyncing) return;
    isSyncing = true;
    accToday.open = accOver.open;
    isSyncing = false;
  });
  accToday.addEventListener('toggle', () => {
    if (isSyncing) return;
    isSyncing = true;
    accOver.open = accToday.open;
    isSyncing = false;
  });
}

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

document.addEventListener('mouseover', (e) => {
  const btn = e.target.closest('[data-assigned-tip]');
  const tt = document.getElementById('assignedFloatingTooltip');
  if (!tt) return;
  if (!btn) {
    tt.style.display = 'none';
    return;
  }
  const key = btn.getAttribute('data-assigned-tip');
  const tip = assignedTooltipStore.get(key);
  const docs = tip && tip.docs;
  if (!docs || !docs.length) {
    tt.style.display = 'none';
    return;
  }

  const refNow = STATE.executors.fetchedAt || new Date().toISOString();
  const sorted = [...docs].sort((a, b) => new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0));
  const maxShow = 18;
  const shown = sorted.slice(0, maxShow);

  const itemLabel = docs.some(d => d.isInternalRequest) ? 'элем.' : 'док.';
  let html = `<div class="aft-title">${tip.label}: ${docs.length} ${itemLabel} (время с посл. апдейта)</div>`;
  html += shown.map(d => {
    const dur = formatStatusDuration(d.updatedAt || d.createdAt, refNow) || 'только что';
    const typeName = d.isInternalRequest ? `Внутренний запрос · ${getInternalRequestCategory(d)}` : getDocType(d);
    const docNum = d.isInternalRequest ? d.internalRequestId : d.documentName || '';
    return `<div class="aft-row">
      <div class="aft-type">${escapeHtml(typeName)}<span class="aft-doc">${docNum ? `(${escapeHtml(docNum)})` : ''}</span></div>
      <div class="aft-dur" style="display:inline-flex; align-items:center; gap:3px;">${STOPWATCH_ICON_SVG} ${dur}</div>
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

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('o3_sed_theme', theme);
  const btn = document.getElementById('btnThemeToggle');
  if (btn) btn.innerText = theme === 'dark' ? '☀️ Светлая' : '🌙 Тёмная';
}

document.getElementById('btnThemeToggle').onclick = () => {
  const cur = document.body.getAttribute('data-theme') || 'light';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
};

const multiSelectRegistry = new Map();

function initMultiSelect(containerId, labelText, placeholderText, onChange) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const state = { containerId, labelText, placeholderText, options: [], selected: new Set(), onChange };
  multiSelectRegistry.set(containerId, state);

  el.innerHTML = `
    <div class="o3-field-label">${labelText}</div>
    <div class="o3-field-value" style="color:var(--o3-text-sec);">${placeholderText}</div>
    <span class="o3-field-arrow">▼</span>
    <div class="o3-dropdown">
      <div class="o3-dd-search-wrap"><input type="text" class="o3-dd-search" placeholder="Поиск..."></div>
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
    if (val === '__CLEAR_ALL__') state.selected.clear();
    else if (state.selected.has(val)) state.selected.delete(val);
    else state.selected.add(val);

    updateMultiSelectHeader(state);
    renderMultiSelectOptions(state, searchInput ? searchInput.value : '');
    if (state.onChange) state.onChange();
  });

  if (searchInput) {
    searchInput.addEventListener('input', (e) => renderMultiSelectOptions(state, e.target.value));
  }
}

function setMultiSelectOptions(containerId, items, customLabels = {}) {
  const state = multiSelectRegistry.get(containerId);
  if (!state) return;
  state.options = items.map(v => ({ value: String(v), label: customLabels[v] || String(v) }));
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
    const labels = state.options.filter(o => state.selected.has(o.value)).map(o => o.label);
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

function setFiltersSkeleton(prefix, show) {
  const fields = ['Entity', 'Heading', 'DocType', 'Group', 'Person', 'Queue', 'Mark'];
  fields.forEach(f => {
    const containerId = `${prefix}Wrap${f}`;
    const el = document.getElementById(containerId);
    const st = multiSelectRegistry.get(containerId);
    if (!el || !st) return;
    const valEl = el.querySelector('.o3-field-value');
    if (!valEl) return;

    if (show) {
      el.classList.remove('open');
      el.classList.add('loading-sk');
      valEl.innerHTML = `<span class="sk-filter-val"></span>`;
    } else {
      el.classList.remove('loading-sk');
      updateMultiSelectHeader(st);
    }
  });
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.o3-field')) closeAllMultiSelects();
  if (!e.target.closest('.op-picker-wrap')) {
    document.querySelectorAll('.op-picker-dd.open').forEach(el => el.classList.remove('open'));
  }
});

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
    let html = `<span class="log-time">[${timeStr}]</span><span class="log-${level}">${message}</span>`;
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
    prefix: 'ex', mode: 'executors', roleTitle: 'Исполнитель', dateColName: 'Дата_Закрытия',
    docs: [], fetchedAt: null, collapsedGroups: new Set(), expandedUsers: new Set(), expandedGroupDocTypes: new Set(), totalDocTypesExpanded: false,
    expandedGroupRequestCategories: new Set(), expandedUserRequestCategories: new Set(), totalRequestCategoriesExpanded: false,
    allUsersExpanded: false, isMarksExpanded: true, lastExportRows: [], hasLoadedOnce: false
  },
  registrars: {
    prefix: 'rg', mode: 'registrars', roleTitle: 'Регистратор', dateColName: 'Дата_Создания',
    docs: [], fetchedAt: null, collapsedGroups: new Set(), expandedUsers: new Set(), expandedGroupDocTypes: new Set(), totalDocTypesExpanded: false,
    expandedGroupRequestCategories: new Set(), expandedUserRequestCategories: new Set(), totalRequestCategoriesExpanded: false,
    allUsersExpanded: false, isMarksExpanded: true, lastExportRows: [], hasLoadedOnce: false
  }
};

function formatYMDToRu(ymd) {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}

function formatDateOnlyRu(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return String(isoStr);
  return d.toLocaleDateString('ru-RU');
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
  if (!personLabel || personLabel === 'Не назначен' || personLabel === 'Не указан') return { html: '', text: '' };
  const rawSt = (statusInfo && statusInfo.status) ? statusInfo.status : 'UNKNOWN_STATUS';
  const meta = OPERATOR_STATUS_MAP[rawSt] || OPERATOR_STATUS_MAP.UNKNOWN_STATUS;
  const dur = formatStatusDuration(statusInfo && statusInfo.setAt, fetchedAtIso);
  const durPart = dur ? ` <span class="op-status-dur">· ${dur}</span>` : '';
  const sinceTitle = (statusInfo && statusInfo.setAt) ? `Установлен: ${formatDateTimeWithSecRu(statusInfo.setAt)}` : 'Время установки статуса не найдено';
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
  return dashIdx > 0 ? name.slice(0, dashIdx).trim().toUpperCase() : 'Без префикса';
}

function getOperatorLabel(d) {
  const t = d.ticket || {};
  const opInfo = d.operatorInfo || {};
  const upn = (t.operator && t.operator.upn) || '';
  if (!upn) return 'Не назначен';
  return opInfo.fullName ? `${opInfo.fullName} (${upn})` : upn;
}

function getOperatorUpn(d) { return (d.ticket && d.ticket.operator && d.ticket.operator.upn) || ''; }
function getOperatorGroup(d) { return (d.operatorInfo && d.operatorInfo.groupName) || 'Без группы'; }

function getCreatorLabel(d) {
  const t = d.ticket || {};
  const crInfo = d.creatorInfo || {};
  const upn = t.creator || '';
  if (!upn) return 'Не указан';
  return crInfo.fullName ? `${crInfo.fullName} (${upn})` : upn;
}

function getCreatorUpn(d) { return (d.ticket && d.ticket.creator) || ''; }
function getCreatorGroup(d) { return (d.creatorInfo && d.creatorInfo.groupName) || 'Без группы'; }
function getOrigin(d) {
  const t = d && d.ticket || {};
  const value = d && (d.origin || d.firstOrigin) || t.origin || t.firstOrigin || '';
  return String(value || 'Не указано');
}
function getInternalRequestCategory(d) {
  const alertType = (d && (d.alertType || (d.ticket && d.ticket.alertType))) || null;
  if (typeof alertType === 'string') return alertType || 'Не указана';
  if (alertType && typeof alertType === 'object') {
    return String(alertType.name || alertType.title || alertType.label || alertType.code || alertType.id || 'Не указана');
  }
  return String((d && d.alertTypeName) || (d && d.ticket && d.ticket.alertTypeName) || 'Не указана');
}
function getPersonByMode(d, mode) { return mode === 'registrars' ? getCreatorLabel(d) : getOperatorLabel(d); }
function getPersonUpnByMode(d, mode) { return mode === 'registrars' ? getCreatorUpn(d) : getOperatorUpn(d); }
function getGroupByMode(d, mode) { return mode === 'registrars' ? getCreatorGroup(d) : getOperatorGroup(d); }

function getPersonStatusInfoByMode(d, mode) {
  const info = mode === 'registrars' ? d.creatorInfo : d.operatorInfo;
  if (!info) return { status: 'UNKNOWN_STATUS', setAt: null };
  return { status: info.currentStatus || 'UNKNOWN_STATUS', setAt: info.statusSetAt || null };
}

function getDocType(d) { return d.documentTypeName || 'Не указан'; }
function getQueueName(d) { return (d.ticket && d.ticket.queue && d.ticket.queue.name) || 'Без очереди'; }
function getMarksArray(d) { return (Array.isArray(d.ticketMarks) ? d.ticketMarks : []).map(m => m && m.name).filter(Boolean); }

function getSkCardsMarkup() {
  return `<div style="padding:12px;">
    <div class="sk-line" style="height:54px;"></div>
    <div class="sk-line" style="height:54px;"></div>
    <div class="sk-line" style="height:54px; margin-bottom:0;"></div>
  </div>`;
}

function showSkeleton(prefix, show) {
  document.getElementById(`${prefix}Skeleton`).style.display = show ? 'block' : 'none';
  document.getElementById(`${prefix}Table`).style.display = show ? 'none' : 'table';

  setFiltersSkeleton(prefix, show);

  const asOfEl = document.getElementById(`${prefix}AsOfTime`);
  if (asOfEl && show) {
    asOfEl.innerHTML = `<span class="sk-inline"></span>`;
  }

  if (prefix === 'ex' && show) {
    const skCardsHtml = getSkCardsMarkup();
    const lOver = document.getElementById('listOverdue');
    const lToday = document.getElementById('listDueToday');
    if (lOver) lOver.innerHTML = skCardsHtml;
    if (lToday) lToday.innerHTML = skCardsHtml;

    const bOver = document.getElementById('badgeOverdueCount');
    const bToday = document.getElementById('badgeDueTodayCount');
    if (bOver) bOver.innerHTML = `<span class="sk-pill"></span>`;
    if (bToday) bToday.innerHTML = `<span class="sk-pill"></span>`;
  }
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
    await chrome.scripting.executeScript({ target: { tabId }, files: ['bridge.js'], world: 'ISOLATED' });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['injector.js'], world: 'MAIN' });
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

  const dueDateInput = document.getElementById('dueTargetDate');
  const dueDateYMD = (dueDateInput && dueDateInput.value) || dateYMD;

  if (mode === 'executors') isDeadlinesLoading = true;

  document.getElementById(`${p}SysDate`).innerText = formatYMDToRu(dateYMD);
  showSkeleton(p, true);
  setProgress(p, true, `Подключение к crm.bank.ozon.ru и запрос документов за ${formatYMDToRu(dateYMD)}...`);

  addLog('info', `Запуск обновления виджета [${mode}] за дату ${dateYMD}`);

  const tab = await findSedTab();
  if (!tab) {
    isDeadlinesLoading = false;
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
      payload: { dateYMD, mode, dueDateYMD }
    });
  } catch (e) {
    isDeadlinesLoading = false;
    showSkeleton(p, false);
    setProgress(p, true, 'Ошибка связи со вкладкой СЭД: ' + e.message);
    addLog('error', 'Ошибка при отправке команды FETCH_DATE', e.stack || e.message);
  }
}

async function fetchCustomDueDateOnly() {
  const dueDateInput = document.getElementById('dueTargetDate');
  const dueDateYMD = dueDateInput ? dueDateInput.value : '';
  if (!dueDateYMD) return;

  isDueDateSingleLoading = true;
  const lToday = document.getElementById('listDueToday');
  const bToday = document.getElementById('badgeDueTodayCount');
  if (lToday) lToday.innerHTML = getSkCardsMarkup();
  if (bToday) bToday.innerHTML = `<span class="sk-pill"></span>`;

  const tab = await findSedTab();
  if (!tab) {
    isDueDateSingleLoading = false;
    renderDeadlineAccordions();
    return;
  }

  try {
    await ensureConnectionAndSend(tab.id, {
      target: 'INJECTOR',
      type: 'FETCH_DUE_DATE',
      payload: { dueDateYMD }
    });
  } catch (e) {
    isDueDateSingleLoading = false;
    renderDeadlineAccordions();
  }
}

function filterAlertDocsByExecutorsUI(docs, section) {
  const p = 'ex';
  const selEntities = getMultiSelectValues(`${p}WrapEntity`);
  const selHeadings = getMultiSelectValues(`${p}WrapHeading`);
  const selDocTypes = getMultiSelectValues(`${p}WrapDocType`);
  const selGroups = getMultiSelectValues(`${p}WrapGroup`);
  const selPersons = getMultiSelectValues(`${p}WrapPerson`);
  const selQueues = getMultiSelectValues(`${p}WrapQueue`);
  const selOrigins = getMultiSelectValues(`${p}WrapOrigin`);
  const alertSuffix = section === 'Overdue' ? 'Overdue' : 'DueToday';
  const selAlertQueues = getMultiSelectValues(`alertQueueFilter${alertSuffix}`);
  const selAlertOrigins = getMultiSelectValues(`alertOriginFilter${alertSuffix}`);
  const selMarks = getMultiSelectValues(`${p}WrapMark`);

  return (docs || []).filter(d => {
    if (selEntities.size > 0 && !selEntities.has(getLegalEntity(d))) return false;
    if (selHeadings.size > 0 && !selHeadings.has(d.heading || '')) return false;
    if (selDocTypes.size > 0 && !selDocTypes.has(getDocType(d))) return false;
    if (selGroups.size > 0 && !selGroups.has(getOperatorGroup(d))) return false;
    if (selPersons.size > 0 && !selPersons.has(getOperatorLabel(d))) return false;
    if (selQueues.size > 0 && !selQueues.has(getQueueName(d))) return false;
    if (selOrigins.size > 0 && !selOrigins.has(getOrigin(d))) return false;
    if (selAlertQueues.size > 0 && !selAlertQueues.has(getQueueName(d))) return false;
    if (selAlertOrigins.size > 0 && !selAlertOrigins.has(getOrigin(d))) return false;

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

function getSectionFilteredDocs(section) {
  return section === 'Overdue' ? filteredOverdueDocs : filteredDueTodayDocs;
}

function updateAssignToolbarState(section) {
  const st = ASSIGN_STATE[section];
  if (!st) return;

  const docs = getSectionFilteredDocs(section);
  const validAlertIds = new Set(docs.map(d => Number(d.ticket && d.ticket.id)).filter(Boolean));

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
    const assignLabel = st.isAssigning
      ? 'Назначение...'
      : (st.selectedAlertIds.size > 0 ? `Назначить (${st.selectedAlertIds.size})` : 'Назначить');
    btnAssignEl.innerHTML = `${ASSIGN_ICON_SVG} <span>${assignLabel}</span>`;
  }

  const btnPushEl = document.getElementById(`btnPush${section}`);
  if (btnPushEl) {
    btnPushEl.disabled = st.selectedAlertIds.size === 0;
    const pushLabel = st.selectedAlertIds.size > 0
      ? `Уведомить (${st.selectedAlertIds.size})`
      : 'Уведомить';
    btnPushEl.innerHTML = `${BELL_ICON_SVG} <span>${pushLabel}</span>`;
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

    const creatorActions = buildPersonActionButtonsHtml(getCreatorUpn(d));
    const operatorActions = buildPersonActionButtonsHtml(getOperatorUpn(d));

    return `<div class="doc-card ${isChecked ? 'selected-doc' : ''}" data-card-alert-id="${alertId}">
      <div class="doc-top">
        <div style="display:flex; align-items:center; gap:7px;">
          ${alertId ? `<input type="checkbox" class="doc-check-input" data-doc-check="${section}" data-alert-id="${alertId}" ${isChecked ? 'checked' : ''} title="Выбрать документ">` : ''}
          <a href="${docUrl}" target="_blank" title="Открыть карточку документа в СЭД">${DOC_ICON_SVG}<span>${docTitle} ↗</span></a>
        </div>
        <div class="doc-badges-row">
          ${alertId ? `<button type="button" class="btn-single-assign" data-single-assign="${section}" data-alert-id="${alertId}" title="Назначить этот документ на выбранного сверху оператора">${ASSIGN_ICON_SVG}</button>` : ''}
          ${alertId ? `<button type="button" class="btn-single-push" data-single-push="${section}" data-alert-id="${alertId}" title="Отправить напоминание по этому документу в Chatzone">${BELL_ICON_SVG}</button>` : ''}
          ${getHeadingBadgeHtml(d.heading)}
          <span class="dir-badge badge-entity">ЮЛ: ${getLegalEntity(d)}</span>
          <span class="dir-badge badge-status">${formatTicketStatusRu(t.status)}</span>
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
  if (isDeadlinesLoading) return;
  filteredOverdueDocs = filterAlertDocsByExecutorsUI(rawOverdueDocs, 'Overdue');
  filteredDueTodayDocs = filterAlertDocsByExecutorsUI(rawDueTodayDocs, 'DueToday');

  const bOver = document.getElementById('badgeOverdueCount');
  const lOver = document.getElementById('listOverdue');
  if (bOver) bOver.innerText = filteredOverdueDocs.length;
  if (lOver) lOver.innerHTML = renderDeadlineCardsList(filteredOverdueDocs, 'Overdue');
  updateAssignToolbarState('Overdue');

  if (!isDueDateSingleLoading) {
    const bToday = document.getElementById('badgeDueTodayCount');
    const lToday = document.getElementById('listDueToday');
    if (bToday) bToday.innerText = filteredDueTodayDocs.length;
    if (lToday) lToday.innerHTML = renderDeadlineCardsList(filteredDueTodayDocs, 'DueToday');
    updateAssignToolbarState('DueToday');
  }
}

function bindDeadlineFilterControls() {
  [['Overdue', rawOverdueDocs], ['DueToday', rawDueTodayDocs]].forEach(([section]) => {
    const suffix = section === 'Overdue' ? 'Overdue' : 'DueToday';
    initMultiSelect(`alertOriginFilter${suffix}`, 'Происхождение', 'Все происхождения', renderDeadlineAccordions);
    initMultiSelect(`alertQueueFilter${suffix}`, 'Очередь', 'Все очереди', renderDeadlineAccordions);
  });
  populateDeadlineFilterOptions();
}

function populateDeadlineFilterOptions() {
  const sets = [
    ['Overdue', rawOverdueDocs],
    ['DueToday', rawDueTodayDocs]
  ];
  sets.forEach(([section, docs]) => {
    const suffix = section === 'Overdue' ? 'Overdue' : 'DueToday';
    setMultiSelectOptions(`alertOriginFilter${suffix}`, Array.from(new Set(docs.map(getOrigin))).sort());
    setMultiSelectOptions(`alertQueueFilter${suffix}`, Array.from(new Set(docs.map(getQueueName))).sort());
  });
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
    await ensureConnectionAndSend(tab.id, { target: 'INJECTOR', type: 'SEARCH_OPERATORS', payload: { section, query: queryText } });
  } catch (err) {
    if (ddEl) ddEl.innerHTML = `<div class="op-dd-empty" style="color:var(--o3-red);">Ошибка: ${err.message}</div>`;
  }
}

function renderOperatorDropdownItems(section, items) {
  if (section && section.startsWith('PushQ_')) {
    renderPushModalOperatorDropdown(section, items);
    return;
  }

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

// =========================================================================
// ЛОГИКА РАССЫЛКИ НАПОМИНАНИЙ В CHATZONE (МОДАЛКА "ДОПОЛНИТЕЛЬНЫЕ ТЕГИ")
// =========================================================================
function openPushModalForAlertIds(section, alertIds) {
  const idSet = new Set((alertIds || []).map(Number).filter(Boolean));
  const sourceDocs = getSectionFilteredDocs(section);
  const selectedDocs = sourceDocs.filter(d => d.ticket && idSet.has(Number(d.ticket.id)));
  if (!selectedDocs.length) {
    alert('Выберите хотя бы один документ для отправки уведомления!');
    return;
  }

  PUSH_MODAL_STATE.section = section;
  PUSH_MODAL_STATE.docs = selectedDocs;
  PUSH_MODAL_STATE.queuesList = [];
  PUSH_MODAL_STATE.extraOperatorsByQueue.clear();
  PUSH_MODAL_STATE.isSending = false;

  const grouped = new Map();
  selectedDocs.forEach(d => {
    const qName = getQueueName(d);
    if (!grouped.has(qName)) grouped.set(qName, []);
    grouped.get(qName).push(d);
  });

  let idx = 0;
  for (const [queueName, qDocs] of grouped.entries()) {
    const queueKey = `PushQ_${++idx}`;
    PUSH_MODAL_STATE.queuesList.push({ queueKey, queueName, docs: qDocs });
    PUSH_MODAL_STATE.extraOperatorsByQueue.set(queueKey, new Map());
  }

  renderPushModalTable();
  updatePushModalPreview();

  const statusEl = document.getElementById('pushModalStatus');
  if (statusEl) statusEl.innerText = '';
  const btnSend = document.getElementById('btnConfirmPushSend');
  if (btnSend) {
    btnSend.disabled = false;
    btnSend.innerText = `Отправить в Chatzone (${PUSH_MODAL_STATE.queuesList.length} сообщ.)`;
  }

  document.getElementById('pushModal').classList.add('open');
}

function renderPushModalTable() {
  const tbody = document.getElementById('pushModalTableBody');
  if (!tbody) return;

  tbody.innerHTML = PUSH_MODAL_STATE.queuesList.map(q => {
    const typeCounts = new Map();
    q.docs.forEach(d => {
      const tName = getDocType(d);
      typeCounts.set(tName, (typeCounts.get(tName) || 0) + 1);
    });
    const typesSummary = Array.from(typeCounts.entries())
      .map(([tName, cnt]) => cnt > 1 ? `${tName} (${cnt})` : tName)
      .join(', ');

    return `<tr data-push-queue-row="${q.queueKey}">
      <td>
        <div style="font-weight:700; color:var(--o3-text);">${q.queueName}</div>
        <div style="font-size:11px; color:var(--o3-text-sec); margin-top:2px;">Документов: <strong>${q.docs.length} шт.</strong></div>
        <div style="font-size:11px; color:var(--o3-text-sec); margin-top:2px;">Типы: ${typesSummary}</div>
      </td>
      <td>
        <div id="chips_${q.queueKey}" class="tag-chips-wrap"></div>
        <div class="op-picker-wrap">
          <input type="text" id="opInput${q.queueKey}" class="op-picker-input" data-push-qkey="${q.queueKey}" placeholder="Найти и добавить операторов по ФИО или email..." autocomplete="off">
          <div id="opDd${q.queueKey}" class="op-picker-dd" data-push-dd="${q.queueKey}"></div>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderQueueChips(queueKey) {
  const wrap = document.getElementById(`chips_${queueKey}`);
  const map = PUSH_MODAL_STATE.extraOperatorsByQueue.get(queueKey);
  if (!wrap || !map) return;

  wrap.innerHTML = Array.from(map.values()).map(op => {
    const safeUpn = op.upn.replace(/"/g, '&quot;');
    return `<span class="tag-chip" title="${op.fullName} (${op.upn})">
      ${op.tag} <span style="font-weight:400; opacity:0.85;">(${op.fullName || op.upn})</span>
      <button type="button" data-remove-chip-q="${queueKey}" data-remove-chip-upn="${safeUpn}" title="Удалить тег">✕</button>
    </span>`;
  }).join('');
}

function renderPushModalOperatorDropdown(queueKey, items) {
  const ddEl = document.getElementById(`opDd${queueKey}`);
  if (!ddEl) return;

  if (!items || items.length === 0) {
    ddEl.innerHTML = `<div class="op-dd-empty">Операторы не найдены</div>`;
    ddEl.classList.add('open');
    return;
  }

  const selectedMap = PUSH_MODAL_STATE.extraOperatorsByQueue.get(queueKey) || new Map();

  ddEl.innerHTML = items.map(op => {
    const isSel = selectedMap.has(op.upn);
    const safeName = String(op.fullName || '').replace(/"/g, '&quot;');
    const safeUpn = String(op.upn || '').replace(/"/g, '&quot;');
    const tag = upnToTag(op.upn);
    return `<div class="op-dd-option ${isSel ? 'active' : ''}" data-push-opt-q="${queueKey}" data-op-id="${op.id}" data-op-name="${safeName}" data-op-upn="${safeUpn}">
      <span class="op-dd-name">${op.fullName || op.upn} ${isSel ? '✓' : ''}</span>
      <span class="op-dd-upn">${tag} (${op.upn})</span>
    </div>`;
  }).join('');
  ddEl.classList.add('open');
}

function buildQueueMessagesList() {
  const isOverdue = PUSH_MODAL_STATE.section === 'Overdue';

  return PUSH_MODAL_STATE.queuesList.map(q => {
    const extraMap = PUSH_MODAL_STATE.extraOperatorsByQueue.get(q.queueKey) || new Map();
    const extraTagsArr = Array.from(extraMap.values()).map(op => op.tag).filter(Boolean);
    const extraTagsStr = extraTagsArr.join(' ');

    const lines = q.docs.map(d => {
      const docNum = d.documentName || d.id;
      const docType = getDocType(d);
      const docUrl = `${CRM_BASE_URL}/sed/document/${encodeURIComponent(d.id)}`;
      const docMarkdownLink = `[${docNum}](${docUrl})`;
      const deadlineDate = formatDateOnlyRu(d.deadline);
      const execTag = upnToTag(getOperatorUpn(d));

      const tagsForDoc = [execTag, extraTagsStr].filter(Boolean).join(' ');
      const parts = [];
      if (isOverdue) {
        parts.push('Просроченный документ!');
      }
      parts.push(docMarkdownLink, docType, deadlineDate);
      if (tagsForDoc) parts.push(tagsForDoc);
      return parts.join(' , ');
    });

    const messageText = `## ${q.queueName}\n` + lines.join('\n');
    return {
      queueName: q.queueName,
      messageText
    };
  });
}

function updatePushModalPreview() {
  const previewEl = document.getElementById('pushPreviewBox');
  if (!previewEl) return;
  const msgs = buildQueueMessagesList();
  previewEl.textContent = msgs.map((m, idx) => `--- Сообщение #${idx + 1} (${m.queueName}) ---\n${m.messageText}`).join('\n\n');
}

async function sendSingleChatzonePost(messageText) {
  let csrfToken = '';
  try {
    if (chrome.cookies && chrome.cookies.get) {
      const cookie = await chrome.cookies.get({ url: 'https://chatzone.o3t.ru', name: 'MMCSRF' });
      if (cookie && cookie.value) csrfToken = cookie.value;
    }
  } catch (e) {}

  const headers = {
    'accept': 'application/json',
    'content-type': 'application/json',
    'x-requested-with': 'XMLHttpRequest'
  };
  if (csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }

  const bodyObj = {
    file_ids: [],
    message: messageText,
    props: { hidePreview: false },
    metadata: {},
    channel_id: CHATZONE_TARGET_CHANNEL_ID,
    root_id: "",
    create_at: 0,
    update_at: Date.now(),
    reply_count: 0
  };

  const res = await fetch(CHATZONE_POSTS_API_URL, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(bodyObj)
  });

  if (!res.ok) {
    let errTxt = '';
    try { errTxt = await res.text(); } catch (e) {}
    throw new Error(`HTTP ${res.status}: ${errTxt.slice(0, 150)}`);
  }
  return res.json();
}

async function executePushMessagesSend() {
  if (PUSH_MODAL_STATE.isSending) return;
  const messages = buildQueueMessagesList();
  if (!messages.length) return;

  PUSH_MODAL_STATE.isSending = true;
  const statusEl = document.getElementById('pushModalStatus');
  const btnSend = document.getElementById('btnConfirmPushSend');
  if (btnSend) btnSend.disabled = true;

  let sentCount = 0;
  try {
    for (let i = 0; i < messages.length; i++) {
      const item = messages[i];
      if (statusEl) {
        statusEl.style.color = 'var(--o3-blue)';
        statusEl.innerText = `⏳ Отправка сообщения ${i + 1} из ${messages.length} (${item.queueName})...`;
      }
      await sendSingleChatzonePost(item.messageText);
      sentCount++;
      addLog('success', `Отправлено уведомление в Chatzone по очереди «${item.queueName}»`);
    }

    if (statusEl) {
      statusEl.style.color = 'var(--o3-green)';
      statusEl.innerText = `✅ Успешно отправлено ${sentCount} сообщ. в Chatzone!`;
    }
    setTimeout(() => {
      document.getElementById('pushModal').classList.remove('open');
    }, 900);
  } catch (err) {
    addLog('error', `Ошибка отправки в Chatzone: ${err.message}`);
    if (statusEl) {
      statusEl.style.color = 'var(--o3-red)';
      statusEl.innerText = `❌ Ошибка: ${err.message} (убедитесь, что вы авторизованы в chatzone.o3t.ru)`;
    }
    if (btnSend) btnSend.disabled = false;
  } finally {
    PUSH_MODAL_STATE.isSending = false;
  }
}

function bindPushModalEvents() {
  const modalEl = document.getElementById('pushModal');
  const tbody = document.getElementById('pushModalTableBody');
  const btnClose = document.getElementById('btnClosePushModal');
  const btnCancel = document.getElementById('btnCancelPushModal');
  const btnConfirm = document.getElementById('btnConfirmPushSend');

  const closeModal = () => {
    if (modalEl) modalEl.classList.remove('open');
  };
  if (btnClose) btnClose.onclick = closeModal;
  if (btnCancel) btnCancel.onclick = closeModal;
  if (btnConfirm) btnConfirm.onclick = () => executePushMessagesSend();

  if (tbody) {
    tbody.addEventListener('focusin', (e) => {
      const inp = e.target.closest('[data-push-qkey]');
      if (!inp) return;
      const qKey = inp.getAttribute('data-push-qkey');
      requestOperatorsSearch(qKey, inp.value.trim());
    });

    tbody.addEventListener('input', (e) => {
      const inp = e.target.closest('[data-push-qkey]');
      if (!inp) return;
      const qKey = inp.getAttribute('data-push-qkey');
      const prevTimer = PUSH_MODAL_STATE.debounceTimers.get(qKey);
      if (prevTimer) clearTimeout(prevTimer);

      const timer = setTimeout(() => {
        requestOperatorsSearch(qKey, inp.value.trim());
      }, 260);
      PUSH_MODAL_STATE.debounceTimers.set(qKey, timer);
    });

    tbody.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('[data-remove-chip-q]');
      if (removeBtn) {
        e.preventDefault();
        e.stopPropagation();
        const qKey = removeBtn.getAttribute('data-remove-chip-q');
        const upn = removeBtn.getAttribute('data-remove-chip-upn');
        const map = PUSH_MODAL_STATE.extraOperatorsByQueue.get(qKey);
        if (map && upn) {
          map.delete(upn);
          renderQueueChips(qKey);
          updatePushModalPreview();
        }
        return;
      }

      const opt = e.target.closest('[data-push-opt-q]');
      if (opt) {
        e.preventDefault();
        e.stopPropagation();
        const qKey = opt.getAttribute('data-push-opt-q');
        const upn = opt.getAttribute('data-op-upn') || '';
        const fullName = opt.getAttribute('data-op-name') || '';
        const id = Number(opt.getAttribute('data-op-id'));
        const tag = upnToTag(upn);

        if (qKey && upn && tag) {
          const map = PUSH_MODAL_STATE.extraOperatorsByQueue.get(qKey);
          if (map) {
            if (map.has(upn)) map.delete(upn);
            else map.set(upn, { id, fullName, upn, tag });
            renderQueueChips(qKey);
            updatePushModalPreview();
          }
        }
        const ddEl = document.getElementById(`opDd${qKey}`);
        if (ddEl) ddEl.classList.remove('open');
        const inpEl = document.getElementById(`opInput${qKey}`);
        if (inpEl) inpEl.value = '';
      }
    });
  }
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
  if (clearEl) clearEl.style.display = op ? 'block' : 'none';
  if (ddEl) ddEl.classList.remove('open');
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
  if (!tab) return alert('Не найдена открытая вкладка https://crm.bank.ozon.ru/!');

  st.isAssigning = true;
  updateAssignToolbarState(section);
  setAssignStatusLine(section, `⏳ Назначение 0 из ${alertIds.length} док. на ${st.selectedOperator.fullName}...`);

  try {
    await ensureConnectionAndSend(tab.id, {
      target: 'INJECTOR',
      type: 'ASSIGN_TICKETS',
      payload: { section, alertIds, operator: st.selectedOperator }
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
    t.operator = { id: Number(operator.id), upn: operator.upn };
    t.status = 'ASSIGNED';
    d.updatedAt = nowIso;
    d.operatorInfo = { ...fallbackInfo, fullName: fallbackInfo.fullName || operator.fullName || '' };
    return true;
  };

  const newlyAssignedDocs = [];
  [rawOverdueDocs, rawDueTodayDocs].forEach(arr => {
    arr.forEach(d => {
      if (updateDoc(d)) newlyAssignedDocs.push(d);
    });
  });

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
  const btnPushEl = document.getElementById(`btnPush${section}`);
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
      const q = st.selectedOperator ? '' : inputEl.value.trim();
      if (st.searchResults.length > 0 && !q) ddEl.classList.add('open');
      else requestOperatorsSearch(section, q);
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
      st.debounceTimer = setTimeout(() => requestOperatorsSearch(section, val.trim()), 260);
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
      selectAssignOperator(section, {
        id: Number(opt.getAttribute('data-op-id')),
        fullName: opt.getAttribute('data-op-name') || '',
        upn: opt.getAttribute('data-op-upn') || ''
      });
    });
  }

  if (btnAssignEl) {
    btnAssignEl.addEventListener('click', (e) => {
      e.preventDefault();
      triggerAssignTickets(section);
    });
  }

  if (btnPushEl) {
    btnPushEl.addEventListener('click', (e) => {
      e.preventDefault();
      openPushModalForAlertIds(section, Array.from(st.selectedAlertIds));
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
      if (singleBtn) {
        e.preventDefault();
        e.stopPropagation();
        const alertId = Number(singleBtn.getAttribute('data-alert-id'));
        if (alertId) triggerAssignTickets(section, [alertId]);
        return;
      }

      const pushSingleBtn = e.target.closest(`[data-single-push="${section}"]`);
      if (pushSingleBtn) {
        e.preventDefault();
        e.stopPropagation();
        const alertId = Number(pushSingleBtn.getAttribute('data-alert-id'));
        if (alertId) openPushModalForAlertIds(section, [alertId]);
      }
    });
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'LIVE_LOG' && msg.payload) {
    addLog(msg.payload.level, msg.payload.message, msg.payload.details, msg.payload.time);
    return;
  }
  if (msg.type === 'LIVE_PROGRESS') {
    const mode = (msg.payload && msg.payload.mode) || 'executors';
    setProgress(STATE[mode].prefix, true, msg.payload.text);
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
    isDeadlinesLoading = false;
    isDueDateSingleLoading = false;
    rawOverdueDocs = msg.payload.overdueDocs || [];
    rawDueTodayDocs = msg.payload.dueTodayDocs || [];
    rawAssignedDocs = msg.payload.assignedDocs || [];
    rawHoldDocs = msg.payload.onHoldDocs || [];
    rawClosedInternalRequestDocs = msg.payload.closedInternalRequests || [];
    rawInternalRequestsInWork = msg.payload.internalRequestsInWork || [];
    rawInternalRequestsOnHold = msg.payload.internalRequestsOnHold || [];
    populateDeadlineFilterOptions();
    populateDropdowns('executors');
    renderWidgetTable('executors');
    return;
  }
  if (msg.type === 'DUE_DATE_RESULT' && msg.payload) {
    isDueDateSingleLoading = false;
    rawDueTodayDocs = msg.payload.dueTodayDocs || [];
    populateDeadlineFilterOptions();
    ASSIGN_STATE.DueToday.selectedAlertIds.clear();
    populateDropdowns('executors');
    renderDeadlineAccordions();
    return;
  }
  if (msg.type === 'SEARCH_OPERATORS_RESULT' && msg.payload) {
    renderOperatorDropdownItems(msg.payload.section, msg.payload.items);
    return;
  }
  if (msg.type === 'SEARCH_OPERATORS_ERROR' && msg.payload) {
    const ddEl = document.getElementById(`opDd${msg.payload.section}`);
    if (ddEl) {
      ddEl.innerHTML = `<div class="op-dd-empty" style="color:var(--o3-red);">Ошибка: ${msg.payload.message}</div>`;
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
      setAssignStatusLine(section, `✅ Назначено ${succeededAlertIds.length} док. на ${operator.fullName} (${operator.upn})`, 'var(--o3-green)');
    } else {
      setAssignStatusLine(section, `⚠️ Назначено: ${succeededAlertIds.length}, ошибок: ${failedItems.length} (см. лог внизу)`, 'var(--o3-amber)');
    }
    setTimeout(() => {
      if (ASSIGN_STATE[section] && !ASSIGN_STATE[section].isAssigning) setAssignStatusLine(section, '');
    }, 5000);
    return;
  }
  if (msg.type === 'LIVE_ERROR') {
    const mode = (msg.payload && msg.payload.mode) || 'executors';
    if (mode === 'executors') {
      isDeadlinesLoading = false;
      isDueDateSingleLoading = false;
    }
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
  const entities = new Set(), docTypes = new Set(), groups = new Set(), persons = new Set(), queues = new Set(), origins = new Set(), marks = new Set();
  const documentSourceDocs = mode === 'executors' ? [...st.docs, ...rawOverdueDocs, ...rawDueTodayDocs, ...rawAssignedDocs, ...rawHoldDocs] : st.docs;
  const sourceDocs = mode === 'executors' ? [...documentSourceDocs, ...rawClosedInternalRequestDocs, ...rawInternalRequestsInWork, ...rawInternalRequestsOnHold] : st.docs;

  documentSourceDocs.forEach(d => {
    entities.add(getLegalEntity(d));
    docTypes.add(getDocType(d));
    getMarksArray(d).forEach(m => marks.add(m));
  });
  sourceDocs.forEach(d => {
    groups.add(getGroupByMode(d, mode));
    persons.add(getPersonByMode(d, mode));
    queues.add(getQueueName(d));
    origins.add(getOrigin(d));
  });

  setMultiSelectOptions(`${p}WrapEntity`, Array.from(entities).sort());
  setMultiSelectOptions(`${p}WrapHeading`, ['INCOMING', 'OUTGOING'], { 'INCOMING': 'Входящие (INCOMING)', 'OUTGOING': 'Исходящие (OUTGOING)' });
  setMultiSelectOptions(`${p}WrapDocType`, Array.from(docTypes).sort());
  setMultiSelectOptions(`${p}WrapGroup`, Array.from(groups).sort());
  setMultiSelectOptions(`${p}WrapPerson`, Array.from(persons).sort());
  setMultiSelectOptions(`${p}WrapQueue`, Array.from(queues).sort());
  setMultiSelectOptions(`${p}WrapOrigin`, Array.from(origins).sort());
  setMultiSelectOptions(`${p}WrapMark`, ['__ANY__', '__NONE__', ...Array.from(marks).sort()], { '__ANY__': 'С метками', '__NONE__': 'Без меток' });
}

function makeDrillCell(docsArr, title, sub, mode, extraClass = '') {
  const cnt = docsArr ? docsArr.length : 0;
  const clsAttr = extraClass ? ` class="${extraClass}"` : '';
  if (cnt === 0) return `<td class="cell-zero ${extraClass}">0</td>`;
  const key = `d_${++cellSeq}`;
  drillStore.set(key, { docs: docsArr, title, sub, mode });
  return `<td${clsAttr}><span class="cell-btn" title="Нажмите для просмотра графика активности и документов (${cnt} шт.)" data-drill="${key}">${cnt}</span></td>`;
}

function makeAssignedCell(docsArr, title, sub, label = 'В работе (ASSIGNED)') {
  const cnt = docsArr ? docsArr.length : 0;
  if (cnt === 0) return `<td class="cell-zero">0</td>`;
  const key = `as_${++cellSeq}`;
  drillStore.set(key, { docs: docsArr, title, sub, mode: 'executors' });
  assignedTooltipStore.set(key, { docs: docsArr, label });
  return `<td><span class="cell-btn assigned-btn" data-drill="${key}" data-assigned-tip="${key}">${cnt}</span></td>`;
}

function makeInternalRequestCell(docs, expansionKey = '', expanded = false, dateRu = '') {
  const requestDocs = Array.isArray(docs) ? docs : [];
  const cnt = requestDocs.filter(d => d.ticket && d.ticket.status === 'CLOSED').length;
  const canExpand = requestDocs.length > 0 && expansionKey;
  const toggle = canExpand ? `<button class="request-category-toggle" data-request-categories="${expansionKey}" title="Раскрыть по категории (типу внутреннего запроса)">${expanded ? '▾' : '▸'}</button>` : '';
  return cnt > 0
    ? `<td class="internal-request-cell" title="Закрытые внутренние запросы за ${dateRu}"><span>${cnt}</span>${toggle}</td>`
    : `<td class="cell-zero internal-request-cell" title="Закрытые внутренние запросы за ${dateRu}">0${toggle}</td>`;
}

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
  const selOrigins = getMultiSelectValues(`${p}WrapOrigin`);
  const selMarks = getMultiSelectValues(`${p}WrapMark`);

  const matchesActiveFilters = (d) => {
    if (selEntities.size > 0 && !selEntities.has(getLegalEntity(d))) return false;
    if (selHeadings.size > 0 && !selHeadings.has(d.heading || '')) return false;
    if (selDocTypes.size > 0 && !selDocTypes.has(getDocType(d))) return false;
    if (selGroups.size > 0 && !selGroups.has(getGroupByMode(d, mode))) return false;
    if (selPersons.size > 0 && !selPersons.has(getPersonByMode(d, mode))) return false;
    if (selQueues.size > 0 && !selQueues.has(getQueueName(d))) return false;
    if (selOrigins.size > 0 && !selOrigins.has(getOrigin(d))) return false;
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
  const filteredOnHold = isExec ? rawHoldDocs.filter(matchesActiveFilters) : [];
  const internalRequestGroups = getMultiSelectValues(`${p}WrapGroup`);
  const internalRequestPeople = getMultiSelectValues(`${p}WrapPerson`);
  const internalRequestQueues = getMultiSelectValues(`${p}WrapQueue`);
  const internalRequestOrigins = getMultiSelectValues(`${p}WrapOrigin`);
  const matchesInternalRequestFilters = (d) =>
    (internalRequestGroups.size === 0 || internalRequestGroups.has(getOperatorGroup(d))) &&
    (internalRequestPeople.size === 0 || internalRequestPeople.has(getOperatorLabel(d))) &&
    (internalRequestQueues.size === 0 || internalRequestQueues.has(getQueueName(d))) &&
    (internalRequestOrigins.size === 0 || internalRequestOrigins.has(getOrigin(d)));
  const filteredInternalRequests = isExec ? rawClosedInternalRequestDocs.filter(matchesInternalRequestFilters) : [];
  const filteredInternalRequestsInWork = isExec ? rawInternalRequestsInWork.filter(matchesInternalRequestFilters) : [];
  const filteredInternalRequestsOnHold = isExec ? rawInternalRequestsOnHold.filter(matchesInternalRequestFilters) : [];

  const marksSet = new Set(), groupsMap = new Map(), uniqueUsers = new Set();
  const grandAssigned = [], grandNoMark = [], grandWithMarks = [], grandByMark = {};

  function ensureHierarchyNode(d) {
    const person = getPersonByMode(d, mode);
    const upn = getPersonUpnByMode(d, mode);
    const grpName = getGroupByMode(d, mode);
    const statusInfo = getPersonStatusInfoByMode(d, mode);
    const docType = getDocType(d);
    uniqueUsers.add(person);

    if (!groupsMap.has(grpName)) groupsMap.set(grpName, { groupName: grpName, assigned: [], onHold: [], internalRequests: [], internalRequestsInWork: [], internalRequestsOnHold: [], all: [], noMark: [], withMarks: [], byMark: {}, users: new Map() });
    const g = groupsMap.get(grpName);
    if (!g.users.has(person)) g.users.set(person, { person, upn, statusInfo, assigned: [], onHold: [], internalRequests: [], internalRequestsInWork: [], internalRequestsOnHold: [], all: [], noMark: [], withMarks: [], byMark: {}, docTypes: new Map() });
    const u = g.users.get(person);
    if (!u.upn && upn) u.upn = upn;
    if ((!u.statusInfo || u.statusInfo.status === 'UNKNOWN_STATUS') && statusInfo.status !== 'UNKNOWN_STATUS') u.statusInfo = statusInfo;
    if (d.isInternalRequest) return { g, u, dt: null };
    if (!u.docTypes.has(docType)) u.docTypes.set(docType, { docType, assigned: [], onHold: [], all: [], noMark: [], withMarks: [], byMark: {} });
    return { g, u, dt: u.docTypes.get(docType) };
  }

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
    } else grandNoMark.push(d);

    g.all.push(d); u.all.push(d); dt.all.push(d);
    if (hasMk) {
      g.withMarks.push(d); u.withMarks.push(d); dt.withMarks.push(d);
      docMarks.forEach(mName => {
        if (!g.byMark[mName]) g.byMark[mName] = [];
        if (!u.byMark[mName]) u.byMark[mName] = [];
        if (!dt.byMark[mName]) dt.byMark[mName] = [];
        g.byMark[mName].push(d); u.byMark[mName].push(d); dt.byMark[mName].push(d);
      });
    } else {
      g.noMark.push(d); u.noMark.push(d); dt.noMark.push(d);
    }
  });

  if (isExec) {
    filteredAssigned.forEach(d => {
      const { g, u, dt } = ensureHierarchyNode(d);
      grandAssigned.push(d); g.assigned.push(d); u.assigned.push(d); dt.assigned.push(d);
    });
  }

  if (isExec) {
    filteredOnHold.forEach(d => {
      const { g, u, dt } = ensureHierarchyNode(d);
      g.onHold.push(d); u.onHold.push(d); dt.onHold.push(d);
    });
    filteredInternalRequests.forEach(d => {
      const { g, u } = ensureHierarchyNode(d);
      g.internalRequests.push(d);
      u.internalRequests.push(d);
    });
    filteredInternalRequestsInWork.forEach(d => {
      const { g, u } = ensureHierarchyNode(d);
      g.internalRequestsInWork.push(d);
      u.internalRequestsInWork.push(d);
    });
    filteredInternalRequestsOnHold.forEach(d => {
      const { g, u } = ensureHierarchyNode(d);
      g.internalRequestsOnHold.push(d);
      u.internalRequestsOnHold.push(d);
    });
  }

  const sortedMarks = Array.from(marksSet).sort((a, b) => (grandByMark[b]?.length || 0) - (grandByMark[a]?.length || 0));
  const sortedGroups = Array.from(groupsMap.values()).sort((a, b) =>
    (b.all.length + b.assigned.length + b.onHold.length + b.internalRequests.length + b.internalRequestsInWork.length + b.internalRequestsOnHold.length) -
    (a.all.length + a.assigned.length + a.onHold.length + a.internalRequests.length + a.internalRequestsInWork.length + a.internalRequestsOnHold.length)
  );
  const collectDocTypes = (users) => {
    const map = new Map();
    users.forEach(u => u.docTypes.forEach(dt => {
      if (!map.has(dt.docType)) map.set(dt.docType, { docType: dt.docType, assigned: [], onHold: [], all: [], noMark: [], withMarks: [], byMark: {} });
      const target = map.get(dt.docType);
      ['assigned', 'onHold', 'all', 'noMark', 'withMarks'].forEach(key => target[key].push(...(dt[key] || [])));
      Object.entries(dt.byMark).forEach(([mark, docs]) => {
        if (!target.byMark[mark]) target.byMark[mark] = [];
        target.byMark[mark].push(...docs);
      });
    }));
    return Array.from(map.values()).sort((a, b) => (b.all.length + b.assigned.length + b.onHold.length) - (a.all.length + a.assigned.length + a.onHold.length));
  };
  const grandDocTypes = collectDocTypes(sortedGroups.flatMap(g => Array.from(g.users.values())));

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
    ${isExec ? `<th class="assigned-col" title="Документы и внутренние запросы со статусом В работе на текущий момент">В работе<br><small>на сейчас</small></th><th class="assigned-col" title="Документы и внутренние запросы со статусом На удержании на текущий момент">На удержании<br><small>на сейчас</small></th>` : ''}
    ${isExec ? `<th class="internal-request-col" title="Закрытые внутренние запросы за ${dateRu}">Внутренние запросы<br><small>за ${dateRu}</small></th>` : ''}
    <th title="Всего документов за ${dateRu}">Всего документов<br><small>за ${dateRu}</small></th>
    <th title="В том числе: документы без метки">В том числе<br>без метки</th>
    <th class="marks-parent-col" data-toggle-marks="${mode}" title="Нажмите, чтобы свернуть или развернуть детализацию по каждой метке">
      В том числе: с метками <span style="font-size:10.5px; font-weight:500;">${markToggleIcon}</span>
    </th>
    ${st.isMarksExpanded ? sortedMarks.map(m => `<th class="mark-child-col" title="В том числе документы с меткой: ${m}">В том числе<br>${m}</th>`).join('') : ''}
  </tr>`;

  const expRows = [];
  let html = '';

  function renderInternalRequestCategoryRows(requestDocs, contextLabel) {
    const categories = new Map();
    (requestDocs || []).forEach(d => {
      const category = getInternalRequestCategory(d);
      if (!categories.has(category)) categories.set(category, { closed: [], assigned: [], onHold: [] });
      const entry = categories.get(category);
      const status = d.ticket && d.ticket.status;
      if (status === 'CLOSED') entry.closed.push(d);
      else if (status === 'ASSIGNED') entry.assigned.push(d);
      else if (status === 'ON_HOLD') entry.onHold.push(d);
    });
    const sortedCategories = Array.from(categories.entries()).sort((a, b) =>
      (b[1].closed.length + b[1].assigned.length + b[1].onHold.length) -
      (a[1].closed.length + a[1].assigned.length + a[1].onHold.length)
    );
    return sortedCategories.map(([category, counts]) => {
      expRows.push({
        'Актуально_На': formatDateTimeWithSecRu(st.fetchedAt), [st.dateColName]: dateRu,
        'Группа': contextLabel, [st.roleTitle]: '[КАТЕГОРИЯ ВНУТРЕННЕГО ЗАПРОСА]',
        'Тип_Документа': category,
        'Категория_Внутреннего_Запроса': category,
        ...(isExec ? {
          'В_Работе_ASSIGNED': counts.assigned.length,
          'На_Удержании_ON_HOLD': counts.onHold.length,
          'Внутренние_Запросы_Закрыто': counts.closed.length
        } : {}),
        'Всего': 0, 'Без_Метки': 0, 'С_Меткой_Всего': 0
      });
      return `<tr class="request-category-row">
        <td class="sticky-col">↳ Категория: ${escapeHtml(category)}</td>
        ${isExec ? makeAssignedCell(counts.assigned, category, `${contextLabel} · Внутренние запросы в работе сейчас`, 'Внутренние запросы в работе (на сейчас)') : ''}
        ${isExec ? makeAssignedCell(counts.onHold, category, `${contextLabel} · Внутренние запросы на удержании сейчас`, 'Внутренние запросы на удержании (на сейчас)') : ''}
        ${isExec ? makeInternalRequestCell(counts.closed, '', false, dateRu) : ''}
        <td class="cell-zero">0</td><td class="cell-zero">0</td><td class="cell-zero">0</td>
        ${st.isMarksExpanded ? sortedMarks.map(() => '<td class="cell-zero">0</td>').join('') : ''}
      </tr>`;
    }).join('');
  }

  const allInternalRequests = [...filteredInternalRequests, ...filteredInternalRequestsInWork, ...filteredInternalRequestsOnHold];

  sortedGroups.forEach(g => {
    const isCol = st.collapsedGroups.has(g.groupName);
    const sortedUsers = Array.from(g.users.values()).sort((a, b) =>
      (b.all.length + b.assigned.length + b.onHold.length + b.internalRequests.length + b.internalRequestsInWork.length + b.internalRequestsOnHold.length) -
      (a.all.length + a.assigned.length + a.onHold.length + a.internalRequests.length + a.internalRequestsInWork.length + a.internalRequestsOnHold.length)
    );
    const groupDocTypes = collectDocTypes(sortedUsers);
    const isGroupTypesExpanded = st.expandedGroupDocTypes.has(g.groupName);
    const groupRequestKey = `group:${encodeURIComponent(g.groupName)}`;
    const isGroupRequestsExpanded = st.expandedGroupRequestCategories.has(groupRequestKey);
    const groupRequests = [...g.internalRequests, ...g.internalRequestsInWork, ...g.internalRequestsOnHold];
    const groupAssignedAll = [...g.assigned, ...g.internalRequestsInWork];
    const groupOnHoldAll = [...g.onHold, ...g.internalRequestsOnHold];

    const gExp = {
      'Актуально_На': formatDateTimeWithSecRu(st.fetchedAt), [st.dateColName]: dateRu, 'Группа': g.groupName,
      [st.roleTitle]: '[ИТОГО ПО ГРУППЕ]', 'Логин_UPN': '', 'Текущий_Статус': '', 'Тип_Документа': 'ВСЕ ТИПЫ',
      ...(isExec ? { 'В_Работе_ASSIGNED': groupAssignedAll.length, 'На_Удержании_ON_HOLD': groupOnHoldAll.length, 'Внутренние_Запросы_Закрыто': g.internalRequests.length } : {}),
      'Всего': g.all.length, 'Без_Метки': g.noMark.length, 'С_Меткой_Всего': g.withMarks.length
    };
    sortedMarks.forEach(m => { gExp[`Метка: ${m}`] = (g.byMark[m] || []).length; });
    expRows.push(gExp);

    const grpMarkCells = st.isMarksExpanded
      ? sortedMarks.map(m => makeDrillCell(g.byMark[m] || [], `Группа: ${g.groupName}`, `Метка: «${m}» · Дата: ${dateRu}`, mode)).join('')
      : '';

    html += `<tr class="group-row">
      <td class="sticky-col" data-grp="${g.groupName}">${isCol ? '▶' : '▼'} ${g.groupName} <span class="grp-badge">${sortedUsers.length}</span><span data-grp-types="${g.groupName}" title="Раскрыть типы документов группы" style="float:right; cursor:pointer; color:var(--o3-blue);">${isGroupTypesExpanded ? '▼ типы' : '▶ типы'}</span></td>
      ${isExec ? makeAssignedCell(groupAssignedAll, `Группа: ${g.groupName}`, 'Документы и внутренние запросы в работе сейчас', 'В работе (на сейчас)') : ''}
      ${isExec ? makeAssignedCell(groupOnHoldAll, `Группа: ${g.groupName}`, 'Документы и внутренние запросы на удержании сейчас', 'На удержании (на сейчас)') : ''}
      ${isExec ? makeInternalRequestCell(groupRequests, groupRequestKey, isGroupRequestsExpanded, dateRu) : ''}
      ${makeDrillCell(g.all, `Группа: ${g.groupName}`, `Все документы подразделения за ${dateRu}`, mode)}
      ${makeDrillCell(g.noMark, `Группа: ${g.groupName}`, `Без метки за ${dateRu}`, mode)}
      ${makeDrillCell(g.withMarks, `Группа: ${g.groupName}`, `Все с метками за ${dateRu}`, mode, 'marks-parent-cell')}
      ${grpMarkCells}
    </tr>`;

    if (!isCol && isGroupRequestsExpanded) html += renderInternalRequestCategoryRows(groupRequests, `Группа: ${g.groupName}`);

    if (!isCol && isGroupTypesExpanded) {
      groupDocTypes.forEach(dt => {
        const row = {
          'Актуально_На': formatDateTimeWithSecRu(st.fetchedAt), [st.dateColName]: dateRu, 'Группа': g.groupName,
          [st.roleTitle]: '[ИТОГО ПО ГРУППЕ]', 'Логин_UPN': '', 'Текущий_Статус': '', 'Тип_Документа': dt.docType,
          ...(isExec ? { 'В_Работе_ASSIGNED': dt.assigned.length, 'На_Удержании_ON_HOLD': dt.onHold.length, 'Внутренние_Запросы_Закрыто': 0 } : {}),
          'Всего': dt.all.length, 'Без_Метки': dt.noMark.length, 'С_Меткой_Всего': dt.withMarks.length
        };
        sortedMarks.forEach(m => { row[`Метка: ${m}`] = (dt.byMark[m] || []).length; });
        expRows.push(row);
        const markCells = st.isMarksExpanded ? sortedMarks.map(m => makeDrillCell(dt.byMark[m] || [], `Группа: ${g.groupName} · ${dt.docType}`, `Метка: «${m}» · Дата: ${dateRu}`, mode)).join('') : '';
        html += `<tr class="doctype-row"><td class="sticky-col">↳ ${dt.docType}</td>${isExec ? makeAssignedCell(dt.assigned, `Группа: ${g.groupName} · ${dt.docType}`, 'Сейчас в работе (ASSIGNED)') : ''}${isExec ? makeAssignedCell(dt.onHold, `Группа: ${g.groupName} · ${dt.docType}`, 'Сейчас на удержании (ON_HOLD)', 'На удержании (ON_HOLD)') : ''}${isExec ? makeInternalRequestCell(0) : ''}${makeDrillCell(dt.all, `Группа: ${g.groupName} · ${dt.docType}`, `Все документы типа «${dt.docType}» за ${dateRu}`, mode)}${makeDrillCell(dt.noMark, `Группа: ${g.groupName} · ${dt.docType}`, `Без метки за ${dateRu}`, mode)}${makeDrillCell(dt.withMarks, `Группа: ${g.groupName} · ${dt.docType}`, `Все с метками за ${dateRu}`, mode, 'marks-parent-cell')}${markCells}</tr>`;
      });
    }

    if (!isCol) {
      sortedUsers.forEach(u => {
        const userKey = `${g.groupName}__${u.person}`;
        const isUserExp = st.expandedUsers.has(userKey);
        const userRequestKey = `user:${encodeURIComponent(userKey)}`;
        const isUserRequestsExpanded = st.expandedUserRequestCategories.has(userRequestKey);
        const userRequests = [...u.internalRequests, ...u.internalRequestsInWork, ...u.internalRequestsOnHold];
        const userAssignedAll = [...u.assigned, ...u.internalRequestsInWork];
        const userOnHoldAll = [...u.onHold, ...u.internalRequestsOnHold];
        const sortedDocTypes = Array.from(u.docTypes.values()).sort((a, b) => (b.all.length + b.assigned.length + b.onHold.length) - (a.all.length + a.assigned.length + a.onHold.length));
        const statusRender = getPersonStatusRender(u.statusInfo, st.fetchedAt, u.person);
        const actionsHtml = buildPersonActionButtonsHtml(u.upn);
        const assignedDetailsStr = isExec ? u.assigned.map(ad => `${getDocType(ad)} (${formatStatusDuration(ad.updatedAt || ad.createdAt, st.fetchedAt)})`).join(', ') : '';

        const uExp = {
          'Актуально_На': formatDateTimeWithSecRu(st.fetchedAt), [st.dateColName]: dateRu, 'Группа': g.groupName,
          [st.roleTitle]: u.person, 'Логин_UPN': u.upn || '', 'Текущий_Статус': statusRender.text, 'Тип_Документа': '[ВСЕ ТИПЫ СОТРУДНИКА]',
          ...(isExec ? { 'В_Работе_ASSIGNED': userAssignedAll.length, 'На_Удержании_ON_HOLD': userOnHoldAll.length, 'Внутренние_Запросы_Закрыто': u.internalRequests.length, 'Детали_В_Работе': assignedDetailsStr } : {}),
          'Всего': u.all.length, 'Без_Метки': u.noMark.length, 'С_Меткой_Всего': u.withMarks.length
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
          ${isExec ? makeAssignedCell(userAssignedAll, u.person, `Группа: ${g.groupName} · Документы и внутренние запросы в работе сейчас`, 'В работе (на сейчас)') : ''}
          ${isExec ? makeAssignedCell(userOnHoldAll, u.person, `Группа: ${g.groupName} · Документы и внутренние запросы на удержании сейчас`, 'На удержании (на сейчас)') : ''}
          ${isExec ? makeInternalRequestCell(userRequests, userRequestKey, isUserRequestsExpanded, dateRu) : ''}
          ${makeDrillCell(u.all, u.person, `Группа: ${g.groupName} · Статус: ${statusRender.text || '—'} · Все документы за ${dateRu}`, mode)}
          ${makeDrillCell(u.noMark, u.person, `Группа: ${g.groupName} · Без метки за ${dateRu}`, mode)}
          ${makeDrillCell(u.withMarks, u.person, `Группа: ${g.groupName} · Все с метками за ${dateRu}`, mode, 'marks-parent-cell')}
          ${usrMarkCells}
        </tr>`;

        if (isUserRequestsExpanded) html += renderInternalRequestCategoryRows(userRequests, `${g.groupName} · ${u.person}`);

        if (isUserExp) {
          sortedDocTypes.forEach(dt => {
            const dtExp = {
              'Актуально_На': formatDateTimeWithSecRu(st.fetchedAt), [st.dateColName]: dateRu, 'Группа': g.groupName,
              [st.roleTitle]: u.person, 'Логин_UPN': u.upn || '', 'Текущий_Статус': statusRender.text, 'Тип_Документа': dt.docType,
              ...(isExec ? { 'В_Работе_ASSIGNED': dt.assigned.length, 'На_Удержании_ON_HOLD': dt.onHold.length, 'Внутренние_Запросы_Закрыто': 0, 'Детали_В_Работе': '' } : {}),
              'Всего': dt.all.length, 'Без_Метки': dt.noMark.length, 'С_Меткой_Всего': dt.withMarks.length
            };
            sortedMarks.forEach(m => { dtExp[`Метка: ${m}`] = (dt.byMark[m] || []).length; });
            expRows.push(dtExp);

            const dtMarkCells = st.isMarksExpanded
              ? sortedMarks.map(m => makeDrillCell(dt.byMark[m] || [], `${u.person} · ${dt.docType}`, `Метка: «${m}» · Дата: ${dateRu}`, mode)).join('')
              : '';

            html += `<tr class="doctype-row">
              <td class="sticky-col" title="Тип документа: ${dt.docType}">↳ ${dt.docType}</td>
              ${isExec ? makeAssignedCell(dt.assigned, `${u.person} · ${dt.docType}`, `Сейчас в работе (ASSIGNED)`) : ''}
              ${isExec ? makeAssignedCell(dt.onHold, `${u.person} · ${dt.docType}`, `Сейчас на удержании (ON_HOLD)`, 'На удержании (ON_HOLD)') : ''}
              ${isExec ? makeInternalRequestCell(0) : ''}
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
    const totalRequestKey = 'total';
    const totalAssignedAll = [...grandAssigned, ...filteredInternalRequestsInWork];
    const totalOnHoldAll = [...filteredOnHold, ...filteredInternalRequestsOnHold];
    const totExp = {
      'Актуально_На': formatDateTimeWithSecRu(st.fetchedAt), [st.dateColName]: dateRu, 'Группа': 'ВСЕ ГРУППЫ',
      [st.roleTitle]: 'ОБЩИЙ ИТОГ', 'Логин_UPN': '', 'Текущий_Статус': '', 'Тип_Документа': 'ВСЕ ТИПЫ',
      ...(isExec ? { 'В_Работе_ASSIGNED': totalAssignedAll.length, 'На_Удержании_ON_HOLD': totalOnHoldAll.length, 'Внутренние_Запросы_Закрыто': filteredInternalRequests.length, 'Детали_В_Работе': '' } : {}),
      'Всего': filtered.length, 'Без_Метки': grandNoMark.length, 'С_Меткой_Всего': grandWithMarks.length
    };
    sortedMarks.forEach(m => { totExp[`Метка: ${m}`] = (grandByMark[m] || []).length; });
    expRows.push(totExp);

    const totMarkCells = st.isMarksExpanded
      ? sortedMarks.map(m => makeDrillCell(grandByMark[m] || [], `Общий итог по метке «${m}»`, `Дата: ${dateRu}`, mode)).join('')
      : '';

    html += `<tr class="total-row">
      <td class="sticky-col" data-total-types title="Нажмите, чтобы раскрыть типы документов общего итога">ИТОГО ЗА ${dateRu} <span style="float:right; cursor:pointer; color:var(--o3-blue);">${st.totalDocTypesExpanded ? '▼ типы' : '▶ типы'}</span></td>
      ${isExec ? makeAssignedCell(totalAssignedAll, 'Все подразделения', 'Документы и внутренние запросы в работе сейчас', 'В работе (на сейчас)') : ''}
      ${isExec ? makeAssignedCell(totalOnHoldAll, 'Все подразделения', 'Документы и внутренние запросы на удержании сейчас', 'На удержании (на сейчас)') : ''}
      ${isExec ? makeInternalRequestCell(allInternalRequests, totalRequestKey, st.totalRequestCategoriesExpanded, dateRu) : ''}
      ${makeDrillCell(filtered, `Все подразделения за ${dateRu}`, 'Общий итог за день', mode)}
      ${makeDrillCell(grandNoMark, `Без метки за ${dateRu}`, 'Общий итог за день', mode)}
      ${makeDrillCell(grandWithMarks, `Все с метками за ${dateRu}`, 'Общий итог за день', mode, 'marks-parent-cell')}
      ${totMarkCells}
    </tr>`;

    if (st.totalRequestCategoriesExpanded) html += renderInternalRequestCategoryRows(allInternalRequests, 'Общий итог');

    if (st.totalDocTypesExpanded) {
      grandDocTypes.forEach(dt => {
        const row = {
          'Актуально_На': formatDateTimeWithSecRu(st.fetchedAt), [st.dateColName]: dateRu, 'Группа': 'ВСЕ ГРУППЫ',
          [st.roleTitle]: 'ОБЩИЙ ИТОГ', 'Логин_UPN': '', 'Текущий_Статус': '', 'Тип_Документа': dt.docType,
          ...(isExec ? { 'В_Работе_ASSIGNED': dt.assigned.length, 'На_Удержании_ON_HOLD': dt.onHold.length, 'Внутренние_Запросы_Закрыто': 0 } : {}),
          'Всего': dt.all.length, 'Без_Метки': dt.noMark.length, 'С_Меткой_Всего': dt.withMarks.length
        };
        sortedMarks.forEach(m => { row[`Метка: ${m}`] = (dt.byMark[m] || []).length; });
        expRows.push(row);
        const markCells = st.isMarksExpanded ? sortedMarks.map(m => makeDrillCell(dt.byMark[m] || [], `Общий итог · ${dt.docType}`, `Метка: «${m}» · Дата: ${dateRu}`, mode)).join('') : '';
        html += `<tr class="doctype-row"><td class="sticky-col">↳ ${dt.docType}</td>${isExec ? makeAssignedCell(dt.assigned, `Все подразделения · ${dt.docType}`, 'Сейчас в работе (ASSIGNED)') : ''}${isExec ? makeAssignedCell(dt.onHold, `Все подразделения · ${dt.docType}`, 'Сейчас на удержании (ON_HOLD)', 'На удержании (ON_HOLD)') : ''}${isExec ? makeInternalRequestCell(0) : ''}${makeDrillCell(dt.all, `Общий итог · ${dt.docType}`, `Все документы типа «${dt.docType}» за ${dateRu}`, mode)}${makeDrillCell(dt.noMark, `Общий итог · ${dt.docType}`, `Без метки за ${dateRu}`, mode)}${makeDrillCell(dt.withMarks, `Общий итог · ${dt.docType}`, `Все с метками за ${dateRu}`, mode, 'marks-parent-cell')}${markCells}</tr>`;
      });
    }
  } else {
    const colSpan = (isExec ? 7 : 4) + (st.isMarksExpanded ? sortedMarks.length : 0);
    html = `<tr><td colspan="${colSpan}" style="padding:28px; color:var(--o3-text-sec);">За ${dateRu} документов по выбранным фильтрам не найдено.</td></tr>`;
  }

  tbody.innerHTML = html;
  st.lastExportRows = expRows;
  showSkeleton(p, false);
}

function renderActivityAnalytics(docs, mode) {
  const isReg = (mode === 'registrars');
  document.getElementById('actFirstLbl').innerText = isReg ? 'Первый созданный' : 'Первый документ';
  document.getElementById('actLastLbl').innerText = isReg ? 'Последний созданный' : 'Последний документ';
  document.getElementById('actChartTitle').innerText = isReg
    ? 'График регистрации по 15-минутным интервалам (клик по столбику фильтрует список)'
    : 'График активности по 15-минутным интервалам (клик по столбику фильтрует список)';

  const slots = new Array(96).fill(0);
  let minDate = null, maxDate = null;

  docs.forEach(d => {
    const dt = getDocActivityDate(d, mode);
    if (!dt) return;
    if (!minDate || dt < minDate) minDate = dt;
    if (!maxDate || dt > maxDate) maxDate = dt;
    const slotIdx = dt.getHours() * 4 + Math.floor(dt.getMinutes() / 15);
    if (slotIdx >= 0 && slotIdx < 96) slots[slotIdx]++;
  });

  document.getElementById('actFirstVal').innerText = minDate ? formatTimeHMS(minDate) : '—';
  document.getElementById('actLastVal').innerText = maxDate ? formatTimeHMS(maxDate) : '—';

  if (minDate && maxDate) {
    const totalMins = Math.floor((maxDate - minDate) / 60000);
    const hrs = Math.floor(totalMins / 60), mins = totalMins % 60;
    document.getElementById('actSpanVal').innerText = hrs > 0 ? `${hrs} ч ${mins} мин` : `${mins} мин`;
  } else document.getElementById('actSpanVal').innerText = '—';

  let maxSlotCount = 0, peakSlotIdx = -1;
  slots.forEach((cnt, idx) => {
    if (cnt > maxSlotCount) { maxSlotCount = cnt; peakSlotIdx = idx; }
  });

  document.getElementById('actPeakVal').innerText = (maxSlotCount > 0 && peakSlotIdx >= 0)
    ? `${formatSlotRange(peakSlotIdx)} (${maxSlotCount} шт.)`
    : '—';

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
  document.body.classList.add('drawer-open');
}

function renderDrawerList(q) {
  const query = (q ?? document.getElementById('drSearch').value).trim().toLowerCase();
  const listEl = document.getElementById('drList');

  const matched = activeDrawerDocs.filter(d => {
    if (selectedSlotIdx !== null && getDocSlotIndex(d, activeDrawerMode) !== selectedSlotIdx) return false;
    if (!query) return true;
    const t = d.ticket || {};
    const corr = d.correspondent || {};
    const hay = [
      d.documentName, d.id, d.documentTypeName, t.id, t.status, formatTicketStatusRu(t.status),
      getOperatorLabel(d), getCreatorLabel(d), corr.fullName, ...getMarksArray(d)
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

    const creatorActions = buildPersonActionButtonsHtml(getCreatorUpn(d));
    const operatorActions = buildPersonActionButtonsHtml(getOperatorUpn(d));
    const sinceUpdateDur = formatStatusDuration(d.updatedAt || d.createdAt, refNow);

    return `<div class="doc-card">
      <div class="doc-top">
        <a href="${docUrl}" target="_blank" title="Открыть карточку документа в СЭД">${DOC_ICON_SVG}<span>${docTitle} (Открыть ↗)</span></a>
        <div class="doc-badges-row">
          ${getHeadingBadgeHtml(d.heading)}
          <span class="dir-badge badge-entity">ЮЛ: ${getLegalEntity(d)}</span>
          <span class="dir-badge badge-status">${formatTicketStatusRu(t.status)}</span>
        </div>
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
  initMultiSelect(`${p}WrapOrigin`, 'Происхождение', 'Все происхождения', rerender);
  initMultiSelect(`${p}WrapMark`, 'Метка тикета', 'Все метки', rerender);

  document.getElementById(`${p}Table`).addEventListener('click', (e) => {
    if (e.target.closest('.col-resizer') || e.target.closest('[data-copy-upn]') || e.target.closest('[data-chatzone-link]')) return;
    const requestCategories = e.target.closest('[data-request-categories]');
    if (requestCategories) {
      e.stopPropagation();
      const key = requestCategories.getAttribute('data-request-categories');
      if (key === 'total') st.totalRequestCategoriesExpanded = !st.totalRequestCategoriesExpanded;
      else if (key.startsWith('group:')) {
        if (st.expandedGroupRequestCategories.has(key)) st.expandedGroupRequestCategories.delete(key);
        else st.expandedGroupRequestCategories.add(key);
      } else if (key.startsWith('user:')) {
        if (st.expandedUserRequestCategories.has(key)) st.expandedUserRequestCategories.delete(key);
        else st.expandedUserRequestCategories.add(key);
      }
      renderWidgetTable(mode);
      return;
    }
    if (e.target.closest(`[data-toggle-marks="${mode}"]`)) {
      st.isMarksExpanded = !st.isMarksExpanded;
      renderWidgetTable(mode);
      return;
    }
    const grpTypes = e.target.closest('[data-grp-types]');
    if (grpTypes) {
      e.stopPropagation();
      const gName = grpTypes.getAttribute('data-grp-types');
      if (st.expandedGroupDocTypes.has(gName)) st.expandedGroupDocTypes.delete(gName);
      else st.expandedGroupDocTypes.add(gName);
      renderWidgetTable(mode);
      return;
    }
    const totalTypes = e.target.closest('[data-total-types]');
    if (totalTypes) {
      st.totalDocTypesExpanded = !st.totalDocTypesExpanded;
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
    if (cell) openDrawer(cell.getAttribute('data-drill'));
  });

  document.getElementById(`${p}BtnToggleMarksCols`).onclick = () => {
    st.isMarksExpanded = !st.isMarksExpanded;
    renderWidgetTable(mode);
  };

  document.getElementById(`${p}BtnToggleDocTypes`).onclick = () => {
    st.allUsersExpanded = !st.allUsersExpanded;
    st.totalDocTypesExpanded = st.allUsersExpanded;
    if (st.allUsersExpanded) {
      const allSource = mode === 'executors' ? [...st.docs, ...rawAssignedDocs, ...rawHoldDocs, ...rawClosedInternalRequestDocs, ...rawInternalRequestsInWork, ...rawInternalRequestsOnHold] : st.docs;
      allSource.forEach(d => st.expandedUsers.add(`${getGroupByMode(d, mode)}__${getPersonByMode(d, mode)}`));
      allSource.forEach(d => st.expandedGroupDocTypes.add(getGroupByMode(d, mode)));
    } else {
      st.expandedUsers.clear();
      st.expandedGroupDocTypes.clear();
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
    ['Entity', 'Heading', 'DocType', 'Group', 'Person', 'Queue', 'Origin', 'Mark'].forEach(field => resetMultiSelect(`${p}Wrap${field}`));
    renderWidgetTable(mode);
  };

  document.getElementById(`${p}BtnExpandGroups`).onclick = () => {
    st.collapsedGroups.clear();
    renderWidgetTable(mode);
  };
  document.getElementById(`${p}BtnCollapseGroups`).onclick = () => {
    const allSource = mode === 'executors' ? [...st.docs, ...rawAssignedDocs, ...rawHoldDocs, ...rawClosedInternalRequestDocs, ...rawInternalRequestsInWork, ...rawInternalRequestsOnHold] : st.docs;
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
  if (!STATE[mode].hasLoadedOnce) fetchWidgetData(mode);
}

document.getElementById('tabExecutors').onclick = () => activateWidgetTab('executors');
document.getElementById('tabRegistrars').onclick = () => activateWidgetTab('registrars');

document.getElementById('btnDrClose').onclick = () => {
  document.getElementById('drillDrawer').classList.remove('open');
  document.body.classList.remove('drawer-open');
};
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
    const dueDt = (document.getElementById('dueTargetDate') && document.getElementById('dueTargetDate').value) || 'today';
    exportAlertDocsCsv(filteredDueTodayDocs, `sed_due_${dueDt}_documents.csv`);
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

// === АВТОПРОВЕРКА ОБНОВЛЕНИЙ С GITHUB (логин V-M221) ===
const GITHUB_MANIFEST_URL = "https://raw.githubusercontent.com/V-M221/ozon-sed-dashboard/main/manifest.json";

function compareVersionNumbers(a, b) {
  const partsA = String(a || '').split(/[.+-]/).slice(0, 3).map(part => Number.parseInt(part, 10));
  const partsB = String(b || '').split(/[.+-]/).slice(0, 3).map(part => Number.parseInt(part, 10));
  if (partsA.length !== 3 || partsB.length !== 3 || [...partsA, ...partsB].some(part => !Number.isFinite(part))) return 0;
  for (let i = 0; i < 3; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }
  return 0;
}

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

  try {
    const res = await fetch(`${GITHUB_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const remoteManifest = await res.json();
    const remoteVersion = remoteManifest && remoteManifest.version;

    if (remoteVersion && compareVersionNumbers(remoteVersion, localVersion) > 0) {
      const banner = document.getElementById('updateBanner');
      const textEl = document.getElementById('updateBannerText');
      if (banner && textEl) {
        textEl.innerText = `🚀 Доступна новая версия v${remoteVersion} (у вас v${localVersion})! Запустите update.bat в папке расширения и нажмите кнопку справа →`;
        banner.style.display = 'flex';
      }
    }
  } catch (e) {}
}

(function init() {
  initCustomDimensions();
  bindSyncAccordions();
  bindPushModalEvents();

  const savedTheme = localStorage.getItem('o3_sed_theme') || 'light';
  applyTheme(savedTheme);

  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  document.getElementById('exDate').value = ymd;
  document.getElementById('rgDate').value = ymd;

  const dueDateEl = document.getElementById('dueTargetDate');
  if (dueDateEl) {
    dueDateEl.value = ymd;
    dueDateEl.addEventListener('click', (e) => e.stopPropagation());
    dueDateEl.addEventListener('change', () => fetchCustomDueDateOnly());
  }

  bindWidgetEvents('executors');
  bindWidgetEvents('registrars');
  bindDeadlineFilterControls();
  bindAssignSectionEvents('Overdue');
  bindAssignSectionEvents('DueToday');

  checkForGithubUpdates();

  const params = new URLSearchParams(window.location.search);
  const startWidget = params.get('widget') === 'registrars' ? 'registrars' : 'executors';
  activateWidgetTab(startWidget);
})();
