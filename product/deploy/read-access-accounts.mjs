import assert from "node:assert/strict";

export async function readAccessAccounts(fetchPage, onPage = async () => {}) {
  const accounts = [];
  const seen = new Set();
  const pageSize = 20;
  let expectedTotal;
  for (let page = 1; ; page++) {
    const response = await fetchPage(`access/accounts?page=${page}&page_size=${pageSize}`);
    assert.equal(response.status, 200, `Account page ${page} failed`);
    const data = response.body?.data;
    assert(Array.isArray(data?.items), "Account page must contain items");
    await onPage({ page, total: data.total, page_size: data.page_size, count: data.items.length,
      ids: data.items.map(account => account.id) });
    assert.equal(data.page, page, "Account page number mismatch");
    assert.equal(data.page_size, pageSize, "Account page size mismatch");
    assert(Number.isSafeInteger(data.total) && data.total >= 0, "Invalid account total");
    expectedTotal ??= data.total;
    assert.equal(data.total, expectedTotal, "Account total changed during scan");
    assert.equal(data.items.length, Math.min(pageSize, Math.max(0, expectedTotal - accounts.length)),
      "Incomplete account page");
    for (const account of data.items) {
      assert(Number.isSafeInteger(account.id) && account.id > 0, "Invalid account ID");
      assert(!seen.has(account.id), "Duplicate account across pages");
      seen.add(account.id); accounts.push(account);
    }
    if (accounts.length === expectedTotal) return accounts;
  }
}
