/**
 * Local tests for the Host half. They exercise the real `apply()` against a fake
 * Cordis context and synthetic HTTP request/response objects, so the token gate,
 * the endpoint contract, and the compaction error mapping are verified without a
 * running Harness.
 *
 * Run with: node --test tests/
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { apply, __test__ } from '../index.js'

const { ROUTE_PREFIX, USAGE_PATH, COMPACT_PATH, TOKEN_HEADER, TOKEN_GLOBAL } = __test__

/* ── Harness ───────────────────────────────────────────────────────────────── */

function createSession(overrides = {}) {
  return Object.assign(
    {
      requestContext() {
        return { provider: 'deepseek-account', model: 'deepseek-flash', contextWindow: 1000000 }
      },
    },
    overrides,
  )
}

function createHarness(options = {}) {
  const routes = []
  const taps = []
  const disposers = []
  const measurements = Array.isArray(options.measurements) ? options.measurements.slice() : [250000]
  const tokenMeter =
    options.tokenMeter === undefined
      ? {
          measure() {
            const next = measurements.length > 1 ? measurements.shift() : measurements[0]
            return { totalTokens: next, surfaceTokens: Math.max(0, next - 2000) }
          },
        }
      : options.tokenMeter
  const ctx = {
    get(key) {
      if (key === 'agents') return options.agents
      if (key === 'compaction') return options.compaction
      if (key === 'tokenMeter') return tokenMeter
      if (key === 'agentPresets') return options.agentPresets
      if (key === 'commands') return options.commands
      return undefined
    },
    effect(fn) {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
    webServer: {
      getOrigin: () => options.origin || 'http://127.0.0.1:57598',
      tapIndex(transform) {
        taps.push(transform)
        return () => {}
      },
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
  }
  apply(ctx)
  assert.equal(routes.length, 1, 'one prefix route is registered')
  assert.equal(taps.length, 1, 'one index tap is registered')

  const html = '<html><head><title>x</title></head><body>app</body></html>'
  const rendered = taps[0](html)
  const match = new RegExp('window\\.' + TOKEN_GLOBAL + '=(\\{[^}]*\\});').exec(rendered)
  assert.ok(match, 'the token bootstrap script is injected into the page shell')
  const token = JSON.parse(match[1]).token
  assert.equal(typeof token, 'string')

  return {
    routes,
    route: routes[0],
    token,
    rendered,
    dispose() {
      for (const disposer of disposers.reverse()) {
        try {
          disposer()
        } catch {
          /* ignore */
        }
      }
    },
  }
}

function makeRequest(url, { method = 'POST', token, body, headers = {} } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = Object.assign({}, headers)
  if (token !== undefined) req.headers[TOKEN_HEADER] = token
  req.socket = { remoteAddress: '127.0.0.1' }
  setImmediate(() => {
    if (body !== undefined && body !== null) req.emit('data', Buffer.from(body))
    req.emit('end')
  })
  return req
}

function makeResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    chunk: null,
    writableEnded: false,
    headersSent: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(data) {
      if (data !== undefined) this.chunk = Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
      this.writableEnded = true
    },
  }
  return res
}

async function call(harness, pathname, options = {}) {
  const req = makeRequest(ROUTE_PREFIX + pathname, Object.assign({ token: harness.token }, options))
  const res = makeResponse()
  await harness.route.handler(req, res)
  let json = null
  try {
    json = JSON.parse(res.chunk || 'null')
  } catch {
    json = null
  }
  return { status: res.statusCode, json, raw: res.chunk }
}

/* ── Registration and bootstrap ───────────────────────────────────────────── */

test('registers a prefix route and injects the token into the page head', () => {
  const harness = createHarness({ agents: { get: () => undefined } })
  try {
    assert.equal(harness.route.kind, 'prefix')
    assert.equal(harness.route.path, ROUTE_PREFIX)
    assert.equal(typeof harness.route.handler, 'function')
    assert.ok(harness.rendered.includes('window.' + TOKEN_GLOBAL))
    const headClose = harness.rendered.indexOf('</head>')
    const scriptAt = harness.rendered.indexOf('window.' + TOKEN_GLOBAL)
    assert.ok(scriptAt !== -1 && scriptAt < headClose, 'the script sits inside <head>')
    assert.ok(harness.rendered.includes('app'), 'the page body is preserved')
  } finally {
    harness.dispose()
  }
})

