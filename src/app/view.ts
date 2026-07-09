import { registry } from '../debug/registry';
import type { Dispatch, Model } from './types';
import { escapeHtml, prettyJson } from './html';

const MAIN_STATE_TAG = 'main-app-state';

export function renderApp(model: Model, container: HTMLElement, dispatch: Dispatch): void {
  container.innerHTML = `
    <div class="card">
      <h1>rxjs-spy-mcp</h1>
      <p class="muted">
        Framework-free RxJS + TypeScript + Elm-like MVU demo. Type <code>error</code> to create a failing async effect.
      </p>

      <label class="label" for="search-input">Search query</label>
      <div class="input-row">
        <input
          id="search-input"
          type="text"
          autocomplete="off"
          value="${escapeHtml(model.searchQuery)}"
          placeholder="Try: rxjs, mvu, scheduler, error"
        />
        <button id="search-button" type="button">Search</button>
      </div>

      <dl class="state-grid">
        <div><dt>Status</dt><dd>${model.isLoading ? 'loading' : 'idle'}</dd></div>
        <div><dt>Active query</dt><dd>${escapeHtml(model.activeQuery ?? '-')}</dd></div>
        <div><dt>Requests</dt><dd>${model.requestCount}</dd></div>
      </dl>

      ${model.errorMessage ? `<div class="error">${escapeHtml(model.errorMessage)}</div>` : ''}
      ${model.isLoading ? '<div class="loading">Scheduled async effect is running...</div>' : ''}

      <h2>Results</h2>
      <ul class="results">
        ${model.results.map(result => `<li>${escapeHtml(result)}</li>`).join('') || '<li class="muted">No results</li>'}
      </ul>
    </div>
  `;

  const input = container.querySelector<HTMLInputElement>('#search-input');
  const button = container.querySelector<HTMLButtonElement>('#search-button');

  if (!input || !button) return;

  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  input.addEventListener('input', () => {
    dispatch({ type: 'SET_QUERY', query: input.value });
  });

  button.addEventListener('click', () => {
    dispatch({ type: 'START_SEARCH', query: input.value });
  });

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      dispatch({ type: 'START_SEARCH', query: input.value });
    }
  });
}

export function renderDebugPanel(container: HTMLElement): void {
  const record = registry.inspectStream(MAIN_STATE_TAG);

  if (!record) {
    container.innerHTML = '<div class="debug-card">No debug frames yet.</div>';
    return;
  }

  container.innerHTML = `
    <div class="debug-card">
      <h2>Heap Debug Timeline</h2>
      <p class="muted">
        These frames are also readable from <code>window.__RXJS_SPY_MCP__</code> and Chrome DevTools MCP.
      </p>

      <div class="summary">
        <span>Status: <strong>${escapeHtml(record.status)}</strong></span>
        <span>Subscribers: <strong>${record.subscriberCount}</strong></span>
        <span>Frames: <strong>${record.historySize}</strong></span>
      </div>

      <div class="frames">
        ${record.history
          .map((frame, index) => {
            const selected = index === record.selectedIndex;
            return `
              <button class="frame ${selected ? 'selected' : ''}" data-index="${index}" type="button">
                <span class="frame-head">
                  <strong>#${index} ${escapeHtml(frame.kind)}</strong>
                  <small>${escapeHtml(frame.elapsedMs)} ms</small>
                </span>
                ${frame.kind === 'mvu-transition' ? `<code>${escapeHtml(String((frame.action as { type?: string } | undefined)?.type ?? 'unknown action'))}</code>` : ''}
                <pre>${prettyJson(frame.kind === 'mvu-transition' ? { action: frame.action, resultingState: frame.resultingState } : frame)}</pre>
              </button>
            `;
          })
          .join('')}
      </div>
    </div>
  `;

  container.querySelectorAll<HTMLButtonElement>('.frame').forEach(button => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.index);
      window.jumpToStep?.(index);
    });
  });
}
