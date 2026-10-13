// Streamable HTTP endpoint (stateless): one server per request, JSON responses (D20).
import type { ApiClient } from "@m2m-monster/sdk";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./server.js";

/** `apiFor` receives the caller's bearer api_key, if any, and returns an API client for it. */
export function mcpHttpHandler(apiFor: (apiKey: string | undefined) => ApiClient) {
  return async (request: Request): Promise<Response> => {
    const apiKey = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || undefined;
    const server = createMcpServer(apiFor(apiKey));
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  };
}
