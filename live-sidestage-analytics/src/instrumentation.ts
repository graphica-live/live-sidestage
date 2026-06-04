export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { resumeAllListeners } = await import("./lib/tiktok-listener");
    await resumeAllListeners().catch((err) =>
      console.error("[instrumentation] resumeAllListeners failed:", err)
    );
  }
}
