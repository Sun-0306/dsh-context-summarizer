/**
 * dsh-context-summarizer — Host half of the plugin.
 *
 * Exposes a small, token-gated HTTP surface on the DSH Host web server:
 *
 *   POST /dsh-ctx-summary/api/usage    { sessionId } -> current context measurement
 *   POST /dsh-ctx-summary/api/compact  { sessionId } -> manual compaction result
 *
 * The browser half (client.js) contributes the left-sidebar row and the page; the
 * page calls these routes with the random per-process token injected into the page
 * shell. The actual summarization is the Host's own manual-compaction operation
 * (`ctx.compaction.compactNow`), the same durable operation behind the built-in
 * `/compact` command: it replaces an older span of the session surface with one
 * summary node and records the attempt in the session log.
 *
 * Plain ESM, Node builtins only, no build step. The page reads the token from
 * `window.__DSH_CTX_SUMMARY__`; the row layout/ids below are load-bearing for
 * client.js and tests.
 */
import crypto from 'node:crypto'

export const name = 'dsh-context-summarizer'
/** The HTTP carrier is the only hard dependency; everything else is optional. */
export const inject = ['webServer']

/* ── Fixed identifiers (shared with client.js) ─────────────────────────────── */

const ROUTE_PREFIX = '/dsh-ctx-summary'
const USAGE_PATH = `${ROUTE_PREFIX}/api/usage`
const COMPACT_PATH = `${ROUTE_PREFIX}/api/compact`
const TOKEN_HEADER = 'x-dsh-ctx-summary-token'
const TOKEN_GLOBAL = '__DSH_CTX_SUMMARY__'

/* ── Limits ────────────────────────────────────────────────────────────────── */

const BODY_MAX_BYTES = 16 * 1024
/** Manual compaction is an LLM round trip; allow a slow provider but stay bounded. */
const COMPACT_TIMEOUT_MS = 10 * 60 * 1000

/** Manual-compaction failure codes worth naming in the UI (see dsh-compaction). */
const COMPACTION_ERROR_CODES = new Set([
  'busy',
  'cancelled',
  'changed',
  'summary',
  'commit',
  'persistence',
])

/* ── Small pure helpers ────────────────────────────────────────────────────── */

/** HTTP error that the request handler turns into a stable JSON failure envelope. */
class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code stable error code shown by the page
   * @param {string} message operator-facing detail (the page localizes known codes)
   */
  constructor(status, code, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

function failurePayload(code, message) {
  return { ok: false, error: { code, message: String(message) } }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(body, 'utf8'))
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

/** Case-insensitive header lookup that tolerates plain objects as well as Node's. */
function getHeader(req, headerName) {
  const headers = req && typeof req === 'object' ? req.headers : undefined
  if (!headers || typeof headers !== 'object') return undefined
  const direct = headers[headerName]
  if (direct !== undefined) return Array.isArray(direct) ? direct[0] : String(direct)
  const wanted = headerName.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== wanted) continue
    const value = headers[key]
    if (value === undefined) return undefined
    return Array.isArray(value) ? value[0] : String(value)
  }
  return undefined
}

/** Constant-time-ish string comparison (length differences are compared too). */
function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  if (a.length !== b.length) {
    try {
      crypto.timingSafeEqual(a, Buffer.alloc(a.length))
    } catch {
      /* ignore */
    }
    return false
  }
  try {
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/** Strip IPv6 brackets, a trailing dot, and lowercase a hostname. */
function normalizeHostname(hostname) {
  let value = String(hostname ?? '').trim().toLowerCase()
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1)
  if (value.endsWith('.')) value = value.slice(0, -1)
  return value
}

function isLoopbackHostname(hostname) {
  const value = normalizeHostname(hostname)
  return value === 'localhost' || value === '::1' || value === '127.0.0.1' || value.startsWith('127.')
}

/** Parse a Host header into `{ hostname, port }`, tolerating IPv6 forms. */
function parseHostHeader(hostHeader) {
  if (typeof hostHeader !== 'string') return null
  const raw = hostHeader.trim()
  if (!raw) return null
  if (raw.startsWith('[')) {
    const close = raw.indexOf(']')
    if (close === -1) return null
    const hostname = raw.slice(1, close)
    const rest = raw.slice(close + 1)
    const port = rest.startsWith(':') ? rest.slice(1) : ''
    return { hostname, port }
  }
  const colon = raw.lastIndexOf(':')
  if (colon === -1) return { hostname: raw, port: '' }
  // Bare IPv6 (more than one colon) has no port part.
  if (raw.indexOf(':') !== colon) return { hostname: raw, port: '' }
  return { hostname: raw.slice(0, colon), port: raw.slice(colon + 1) }
}

