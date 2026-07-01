import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { COMMAND_NAME, STATUS_KEY, resolveTallyPaths } from "./config.ts";
import { TallyController } from "./controller.ts";
import { allDetailLines, detailLines, modelChoiceLabel, statusLines, truncatePlainLine } from "./ui.ts";

async function showLines(ctx: any, lines: string[]): Promise<void> {
  if (ctx.mode === "tui") {
    await ctx.ui.custom((_tui: unknown, theme: any, _kb: unknown, done: (value?: unknown) => void) => {
      return {
        render(width: number): string[] {
          return lines.map((line) => {
            const plain = truncatePlainLine(line, Math.min(width, 88));
            if (line.startsWith("Since:") || line.startsWith("Crumb")) return theme.fg("accent", plain);
            if (line.startsWith("Local") || line.includes("only counts")) return theme.fg("dim", plain);
            return plain;
          });
        },
        invalidate() {},
        handleInput() {
          done(undefined);
        },
      };
    });
    return;
  }

  if (ctx.hasUI) {
    ctx.ui.notify(lines.filter(Boolean).join("\n"), "info");
  }
}

function setStatus(ctx: any, tally: TallyController): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus(STATUS_KEY, tally.footerStatus(ctx.ui.theme));
}

function normalizedCommand(args: string): string {
  return args.trim().replace(/\s+/g, " ");
}

function footerEnabledForCommand(command: string, currentEnabled: boolean): boolean {
  return command === "footer" ? !currentEnabled : command === "footer on";
}

function toksEnabledForCommand(command: string, currentEnabled: boolean): boolean {
  return command === "toks" ? !currentEnabled : command === "toks on";
}

export default function piTally(pi: ExtensionAPI) {
  const paths = resolveTallyPaths();
  const tally = new TallyController(paths);

  pi.registerCommand(COMMAND_NAME, {
    description: "Show local Pi prompt counters",
    handler: async (args, ctx) => {
      const command = normalizedCommand(args);

      if (command === "footer" || command === "footer on" || command === "footer off") {
        const enabled = footerEnabledForCommand(command, await tally.isFooterEnabled());
        await tally.setFooterEnabled(ctx.sessionManager, enabled);
        setStatus(ctx, tally);
        if (ctx.hasUI) ctx.ui.notify(`pi-tally: footer ${enabled ? "enabled" : "disabled"}`, "info");
        return;
      }

      if (command === "toks" || command === "toks on" || command === "toks off") {
        const enabled = toksEnabledForCommand(command, await tally.isToksEnabled());
        await tally.setToksEnabled(ctx.sessionManager, enabled);
        setStatus(ctx, tally);
        if (ctx.hasUI) ctx.ui.notify(`pi-tally: toks meter ${enabled ? "enabled" : "disabled"}`, "info");
        return;
      }

      if (command === "run" || command === "rebuild" || command === "--rebuild") {
        if (ctx.hasUI) ctx.ui.notify("pi-tally: counting local session files...", "info");
        const result = await tally.runBackfill(ctx.sessionManager);
        setStatus(ctx, tally);
        if (ctx.hasUI) ctx.ui.notify(`pi-tally: count complete (${result.skipped} skipped)`, "info");
      } else if (command === "status") {
        const store = await tally.status(ctx.sessionManager);
        await showLines(ctx, statusLines(paths, store));
        setStatus(ctx, tally);
        return;
      } else if (command === "all") {
        const detail = await tally.detail(ctx.sessionManager, false);
        setStatus(ctx, tally);
        await showLines(ctx, allDetailLines(detail.store, detail.activeTreePath, new Date(), modelChoiceLabel(ctx.model)));
        return;
      } else if (command.length > 0) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /tally, /tally all, /tally run, /tally status, /tally footer [on|off], /tally toks [on|off]", "warning");
        return;
      }

      const detail = await tally.detail(ctx.sessionManager, true);
      await showLines(ctx, detailLines(detail.store, detail.activeTreePath, new Date(), modelChoiceLabel(ctx.model), detail.piCrumbsRotationIndex));
      setStatus(ctx, tally);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    await tally.sessionStart(ctx.sessionManager);
    setStatus(ctx, tally);
  });

  pi.on("message_start", async (event, ctx) => {
    if (event.message?.role !== "assistant") return;
    tally.assistantMessageStart(event.message);
    setStatus(ctx, tally);
  });

  pi.on("message_update", async (event, ctx) => {
    if (event.message?.role !== "assistant") return;
    if (tally.assistantMessageUpdate(event.assistantMessageEvent)) setStatus(ctx, tally);
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message?.role === "user") {
      await tally.userMessageEnd(ctx.sessionManager, event.message);
      setStatus(ctx, tally);
      return;
    }

    if (event.message?.role === "assistant") {
      await tally.assistantMessageEnd(ctx.sessionManager, event.message);
      setStatus(ctx, tally);
    }
  });

  pi.on("session_tree", async (_event, ctx) => {
    await tally.sessionTree(ctx.sessionManager);
    setStatus(ctx, tally);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await tally.sessionShutdown(ctx.sessionManager);
  });
}
