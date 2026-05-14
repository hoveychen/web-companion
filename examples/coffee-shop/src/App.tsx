import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import {
  Companion,
  createAnthropicDecider,
  type CompanionRuntime,
  type DeciderFn,
} from 'with-sidebar';
import { Sidecar } from '@web-companion/sidecar/react';
import { registerCompanionWithWebMCP } from '@web-companion/webmcp';
import { cartStore, useCart, MENU, searchStore, useSearch } from './cart-store.js';

export function App() {
  const items = useCart();
  const search = useSearch();

  // v0.4 demo: each fake flow's stub panel can be toggled to remove its
  // `data-ai-view` marker. The sdk's PageStateTracker notices the
  // mutation and pushes `page/changed`; the bridge / reference-backend
  // re-filter the catalog so the agent stops seeing the flow's tools.
  const [showAccount, setShowAccount] = useState(true);
  const [showSupport, setShowSupport] = useState(true);
  const [accountName, setAccountName] = useState('Hovey');
  const [accountLoggedIn, setAccountLoggedIn] = useState(true);
  const [supportTickets, setSupportTickets] = useState<
    Array<{ id: string; subject: string; status: 'open' | 'closed' }>
  >([]);
  const [supportSubject, setSupportSubject] = useState('');

  // v0.5 demo: mock auth state — toggle reflects to <body data-wc-user-roles>,
  // PageStateTracker picks it up via its 4-level fallback, page/changed pushes
  // userRoles to the server, the catalog filter re-runs, and admin-gated
  // tools appear / disappear from `tools/list` accordingly.
  type Role = 'anonymous' | 'customer' | 'admin';
  const [userRole, setUserRole] = useState<Role>('anonymous');
  const [adminLog, setAdminLog] = useState<string[]>([]);

  useEffect(() => {
    if (typeof document === 'undefined' || !document.body) return;
    if (userRole === 'anonymous') {
      document.body.removeAttribute('data-wc-user-roles');
    } else {
      document.body.setAttribute('data-wc-user-roles', userRole);
    }
  }, [userRole]);

  // Mode-2 switch: when both VITE_BACKEND_URL and VITE_USER_TOKEN are set,
  // mount the headless <Sidecar/> instead of the in-page <Companion> sidebar.
  // The remote agent backend (e.g. `examples/reference-backend`) drives the
  // page via WebSocket; no local LLM key, no sidebar UI.
  const backendUrl = import.meta.env.VITE_BACKEND_URL as string | undefined;
  const userToken = import.meta.env.VITE_USER_TOKEN as string | undefined;
  const useSidecar = Boolean(backendUrl && userToken);

  const decider = useMemo<DeciderFn | undefined>(() => {
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) return undefined;
    return createAnthropicDecider({
      apiKey,
      systemPromptHint:
        '这是一家咖啡店。用户可能用中文说话——把「拿铁/摩卡/美式/卡布奇诺」映射到 enum 值 latte/mocha/americano/cappuccino。',
    });
  }, []);

  const handleRuntimeReady = useCallback((runtime: CompanionRuntime) => {
    if (import.meta.env.VITE_USE_WEBMCP !== '1') return;
    const result = registerCompanionWithWebMCP(runtime, {
      onUnsupported: (info) => {
        console.warn('[web-companion] WebMCP host not available:', info.reason);
      },
    });
    if (result.registered) {
      console.info('[web-companion] WebMCP tools registered:', result.toolNames);
    }
  }, []);

  const total = items.reduce((sum, i) => sum + i.price, 0);

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={{ margin: 0, fontSize: 26 }}>☕ Coffee Companion</h1>
        <p style={{ margin: '4px 0 0', opacity: 0.6, fontSize: 13 }}>
          试着对右边的 Companion 说：「加一份摩卡」「看看购物车」「结账」
        </p>
        <div style={roleRowStyle} data-ai="role-picker">
          <span style={{ opacity: 0.6, fontSize: 12 }}>v0.5 demo · 当前身份：</span>
          {(['anonymous', 'customer', 'admin'] as const).map((r) => (
            <button
              key={r}
              type="button"
              data-ai-tool={`set-role-${r}`}
              onClick={() => setUserRole(r)}
              style={{
                ...roleBtnStyle,
                ...(userRole === r ? roleBtnActiveStyle : {}),
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </header>

      <section style={searchSectionStyle} data-ai-view="search">
        <h2 style={sectionTitle}>搜索</h2>
        <div style={searchRowStyle}>
          <input
            type="text"
            value={search.query}
            onChange={(e) => searchStore.setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') searchStore.submit();
            }}
            placeholder="试搜：拿铁、咖啡、mocha…"
            data-ai="search-input"
            style={searchInputStyle}
          />
          <button
            type="button"
            data-ai-tool="search-submit"
            onClick={() => searchStore.submit()}
            style={searchSubmitStyle}
          >
            搜
          </button>
        </div>
        {search.searching && (
          <div data-ai="search-loading" style={searchLoadingStyle}>
            搜索中…
          </div>
        )}
        {!search.searching && search.hasSearched && (
          <div data-ai="search-results" style={searchResultsStyle}>
            {search.results.length === 0 ? (
              <span style={{ opacity: 0.5, fontSize: 13 }}>无匹配</span>
            ) : (
              search.results.map((r) => (
                <div
                  key={r.id}
                  data-ai="search-result-item"
                  data-id={r.id}
                  style={resultItemStyle}
                >
                  <span style={{ fontSize: 24 }}>{r.emoji}</span>
                  <span data-ai="result-name">{r.name}</span>
                  <span
                    style={{ marginLeft: 'auto', opacity: 0.6, fontSize: 13 }}
                    data-ai="result-price"
                  >
                    ¥{r.price}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      <main style={mainStyle}>
        <section style={menuSectionStyle}>
          <h2 style={sectionTitle}>菜单</h2>
          <div style={menuGridStyle}>
            {MENU.map((item) => (
              <article
                key={item.id}
                style={cardStyle}
                data-ai="menu-item"
                data-id={item.id}
              >
                <div style={{ fontSize: 48 }}>{item.emoji}</div>
                <h3 style={{ margin: '8px 0 4px' }} data-ai="menu-name">
                  {item.name}
                </h3>
                <div
                  style={{ opacity: 0.6, fontSize: 13 }}
                  data-ai="menu-price"
                >
                  ¥{item.price}
                </div>
                <button
                  type="button"
                  data-ai-tool={`add-cart-${item.id}`}
                  onClick={() => cartStore.add(item.id)}
                  style={primaryBtn}
                >
                  加入购物车
                </button>
              </article>
            ))}
          </div>
        </section>

        <aside style={cartSectionStyle} data-ai-view="cart">
          <h2 style={sectionTitle}>购物车</h2>
          {items.length === 0 ? (
            <p style={{ opacity: 0.5, fontSize: 13 }}>购物车空空如也</p>
          ) : (
            <>
              <ul style={cartListStyle}>
                {items.map((it) => (
                  <li
                    key={it.addedAt}
                    style={cartRowStyle}
                    data-ai="cart-item"
                    data-id={it.id}
                  >
                    <span data-ai="item-name">{it.name}</span>
                    <span
                      style={{ marginLeft: 'auto', opacity: 0.6 }}
                      data-ai="item-price"
                    >
                      ¥{it.price}
                    </span>
                    <button
                      type="button"
                      data-ai-tool={`remove-cart-${it.id}`}
                      onClick={() => cartStore.remove(it.id)}
                      style={removeBtn}
                      aria-label={`remove ${it.name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div style={totalRow}>
                <span>合计</span>
                <span style={{ marginLeft: 'auto', fontWeight: 600 }}>¥{total}</span>
              </div>
              <button
                type="button"
                data-ai-tool="checkout"
                onClick={() => cartStore.checkout()}
                style={checkoutBtn}
              >
                结账 ({items.length})
              </button>
            </>
          )}
        </aside>
      </main>

      {/* Stub demo flows — bring tool / resource counts up so v0.4 filter +
          meta tools have something to differentiate. Each flow can be
          toggled off; removing the [data-ai-view='...'] marker makes the
          PageStateTracker push a `page/changed`, and the bridge /
          reference-backend immediately drops the flow's tools from
          `tools/list`. */}
      <section style={stubRowStyle}>
        <button
          type="button"
          onClick={() => setShowAccount((v) => !v)}
          style={togglerStyle}
        >
          {showAccount ? '关闭' : '打开'} account flow
        </button>
        <button
          type="button"
          onClick={() => setShowSupport((v) => !v)}
          style={togglerStyle}
        >
          {showSupport ? '关闭' : '打开'} support flow
        </button>
      </section>

      {showAccount && (
        <section
          data-ai-view="account"
          data-ai="account-panel"
          style={stubPanelStyle}
        >
          <h2 style={sectionTitle}>账户 (stub)</h2>
          <p style={{ margin: 0, fontSize: 13, opacity: 0.65 }}>
            <span data-ai="account-name">{accountName}</span> ·{' '}
            <span data-ai="account-email">hovey@example.com</span> ·{' '}
            {accountLoggedIn ? 'logged in' : 'logged out'}
          </p>
          <div style={stubControlsStyle}>
            <input
              type="text"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              data-ai="account-name-input"
              style={stubInputStyle}
              placeholder="昵称"
            />
            <button
              type="button"
              data-ai-tool="account-save-name"
              onClick={() => setAccountName((n) => n.trim() || 'Hovey')}
              style={stubBtnStyle}
            >
              保存
            </button>
            <button
              type="button"
              data-ai-tool="account-login"
              onClick={() => setAccountLoggedIn(true)}
              style={stubBtnStyle}
            >
              登录
            </button>
            <button
              type="button"
              data-ai-tool="account-logout"
              onClick={() => setAccountLoggedIn(false)}
              style={stubBtnStyle}
            >
              登出
            </button>
            <button
              type="button"
              data-ai-tool="account-orders"
              onClick={() => undefined}
              style={stubBtnStyle}
            >
              查看订单
            </button>
          </div>
        </section>
      )}

      {showSupport && (
        <section
          data-ai-view="support"
          data-ai="support-panel"
          style={stubPanelStyle}
        >
          <h2 style={sectionTitle}>客服 (stub)</h2>
          <div style={stubControlsStyle}>
            <input
              type="text"
              value={supportSubject}
              onChange={(e) => setSupportSubject(e.target.value)}
              data-ai="support-subject-input"
              style={stubInputStyle}
              placeholder="工单标题"
            />
            <button
              type="button"
              data-ai-tool="support-open"
              onClick={() => {
                const subject = supportSubject.trim();
                if (!subject) return;
                setSupportTickets((prev) => [
                  ...prev,
                  { id: `t-${prev.length + 1}`, subject, status: 'open' },
                ]);
                setSupportSubject('');
              }}
              style={stubBtnStyle}
            >
              提交
            </button>
            <button
              type="button"
              data-ai-tool="support-close"
              onClick={() =>
                setSupportTickets((prev) =>
                  prev.length === 0
                    ? prev
                    : prev.map((t, i) =>
                        i === prev.length - 1 ? { ...t, status: 'closed' } : t,
                      ),
                )
              }
              style={stubBtnStyle}
            >
              关闭最近
            </button>
            <button
              type="button"
              data-ai-tool="support-refresh"
              onClick={() => undefined}
              style={stubBtnStyle}
            >
              刷新列表
            </button>
          </div>
          <ul style={{ ...cartListStyle, marginTop: 8 }}>
            {supportTickets.length === 0 ? (
              <li style={{ opacity: 0.5, fontSize: 13 }}>暂无工单</li>
            ) : (
              supportTickets.map((t) => (
                <li
                  key={t.id}
                  data-ai="support-ticket"
                  data-id={t.id}
                  style={cartRowStyle}
                >
                  <span data-ai="ticket-subject">{t.subject}</span>
                  <span
                    style={{ marginLeft: 'auto', opacity: 0.6, fontSize: 12 }}
                    data-ai="ticket-status"
                  >
                    {t.status}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      )}

      {/* v0.5 admin flow demo — DOM-mounted regardless of role; the spec's
          module-level `where.roles: ['admin']` gate decides whether agents
          can see (and invoke) these tools. Switch the role picker above to
          watch the catalog narrow/widen live. */}
      <section
        data-ai-view="admin"
        data-ai="admin-panel"
        style={stubPanelStyle}
      >
        <h2 style={sectionTitle}>管理后台 (stub)</h2>
        <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>
          这些按钮在 DOM 里始终挂着；agent 能否看见 / 调用，取决于
          <code> companion/admin.json</code> 上的{' '}
          <code>where.roles: ['admin']</code>。
        </p>
        <div style={stubControlsStyle}>
          <button
            type="button"
            data-ai-tool="admin-delete-user"
            onClick={() =>
              setAdminLog((prev) => [
                `[${new Date().toLocaleTimeString()}] soft-deleted user`,
                ...prev,
              ])
            }
            style={stubBtnStyle}
          >
            删除用户
          </button>
          <button
            type="button"
            data-ai-tool="admin-refund-order"
            onClick={() =>
              setAdminLog((prev) => [
                `[${new Date().toLocaleTimeString()}] refunded order`,
                ...prev,
              ])
            }
            style={stubBtnStyle}
          >
            退款订单
          </button>
        </div>
        <ul
          style={{ ...cartListStyle, marginTop: 8 }}
          data-ai="admin-log"
        >
          {adminLog.length === 0 ? (
            <li style={{ opacity: 0.5, fontSize: 13 }}>暂无操作记录</li>
          ) : (
            adminLog.map((entry, i) => (
              <li
                key={`${entry}-${i}`}
                data-ai="admin-log-entry"
                style={{ fontSize: 12, padding: '2px 0' }}
              >
                {entry}
              </li>
            ))
          )}
        </ul>
      </section>

      {useSidecar ? (
        <Sidecar
          backendUrl={backendUrl!}
          token={userToken!}
          onError={(err) => console.warn('[web-companion] sidecar error:', err)}
        />
      ) : (
        <Companion
          onRuntimeReady={handleRuntimeReady}
          {...(decider ? { decider } : {})}
        />
      )}
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: 'rgb(245 244 238)',
  color: 'rgb(38 38 38)',
  padding: '32px 32px 64px',
  paddingRight: 'calc(360px + 48px)',
};
const headerStyle: CSSProperties = { marginBottom: 24 };
const roleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 10,
  fontSize: 13,
};
const roleBtnStyle: CSSProperties = {
  background: 'rgba(0,0,0,0.06)',
  color: 'rgb(38 38 38)',
  border: '1px solid rgba(0,0,0,0.12)',
  borderRadius: 999,
  padding: '4px 12px',
  fontSize: 12,
  cursor: 'pointer',
};
const roleBtnActiveStyle: CSSProperties = {
  background: 'rgb(99 102 241)',
  color: 'white',
  borderColor: 'rgb(99 102 241)',
};
const searchSectionStyle: CSSProperties = {
  background: 'white',
  borderRadius: 12,
  padding: 20,
  marginBottom: 24,
  boxShadow: '0 6px 20px rgba(0,0,0,0.06)',
};
const searchRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
};
const searchInputStyle: CSSProperties = {
  flex: 1,
  border: '1px solid rgba(0,0,0,0.12)',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 14,
  fontFamily: 'inherit',
  outline: 'none',
};
const searchSubmitStyle: CSSProperties = {
  background: 'rgb(99 102 241)',
  color: 'white',
  border: 'none',
  borderRadius: 8,
  padding: '8px 16px',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};
const searchLoadingStyle: CSSProperties = {
  marginTop: 12,
  fontSize: 13,
  opacity: 0.6,
};
const searchResultsStyle: CSSProperties = {
  marginTop: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const resultItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 10px',
  background: 'rgba(99,102,241,0.05)',
  borderRadius: 6,
  fontSize: 14,
};
const mainStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '2fr 1fr',
  gap: 24,
  alignItems: 'start',
};
const menuSectionStyle: CSSProperties = {};
const cartSectionStyle: CSSProperties = {
  background: 'white',
  borderRadius: 12,
  padding: 20,
  boxShadow: '0 6px 20px rgba(0,0,0,0.06)',
  position: 'sticky',
  top: 24,
};
const sectionTitle: CSSProperties = {
  margin: '0 0 12px',
  fontSize: 15,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  opacity: 0.7,
};
const menuGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 16,
};
const cardStyle: CSSProperties = {
  background: 'white',
  borderRadius: 12,
  padding: 20,
  textAlign: 'center',
  boxShadow: '0 6px 20px rgba(0,0,0,0.06)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};
const primaryBtn: CSSProperties = {
  marginTop: 12,
  background: 'rgb(99 102 241)',
  color: 'white',
  border: 'none',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 500,
};
const cartListStyle: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: '0 0 12px',
};
const cartRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
  borderBottom: '1px solid rgba(0,0,0,0.06)',
};
const removeBtn: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'rgb(220 38 38)',
  fontSize: 18,
  cursor: 'pointer',
  padding: '2px 6px',
};
const totalRow: CSSProperties = {
  display: 'flex',
  padding: '8px 0',
  borderTop: '1px solid rgba(0,0,0,0.1)',
  marginBottom: 12,
  fontSize: 13,
};
const stubRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  margin: '24px 0 12px',
};
const togglerStyle: CSSProperties = {
  background: 'rgba(0,0,0,0.06)',
  color: 'rgb(38 38 38)',
  border: '1px solid rgba(0,0,0,0.12)',
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 13,
  cursor: 'pointer',
};
const stubPanelStyle: CSSProperties = {
  background: 'white',
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
  boxShadow: '0 6px 20px rgba(0,0,0,0.04)',
};
const stubControlsStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  marginTop: 8,
  flexWrap: 'wrap',
};
const stubInputStyle: CSSProperties = {
  flex: '0 0 160px',
  border: '1px solid rgba(0,0,0,0.12)',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
};
const stubBtnStyle: CSSProperties = {
  background: 'rgb(99 102 241)',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 13,
  cursor: 'pointer',
};
const checkoutBtn: CSSProperties = {
  width: '100%',
  background: 'rgb(16 185 129)',
  color: 'white',
  border: 'none',
  borderRadius: 8,
  padding: '10px 14px',
  fontSize: 14,
  cursor: 'pointer',
  fontWeight: 600,
};
