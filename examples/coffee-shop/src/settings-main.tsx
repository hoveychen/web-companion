import React from 'react';
import ReactDOM from 'react-dom/client';
import { SettingsPage } from './settings-page.js';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <SettingsPage />
  </React.StrictMode>,
);
