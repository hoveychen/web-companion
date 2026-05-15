import { useSyncExternalStore } from 'react';

export interface SettingsState {
  // Profile section
  nickname: string;
  password: string;
  country: string;
  theme: 'light' | 'dark' | 'auto';
  bio: string;

  // Preferences section
  accentColor: string; // hex like #5b6cff
  reminderDate: string; // YYYY-MM-DD

  // Drawer state
  drawerOpen: boolean;

  // Drawer-only fields (settings only reachable after opening drawer)
  notificationsEnabled: boolean;
  apiKey: string;

  // Save log — appended each time `save_profile` fires
  saveLog: Array<{ at: number; snapshot: string }>;
}

const COUNTRIES = [
  { code: 'CN', label: '中国' },
  { code: 'US', label: 'United States' },
  { code: 'JP', label: '日本' },
  { code: 'DE', label: 'Deutschland' },
  { code: 'BR', label: 'Brasil' },
];

const initialState: SettingsState = {
  nickname: 'Hovey',
  password: '',
  country: 'CN',
  theme: 'auto',
  bio: '',
  accentColor: '#5b6cff',
  reminderDate: '',
  drawerOpen: false,
  notificationsEnabled: true,
  apiKey: '',
  saveLog: [],
};

let state: SettingsState = initialState;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

export const settingsStore = {
  getState(): SettingsState {
    return state;
  },
  update<K extends keyof SettingsState>(key: K, value: SettingsState[K]): void {
    state = { ...state, [key]: value };
    emit();
  },
  toggleDrawer(open?: boolean): void {
    state = { ...state, drawerOpen: open ?? !state.drawerOpen };
    emit();
  },
  saveProfile(): void {
    const snapshot = JSON.stringify({
      nickname: state.nickname,
      country: state.country,
      theme: state.theme,
      bio: state.bio,
      accent: state.accentColor,
      reminder: state.reminderDate,
      notif: state.notificationsEnabled,
    });
    state = {
      ...state,
      saveLog: [{ at: Date.now(), snapshot }, ...state.saveLog].slice(0, 8),
    };
    emit();
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useSettings(): SettingsState {
  return useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getState,
    settingsStore.getState,
  );
}

export { COUNTRIES };
