import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

let langfuseProcessor: LangfuseSpanProcessor | null = null;

export function initializeTracing(): void {
  if (process.env.LANGFUSE_DISABLED === "true") {
    console.log("[tracing] Disabled by LANGFUSE_DISABLED env var");
    return;
  }

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    console.warn("[tracing] LANGFUSE keys not configured - tracing disabled");
    return;
  }

  langfuseProcessor = new LangfuseSpanProcessor();
  const tracerProvider = new NodeTracerProvider({
    spanProcessors: [langfuseProcessor],
  });
  tracerProvider.register();

  console.log("[tracing] Langfuse tracing initialized");
}

export async function shutdownTracing(): Promise<void> {
  if (langfuseProcessor) {
    await langfuseProcessor.forceFlush();
  }
  console.log("[tracing] Tracing shut down");
}
