import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'tr';

const LangContext = createContext<{ lang: Lang; toggle: () => void }>({
  lang: 'en',
  toggle: () => {},
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem('lang');
      if (saved === 'tr' || saved === 'en') return saved;
    } catch {
      // storage can be blocked (private mode, sandboxed embeds)
    }
    return document.documentElement.lang === 'tr' ? 'tr' : 'en';
  });

  useEffect(() => {
    try {
      localStorage.setItem('lang', lang);
    } catch {
      // not persisted; the toggle still works for this visit
    }
    document.documentElement.lang = lang;
  }, [lang]);

  const toggle = () => setLang((l) => (l === 'en' ? 'tr' : 'en'));

  return <LangContext.Provider value={{ lang, toggle }}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}
