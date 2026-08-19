import type { Observable } from "rxjs";

interface Metadata {
  hidden?: boolean;
  tag?: string;
}

const metadata = new WeakMap<Observable<unknown>, Metadata>();

function write(observable: Observable<unknown>): Metadata {
  let found = metadata.get(observable);
  if (!found) {
    found = {};
    metadata.set(observable, found);
  }
  return found;
}

export function setTag(observable: Observable<unknown>, tag: string): void {
  write(observable).tag = tag;
}

export function getTag(observable: Observable<unknown>): string | undefined {
  return metadata.get(observable)?.tag;
}

export function setHidden(observable: Observable<unknown>): void {
  write(observable).hidden = true;
}

export function isHidden(observable: Observable<unknown>): boolean {
  return metadata.get(observable)?.hidden === true;
}
