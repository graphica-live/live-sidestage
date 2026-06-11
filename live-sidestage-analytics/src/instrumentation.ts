export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { resumeAllListeners, ensureAllListenersAlive } = await import("./lib/tiktok-listener");
    await resumeAllListeners().catch((err) =>
      console.error("[instrumentation] resumeAllListeners failed:", err)
    );
    setInterval(async () => {
      await ensureAllListenersAlive().catch((err) =>
        console.error("[instrumentation] ensureAllListenersAlive failed:", err)
      );
    }, 60_000);
  }
}
