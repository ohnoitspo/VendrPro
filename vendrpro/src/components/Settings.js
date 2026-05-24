import React, { useContext } from 'react';
import { Ctx } from '../App';

export default function Settings() {
  const { setPage, theme, applyTheme } = useContext(Ctx);

  return (
    <div className="page">
      <div className="page-header">
        <h2>Settings</h2>
        <button className="btn btn-ghost btn-sm" onClick={() => setPage('dashboard')}>← Back</button>
      </div>

      <div className="page-body">
        <p className="section-label" style={{ marginBottom:12 }}>Appearance</p>
        <div className="card">
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}>
            <div>
              <p style={{ fontWeight:600,fontSize:'.95rem' }}>Theme</p>
              <p style={{ color:'var(--grey)',fontSize:'.82rem',marginTop:3 }}>
                {theme === 'dark' ? 'Dark mode — navy background' : 'Light mode — white background'}
              </p>
            </div>
            <div className="seg-control" style={{ flexShrink:0 }}>
              <button className={`seg-btn${theme === 'dark' ? ' active' : ''}`}
                onClick={() => applyTheme('dark')}>🌙 Dark</button>
              <button className={`seg-btn${theme === 'light' ? ' active' : ''}`}
                onClick={() => applyTheme('light')}>☀️ Light</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
