import { preflight } from "@/lib/mcp/http";
import { protectedResourceMetadata } from "@/lib/mcp/metadata";

export const dynamic = "force-dynamic";

// The same document as ./mcp, for clients that look at the root.
export const GET = protectedResourceMetadata;
export const OPTIONS = preflight;
