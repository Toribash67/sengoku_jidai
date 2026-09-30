/** A seat invite link, `https://<host>[/prefix]/g/<gameId>#<seatToken>`, split into parts. */
export interface InviteLink {
  baseUrl: string;
  gameId: string;
  token: string;
}

export class LinkError extends Error {}

export function parseInviteLink(raw: string): InviteLink {
  const trimmed = raw.trim().replace(/^["'<]+|["'>]+$/g, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new LinkError(`Not a URL: ${raw.trim()}`);
  }
  const match = /^(.*)\/g\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) {
    throw new LinkError("Expected an invite link like https://host/g/<gameId>#<token>.");
  }
  const token = decodeURIComponent(url.hash.replace(/^#/, ""));
  if (!token) {
    throw new LinkError("The invite link is missing its seat token (the part after #).");
  }
  return {
    baseUrl: `${url.origin}${match[1]}`,
    gameId: decodeURIComponent(match[2]!),
    token
  };
}
