import { useEffect, useMemo, type CSSProperties } from 'react';
import { Companion, createAnthropicDecider, type DeciderFn } from '@web-companion/react';
import { cartStore, useCart, MENU } from './cart-store.js';

declare global {
  interface Window {
    __cart?: {
      addToCart: (p: { id: string }) => unknown;
      removeFromCart: (p: { id: string }) => unknown;
      checkout: () => unknown;
      getCart: () => unknown;
      getMenu: () => unknown;
    };
  }
}

export function App() {
  const items = useCart();

  const decider = useMemo<DeciderFn | undefined>(() => {
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) return undefined;
    return createAnthropicDecider({
      apiKey,
      systemPromptHint:
        '这是一家咖啡店。用户可能用中文说话——把「拿铁/摩卡/美式/卡布奇诺」映射到 enum 值 latte/mocha/americano/cappuccino。',
    });
  }, []);

  useEffect(() => {
    window.__cart = {
      addToCart: ({ id }) => cartStore.add(id),
      removeFromCart: ({ id }) => cartStore.remove(id),
      checkout: () => cartStore.checkout(),
      getCart: () => cartStore.getItems(),
      getMenu: () => MENU,
    };
    return () => {
      delete window.__cart;
    };
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

      <main style={mainStyle}>
        <section style={menuSectionStyle}>
          <h2 style={sectionTitle}>菜单</h2>
          <div style={menuGridStyle}>
            {MENU.map((item) => (
              <article key={item.id} style={cardStyle}>
                <div style={{ fontSize: 48 }}>{item.emoji}</div>
                <h3 style={{ margin: '8px 0 4px' }}>{item.name}</h3>
                <div style={{ opacity: 0.6, fontSize: 13 }}>¥{item.price}</div>
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
                  <li key={it.addedAt} style={cartRowStyle}>
                    <span>{it.name}</span>
                    <span style={{ marginLeft: 'auto', opacity: 0.6 }}>
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

      <Companion {...(decider ? { decider } : {})} />
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
