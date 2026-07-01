import type { FooterSpeedometer } from "./ui.ts";

function assistantMessageTimestamp(message: unknown): number | undefined {
  const value = (message as { timestamp?: unknown } | undefined)?.timestamp;
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function assistantOutputTokens(message: unknown): number {
  if (!message || typeof message !== "object") return 0;
  const output = ((message as { usage?: { output?: unknown } }).usage)?.output;
  return typeof output === "number" && Number.isFinite(output) && output > 0 ? Math.floor(output) : 0;
}

function assistantDeltaChars(assistantMessageEvent: unknown): number {
  if (!assistantMessageEvent || typeof assistantMessageEvent !== "object") return 0;
  const event = assistantMessageEvent as { delta?: unknown };
  return typeof event.delta === "string" ? Array.from(event.delta).length : 0;
}

function estimatedTokensFromChars(chars: number): number {
  return chars > 0 ? chars / 4 : 0;
}

export interface AssistantResponseEnd {
  startedAt?: number;
  speedometer?: FooterSpeedometer;
}

export class AssistantSpeedTracker {
  private latestAssistantStartMs: number | undefined;
  private liveResponseMeter: { startedAt: number; estimatedTokens: number; lastStatusUpdateMs: number } | undefined;
  private readonly assistantStartByMessageTimestamp = new Map<number, number>();

  start(message: unknown, startedAt = Date.now()): void {
    this.latestAssistantStartMs = startedAt;
    const messageTimestamp = assistantMessageTimestamp(message);
    if (messageTimestamp !== undefined) this.assistantStartByMessageTimestamp.set(messageTimestamp, startedAt);
    this.liveResponseMeter = { startedAt, estimatedTokens: 0, lastStatusUpdateMs: 0 };
  }

  update(assistantMessageEvent: unknown, now = Date.now()): FooterSpeedometer | undefined {
    const chars = assistantDeltaChars(assistantMessageEvent);
    if (chars <= 0) return undefined;

    this.liveResponseMeter ??= { startedAt: this.latestAssistantStartMs ?? now, estimatedTokens: 0, lastStatusUpdateMs: 0 };
    this.liveResponseMeter.estimatedTokens += estimatedTokensFromChars(chars);
    if (now - this.liveResponseMeter.lastStatusUpdateMs < 250) return undefined;

    const elapsedSeconds = Math.max((now - this.liveResponseMeter.startedAt) / 1000, 1);
    const tps = this.liveResponseMeter.estimatedTokens / elapsedSeconds;
    if (tps <= 0) return undefined;

    this.liveResponseMeter.lastStatusUpdateMs = now;
    return { tps, live: true };
  }

  end(message: unknown, endedAt = Date.now()): AssistantResponseEnd {
    const startedAt = this.takeAssistantStart(message);
    const outputTokens = assistantOutputTokens(message);
    let speedometer: FooterSpeedometer | undefined;

    if (outputTokens > 0 && typeof startedAt === "number" && endedAt > startedAt) {
      speedometer = { tps: outputTokens / ((endedAt - startedAt) / 1000) };
    } else if (this.liveResponseMeter && this.liveResponseMeter.estimatedTokens > 0) {
      const elapsedSeconds = Math.max((endedAt - this.liveResponseMeter.startedAt) / 1000, 1);
      speedometer = { tps: this.liveResponseMeter.estimatedTokens / elapsedSeconds };
    }

    this.liveResponseMeter = undefined;
    return {
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(speedometer ? { speedometer } : {}),
    };
  }

  private takeAssistantStart(message: unknown): number | undefined {
    const messageTimestamp = assistantMessageTimestamp(message);
    if (messageTimestamp !== undefined) {
      const startedAt = this.assistantStartByMessageTimestamp.get(messageTimestamp);
      this.assistantStartByMessageTimestamp.delete(messageTimestamp);
      if (startedAt !== undefined) return startedAt;
    }
    return this.latestAssistantStartMs ?? messageTimestamp;
  }
}
