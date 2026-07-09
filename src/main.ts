import './styles.css';
import { installRxjsSpyMcpGlobal } from './debug/registry';
import { registerRxjsSpyMcpDevToolsBridge } from './debug/devtools-bridge';
import { createAppRuntime } from './app/store';
import { renderApp, renderDebugPanel } from './app/view';

installRxjsSpyMcpGlobal();
registerRxjsSpyMcpDevToolsBridge();

const appRoot = document.querySelector<HTMLElement>('#app');
const debugRoot = document.querySelector<HTMLElement>('#debug-panel');

if (!appRoot || !debugRoot) {
  throw new Error('Missing #app or #debug-panel root element.');
}

const runtime = createAppRuntime();

runtime.appState$.subscribe(model => {
  renderApp(model, appRoot, runtime.dispatch);
  renderDebugPanel(debugRoot);
});

window.addEventListener('rxjs-spy-mcp-time-travel', () => {
  renderDebugPanel(debugRoot);
});
