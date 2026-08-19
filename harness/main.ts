import { interval, map, mergeMap, Subject, switchMap, take, throwError, timer } from "rxjs";
import { create } from "../src/index";
import { tag } from "../src/operators";

const spy = create();

const output = document.querySelector<HTMLPreElement>("#output");

function write(line: string): void {
  if (output) {
    output.textContent = `${line}\n${output.textContent ?? ""}`.slice(0, 5000);
  }
}

write(`rxjs-spy ${spy.version} active — __RXJS_SPY__ installed`);

document.querySelector("#clock")?.addEventListener("click", () => {
  interval(1000)
    .pipe(tag("clock"), take(60))
    .subscribe((value) => write(`clock: ${value}`));
  write("clock started");
});

document.querySelector("#search")?.addEventListener("click", () => {
  const queries = new Subject<string>();
  queries
    .pipe(
      tag("search.query"),
      switchMap((query) =>
        timer(250).pipe(
          map(() => `results for "${query}"`),
          tag("search.results"),
        ),
      ),
      tag("search"),
    )
    .subscribe((result) => write(result));
  ["a", "ab", "abc"].forEach((query, index) => {
    setTimeout(() => queries.next(query), index * 400);
  });
  write("search simulation started");
});

document.querySelector("#failing")?.addEventListener("click", () => {
  timer(500)
    .pipe(
      mergeMap(() => throwError(() => new Error("boom"))),
      tag("failing"),
    )
    .subscribe({
      error: (error: unknown) => write(`failing errored: ${String(error)}`),
    });
  write("failing stream started");
});
