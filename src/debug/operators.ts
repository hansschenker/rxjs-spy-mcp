import { Observable, type OperatorFunction } from 'rxjs';
import { registry, isSpyEnabled } from './registry';
import type { SchedulerTrace } from './types';
import type { SnapshotOptions } from './snapshot';

export interface SpyOperatorOptions extends SnapshotOptions {
  maxFrames?: number;
  scheduler?: SchedulerTrace;
}

export interface MvuTransition<Message, Model> {
  msg: Message;
  model: Model;
}

export function spyOnHeap<T>(tag: string, options: SpyOperatorOptions = {}): OperatorFunction<T, T> {
  return source => {
    if (!isSpyEnabled()) return source;

    return new Observable<T>(subscriber => {
      const id = registry.startSubscription(tag, options.maxFrames);
      let endedByTerminalNotification = false;

      const sourceSubscription = source.subscribe({
        next: value => {
          registry.recordNext(tag, id, value, options, options.scheduler);
          subscriber.next(value);
        },
        error: error => {
          endedByTerminalNotification = true;
          registry.recordError(tag, id, error, options, options.scheduler);
          subscriber.error(error);
        },
        complete: () => {
          endedByTerminalNotification = true;
          registry.recordComplete(tag, id, options.scheduler);
          subscriber.complete();
        }
      });

      return () => {
        sourceSubscription.unsubscribe();

        if (endedByTerminalNotification) {
          registry.endSubscription(tag, id);
        } else {
          registry.recordUnsubscribe(tag, id);
        }
      };
    });
  };
}

export function spyOnMvuLoop<Message, Model>(
  tag: string,
  options: SpyOperatorOptions = {}
): OperatorFunction<MvuTransition<Message, Model>, MvuTransition<Message, Model>> {
  return source => {
    if (!isSpyEnabled()) return source;

    return new Observable<MvuTransition<Message, Model>>(subscriber => {
      const id = registry.startSubscription(tag, options.maxFrames);
      let endedByTerminalNotification = false;

      const sourceSubscription = source.subscribe({
        next: transition => {
          registry.recordMvuTransition(
            tag,
            id,
            transition.msg,
            transition.model,
            options,
            options.scheduler
          );
          subscriber.next(transition);
        },
        error: error => {
          endedByTerminalNotification = true;
          registry.recordError(tag, id, error, options, options.scheduler);
          subscriber.error(error);
        },
        complete: () => {
          endedByTerminalNotification = true;
          registry.recordComplete(tag, id, options.scheduler);
          subscriber.complete();
        }
      });

      return () => {
        sourceSubscription.unsubscribe();

        if (endedByTerminalNotification) {
          registry.endSubscription(tag, id);
        } else {
          registry.recordUnsubscribe(tag, id);
        }
      };
    });
  };
}
