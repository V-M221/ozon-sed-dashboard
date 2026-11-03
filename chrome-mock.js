// Browser fallback shim for Chrome Extension APIs when running outside a Chrome Extension context (e.g., AI Studio preview)
(function () {
  if (typeof window.chrome !== 'undefined' && window.chrome.runtime && window.chrome.runtime.onMessage && window.chrome.tabs) {
    return;
  }

  const listeners = [];

  function emitRuntimeMessage(msg) {
    setTimeout(() => {
      listeners.forEach((fn) => {
        try {
          fn(msg, {}, () => {});
        } catch (err) {
          console.error('[chrome-mock] listener error:', err);
        }
      });
    }, 30);
  }

  const MOCK_OPERATORS = [
    { id: 101, fullName: 'Смирнова Елена Викторовна', upn: 'esmirnova@ozon.bank', groupName: 'Группа Входящей Корреспонденции', currentStatus: 'ONLINE', statusSetAt: new Date(Date.now() - 42 * 60000).toISOString() },
    { id: 102, fullName: 'Кузнецов Алексей Игоревич', upn: 'akuznetsov@ozon.bank', groupName: 'Группа Входящей Корреспонденции', currentStatus: 'POSTPROCESSING', statusSetAt: new Date(Date.now() - 14 * 60000).toISOString() },
    { id: 103, fullName: 'Попова Мария Сергеевна', upn: 'mpopova@ozon.bank', groupName: 'Группа Запросов Госорганов', currentStatus: 'ONLINE', statusSetAt: new Date(Date.now() - 95 * 60000).toISOString() },
    { id: 104, fullName: 'Соколов Дмитрий Андреевич', upn: 'dsokolov@ozon.bank', groupName: 'Группа Запросов Госорганов', currentStatus: 'BREAK', statusSetAt: new Date(Date.now() - 8 * 60000).toISOString() },
    { id: 105, fullName: 'Морозова Анна Павловна', upn: 'amorozova@ozon.bank', groupName: 'Группа Договорного Сопровождения', currentStatus: 'ONLINE', statusSetAt: new Date(Date.now() - 125 * 60000).toISOString() },
    { id: 106, fullName: 'Волков Максим Олегович', upn: 'mvolkov@ozon.bank', groupName: 'Группа Регистрации СЭД', currentStatus: 'ONLINE', statusSetAt: new Date(Date.now() - 60 * 60000).toISOString() }
  ];

  const DOC_TYPES = [
    'Запрос государственного органа',
    'Входящее письмо ЦБ РФ',
    'Судебный приказ / Исполнительный лист',
    'Договор возмездного оказания услуг',
    'Официальный ответ клиенту',
    'Внутренняя служебная записка'
  ];

  const ENTITIES = ['ОБ', 'ОФК', 'ОЗОН-БАНК', 'ЕКОМ'];
  const QUEUES = ['СЭД · Общая очередь', 'СЭД · Госорганы VIP', 'СЭД · ЦБ и Регуляторы', 'СЭД · Договоры'];
  const MARKS_POOL = ['Срочно', 'Контроль ЦБ', 'ЭДО', 'Повторный', 'Бумажный оригинал'];

  function buildSampleDocs(dateYMD, count, statusOverride, deadlineYMD) {
    const docs = [];
    const baseDate = dateYMD || new Date().toISOString().slice(0, 10);

    for (let i = 0; i < count; i++) {
      const op = MOCK_OPERATORS[i % MOCK_OPERATORS.length];
      const creator = MOCK_OPERATORS[(i + 2) % MOCK_OPERATORS.length];
      const ent = ENTITIES[i % ENTITIES.length];
      const docType = DOC_TYPES[i % DOC_TYPES.length];
      const queueName = QUEUES[i % QUEUES.length];
      const heading = i % 3 === 0 ? 'OUTGOING' : 'INCOMING';
      const hour = 8 + (i % 11);
      const min = (i * 7) % 60;
      const timeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+03:00`;
      const isoAt = `${baseDate}T${timeStr}`;
      const dlDate = deadlineYMD || baseDate;
      const deadlineIso = `${dlDate}T18:00:00+03:00`;

      const marks = [];
      if (i % 2 === 0) marks.push({ name: MARKS_POOL[i % MARKS_POOL.length] });
      if (i % 5 === 0) marks.push({ name: MARKS_POOL[(i + 1) % MARKS_POOL.length] });

      const status = statusOverride || 'CLOSED';
      const unassigned = status !== 'CLOSED' && i % 4 === 0;

      docs.push({
        id: `doc-${baseDate}-${status}-${i + 1}`,
        documentName: `${ent}-${10400 + i}`,
        documentTypeName: docType,
        heading,
        createdAt: isoAt,
        updatedAt: isoAt,
        deadline: deadlineIso,
        correspondent: {
          fullName: i % 2 === 0 ? 'ФНС России (Межрегиональная инспекция)' : 'Банк России (Департамент надзора)'
        },
        ticket: {
          id: 90000 + i + (status === 'CLOSED' ? 0 : status === 'ASSIGNED' ? 1000 : 2000),
          status,
          closedAt: status === 'CLOSED' ? isoAt : null,
          creator: creator.upn,
          operator: unassigned ? null : { id: op.id, upn: op.upn },
          queue: { name: queueName }
        },
        ticketMarks: marks,
        operatorInfo: unassigned
          ? { operatorId: null, fullName: '', groupId: '', groupName: 'Без группы', currentStatus: 'UNKNOWN_STATUS', statusSetAt: null }
          : {
              operatorId: op.id,
              fullName: op.fullName,
              groupId: String(op.id),
              groupName: op.groupName,
              currentStatus: op.currentStatus,
              statusSetAt: op.statusSetAt
            },
        creatorInfo: {
          operatorId: creator.id,
          fullName: creator.fullName,
          groupId: String(creator.id),
          groupName: creator.groupName,
          currentStatus: creator.currentStatus,
          statusSetAt: creator.statusSetAt
        }
      });
    }
    return docs;
  }

  let cachedOverdue = null;
  let cachedDueToday = null;
  let cachedAssigned = null;

  function handleInjectorMessage(msg) {
    if (!msg || msg.target !== 'INJECTOR') return;
    const { type, payload = {} } = msg;

    if (type === 'FETCH_DATE') {
      const mode = payload.mode || 'executors';
      const dateYMD = payload.dateYMD || new Date().toISOString().slice(0, 10);
      const dueDateYMD = payload.dueDateYMD || dateYMD;

      emitRuntimeMessage({
        type: 'LIVE_LOG',
        payload: {
          time: new Date().toLocaleTimeString('ru-RU', { hour12: false }) + '.000',
          level: 'info',
          message: `[Preview Mock] Загрузка данных виджета [${mode}] за ${dateYMD}`,
          details: null
        }
      });

      const items = buildSampleDocs(dateYMD, mode === 'registrars' ? 32 : 40, mode === 'registrars' ? 'ASSIGNED' : 'CLOSED');

      emitRuntimeMessage({
        type: 'LIVE_RESULT',
        payload: {
          mode,
          targetDate: dateYMD,
          fetchedAt: new Date().toISOString(),
          totalScanned: items.length,
          items
        }
      });

      if (mode === 'executors') {
        const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        cachedOverdue = cachedOverdue || buildSampleDocs(yest, 6, 'CREATED', yest);
        cachedDueToday = buildSampleDocs(dueDateYMD, 8, 'ACKNOWLEDGED', dueDateYMD);
        cachedAssigned = cachedAssigned || buildSampleDocs(dateYMD, 9, 'ASSIGNED', dueDateYMD);

        emitRuntimeMessage({
          type: 'DEADLINES_RESULT',
          payload: {
            todayYMD: dueDateYMD,
            yesterdayYMD: yest,
            overdueDocs: cachedOverdue,
            dueTodayDocs: cachedDueToday,
            assignedDocs: cachedAssigned
          }
        });
      }
      return;
    }

    if (type === 'FETCH_DUE_DATE') {
      const dueDateYMD = payload.dueDateYMD || new Date().toISOString().slice(0, 10);
      cachedDueToday = buildSampleDocs(dueDateYMD, 7, 'ACKNOWLEDGED', dueDateYMD);
      emitRuntimeMessage({
        type: 'DUE_DATE_RESULT',
        payload: {
          dueDateYMD,
          dueTodayDocs: cachedDueToday
        }
      });
      return;
    }

    if (type === 'SEARCH_OPERATORS') {
      const q = String(payload.query || '').trim().toLowerCase();
      const items = MOCK_OPERATORS.filter(
        (op) => !q || op.fullName.toLowerCase().includes(q) || op.upn.toLowerCase().includes(q)
      ).map((op) => ({ id: op.id, fullName: op.fullName, upn: op.upn }));

      emitRuntimeMessage({
        type: 'SEARCH_OPERATORS_RESULT',
        payload: {
          section: payload.section,
          query: payload.query,
          items
        }
      });
      return;
    }

    if (type === 'ASSIGN_TICKETS') {
      const { section, alertIds = [], operator } = payload;
      const matchedOp = MOCK_OPERATORS.find((o) => o.id === Number(operator && operator.id)) || MOCK_OPERATORS[0];
      emitRuntimeMessage({
        type: 'ASSIGN_TICKETS_RESULT',
        payload: {
          section,
          operator,
          operatorInfo: {
            operatorId: matchedOp.id,
            fullName: matchedOp.fullName,
            groupId: String(matchedOp.id),
            groupName: matchedOp.groupName,
            currentStatus: matchedOp.currentStatus,
            statusSetAt: matchedOp.statusSetAt
          },
          succeededAlertIds: alertIds,
          failedItems: []
        }
      });
    }
  }

  const origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('chatzone.o3t.ru/api/v4/posts')) {
        await new Promise((r) => setTimeout(r, 150));
        return new Response(JSON.stringify({ id: 'mock_post_' + Date.now(), status: 'OK' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return origFetch(input, init);
    };
  }

  window.chrome = {
    runtime: {
      getManifest: () => ({ version: '3.0', name: 'Ozon Банк · СЭД Онлайн-Дашборд' }),
      getURL: (path) => path,
      reload: () => window.location.reload(),
      onMessage: {
        addListener: (fn) => {
          if (typeof fn === 'function') listeners.push(fn);
        }
      },
      sendMessage: async () => ({ ok: true })
    },
    cookies: {
      get: async () => ({ name: 'MMCSRF', value: 'preview-mock-csrf-token' })
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://crm.bank.ozon.ru/sed' }],
      sendMessage: async (tabId, messagePayload) => {
        handleInjectorMessage(messagePayload);
        return { ok: true };
      },
      create: ({ url }) => {
        if (url) window.location.href = url;
      }
    },
    scripting: {
      executeScript: async () => [{}]
    },
    sidePanel: {
      setPanelBehavior: async () => {}
    }
  };
})();
