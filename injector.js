(function() {
  const TARGET_URL = "https://crm.bank.ozon.ru/apps/sed/api/searchDocuments";
  const DOCUMENT_HEAD_URL = "https://crm.bank.ozon.ru/apps/sed/api/documentHead";
  const COUNT_URL = "https://crm.bank.ozon.ru/apps/sed/api/countDocuments";
  const SED_OPERATORS_URL = "https://crm.bank.ozon.ru/apps/sed/api/operators";
  const ASSIGN_TICKET_URL = "https://crm.bank.ozon.ru/apps/sed/api/assignTicket";
  const TICKET_API_URL = "https://crm.bank.ozon.ru/api/statisticsTicket.json?id=";
  const OPERATOR_API_URL = "https://crm.bank.ozon.ru/api/operatorList.json";
  const GROUP_API_URL = "https://crm.bank.ozon.ru/api/operatorsGroups.json";
  const STATUS_HISTORY_URL = "https://crm.bank.ozon.ru/api/operatorStatusHistory.json";
  const INTERNAL_REQUESTS_URL = "https://crm.bank.ozon.ru/api/alertsStatistic.json";
  const INTERNAL_REQUEST_ALERT_TYPE_ID = 2916;
  const HEARTBEAT_URL = "https://crm.bank.ozon.ru/api/heartBeat.json";
  const CONCURRENCY_LIMIT = 20;
  const DOCUMENTS_PAGE_SIZE = 20;
  const MAX_FILTERED_DOCUMENT_PAGES = 4000 / DOCUMENTS_PAGE_SIZE;

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

  function logRequestFilter(label, filter) {
    sendLog('info', `${label} · фильтр: ${JSON.stringify(filter)}`);
  }

  if (!window.__OZON_ORIG_FETCH__) {
    window.__OZON_ORIG_FETCH__ = window.fetch;
  }
  const origFetch = window.__OZON_ORIG_FETCH__;

  window.__OZON_OP_CACHE_V2__ = window.__OZON_OP_CACHE_V2__ || new Map();
  window.__OZON_GRP_CACHE_V2__ = window.__OZON_GRP_CACHE_V2__ || new Map();
  window.__OZON_STATUS_CACHE_V2__ = window.__OZON_STATUS_CACHE_V2__ || new Map();
  window.__OZON_AUTH_HEADERS__ = window.__OZON_AUTH_HEADERS__ || {};

  const ticketCache = new Map();
  const operatorPromiseCache = window.__OZON_OP_CACHE_V2__;
  const groupPromiseCache = window.__OZON_GRP_CACHE_V2__;
  const statusPromiseCache = window.__OZON_STATUS_CACHE_V2__;

  const activeLoads = window.__OZON_SED_ACTIVE_LOADS__ ||= new Set();

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
        const filter = { GroupsIdIn: [Number(groupId)] };
        logRequestFilter('Запрос группы оператора', filter);
        const filterStr = encodeURIComponent(JSON.stringify(filter));
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
        const filter = { operatorIds: [Number(operatorId)] };
        logRequestFilter('Запрос истории статуса оператора', filter);
        const filterStr = encodeURIComponent(JSON.stringify(filter));
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
            const filter = { nameOrUpnLike: cleanUpn };
            logRequestFilter('Поиск оператора', filter);
            const filterStr = encodeURIComponent(JSON.stringify(filter));
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

      return {
        ...prof,
        operatorId: finalOpId,
        currentStatus: 'UNKNOWN_STATUS',
        statusSetAt: null,
        statusLoading: Boolean(finalOpId)
      };
    })();

    return p;
  }

  function getTicketDetails(ticketId) {
    if (ticketId == null) return Promise.resolve(null);
    const key = String(ticketId);
    if (ticketCache.has(key)) return ticketCache.get(key);
    const request = (async () => {
      const res = await safeFetch(TICKET_API_URL + encodeURIComponent(key), {
        method: 'GET', headers: buildCleanHeaders(false)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const ticket = await res.json();
      return {
        marks: Array.isArray(ticket.marks) ? ticket.marks : [],
        categoryName: ticket.alertType?.alertName?.trim() || '',
        themeName: ticket.theme?.themeName || ''
      };
    })().catch(() => {
      if (ticketCache.get(key) === request) ticketCache.delete(key);
      return null;
    });
    ticketCache.set(key, request);
    return request;
  }

  async function fetchDocumentResults(ids) {
    const res = await safeFetch(DOCUMENT_HEAD_URL, {
      method: 'POST', headers: buildCleanHeaders(true), body: JSON.stringify({ filter: { IDs: ids } })
    });
    if (ids.length > 1 && (res.status === 400 || res.status === 422)) return new Map();
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const heads = data?.data?.listSedDocuments?.documents;
    if (!Array.isArray(heads)) throw new Error('Не удалось прочитать список документов');
    return new Map(heads.map(head => [String(head.ID ?? head.id), head.ticket?.result?.name?.trim() || '']));
  }

  async function enrichRegistrarResults(docs) {
    const pending = docs.filter(doc => !doc.ticket?.result?.name?.trim());
    const ids = [...new Set(pending.map(doc => doc.id ?? doc.ID).filter(Boolean).map(String))];
    if (!pending.length) return;
    let results = new Map();
    if (ids.length) {
      try {
        results = await fetchDocumentResults(ids);
        // Retry omitted IDs using the single-document request supported by CRM.
        if (ids.length > 1) {
          const missing = ids.filter(id => !results.has(id));
          await Promise.all(missing.map(async id => {
            try {
              const single = await fetchDocumentResults([id]);
              if (single.has(id)) results.set(id, single.get(id));
            } catch {}
          }));
        }
      } catch {}
    }
    let unavailable = 0;
    for (const doc of pending) {
      const id = String(doc.id ?? doc.ID);
      if (results.has(id)) doc.resultName = results.get(id);
      else { doc.resultUnavailable = true; unavailable++; }
    }
    if (unavailable) sendLog('warn', 'Не удалось загрузить результат для ' + unavailable + ' док. в этой пачке.');
  }

  async function enrichSingleDocument(doc) {
    const t = doc.ticket || {};
    const operatorUpn = t.operator && t.operator.upn;
    const operatorDirectId = t.operator && t.operator.id;
    const creatorUpn = t.creator;

    const [ticket, operatorInfo, creatorInfo] = await Promise.all([
      getTicketDetails(t.id),
      getOperatorDetails(operatorUpn, operatorDirectId),
      getOperatorDetails(creatorUpn, null)
    ]);

    doc.ticketMarks = ticket?.marks || [];
    doc.operatorInfo = operatorInfo;
    doc.creatorInfo = creatorInfo;
  }

  async function fetchOperatorStatuses(operatorIds, mode, requestId) {
    const ids = Array.from(new Set((Array.isArray(operatorIds) ? operatorIds : []).map(Number).filter(Number.isFinite)));
    const statuses = await Promise.all(ids.map(async operatorId => ({
      operatorId,
      ...(await getOperatorCurrentStatus(operatorId))
    })));
    window.postMessage({
      source: 'CRM_INJECTOR',
      type: 'OPERATOR_STATUSES_RESULT',
      payload: { mode, requestId, statuses }
    }, '*');
  }

  async function fetchAllByFilter(filterObj, requireComplete = false) {
    logRequestFilter('Запрос searchDocuments', filterObj);
    let cursor = null;
    let allDocs = [];
    for (let page = 0; page < MAX_FILTERED_DOCUMENT_PAGES; page++) {
      const bodyPayload = {
        pagination: { cursor, perPage: DOCUMENTS_PAGE_SIZE },
        filter: filterObj
      };
      const res = await safeFetch(TARGET_URL, {
        method: 'POST',
        headers: buildCleanHeaders(true),
        body: JSON.stringify(bodyPayload)
      });
      if (!res.ok) throw new Error(`Не удалось загрузить документы: HTTP ${res.status}`);
      const json = await res.json();
      const extracted = extractSedData(json);
      if (requireComplete && (!extracted || json.errors?.length || (!extracted.items.length && extracted.cursors?.next))) {
        throw new Error('СЭД вернула неполный список документов очереди');
      }
      if (!extracted || extracted.items.length === 0) return allDocs;

      const pageDocs = extracted.items;
      for (let i = 0; i < pageDocs.length; i += CONCURRENCY_LIMIT) {
        const chunk = pageDocs.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(chunk.map(doc => enrichSingleDocument(doc)));
      }
      allDocs.push(...pageDocs);

      cursor = extracted.cursors ? extracted.cursors.next : null;
      if (!cursor) break;
    }
    if (requireComplete && cursor) throw new Error('Список документов очереди превысил предел загрузки');
    return allDocs;
  }

  async function fetchInternalRequestPages(filter, label, perPage) {
    logRequestFilter(label, filter);
    const allItems = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      const params = new URLSearchParams({
        page: String(page),
        perPage: String(perPage),
        sort: 'CREATED_AT',
        sortDirection: 'DESC',
        filter: JSON.stringify(filter)
      });
      const res = await safeFetch(`${INTERNAL_REQUESTS_URL}?${params.toString()}`, {
        method: 'GET',
        headers: buildCleanHeaders(false)
      });
      if (!res.ok) throw new Error(`alertsStatistic.json вернул HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data?.items) || data.errors?.length) throw new Error('CRM вернула неполный список внутренних запросов');
      const items = data.items;
      allItems.push(...items.filter(item =>
        item.origin === 'CHANNEL_INTERNAL_REQUEST' &&
        (!Array.isArray(filter.alertStatusIn) || filter.alertStatusIn.includes(item.status))
      ));
      totalPages = Number(data.pageInfo && data.pageInfo.totalPages) || (items.length === perPage ? page + 1 : page);
      page++;
      if (items.length === 0) break;
    }

    return allItems;
  }

  async function fetchInternalRequestsByFilter(filter, label) {
    const sources = await Promise.allSettled([
      fetchInternalRequestPages({ ...filter, alertTypeIdIn: INTERNAL_REQUEST_ALERT_TYPE_ID }, label + ' · тип 2916', 100),
      fetchInternalRequestPages({ ...filter, originIn: ['CHANNEL_INTERNAL_REQUEST'], branchIn: ['SED'] }, label + ' · ветка СЭД', 40)
    ]);
    const byId = new Map();
    const errors = [];
    for (const [index, source] of sources.entries()) {
      if (source.status === 'rejected') {
        errors.push(label + ' (' + (index === 0 ? 'тип 2916' : 'ветка СЭД') + '): ' + source.reason.message);
        continue;
      }
      for (const item of source.value) {
        if (item.id == null || String(item.id).trim() === '') continue;
        const key = String(item.id).trim();
        const previous = byId.get(key);
        const timestamp = Date.parse(item.statusUpdatedAt || item.closedAt) || 0;
        if (!previous || timestamp > (Date.parse(previous.statusUpdatedAt || previous.closedAt) || 0)) {
          byId.set(key, item);
        }
      }
    }
    const allItems = Array.from(byId.values());
    const operatorInfoByKey = new Map();
    const uniqueOperators = new Map();
    allItems.forEach(item => {
      const upn = String(item.operatorUpn || '').trim();
      const id = item.operatorID || null;
      const key = upn.toLowerCase() || `id:${id || 'unassigned'}`;
      if (!uniqueOperators.has(key)) uniqueOperators.set(key, { upn, id });
    });
    await Promise.all(Array.from(uniqueOperators.entries()).map(async ([key, operator]) => {
      operatorInfoByKey.set(key, await getOperatorDetails(operator.upn, operator.id));
    }));

    for (let i = 0; i < allItems.length; i += CONCURRENCY_LIMIT) {
      await Promise.all(allItems.slice(i, i + CONCURRENCY_LIMIT).map(async item => {
        item.categoryName = item.alertType?.alertName?.trim() || '';
        if (item.categoryName) return;
        const details = await getTicketDetails(item.id);
        item.categoryName = details?.categoryName || '';
        if (!item.themeName) item.themeName = item.theme?.themeName || item.theme?.name || details?.themeName || '';
      }));
    }

    const requests = allItems.map(item => {
      const upn = String(item.operatorUpn || '').trim();
      const key = upn.toLowerCase() || `id:${item.operatorID || 'unassigned'}`;
      const operatorInfo = operatorInfoByKey.get(key) || { operatorId: item.operatorID || null, fullName: '', groupName: 'Без группы', currentStatus: 'UNKNOWN_STATUS', statusSetAt: null };
      return {
        id: String(item.id || ''),
        documentName: '',
        isInternalRequest: true,
        internalRequestId: String(item.id || ''),
        categoryName: item.categoryName,
        themeName: item.themeName || item.theme?.themeName || item.theme?.name || '',
        alertType: item.alertType || null,
        alertTypeName: item.alertTypeName || '',
        internalRequestClosedAt: item.closedAt || null,
        createdAt: item.createdAt || null,
        updatedAt: item.closedAt || item.statusUpdatedAt || null,
        documentTypeName: '',
        operatorInfo,
        ticket: {
          id: item.id,
          status: item.status,
          operator: { id: item.operatorID || null, upn },
          queue: item.queue || null,
          origin: item.origin || '',
          firstOrigin: item.firstOrigin || '',
          themeName: item.themeName || item.theme?.themeName || item.theme?.name || '',
          alertType: item.alertType || null,
          alertTypeName: item.alertTypeName || '',
          marks: Array.isArray(item.marks) ? item.marks : []
        },
        ticketMarks: []
      };
    });
    return { requests, errors };
  }

  async function fetchClosedInternalRequestsByDate(targetDateYMD) {
    const filter = {
      alertStatusIn: ['CLOSED'],
      createdFrom: '2026-01-01T00:00:00+03:00',
      createdTo: '2027-12-31T23:59:59+03:00',
      closedAtFrom: `${targetDateYMD}T00:00:00+03:00`,
      closedAtTo: `${targetDateYMD}T23:59:59+03:00`
    };
    return fetchInternalRequestsByFilter(filter, 'Запрос закрытых внутренних запросов');
  }

  async function fetchActiveInternalRequests() {
    const filter = {
      alertStatusIn: ['ASSIGNED', 'ON_HOLD'],
      createdFrom: '2026-01-01T00:00:00+03:00',
      createdTo: '2027-12-31T23:59:59+03:00'
    };
    return fetchInternalRequestsByFilter(filter, 'Запрос внутренних запросов в работе и на удержании');
  }

  async function postClosedInternalRequests(dateYMD, requestId) {
    let requests = [];
    let error = '';
    try {
      const closed = await fetchClosedInternalRequestsByDate(dateYMD);
      requests = closed.requests;
      error = closed.errors.join(' · ');
    } catch (err) {
      error = err.message;
    }
    if (!activeLoads.has(requestId)) return;
    sendLog(error ? 'warn' : 'success', `Закрытые внутренние запросы за ${dateYMD}: ${requests.length}`, error);
    window.postMessage({
      source: 'CRM_INJECTOR', type: 'CLOSED_INTERNAL_REQUESTS_RESULT',
      payload: { requestId, closedInternalRequests: requests, error }
    }, '*');
  }

  // === ПОИСК ОПЕРАТОРОВ СЭД (POST /apps/sed/api/operators) ===
  async function searchSedOperators(query, section) {
    try {
      const cleanQuery = String(query || '').trim();
      const filter = { NameOrUpnLike: cleanQuery };
      logRequestFilter('Поиск операторов СЭД', filter);
      const res = await safeFetch(SED_OPERATORS_URL, {
        method: 'POST',
        headers: buildCleanHeaders(true),
        body: JSON.stringify({
          filter
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
  async function fetchSingleDueDateDocs(dueDateYMD, requestId, overdue) {
    try {
      const targetDueYMD = dueDateYMD || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });

      const dueDateFilter = {
        statusIn: OPEN_SED_STATUSES,
        documentCreatedFrom: "2026-01-01T00:00:00+03:00",
        documentCreatedTo: "2027-12-31T23:59:59+03:00",
        deadlineFrom: overdue ? "2026-01-01T00:00:00+03:00" : `${targetDueYMD}T00:00:00+03:00`,
        deadlineTo: `${targetDueYMD}T23:59:59+03:00`
      };

      sendLog('info', overdue ? 'Загрузка просроченных документов' : `Запрос документов со сроком истечения ${targetDueYMD}...`);
      const dueTodayDocs = await fetchAllByFilter(dueDateFilter);
      sendLog('success', `Загружены документы со сроком ${targetDueYMD}: ${dueTodayDocs.length} шт.`);

      window.postMessage({
        source: 'CRM_INJECTOR',
        type: 'DUE_DATE_RESULT',
        payload: {
          requestId, dueDateYMD: targetDueYMD,
          dueTodayDocs
        }
      }, '*');
    } catch (e) {
      sendLog('error', `Ошибка при загрузке документов по дате истечения: ${e.message}`);
      window.postMessage({
        source: 'CRM_INJECTOR',
        type: 'DUE_DATE_RESULT',
        payload: {
          requestId, dueDateYMD, error: e.message,
          dueTodayDocs: []
        }
      }, '*');
    }
  }

  async function fetchExecutorSections(closedDateYMD, requestId, includeQueues) {
    if (!includeQueues) return postClosedInternalRequests(closedDateYMD, requestId);

    const documents = await Promise.allSettled(['ASSIGNED', 'ON_HOLD'].map(status =>
      fetchAllByFilter({
        statusIn: [status],
        documentCreatedFrom: '2026-01-01T00:00:00+03:00',
        documentCreatedTo: '2027-12-31T23:59:59+03:00'
      }, true)
    ));
    if (!activeLoads.has(requestId)) return;

    const closedRequests = postClosedInternalRequests(closedDateYMD, requestId);
    try {
      const failed = documents.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      const active = await fetchActiveInternalRequests();
      if (active.errors.length) throw new Error(active.errors.join(' · '));
      if (activeLoads.has(requestId)) {
        window.postMessage({
          source: 'CRM_INJECTOR', type: 'EXECUTOR_WORKLOAD_RESULT',
          payload: {
            requestId,
            assignedDocs: documents[0].value,
            onHoldDocs: documents[1].value,
            internalRequestsInWork: active.requests.filter(item => item.ticket.status === 'ASSIGNED'),
            internalRequestsOnHold: active.requests.filter(item => item.ticket.status === 'ON_HOLD'),
            fetchedAtIso: new Date().toISOString(),
            error: ''
          }
        }, '*');
      }
    } catch (e) {
      if (activeLoads.has(requestId)) {
        window.postMessage({ source: 'CRM_INJECTOR', type: 'EXECUTOR_WORKLOAD_RESULT', payload: { requestId, error: e.message } }, '*');
        sendLog('warn', `Не удалось обновить очереди: ${e.message}`);
      }
    }
    await closedRequests;
  }

  async function liveFetchByDate(targetDateYMD, mode, requestId = Math.random().toString(36), includeQueues = true) {
    activeLoads.add(requestId);

    statusPromiseCache.clear();
    ticketCache.clear();

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

    logRequestFilter(`Фильтр countDocuments [${activeMode}]`, exactFilter);
    logRequestFilter(`Фильтр searchDocuments [${activeMode}]`, exactFilter);

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
    let matchedDocs = [];

    try {
      while (activeLoads.has(requestId)) {
        pageNum++;
        const totalHint = expectedCount !== null ? ` из ${expectedCount}` : '';
        window.postMessage({
          source: 'CRM_INJECTOR',
          type: 'LIVE_PROGRESS',
          payload: {
            requestId, mode: activeMode,
            text: `Запрос к API searchDocuments (пачка #${pageNum})... Собрано: ${matchedDocs.length}${totalHint}`
          }
        }, '*');

        const bodyPayload = {
          pagination: { cursor: currentCursor, perPage: DOCUMENTS_PAGE_SIZE },
          filter: exactFilter
        };

        let res = await safeFetch(TARGET_URL, {
          method: 'POST',
          headers: buildCleanHeaders(true),
          body: JSON.stringify(bodyPayload)
        });

        if (!res.ok && pageNum === 1 && activeMode === 'registrars') {
          delete exactFilter.statusIn;
          logRequestFilter('Повторный фильтр searchDocuments [registrars без statusIn]', exactFilter);
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
            requestId, mode: activeMode,
            text: `Загрузка меток, ФИО, групп и статусов (пачка #${pageNum}: ${pageDocs.length} док.)...`
          }
        }, '*');

        for (let i = 0; i < pageDocs.length; i += CONCURRENCY_LIMIT) {
          if (!activeLoads.has(requestId)) break;
          const chunk = pageDocs.slice(i, i + CONCURRENCY_LIMIT);
          await Promise.all([
            ...chunk.map(doc => enrichSingleDocument(doc)),
            activeMode === 'registrars' && enrichRegistrarResults(chunk)
          ]);
        }

        matchedDocs.push(...pageDocs);

        currentCursor = extracted.cursors ? extracted.cursors.next : null;
        if (!currentCursor) break;
      }

      if (activeLoads.has(requestId)) {
        const fetchedAtIso = new Date().toISOString();
        sendLog('success', `Сбор [${activeMode}] завершен! Документов: ${matchedDocs.length}`);
        window.postMessage({
          source: 'CRM_INJECTOR',
          type: 'LIVE_RESULT',
          payload: {
            requestId, mode: activeMode,
            targetDate: targetDateYMD,
            fetchedAt: fetchedAtIso,
            totalScanned: matchedDocs.length,
            items: matchedDocs
          }
        }, '*');

      }
    } catch (err) {
      sendLog('error', `Критическая ошибка в liveFetchByDate: ${err.message}`, err.stack || null);
      window.postMessage({
        source: 'CRM_INJECTOR',
        type: 'LIVE_ERROR',
        payload: { mode: activeMode, requestId, message: err.message }
      }, '*');
    } finally {
      try {
        if (activeMode === 'executors' && activeLoads.has(requestId)) {
          await fetchExecutorSections(targetDateYMD, requestId, includeQueues);
        }
      } finally {
        activeLoads.delete(requestId);
      }
    }
  }

  if (window.__OZON_MSG_HANDLER__) {
    window.removeEventListener('message', window.__OZON_MSG_HANDLER__);
  }
  window.__OZON_MSG_HANDLER__ = (event) => {
    if (!event.data || event.data.source !== 'CRM_BRIDGE') return;

    if (event.data.type === 'FETCH_DATE') {
      const p = event.data.payload || {};
      liveFetchByDate(p.dateYMD, p.mode, p.requestId, p.includeQueues);
    }
    if (event.data.type === 'FETCH_DUE_DATE') {
      const p = event.data.payload || {};
      fetchSingleDueDateDocs(p.dueDateYMD, p.requestId, p.overdue);
    }
    if (event.data.type === 'STOP_FETCH') {
      sendLog('warn', 'Запрос остановлен пользователем.');
      activeLoads.delete(event.data.payload?.requestId);
    }
    if (event.data.type === 'SEARCH_OPERATORS') {
      const p = event.data.payload || {};
      searchSedOperators(p.query, p.section);
    }
    if (event.data.type === 'ASSIGN_TICKETS') {
      const p = event.data.payload || {};
      assignSedTickets(p.alertIds, p.operator, p.section);
    }
    if (event.data.type === 'FETCH_OPERATOR_STATUSES') {
      const p = event.data.payload || {};
      fetchOperatorStatuses(p.operatorIds, p.mode, p.requestId).catch(e => {
        sendLog('error', `Не удалось дозагрузить статусы операторов: ${e.message}`);
        window.postMessage({
          source: 'CRM_INJECTOR',
          type: 'OPERATOR_STATUSES_RESULT',
          payload: { mode: p.mode, requestId: p.requestId, statuses: [], error: e.message }
        }, '*');
      });
    }
  };
  window.addEventListener('message', window.__OZON_MSG_HANDLER__);
})();
