import React, { useState, useEffect } from 'react';
import { getSession, getSettings, updateSettings, hasPin } from './utils/storage';
import { pingFunctions } from './utils/api';
import StartShow    from './components/StartShow';
import Dashboard    from './components/Dashboard';
import NewTransaction from './components/NewTransaction';
import Inventory    from './components/Inventory';
import EndOfDay     from './components/EndOfDay';
import Settings     from './components/Settings';
import BottomNav    from './components/BottomNav';
import Toast        from './components/Toast';
import PinScreen    from './components/PinScreen';

export const Ctx = React.createContext(null);
export const APP_VERSION = '1.0.1';

export default function App() {
  const [page,      setPage]     = useState('dashboard');
  const [session,   setSession]  = useState(null);
  const [settings,  setSettings] = useState(getSettings());
  const [toast,     setToast]    = useState(null);
  const [isOnline,  setIsOnline] = useState(navigator.onLine);
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [theme,     setTheme]    = useState(() => getSettings().theme || 'dark');

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  const applyTheme = (t) => { setTheme(t); updateSettings({ theme: t }); };

  useEffect(() => {
    const s = getSession();
    if (s?.active) setSession(s);
    if (navigator.onLine) pingFunctions();
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    const hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;
    const onControllerChange = () => {
      if (!hadController || refreshing) return;
      refreshing = true;
      setToast({ msg: 'Updating to latest version...', type: 'success' });
      setTimeout(() => window.location.reload(), 2000);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  useEffect(() => {
    const on  = () => { setIsOnline(true);  if (navigator.onLine) pingFunctions(); };
    const off = () => setIsOnline(false);
    window.addEventListener('online',  on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const showToast = (msg, type = 'success', ms = 2500) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), ms);
  };

  const refreshSession = () => {
    const s = getSession();
    setSession(s?.active ? s : null);
  };

  const ctx = { session, setSession, settings, setSettings,
                showToast, refreshSession, isOnline, setPage, page, theme, applyTheme };

  // PIN gate
  if (hasPin() && !pinUnlocked) {
    return (
      <Ctx.Provider value={ctx}>
        <PinScreen onUnlock={() => setPinUnlocked(true)} />
        {toast && <Toast {...toast} />}
      </Ctx.Provider>
    );
  }

  // No session → start screen
  if (!session) {
    return (
      <Ctx.Provider value={ctx}>
        <StartShow />
        {toast && <Toast {...toast} />}
      </Ctx.Provider>
    );
  }

  return (
    <Ctx.Provider value={ctx}>
      <div style={{ position: 'fixed', inset: 0, background: 'var(--navy)' }}>
        {!isOnline && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 500,
            background: 'var(--coral-dark)', padding: '6px',
            textAlign: 'center', fontSize: '.75rem', fontWeight: 600 }}>
            📵 Offline — transactions save locally · scanning unavailable
          </div>
        )}
        {page === 'dashboard'                                    && <Dashboard />}
        {(page === 'transaction-type' || page === 'transaction') && <NewTransaction />}
        {page === 'inventory'                                    && <Inventory />}
        {page === 'eod'                                          && <EndOfDay />}
        {page === 'settings'                                     && <Settings />}
        {page !== 'transaction' && <BottomNav page={page} setPage={setPage} version={APP_VERSION} />}
        {toast && <Toast {...toast} />}
      </div>
    </Ctx.Provider>
  );
}