test('injects the token even into a page without </head>', () => {
  const taps = []
  const ctx = {
    get: () => undefined,
    effect: (fn) => fn(),
    webServer: {
      getOrigin: () => 'http://127.0.0.1:1',
      tapIndex: (transform) => taps.push(transform),
      register: () => () => {},
    },
  }
  apply(ctx)
  const rendered = taps[0]('<html><body>x</body></html>')
  assert.ok(rendered.startsWith('<script>'), 'the bootstrap script leads the document when <head> is missing')
})

/* ── Authorization ────────────────────────────────────────────────────────── */

test('rejects requests without the page token', async () => {
  const harness = createHarness({ agents: { get: () => undefined } })
  try {
    const { status, json } = await call(harness, '/api/usage', { token: undefined, body: '{}' })
    assert.equal(status, 401)
    assert.equal(json.ok, false)
    assert.equal(json.error.code, 'unauthorized')
  } finally {
    harness.dispose()
  }
})

test('rejects a wrong token', async () => {
  const harness = createHarness({ agents: { get: () => undefined } })
  try {
    const { status, json } = await call(harness, '/api/usage', {
      token: 'not-the-page-token',
      body: '{}',
    })
    assert.equal(status, 401)
    assert.equal(json.error.code, 'unauthorized')
  } finally {
    harness.dispose()
  }
})

test('rejects a cross-origin request carrying a valid token', async () => {
  const harness = createHarness({ agents: { get: () => undefined } })
  try {
    const { status, json } = await call(harness, '/api/usage', {
      body: '{}',
      headers: { origin: 'https://evil.example', host: '127.0.0.1:57598', 'sec-fetch-site': 'cross-site' },
    })
    assert.equal(status, 403)
    assert.equal(json.error.code, 'forbidden')
  } finally {
    harness.dispose()
  }
})

test('accepts the host page origin', async () => {
  const harness = createHarness({ agents: { get: () => undefined } })
  try {
    const { status } = await call(harness, '/api/usage', {
      body: '{"sessionId":"s1"}',
      headers: { origin: 'http://127.0.0.1:57598', host: '127.0.0.1:57598' },
    })
    assert.equal(status, 404, 'the origin is accepted and the missing session is reported next')
  } finally {
    harness.dispose()
  }
})

/* ── Usage endpoint ───────────────────────────────────────────────────────── */

test('usage returns the live measurement and window ratio', async () => {
  const agent = { id: 's1', session: createSession() }
  const harness = createHarness({ agents: { get: (id) => (id === 's1' ? agent : undefined) } })
  try {
    const { status, json } = await call(harness, '/api/usage', { body: '{"sessionId":"s1"}' })
    assert.equal(status, 200)
    assert.equal(json.ok, true)
    assert.equal(json.sessionId, 's1')
    assert.equal(json.usage.tokens, 250000)
    assert.equal(json.usage.surfaceTokens, 248000)
    assert.equal(json.usage.contextWindow, 1000000)
    assert.equal(json.usage.ratio, 0.25)
    assert.equal(json.usage.model, 'deepseek-flash')
    assert.equal(json.usage.provider, 'deepseek-account')
  } finally {
    harness.dispose()
  }
})

test('usage degrades to nulls without a token meter', async () => {
  const agent = { id: 's1', session: createSession() }
  const harness = createHarness({
    agents: { get: () => agent },
    tokenMeter: null,
  })
  try {
    const { status, json } = await call(harness, '/api/usage', { body: '{"sessionId":"s1"}' })
    assert.equal(status, 200)
    assert.equal(json.ok, true)
    assert.equal(json.usage.tokens, null)
    assert.equal(json.usage.contextWindow, 1000000)
    assert.equal(json.usage.ratio, null)
  } finally {
    harness.dispose()
  }
})

test('usage for a session that is not live is a clear 404', async () => {
  const harness = createHarness({ agents: { get: () => undefined } })
  try {
    const { status, json } = await call(harness, '/api/usage', { body: '{"sessionId":"missing"}' })
    assert.equal(status, 404)
    assert.equal(json.error.code, 'session-not-live')
  } finally {
    harness.dispose()
  }
})

