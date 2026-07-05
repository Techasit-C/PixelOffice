export interface TVAlert {
  id: string;
  raw: string;
  symbol?: string;
  action?: string;
  price?: number;
  strategy?: string;
  receivedAt: string;
}

const MAX_ALERTS = 20;

// In-memory only — resets on server restart, and won't be shared across
// serverless instances. Fine for a single dev/self-hosted process; swap for
// a real store (DB, KV, etc.) before relying on this in production.
let alerts: TVAlert[] = [];

export function addAlert(alert: TVAlert) {
  alerts = [alert, ...alerts].slice(0, MAX_ALERTS);
}

export function getAlerts(): TVAlert[] {
  return alerts;
}
