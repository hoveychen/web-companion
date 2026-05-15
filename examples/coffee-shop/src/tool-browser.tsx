import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ListToolsResultSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

export interface ToolBrowserProps {
  backendHttpBase: string;
  userToken: string;
}

type TabKey = 'mcp' | 'cli';

interface LogEntry {
  at: number;
  kind: 'mcp' | 'cli' | 'info' | 'error';
  title: string;
  body: string;
}

/**
 * Persistent sidebar pane shown in shell.html. Speaks MCP Streamable
 * HTTP to the reference-backend's `/mcp` endpoint to enumerate tools
 * (filtered by the iframe page's current markers / userRoles) and
 * issue `tools/call`.
 *
 * Two tabs share the same tool catalog & parameter form:
 *
 *   MCP tab — sends `tools/call` over the open MCP HTTP session and
 *             displays the JSON-RPC payload alongside.
 *   CLI tab — POSTs to `/cli/exec` (reference-backend spawns
 *             `companion call ...`); displays the equivalent command.
 *
 * Neither path involves an LLM; the sidebar is purely a manual driver
 * of the same protocol an agent would use.
 */
export function ToolBrowser({ backendHttpBase, userToken }: ToolBrowserProps) {
  const [tab, setTab] = useState<TabKey>('mcp');
  const [tools, setTools] = useState<Tool[]>([]);
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [connecting, setConnecting] = useState(true);
  const [connectError, setConnectError] = useState<string | null>(null);

  const clientRef = useRef<Client | null>(null);
  const transportRef = useRef<StreamableHTTPClientTransport | null>(null);

  // Reference-backend MCP server namespaces tool names as `<userId>:<name>`
  // for multi-tenant routing. Decode the userId from the JWT once so we
  // can strip the prefix for display + re-add it when invoking.
  const userIdFromToken = useMemo(() => decodeJwtUserId(userToken), [userToken]);
  const stripPrefix = userIdFromToken ? `${userIdFromToken}:` : null;
  const displayName = useCallback(
    (n: string) =>
      stripPrefix && n.startsWith(stripPrefix) ? n.slice(stripPrefix.length) : n,
    [stripPrefix],
  );

  const pushLog = useCallback((entry: Omit<LogEntry, 'at'>) => {
    setLog((prev) => [{ ...entry, at: Date.now() }, ...prev].slice(0, 30));
  }, []);

  // --- Connect MCP client once on mount -----------------------------------
  useEffect(() => {
    let cancelled = false;
    const url = new URL(`${backendHttpBase}/mcp`);
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      },
    });
    const client = new Client(
      { name: 'companion-shell-sidebar', version: '0.1.0' },
      { capabilities: {} },
    );

    transportRef.current = transport;
    clientRef.current = client;

    (async () => {
      try {
        await client.connect(transport);
        if (cancelled) return;
        setConnecting(false);
        pushLog({
          kind: 'info',
          title: 'MCP connected',
          body: `Streamable HTTP → ${url.toString()}`,
        });
        // We let polling pick up catalog changes (see useEffect below) —
        // simpler than wiring the notifications/tools/list_changed schema.
        await refreshTools();
      } catch (err) {
        if (cancelled) return;
        setConnectError(String(err));
        setConnecting(false);
        pushLog({
          kind: 'error',
          title: 'MCP connect failed',
          body: String(err),
        });
      }
    })();

    return () => {
      cancelled = true;
      transport.close().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendHttpBase, userToken]);

  const refreshTools = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      const res = await client.request(
        { method: 'tools/list', params: {} },
        ListToolsResultSchema,
      );
      setTools(res.tools);
    } catch (err) {
      pushLog({
        kind: 'error',
        title: 'tools/list failed',
        body: String(err),
      });
    }
  }, [pushLog]);

  // Light-weight polling — also catches page navigation if the
  // notification handler hasn't wired up cleanly.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!connecting && !connectError) {
        void refreshTools();
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [connecting, connectError, refreshTools]);

  // Reset paramValues when the active tool changes.
  const activeTool = useMemo<Tool | null>(
    () => tools.find((t) => t.name === activeToolName) ?? null,
    [tools, activeToolName],
  );
  useEffect(() => {
    if (!activeTool) {
      setParamValues({});
      return;
    }
    const next: Record<string, unknown> = {};
    const schema = activeTool.inputSchema as JsonSchemaObject | undefined;
    if (schema?.type === 'object' && schema.properties) {
      for (const [k, v] of Object.entries(schema.properties)) {
        next[k] = defaultForProp(v);
      }
    }
    setParamValues(next);
  }, [activeTool]);

  // --- Submission paths ---------------------------------------------------
  const submitMcp = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !activeTool) return;
    const args = sanitizeParams(activeTool, paramValues);
    const payload = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: activeTool.name, arguments: args },
    };
    pushLog({
      kind: 'mcp',
      title: `MCP tools/call ${activeTool.name}`,
      body: JSON.stringify(payload, null, 2),
    });
    try {
      const result = await client.callTool({
        name: activeTool.name,
        arguments: args,
      });
      pushLog({
        kind: 'mcp',
        title: `result ${activeTool.name}`,
        body: JSON.stringify(result, null, 2),
      });
    } catch (err) {
      pushLog({
        kind: 'error',
        title: `MCP tools/call failed ${activeTool.name}`,
        body: String(err),
      });
    }
  }, [activeTool, paramValues, pushLog]);

  const submitCli = useCallback(async () => {
    if (!activeTool) return;
    const args = sanitizeParams(activeTool, paramValues);
    const cleanName = displayName(activeTool.name);
    const cmd = `companion call ${cleanName} --json '${JSON.stringify(args)}'`;
    pushLog({
      kind: 'cli',
      title: `CLI exec ${cleanName}`,
      body: cmd,
    });
    try {
      const res = await fetch(`${backendHttpBase}/cli/exec`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({ tool: cleanName, params: args }),
      });
      const text = await res.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* ignore */ }
      pushLog({
        kind: res.ok ? 'cli' : 'error',
        title: `CLI result (HTTP ${res.status})`,
        body:
          typeof parsed === 'string'
            ? parsed
            : JSON.stringify(parsed, null, 2),
      });
    } catch (err) {
      pushLog({
        kind: 'error',
        title: `CLI exec failed ${activeTool.name}`,
        body: String(err),
      });
    }
  }, [activeTool, paramValues, backendHttpBase, userToken, pushLog]);

  // --- UI -----------------------------------------------------------------
  if (connecting) {
    return (
      <div style={statusStyle}>
        <p style={{ margin: 0 }}>连接 MCP server …</p>
        <code style={codeBlockStyle}>{backendHttpBase}/mcp</code>
      </div>
    );
  }
  if (connectError) {
    return (
      <div style={statusStyle}>
        <p style={{ color: 'rgb(248 113 113)', margin: 0 }}>
          MCP 连接失败：
        </p>
        <code style={codeBlockStyle}>{connectError}</code>
        <button
          type="button"
          onClick={() => location.reload()}
          style={primaryBtn}
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      {/* tabs */}
      <div style={tabsBarStyle}>
        <button
          type="button"
          onClick={() => setTab('mcp')}
          style={tab === 'mcp' ? tabActiveStyle : tabStyle}
        >
          MCP
        </button>
        <button
          type="button"
          onClick={() => setTab('cli')}
          style={tab === 'cli' ? tabActiveStyle : tabStyle}
        >
          CLI
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => void refreshTools()}
          style={smallBtnStyle}
          title="重新拉 tools/list"
        >
          ↻
        </button>
        <span style={{ fontSize: 11, opacity: 0.5 }}>
          {tools.length} tools
        </span>
      </div>

      {/* tool list + active form */}
      <div style={twoColStyle}>
        <ul style={toolListStyle}>
          {tools.length === 0 && (
            <li style={emptyToolStyle}>没有激活的工具</li>
          )}
          {tools.map((t) => {
            const shown = displayName(t.name);
            const desc = stripDescPrefix(t.description, stripPrefix);
            return (
              <li key={t.name}>
                <button
                  type="button"
                  onClick={() => setActiveToolName(t.name)}
                  style={
                    activeToolName === t.name
                      ? toolItemActiveStyle
                      : toolItemStyle
                  }
                >
                  <div style={toolNameStyle}>{shown}</div>
                  {desc && (
                    <div style={toolDescStyle}>
                      {desc.slice(0, 60)}
                      {desc.length > 60 ? '…' : ''}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div style={paneStyle}>
          {!activeTool ? (
            <div style={{ opacity: 0.5, fontSize: 12, padding: 8 }}>
              左边选一个工具
            </div>
          ) : (
            <ToolForm
              tool={activeTool}
              displayLabel={displayName(activeTool.name)}
              displayDescription={stripDescPrefix(activeTool.description, stripPrefix)}
              paramValues={paramValues}
              onChange={setParamValues}
              onSubmit={tab === 'mcp' ? submitMcp : submitCli}
              submitLabel={tab === 'mcp' ? '调用 MCP' : '跑 CLI'}
            />
          )}
          {activeTool && (
            <div style={previewStyle}>
              <div style={previewLabel}>
                {tab === 'mcp' ? 'JSON-RPC payload' : 'CLI command'}
              </div>
              <pre style={previewPreStyle}>
                {tab === 'mcp'
                  ? JSON.stringify(
                      {
                        jsonrpc: '2.0',
                        method: 'tools/call',
                        params: {
                          name: activeTool.name,
                          arguments: sanitizeParams(activeTool, paramValues),
                        },
                      },
                      null,
                      2,
                    )
                  : `companion call ${displayName(activeTool.name)} --json '${JSON.stringify(
                      sanitizeParams(activeTool, paramValues),
                    )}'`}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* log */}
      <div style={logWrapStyle}>
        <div style={logHeaderStyle}>
          <span>事件流</span>
          <button
            type="button"
            onClick={() => setLog([])}
            style={smallBtnStyle}
          >
            清空
          </button>
        </div>
        <ul style={logListStyle}>
          {log.map((entry) => (
            <li
              key={entry.at}
              style={{
                ...logEntryStyle,
                color: logColorFor(entry.kind),
              }}
            >
              <div style={logEntryHead}>
                <span>{entry.title}</span>
                <span style={{ opacity: 0.5, fontSize: 10 }}>
                  {new Date(entry.at).toLocaleTimeString()}
                </span>
              </div>
              <pre style={logBodyStyle}>{entry.body}</pre>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Param form
// ---------------------------------------------------------------------------

interface JsonSchemaProp {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  enum?: string[];
  description?: string;
}
interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
}

interface ToolFormProps {
  tool: Tool;
  displayLabel: string;
  displayDescription?: string;
  paramValues: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  onSubmit: () => void;
  submitLabel: string;
}

function ToolForm({
  tool,
  displayLabel,
  displayDescription,
  paramValues,
  onChange,
  onSubmit,
  submitLabel,
}: ToolFormProps) {
  const schema = tool.inputSchema as JsonSchemaObject | undefined;
  const props =
    schema?.type === 'object' && schema.properties ? schema.properties : {};
  const required = new Set(schema?.required ?? []);
  const propEntries = Object.entries(props);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      style={formStyle}
    >
      <h3 style={formTitleStyle}>{displayLabel}</h3>
      {displayDescription && (
        <p style={formDescStyle}>{displayDescription}</p>
      )}
      {propEntries.length === 0 ? (
        <p style={{ fontSize: 12, opacity: 0.6, margin: '8px 0' }}>
          (无参数)
        </p>
      ) : (
        propEntries.map(([name, prop]) => (
          <label key={name} style={formRowStyle}>
            <div style={formLabelStyle}>
              {name}
              {required.has(name) && (
                <span style={{ color: 'rgb(248 113 113)' }}>*</span>
              )}
              <span style={{ marginLeft: 6, opacity: 0.5, fontWeight: 'normal' }}>
                {prop.type ?? 'any'}
              </span>
            </div>
            <ParamInput
              name={name}
              prop={prop}
              value={paramValues[name]}
              onChange={(v) => onChange({ ...paramValues, [name]: v })}
            />
            {prop.description && (
              <div style={paramHintStyle}>{prop.description}</div>
            )}
          </label>
        ))
      )}
      <button type="submit" style={primaryBtn}>
        {submitLabel}
      </button>
    </form>
  );
}

interface ParamInputProps {
  name: string;
  prop: JsonSchemaProp;
  value: unknown;
  onChange: (next: unknown) => void;
}

const MULTILINE_NAME_HINT = /(bio|notes?|comment|body|content|message|text|description|markdown)/i;
const MULTILINE_DESC_HINT = /(多行|multi[-\s]?line|paragraph|textarea)/i;

function ParamInput({ name, prop, value, onChange }: ParamInputProps) {
  if (prop.enum && prop.enum.length > 0) {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      >
        {prop.enum.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }
  switch (prop.type) {
    case 'integer':
    case 'number':
      return (
        <input
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) =>
            onChange(e.target.value === '' ? '' : Number(e.target.value))
          }
          style={inputStyle}
          step={prop.type === 'integer' ? 1 : 'any'}
        />
      );
    case 'boolean':
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: 16, height: 16 }}
        />
      );
    case 'object':
    case 'array':
      return (
        <textarea
          value={typeof value === 'string' ? value : JSON.stringify(value ?? '')}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value));
            } catch {
              onChange(e.target.value);
            }
          }}
          rows={3}
          style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 11 }}
        />
      );
    case 'string':
    default: {
      const wantsMultiline =
        MULTILINE_NAME_HINT.test(name) ||
        (prop.description !== undefined && MULTILINE_DESC_HINT.test(prop.description));
      if (wantsMultiline) {
        return (
          <textarea
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
          />
        );
      }
      return (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      );
    }
  }
}

