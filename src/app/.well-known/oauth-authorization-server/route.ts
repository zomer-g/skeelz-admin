import { preflight } from "@/lib/mcp/http";
import { authorizationServerMetadata } from "@/lib/mcp/metadata";

export const dynamic = "force-dynamic";

export const GET = authorizationServerMetadata;
export const OPTIONS = preflight;
