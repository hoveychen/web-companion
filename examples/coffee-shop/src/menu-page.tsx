import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
} from 'react';
import { Sidecar } from '@web-companion/sidecar/react';
import { cartStore, useCart, MENU, searchStore, useSearch } from './cart-store.js';

/**
 * Menu page — iframe content for the cross-page demo's shell.html.
 * Mounts `<Sidecar>` (mode-2 ws) so the outer shell's MCP/CLI sidebar
 * can drive this page via the reference-backend.
 *
 * Cross-page link: a real `<a href="settings.html">` so navigation is
 * an HTTP load, not SPA routing.
 */
export function MenuPage() {
  const items = useCart();
  const search = useSearch();
  const total = items.reduce((sum, i) => sum + i.price, 0);

  const [cartCoupon, setCartCoupon] = useState('');
  const [appliedCoupons, setAppliedCoupons] = useState<string[]>([]);

  const backendUrl = import.meta.env.VITE_BACKEND_URL as string | undefined;
  const userToken = import.meta.env.VITE_USER_TOKEN as string | undefined;
  const useSidecar = Boolean(backendUrl && userToken);

  const handleError = useCallback((err: unknown) => {
    console.warn('[menu] sidecar error:', err);
  }, []);

  useEffect(() => {
    document.title = '☕ Menu — Coffee Shop';
  }, []);

  return (
    <div style={pageStyle}>
      <nav style={navStyle} data-ai="cross-page-nav">
        <a href="menu.html" style={navLinkActive}>
          ☕ 菜单
        </a>
        <a
          href="settings.html"
          style={navLink}
          data-ai-tool="goto-settings"
        >
          ⚙️ 设置
        </a>
        <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 12 }}>
          多页 demo · 点设置真跳页（HTTP load）
        </span>
      </nav>

      <header style={headerStyle}>
        <h1 style={{ margin: 0, fontSize: 24 }}>☕ Coffee Menu</h1>
        <p style={{ margin: '4px 0 0', opacity: 0.6, fontSize: 13 }}>
          这是 iframe 里的菜单页 —— 右侧 sidebar 通过 MCP / CLI 协议驱动它
        </p>
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
          <div style={advancedSectionStyle} data-ai="cart-advanced">
            <div style={{ fontSize: 12, opacity: 0.55, marginBottom: 6 }}>
              cart.advanced
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={cartCoupon}
                onChange={(e) => setCartCoupon(e.target.value)}
                data-ai="cart-coupon-input"
                placeholder="优惠码"
                style={advancedInputStyle}
              />
              <button
                type="button"
                data-ai-tool="cart-apply-coupon"
                onClick={() => {
                  const code = cartCoupon.trim();
                  if (!code) return;
                  setAppliedCoupons((prev) =>
                    prev.includes(code) ? prev : [...prev, code],
                  );
                  setCartCoupon('');
                }}
                style={advancedBtnStyle}
              >
                应用
              </button>
              <button
                type="button"
                data-ai-tool="cart-clear-all"
                onClick={() => {
                  for (const it of items) cartStore.remove(it.id);
                  setAppliedCoupons([]);
                }}
                style={advancedBtnStyle}
              >
                清空
              </button>
            </div>
            {appliedCoupons.length > 0 && (
              <ul style={{ ...cartListStyle, marginTop: 6 }}>
                {appliedCoupons.map((code, i) => (
                  <li
                    key={`${code}-${i}`}
                    data-ai="cart-coupon-applied"
                    style={{ fontSize: 12, padding: '2px 0' }}
                  >
                    {code}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </main>

      {useSidecar ? (
        <Sidecar
          backendUrl={backendUrl!}
          token={userToken!}
          onError={handleError}
        />
      ) : (
        <div style={noBackendBannerStyle}>
          ⚠️ 没设置 VITE_BACKEND_URL / VITE_USER_TOKEN —— 本页不会连 backend。
          请用 <code>pnpm demo:cross-page</code> 启动 demo。
        </div>
      )}
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: 'rgb(245 244 238)',
  color: 'rgb(38 38 38)',
  padding: '20px 24px 64px',
};
const navStyle: CSSProperties = {
  display: 'flex',
  gap: 16,
  alignItems: 'center',
  background: 'white',
  borderRadius: 10,
  padding: '8px 16px',
  marginBottom: 16,
  boxShadow: '0 4px 14px rgba(0,0,0,0.04)',
};
const navLink: CSSProperties = {
  textDecoration: 'none',
  color: 'rgb(38 38 38)',
  fontSize: 14,
  padding: '4px 10px',
  borderRadius: 6,
};
const navLinkActive: CSSProperties = {
  ...navLink,
  background: 'rgb(99 102 241)',
  color: 'white',
};
const headerStyle: CSSProperties = { marginBottom: 16 };
const searchSectionStyle: CSSProperties = {
  background: 'white',
  borderRadius: 12,
  padding: 16,
  marginBottom: 20,
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
  gap: 20,
  alignItems: 'start',
};
const menuSectionStyle: CSSProperties = {};
const cartSectionStyle: CSSProperties = {
  background: 'white',
  borderRadius: 12,
  padding: 16,
  boxShadow: '0 6px 20px rgba(0,0,0,0.06)',
  position: 'sticky',
  top: 16,
};
const sectionTitle: CSSProperties = {
  margin: '0 0 12px',
  fontSize: 14,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  opacity: 0.7,
};
const menuGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 12,
};
const cardStyle: CSSProperties = {
  background: 'white',
  borderRadius: 12,
  padding: 16,
  textAlign: 'center',
  boxShadow: '0 6px 20px rgba(0,0,0,0.06)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};
const primaryBtn: CSSProperties = {
  marginTop: 10,
  background: 'rgb(99 102 241)',
  color: 'white',
  border: 'none',
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
  fontWeight: 500,
};
const cartListStyle: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: '0 0 10px',
};
const cartRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 0',
  borderBottom: '1px solid rgba(0,0,0,0.06)',
  fontSize: 13,
};
const removeBtn: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'rgb(220 38 38)',
  fontSize: 16,
  cursor: 'pointer',
  padding: '0 4px',
};
const totalRow: CSSProperties = {
  display: 'flex',
  padding: '6px 0',
  borderTop: '1px solid rgba(0,0,0,0.1)',
  marginBottom: 10,
  fontSize: 13,
};
const checkoutBtn: CSSProperties = {
  width: '100%',
  background: 'rgb(16 185 129)',
  color: 'white',
  border: 'none',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 600,
};
const advancedSectionStyle: CSSProperties = {
  marginTop: 10,
  paddingTop: 8,
  borderTop: '1px dashed rgba(0,0,0,0.12)',
};
const advancedInputStyle: CSSProperties = {
  flex: 1,
  border: '1px solid rgba(0,0,0,0.12)',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 12,
  fontFamily: 'inherit',
  outline: 'none',
};
const advancedBtnStyle: CSSProperties = {
  background: 'rgba(99,102,241,0.85)',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
};
const noBackendBannerStyle: CSSProperties = {
  position: 'fixed',
  bottom: 12,
  left: 12,
  right: 12,
  background: 'rgba(220, 38, 38, 0.92)',
  color: 'white',
  padding: '8px 14px',
  borderRadius: 8,
  fontSize: 12,
};
