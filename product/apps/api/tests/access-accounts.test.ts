import { describe, expect, it } from "vitest";
import { readAccessAccounts } from "../../../deploy/read-access-accounts.mjs";

function page(items: Array<{ id: number }>, total: number, number = 1) {
  return { status: 200, body: { data: { items, total, page: number, page_size: 20 } } };
}

describe("acceptance account pagination", () => {
  it("reads every page beyond the default page boundary without losing old accounts", async () => {
    const accounts = Array.from({ length: 61 }, (_, index) => ({ id: 100 - index }));
    const requests: number[] = [];
    const all = await readAccessAccounts(async (query: string) => {
      const params = new URLSearchParams(query.split("?")[1]);
      const number = Number(params.get("page")); requests.push(number);
      return page(accounts.slice((number - 1) * 20, number * 20), accounts.length, number);
    });
    expect(all).toEqual(accounts);
    expect(requests).toEqual([1, 2, 3, 4]);
  });

  it("rejects missing pages, duplicate IDs and changing totals rather than accepting partial evidence", async () => {
    const first = Array.from({ length: 20 }, (_, index) => ({ id: index + 1 }));
    for (const next of [page([], 21, 2), page([{ id: 1 }], 21, 2), page([{ id: 21 }], 22, 2)]) {
      await expect(readAccessAccounts(async (query: string) => query.includes("page=1&") ? page(first, 21) : next)).rejects.toThrow();
    }
  });

  it("handles empty/exact-boundary lists and rejects failed or malformed responses", async () => {
    expect(await readAccessAccounts(async () => page([], 0))).toEqual([]);
    let requests = 0;
    const first = Array.from({ length: 20 }, (_, index) => ({ id: index + 1 }));
    expect(await readAccessAccounts(async () => { requests++; return page(first, 20); })).toEqual(first);
    expect(requests).toBe(1);
    await expect(readAccessAccounts(async () => ({ status: 403, body: {} }))).rejects.toThrow("failed");
    await expect(readAccessAccounts(async () => ({ status: 200, body: {} }))).rejects.toThrow("items");
  });
});