function parseOrigin(originHeader) {
  try {
    const url = new URL(String(originHeader))
    return { hostname: url.hostname, port: url.port }
  } catch {
    return null
  }
}

/** True when an Origin header matches the browser's own Host header (loopback only). */
function originMatchesHost(originHeader, hostHeader) {
  const origin = parseOrigin(originHeader)
  const host = parseHostHeader(hostHeader)
  if (!origin || !host) return false
  if (!isLoopbackHostname(origin.hostname) || !isLoopbackHostname(host.hostname)) return false
  const defaultPort = '80'
  const originPort = origin.port === '' ? defaultPort : origin.port
  const hostPort = host.port === '' ? defaultPort : host.port
  return origin.hostname === host.hostname && originPort === hostPort
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    if (!req || typeof req.on !== 'function') {
      resolve('')
      return
    }
    const chunks = []
    let size = 0
    let settled = false

    const finish = (error, text) => {
      if (settled) return
      settled = true
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      req.removeListener('error', onError)
      if (!error) {
        resolve(text)
        return
      }
      try {
        req.on('error', () => {})
      } catch {
        /* ignore */
      }
      try {
        req.resume?.()
      } catch {
        /* ignore */
      }
      reject(error)
    }

    const onData = (chunk) => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      size += buffer.length
      if (size > maxBytes) {
        finish(new HttpError(413, 'body-too-large', `request body exceeds ${maxBytes} bytes`))
        return
      }
      chunks.push(buffer)
    }
    const onEnd = () => finish(null, Buffer.concat(chunks).toString('utf8'))
    const onError = (error) =>
      finish(new HttpError(400, 'bad-request', `could not read request body: ${error?.message ?? error}`))

    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

