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
  children: ReactNode;
}

export function CompanionProvider({
  specUrl,
  cursorOptions,
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
  }, [specUrl, cursorOptions]);

  return (
    <CompanionContext.Provider value={{ runtime, error, loading }}>
      {children}
    </CompanionContext.Provider>
  );
}

export function useCompanion(): CompanionContextValue {
  return useContext(CompanionContext);
}