function defaultForProp(prop: JsonSchemaProp): unknown {
  if (prop.enum && prop.enum.length > 0) return prop.enum[0];
  switch (prop.type) {
    case 'integer':
    case 'number': return 0;
    case 'boolean': return false;
    case 'object': return {};
    case 'array': return [];
    case 'string':
    default: return '';
  }
}

function decodeJwtUserId(jwt: string): string | null {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = parts[1]!;
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
    const normalized = padded.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(normalized);
    const decoded = JSON.parse(json) as { userId?: unknown };
    return typeof decoded.userId === 'string' ? decoded.userId : null;
  } catch {
    return null;
  }
}

/**
 * The reference-backend prefixes tool descriptions with `[<userId>] `;
 * strip that for a tighter UI.
 */
function stripDescPrefix(
  desc: string | undefined,
  stripPrefix: string | null,
): string | undefined {
  if (!desc) return desc;
  if (!stripPrefix) return desc;
  // Reference-backend wraps the description as `[<userId>] <real>`.
  const userId = stripPrefix.endsWith(':')
    ? stripPrefix.slice(0, -1)
    : stripPrefix;
  const wrapped = `[${userId}] `;
  return desc.startsWith(wrapped) ? desc.slice(wrapped.length) : desc;
}

function sanitizeParams(
  tool: Tool,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const schema = tool.inputSchema as JsonSchemaObject | undefined;
  if (!schema || schema.type !== 'object' || !schema.properties) return {};
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === '' && !(schema.required ?? []).includes(k)) continue;
    result[k] = v;
  }
  return result;
}

