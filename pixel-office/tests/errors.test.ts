// CR-003 F-01/F-02: error mapping — P2002 -> 409 (generic, no schema leak),
// TooManyRequests -> 429 + Retry-After. Plus the existing taxonomy stays intact.
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import {
  toErrorResponse,
  TooManyRequests,
  NotFound,
  BadRequest,
} from "@/lib/api/errors";

describe("toErrorResponse — Prisma P2002 -> 409", () => {
  it("maps a unique-constraint violation to 409 with a GENERIC message", async () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`email`)",
      { code: "P2002", clientVersion: "6.0.0", meta: { target: ["email"] } },
    );
    const res = toErrorResponse(err);
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toBe("Duplicate resource");
    // Must NOT leak the constraint/column names.
    expect(JSON.stringify(body).toLowerCase()).not.toContain("email");
    expect(JSON.stringify(body).toLowerCase()).not.toContain("constraint");
  });
});

describe("toErrorResponse — TooManyRequests -> 429 + Retry-After", () => {
  it("sets status 429 and the Retry-After header (seconds)", async () => {
    const res = toErrorResponse(new TooManyRequests(42));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
  });
  it("floors Retry-After to at least 1 second", () => {
    const res = toErrorResponse(new TooManyRequests(0));
    expect(res.headers.get("Retry-After")).toBe("1");
  });
});

describe("toErrorResponse — existing taxonomy unchanged", () => {
  it("ZodError -> 400", () => {
    const err = new ZodError([]);
    expect(toErrorResponse(err).status).toBe(400);
  });
  it("NotFound -> 404", () => {
    expect(toErrorResponse(new NotFound()).status).toBe(404);
  });
  it("BadRequest -> 400", () => {
    expect(toErrorResponse(new BadRequest()).status).toBe(400);
  });
  it("unknown -> 500", () => {
    expect(toErrorResponse(new Error("boom")).status).toBe(500);
  });
});
