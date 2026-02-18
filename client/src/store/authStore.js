import { create } from 'zustand';
import api from '../lib/api';

const TOKEN_KEY = 'job_tracker_token';
const USER_KEY = 'job_tracker_user';

export const useAuthStore = create((set, get) => ({
  user: null,
  token: null,
  isReady: false,
  hydrate: async () => {
    if (get().isReady) return;

    const token = localStorage.getItem(TOKEN_KEY);
    const userRaw = localStorage.getItem(USER_KEY);

    if (!token || !userRaw) {
      set({ isReady: true });
      return;
    }

    try {
      // Token presence in localStorage is not trusted until backend confirms the session.
      const response = await api.get('/auth/me');
      set({ user: response.data.user, token, isReady: true });
    } catch (_error) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      set({ user: null, token: null, isReady: true });
    }
  },
  setSession: ({ user, token }) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ user, token, isReady: true });
  },
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ user: null, token: null, isReady: true });
  }
}));
