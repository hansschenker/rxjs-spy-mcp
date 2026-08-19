import { Observable } from "rxjs";
import type { MonoTypeOperatorFunction } from "rxjs";
import { setHidden } from "../metadata";

/**
 * Marks the observable as hidden: the spy ignores subscriptions to it (and
 * the entire synchronous subscription subtree beneath it).
 */
export function hide<T>(): MonoTypeOperatorFunction<T> {
  return (source: Observable<T>): Observable<T> => {
    const hidden = new Observable<T>((subscriber) => source.subscribe(subscriber));
    setHidden(hidden);
    return hidden;
  };
}