test('missing or blank sessionId is a 400', async () => {
  const harness = createHarness({ agents: { get: () => ({ id: 's1', session: createSession() }) } })
  try {
    for (const body of ['{}', '{"sessionId":"   "}', '{"sessionId":42}']) {
      const { status, json } = await call(harness, '/api/usage', { body })
      assert.equal(status, 400)
      assert.equal(json.error.code, 'bad-request')
    }
    const invalid = await call(harness, '/api/usage', { body: '{not json' })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.json.error.code, 'bad-request')
  } finally {
    harness.dispose()
  }
})

test('unknown paths and non-POST methods are rejected', async () => {
  const harness = createHarness({ agents: { get: () => undefined } })
  try {
    const unknown = await call(harness, '/api/nope', { body: '{}' })
    assert.equal(unknown.status, 404)
    assert.equal(unknown.json.error.code, 'not-found')
    const get = await call(harness, '/api/usage', { method: 'GET' })
    assert.equal(get.status, 405)
    assert.equal(get.json.error.code, 'method-not-allowed')
  } finally {
    harness.dispose()
  }
})

/* ── Compact endpoint ─────────────────────────────────────────────────────── */

function compactHarness(resultOrError, overrides = {}) {
  const calls = []
  const compaction = {
    async compactNow(agent, signal) {
      calls.push({ agent, signal })
      if (typeof resultOrError === 'function') return resultOrError(agent, signal)
      if (resultOrError instanceof Error) throw resultOrError
      return resultOrError
    },
  }
  const agents = {
    get: (id) => (id === 's1' ? { id: 's1', session: createSession() } : undefined),
  }
  const harness = createHarness(Object.assign({ agents, compaction, measurements: [250000, 80000] }, overrides))
  return { harness, calls, compaction }
}

test('compact runs manual compaction and reports the reclaimed history', async () => {
  const { harness, calls } = compactHarness({
    shadowedSeqs: [10, 11, 12],
    shadowedTokenCount: 12000,
    summarySeq: 42,
    summary: [
      { type: 'text', text: '第 1 段摘要' },
      { type: 'reasoning', text: 'internal reasoning is not shown' },
      { type: 'text', text: '第 2 段摘要' },
    ],
  })
  try {
    const { status, json } = await call(harness, '/api/compact', { body: '{"sessionId":"s1"}' })
    assert.equal(status, 200)
    assert.equal(json.ok, true)
    assert.equal(json.noop, false)
    assert.equal(json.result.shadowedCount, 3)
    assert.equal(json.result.shadowedTokens, 12000)
    assert.equal(json.result.summarySeq, 42)
    assert.equal(json.result.summary, '第 1 段摘要\n\n第 2 段摘要')
    assert.equal(json.before.tokens, 250000)
    assert.equal(json.after.tokens, 80000)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].agent.id, 's1', 'the exact live agent is passed to compaction')
    assert.ok(calls[0].signal && typeof calls[0].signal.aborted === 'boolean')
  } finally {
    harness.dispose()
  }
})

test('compact reports a no-op as success', async () => {
  const { harness } = compactHarness(null)
  try {
    const { status, json } = await call(harness, '/api/compact', { body: '{"sessionId":"s1"}' })
    assert.equal(status, 200)
    assert.equal(json.ok, true)
    assert.equal(json.noop, true)
    assert.equal(json.result, undefined)
  } finally {
    harness.dispose()
  }
})

test('compact maps the busy failure to 409 busy', async () => {
  const error = Object.assign(new Error('agent is not idle'), { name: 'ManualCompactionError', code: 'busy' })
  const { harness } = compactHarness(error)
  try {
    const { status, json } = await call(harness, '/api/compact', { body: '{"sessionId":"s1"}' })
    assert.equal(status, 409)
    assert.equal(json.ok, false)
    assert.equal(json.error.code, 'busy')
  } finally {
    harness.dispose()
  }
})

test('compact maps expected compaction failures and hides unexpected internals behind 500', async () => {
  const changed = Object.assign(new Error('span changed'), { name: 'ManualCompactionError', code: 'changed' })
  const changedHarness = compactHarness(changed)
  try {
    const { status, json } = await call(changedHarness.harness, '/api/compact', { body: '{"sessionId":"s1"}' })
    assert.equal(status, 500)
    assert.equal(json.error.code, 'changed')
  } finally {
    changedHarness.harness.dispose()
  }

  const internalHarness = compactHarness(new Error('kaboom'))
  try {
    const { status, json } = await call(internalHarness.harness, '/api/compact', { body: '{"sessionId":"s1"}' })
    assert.equal(status, 500)
    assert.equal(json.error.code, 'internal')
  } finally {
    internalHarness.harness.dispose()
  }
})

