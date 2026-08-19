const ids = new WeakMap<object, number>();
let nextId = 0;

/**
 * Returns a stable, incrementing numeric id for the given object. Ids are
 * held in a WeakMap; nothing is written onto the object itself.
 */
export function identify(target: object): number {
  let id = ids.get(target);
  if (id === undefined) {
    id = ++nextId;
    ids.set(target, id);
  }
  return id;
}
