import type { PcEventEnvelope } from "@pc/dsh-bridge";

export interface RuntimeEventExporter {
  export(events: readonly PcEventEnvelope[]): Promise<void>;
}

export class HttpRuntimeEventExporter implements RuntimeEventExporter {
  constructor(
    private readonly url: string,
    private readonly secret: string,
    private readonly timeoutMs: number
  ) {}

  async export(events: readonly PcEventEnvelope[]): Promise<void> {
    if (events.length === 0) return;
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pc-event-secret": this.secret
      },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Event ingestion failed with HTTP ${response.status}: ${body.slice(0, 500)}`
      );
    }
  }
}