function logColorFor(kind: LogEntry['kind']): string {
  switch (kind) {
    case 'mcp': return 'rgb(168 197 255)';
    case 'cli': return 'rgb(165 230 184)';
    case 'error': return 'rgb(248 113 113)';
    case 'info':
    default: return 'rgb(220 220 230)';
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const wrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  fontFamily: 'inherit',
};
const statusStyle: CSSProperties = {
  padding: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  fontSize: 13,
};
const codeBlockStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  padding: '6px 8px',
  borderRadius: 6,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
};
const tabsBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '8px 12px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};
const tabStyle: CSSProperties = {
  background: 'transparent',
  color: 'rgba(220,220,230,0.6)',
  border: 'none',
  borderRadius: 6,
  padding: '4px 14px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
const tabActiveStyle: CSSProperties = {
  ...tabStyle,
  background: 'rgba(99,102,241,0.85)',
  color: 'white',
};
const smallBtnStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  color: 'rgb(220 220 230)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 6,
  padding: '2px 8px',
  fontSize: 11,
  cursor: 'pointer',
};
const twoColStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '150px 1fr',
  flex: 1,
  minHeight: 0,
};
const toolListStyle: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  overflowY: 'auto',
  borderRight: '1px solid rgba(255,255,255,0.06)',
};
const toolItemStyle: CSSProperties = {
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  color: 'rgb(220 220 230)',
  padding: '6px 12px',
  fontSize: 11,
  cursor: 'pointer',
  borderBottom: '1px solid rgba(255,255,255,0.03)',
  display: 'block',
};
const toolItemActiveStyle: CSSProperties = {
  ...toolItemStyle,
  background: 'rgba(99,102,241,0.18)',
};
const toolNameStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
  fontSize: 11,
  fontWeight: 600,
};
const toolDescStyle: CSSProperties = {
  fontSize: 10,
  opacity: 0.5,
  marginTop: 2,
  lineHeight: 1.35,
};
const emptyToolStyle: CSSProperties = {
  padding: 12,
  fontSize: 12,
  opacity: 0.5,
};
const paneStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  padding: 12,
  gap: 10,
};
const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const formTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
};
const formDescStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  opacity: 0.65,
  lineHeight: 1.5,
};
const formRowStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};
const formLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  opacity: 0.8,
};
const paramHintStyle: CSSProperties = {
  fontSize: 10,
  opacity: 0.45,
  marginTop: 2,
};
const inputStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: 'white',
  fontSize: 12,
  padding: '6px 8px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};
const primaryBtn: CSSProperties = {
  background: 'rgb(99 102 241)',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 12,
  cursor: 'pointer',
  fontWeight: 500,
  alignSelf: 'flex-start',
};
const previewStyle: CSSProperties = {
  background: 'rgba(0,0,0,0.4)',
  borderRadius: 6,
  padding: 8,
};
const previewLabel: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  opacity: 0.6,
  marginBottom: 4,
};
const previewPreStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
  fontSize: 10,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  color: 'rgb(200 220 255)',
};
const logWrapStyle: CSSProperties = {
  borderTop: '1px solid rgba(255,255,255,0.06)',
  maxHeight: 240,
  display: 'flex',
  flexDirection: 'column',
};
const logHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 12px',
  fontSize: 11,
  opacity: 0.7,
};
const logListStyle: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  overflowY: 'auto',
  flex: 1,
};
const logEntryStyle: CSSProperties = {
  padding: '6px 12px',
  borderTop: '1px solid rgba(255,255,255,0.04)',
  fontSize: 11,
};
const logEntryHead: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 4,
};
const logBodyStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
  fontSize: 10,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  opacity: 0.85,
};
