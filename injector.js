(function() {
  const TARGET_URL = "https://crm.bank.ozon.ru/apps/sed/api/searchDocuments";
  const COUNT_URL = "https://crm.bank.ozon.ru/apps/sed/api/countDocuments";
  const SED_OPERATORS_URL = "https://crm.bank.ozon.ru/apps/sed/api/operators";
  const ASSIGN_TICKET_URL = "https://crm.bank.ozon.ru/apps/sed/api/assignTicket";
  const TICKET_API_URL = "https://crm.bank.ozon.ru/api/statisticsTicket.json?id=";
  const OPERATOR_API_URL = "https://crm.bank.ozon.ru/api/operatorList.json";
  const GROUP_API_URL = "https://crm.bank.ozon.ru/api/operatorsGroups.json";
  const STATUS_HISTORY_URL = "https://crm.bank.ozon.ru/api/operatorStatusHistory.json";
  const HEARTBEAT_URL = "https://crm.bank.ozon.ru/api/heartBeat.json";
  const CONCURRENCY_LIMIT = 20;

  const ALL_SED_STATUSES = [
    "CLOSED",
    "ACKNOWLEDGED",
    "ASSIGNED",
    "CREATED",
    "ON_HOLD",
    "TRANSFERRED_TO_DEVELOPMENT",
    "WAITING_FOR_CUSTOMER"
  ];

  const OPEN_SED_STATUSES = [
    "ACKNOWLEDGED",
    "ASSIGNED",
    "CREATED",
    "ON_HOLD",
    "TRANSFERRED_TO_DEVELOPMENT",
    "WAITING_FOR_CUSTOMER"
  ];

  function sendLog(level, message, details = null) {
    window.postMessage({
      source: 'CRM_INJECTOR',
      type: 'LIVE_LOG',
      payload: {
        time: new Date().toLocaleTimeString('ru-RU', { hour12: false }) + '.' + String(new Date().getMilliseconds()).padStart(3, '0'),
        level,
        message,
        details: details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null
      }
    }, '*');
  }

  if (!window.__OZON_ORIG_FETCH__) {
    window.__OZON_ORIG_FETCH__ = window.fetch;
  }
  const origFetch = window.__OZON_ORIG_FETCH__;

  window.__OZON_TICKET_CACHE_V2__ = window.__OZON_TICKET_CACHE_V2__ || new Map();
  window.__OZON_OP_CACHE_V2__ = window.__OZON_OP_CACHE_V2__ || new Map();
  window.__OZON_GRP_CACHE_V2__ = window.__OZON_GRP_CACHE_V2__ || new Map();
  window.__OZON_STATUS_CACHE_V2__ = window.__OZON_STATUS_CACHE_V2__ || new Map();
  window.__OZON_AUTH_HEADERS__ = window.__OZON_AUTH_HEADERS__ || {};

  const ticketCache = window.__OZON_TICKET_CACHE_V2__;
  const operatorPromiseCache = window.__OZON_OP_CACHE_V2__;
  const groupPromiseCache = window.__OZON_GRP_CACHE_V2__;
  const statusPromiseCache = window.__OZON_STATUS_CACHE_V2__;

  let isLiveFetching = false;

  if (!window.__OZON_FETCH_HOOKED__) {
    window.__OZON_FETCH_HOOKED__ = true;
    window.fetch = async function(...args) {
      let options = args[1] || {};
      if (options.headers && !options._isOurLive) {
        try {
          let hCopy = {};
          if (options.headers instanceof Headers) {
            options.headers.forEach((v, k) => hCopy[k.toLowerCase()] = v);
          } else if (typeof options.headers === 'object') {
            for (let [k, v] of Object.entries(options.headers)) {
              hCopy[k.toLowerCase()] = v;
            }
          }
          if (hCopy['x-o3-internal-headers-token']) {
            window.__OZON_AUTH_HEADERS__['x-o3-internal-headers-token'] = hCopy['x-o3-internal-headers-token'];
          }
          if (hCopy['x-o3-meshversion']) {
            window.__OZON_AUTH_HEADERS__['x-o3-meshversion'] = hCopy['x-o3-meshversion'];
          }
        } catch (e) {}
      }
      return origFetch.apply(this, args);
    };
  }

  function buildCleanHeaders(isPostJson = false) {
    const h = {
      'accept': 'application/json',
      'x-o3-language': 'ru'
    };
    if (isPostJson) {
      h['content-type'] = 'application/json';
    }
    if (window.__OZON_AUTH_HEADERS__['x-o3-internal-headers-token']) {
      h['x-o3-internal-headers-token'] = window.__OZON_AUTH_HEADERS__['x-o3-internal-headers-token'];
    }
    if (window.__OZON_AUTH_HEADERS__['x-o3-meshversion']) {
      h['x-o3-meshversion'] = window.__OZON_AUTH_HEADERS__['x-o3-meshversion'];
    }
    return h;
  }

  async function safeFetch(url, options = {}) {
    options._isOurLive = true;
    options.credentials = 'include';
    return window.fetch(url, options);
  }

  function extractSedData(json) {
    if (json && json.data && json.data.searchSedDocuments && Array.isArray(json.data.searchSedDocuments.documents)) {
      return {
        items: json.data.searchSedDocuments.documents,
        cursors: json.data.searchSedDocuments.cursors || { next: null, prev: null }
      };
    }
    return null;
  }

  function normalizeStatusName(rawStatus) {
    if (!rawStatus) return 'UNKNOWN_STATUS';
    const s = String(rawStatus).trim().toUpperCase().replace(/^OPERATOR_STATUS_/, '');
    const allowed = ['ONLINE', 'OFFLINE', 'BREAK', 'TRAINING', 'POSTPROCESSING', 'UNKNOWN_STATUS'];
    return allowed.includes(s) ? s : 'UNKNOWN_STATUS';
  }

  function getGroupName(groupId) {
    if (!groupId) return Promise.resolve('');
    const key = String(groupId);
    if (groupPromiseCache.has(key)) return groupPromiseCache.get(key);

    const p = (async () => {
      try {
        const filterStr = encodeURIComponent(JSON.stringify({ GroupsIdIn: [Number(groupId)] }));
        const url = `${GROUP_API_URL}?page=1&perPage=1&filter=${filterStr}&sort=CREATED_AT&sortDirection=DESC`;
        const res = await safeFetch(url, {
          method: 'GET',
          headers: buildCleanHeaders(false)
        });
        if (res.ok) {
          const data = await res.json();
          const item = data.items && data.items[0];
          return (item && item.name) ? item.name : '';
        }
      } catch (e) {}
      return '';
    })();

    groupPromiseCache.set(key, p);
    return p;
  }

  function getOperatorCurrentStatus(operatorId, fallbackStatus = 'UNKNOWN_STATUS') {
    if (!operatorId) return Promise.resolve({ status: normalizeStatusName(fallbackStatus), setAt: null });
    const key = String(operatorId);
    if (statusPromiseCache.has(key)) return statusPromiseCache.get(key);

    const p = (async () => {
      try {
        const filterStr = encodeURIComponent(JSON.stringify({ operatorIds: [Number(operatorId)] }));
        const pagStr = encodeURIComponent(JSON.stringify({ cursor: null, perPage: 40 }));
        const url = `${STATUS_HISTORY_URL}?filter=${filterStr}&pagination=${pagStr}`;
        const res = await safeFetch(url, {
          method: 'GET',
          headers: buildCleanHeaders(false)
        });
        if (res.ok) {
          const data = await res.json();
          const latest = data && Array.isArray(data.items) && data.items[0];
          if (latest && latest.status) {
            return {
              status: normalizeStatusName(latest.status),
              setAt: latest.setAt || null
            };
          }
        }
      } catch (e) {}
      return { status: normalizeStatusName(fallbackStatus), setAt: null };
    })();

    statusPromiseCache.set(key, p);
    return p;
  }

  function getOperatorDetails(upn, knownOperatorId = null) {
    if (!upn && !knownOperatorId) {
      return Promise.resolve({ operatorId: null, fullName: '', groupId: '', groupName: '', currentStatus: 'UNKNOWN_STATUS', statusSetAt: null });
    }
    const cleanUpn = String(upn || '').trim();

    const p = (async () => {
      let baseProfilePromise = cleanUpn ? operatorPromiseCache.get(cleanUpn) : null;
      if (!baseProfilePromise && cleanUpn) {
        baseProfilePromise = (async () => {
          try {
            const filterStr = encodeURIComponent(JSON.stringify({ nameOrUpnLike: cleanUpn }));
            const url = `${OPERATOR_API_URL}?page=1&perPage=40&sort=SORT_BY_CREATED_AT&sortDirection=DESC&filter=${filterStr}&withTotal=true`;
            const res = await safeFetch(url, {
              method: 'GET',
              headers: buildCleanHeaders(false)
            });
            if (res.ok) {
              const data = await res.json();
              const items = Array.isArray(data.items) ? data.items : [];
              const match = items.find(i => i.upn && i.upn.toLowerCase() === cleanUpn.toLowerCase()) || items[0];
              if (match) {
                const operatorId = match.operatorId || match.id || knownOperatorId || null;
                const fullName = match.fullName || '';
                const groupId = match.groupId || '';
                const listStatus = match.status || 'UNKNOWN_STATUS';
                const groupName = groupId ? await getGroupName(groupId) : '';
                return { operatorId, fullName, groupId, groupName, listStatus };
              }
            }
          } catch (e) {}
          return { operatorId: knownOperatorId || null, fullName: '', groupId: '', groupName: '', listStatus: 'UNKNOWN_STATUS' };
        })();
        operatorPromiseCache.set(cleanUpn, baseProfilePromise);
      }

      const prof = baseProfilePromise
        ? await baseProfilePromise
        : { operatorId: knownOperatorId, fullName: '', groupId: '', groupName: '', listStatus: 'UNKNOWN_STATUS' };

      const finalOpId = prof.operatorId || knownOperatorId;
      const statusObj = finalOpId
        ? await getOperatorCurrentStatus(finalOpId, prof.listStatus)
        : { status: normalizeStatusName(prof.listStatus), setAt: null };

      return {
        ...prof,
        operatorId: finalOpId,
        currentStatus: statusObj.status,
        statusSetAt: statusObj.setAt
      };
    })();

    return p;
  }

  async function enrichSingleDocument(doc) {
    const t = doc.ticket || {};
    const ticketId = t.id;
    const operatorUpn = t.operator && t.operator.upn;
    const operatorDirectId = t.operator && t.operator.id;
    const creatorUpn = t.creator;

    const ticketTask = (async () => {
      if (!ticketId) {
        doc.ticketMarks = [];
        return;
      }
      if (ticketCache.has(ticketId)) {
        doc.ticketMarks = ticketCache.get(ticketId);
        return;
      }
      try {
        const res = await safeFetch(`${TICKET_API_URL}${ticketId}`, {
          method: 'GET',
          headers: buildCleanHeaders(false)
        });
        if (res.ok) {
          const ticketData = await res.json();
          const marks = Array.isArray(ticketData.marks) ? ticketData.marks : [];
          doc.ticketMarks = marks;
          ticketCache.set(ticketId, marks);
        } else {
          doc.ticketMarks = [];
        }
      } catch (err) {
        doc.ticketMarks = [];
      }
    })();

    const [_, operatorInfo, creatorInfo] = await Promise.all([
      ticketTask,
      getOperatorDetails(operatorUpn, operatorDirectId),
      getOperatorDetails(creatorUpn, null)
    ]);

    doc.operatorInfo = operatorInfo;
    doc.creatorInfo = creatorInfo;
  }

  async function fetchAllByFilter(filterObj) {
    let cursor = null;
    let activePerPage = 200;
    let allDocs = [];
    let page = 0;

    while (page < 20) {
      page++;
      const bodyPayload = {
        pagination: { cursor, perPage: activePerPage },
        filter: filterObj
      };
      let res = await safeFetch(TARGET_URL, {
        method: 'POST',
        headers: buildCleanHeaders(true),
        body: JSON.stringify(bodyPayload)
      });
      if (!res.ok && page === 1 && activePerPage !== 50) {
        activePerPage = 50;
        bodyPayload.pagination.perPage = 50;
        res = await safeFetch(TARGET_URL, {
          method: 'POST',
          headers: buildCleanHeaders(true),
          body: JSON.stringify(bodyPayload)
        });
      }
      if (!res.ok) break;
      const json = await res.json();
      const extracted = extractSedData(json);
      if (!extracted || extracted.items.length === 0) break;

      const pageDocs = extracted.items;
      for (let i = 0; i < pageDocs.length; i += CONCURRENCY_LIMIT) {
        const chunk = pageDocs.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(chunk.map(doc => enrichSingleDocument(doc)));
      }
      allDocs.push(...pageDocs);

      cursor = extracted.cursors ? extracted.cursors.next : null;
      if (!cursor) break;
    }
    return allDocs;
  }

  // === ПОИСК ОПЕРАТОРОВ СЭД (POST /apps/sed/api/operators) ===
  async function searchSedOperators(query, section) {
    try {
      const cleanQuery = String(query || '').trim();
      const res = await safeFetch(SED_OPERATORS_URL, {
        method: 'POST',
        headers: buildCleanHeaders(true),
        body: JSON.stringify({
          filter: { NameOrUpnLike: cleanQuery }
        })
      });

      if (!res.ok) {
        let errText = '';
        try { errText = await res.text(); } catch (e) {}
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 150)}`);
      }

      const json = await res.json();
      const rawItems = (json && json.data && json.data.operators && Array.isArray(json.data.operators.items))
        ? json.data.operators.items
        : [];

      const items = rawItems.map(item => ({
        id: Number(item.Id),
        fullName: String(item.FullName || '').replace(/\s+/g, ' ').trim(),
        upn: String(item.Upn || '').trim()
      })).filter(i => i.id);

      window.postMessage({
        source: 'CRM_INJECTOR',
        type: 'SEARCH_OPERATORS_RESULT',
        payload: { section, query: cleanQuery, items }
      }, '*');
    } catch (e) {
      sendLog('error', `Ошибка поиска операторов (${query}): ${e.message}`);
      window.postMessage({
        source: 'CRM_INJECTOR',
        type: 'SEARCH_OPERATORS_ERROR',
        payload: { section, query, message: e.message }
      }, '*');
    }
  }

  // === МАССОВОЕ ИЛИ ОДИНОЧНОЕ НАЗНАЧЕНИЕ ТИКЕТОВ (POST /apps/sed/api/assignTicket) ===
  async function assignSedTickets(alertIds, operator, section) {
    const ids = Array.isArray(alertIds) ? alertIds.map(Number).filter(Boolean) : [];
    const operatorId = Number(operator && operator.id);
    if (!ids.length || !operatorId) return;

    sendLog('info', `Назначение ${ids.length} док. на оператора ${operator.fullName} (${operator.upn}, ID=${operatorId})...`);

    const succeededAlertIds = [];
    const failedItems = [];

    for (let i = 0; i < ids.length; i++) {
      const alertID = ids[i];
      window.postMessage({
        source: 'CRM_INJECTOR',
        type: 'ASSIGN_TICKETS_PROGRESS',
        payload: {
          section,
          current: i + 1,
          total: ids.length,
          alertID
        }
      }, '*');

      try {
        const res = await safeFetch(ASSIGN_TICKET_URL, {
          method: 'POST',
          headers: buildCleanHeaders(true),
          body: JSON.stringify({
            input: {
              alertID: Number(alertID),
              operatorID: Number(operatorId)
            }
          })
        });

        if (!res.ok) {
          let errText = '';
          try { errText = await res.text(); } catch (e) {}
          throw new Error(`HTTP ${res.status} ${errText.slice(0, 120)}`);
        }

        const json = await res.json();
        if (json && json.errors && json.errors.length) {
          throw new Error(json.errors.map(er => er.message || JSON.stringify(er)).join('; '));
        }

        succeededAlertIds.push(alertID);
      } catch (err) {
        failedItems.push({ alertID, error: err.message });
        sendLog('error', `Не удалось назначить тикет ${alertID} на ${operator.upn}: ${err.message}`);
      }
    }

    let enrichedOperatorInfo = null;
    try {
      enrichedOperatorInfo = await getOperatorDetails(operator.upn, operatorId);
      if (enrichedOperatorInfo && !enrichedOperatorInfo.fullName && operator.fullName) {
        enrichedOperatorInfo.fullName = operator.fullName;
      }
    } catch (e) {}

    if (failedItems.length === 0) {
      sendLog('success', `Успешно назначено ${succeededAlertIds.length} из ${ids.length} док. на ${operator.fullName} (${operator.upn})`);
    } else {
      sendLog('warn', `Назначено ${succeededAlertIds.length} из ${ids.length} док. Ошибок: ${failedItems.length}`);
    }

    window.postMessage({
      source: 'CRM_INJECTOR',
      type: 'ASSIGN_TICKETS_RESULT',
      payload: {
        section,
        operator,
        operatorInfo: enrichedOperatorInfo,
        succeededAlertIds,
        failedItems
      }
    }, '*');
  }

  // === ОТДЕЛЬНЫЙ ПЕРЕЗАПРОС ДОКУМЕНТОВ ПО ВЫБРАННОЙ ДАТЕ ИСТЕЧЕНИЯ СРОКА ===
  async function fetchSingleDueDateDocs(dueDateYMD) {
    try {
      const targetDueYMD = dueDateYMD || (() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      })();

      const dueDateFilter = {
        statusIn: OPEN_SED_STATUSES,
        documentCreatedFrom: "2026-01-01T00:00:00+03:00",
        documentCreatedTo: "2027-12-31T23:59:59+03:00",
        deadlineFrom: `${targetDueYMD}T00:00:00+03:00`,
        deadlineTo: `${targetDueYMD}T23:59:59+03:00`
      };

      sendLog('info', `Запрос документов со сроком истечения ${targetDueYMD}...`);
      const dueTodayDocs = await fetchAllByFilter(dueDateFilter);
      sendLog('success', `Загружены документы со сроком ${targetDueYMD}: ${dueTodayDocs.length} шт.`);

      window.postMessage({
        source: 'CRM_INJECTOR',
        type: 'DUE_DATE_RESULT',
        payload: {
          dueDateYMD: targetDueYMD,
          dueTodayDocs
        }
      }, '*');
    } catch (e) {
      sendLog('error', `Ошибка при загрузке документов по дате истечения: ${e.message}`);
      window.postMessage({
        source: 'CRM_INJECTOR',
        type: 'DUE_DATE_RESULT',
        payload: {
          dueDateYMD,
          dueTodayDocs: []
        }
      }, '*');
    }
  }

  // === СБОР ДЕДЛАЙНОВ + ВСЕХ ДОКУМЕНТОВ В РАБОТЕ (ASSIGNED) ===
  async function fetchDeadlinesAndAssignedAlerts(customDueDateYMD = null) {
    try {
      const now = new Date();
      const todayYMD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const yesterdayYMD = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
      const targetDueYMD = customDueDateYMD || todayYMD;

      // 1) Просроченные (до конца вчерашнего дня)
      const overdueFilter = {
        statusIn: OPEN_SED_STATUSES,
        documentCreatedFrom: "2026-01-01T00:00:00+03:00",
        documentCreatedTo: "2027-12-31T23:59:59+03:00",
        deadlineFrom: "2026-01-01T00:00:00+03:00",
        deadlineTo: `${yesterdayYMD}T23:59:59+03:00`
      };

      // 2) Срок истекает в выбранную дату (по умолчанию сегодня)
      const dueTodayFilter = {
        statusIn: OPEN_SED_STATUSES,
        documentCreatedFrom: "2026-01-01T00:00:00+03:00",
        documentCreatedTo: "2027-12-31T23:59:59+03:00",
        deadlineFrom: `${targetDueYMD}T00:00:00+03:00`,
        deadlineTo: `${targetDueYMD}T23:59:59+03:00`
      };

      // 3) Все документы в работе сейчас (statusIn: ["ASSIGNED"])
      const assignedFilter = {
        statusIn: ["ASSIGNED"],
        documentCreatedFrom: "2026-01-01T00:00:00+03:00",
        documentCreatedTo: "2027-12-31T23:59:59+03:00"
      };

      const onHoldFilter = {
        statusIn: ["ON_HOLD"],
        documentCreatedFrom: "2026-01-01T00:00:00+03:00",
        documentCreatedTo: "2027-12-31T23:59:59+03:00"
      };

      sendLog('info', `Запрос дедлайнов (на ${targetDueYMD}), документов в работе и на удержании...`);

      const [overdueDocs, dueTodayDocs, assignedDocs, onHoldDocs] = await Promise.all([
        fetchAllByFilter(overdueFilter),
        fetchAllByFilter(dueTodayFilter),
        fetchAllByFilter(assignedFilter),
        fetchAllByFilter(onHoldFilter)
      ]);

      sendLog('success', `Доп. данные загружены: В работе = ${assignedDocs.length} шт., На удержании = ${onHoldDocs.length} шт., Просрочено = ${overdueDocs.length} шт., Истекает (${targetDueYMD}) = ${dueTodayDocs.length} шт.`);

      window.postMessage({
        source: 'CRM_INJECTOR',
        type: 'DEADLINES_RESULT',
        payload: {
          todayYMD: targetDueYMD,
          yesterdayYMD,
          overdueDocs,
          dueTodayDocs,
          assignedDocs,
          onHoldDocs
        }
      }, '*');
    } catch (e) {
      sendLog('warn', `Предупреждение при загрузке доп. данных: ${e.message}`);
    }
  }

  async function liveFetchByDate(targetDateYMD, mode, customDueDateYMD = null) {
    isLiveFetching = false;
    await new Promise(r => setTimeout(r, 60));
    isLiveFetching = true;

    statusPromiseCache.clear();

    const activeMode = mode || 'executors';
    sendLog('info', `Старт запроса [${activeMode}] за дату ${targetDateYMD}`);

    if (!window.__OZON_AUTH_HEADERS__['x-o3-internal-headers-token']) {
      try {
        await window.fetch(HEARTBEAT_URL, { method: 'POST', credentials: 'include' });
      } catch (e) {}
    }

    let exactFilter;
    if (activeMode === 'registrars') {
      exactFilter = {
        statusIn: ALL_SED_STATUSES,
        documentCreatedFrom: `${targetDateYMD}T00:00:00+03:00`,
        documentCreatedTo: `${targetDateYMD}T23:59:59+03:00`
      };
    } else {
      exactFilter = {
        statusIn: ["CLOSED"],
        documentCreatedFrom: "2026-01-01T00:00:00+03:00",
        documentCreatedTo: "2027-12-31T23:59:59+03:00",
        ticketUpdatedFrom: `${targetDateYMD}T00:00:00+03:00`,
        ticketUpdatedTo: `${targetDateYMD}T23:59:59+03:00`
      };
    }

    let expectedCount = null;
    try {
      const countRes = await safeFetch(COUNT_URL, {
        method: 'POST',
        headers: buildCleanHeaders(true),
        body: JSON.stringify({ filter: exactFilter })
      });
      if (countRes.ok) {
        const countJson = await countRes.json();
        expectedCount = countJson && countJson.data && countJson.data.countSedDocuments && countJson.data.countSedDocuments.count;
        sendLog('success', `Ответ countDocuments: найдено ${expectedCount} док.`);
      }
    } catch (e) {}

    let currentCursor = null;
    let pageNum = 0;
    let activePerPage = 500;
    let matchedDocs = [];

    try {
      while (isLiveFetching) {
        pageNum++;
        const totalHint = expectedCount !== null ? ` из ${expectedCount}` : '';
        window.postMessage({
          source: 'CRM_INJECTOR',
          type: 'LIVE_PROGRESS',
          payload: {
            mode: activeMode,
            text: `Запрос к API searchDocuments (пачка #${pageNum})... Собрано: ${matchedDocs.length}${totalHint}`
          }
        }, '*');

        let bodyPayload = {
          pagination: { cursor: currentCursor, perPage: activePerPage },
          filter: exactFilter
        };

        let res = await safeFetch(TARGET_URL, {
          method: 'POST',
          headers: buildCleanHeaders(true),
          body: JSON.stringify(bodyPayload)
        });

        if (!res.ok && pageNum === 1) {
          for (let fallbackPerPage of [200, 50]) {
            activePerPage = fallbackPerPage;
            bodyPayload.pagination.perPage = fallbackPerPage;
            res = await safeFetch(TARGET_URL, {
              method: 'POST',
              headers: buildCleanHeaders(true),
              body: JSON.stringify(bodyPayload)
            });
            if (res.ok) break;
          }
        }

        if (!res.ok && pageNum === 1 && activeMode === 'registrars') {
          delete exactFilter.statusIn;
          bodyPayload.filter = exactFilter;
          res = await safeFetch(TARGET_URL, {
            method: 'POST',
            headers: buildCleanHeaders(true),
            body: JSON.stringify(bodyPayload)
          });
        }

        if (!res.ok) {
          let errText = '';
          try { errText = await res.text(); } catch (e) {}
          sendLog('error', `Ошибка HTTP ${res.status} от searchDocuments`, errText.slice(0, 300));
          throw new Error(`Сервер СЭД вернул статус ${res.status}. Подробности в журнале логов внизу.`);
        }

        const json = await res.json();
        const extracted = extractSedData(json);
        if (!extracted || extracted.items.length === 0) break;

        const pageDocs = extracted.items;

        window.postMessage({
          source: 'CRM_INJECTOR',
          type: 'LIVE_PROGRESS',
          payload: {
            mode: activeMode,
            text: `Загрузка меток, ФИО, групп и статусов (пачка #${pageNum}: ${pageDocs.length} док.)...`
          }
        }, '*');

        for (let i = 0; i < pageDocs.length; i += CONCURRENCY_LIMIT) {
          if (!isLiveFetching) break;
          const chunk = pageDocs.slice(i, i + CONCURRENCY_LIMIT);
          await Promise.all(chunk.map(doc => enrichSingleDocument(doc)));
        }

        matchedDocs.push(...pageDocs);

        currentCursor = extracted.cursors ? extracted.cursors.next : null;
        if (!currentCursor) break;
      }

      if (isLiveFetching) {
        const fetchedAtIso = new Date().toISOString();
        sendLog('success', `Сбор [${activeMode}] завершен! Документов: ${matchedDocs.length}`);
        window.postMessage({
          source: 'CRM_INJECTOR',
          type: 'LIVE_RESULT',
          payload: {
            mode: activeMode,
            targetDate: targetDateYMD,
            fetchedAt: fetchedAtIso,
            totalScanned: matchedDocs.length,
            items: matchedDocs
          }
        }, '*');

        if (activeMode === 'executors') {
          await fetchDeadlinesAndAssignedAlerts(customDueDateYMD);
        }
      }
    } catch (err) {
      sendLog('error', `Критическая ошибка в liveFetchByDate: ${err.message}`, err.stack || null);
      window.postMessage({
        source: 'CRM_INJECTOR',
        type: 'LIVE_ERROR',
        payload: { mode: activeMode, message: err.message }
      }, '*');
    } finally {
      isLiveFetching = false;
    }
  }

  if (window.__OZON_MSG_HANDLER__) {
    window.removeEventListener('message', window.__OZON_MSG_HANDLER__);
  }
  window.__OZON_MSG_HANDLER__ = (event) => {
    if (!event.data || event.data.source !== 'CRM_BRIDGE') return;

    if (event.data.type === 'FETCH_DATE') {
      const p = event.data.payload || {};
      liveFetchByDate(p.dateYMD, p.mode, p.dueDateYMD);
    }
    if (event.data.type === 'FETCH_DUE_DATE') {
      const p = event.data.payload || {};
      fetchSingleDueDateDocs(p.dueDateYMD);
    }
    if (event.data.type === 'STOP_FETCH') {
      sendLog('warn', 'Запрос остановлен пользователем.');
      isLiveFetching = false;
    }
    if (event.data.type === 'SEARCH_OPERATORS') {
      const p = event.data.payload || {};
      searchSedOperators(p.query, p.section);
    }
    if (event.data.type === 'ASSIGN_TICKETS') {
      const p = event.data.payload || {};
      assignSedTickets(p.alertIds, p.operator, p.section);
    }
  };
  window.addEventListener('message', window.__OZON_MSG_HANDLER__);
})();