test('compact refuses a second concurrent run for the same session', async () => {
  let release = null
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const { harness } = compactHarness(async () => {
    await gate
    return null
  })
  try {
    const first = call(harness, '/api/compact', { body: '{"sessionId":"s1"}' })
    // Let the first request reach compactNow before the second arrives.
    await new Promise((resolve) => setImmediate(resolve))
    const second = await call(harness, '/api/compact', { body: '{"sessionId":"s1"}' })
    assert.equal(second.status, 409)
    assert.equal(second.json.error.code, 'busy')
    release()
    const settled = await first
    assert.equal(settled.status, 200)
  } finally {
    harness.dispose()
  }
})

test('compact without a compaction service is a clear 503', async () => {
  const agents = { get: () => ({ id: 's1', session: createSession() }) }
  const harness = createHarness({ agents, compaction: undefined })
  try {
    const { status, json } = await call(harness, '/api/compact', { body: '{"sessionId":"s1"}' })
    assert.equal(status, 503)
    assert.equal(json.error.code, 'unsupported')
  } finally {
    harness.dispose()
  }
})

test('disposing the plugin aborts an in-flight compaction', async () => {
  const observed = {}
  const { harness } = compactHarness(
    (agent, signal) =>
      new Promise((resolve, reject) => {
        observed.aborted = signal.aborted
        signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('compaction cancelled'), { code: 'cancelled' }))
        })
      }),
  )
  try {
    const pending = call(harness, '/api/compact', { body: '{"sessionId":"s1"}' })
    await new Promise((resolve) => setImmediate(resolve))
    harness.dispose()
    const { status, json } = await pending
    assert.equal(observed.aborted, false)
    assert.equal(status, 499)
    assert.equal(json.error.code, 'cancelled')
  } finally {
    harness.dispose()
  }
})

/* ── Preset-scoped compaction (the current Web/Desktop composition) ──────── */

test('compact uses the Agent-preset scoped compaction service when present', async () => {
  const calls = []
  const scoped = {
    async compactNow(agent, signal) {
      calls.push({ agent, signal })
      return {
        shadowedSeqs: [4, 5],
        shadowedTokenCount: 7000,
        summarySeq: 12,
        summary: [{ type: 'text', text: 'preset summary' }],
      }
    },
  }
  const agents = { get: (id) => (id === 's1' ? { id: 's1', session: createSession() } : undefined) }
  const agentPresets = { serviceFor: (agent, name) => (name === 'compaction' ? scoped : undefined) }
  const harness = createHarness({ agents, agentPresets, measurements: [250000, 80000] })
  try {
    const { status, json } = await call(harness, '/api/compact', { body: '{"sessionId":"s1"}' })
    assert.equal(status, 200)
    assert.equal(json.ok, true)
    assert.equal(json.noop, false)
    assert.equal(json.result.shadowedCount, 2)
    assert.equal(json.result.shadowedTokens, 7000)
    assert.equal(json.result.summary, 'preset summary')
    assert.equal(json.result.summarySeq, 12)
    assert.equal(calls.length, 1, 'the preset-scoped service ran exactly once')
    assert.equal(calls[0].agent.id, 's1')
  } finally {
    harness.dispose()
  }
})

test('compact prefers the shipped /compact command when it resolves', async () => {
  const events = []
  const session = createSession()
  Object.defineProperty(session, 'seq', { get: () => 5 })
  session.ownEvents = () => events
  const executed = []
  const commands = {
    find: () => ({ name: 'compact' }),
    async execute(agent, line) {
      executed.push({ agent, line })
      events.push({
        type: 'compaction/summary',
        seq: 10,
        data: { shadowedSeqs: [6, 7], shadowedTokenCount: 3000, summary: [{ type: 'text', text: 'command summary' }] },
      })
      return { commandId: 'c1', result: { kind: 'success', text: 'Compacted 2 history items (~3000 tokens).' } }
    },
  }
  let presetCalls = 0
  const preset = {
    async compactNow() {
      presetCalls += 1
      return null
    },
  }
  const agentPresets = { serviceFor: () => preset }
  const harness = createHarness({
    agents: { get: () => ({ id: 's1', session }) },
    commands,
    agentPresets,
    measurements: [100000, 50000],
  })
  try {
    const { status, json } = await call(harness, '/api/compact', { body: '{"sessionId":"s1"}' })
    assert.equal(status, 200)
    assert.equal(json.result.summary, 'command summary')
    assert.equal(executed.length, 1, 'the command path wins when it resolves')
    assert.equal(presetCalls, 0, 'the preset service is not used needlessly')
  } finally {
    harness.dispose()
  }
})

