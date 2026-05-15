import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { ToolBrowser } from './tool-browser.js';

/**
 * Shell host page — outer frame of the cross-page demo.
 *
 * Layout:
 *   ┌──────────────────────────────┬───────────────┐
 *   │                              │               │
 *   │   <iframe src="menu.html">   │   Sidebar     │
 *   │     ←  page navigates here   │  ToolBrowser  │
 *   │     while sidebar stays on   │  (MCP / CLI)  │
 *   │                              │               │
 *   └──────────────────────────────┴───────────────┘
 *
 * The sidebar reads tools/resources via reference-backend's /mcp HTTP
 * endpoint (the iframe page mounts <Sidecar> that connects to the same
 * backend via ws). When the iframe navigates (real `<a href>` load),
 * the backend session updates the active markers, the MCP tools/list
 * filter re-runs, and the sidebar's tool catalog refreshes.
 */
export function ShellPage() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeUrl, setIframeUrl] = useState<string>('menu.html');

  const backendUrl = import.meta.env.VITE_BACKEND_URL as string | undefined;
  const userToken = import.meta.env.VITE_USER_TOKEN as string | undefined;
  // Derive http URL of reference-backend from the ws URL. The shell's
  // sidebar uses /mcp (Streamable HTTP) and /cli/exec; the iframe page
  // uses /ws. Same host, different scheme.
  const backendHttpBase = backendUrl
    ? backendUrl.replace(/^ws/, 'http').replace(/\/ws$/, '')
    : '';

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const loc = iframe.contentWindow?.location;
      if (loc) {
        const next = loc.pathname.replace(/^\//, '') + loc.search + loc.hash;
        setIframeUrl(next || 'menu.html');
      }
    } catch {
      // cross-origin iframe — shouldn't happen in this demo but defensive
    }
  }, []);

  const navigate = useCallback((page: 'menu.html' | 'settings.html') => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.src = page;
  }, []);

  useEffect(() => {
    document.title = '🐚 Companion Shell — Coffee Shop Demo';
  }, []);

  const ready = Boolean(backendUrl && userToken);

  return (
    <div style={pageStyle}>
      <header style={topBarStyle}>
        <span style={brandStyle}>🐚 Companion Shell</span>
        <span style={urlPillStyle} data-ai="shell-iframe-url">
          /{iframeUrl}
        </span>
        <button
          type="button"
          onClick={() => navigate('menu.html')}
          style={navBtnStyle}
        >
          ← 回菜单
        </button>
        <button
          type="button"
          onClick={() => navigate('settings.html')}
          style={navBtnStyle}
        >
          设置 →
        </button>
        <span style={{ flex: 1 }} />
        <span
          style={{
            ...statusDotStyle,
            background: ready ? 'rgb(16 185 129)' : 'rgb(220 38 38)',
          }}
        />
        <span style={{ fontSize: 11, opacity: 0.7 }}>
          {ready ? `backend ${backendHttpBase}` : 'NO BACKEND (set VITE_BACKEND_URL / VITE_USER_TOKEN)'}
        </span>
      </header>

      <main style={mainGridStyle}>
        <section style={iframeWrapStyle}>
          <iframe
            ref={iframeRef}
            src="menu.html"
            title="content"
            style={iframeStyle}
            onLoad={handleIframeLoad}
          />
        </section>
        <aside style={sidebarStyle}>
          {ready ? (
            <ToolBrowser
              backendHttpBase={backendHttpBase}
              userToken={userToken!}
            />
          ) : (
            <div style={emptyStateStyle}>
              <p style={{ margin: 0, opacity: 0.7, fontSize: 13 }}>
                后端没起 / token 没拿到。请先跑：
              </p>
              <pre style={preStyle}>pnpm demo:cross-page</pre>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

const pageStyle: CSSProperties = {
  display: 'grid',
  gridTemplateRows: '44px 1fr',
  width: '100vw',
  height: '100vh',
  background: 'rgb(15 15 18)',
};
const topBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 14px',
  background: 'rgb(24 24 27)',
  color: 'rgb(225 225 230)',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};
const brandStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
  letterSpacing: '0.04em',
  marginRight: 6,
};
const urlPillStyle: CSSProperties = {
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
  fontSize: 12,
  background: 'rgba(255,255,255,0.06)',
  padding: '3px 10px',
  borderRadius: 999,
  color: 'rgb(180 200 240)',
};
const navBtnStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.12)',
  color: 'rgb(225 225 230)',
  borderRadius: 6,
  padding: '3px 10px',
  fontSize: 12,
  cursor: 'pointer',
};
const statusDotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
};
const mainGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 420px',
  height: '100%',
};
const iframeWrapStyle: CSSProperties = {
  background: 'white',
  borderRight: '1px solid rgba(255,255,255,0.06)',
};
const iframeStyle: CSSProperties = {
  border: 'none',
  width: '100%',
  height: '100%',
  background: 'white',
};
const sidebarStyle: CSSProperties = {
  background: 'rgb(20 20 24)',
  color: 'rgb(225 225 230)',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
};
const emptyStateStyle: CSSProperties = {
  padding: 16,
  fontSize: 13,
};
const preStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  padding: '8px 10px',
  borderRadius: 6,
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
  fontSize: 12,
};
