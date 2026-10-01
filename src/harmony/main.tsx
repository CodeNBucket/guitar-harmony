import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/archivo-black';
import '@fontsource-variable/space-grotesk';
import '../styles/harmony.css';
import { LangProvider } from '../lib/i18n';
import { HarmonyApp } from './HarmonyApp';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LangProvider>
      <HarmonyApp />
    </LangProvider>
  </React.StrictMode>,
);
