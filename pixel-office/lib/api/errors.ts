// HTTP error taxonomy for Route Handlers + a single error->response mapper so every
// handler reports failures consistently (and never leaks stack traces or the
// existence of other tenants' resources).
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { InsufficientQuantityError } from "@/lib/portfolio/cost-basis";
import { redactSecrets } from "@/lib/market-data/redact";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class Unauthorized extends HttpError {
  constructor(message = "Authentication required") {
    super(401, message);
  }
}

// 404 (not 403) on an ownership mismatch — do not leak that the resource exists.
export class NotFound extends HttpError {
  constructor(message = "Not found") {
    super(404, message);
  }
}

export class BadRequest extends HttpError {
  constructor(message = "Bad request", details?: unknown) {
    super(400, message, details);
  }
}

// 429. Carries the Retry-After hint (seconds) so toErrorResponse can emit the
// standard header. Thrown by the rate limiter (lib/api/rate-limit.ts).
export class TooManyRequests extends HttpError {
  constructor(
    readonly retryAfterSeconds: number,
    message = "Too many requests",
  ) {
    super(429, message);
  }
}

/** Map any thrown value to a safe JSON error response. */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: "Validation failed", fieldErrors: err.flatten().fieldErrors },
      { status: 400 },
    );
  }
  if (err instanceof InsufficientQuantityError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  // Rate limit — emit the standard Retry-After header (seconds). Must come before
  // the generic HttpError branch so the header is attached.
  if (err instanceof TooManyRequests) {
    return NextResponse.json(
      { error: err.message },
      {
        status: 429,
        headers: { "Retry-After": String(Math.max(1, err.retryAfterSeconds)) },
      },
    );
  }
  // A unique-constraint violation from Postgres (e.g. duplicate import externalId,
  // duplicate snapshot for a day). Map to 409 with a GENERIC message — never echo
  // the constraint name or the columns, which would leak schema/other-tenant hints.
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    return NextResponse.json({ error: "Duplicate resource" }, { status: 409 });
  }
  if (err instanceof HttpError) {
    return NextResponse.json(
      { error: err.message, ...(err.details ? { details: err.details } : {}) },
      { status: err.status },
    );
  }
  // Redact any secret that a provider/DB error may carry before it reaches logs
  // (which may ship to a third-party aggregator). Still logged — just scrubbed.
  console.error("[api] unhandled error:", redactSecrets(err));
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
