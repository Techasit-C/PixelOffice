// Typed client for the frozen portfolio API. Thin wrappers over fetch — no state,
// no caching (that lives in the hooks). Every function returns a typed envelope and
// throws ApiError on a non-2xx so callers get one error shape to render.
import type {
  PortfolioListResponse,
  ValuationEnvelope,
  AllocationEnvelope,
  MilestonesEnvelope,
  PerformanceEnvelope,
  TransactionsEnvelope,
  CreateTransactionBody,
  UpdateTransactionBody,
  CreatePortfolioBody,
  TransactionDTO,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors?: Record<string, string[] | undefined>,
  ) {
    super(message);
    this.name = "ApiError";
  }
  /** 401 == no valid session; callers surface a "please sign in" hint. */
  get isUnauthorized() {
    return this.status === 401;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "เครือข่ายมีปัญหา ลองใหม่อีกครั้ง");
  }

  if (!res.ok) {
    let message = `คำขอไม่สำเร็จ (${res.status})`;
    let fieldErrors: Record<string, string[] | undefined> | undefined;
    try {
      const body = (await res.json()) as {
        error?: string;
        fieldErrors?: Record<string, string[] | undefined>;
      };
      if (body?.error) message = body.error;
      fieldErrors = body?.fieldErrors;
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    if (res.status === 401) message = "กรุณาเข้าสู่ระบบก่อนใช้งาน (Please sign in to continue.)";
    throw new ApiError(res.status, message, fieldErrors);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const portfolioApi = {
  list: (signal?: AbortSignal) =>
    request<PortfolioListResponse>("/api/portfolios", { signal }),

  create: (body: CreatePortfolioBody) =>
    request<{ portfolio: { id: string } }>("/api/portfolios", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  valuation: (id: string, signal?: AbortSignal) =>
    request<ValuationEnvelope>(`/api/portfolios/${id}/valuation`, { signal }),

  allocation: (id: string, by: "asset" | "class" = "asset", signal?: AbortSignal) =>
    request<AllocationEnvelope>(
      `/api/portfolios/${id}/allocation?by=${by}`,
      { signal },
    ),

  milestones: (id: string, signal?: AbortSignal) =>
    request<MilestonesEnvelope>(`/api/portfolios/${id}/milestones`, { signal }),

  performance: (id: string, signal?: AbortSignal) =>
    request<PerformanceEnvelope>(`/api/portfolios/${id}/performance`, { signal }),

  transactions: (
    id: string,
    opts: { limit?: number; cursor?: string } = {},
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.cursor) params.set("cursor", opts.cursor);
    const qs = params.toString();
    return request<TransactionsEnvelope>(
      `/api/portfolios/${id}/transactions${qs ? `?${qs}` : ""}`,
      { signal },
    );
  },

  createTransaction: (id: string, body: CreateTransactionBody) =>
    request<{ transaction: TransactionDTO }>(
      `/api/portfolios/${id}/transactions`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  updateTransaction: (id: string, txId: string, body: UpdateTransactionBody) =>
    request<{ transaction: TransactionDTO }>(
      `/api/portfolios/${id}/transactions/${txId}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  deleteTransaction: (id: string, txId: string) =>
    request<{ ok: true }>(`/api/portfolios/${id}/transactions/${txId}`, {
      method: "DELETE",
    }),
};
