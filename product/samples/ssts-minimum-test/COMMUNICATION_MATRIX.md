# Communication Matrix

| Producer | Consumer | Protocol | Purpose |
|---|---|---|---|
| Payment Service | Reconciliation Worker | HTTPS | Transaction input |
| Reconciliation Worker | PostgreSQL | SQL | Durable state |
| Process Copilot | Resource Store | Internal API | Exact source access |