function parseJsonObject(text) {
  const raw = typeof text === 'string' ? text.trim() : ''
  if (raw === '') throw new HttpError(400, 'bad-request', 'request body must be JSON')
  let value
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new HttpError(400, 'bad-request', `request body is not valid JSON: ${error?.message ?? error}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'bad-request', 'request body must be a JSON object')
  }
  return value
}

/** Text blocks of one compaction summary, joined in order. */
function summaryText(blocks) {
  if (!Array.isArray(blocks)) return ''
  const parts = []
  for (const block of blocks) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n\n').trim()
}

/* ── Pure compaction helpers ──────────────────────────────────────────────── */

/** The built-in `/compact` handler reports text only; classify its known failures. */
function codeFromCompactText(text) {
  const value = String(text || '')
  if (/no compactable history/i.test(value)) return 'noop'
  if (/active compaction|not idle/i.test(value)) return 'busy'
  if (/cancel/i.test(value)) return 'cancelled'
  if (/history selected for compaction changed/i.test(value)) return 'changed'
  if (/could not produce a useful summary/i.test(value)) return 'summary'
  if (/did not finish cleanly/i.test(value)) return 'commit'
  if (/could not be saved/i.test(value)) return 'persistence'
  return 'internal'
}

/** One stable HTTP failure for a compaction result code. */
function toHttpError(code, message) {
  switch (code) {
    case 'timeout':
      return new HttpError(
        504,
        'timeout',
        `summarization did not finish within ${Math.round(COMPACT_TIMEOUT_MS / 1000)}s`,
      )
    case 'busy':
      return new HttpError(409, 'busy', message)
    case 'cancelled':
      return new HttpError(499, 'cancelled', message || 'summarization was cancelled')
    case 'unsupported':
      return new HttpError(503, 'unsupported', message)
    case 'changed':
    case 'summary':
    case 'commit':
    case 'persistence':
      return new HttpError(500, code, message)
    default:
      return new HttpError(500, 'internal', message || 'summarization failed')
  }
}

/** Shape one `CompactionResult` into the page's result payload. */
function compactionResultOf(result) {
  const value = result && typeof result === 'object' ? result : {}
  return {
    shadowedCount: Array.isArray(value.shadowedSeqs) ? value.shadowedSeqs.length : null,
    shadowedTokens: Number.isFinite(value.shadowedTokenCount) ? value.shadowedTokenCount : null,
    summary: summaryText(value.summary),
    summarySeq: Number.isFinite(value.summarySeq) ? value.summarySeq : null,
  }
}

/** Latest `compaction/summary` event appended after `fromSeq`, if any. */
function lastCompactionSummary(session, fromSeq) {
  if (!session || typeof session.ownEvents !== 'function') return undefined
  let found
  for (const event of session.ownEvents()) {
    if (!event || typeof event !== 'object') continue
    if (event.type !== 'compaction/summary') continue
    if (typeof event.seq === 'number' && event.seq <= fromSeq) continue
    found = event
  }
  return found
}

/** Shape one durable `compaction/summary` event into the page's result payload. */
function resultFromCompactionSummary(event) {
  const data = event && event.data && typeof event.data === 'object' ? event.data : {}
  return {
    shadowedCount: Array.isArray(data.shadowedSeqs) ? data.shadowedSeqs.length : null,
    shadowedTokens: Number.isFinite(data.shadowedTokenCount) ? data.shadowedTokenCount : null,
    summary: summaryText(data.summary),
    summarySeq: Number.isFinite(event && event.seq) ? event.seq : null,
  }
}


/* ── Host plugin ───────────────────────────────────────────────────────────── */

export function apply(ctx) {
  const token = crypto.randomBytes(24).toString('hex')
  const tokenScript = `<script>window.${TOKEN_GLOBAL}=${JSON.stringify({ token })};</script>`

  /** In-flight manual compactions, keyed by session id, so one click cannot stack. */
  const inflight = new Map()
  /** Controllers of active compactions, aborted when the plugin is disposed. */
  const activeControllers = new Set()
  let disposed = false

  /** Optional host services are read lazily so the plugin survives compositions without them. */
  function service(key) {
    if (typeof ctx.get !== 'function') return undefined
    try {
      return ctx.get(key)
    } catch {
      return undefined
    }
  }

  function requireSessionId(body) {
    const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
    if (!sessionId) throw new HttpError(400, 'bad-request', 'sessionId must be a non-empty string')
    if (sessionId.length > 256) throw new HttpError(400, 'bad-request', 'sessionId is too long')
    return sessionId
  }

  /** Resolve the exact live Agent for one session (the same identity `/compact` uses). */
  function liveAgent(sessionId) {
    const agents = service('agents')
    if (!agents || typeof agents.get !== 'function') {
      throw new HttpError(503, 'unsupported', 'the host agent registry is unavailable')
    }
    const agent = agents.get(sessionId)
    if (!agent) {
      throw new HttpError(404, 'session-not-live', 'this session is not live on the host (open it in the app first)')
    }
    return agent
  }

  /**
   * Measure one live agent's current context.
   * `tokens` is the same request-pressure estimate as the chat composer's ring;
   * `contextWindow` comes from the session's routed request context.
   */
  function readUsage(agent) {
    const session = agent && agent.session
    const meter = service('tokenMeter')
    let tokens = null
    let surfaceTokens = null
    if (meter && typeof meter.measure === 'function' && session) {
      try {
        const measurement = meter.measure(session)
        if (measurement && typeof measurement === 'object') {
          if (Number.isFinite(measurement.totalTokens)) tokens = measurement.totalTokens
          if (Number.isFinite(measurement.surfaceTokens)) surfaceTokens = measurement.surfaceTokens
        }
      } catch {
        /* measurement is best-effort decoration, never a reason to fail an action */
      }
    }
    let contextWindow = null
    let provider = null
    let model = null
    if (session && typeof session.requestContext === 'function') {
      try {
        const requestContext = session.requestContext()
        if (requestContext && typeof requestContext === 'object') {
          if (Number.isFinite(requestContext.contextWindow)) contextWindow = requestContext.contextWindow
          if (typeof requestContext.provider === 'string') provider = requestContext.provider
          if (typeof requestContext.model === 'string') model = requestContext.model
        }
      } catch {
        /* optional session API */
      }
    }
    let ratio = null
    if (Number.isFinite(tokens) && Number.isFinite(contextWindow) && contextWindow > 0) {
      ratio = Math.min(1, tokens / contextWindow)
    }
    return { tokens, surfaceTokens, contextWindow, ratio, provider, model }
  }

  /** Map one thrown compaction error to the page's stable error code. */
  function classifyCompactionError(error, controller, timedOut) {
    // The compaction implementation wraps its whole body in a `busy` error on
    // unexpected rejection, so our own cancellation/timeout must win first:
    // otherwise a timed-out request would be reported as "another compaction is
    // running".
    if (timedOut) return 'timeout'
    if (controller && controller.signal && controller.signal.aborted) return 'cancelled'
    const rawCode = error && typeof error === 'object' ? error.code : undefined
    if (typeof rawCode === 'string' && COMPACTION_ERROR_CODES.has(rawCode)) return rawCode
    const message = String((error && error.message) || error || '')
    if (/active compaction|not idle|busy/i.test(message)) return 'busy'
    if (/abort|cancel/i.test(message)) return 'cancelled'
    return 'internal'
  }

  /**
   * Resolve the preset-scoped compaction service for one live Agent.
   *
   * In current Web/Desktop compositions `dsh-web-app` disables the Host-plane
   * `compaction-basic` / `command-compact` rows on purpose: the compaction
   * backend travels with each Agent preset and is mounted inside an isolated
   * group under the Agent's scope. `agentPresets.serviceFor(agent, name)` is the
   * supported reader for a preset-mounted service; `agent.ctx.get(name)` is the
   * same lookup one layer lower; root-mounted compositions (SDK/headless) still
   * expose it directly on `ctx.get('compaction')`.
   */
  function compactionFor(agent) {
    const presets = service('agentPresets')
    if (presets && typeof presets.serviceFor === 'function') {
      try {
        const scoped = presets.serviceFor(agent, 'compaction')
        if (scoped && typeof scoped.compactNow === 'function') return scoped
      } catch {
        /* not every Agent binds a preset; keep looking */
      }
    }
    const agentCtx = agent && agent.ctx && typeof agent.ctx.get === 'function' ? agent.ctx : undefined
    if (agentCtx !== undefined) {
      try {
        const scoped = agentCtx.get('compaction')
        if (scoped && typeof scoped.compactNow === 'function') return scoped
      } catch {
        /* optional lookup */
      }
    }
    const root = service('compaction')
    if (root && typeof root.compactNow === 'function') return root
    return undefined
  }

  /** The Agent-scoped command registry when the built-in `/compact` resolves. */
  function compactCommandsFor(agent) {
    const commands = service('commands')
    if (!commands || typeof commands.execute !== 'function' || typeof commands.find !== 'function') {
      return undefined
    }
    try {
      if (commands.find(agent, 'compact') === undefined) return undefined
    } catch {
      return undefined
    }
    return commands
  }

  /**
   * Execute the shipped per-Agent `/compact` command. It owns the same
   * preset-scoped compaction backend, logs the human command lifecycle (which is
   * what gives the conversation its "manual compaction" row), and reports its
   * outcome as text; the structured result comes from the durable
   * `compaction/summary` event it appended.
   */
  async function runCompactCommand(agent, commands, signal) {
    const session = agent && agent.session
    const fromSeq = session && typeof session.seq === 'number' ? session.seq : 0
    const execution = await commands.execute(agent, '/compact', [], signal)
    if (execution === undefined) {
      throw new HttpError(503, 'unsupported', 'manual compaction is not available in this host composition')
    }
    const outcome = execution.result && typeof execution.result === 'object' ? execution.result : {}
    if (outcome.kind === 'error') {
      const text = String(outcome.text || 'manual compaction failed')
      throw toHttpError(codeFromCompactText(text), text)
    }
    const summaryEvent = lastCompactionSummary(session, fromSeq)
    if (summaryEvent === undefined) return { noop: true }
    return { noop: false, result: resultFromCompactionSummary(summaryEvent) }
  }

  /**
   * Run the one manual-compaction operation for one live Agent.
   *
   * Preference order: the shipped `/compact` command (best conversation
   * presentation and lifecycle logging), then the preset-scoped compaction
   * service, then the Agent-scoped context, then a root-mounted service. The
   * service paths exist for compositions that disable the command while keeping
   * the backend.
   */
  async function runManualCompaction(agent, signal) {
    const commands = compactCommandsFor(agent)
    if (commands !== undefined) return runCompactCommand(agent, commands, signal)
    const compaction = compactionFor(agent)
    if (compaction === undefined) {
      throw new HttpError(503, 'unsupported', 'manual compaction is not available in this host composition')
    }
    const result = await compaction.compactNow(agent, signal)
    if (result === null) return { noop: true }
    return { noop: false, result: compactionResultOf(result) }
  }

  async function readUsageFor(body) {
    const sessionId = requireSessionId(body)
    const agent = liveAgent(sessionId)
    return { ok: true, sessionId, usage: readUsage(agent) }
  }

  async function compactFor(body) {
    const sessionId = requireSessionId(body)
    if (inflight.has(sessionId)) {
      throw new HttpError(409, 'busy', 'this session already has a summarization running')
    }
    const agent = liveAgent(sessionId)
    const before = readUsage(agent)

    const controller = new AbortController()
    activeControllers.add(controller)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('summarization timed out'))
    }, COMPACT_TIMEOUT_MS)
    if (typeof timer.unref === 'function') timer.unref()

    const operation = (async () => {
      try {
        const invoked = await runManualCompaction(agent, controller.signal)
        const after = readUsage(agent)
        return {
          ok: true,
          sessionId,
          noop: invoked.noop === true,
          before,
          after,
          ...(invoked.result !== undefined ? { result: invoked.result } : {}),
        }
      } catch (error) {
        if (error instanceof HttpError) throw error
        const code = classifyCompactionError(error, controller, timedOut)
        throw toHttpError(code, String((error && error.message) || error || 'compaction failed'))
      } finally {
        clearTimeout(timer)
        activeControllers.delete(controller)
        inflight.delete(sessionId)
      }
    })()

    inflight.set(sessionId, operation)
    return operation
  }

  /** Reject requests that did not come from the app's own page. */
  function authorize(req) {
    const supplied = getHeader(req, TOKEN_HEADER)
    if (!safeEqual(supplied, token)) {
      throw new HttpError(401, 'unauthorized', 'missing or invalid host token — reload the page')
    }
    const origin = getHeader(req, 'origin')
    if (origin !== undefined && origin !== '') {
      let expectedOrigin = null
      try {
        expectedOrigin = ctx.webServer.getOrigin()
      } catch {
        expectedOrigin = null
      }
      const matchesConfigured =
        typeof expectedOrigin === 'string' && expectedOrigin !== '' && origin === expectedOrigin
      if (!matchesConfigured && !originMatchesHost(origin, getHeader(req, 'host'))) {
        throw new HttpError(403, 'forbidden', 'request origin is not allowed')
      }
    }
    const site = getHeader(req, 'sec-fetch-site')
    if (typeof site === 'string' && site.toLowerCase() === 'cross-site') {
      throw new HttpError(403, 'forbidden', 'cross-site requests are not allowed')
    }
  }

  async function dispatch(req, res) {
    authorize(req)
    const url = new URL((req && req.url) || '/', 'http://local')
    const pathname = url.pathname
    if (pathname !== USAGE_PATH && pathname !== COMPACT_PATH) {
      throw new HttpError(404, 'not-found', 'unknown endpoint')
    }
    const method = String((req && req.method) || 'GET').toUpperCase()
    if (method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'use POST')
    const body = parseJsonObject(await readBody(req, BODY_MAX_BYTES))
    if (pathname === USAGE_PATH) return readUsageFor(body)
    return compactFor(body)
  }

  async function handler(req, res) {
    try {
      const payload = await dispatch(req, res)
      if (payload && !res.writableEnded) sendJson(res, 200, payload)
    } catch (error) {
      const isHttp = error instanceof HttpError
      const status = isHttp ? error.status : 500
      const code = isHttp ? error.code : 'internal'
      const message = isHttp ? error.message : String((error && error.message) || error || 'internal error')
      try {
        if (!res.writableEnded && !res.headersSent) sendJson(res, status, failurePayload(code, message))
        else if (typeof res.end === 'function') res.end()
      } catch {
        /* the response stream is already gone */
      }
    }
  }

  function disposePlugin() {
    if (disposed) return
    disposed = true
    for (const controller of activeControllers) {
      try {
        controller.abort(new Error('plugin disposed'))
      } catch {
        /* ignore */
      }
    }
    activeControllers.clear()
    inflight.clear()
  }

  // 1. Cleanup first, so it is disposed last.
  ctx.effect(() => disposePlugin)
  // 2. Token injection into the page shell.
  ctx.effect(() =>
    ctx.webServer.tapIndex((html) => {
      const page = typeof html === 'string' ? html : String(html ?? '')
      const match = /<\/head>/i.exec(page)
      if (!match) return tokenScript + page
      return page.slice(0, match.index) + tokenScript + page.slice(match.index)
    }),
  )
  // 3. The API prefix route.
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }))

}

/** Exported for local tests; the runtime only uses the module-level exports above. */
export const __test__ = {
  ROUTE_PREFIX,
  USAGE_PATH,
  COMPACT_PATH,
  TOKEN_HEADER,
  TOKEN_GLOBAL,
  summaryText,
  safeEqual,
  originMatchesHost,
  parseHostHeader,
  codeFromCompactText,
  resultFromCompactionSummary,
  lastCompactionSummary,
  toHttpError,
}