test('compact falls back to the Agent-scoped context service', async () => {
  const calls = []
  const scoped = {
    async compactNow() {
      calls.push(1)
      return { shadowedSeqs: [2], shadowedTokenCount: 1000, summarySeq: 8, summary: [{ type: 'text', text: 'ctx summary' }] }
    },
  }
  const agent = { id: 's1', session: createSession(), ctx: { get: (name) => (name === 'compaction' ? scoped : undefined) } }
  const harness = createHarness({ agents: { get: () => agent }, measurements: [100000, 50000] })
  try {
    const { status, json } = await call(harness, '/api/compact', { body: '{"sessionId":"s1"}' })
    assert.equal(status, 200)
    assert.equal(json.result.summary, 'ctx summary')
    assert.equal(calls.length, 1)
  } finally {
    harness.dispose()
  }
})

test('compact falls back to the Agent-scoped /compact command and reads the durable summary event', async () => {
  const events = [{ type: 'user/message', seq: 3, data: {} }]
  const executed = []
  const session = createSession()
  let seq = 5
  Object.defineProperty(session, 'seq', { get: () => seq })
  session.ownEvents = () => events
  const commands = {
    find: () => ({ name: 'compact' }),
    async execute(agent, line, attachments, signal) {
      executed.push({ agent, line, attachments, signal })
      seq = 11
      events.push({
        type: 'compaction/summary',
        seq: 10,
        data: {
          shadowedSeqs: [6, 7, 8, 9],
          shadowedTokenCount: 12000,
          summary: [{ type: 'text', text: 'command summary' }],
        },
      })
      return { commandId: 'c1', result: { kind: 'success', text: 'Compacted 4 history items (~12000 tokens).' } }
    },
  }
  const harness = createHarness({
    agents: { get: (id) => (id === 's1' ? { id: 's1', session } : undefined) },
    commands,
    measurements: [250000, 80000],
  })
  try {
    const { status, json } = await call(harness, '/api/compact', { body: '{"sessionId":"s1"}' })
    assert.equal(status, 200)
    assert.equal(json.ok, true)
    assert.equal(json.noop, false)
    assert.equal(json.result.shadowedCount, 4)
    assert.equal(json.result.shadowedTokens, 12000)
    assert.equal(json.result.summary, 'command summary')
    assert.equal(json.result.summarySeq, 10)
    assert.equal(executed.length, 1)
    assert.equal(executed[0].line, '/compact')
    assert.deepEqual(executed[0].attachments, [])
  } finally {
    harness.dispose()
  }
})

test('compact reports a command success without a summary event as a no-op', async () => {
  const session = createSession()
  Object.defineProperty(session, 'seq', { get: () => 5 })
  session.ownEvents = () => []
  const commands = {
    find: () => ({ name: 'compact' }),
    async execute() {
      return { commandId: 'c1', result: { kind: 'success', text: 'No compactable history yet.' } }
    },
  }
  const harness = createHarness({
    agents: { get: () => ({ id: 's1', session }) },
    commands,
    measurements: [100000],
  })
  try {
    const { status, json } = await call(harness, '/api/compact', { body: '{"sessionId":"s1"}' })
    assert.equal(status, 200)
    assert.equal(json.ok, true)
    assert.equal(json.noop, true)
  } finally {
    harness.dispose()
  }
})

