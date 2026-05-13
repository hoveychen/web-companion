import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ResourceSpec, ToolSpec } from '@web-companion/spec';
import { useCompanion } from './provider.js';
import { ruleBasedDecide, type Decision } from './decide.js';

export type DeciderFn = (
  input: string,
  tools: ToolSpec[],
  resources: ResourceSpec[],
) => Decision | Promise<Decision>;

type TranscriptEntry =
  | { role: 'user'; text: string; ts: number }
  | { role: 'decision'; decision: Decision; ts: number }
  | { role: 'result'; text: string; ts: number }
  | { role: 'error'; text: string; ts: number };

export interface CompanionSidebarProps {
  /** Sidebar width in pixels. Default 360. */
  width?: number;
  /** Initial visibility. Default true. */
  defaultOpen?: boolean;
  /** How the sidebar decides which tool/resource to invoke. Defaults to the keyword-matching stub. */
  decider?: DeciderFn;
}

export function CompanionSidebar({
  width = 360,
  defaultOpen = true,
  decider,
}: CompanionSidebarProps) {
  const { runtime, error, loading } = useCompanion();
  const [open, setOpen] = useState(defaultOpen);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [transcript]);

  async function handleSend(text?: string) {
    const message = (text ?? input).trim();
    if (!message || !runtime || running) return;
    setInput('');
    setRunning(true);

    const userEntry: TranscriptEntry = { role: 'user', text: message, ts: Date.now() };
    setTranscript((prev) => [...prev, userEntry]);

    try {
      const decide = decider ?? ruleBasedDecide;
      const decision = await decide(
        message,
        runtime.listTools(),
        runtime.listResources(),
      );
      setTranscript((prev) => [
        ...prev,
        { role: 'decision', decision, ts: Date.now() },
      ]);

      if (decision.kind === 'tool') {
        const result = await runtime.invokeTool(decision.name, decision.params);
        setTranscript((prev) => [
          ...prev,
          { role: 'result', text: formatResult(result), ts: Date.now() },
        ]);
      } else if (decision.kind === 'resource') {
        const result = await runtime.readResource(decision.name);
        setTranscript((prev) => [
          ...prev,
          { role: 'result', text: formatResult(result), ts: Date.now() },
        ]);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setTranscript((prev) => [
        ...prev,
        { role: 'error', text: errorMessage, ts: Date.now() },
      ]);
    } finally {
      setRunning(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={launcherStyle}
        aria-label="Open Companion"
      >
        ◐
      </button>
    );
  }

  return (
    <aside style={{ ...panelStyle, width }}>
      <header style={headerStyle}>
        <span style={{ fontWeight: 600 }}>Companion</span>
        <span style={statusStyle}>
          {loading ? 'loading…' : error ? 'error' : 'ready'}
        </span>
        <button type="button" onClick={() => setOpen(false)} style={closeBtnStyle}>
          ✕
        </button>
      </header>

      <div ref={scrollRef} style={scrollStyle}>
        {error && <div style={errorStyle}>spec load failed: {error.message}</div>}

        {runtime && transcript.length === 0 && (
          <QuickActions
            toolChips={runtime.listTools().flatMap(expandToolChips)}
            resources={runtime.listResources().map((r) => ({ label: r.name, command: r.name }))}
            onPick={(command) => handleSend(command)}
          />
        )}

        {transcript.map((entry, i) => (
          <TranscriptRow key={i} entry={entry} />
        ))}
        {running && <div style={runningStyle}>running…</div>}
      </div>

      <footer style={footerStyle}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={loading ? 'loading spec…' : 'tell Companion what to do'}
          disabled={!runtime || running}
          style={inputStyle}
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!runtime || running || !input.trim()}
          style={sendBtnStyle}
        >
          ↑
        </button>
      </footer>
    </aside>
  );
}

interface Chip {
  label: string;
  command: string;
}

