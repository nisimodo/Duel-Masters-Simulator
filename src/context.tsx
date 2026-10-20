import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { backend, type AuthUser } from './backend';
import { profilePath, type Profile } from './data/api';
import { loadCardDB, type CardDB } from './lib/cards';

interface AppState {
  user: AuthUser | null;
  authReady: boolean;
  profile: Profile | null;
  db: CardDB | null;
  dbError: string | null;
}

const Ctx = createContext<AppState>({ user: null, authReady: false, profile: null, db: null, dbError: null });

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [db, setDb] = useState<CardDB | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(
    () =>
      backend.onAuth((u) => {
        setUser(u);
        setAuthReady(true);
      }),
    [],
  );

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    return backend.subscribe<Profile>(profilePath(user.uid), (p) => {
      if (!p) {
        backend.update(profilePath(user.uid), { name: user.name });
        setProfile({ name: user.name });
      } else setProfile(p);
    });
  }, [user]);

  useEffect(() => {
    loadCardDB()
      .then(setDb)
      .catch((e) => setDbError(String(e.message || e)));
  }, []);

  const shownUser = user && profile?.name ? { ...user, name: profile.name } : user;
  return <Ctx.Provider value={{ user: shownUser, authReady, profile, db, dbError }}>{children}</Ctx.Provider>;
}

export const useApp = () => useContext(Ctx);
