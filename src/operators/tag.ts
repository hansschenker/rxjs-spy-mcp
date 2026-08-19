import { Observable } from "rxjs";
import type { MonoTypeOperatorFunction } from "rxjs";
import { setTag } from "../metadata";

/**
 * Attaches a tag to the observable so the spy can identify it. Has no
 * effect on the observable's behavior. Metadata lives in a WeakMap; no
 * `lift`, no properties written onto operator objects.
 */
export function tag<T>(name: string): MonoTypeOperatorFunction<T> {
  return (source: Observable<T>): Observable<T> => {
    const tagged = new Observable<T>((subscriber) => source.subscribe(subscriber));
    setTag(tagged, name);
    return tagged;
  };
}
