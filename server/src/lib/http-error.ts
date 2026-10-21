/** Error con código HTTP. Se responde como { error: { code, message } }, igual que tenancy-node. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = codeFor(status),
  ) {
    super(message);
  }
}

function codeFor(status: number) {
  switch (status) {
    case 400: return "BAD_REQUEST";
    case 401: return "UNAUTHENTICATED";
    case 403: return "FORBIDDEN";
    case 404: return "NOT_FOUND";
    case 409: return "CONFLICT";
    case 413: return "PAYLOAD_TOO_LARGE";
    case 415: return "UNSUPPORTED_MEDIA_TYPE";
    case 429: return "RATE_LIMITED";
    default: return "INTERNAL_ERROR";
  }
}
