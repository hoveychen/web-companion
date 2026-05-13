import { useSyncExternalStore } from 'react';

export interface CartItem {
  id: string;
  name: string;
  price: number;
  addedAt: number;
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  emoji: string;
}

export const MENU: MenuItem[] = [
  { id: 'latte', name: '拿铁', price: 32, emoji: '🥛' },
  { id: 'mocha', name: '摩卡', price: 35, emoji: '🍫' },
  { id: 'americano', name: '美式', price: 28, emoji: '🌑' },
  { id: 'cappuccino', name: '卡布奇诺', price: 33, emoji: '☕' },
];

const menuById = new Map(MENU.map((m) => [m.id, m]));

let items: CartItem[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const cartStore = {
  getItems(): CartItem[] {
    return items;
  },
  add(id: string) {
    const m = menuById.get(id);
    if (!m) return { ok: false, reason: `unknown item: ${id}` };
    items = [
      ...items,
      { id, name: m.name, price: m.price, addedAt: Date.now() },
    ];
    emit();
    return { ok: true, size: items.length };
  },
  remove(id: string) {
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return { ok: false, reason: 'not in cart' };
    items = [...items.slice(0, idx), ...items.slice(idx + 1)];
    emit();
    return { ok: true, size: items.length };
  },
  checkout() {
    if (items.length === 0) {
      return { ok: false, reason: 'cart is empty' };
    }
    const ordered = items.length;
    const total = items.reduce((sum, i) => sum + i.price, 0);
    items = [];
    emit();
    return { ok: true, ordered, total };
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useCart(): CartItem[] {
  return useSyncExternalStore(
    cartStore.subscribe,
    cartStore.getItems,
    cartStore.getItems,
  );
}

// --- Search store (separate state, same useSyncExternalStore pattern) -----
// Fake async to make wait_for steps meaningful — the results region only
// mounts after this delay elapses, so the DSL's wait_for actually waits.
const SEARCH_DELAY_MS = 200;

export interface SearchState {
  query: string;
  results: MenuItem[];
  searching: boolean;
  hasSearched: boolean;
}

let searchState: SearchState = {
  query: '',
  results: [],
  searching: false,
  hasSearched: false,
};
const searchListeners = new Set<() => void>();
const emitSearch = () => searchListeners.forEach((l) => l());

export const searchStore = {
  getState(): SearchState {
    return searchState;
  },
  setQuery(q: string) {
    searchState = { ...searchState, query: q };
    emitSearch();
  },
  submit() {
    searchState = { ...searchState, searching: true, hasSearched: true };
    emitSearch();
    const q = searchState.query.trim().toLowerCase();
    setTimeout(() => {
      const results = q
        ? MENU.filter(
            (m) => m.id.toLowerCase().includes(q) || m.name.includes(q),
          )
        : [];
      searchState = { ...searchState, results, searching: false };
      emitSearch();
    }, SEARCH_DELAY_MS);
  },
  clear() {
    searchState = { query: '', results: [], searching: false, hasSearched: false };
    emitSearch();
  },
  subscribe(listener: () => void): () => void {
    searchListeners.add(listener);
    return () => {
      searchListeners.delete(listener);
    };
  },
};

export function useSearch(): SearchState {
  return useSyncExternalStore(
    searchStore.subscribe,
    searchStore.getState,
    searchStore.getState,
  );
}