function QuickActions({
  toolChips,
  resources,
  onPick,
}: {
  toolChips: Chip[];
  resources: Chip[];
  onPick: (command: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Hint text="试试输入一句话，或点下面的快捷动作 ↓" />
      {toolChips.length > 0 && (
        <ChipRow label="tools" items={toolChips} onPick={onPick} accent="indigo" />
      )}
      {resources.length > 0 && (
        <ChipRow label="resources" items={resources} onPick={onPick} accent="emerald" />
      )}
    </div>
  );
}

function ChipRow({
  label,
  items,
  onPick,
  accent,
}: {
  label: string;
  items: Chip[];
  onPick: (command: string) => void;
  accent: 'indigo' | 'emerald';
}) {
  const color = accent === 'indigo' ? 'rgb(99 102 241)' : 'rgb(16 185 129)';
  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => onPick(chip.command)}
            style={{
              background: 'transparent',
              border: `1px solid ${color}`,
              color,
              borderRadius: 999,
              padding: '4px 10px',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * If a tool's required params include exactly one string-enum field, expand it
 * into one chip per enum value so the rule-based decider can extract the param
 * from the chip's command. Otherwise return a single chip with just the name.
 */
function expandToolChips(tool: ToolSpec): Chip[] {
  const single: Chip = { label: tool.name, command: tool.name };
  const p = tool.params;
  if (!p || typeof p !== 'object' || !('type' in p) || p.type !== 'object') {
    return [single];
  }
  const required: string[] = Array.isArray(p.required) ? p.required : [];
  const properties = p.properties as Record<string, unknown>;
  const enumKeys = required.filter((k: string) => {
    const sub = properties[k];
    if (!sub || typeof sub !== 'object' || !('type' in sub) || (sub as { type?: unknown }).type !== 'string') return false;
    const values = (sub as { enum?: unknown }).enum;
    return Array.isArray(values) && values.length > 0;
  });
  if (enumKeys.length !== 1) return [single];
  const key = enumKeys[0]!;
  const values = (properties[key] as { enum: string[] }).enum;
  return values.map((v) => ({
    label: `${tool.name} · ${v}`,
    command: `${tool.name} ${v}`,
  }));
}

function TranscriptRow({ entry }: { entry: TranscriptEntry }) {
  if (entry.role === 'user') {
    return <div style={userMsgStyle}>{entry.text}</div>;
  }
  if (entry.role === 'decision') {
    return <div style={decisionStyle}>· {entry.decision.reason}</div>;
  }
  if (entry.role === 'result') {
    return <pre style={resultStyle}>{entry.text}</pre>;
  }
  return <div style={errorMsgStyle}>{entry.text}</div>;
}

function Hint({ text }: { text: string }) {
  return <div style={{ opacity: 0.6, fontSize: 12 }}>{text}</div>;
}

function formatResult(result: unknown): string {
  if (result === undefined) return '(no return value)';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

const panelStyle: CSSProperties = {
  position: 'fixed',
  top: 16,
  right: 16,
  bottom: 16,
  display: 'flex',
  flexDirection: 'column',
  background: 'rgb(17 17 23)',
  color: 'rgb(229 231 235)',
  borderRadius: 12,
  boxShadow: '0 24px 60px rgba(0,0,0,0.35), 0 4px 12px rgba(0,0,0,0.15)',
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif',
  fontSize: 13,
  overflow: 'hidden',
  zIndex: 2147483640,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '12px 14px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};

const statusStyle: CSSProperties = {
  marginLeft: 'auto',
  fontSize: 11,
  opacity: 0.55,
};

const closeBtnStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  padding: 4,
  fontSize: 14,
  opacity: 0.6,
};

const scrollStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const footerStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: 10,
  borderTop: '1px solid rgba(255,255,255,0.06)',
};

const inputStyle: CSSProperties = {
  flex: 1,
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  color: 'inherit',
  padding: '8px 10px',
  fontFamily: 'inherit',
  fontSize: 13,
  outline: 'none',
};

const sendBtnStyle: CSSProperties = {
  background: 'rgb(99 102 241)',
  color: 'white',
  border: 'none',
  borderRadius: 8,
  width: 36,
  cursor: 'pointer',
  fontWeight: 700,
};

const launcherStyle: CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 16,
  width: 44,
  height: 44,
  borderRadius: '50%',
  background: 'rgb(99 102 241)',
  color: 'white',
  border: 'none',
  fontSize: 18,
  cursor: 'pointer',
  boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
  zIndex: 2147483640,
};

const userMsgStyle: CSSProperties = {
  alignSelf: 'flex-end',
  background: 'rgb(99 102 241)',
  color: 'white',
  padding: '6px 10px',
  borderRadius: 10,
  maxWidth: '80%',
};

const decisionStyle: CSSProperties = {
  fontSize: 11,
  opacity: 0.55,
  fontFamily:
    'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
};

const resultStyle: CSSProperties = {
  background: 'rgba(16,185,129,0.08)',
  border: '1px solid rgba(16,185,129,0.25)',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 12,
  fontFamily:
    'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
  whiteSpace: 'pre-wrap',
  margin: 0,
  overflowX: 'auto',
};

const errorStyle: CSSProperties = {
  background: 'rgba(239,68,68,0.12)',
  border: '1px solid rgba(239,68,68,0.4)',
  borderRadius: 8,
  padding: 10,
  fontSize: 12,
};

const errorMsgStyle: CSSProperties = {
  color: 'rgb(248 113 113)',
  fontSize: 12,
};

const runningStyle: CSSProperties = {
  fontSize: 11,
  opacity: 0.5,
  fontStyle: 'italic',
};
