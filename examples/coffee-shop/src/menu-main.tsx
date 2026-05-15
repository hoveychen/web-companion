import React from 'react';
import ReactDOM from 'react-dom/client';
import { MenuPage } from './menu-page.js';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <MenuPage />
  </React.StrictMode>,
);