test('compact maps the built-in /compact failure text to stable codes', async () => {
  const session = createSession()
  Object.defineProperty(session, 'seq', { get: () => 5 })
  session.ownEvents = () => []
  const cases = [
    ['Compaction is unavailable because this process has an active compaction, or the agent is not idle.', 409, 'busy'],
    ['Compaction cancelled.', 499, 'cancelled'],
    ['The history selected for compaction changed before it could be replaced. The attempt is recorded in the session log.', 500, 'changed'],
    ['Compaction could not produce a useful summary. The attempt is recorded in the session log.', 500, 'summary'],
    ['Compaction did not finish cleanly; some session history may have changed. Inspect the current session state before retrying.', 500, 'commit'],
    ['Compaction finished, but the session could not be saved.', 500, 'persistence'],
  ]
  for (const [text, expectedStatus, expectedCode] of cases) {
    const commands = {
      find: () => ({ name: 'compact' }),
      async execute() {
        return { commandId: 'c1', result: { kind: 'error', text } }
      },
    }
    const harness = createHarness({
      agents: { get: () => ({ id: 's1', session }) },
      commands,
      measurements: [100000],
    })
    try {
      const { status, json } = await call(harness, '/api/compact', { body: '{"sessionId":"s1"}' })
      assert.equal(status, expectedStatus, text)
      assert.equal(json.error.code, expectedCode, text)
    } finally {
      harness.dispose()
    }
  }
})

test('compact is unsupported only when neither a service nor the command resolves', async () => {
  const session = createSession()
  Object.defineProperty(session, 'seq', { get: () => 5 })
  session.ownEvents = () => []
  const commands = {
    find: () => undefined,
    async execute() {
      throw new Error('should not run')
    },
  }
  const harness = createHarness({ agents: { get: () => ({ id: 's1', session }) }, commands })
  try {
    const { status, json } = await call(harness, '/api/compact', { body: '{"sessionId":"s1"}' })
    assert.equal(status, 503)
    assert.equal(json.error.code, 'unsupported')
  } finally {
    harness.dispose()
  }
})

test('command failure text classification covers the built-in /compact outcomes', () => {
  assert.equal(__test__.codeFromCompactText('No compactable history yet.'), 'noop')
  assert.equal(__test__.codeFromCompactText('Compaction cancelled.'), 'cancelled')
  assert.equal(__test__.codeFromCompactText('Compaction finished, but the session could not be saved.'), 'persistence')
  assert.equal(__test__.codeFromCompactText('something else'), 'internal')
})

test('compaction summary extraction ignores events at or before the starting seq', () => {
  const session = {
    ownEvents: () => [
      { type: 'compaction/summary', seq: 4, data: { shadowedSeqs: [1], shadowedTokenCount: 1, summary: [{ type: 'text', text: 'old' }] } },
      { type: 'user/message', seq: 5, data: {} },
      { type: 'compaction/summary', seq: 9, data: { shadowedSeqs: [6, 7], shadowedTokenCount: 22, summary: [{ type: 'text', text: 'new' }] } },
    ],
  }
  const event = __test__.lastCompactionSummary(session, 5)
  assert.equal(event.seq, 9)
  const result = __test__.resultFromCompactionSummary(event)
  assert.equal(result.shadowedCount, 2)
  assert.equal(result.shadowedTokens, 22)
  assert.equal(result.summary, 'new')
  assert.equal(result.summarySeq, 9)
})

/* ── Pure helpers ─────────────────────────────────────────────────────────── */

test('summaryText keeps only text blocks, in order', () => {
  assert.equal(__test__.summaryText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\n\nb')
  assert.equal(__test__.summaryText([{ type: 'reasoning', text: 'x' }]), '')
  assert.equal(__test__.summaryText(null), '')
})

test('origin/host matching only accepts loopback peers', () => {
  assert.equal(__test__.originMatchesHost('http://127.0.0.1:57598', '127.0.0.1:57598'), true)
  assert.equal(__test__.originMatchesHost('http://localhost:57598', '127.0.0.1:57598'), false)
  assert.equal(__test__.originMatchesHost('https://evil.example', '127.0.0.1:57598'), false)
  assert.equal(__test__.originMatchesHost('http://127.0.0.1:1', '127.0.0.1:2'), false)
  assert.deepEqual(__test__.parseHostHeader('[::1]:57598'), { hostname: '::1', port: '57598' })
  assert.deepEqual(__test__.parseHostHeader('localhost'), { hostname: 'localhost', port: '' })
})

test('safeEqual compares strings without throwing', () => {
  assert.equal(__test__.safeEqual('abc', 'abc'), true)
  assert.equal(__test__.safeEqual('abc', 'abd'), false)
  assert.equal(__test__.safeEqual('abc', 'abcd'), false)
  assert.equal(__test__.safeEqual(undefined, 'abc'), false)
})
