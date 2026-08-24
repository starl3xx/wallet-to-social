/**
 * One-click install paths for the MCP server.
 *
 * Both of these embed a live API key, so both are built in the browser at the
 * one moment the plaintext key exists: immediately after creation, on the same
 * screen that already shows it. The key is never stored, never re-derivable
 * (only a hash is kept), and never travels to a server in either of these
 * forms. A `cursor://` link is handled by the local application and is not
 * fetched, so nothing here puts a key in an HTTP request, a referer or a log.
 *
 * Kept out of the component so the encoding can be read, and corrected, without
 * reading JSX.
 */

/** The one public address of the server. */
export const MCP_URL = 'https://walletlink.social/api/mcp';

/** The name the server is installed under. Short, and the same in both paths. */
export const MCP_SERVER_NAME = 'walletlink';

/**
 * base64 of a UTF-8 string, without assuming Node.
 *
 * `btoa` alone throws on any code point above U+00FF. An API key is ASCII, so
 * that cannot happen today, and encoding it correctly costs three lines that
 * will still be right if this is ever handed something else.
 */
function base64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The Cursor install deeplink.
 *
 * Format is `cursor://anysphere.cursor-deeplink/mcp/install?name=…&config=…`,
 * where `config` is base64 of the server config object **on its own**, not
 * wrapped in the `mcpServers` map that the file format uses. Passing the
 * wrapped shape produces a link that installs an empty server.
 */
export function cursorInstallLink(apiKey: string): string {
  const config = base64(
    JSON.stringify({
      url: MCP_URL,
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  );
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_NAME}&config=${encodeURIComponent(config)}`;
}

/**
 * The Claude Code one-liner.
 *
 * Installs into the current project. Add `-s user` to make it available in
 * every project instead, which is what most people want for a hosted service
 * but is not the default, and is not something to choose on somebody's behalf.
 */
export function claudeCodeCommand(apiKey: string): string {
  return `claude mcp add --transport http ${MCP_SERVER_NAME} ${MCP_URL} --header "Authorization: Bearer ${apiKey}"`;
}

/** The config file block, for a client that takes neither of the above. */
export function mcpJsonBlock(apiKey: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'http',
          url: MCP_URL,
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      },
    },
    null,
    2
  );
}
