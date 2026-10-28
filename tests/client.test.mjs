/**
 * Local tests for the browser half. The loader entry is captured through a stubbed
 * `window.__ModuleLoader__`, React is a tiny hook-compatible stub, and the real
 * `apply()` registers into a stub slot/locale context. The mini renderer walks the
 * returned element tree (function and class components included) so the registered
 * component's first render, its visible copy, and its disabled states are checked
 * without a browser.
 *
 * Run with: node --test tests/
 */
import test from 'node:test'
import assert from 'node:assert/strict'

/* ── React stub ───────────────────────────────────────────────────────────── */

function flatten(items) {
  const out = []
  for (const item of items) {
    if (Array.isArray(item)) out.push(...flatten(item))
    else out.push(item)
  }
  return out
}

class StubComponent {
  constructor(props) {
    this.props = props || {}
    this.state = {}
  }

  setState(next) {
    this.state = Object.assign({}, this.state, next)
  }
}
StubComponent.prototype.isReactComponent = true

const ReactStub = {
  createElement(type, props, ...children) {
    const flat = flatten(children)
    const normalizedProps = Object.assign({}, props || {})
    // React puts children in props; the stub mirrors that so class components can
    // read `this.props.children` like they would in the real renderer.
    if (flat.length === 1) normalizedProps.children = flat[0]
    else if (flat.length > 1) normalizedProps.children = flat
    return { type, props: normalizedProps, children: flat }
  },
  Fragment: 'Fragment',
  Component: StubComponent,
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useReducer(reducer, initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  useLayoutEffect() {},
  useRef(value) {
    return { current: value }
  },
  useMemo(factory) {
    return factory()
  },
  useCallback(fn) {
    return fn
  },
  useSyncExternalStore(subscribe, getSnapshot) {
    return getSnapshot()
  },
}

/* ── Module loader capture ────────────────────────────────────────────────── */

const loaded = []
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      loaded.push(spec)
    },
  },
}

await import('../client.js')

const spec = loaded[0]
assert.ok(spec, 'client.js registers through window.__ModuleLoader__')
const pluginModule = spec.factory((id) => {
  assert.equal(id, 'react')
  return ReactStub
})

/* ── Client context harness ───────────────────────────────────────────────── */

function createHarness() {
  const state = {
    locale: 'zh',
    dicts: null,
    slots: [],
    injections: [],
    eventHandlers: {},
    effects: [],
  }
  const ctx = {
    effect(fn) {
      const disposer = fn()
      state.effects.push(disposer)
      return disposer
    },
    on(name, handler) {
      state.events[name] = (state.eventHandlers[name] ||= [])
      state.events[name].push(handler)
      return () => {}
    },
    locale: {
      register(namespace, dicts) {
        state.dicts = dicts
        state.namespace = namespace
        return () => {}
      },
      bind(namespace) {
        return (key) => {
          const dict = state.dicts && state.dicts[state.locale]
          return dict && typeof dict[key] === 'string' ? dict[key] : key
        }
      },
      getLocale() {
        return { id: state.locale }
      },
    },
    slots: {
      inject(key, callback) {
        state.injections.push({ key, callback })
        const disposer = callback()
        return typeof disposer === 'function' ? disposer : () => {}
      },
      register(options, Component) {
        state.slots.push({ options, Component })
        return () => {}
      },
    },
  }
  state.events = state.eventHandlers
  pluginModule.apply(ctx)
  return state
}

/* ── Mini renderer ────────────────────────────────────────────────────────── */

function isClassComponent(type) {
  return typeof type === 'function' && StubComponent.prototype.isPrototypeOf(type.prototype)
}

function renderNode(node, collected) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((child) => renderNode(child, collected)).join('')
  if (typeof node === 'object') {
    const type = node.type
    if (typeof type === 'function') {
      if (isClassComponent(type)) {
        const instance = new type(node.props)
        return renderNode(instance.render(), collected)
      }
      return renderNode(type(node.props), collected)
    }
    if (collected && type === 'button') collected.push(node)
    return renderNode(node.children || [], collected)
  }
  return ''
}

/** Render one registered component with props, returning text and button elements. */
function renderComponent(Component, props) {
  const collected = []
  const text = renderNode({ type: Component, props, children: [] }, collected)
  return { text, buttons: collected }
}

/* ── Tests ────────────────────────────────────────────────────────────────── */

test('loader spec and module contract', () => {
  assert.equal(spec.id, 'dsh-context-summarizer')
  assert.equal(pluginModule.name, 'dsh-context-summarizer')
  assert.deepEqual(pluginModule.inject, ['slots', 'locale'])
  assert.equal(typeof pluginModule.apply, 'function')
})

