import { of } from "rxjs";
import { describe, expect, it } from "vitest";
import { getTag, isHidden } from "../metadata";
import { hide } from "./hide";
import { tag } from "./tag";

describe("tag", () => {
  it("does not change emissions", () => {
    const values: number[] = [];
    let completed = false;
    of(1, 2, 3)
      .pipe(tag("numbers"))
      .subscribe({
        complete: () => {
          completed = true;
        },
        next: (value) => values.push(value),
      });
    expect(values).toEqual([1, 2, 3]);
    expect(completed).toBe(true);
  });

  it("registers tag metadata without touching the source", () => {
    const source = of(1);
    const tagged = source.pipe(tag("numbers"));
    expect(getTag(tagged)).toBe("numbers");
    expect(getTag(source)).toBeUndefined();
  });
});

describe("hide", () => {
  it("does not change emissions", () => {
    const values: number[] = [];
    of(1, 2).pipe(hide()).subscribe((value) => values.push(value));
    expect(values).toEqual([1, 2]);
  });

  it("registers hidden metadata", () => {
    const source = of(1);
    expect(isHidden(source.pipe(hide()))).toBe(true);
    expect(isHidden(source)).toBe(false);
  });
});
