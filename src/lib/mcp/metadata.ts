import { publicOrigin, resourceUrl, SERVER_TITLE } from "./config";
import { mcpJson } from "./http";

/** RFC 9728: what /mcp is and who issues its tokens. */
export function protectedResourceMetadata(req: Request): Response {
  const origin = publicOrigin(req.headers);
  return mcpJson({
    resource: resourceUrl(origin),
    resource_name: SERVER_TITLE,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
    resource_documentation: `${origin}/connectors`,
  });
}

/** RFC 8414: the issuer is the origin, so this sits at /.well-known/oauth-authorization-server. */
export function authorizationServerMetadata(req: Request): Response {
  const origin = publicOrigin(req.headers);
  return mcpJson({
    issuer: origin,
    authorization_endpoint: `${origin}/mcp/oauth/authorize`,
    token_endpoint: `${origin}/mcp/oauth/token`,
    registration_endpoint: `${origin}/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/connectors`,
  });
}
