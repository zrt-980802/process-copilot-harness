import { describe, expect, it } from "vitest";
import { loadHomeRecords } from "../src/home-records";

describe("personal home record loading", () => {
  it("bounds concurrent task reads and preserves every record in input order", async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 100 }, (_, index) => index);
    const rows = await loadHomeRecords(tasks, new AbortController().signal, async (task) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, task % 3));
      active--;
      return task * 2;
    });
    expect(peak).toBe(4);
    expect(rows).toEqual(tasks.map((task) => task * 2));
  });

  it("aborts active reads and stops queuing old-account work on refresh replacement", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const cancelled: number[] = [];
    const result = loadHomeRecords([0, 1, 2, 3, 4, 5], controller.signal, (task, signal) => {
      started.push(task);
      return new Promise((_, reject) => signal.addEventListener("abort", () => {
        cancelled.push(task); reject(signal.reason);
      }, { once: true }));
    });
    const rejected = expect(result).rejects.toThrow("replaced");
    controller.abort(new Error("replaced"));
    await rejected;
    expect(started).toEqual([0, 1, 2, 3]);
    expect(cancelled).toEqual(started);
    expect(await loadHomeRecords([9], new AbortController().signal, async (task) => task)).toEqual([9]);
  });

  it("does not accept stale results even when an aborted loader settles successfully", async () => {
    const controller = new AbortController();
    const result = loadHomeRecords([1], controller.signal, async () => {
      controller.abort(new Error("unmounted"));
      return "stale";
    });
    await expect(result).rejects.toThrow("unmounted");
    let reads = 0;
    await expect(loadHomeRecords([1], controller.signal, async () => ++reads)).rejects.toThrow("unmounted");
    expect(reads).toBe(0);
  });
});