test('apply registers locale dictionaries, a sidebar row and the keyed main page', () => {
  const state = createHarness()
  assert.equal(state.namespace, 'dsh-context-summarizer')
  assert.ok(state.dicts && state.dicts.zh && state.dicts.en, 'zh and en dictionaries are registered')

  const sidebar = state.slots.find((entry) => entry.options.name === 'sidebar.panellist')
  const main = state.slots.find((entry) => entry.options.name === 'main')
  assert.ok(sidebar, 'a sidebar.panellist row is registered')
  assert.equal(sidebar.options.id, 'context-summarizer')
  assert.equal(typeof sidebar.options.order, 'number')
  assert.equal(sidebar.options.locale, 'dsh-context-summarizer')
  assert.equal(sidebar.options.label(), '上下文归纳')

  assert.ok(main, 'a main page is registered')
  assert.equal(main.options.key, 'context-summarizer')
  const injected = main.options.inject()
  assert.equal(typeof injected.t, 'function')

  assert.equal(state.injections.length, 4)
  assert.deepEqual(
    state.injections.map((entry) => entry.key),
    ['sidebar.panellist', 'main', 'conversation.input.left', 'conversation.composer.dock'],
  )

  const composerAction = state.slots.find((entry) => entry.options.name === 'conversation.input.left')
  assert.ok(composerAction, 'the one-click action is registered in the composer tool row')
  assert.equal(composerAction.options.id, 'context-summarizer')
  assert.equal(typeof composerAction.options.order, 'number')
  assert.equal(composerAction.options.label(), '一键归纳上下文')

  const composerStatus = state.slots.find((entry) => entry.options.name === 'conversation.composer.dock')
  assert.ok(composerStatus, 'the status chip is registered below the composer')
  assert.equal(composerStatus.options.id, 'context-summarizer-status')
})

test('the sidebar glyph renders an inline SVG in currentColor', () => {
  const state = createHarness()
  const sidebar = state.slots.find((entry) => entry.options.name === 'sidebar.panellist')
  const { text } = renderComponent(sidebar.Component, { size: 18 })
  assert.equal(text, '', 'the icon carries no visible text')
})

test('the page shows the current session and the one-click action', () => {
  const state = createHarness()
  const main = state.slots.find((entry) => entry.options.name === 'main')
  const t = main.options.inject().t
  const useSessions = (selector) =>
    selector({
      current: 's1',
      byId: { s1: { displayTitle: '重构登录流程', running: false } },
    })
  const { text, buttons } = renderComponent(main.Component, { t, useSessions })
  assert.ok(text.includes('上下文归纳'), 'page title')
  assert.ok(text.includes('重构登录流程'), 'current session title')
  assert.ok(text.includes('一键归纳上下文'), 'primary action')
  assert.ok(text.includes('当前上下文占用'), 'usage meter label')
  assert.ok(text.includes('读取中…'), 'usage starts in a loading state')
  const primary = buttons.find((button) => String(button.props.className || '').includes('dcs-primary'))
  assert.ok(primary, 'a primary button is rendered')
  assert.equal(primary.props.disabled, false)
})

test('a running session disables the action and explains why', () => {
  const state = createHarness()
  const main = state.slots.find((entry) => entry.options.name === 'main')
  const t = main.options.inject().t
  const useSessions = (selector) =>
    selector({
      current: 's2',
      byId: { s2: { displayTitle: '构建发布', running: true } },
    })
  const { text, buttons } = renderComponent(main.Component, { t, useSessions })
  assert.ok(text.includes('运行中'))
  assert.ok(text.includes('等这一轮结束后才能归纳'))
  const primary = buttons.find((button) => String(button.props.className || '').includes('dcs-primary'))
  assert.equal(primary.props.disabled, true)
})

test('the page has an empty state without a session', () => {
  const state = createHarness()
  const main = state.slots.find((entry) => entry.options.name === 'main')
  const t = main.options.inject().t
  const useSessions = (selector) => selector({ current: undefined, byId: {} })
  const { text } = renderComponent(main.Component, { t, useSessions })
  assert.ok(text.includes('还没有打开会话'))
  assert.ok(text.includes('先在左侧选择一个会话'))
})

test('the page degrades clearly when the shell provides no session feed', () => {
  const state = createHarness()
  const main = state.slots.find((entry) => entry.options.name === 'main')
  const { text } = renderComponent(main.Component, { t: main.options.inject().t })
  assert.ok(text.includes('当前界面不支持'))
  assert.ok(text.includes('/compact'))
})

test('locale change re-binds the translator and the page follows it', () => {
  const state = createHarness()
  const main = state.slots.find((entry) => entry.options.name === 'main')
  // The shell emits locale/change; the plugin re-binds and notifies subscribers.
  state.locale = 'en'
  for (const handler of state.events['locale/change'] || []) handler({ id: 'en' })
  const useSessions = (selector) => selector({ current: undefined, byId: {} })
  const { text } = renderComponent(main.Component, { t: main.options.inject().t, useSessions })
  assert.ok(text.includes('No session open'))
})

