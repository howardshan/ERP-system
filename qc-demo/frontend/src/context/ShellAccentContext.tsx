import { createContext, useContext } from 'react';

export type ShellAccent = 'admin' | 'qc';

const ShellAccentContext = createContext<ShellAccent>('admin');

export function ShellAccentProvider({
  accent,
  children,
}: {
  accent: ShellAccent;
  children: React.ReactNode;
}) {
  return <ShellAccentContext.Provider value={accent}>{children}</ShellAccentContext.Provider>;
}

export function useShellAccent(): ShellAccent {
  return useContext(ShellAccentContext);
}
