import { useCallback, useMemo, type CSSProperties } from 'react';
import {
  Companion,
  createAnthropicDecider,
  type CompanionRuntime,
  type DeciderFn,
} from '@web-companion/react';
import { Sidecar } from '@web-companion/sidecar/react';
import { registerCompanionWithWebMCP } from '@web-companion/webmcp';
import { cartStore, useCart, MENU, searchStore, useSearch } from './cart-store.js';

export function App() {
  const items = useCart();
  const search = useSearch();

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
      </header>

      <section style={searchSectionStyle}>
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

        <aside style={cartSectionStyle}>
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