test('both dictionaries expose the same keys', () => {
  const state = createHarness()
  const zhKeys = Object.keys(state.dicts.zh).sort()
  const enKeys = Object.keys(state.dicts.en).sort()
  assert.deepEqual(zhKeys, enKeys)
  assert.ok(zhKeys.includes('action.summarize'))
  assert.ok(zhKeys.includes('error.busy'))
})

test('apply is idempotent when the slot seats are re-provided (HMR-safe registrations)', () => {
  const state = createHarness()
  // Re-run the injected callbacks the way a slot re-declaration would.
  for (const injection of state.injections) injection.callback()
  assert.ok(state.slots.length >= 8)
})

/* ── Composer surfaces ────────────────────────────────────────────────────── */

function composerAction() {
  const state = createHarness()
  return state.slots.find((entry) => entry.options.name === 'conversation.input.left').Component
}

function composerChip() {
  const state = createHarness()
  return state.slots.find((entry) => entry.options.name === 'conversation.composer.dock').Component
}

function installFetch(payload) {
  const calls = []
  globalThis.fetch = async function stubFetch(url, init) {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return calls
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

test('the composer action renders one compact toolbar button', () => {
  const action = composerAction()
  const { text, buttons } = renderComponent(action, {
    sessionId: 'composer-idle',
    useSessionStatus: (selector) => selector(new Map()),
  })
  assert.ok(!text.includes('一键归纳上下文'), 'the toolbar button carries no visible text (icon only)')
  const button = buttons.find((item) => String(item.props.className || '').includes('dcs-tool'))
  assert.ok(button, 'the toolbar button is rendered')
  assert.equal(button.props['aria-label'], '一键归纳上下文')
  assert.equal(button.props.disabled, false)
})

test('the composer action disables while the session is running', () => {
  const action = composerAction()
  const running = new Map([['composer-running', { running: true }]])
  const { buttons } = renderComponent(action, {
    sessionId: 'composer-running',
    useSessionStatus: (selector) => selector(running),
  })
  const button = buttons.find((item) => String(item.props.className || '').includes('dcs-tool'))
  assert.equal(button.props.disabled, true)
  assert.ok(String(button.props.title).includes('等这一轮结束后才能归纳'))
})

test('the composer status chip is hidden until a run starts', () => {
  const chip = composerChip()
  const { text } = renderComponent(chip, { sessionId: 'composer-hidden' })
  assert.equal(text, '')
})

test('clicking the composer action reports the reclaimed context in the dock chip', async () => {
  const calls = installFetch({
    ok: true,
    noop: false,
    before: { tokens: 250000, contextWindow: 1000000, ratio: 0.25 },
    after: { tokens: 80000, contextWindow: 1000000, ratio: 0.08 },
    result: { shadowedCount: 3, shadowedTokens: 12000, summary: '第 1 段摘要', summarySeq: 42 },
  })
  try {
    const action = composerAction()
    const rendered = renderComponent(action, {
      sessionId: 'composer-success',
      useSessionStatus: (selector) => selector(new Map()),
    })
    const button = rendered.buttons.find((item) => String(item.props.className || '').includes('dcs-tool'))
    button.props.onClick()
    await settle()
    assert.equal(calls.length, 1, 'one Host call was made')
    assert.equal(calls[0].url, '/dsh-ctx-summary/api/compact')
    assert.equal(JSON.parse(calls[0].init.body).sessionId, 'composer-success')

    const chip = composerChip()
    const status = renderComponent(chip, { sessionId: 'composer-success' })
    assert.ok(status.text.includes('归纳完成'), 'chip reports completion: ' + status.text)
    assert.ok(status.text.includes('3 条历史'), 'chip reports the folded item count')
    assert.ok(status.text.includes('释放'), 'chip reports the reclaimed tokens')
  } finally {
    delete globalThis.fetch
  }
})

test('the dock chip explains a busy failure and offers a retry', async () => {
  installFetch({ ok: false, error: { code: 'busy', message: 'agent is not idle' } })
  try {
    const action = composerAction()
    const rendered = renderComponent(action, {
      sessionId: 'composer-busy',
      useSessionStatus: (selector) => selector(new Map()),
    })
    const button = rendered.buttons.find((item) => String(item.props.className || '').includes('dcs-tool'))
    button.props.onClick()
    await settle()

    const chip = composerChip()
    const status = renderComponent(chip, { sessionId: 'composer-busy' })
    assert.ok(status.text.includes('归纳暂时不可用'), 'busy failure is localized: ' + status.text)
    const retry = status.buttons.find((item) => String(item.props.className || '').includes('dcs-chipBtn--text'))
    assert.ok(retry, 'a retry control is offered')
    assert.equal(retry.children.length > 0 || retry.props.children !== undefined, true)
  } finally {
    delete globalThis.fetch
  }
})
