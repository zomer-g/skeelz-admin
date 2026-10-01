import { preflight } from "@/lib/mcp/http";
import { protectedResourceMetadata } from "@/lib/mcp/metadata";

export const dynamic = "force-dynamic";

// Where /mcp's 401 points (RFC 9728 §3.1: the resource path after the well-known name).
export const GET = protectedResourceMetadata;
export const OPTIONS = preflight;
