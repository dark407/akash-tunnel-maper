import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {RootApplicationRouter} from './RootApplicationRouter.tsx';
import {ThemeProvider} from './context/ThemeContext.tsx';
import {initializeDesktopRuntimeBridge} from './engine/desktopBridge.ts';
import './index.css';

initializeDesktopRuntimeBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <RootApplicationRouter />
    </ThemeProvider>
  </StrictMode>,
);
