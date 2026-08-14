import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, setToken, type Me } from "./api";

type Session = {
  ready: boolean;
  me: Me | null;
  refresh: () => Promise<void>;
  signIn: (token: string, me: Me) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<Session>({
  ready: false, me: null,
  refresh: async () => {}, signIn: async () => {}, signOut: async () => {},
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  const refresh = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) { setMe(null); return; }
      setMe(await api<Me>("/api/me"));
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setReady(true));
  }, [refresh]);

  const signIn = useCallback(async (token: string, meIn: Me) => {
    await setToken(token);
    setMe(meIn);
  }, []);

  const signOut = useCallback(async () => {
    await setToken(null);
    setMe(null);
  }, []);

  return <Ctx.Provider value={{ ready, me, refresh, signIn, signOut }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
