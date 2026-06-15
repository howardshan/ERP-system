import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { fetchHiddenModules } from '../lib/moduleVisibility';

interface Ctx {
  hidden: Set<string>;
  isVisible: (moduleId: string) => boolean;
  reload: () => void;
  loaded: boolean;
}

const ModuleVisibilityContext = createContext<Ctx>({
  hidden: new Set(),
  isVisible: () => true,
  reload: () => {},
  loaded: false,
});

export function ModuleVisibilityProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    fetchHiddenModules().then(list => { setHidden(new Set(list)); setLoaded(true); });
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Apply the visibility config ONLY in production builds (i.e. the deployed
  // npicmanage site). The local dev server (`npm run dev`) ignores it so
  // developers always see every module regardless of what's hidden on prod.
  const isVisible = useCallback(
    (moduleId: string) => import.meta.env.DEV || !hidden.has(moduleId),
    [hidden],
  );

  return (
    <ModuleVisibilityContext.Provider value={{ hidden, isVisible, reload, loaded }}>
      {children}
    </ModuleVisibilityContext.Provider>
  );
}

export const useModuleVisibility = () => useContext(ModuleVisibilityContext);
