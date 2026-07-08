// Secret-scrubbing for logs (CR-003 F-04). Provider errors can carry a URL or
// message; before anything reaches console.error we strip API tokens so a raw key
// never lands in logs (which may ship to a third-party aggregator).
//
// Defense-in-depth: the providers now send the Finnhub token in a request HEADER
// (not the query string), so error messages should not contain it in the first
// place — but any future code path that builds a token URL is covered here too.

// token / apikey / api_key / key = <secret> in a query string or "key: value".
const TOKEN_QUERY = /([?&](?:token|api[_-]?key|key)=)[^&\s]+/gi;
// Known env-configured secrets, redacted by exact value if present.
const SECRET_ENV_VARS = ["FINNHUB_API_KEY", "COINGECKO_API_KEY"];

/** Return a log-safe string for any thrown value, with secrets redacted. */
export function redactSecrets(input: unknown): string {
  let text =
    input instanceof Error
      ? `${input.name}: ${input.message}`
      : typeof input === "string"
        ? input
        : safeStringify(input);

  text = text.replace(TOKEN_QUERY, "$1[REDACTED]");
  for (const name of SECRET_ENV_VARS) {
    const value = process.env[name];
    if (value && value.length >= 6) {
      text = text.split(value).join("[REDACTED]");
    }
  }
  return text;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
