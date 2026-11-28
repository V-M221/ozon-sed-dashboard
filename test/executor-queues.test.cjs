const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const injector = readFileSync(path.join(__dirname, '..', 'injector.js'), 'utf8');

async function loadExecutors({ includeQueues, failedSource } = {}) {
  const sources = [];
  const messages = [];
  const response = (data, status = 200) => ({
    ok: status === 200, status, json: async () => data, text: async () => '',
  });
  const window = {
    addEventListener() {},
    postMessage(message) { messages.push(message); },
    async fetch(url, options = {}) {
      const endpoint = new URL(url);
      if (endpoint.pathname.endsWith('/searchDocuments')) {
        const { filter } = JSON.parse(options.body);
        const source = filter.statusIn[0];
        sources.push(source);
        if (source === failedSource) return response({}, 503);
        return response({ data: { searchSedDocuments: { documents: [] } } });
      }
      if (endpoint.pathname.endsWith('/alertsStatistic.json')) {
        const filter = JSON.parse(endpoint.searchParams.get('filter'));
        const scope = filter.closedAtFrom ? 'closed' : 'active';
        const source = scope + (filter.branchIn ? '-branch' : '-type');
        sources.push(source);
        if (source === failedSource) return response({}, 503);
        const status = scope === 'closed' ? 'CLOSED' : 'ASSIGNED';
        return response({ items: [{ id: 42, origin: 'CHANNEL_INTERNAL_REQUEST', status, alertType: { alertName: 'test' } }] });
      }
      return response({});
    },
  };
  vm.runInNewContext(injector, { window, URLSearchParams, Headers, console, setTimeout });
  const requestId = 'test-executors';
  window.__OZON_MSG_HANDLER__({ data: { source: 'CRM_BRIDGE', type: 'FETCH_DATE', payload: {
    requestId, mode: 'executors', dateYMD: '2026-11-20', includeQueues,
  } } });
  // All HTTP responses above resolve immediately. Drain promise continuations before checking absent calls.
  await new Promise(setImmediate);
  function result(type) {
    const matches = messages.filter(message => message.type === type && message.payload.requestId === requestId);
    assert.ok(matches.length <= 1, `Repeated ${type} for one request`);
    return matches[0]?.payload;
  }
  return { sources: sources.sort(), day: result('LIVE_RESULT'), closed: result('CLOSED_INTERNAL_REQUESTS_RESULT'), queues: result('EXECUTOR_WORKLOAD_RESULT') };
}

test('initial executor load publishes one complete queue snapshot and a separate daily result', async () => {
  const { sources, day, closed, queues } = await loadExecutors();
  assert.deepEqual(sources, ['ASSIGNED', 'CLOSED', 'ON_HOLD', 'active-branch', 'active-type', 'closed-branch', 'closed-type']);
  assert.equal(day.targetDate, '2026-11-20');
  assert.equal(closed.closedInternalRequests.length, 1);
  assert.equal(queues.assignedDocs.length, 0);
  assert.equal(queues.onHoldDocs.length, 0);
  assert.equal(queues.internalRequestsInWork.length, 1);
  assert.equal(queues.internalRequestsOnHold.length, 0);
  assert.ok(Number.isFinite(Date.parse(queues.fetchedAtIso)));
});

test('date-only executor load reads daily documents and both closed request sources', async () => {
  const { sources, day, closed, queues } = await loadExecutors({ includeQueues: false });
  assert.deepEqual(sources, ['CLOSED', 'closed-branch', 'closed-type']);
  assert.ok(day);
  assert.equal(closed.closedInternalRequests.length, 1);
  assert.equal(queues, undefined);
});

test('a failed active request source cannot publish a partial snapshot or advance its time', async () => {
  const { day, closed, queues } = await loadExecutors({ failedSource: 'active-branch' });
  assert.ok(day);
  assert.equal(closed.closedInternalRequests.length, 1);
  assert.match(queues.error, /503/);
  assert.deepEqual(Object.keys(queues).sort(), ['error', 'requestId']);
});
