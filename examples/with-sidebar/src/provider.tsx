import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  CompanionRuntime,
  attachCursor,
  type CursorOptions,
} from '@web-companion/sdk';

interface CompanionContextValue {
  runtime: CompanionRuntime | null;
  error: Error | null;
  loading: boolean;
}

const CompanionContext = createContext<CompanionContextValue>({
  runtime: null,
  error: null,
  loading: true,
});

export interface CompanionProviderProps {
  specUrl?: string;
  cursorOptions?: CursorOptions;
  /** Fired once after the runtime finishes loading the spec. Use this to bridge into other systems (e.g. register tools with WebMCP). */
  onRuntimeReady?: (runtime: CompanionRuntime) => void;
  children: ReactNode;
}

export function CompanionProvider({
  specUrl,
  cursorOptions,
  onRuntimeReady,
  children,
}: CompanionProviderProps) {
  const [runtime, setRuntime] = useState<CompanionRuntime | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const opts = attachCursor(
      specUrl !== undefined ? { specUrl } : {},
      cursorOptions ?? {},
    );
    const rt = new CompanionRuntime(opts);

    rt.load()
      .then(() => {
        if (cancelled) return;
        setRuntime(rt);
        setLoading(false);
        onRuntimeReady?.(rt);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      opts.cursor.unmount();
    };
  }, [specUrl, cursorOptions, onRuntimeReady]);

  return (
    <CompanionContext.Provider value={{ runtime, error, loading }}>
      {children}
    </CompanionContext.Provider>
  );
}

export function useCompanion(): CompanionContextValue {
  return useContext(CompanionContext);
}
