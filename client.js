/**
 * dsh-context-summarizer — browser half (single classic-JS module for the DSH Web loader).
 *
 * Contributes two surfaces:
 *   · one row in the left sidebar's global panel list (`sidebar.panellist`);
 *   · the "Context Summarizer" page it selects (`main`, keyed by this package's id).
 *
 * The page shows the current Session's context occupancy and offers one primary
 * action — "summarize context now" — which asks the Host half to run the Host's
 * own manual compaction (`ctx.compaction.compactNow`, the durable operation
 * behind `/compact`), then reports what was reclaimed and shows the summary.
 *
 * No build step: no TypeScript, no JSX, no module statements. React comes from the
 * browser module table. Colours are theme tokens only; visible text goes through
 * the Client locale service.
 */
window.__ModuleLoader__.load({
  id: 'dsh-context-summarizer',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // ── Fixed identifiers (shared with index.js) ──────────────────────────
    const CLIENT_VERSION = '0.2.0'
    const NS = 'dsh-context-summarizer'
    const PANEL_ID = 'context-summarizer'
    /** Directly below dsh-context's Insights row (20) and above Code Runner (30). */
    const PANEL_ORDER = 25
    const ROUTE = '/dsh-ctx-summary'
    const COMPACT_PATH = ROUTE + '/api/compact'
    const USAGE_PATH = ROUTE + '/api/usage'
    const TOKEN_HEADER = 'x-dsh-ctx-summary-token'
    const TOKEN_GLOBAL = '__DSH_CTX_SUMMARY__'
    const CONVERSATION_PANEL_ID = 'conversation'

    // ── Locale dictionaries ───────────────────────────────────────────────
    const zh = {
      'nav.label': '上下文归纳',
      'page.title': '上下文归纳',
      'page.subtitle': '把过长的对话归纳成一段摘要，释放上下文窗口，然后继续聊。',
      'session.current': '当前会话',
      'session.untitled': '未命名会话',
      'session.running': '运行中',
      'usage.label': '当前上下文占用',
      'usage.loading': '读取中…',
      'usage.unknown': '暂时读不到占用',
      'usage.ratio': '已用',
      'action.summarize': '一键归纳上下文',
      'action.summarizing': '正在归纳…',
      'action.retry': '再试一次',
      'action.backToChat': '回到对话',
      'action.summarizeAgain': '再归纳一次',
      'composer.tooltip': '一键归纳上下文',
      'composer.running': '正在归纳上下文…',
      'composer.itemsShort': '条历史',
      'composer.reclaimed': '释放',
      'action.retryShort': '重试',
      'action.dismiss': '关闭',
      'hint.summarize': '只会压缩较早的历史，最近的消息原样保留；摘要会写进会话记录，之后还能接着聊。',
      'hint.running': '这个会话正在运行，等这一轮结束后才能归纳。',
      'hint.busy': '已经有一个归纳在进行，稍等片刻再试。',
      'progress.title': '正在归纳较早的对话…',
      'progress.body': '归纳由当前模型完成，通常需要十几秒。完成后这里会显示摘要和释放的上下文。',
      'result.done': '归纳完成',
      'result.items': '归纳条目',
      'result.released': '释放的 tokens',
      'result.usageAfter': '归纳后占用',
      'result.summary': '摘要',
      'result.summaryEmpty': '这次没有可显示的摘要文本。',
      'result.beforeAfter': '上下文占用',
      'noop.title': '暂时不需要归纳',
      'noop.body': '这段对话还没有足够长的历史可以压缩，接着聊就好。',
      'error.title': '没有完成归纳',
      'error.offline': '连不上主机，请检查服务是否在运行，然后刷新页面。',
      'error.unauthorized': '页面令牌已失效，请刷新页面后再试。',
      'error.forbidden': '这次请求被主机拒绝了，请刷新页面后再试。',
      'error.badResponse': '主机返回了无法识别的内容，请刷新页面后再试。',
      'error.routeMissing': '插件的主机部分没有加载，归纳暂时用不了。重启应用，或在「插件」里重新启用本插件后再试。',
      'error.notLive': '这个会话在主机上不活跃，先在左侧打开它，再回来归纳。',
      'error.noSession': '还没有打开会话。先在左侧选择一个会话。',
      'error.unsupported': '当前环境不支持手动归纳。',
      'error.busy': '归纳暂时不可用：有别的归纳正在进行，或者这一轮对话还没结束。',
      'error.cancelled': '归纳被取消了，可以再试一次。',
      'error.changed': '归纳过程中历史发生了变动，这次没有替换。再试一次通常就能成功。',
      'error.summary': '没能生成可用的摘要，这次没有替换历史。再试一次通常就能成功。',
      'error.commit': '归纳没有干净完成，部分历史可能已变化。请先看一眼当前会话，再决定是否重试。',
      'error.persistence': '归纳完成了，但会话没能保存。刷新页面确认结果后再重试。',
      'error.timeout': '归纳超时了，请稍后再试。',
      'error.internal': '归纳时出了点问题，请再试一次。',
      'error.hintRetry': '等这一轮对话结束后再试，通常就能成功。',
      'error.hintNoRetry': '刷新页面后再试；仍然失败，可以改用对话输入框里的 /compact。',
      'unsupported.title': '当前界面不支持',
      'unsupported.body': '这个 Harness 版本没有提供会话选择接口。你仍然可以在对话输入框里发送 /compact 来归纳上下文。',
      'empty.title': '还没有打开会话',
      'empty.body': '先在左侧选择一个会话，再回到「上下文归纳」一键释放它的上下文。',
      'steps.title': '它做了什么',
      'steps.one': '较早的对话被归纳成一段摘要',
      'steps.two': '最近的消息原样保留',
      'steps.three': '摘要写进会话记录，之后可以接着聊',
      'steps.note': '归纳结果保存在你本机的会话日志里。',
    }
    const en = {
      'nav.label': 'Context Summarizer',
      'page.title': 'Context Summarizer',
      'page.subtitle': 'Fold an over-long conversation into one summary, reclaim context window, and keep chatting.',
      'session.current': 'Current session',
      'session.untitled': 'Untitled session',
      'session.running': 'Running',
      'usage.label': 'Context window usage',
      'usage.loading': 'Reading…',
      'usage.unknown': 'Usage unavailable',
      'usage.ratio': 'used',
      'action.summarize': 'Summarize context now',
      'action.summarizing': 'Summarizing…',
      'action.retry': 'Try again',
      'action.backToChat': 'Back to chat',
      'action.summarizeAgain': 'Summarize again',
      'composer.tooltip': 'Summarize context',
      'composer.running': 'Summarizing context…',
      'composer.itemsShort': 'items',
      'composer.reclaimed': 'reclaimed',
      'action.retryShort': 'Retry',
      'action.dismiss': 'Dismiss',
      'hint.summarize': 'Only older history is compressed; recent messages stay as they are. The summary is written into the session log, so you can keep chatting.',
      'hint.running': 'This session is running. Summarize after the current turn finishes.',
      'hint.busy': 'Another summary is already running. Try again in a moment.',
      'progress.title': 'Folding older conversation into a summary…',
      'progress.body': 'The current model writes the summary; it usually takes a few seconds. The result and the reclaimed context will appear here.',
      'result.done': 'Summary ready',
      'result.items': 'history items folded',
      'result.released': 'tokens reclaimed',
      'result.usageAfter': 'usage after',
      'result.summary': 'Summary',
      'result.summaryEmpty': 'No summary text to show this time.',
      'result.beforeAfter': 'Context usage',
      'noop.title': 'Nothing to summarize yet',
      'noop.body': 'This conversation does not have enough older history to compress yet. Just keep chatting.',
      'error.title': 'Summarization did not finish',
      'error.offline': 'Cannot reach the host. Check that it is running, then reload the page.',
      'error.unauthorized': 'The page token is no longer valid. Reload the page and try again.',
      'error.forbidden': 'The host refused this request. Reload the page and try again.',
      'error.badResponse': 'The host returned an unrecognized response. Reload the page and try again.',
      'error.routeMissing': "This plugin's host half is not loaded, so summarization is unavailable. Restart the app or re-enable the plugin, then try again.",
      'error.notLive': 'This session is not live on the host. Open it in the sidebar, then come back.',
      'error.noSession': 'No session is open. Pick one in the sidebar first.',
      'error.unsupported': 'Manual summarization is not available in this host composition.',
      'error.busy': 'Summarization is unavailable: another summary is running, or the current turn is still active.',
      'error.cancelled': 'Summarization was cancelled. You can try again.',
      'error.changed': 'History changed while summarizing, so nothing was replaced. Trying again usually works.',
      'error.summary': 'No usable summary was produced, so nothing was replaced. Trying again usually works.',
      'error.commit': 'Summarization did not finish cleanly and some history may have changed. Check the current session before retrying.',
      'error.persistence': 'Summarization finished, but the session could not be saved. Reload to confirm the result, then retry.',
      'error.timeout': 'Summarization timed out. Try again later.',
      'error.internal': 'Something went wrong while summarizing. Please try again.',
      'error.hintRetry': 'Trying again after the current turn finishes usually works.',
      'error.hintNoRetry': 'Reload the page and try again; if it keeps failing, use /compact in the composer.',
      'unsupported.title': 'Not supported here',
      'unsupported.body': 'This Harness version does not expose session selection to plugins. You can still send /compact in the composer to summarize the context.',
      'empty.title': 'No session open',
      'empty.body': 'Pick a session in the sidebar, then come back to summarize its context in one click.',
      'steps.title': 'What it does',
      'steps.one': 'Older conversation is folded into one summary',
      'steps.two': 'Recent messages stay as they are',
      'steps.three': 'The summary joins the session log; keep chatting',
      'steps.note': 'Summaries stay in your local session log.',
    }

    // ── Module-scope service references (set in apply) ────────────────────
    let rootCtx = null
    let boundTranslate = null
    const localeListeners = new Set()

    function translate(key) {
      try {
        if (typeof boundTranslate === 'function') return boundTranslate(key)
      } catch (error) {
        /* a broken translation must never blank the page */
      }
      return key
    }

    /** Re-render on a locale change; visible text must follow the host language. */
    function useLocaleRefresh() {
      const pair = React.useReducer(function bump(count) {
        return count + 1
      }, 0)
      const force = pair[1]
      React.useEffect(function subscribeLocale() {
        localeListeners.add(force)
        return function unsubscribeLocale() {
          localeListeners.delete(force)
        }
      }, [])
    }

    // ── Host bridge ───────────────────────────────────────────────────────
    function readToken() {
      try {
        const holder = typeof window !== 'undefined' ? window[TOKEN_GLOBAL] : null
        if (holder && typeof holder.token === 'string' && holder.token.length > 0) return holder.token
      } catch (error) {
        /* ignore */
      }
      return null
    }

    /**
     * One Host call. Always resolves to the JSON envelope: `{ ok: true, ... }` or
     * `{ ok: false, error: { code, message } }`. Transport failures become codes
     * the page already knows how to explain.
     */
    async function callApi(pathname, body) {
      const token = readToken()
      const headers = { 'content-type': 'application/json' }
      if (token) headers[TOKEN_HEADER] = token
      let response
      try {
        response = await fetch(ROUTE + pathname, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(body),
          credentials: 'same-origin',
          cache: 'no-store',
        })
      } catch (error) {
        return { ok: false, error: { code: 'offline', message: String((error && error.message) || error) } }
      }
      let payload = null
      try {
        payload = await response.json()
      } catch (error) {
        payload = null
      }
      if (!payload || typeof payload !== 'object') {
        // A non-JSON answer means the request did not reach this plugin's Host
        // half: the shell's own SPA/auth fallback answered instead.
        const status = response.status
        const code =
          status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'route-missing' : 'bad-response'
        return {
          ok: false,
          error: { code: code, message: 'unexpected response (HTTP ' + status + ')' },
        }
      }
      if (payload.ok === true) return payload
      const raw = payload.error && typeof payload.error === 'object' ? payload.error : {}
      return {
        ok: false,
        error: {
          code: typeof raw.code === 'string' && raw.code !== '' ? raw.code : 'internal',
          message: typeof raw.message === 'string' && raw.message !== '' ? raw.message : 'unknown error',
        },
      }
    }

    /** Navigate back to the conversation main panel, when the shell exposes layout. */
    function backToConversation() {
      try {
        const layout = rootCtx && typeof rootCtx.get === 'function' ? rootCtx.get('layout') : null
        if (layout && typeof layout.selectPanel === 'function') {
          layout.selectPanel(CONVERSATION_PANEL_ID)
          return true
        }
      } catch (error) {
        /* the shell may not expose layout; the sidebar still has the chat row */
      }
      return false
    }

    // ── Per-session one-click state, shared by the composer surfaces ──────
    /**
     * The composer action and its status chip are two separately mounted slot
     * entries; one store per session keeps them on the same run. Snapshots are
     * frozen objects so `useSyncExternalStore` can compare references.
     */
    const runStores = new Map()
    const IDLE_RUN_STATE = Object.freeze({ phase: 'idle', outcome: null, failure: null })
    const IDLE_SUBSCRIBE = () => () => {}
    const idleSnapshot = () => IDLE_RUN_STATE

    function runStore(sessionId) {
      let store = runStores.get(sessionId)
      if (store !== undefined) return store
      let state = IDLE_RUN_STATE
      const listeners = new Set()
      let timer = null
      const notify = () => {
        for (const listener of Array.from(listeners)) {
          try {
            listener()
          } catch (error) {
            /* one subscriber must not block the other */
          }
        }
      }
      const update = (next) => {
        state = Object.freeze(Object.assign({}, state, next))
        notify()
      }
      const clearTimer = () => {
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
      }
      store = {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        dismiss() {
          clearTimer()
          update({ phase: 'idle', outcome: null, failure: null })
        },
        scheduleIdle(delay) {
          clearTimer()
          timer = setTimeout(() => {
            timer = null
            if (state.phase === 'done' || state.phase === 'noop') {
              update({ phase: 'idle', outcome: null, failure: null })
            }
          }, delay)
          if (timer && typeof timer.unref === 'function') timer.unref()
        },
        /** Fire the Host operation for this session; repeated clicks no-op while running. */
        async start() {
          if (state.phase === 'running') return
          clearTimer()
          update({ phase: 'running', outcome: null, failure: null })
          const payload = await callApi('/api/compact', { sessionId: sessionId })
          if (!payload || payload.ok !== true) {
            update({
              phase: 'error',
              outcome: null,
              failure: (payload && payload.error) || { code: 'internal', message: 'unknown error' },
            })
            return
          }
          update({
            phase: payload.noop === true ? 'noop' : 'done',
            outcome: payload,
            failure: null,
          })
          store.scheduleIdle(payload.noop === true ? 9000 : 14000)
        },
      }
      runStores.set(sessionId, store)
      return store
    }

    /** Subscribe one composer surface to its session's run state. */
    function useRunState(sessionId) {
      const store = React.useMemo(
        () => (typeof sessionId === 'string' && sessionId !== '' ? runStore(sessionId) : null),
        [sessionId],
      )
      return React.useSyncExternalStore(
        store !== null ? store.subscribe : IDLE_SUBSCRIBE,
        store !== null ? store.getSnapshot : idleSnapshot,
        idleSnapshot,
      )
    }

    /** The framework's running flag for one session, when that hook is supplied. */
    function SessionRunningReader(props) {
      const running = props.useSessionStatus(function selectRunning(snapshot) {
        if (!snapshot || typeof snapshot.get !== 'function') return false
        const row = snapshot.get(props.sessionId)
        return Boolean(row && row.running === true)
      })
      return h(props.children, Object.assign({}, props, { sessionRunning: Boolean(running) }))
    }

    function CloseGlyph() {
      return h(
        'svg',
        {
          viewBox: '0 0 12 12',
          width: 10,
          height: 10,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        [h('path', { key: 'a', d: 'M3 3l6 6' }), h('path', { key: 'b', d: 'M9 3 3 9' })],
      )
    }

    // ── Formatting helpers ────────────────────────────────────────────────
    function formatTokens(value) {
      if (typeof value !== 'number' || !isFinite(value) || value < 0) return '—'
      const rounded = Math.round(value)
      if (rounded < 1000) return String(rounded)
      if (rounded < 1000000) {
        const thousands = rounded / 1000
        return (thousands >= 100 ? Math.round(thousands) : Math.round(thousands * 10) / 10) + 'k'
      }
      const millions = rounded / 1000000
      return (millions >= 100 ? Math.round(millions) : Math.round(millions * 10) / 10) + 'M'
    }

    function formatCount(value) {
      if (typeof value !== 'number' || !isFinite(value) || value < 0) return '—'
      return String(Math.round(value))
    }

    function formatPercent(ratio) {
      if (typeof ratio !== 'number' || !isFinite(ratio)) return null
      const percent = Math.round(ratio * 1000) / 10
      return String(percent)
    }

    /** Stable error code → dictionary key. Unknown codes fall back to the host text. */
    const ERROR_MESSAGES = {
      offline: 'error.offline',
      unauthorized: 'error.unauthorized',
      forbidden: 'error.forbidden',
      'bad-response': 'error.badResponse',
      'route-missing': 'error.routeMissing',
      'bad-request': 'error.badResponse',
      'not-found': 'error.badResponse',
      'method-not-allowed': 'error.badResponse',
      'body-too-large': 'error.badResponse',
      'session-not-live': 'error.notLive',
      'no-session': 'error.noSession',
      unsupported: 'error.unsupported',
      busy: 'error.busy',
      cancelled: 'error.cancelled',
      changed: 'error.changed',
      summary: 'error.summary',
      commit: 'error.commit',
      persistence: 'error.persistence',
      timeout: 'error.timeout',
      internal: 'error.internal',
    }
    const RETRYABLE = new Set(['busy', 'cancelled', 'changed', 'summary', 'commit', 'persistence', 'timeout', 'internal'])
    const NO_RETRY_HINT = new Set([
      'offline',
      'unauthorized',
      'forbidden',
      'bad-response',
      'route-missing',
      'unsupported',
    ])

    function errorMessage(code, fallback) {
      const key = ERROR_MESSAGES[code]
      if (key) return translate(key)
      if (typeof fallback === 'string' && fallback !== '') return fallback
      return translate('error.internal')
    }

    function errorHint(code) {
      if (NO_RETRY_HINT.has(code)) return translate('error.hintNoRetry')
      return translate('error.hintRetry')
    }

    // ── Glyphs (currentColor only) ────────────────────────────────────────
    function Glyph(ownerProps) {
      const props = ownerProps || {}
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 16
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        [
          h('path', { key: 'line1', d: 'M3 4h10' }),
          h('path', { key: 'line2', d: 'M3 7.25h10' }),
          h('path', { key: 'line3', d: 'M3 10.5h6.5' }),
          h('path', { key: 'arrow', d: 'M9.25 12.65 11.15 14.5l1.9-1.85' }),
        ],
      )
    }

    // ── Styles ────────────────────────────────────────────────────────────
    const PAGE_CSS = [
      '.dcs-page{box-sizing:border-box;min-height:100%;height:100%;overflow-y:auto;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) 24px 56px;color:var(--dsw-alias-label-primary);font-family:inherit;}',
      '.dcs-inner{box-sizing:border-box;width:100%;max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:20px;}',
      // header
      '.dcs-header{display:flex;align-items:flex-start;gap:14px;}',
      '.dcs-mark{flex:0 0 auto;box-sizing:border-box;width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-brand-primary);}',
      '.dcs-headText{min-width:0;display:flex;flex-direction:column;gap:4px;}',
      '.dcs-title{margin:0;font-size:22px;line-height:30px;font-weight:600;letter-spacing:-0.01em;}',
      '.dcs-subtitle{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);}',
      // cards
      '.dcs-card{box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:16px;}',
      '.dcs-cardTitle{margin:0;font-size:15px;line-height:22px;font-weight:600;}',
      '.dcs-eyebrow{font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary);}',
      // session row
      '.dcs-sessionRow{display:flex;align-items:center;justify-content:space-between;gap:12px;}',
      '.dcs-sessionInfo{min-width:0;display:flex;flex-direction:column;gap:3px;}',
      '.dcs-sessionTitle{font-size:15px;line-height:22px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.dcs-pill{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-state-warn-primary);}',
      '.dcs-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;}',
      // usage meter
      '.dcs-meterBlock{display:flex;flex-direction:column;gap:8px;}',
      '.dcs-meterHead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;}',
      '.dcs-meterValue{font-size:13px;line-height:20px;font-weight:600;font-variant-numeric:tabular-nums;}',
      '.dcs-meterSub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);}',
      '.dcs-meterTrack{position:relative;height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;}',
      '.dcs-meterFill{position:absolute;inset:0 auto 0 0;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width 320ms ease;}',
      '.dcs-meterFill[data-level="high"]{background:var(--dsw-alias-state-warn-primary);}',
      '.dcs-meterFill[data-level="critical"]{background:var(--dsw-alias-state-error-primary);}',
      // actions
      '.dcs-actions{display:flex;flex-direction:column;gap:10px;}',
      '.dcs-actionsRow{display:flex;flex-wrap:wrap;align-items:center;gap:10px;}',
      '.dcs-primary{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 20px;border:0;border-radius:10px;background:var(--dsw-alias-brand-primary);color:#fff;font:inherit;font-size:14px;line-height:20px;font-weight:600;cursor:pointer;transition:filter 160ms ease,opacity 160ms ease;}',
      '.dcs-primary:hover:not(:disabled){filter:brightness(1.06);}',
      '.dcs-primary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}',
      '.dcs-primary:disabled{opacity:0.55;cursor:default;}',
      '.dcs-ghost{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 18px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:20px;font-weight:500;cursor:pointer;}',
      '.dcs-ghost:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);}',
      '.dcs-ghost:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}',
      '.dcs-ghost:disabled{opacity:0.55;cursor:default;}',
      '.dcs-hint{margin:0;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary);max-width:62ch;}',
      // progress
      '.dcs-progress{display:flex;flex-direction:column;gap:6px;}',
      '.dcs-progressHead{display:flex;align-items:center;gap:8px;font-size:13px;line-height:20px;font-weight:600;}',
      '.dcs-spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,0.45);border-top-color:#fff;border-radius:50%;animation:dcs-spin 800ms linear infinite;}',
      '.dcs-spinner--ink{width:14px;height:14px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:dcs-spin 800ms linear infinite;}',
      '@keyframes dcs-spin{to{transform:rotate(360deg);}}',
      // result
      '.dcs-result{scroll-margin-top:24px;}',
      '.dcs-result:focus{outline:none;}',
      '.dcs-resultHead{display:flex;align-items:center;gap:8px;}',
      '.dcs-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-success-primary);}',
      '.dcs-dot--error{background:var(--dsw-alias-state-error-primary);}',
      '.dcs-dot--muted{background:var(--dsw-alias-state-idle-primary);}',
      '.dcs-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;}',
      '.dcs-stat{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);}',
      '.dcs-statValue{font-size:20px;line-height:28px;font-weight:600;font-variant-numeric:tabular-nums;}',
      '.dcs-statLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);}',
      '.dcs-summaryWrap{display:flex;flex-direction:column;gap:6px;}',
      '.dcs-summary{box-sizing:border-box;max-height:240px;overflow:auto;padding:12px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-size:13px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere;}',
      // error
      '.dcs-error{border-color:var(--dsw-alias-state-error-primary);}',
      '.dcs-errorTitle{margin:0;font-size:15px;line-height:22px;font-weight:600;color:var(--dsw-alias-state-error-primary);}',
      '.dcs-errorBody{margin:0;font-size:13px;line-height:20px;}',
      // empty / unsupported
      '.dcs-center{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:48px 24px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;}',
      '.dcs-centerIcon{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);}',
      '.dcs-centerTitle{margin:0;font-size:16px;line-height:24px;font-weight:600;}',
      '.dcs-centerBody{margin:0;max-width:46ch;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);}',
      // steps
      '.dcs-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px 16px;}',
      '.dcs-step{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);}',
      '.dcs-stepNum{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;font-weight:600;}',
      '.dcs-stepsNote{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);}',
      // responsive + motion
      '@media (max-width:720px){.dcs-page{padding:calc(20px + var(--dsh-frame-top-clearance,0px)) 16px 40px;}.dcs-title{font-size:19px;line-height:26px;}.dcs-card{padding:16px;}.dcs-primary,.dcs-ghost{width:100%;}}',
      '@media (prefers-reduced-motion:reduce){.dcs-spinner,.dcs-spinner--ink{animation:none;}.dcs-meterFill{transition:none;}}',
    ].join('')

    /** Styles for the two composer surfaces (toolbar action + ambient chip). */
    const COMPOSER_CSS = [
      '.dcs-tool{corner-shape:round;box-sizing:border-box;width:28px;height:28px;flex:none;display:grid;place-items:center;padding:0;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background-color 120ms ease,color 120ms ease;}',
      '.dcs-tool:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.dcs-tool:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}',
      '.dcs-tool:disabled{opacity:0.45;cursor:default;}',
      '.dcs-tool[data-busy="true"]{color:var(--dsw-alias-brand-primary);}',
      '.dcs-toolSpinner{width:14px;height:14px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:dcs-spin 800ms linear infinite;}',
      '@keyframes dcs-spin{to{transform:rotate(360deg);}}',
      '.dcs-chip{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:min(60vw,520px);min-height:24px;padding:2px 4px 2px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;}',
      '.dcs-chip[data-tone="success"]{color:var(--dsw-alias-state-success-primary);}',
      '.dcs-chip[data-tone="error"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);}',
      '.dcs-chipDot{flex:none;width:6px;height:6px;border-radius:50%;background:currentColor;}',
      '.dcs-chipSpinner{flex:none;width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:dcs-spin 800ms linear infinite;}',
      '.dcs-chipText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dcs-chipBtn{flex:none;display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 4px;border:0;border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:18px;cursor:pointer;}',
      '.dcs-chipBtn:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.dcs-chipBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
      '.dcs-chipBtn--text{font-weight:500;}',
      '@media (max-width:720px){.dcs-chip{max-width:72vw;}}',
      '@media (prefers-reduced-motion:reduce){.dcs-toolSpinner,.dcs-chipSpinner{animation:none;}.dcs-tool{transition:none;}}',
    ].join('')

    // ── Presentational pieces ─────────────────────────────────────────────
    function UsageMeter(props) {
      const usage = props.usage
      const phase = props.phase
      const tokens = usage && typeof usage.tokens === 'number' ? usage.tokens : null
      const contextWindow = usage && typeof usage.contextWindow === 'number' ? usage.contextWindow : null
      const ratio = usage && typeof usage.ratio === 'number' ? usage.ratio : null
      const percent = formatPercent(ratio)
      const level = percent === null ? 'normal' : Number(percent) >= 95 ? 'critical' : Number(percent) >= 80 ? 'high' : 'normal'
      let valueText
      if (phase === 'loading' || phase === 'idle') valueText = translate('usage.loading')
      else if (tokens === null) valueText = translate('usage.unknown')
      else if (contextWindow !== null) valueText = '≈' + formatTokens(tokens) + ' / ' + formatTokens(contextWindow)
      else valueText = '≈' + formatTokens(tokens)
      const barWidth = percent === null ? 0 : Math.max(1.5, Math.min(100, Number(percent)))
      return h(
        'div',
        { className: 'dcs-meterBlock' },
        h(
          'div',
          { className: 'dcs-meterHead' },
          h('span', { className: 'dcs-eyebrow' }, translate('usage.label')),
          h(
            'span',
            { className: 'dcs-meterValue' },
            valueText,
            percent !== null ? ' · ' + percent + '%' : '',
          ),
        ),
        h(
          'div',
          {
            className: 'dcs-meterTrack',
            role: 'progressbar',
            'aria-label': translate('usage.label'),
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': percent === null ? 0 : Number(percent),
          },
          h('div', { className: 'dcs-meterFill', 'data-level': level, style: { width: barWidth + '%' } }),
        ),
      )
    }

    function Stat(props) {
      return h(
        'div',
        { className: 'dcs-stat' },
        h('span', { className: 'dcs-statValue' }, props.value),
        h('span', { className: 'dcs-statLabel' }, props.label),
      )
    }

    function ResultCard(props) {
      const outcome = props.outcome || {}
      const result = outcome.result || {}
      const after = outcome.after || {}
      const stats = []
      if (typeof result.shadowedCount === 'number') {
        stats.push(h(Stat, { key: 'items', value: formatCount(result.shadowedCount), label: translate('result.items') }))
      }
      if (typeof result.shadowedTokens === 'number') {
        stats.push(h(Stat, { key: 'tokens', value: '≈' + formatTokens(result.shadowedTokens), label: translate('result.released') }))
      }
      if (typeof after.tokens === 'number') {
        stats.push(h(Stat, { key: 'after', value: '≈' + formatTokens(after.tokens), label: translate('result.usageAfter') }))
      }
      const summary = typeof result.summary === 'string' ? result.summary.trim() : ''
      return h(
        'section',
        {
          className: 'dcs-card dcs-result',
          ref: props.resultRef,
          tabIndex: -1,
          role: 'status',
          'aria-live': 'polite',
        },
        h(
          'div',
          { className: 'dcs-resultHead' },
          h('span', { className: 'dcs-dot', 'aria-hidden': 'true' }),
          h('h2', { className: 'dcs-cardTitle' }, translate('result.done')),
        ),
        stats.length > 0 ? h('div', { className: 'dcs-stats' }, stats) : null,
        h(
          'div',
          { className: 'dcs-summaryWrap' },
          h('span', { className: 'dcs-eyebrow' }, translate('result.summary')),
          h('div', { className: 'dcs-summary' }, summary !== '' ? summary : translate('result.summaryEmpty')),
        ),
        h(
          'div',
          { className: 'dcs-actionsRow' },
          h(
            'button',
            { type: 'button', className: 'dcs-primary', onClick: backToConversation },
            translate('action.backToChat'),
          ),
          h(
            'button',
            { type: 'button', className: 'dcs-ghost', onClick: props.onAgain, disabled: props.busy },
            translate('action.summarizeAgain'),
          ),
        ),
      )
    }

    function NoopCard(props) {
      return h(
        'section',
        { className: 'dcs-card dcs-result', ref: props.resultRef, tabIndex: -1, role: 'status', 'aria-live': 'polite' },
        h(
          'div',
          { className: 'dcs-resultHead' },
          h('span', { className: 'dcs-dot dcs-dot--muted', 'aria-hidden': 'true' }),
          h('h2', { className: 'dcs-cardTitle' }, translate('noop.title')),
        ),
        h('p', { className: 'dcs-errorBody' }, translate('noop.body')),
        h(
          'div',
          { className: 'dcs-actionsRow' },
          h('button', { type: 'button', className: 'dcs-ghost', onClick: backToConversation }, translate('action.backToChat')),
        ),
      )
    }

    function ErrorCard(props) {
      const failure = props.failure || {}
      const code = failure.code || 'internal'
      return h(
        'section',
        {
          className: 'dcs-card dcs-error dcs-result',
          ref: props.resultRef,
          tabIndex: -1,
          role: 'status',
          'aria-live': 'polite',
        },
        h(
          'div',
          { className: 'dcs-resultHead' },
          h('span', { className: 'dcs-dot dcs-dot--error', 'aria-hidden': 'true' }),
          h('h2', { className: 'dcs-errorTitle' }, translate('error.title')),
        ),
        h('p', { className: 'dcs-errorBody' }, errorMessage(code, failure.message)),
        h('p', { className: 'dcs-hint' }, errorHint(code)),
        h(
          'div',
          { className: 'dcs-actionsRow' },
          h(
            'button',
            { type: 'button', className: 'dcs-primary', onClick: props.onRetry, disabled: props.busy },
            translate('action.retry'),
          ),
          h('button', { type: 'button', className: 'dcs-ghost', onClick: backToConversation }, translate('action.backToChat')),
        ),
      )
    }

    function EmptyState() {
      return h(
        'div',
        { className: 'dcs-center' },
        h('span', { className: 'dcs-centerIcon', 'aria-hidden': 'true' }, h(Glyph, { size: 22 })),
        h('h2', { className: 'dcs-centerTitle' }, translate('empty.title')),
        h('p', { className: 'dcs-centerBody' }, translate('empty.body')),
      )
    }

    function UnsupportedState() {
      return h(
        'div',
        { className: 'dcs-center' },
        h('span', { className: 'dcs-centerIcon', 'aria-hidden': 'true' }, h(Glyph, { size: 22 })),
        h('h2', { className: 'dcs-centerTitle' }, translate('unsupported.title')),
        h('p', { className: 'dcs-centerBody' }, translate('unsupported.body')),
      )
    }

    function Steps() {
      const steps = [translate('steps.one'), translate('steps.two'), translate('steps.three')]
      return h(
        'section',
        { className: 'dcs-card' },
        h('span', { className: 'dcs-eyebrow' }, translate('steps.title')),
        h(
          'div',
          { className: 'dcs-steps' },
          steps.map(function step(text, index) {
            return h(
              'div',
              { className: 'dcs-step', key: 'step-' + index },
              h('span', { className: 'dcs-stepNum', 'aria-hidden': 'true' }, String(index + 1)),
              h('span', null, text),
            )
          }),
        ),
        h('p', { className: 'dcs-stepsNote' }, translate('steps.note')),
      )
    }

    // ── Composer surfaces: one-click action + ambient status ──────────────
    function ComposerButtonBody(props) {
      const sessionId = props.sessionId
      const state = useRunState(sessionId)
      const running = state.phase === 'running'
      const sessionRunning = props.sessionRunning === true
      const disabled = running || sessionRunning || typeof sessionId !== 'string' || sessionId === ''
      const label = running ? translate('composer.running') : translate('composer.tooltip')
      const title = sessionRunning ? translate('hint.running') : label
      return h(
        React.Fragment,
        null,
        h('style', null, COMPOSER_CSS),
        h(
          'button',
          {
            type: 'button',
            className: 'dcs-tool',
            'data-busy': running ? 'true' : undefined,
            'aria-label': title,
            'aria-busy': running ? 'true' : undefined,
            title: title,
            disabled: disabled,
            onClick: function onComposerSummarize() {
              if (typeof sessionId !== 'string' || sessionId === '') return
              void runStore(sessionId).start()
            },
          },
          running
            ? h('span', { className: 'dcs-toolSpinner', 'aria-hidden': 'true' })
            : h(Glyph, { size: 16 }),
        ),
      )
    }

    function ComposerButton(props) {
      useLocaleRefresh()
      const owner = props || {}
      if (typeof owner.useSessionStatus !== 'function') {
        return h(ComposerButtonBody, Object.assign({}, owner, { sessionRunning: false }))
      }
      return h(SessionRunningReader, Object.assign({}, owner, { children: ComposerButtonBody }))
    }

    function ComposerStatus(props) {
      useLocaleRefresh()
      const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : ''
      const state = useRunState(sessionId)
      if (sessionId === '' || state.phase === 'idle') return null
      const store = runStore(sessionId)
      const phase = state.phase
      let text = ''
      let tone = 'info'
      if (phase === 'running') {
        text = translate('composer.running')
      } else if (phase === 'done') {
        const outcome = state.outcome || {}
        const result = outcome.result || {}
        const parts = []
        if (typeof result.shadowedCount === 'number') {
          parts.push(String(result.shadowedCount) + ' ' + translate('composer.itemsShort'))
        }
        if (typeof result.shadowedTokens === 'number') {
          parts.push(translate('composer.reclaimed') + ' ≈' + formatTokens(result.shadowedTokens))
        }
        if (parts.length === 0) {
          const after = outcome.after || {}
          if (typeof after.tokens === 'number') {
            parts.push(translate('result.usageAfter') + ' ≈' + formatTokens(after.tokens))
          }
        }
        text = parts.length > 0 ? translate('result.done') + ' · ' + parts.join(' · ') : translate('result.done')
        tone = 'success'
      } else if (phase === 'noop') {
        text = translate('noop.title')
        tone = 'muted'
      } else {
        const failure = state.failure || {}
        text = errorMessage(failure.code || 'internal', failure.message)
        tone = 'error'
      }
      return h(
        React.Fragment,
        null,
        h('style', null, COMPOSER_CSS),
        h(
          'div',
          {
            className: 'dcs-chip',
            'data-tone': tone,
            'data-dsh-context-summarizer': 'composer-status',
            role: 'status',
            'aria-live': 'polite',
          },
          phase === 'running'
            ? h('span', { className: 'dcs-chipSpinner', 'aria-hidden': 'true' })
            : h('span', { className: 'dcs-chipDot', 'aria-hidden': 'true' }),
          h('span', { className: 'dcs-chipText', title: text }, text),
          phase === 'error'
            ? h(
                'button',
                { type: 'button', className: 'dcs-chipBtn dcs-chipBtn--text', onClick: function onRetry() { void store.start() } },
                translate('action.retryShort'),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'dcs-chipBtn',
              'aria-label': translate('action.dismiss'),
              title: translate('action.dismiss'),
              onClick: function onDismiss() { store.dismiss() },
            },
            h(CloseGlyph),
          ),
        ),
      )
    }

    function SessionCard(props) {
      const outcome = props.outcome
      const failure = props.failure
      const busy = props.phase === 'running'
      const blocked = busy || props.sessionRunning
      return h(
        'div',
        { className: 'dcs-inner' },
        h(
          'section',
          { className: 'dcs-card' },
          h(
            'div',
            { className: 'dcs-sessionRow' },
            h(
              'div',
              { className: 'dcs-sessionInfo' },
              h('span', { className: 'dcs-eyebrow' }, translate('session.current')),
              h(
                'span',
                { className: 'dcs-sessionTitle', title: props.sessionTitle },
                props.sessionTitle,
              ),
            ),
            props.sessionRunning
              ? h('span', { className: 'dcs-pill' }, translate('session.running'))
              : null,
          ),
          h(UsageMeter, { usage: props.usage, phase: props.usagePhase }),
          h(
            'div',
            { className: 'dcs-actions' },
            h(
              'div',
              { className: 'dcs-actionsRow' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dcs-primary',
                  disabled: blocked,
                  'aria-busy': busy,
                  title: props.sessionRunning ? translate('hint.running') : translate('action.summarize'),
                  onClick: props.onSummarize,
                },
                busy ? h('span', { className: 'dcs-spinner', 'aria-hidden': 'true' }) : h(Glyph, { size: 14 }),
                h('span', null, busy ? translate('action.summarizing') : translate('action.summarize')),
              ),
            ),
            h('p', { className: 'dcs-hint' }, props.sessionRunning ? translate('hint.running') : translate('hint.summarize')),
          ),
        ),
        busy
          ? h(
              'section',
              { className: 'dcs-card', role: 'status', 'aria-live': 'polite' },
              h(
                'div',
                { className: 'dcs-progress' },
                h(
                  'div',
                  { className: 'dcs-progressHead' },
                  h('span', { className: 'dcs-spinner--ink', 'aria-hidden': 'true' }),
                  h('span', null, translate('progress.title')),
                ),
                h('p', { className: 'dcs-hint' }, translate('progress.body')),
              ),
            )
          : null,
        props.phase === 'done' && outcome
          ? h(ResultCard, { outcome: outcome, resultRef: props.resultRef, onAgain: props.onSummarize, busy: busy })
          : null,
        props.phase === 'noop'
          ? h(NoopCard, { resultRef: props.resultRef })
          : null,
        props.phase === 'error' && failure
          ? h(ErrorCard, {
              failure: failure,
              resultRef: props.resultRef,
              onRetry: props.onSummarize,
              busy: blocked,
            })
          : null,
        props.phase === 'ready' ? h(Steps) : null,
      )
    }

    // ── Page component ────────────────────────────────────────────────────
    function CompactorPageInner(props) {
      const useSessions = props.useSessions
      useLocaleRefresh()

      // The standard global slot feed. A selector-honouring hook returns our object;
      // a snapshot-returning hook (older shells) returns SessionListState — both
      // carry `current` and `byId`, so this one call works on either contract.
      const snapshot = useSessions(function selectCurrentSession(state) {
        if (!state || typeof state !== 'object') return { current: undefined, byId: {} }
        return { current: state.current, byId: state.byId || {} }
      })
      const currentId = snapshot && snapshot.current ? snapshot.current : undefined
      const byId = (snapshot && snapshot.byId) || {}
      const session = currentId ? byId[currentId] : undefined
      const sessionTitle =
        session && typeof session.displayTitle === 'string' && session.displayTitle !== ''
          ? session.displayTitle
          : translate('session.untitled')
      const sessionRunning = Boolean(session && session.running)

      const usagePair = React.useState(null)
      const setUsage = usagePair[1]
      const usage = usagePair[0]
      const usagePhasePair = React.useState('idle')
      const usagePhase = usagePhasePair[0]
      const setUsagePhase = usagePhasePair[1]
      const phasePair = React.useState('ready')
      const phase = phasePair[0]
      const setPhase = phasePair[1]
      const outcomePair = React.useState(null)
      const outcome = outcomePair[0]
      const setOutcome = outcomePair[1]
      const failurePair = React.useState(null)
      const failure = failurePair[0]
      const setFailure = failurePair[1]

      const requestSeq = React.useRef(0)
      const mountedRef = React.useRef(true)
      const resultRef = React.useRef(null)
      const phaseRef = React.useRef('ready')
      phaseRef.current = phase

      React.useEffect(function trackMounted() {
        mountedRef.current = true
        return function markUnmounted() {
          mountedRef.current = false
        }
      }, [])

      // Current session changed: reset the run state and read the new usage.
      React.useEffect(
        function loadUsageForCurrentSession() {
          const seq = requestSeq.current + 1
          requestSeq.current = seq
          setUsage(null)
          setOutcome(null)
          setFailure(null)
          setPhase('ready')
          if (!currentId) {
            setUsagePhase('idle')
            return
          }
          setUsagePhase('loading')
          void callApi('/api/usage', { sessionId: currentId }).then(function onUsage(payload) {
            if (!mountedRef.current || seq !== requestSeq.current) return
            if (payload && payload.ok) {
              setUsage(payload.usage || null)
              setUsagePhase('ready')
            } else {
              setUsagePhase('error')
            }
          })
        },
        [currentId],
      )

      // Move focus to the settled result so screen readers announce it.
      React.useEffect(
        function focusSettledResult() {
          if (phase !== 'done' && phase !== 'noop' && phase !== 'error') return
          const node = resultRef.current
          if (node && typeof node.focus === 'function') {
            try {
              node.focus({ preventScroll: false })
            } catch (error) {
              /* focus is a nicety, never a failure */
            }
          }
        },
        [phase],
      )

      function summarize() {
        if (!currentId) {
          setFailure({ code: 'no-session', message: 'no current session' })
          setPhase('error')
          return
        }
        if (phaseRef.current === 'running' || sessionRunning) return
        const seq = requestSeq.current
        setFailure(null)
        setOutcome(null)
        setPhase('running')
        void callApi('/api/compact', { sessionId: currentId }).then(function onCompacted(payload) {
          if (!mountedRef.current || seq !== requestSeq.current) return
          if (!payload || payload.ok !== true) {
            setFailure((payload && payload.error) || { code: 'internal', message: 'unknown error' })
            setPhase('error')
            return
          }
          setOutcome(payload)
          if (payload.before) {
            setUsage(payload.before)
            setUsagePhase('ready')
          }
          if (payload.noop === true) {
            setPhase('noop')
            return
          }
          setPhase('done')
          // The authoritative post-summary measurement arrives with the result.
          if (payload.after) setUsage(payload.after)
        })
      }

      return h(
        'div',
        { className: 'dcs-page', 'data-dsh-context-summarizer': 'page', 'data-version': CLIENT_VERSION },
        h('style', null, PAGE_CSS),
        h(
          'div',
          { className: 'dcs-inner' },
          h(
            'header',
            { className: 'dcs-header' },
            h('span', { className: 'dcs-mark', 'aria-hidden': 'true' }, h(Glyph, { size: 24 })),
            h(
              'div',
              { className: 'dcs-headText' },
              h('h1', { className: 'dcs-title' }, translate('page.title')),
              h('p', { className: 'dcs-subtitle' }, translate('page.subtitle')),
            ),
          ),
          currentId
            ? h(SessionCard, {
                sessionTitle: sessionTitle,
                sessionRunning: sessionRunning,
                usage: usage,
                usagePhase: usagePhase,
                phase: phase,
                outcome: outcome,
                failure: failure,
                onSummarize: summarize,
                resultRef: resultRef,
              })
            : h(EmptyState),
        ),
      )
    }

    function CompactorPage(ownerProps) {
      const props = ownerProps || {}
      if (typeof props.useSessions !== 'function') {
        return h(
          'div',
          { className: 'dcs-page' },
          h('style', null, PAGE_CSS),
          h('div', { className: 'dcs-inner' }, h(UnsupportedState)),
        )
      }
      return h(CompactorPageInner, props)
    }

    /** Keeps one plugin crash from blanking the whole slot entry. */
    class PageBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error: error || new Error('unknown error') }
      }

      componentDidCatch(error) {
        try {
          console.error('[dsh-context-summarizer] page crashed', error)
        } catch (ignored) {
          /* ignore */
        }
      }

      render() {
        if (this.state && this.state.error) {
          return h(
            'div',
            { className: 'dcs-page' },
            h('style', null, PAGE_CSS),
            h(
              'div',
              { className: 'dcs-inner' },
              h(
                'div',
                { className: 'dcs-center' },
                h('span', { className: 'dcs-centerIcon', 'aria-hidden': 'true' }, h(Glyph, { size: 22 })),
                h('h2', { className: 'dcs-centerTitle' }, translate('error.title')),
                h('p', { className: 'dcs-centerBody' }, String(this.state.error.message || this.state.error)),
              ),
            ),
          )
        }
        return this.props.children
      }
    }

    function PageRoot(ownerProps) {
      return h(PageBoundary, null, h(CompactorPage, ownerProps))
    }

    // ── Plugin body ───────────────────────────────────────────────────────
    function apply(ctx) {
      rootCtx = ctx

      ctx.effect(function registerLocale() {
        return ctx.locale.register(NS, { zh: zh, en: en })
      }, 'dsh-context-summarizer: locale')

      try {
        boundTranslate = ctx.locale.bind(NS)
      } catch (error) {
        boundTranslate = null
      }

      ctx.effect(function watchLocale() {
        return ctx.on('locale/change', function onLocaleChange() {
          try {
            boundTranslate = ctx.locale.bind(NS)
          } catch (error) {
            /* keep the previous translator */
          }
          for (const notify of Array.from(localeListeners)) {
            try {
              notify()
            } catch (error) {
              /* one listener must not block the rest */
            }
          }
        })
      }, 'dsh-context-summarizer: locale listener')

      // Left-sidebar row: the global panel list entry that selects this page.
      ctx.effect(function registerSidebarRow() {
        return ctx.slots.inject('sidebar.panellist', function mountSidebarRow() {
          return ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: PANEL_ORDER,
              label: function sidebarLabel() {
                return translate('nav.label')
              },
              locale: NS,
            },
            function SidebarGlyph(owner) {
              const props = owner || {}
              const size = typeof props.size === 'number' && props.size > 0 ? props.size : 16
              return h(Glyph, { size: size })
            },
          )
        })
      }, 'dsh-context-summarizer: sidebar row')

      // Keyed main page: what clicking the row opens.
      ctx.effect(function registerMainPage() {
        return ctx.slots.inject('main', function mountMainPage() {
          return ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: function pageProps() {
                return { t: translate }
              },
            },
            PageRoot,
          )
        })
      }, 'dsh-context-summarizer: main page')

      // Composer surfaces: the one-click action sits in the composer tool row
      // (beside attach / permission / plan), and the ambient chip below the
      // composer reports progress, the reclaimed context and failures.
      ctx.effect(function registerComposerAction() {
        return ctx.slots.inject('conversation.input.left', function mountComposerAction() {
          return ctx.slots.register(
            {
              name: 'conversation.input.left',
              id: PANEL_ID,
              order: 10,
              label: function composerActionLabel() {
                return translate('composer.tooltip')
              },
              locale: NS,
            },
            ComposerButton,
          )
        })
      }, 'dsh-context-summarizer: composer action')

      ctx.effect(function registerComposerStatus() {
        return ctx.slots.inject('conversation.composer.dock', function mountComposerStatus() {
          return ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: PANEL_ID + '-status',
              order: 5,
              locale: NS,
            },
            ComposerStatus,
          )
        })
      }, 'dsh-context-summarizer: composer status')
    }

    return { name: NS, inject: ['slots', 'locale'], apply: apply }
  },
})
