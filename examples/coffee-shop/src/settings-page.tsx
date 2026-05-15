import { useCallback, useEffect, type CSSProperties } from 'react';
import { Sidecar } from '@web-companion/sidecar/react';
import { settingsStore, useSettings, COUNTRIES } from './settings-store.js';

/**
 * Settings page — iframe content for cross-page demo. Exposes 8 control
 * archetypes the companion DSL needs to drive end-to-end:
 *   1. text input         (data-ai=set-nickname)
 *   2. password input     (data-ai=set-password)
 *   3. <select> dropdown  (data-ai=select-country)
 *   4. radio group        (data-ai=pick-theme-{value})
 *   5. textarea           (data-ai=set-bio)
 *   6. color picker       (data-ai=pick-accent-color)
 *   7. date picker        (data-ai=pick-reminder-date)
 *   8. drawer trigger     (data-ai-tool=open-drawer / close-drawer)
 *
 * The drawer holds a checkbox (notifications) + an api-key input — gated
 * behind drawerOpen so the DSL must open the drawer before filling them.
 */
export function SettingsPage() {
  const s = useSettings();

  const backendUrl = import.meta.env.VITE_BACKEND_URL as string | undefined;
  const userToken = import.meta.env.VITE_USER_TOKEN as string | undefined;
  const useSidecar = Boolean(backendUrl && userToken);

  const handleError = useCallback((err: unknown) => {
    console.warn('[settings] sidecar error:', err);
  }, []);

  useEffect(() => {
    document.title = '⚙️ Settings — Coffee Shop';
  }, []);

  return (
    <div style={pageStyle} data-ai-view="settings">
      <nav style={navStyle} data-ai="cross-page-nav">
        <a href="menu.html" style={navLink} data-ai-tool="goto-menu">
          ☕ 菜单
        </a>
        <a href="settings.html" style={navLinkActive}>
          ⚙️ 设置
        </a>
        <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 12 }}>
          settings page · 8 类控件全覆盖
        </span>
      </nav>

      <header style={headerStyle}>
        <h1 style={{ margin: 0, fontSize: 24 }}>⚙️ 设置</h1>
        <p style={{ margin: '4px 0 0', opacity: 0.6, fontSize: 13 }}>
          所有控件都暴露成 spec 工具 —— sidebar 可直接驱动。
        </p>
      </header>

      <section style={sectionStyle}>
        <h2 style={sectionTitle}>个人资料</h2>

        <div style={fieldRow}>
          <label style={fieldLabel} htmlFor="setting-nickname">
            昵称（input）
          </label>
          <input
            id="setting-nickname"
            type="text"
            value={s.nickname}
            data-ai="set-nickname"
            onChange={(e) => settingsStore.update('nickname', e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={fieldRow}>
          <label style={fieldLabel} htmlFor="setting-password">
            密码（password）
          </label>
          <input
            id="setting-password"
            type="password"
            value={s.password}
            data-ai="set-password"
            onChange={(e) => settingsStore.update('password', e.target.value)}
            style={inputStyle}
          />
          <span style={hintStyle}>
            当前长度 <code data-ai="password-length">{s.password.length}</code>
          </span>
        </div>

        <div style={fieldRow}>
          <label style={fieldLabel} htmlFor="setting-country">
            国家（dropdown）
          </label>
          <select
            id="setting-country"
            value={s.country}
            data-ai="select-country"
            onChange={(e) => settingsStore.update('country', e.target.value)}
            style={inputStyle}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div style={fieldRow}>
          <span style={fieldLabel}>主题（radio）</span>
          <div style={{ display: 'flex', gap: 14 }} data-ai="theme-radio-group">
            {(['light', 'dark', 'auto'] as const).map((t) => (
              <label key={t} style={radioLabel}>
                <input
                  type="radio"
                  name="theme"
                  value={t}
                  checked={s.theme === t}
                  data-ai={`pick-theme-${t}`}
                  onChange={() => settingsStore.update('theme', t)}
                />{' '}
                {t}
              </label>
            ))}
          </div>
        </div>

        <div style={fieldRow}>
          <label style={fieldLabel} htmlFor="setting-bio">
            自我介绍（textarea）
          </label>
          <textarea
            id="setting-bio"
            value={s.bio}
            data-ai="set-bio"
            onChange={(e) => settingsStore.update('bio', e.target.value)}
            rows={4}
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
            placeholder="说点什么吧 …"
          />
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitle}>偏好</h2>

        <div style={fieldRow}>
          <label style={fieldLabel} htmlFor="setting-accent">
            主色调（color picker）
          </label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              id="setting-accent"
              type="color"
              value={s.accentColor}
              data-ai="pick-accent-color"
              onChange={(e) =>
                settingsStore.update('accentColor', e.target.value)
              }
              style={colorStyle}
            />
            <code data-ai="accent-color-value" style={{ fontSize: 13 }}>
              {s.accentColor}
            </code>
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                background: s.accentColor,
                border: '1px solid rgba(0,0,0,0.15)',
              }}
              data-ai="accent-color-swatch"
            />
          </div>
        </div>

        <div style={fieldRow}>
          <label style={fieldLabel} htmlFor="setting-reminder">
            提醒日期（date picker）
          </label>
          <input
            id="setting-reminder"
            type="date"
            value={s.reminderDate}
            data-ai="pick-reminder-date"
            onChange={(e) =>
              settingsStore.update('reminderDate', e.target.value)
            }
            style={inputStyle}
          />
        </div>

        <div style={fieldRow}>
          <span style={fieldLabel}>更多（抽屉）</span>
          <button
            type="button"
            data-ai-tool="open-drawer"
            onClick={() => settingsStore.toggleDrawer(true)}
            disabled={s.drawerOpen}
            style={primaryBtn}
          >
            打开高级设置
          </button>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitle}>保存</h2>
        <button
          type="button"
          data-ai-tool="save-profile"
          onClick={() => settingsStore.saveProfile()}
          style={{ ...primaryBtn, background: 'rgb(16 185 129)' }}
        >
          💾 保存所有设置
        </button>
        <p style={{ marginTop: 12, fontSize: 12, opacity: 0.6 }}>
          已保存 <code data-ai="save-count">{s.saveLog.length}</code> 次
        </p>
        {s.saveLog.length > 0 && (
          <ul
            data-ai="save-log"
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '8px 0 0',
              maxHeight: 160,
              overflowY: 'auto',
            }}
          >
            {s.saveLog.map((entry) => (
              <li
                key={entry.at}
                data-ai="save-log-entry"
                style={{
                  padding: '4px 8px',
                  fontSize: 11,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
                  borderTop: '1px solid rgba(0,0,0,0.06)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                <span style={{ opacity: 0.5 }} data-ai="save-log-time">
                  {new Date(entry.at).toLocaleTimeString()}
                </span>{' '}
                <span data-ai="save-log-payload">{entry.snapshot}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Drawer — slides in from the right when drawerOpen */}
      <div
        style={{
          ...drawerOverlayStyle,
          pointerEvents: s.drawerOpen ? 'auto' : 'none',
          opacity: s.drawerOpen ? 1 : 0,
        }}
        data-ai="drawer-overlay"
        data-open={s.drawerOpen ? 'true' : 'false'}
        onClick={() => settingsStore.toggleDrawer(false)}
      />
      <aside
        style={{
          ...drawerStyle,
          transform: s.drawerOpen ? 'translateX(0)' : 'translateX(100%)',
        }}
        data-ai-view="drawer"
        data-ai="drawer"
        data-open={s.drawerOpen ? 'true' : 'false'}
      >
        <header style={drawerHeaderStyle}>
          <h3 style={{ margin: 0, fontSize: 16 }}>高级设置</h3>
          <button
            type="button"
            data-ai-tool="close-drawer"
            onClick={() => settingsStore.toggleDrawer(false)}
            style={closeBtnStyle}
            aria-label="close drawer"
          >
            ×
          </button>
        </header>

        <div style={fieldRow}>
          <label style={radioLabel}>
            <input
              type="checkbox"
              checked={s.notificationsEnabled}
              data-ai="toggle-notifications"
              onChange={(e) =>
                settingsStore.update(
                  'notificationsEnabled',
                  e.target.checked,
                )
              }
            />{' '}
            启用通知（checkbox）
          </label>
        </div>

        <div style={fieldRow}>
          <label style={fieldLabel} htmlFor="setting-apikey">
            API key（仅抽屉内）
          </label>
          <input
            id="setting-apikey"
            type="text"
            value={s.apiKey}
            data-ai="set-api-key"
            onChange={(e) => settingsStore.update('apiKey', e.target.value)}
            style={inputStyle}
            placeholder="sk-xxxx"
          />
        </div>
      </aside>

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
  position: 'relative',
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
const sectionStyle: CSSProperties = {
  background: 'white',
  borderRadius: 12,
  padding: 18,
  marginBottom: 16,
  boxShadow: '0 6px 20px rgba(0,0,0,0.06)',
};
const sectionTitle: CSSProperties = {
  margin: '0 0 14px',
  fontSize: 13,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  opacity: 0.7,
};
const fieldRow: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 14,
  margin: '10px 0',
  flexWrap: 'wrap',
};
const fieldLabel: CSSProperties = {
  flex: '0 0 140px',
  fontSize: 13,
  opacity: 0.75,
  paddingTop: 6,
};
const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 200,
  border: '1px solid rgba(0,0,0,0.15)',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 14,
  fontFamily: 'inherit',
  outline: 'none',
};
const colorStyle: CSSProperties = {
  width: 56,
  height: 36,
  border: '1px solid rgba(0,0,0,0.15)',
  borderRadius: 8,
  padding: 2,
  background: 'transparent',
  cursor: 'pointer',
};
const radioLabel: CSSProperties = {
  fontSize: 13,
  cursor: 'pointer',
  userSelect: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};
const hintStyle: CSSProperties = {
  flex: '0 0 100%',
  fontSize: 11,
  opacity: 0.55,
  paddingLeft: 154,
};
const primaryBtn: CSSProperties = {
  background: 'rgb(99 102 241)',
  color: 'white',
  border: 'none',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 500,
};
const drawerOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  transition: 'opacity 200ms ease',
  zIndex: 10,
};
const drawerStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  height: '100vh',
  width: 360,
  maxWidth: '90vw',
  background: 'white',
  boxShadow: '-10px 0 40px rgba(0,0,0,0.2)',
  padding: 20,
  transition: 'transform 240ms ease',
  zIndex: 11,
  overflowY: 'auto',
};
const drawerHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 18,
};
const closeBtnStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  fontSize: 22,
  cursor: 'pointer',
  color: 'rgb(38 38 38)',
  padding: '0 6px',
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
  zIndex: 20,
};
