import {
  BehaviorSubject,
  Subscription,
  catchError,
  filter,
  map,
  merge,
  of,
  scan,
  shareReplay,
  switchMap,
  timer,
  type Observable
} from 'rxjs';
import { registry } from '../debug/registry';
import { spyOnMvuLoop } from '../debug/operators';
import { update } from './update';
import { initialModel, type Dispatch, type Model, type Msg } from './types';

const MAIN_STATE_TAG = 'main-app-state';

export interface AppRuntime {
  appState$: Observable<Model>;
  dispatch: Dispatch;
  jumpToStep(index: number): void;
  destroy(): void;
}

export function createAppRuntime(): AppRuntime {
  // BehaviorSubject makes the initial runtime message explicit.
  // That means a fresh subscription always sees INIT and the debugger always records an initial frame.
  const msg$ = new BehaviorSubject<Msg>({ type: 'INIT' });
  const visualTimeTravel$ = new BehaviorSubject<Model | null>(null);

  const transition$ = msg$.pipe(
    scan(
      (acc, msg) => ({
        msg,
        model: update(acc.model, msg)
      }),
      { msg: { type: 'INIT' } satisfies Msg, model: initialModel }
    ),
    spyOnMvuLoop<Msg, Model>(MAIN_STATE_TAG, { maxFrames: 80 }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  const model$ = transition$.pipe(
    map(transition => transition.model),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  const appState$ = merge(
    model$,
    visualTimeTravel$.pipe(filter((model): model is Model => model !== null))
  ).pipe(shareReplay({ bufferSize: 1, refCount: true }));

  const dispatch: Dispatch = msg => msg$.next(msg);

  const searchEffectSubscription = msg$
    .pipe(
      filter((msg): msg is Extract<Msg, { type: 'START_SEARCH' }> => msg.type === 'START_SEARCH'),
      switchMap(msg =>
        timer(800).pipe(
          map(() => searchDatabase(msg.query)),
          map(results => ({ type: 'SEARCH_SUCCESS', query: msg.query, results }) satisfies Msg),
          catchError((error: unknown) =>
            of({
              type: 'SEARCH_FAILURE',
              query: msg.query,
              error: errorToMessage(error)
            } satisfies Msg)
          )
        )
      )
    )
    .subscribe(dispatch);

  const subscriptions = new Subscription();
  subscriptions.add(searchEffectSubscription);

  const jumpToStep = (index: number): void => {
    const record = registry.inspectStream(MAIN_STATE_TAG);
    const frame = record?.history[index];

    if (!frame || frame.kind !== 'mvu-transition' || !frame.resultingState) {
      return;
    }

    registry.selectFrame(MAIN_STATE_TAG, index);
    visualTimeTravel$.next(frame.resultingState as Model);
    window.dispatchEvent(new CustomEvent('rxjs-spy-mcp-time-travel'));
  };

  window.jumpToStep = jumpToStep;

  return {
    appState$,
    dispatch,
    jumpToStep,
    destroy: () => {
      subscriptions.unsubscribe();
      msg$.complete();
      visualTimeTravel$.complete();
      delete window.jumpToStep;
    }
  };
}

function searchDatabase(query: string): string[] {
  const normalized = query.trim().toLowerCase();

  if (normalized === 'error') {
    throw new Error('Simulated asynchronous search failure');
  }

  const database = [
    'RxJS Observable runtime',
    'Subscription graph',
    'Notification timeline',
    'Chrome DevTools MCP bridge',
    'Elm-like MVU loop',
    'Time-travel state debugging',
    'Scheduler-aware debugging model',
    'switchMap cancellation policy',
    'scan state reducer',
    'shareReplay state cache'
  ];

  if (!normalized) return database.slice(0, 5);

  return database.filter(item => item.toLowerCase().includes(normalized));
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
