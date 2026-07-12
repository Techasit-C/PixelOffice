import { Row } from "./Row";
import { formatCompactCurrency, signColor } from "@/lib/utils";
import type { CompanyStatusData } from "@/lib/mock-data";

export function CompanyStatusWidget({ data }: { data: CompanyStatusData }) {
  const spotBalances = data.mexc?.spot.balances ?? [];
  const spotOrders = data.mexc?.spot.openOrders ?? [];
  const futures = data.mexc?.futures;
  const futuresPositions = futures?.positions ?? [];
  const futuresOrders = futures?.openOrders ?? [];
  return (
    <div>
      <Row
        label="Realized PnL"
        value={formatCompactCurrency(data.realizedPnl)}
        valueClassName={signColor(data.realizedPnl)}
      />
      <Row
        label="Total PnL"
        value={formatCompactCurrency(data.totalPnl)}
        valueClassName={signColor(data.totalPnl)}
      />
      <Row
        label="Net Cashflow"
        value={formatCompactCurrency(data.netCashflow)}
        valueClassName="text-success"
      />
      
      <div className="border-t border-white/10 pt-2">
  <div className="mb-1 flex items-center justify-between">
    <span className="text-muted-foreground">SPOT</span>
    <span className="rounded-sm bg-emerald-500/15 px-1 text-[10px] text-emerald-300">
      {data.mexc?.spot.source ?? "unavailable"}
    </span>
  </div>

  {spotBalances.length > 0 ? (
    <div className="space-y-1">
      {spotBalances.map((balance) => (
        <div key={balance.asset} className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{balance.asset}</span>
          <span className="font-mono text-foreground">{balance.total}</span>
        </div>
      ))}
    </div>
  ) : (
    <div className="text-xs text-muted-foreground">ไม่มี SPOT balance</div>
  )}

  <div className="mt-2 text-xs text-muted-foreground">SPOT Orders</div>
  {spotOrders.length > 0 ? (
    <div className="space-y-1">
      {spotOrders.map((order) => (
        <div
          key={`${order.symbol}-${order.side}-${order.price}-${order.origQty}`}
          className="flex items-center justify-between text-xs"
        >
          <span className="text-muted-foreground">
            {order.symbol} {order.side}
          </span>
          <span className="font-mono text-foreground">
            {order.origQty} @ {order.price}
          </span>
        </div>
      ))}
    </div>
  ) : (
    <div className="text-xs text-muted-foreground">ไม่มี SPOT open orders</div>
  )}
</div>

<div className="border-t border-white/10 pt-2">
  <div className="mb-1 flex items-center justify-between">
    <span className="text-muted-foreground">FUTURES</span>
    <span className="rounded-sm bg-white/5 px-1 text-[10px] text-muted-foreground">
      {futures?.source ?? "unavailable"}
    </span>
  </div>

  {futures?.source === "live" ? (
    <div className="space-y-1 text-xs">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Wallet</span>
        <span className="font-mono text-foreground">{futures.walletBalance}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Available</span>
        <span className="font-mono text-foreground">{futures.availableBalance}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">uPnL</span>
        <span className="font-mono text-foreground">{futures.unrealizedPnl}</span>
      </div>

      <div className="mt-2 text-muted-foreground">Positions</div>
      {futuresPositions.length > 0 ? (
        <div className="space-y-1">
          {futuresPositions.map((position) => (
            <div
              key={`${position.symbol}-${position.side}-${position.entryPrice}`}
              className="flex items-center justify-between"
            >
              <span className="text-muted-foreground">
                {position.symbol} {position.side}
              </span>
              <span className="font-mono text-foreground">
                {position.size} @ {position.entryPrice}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground">ไม่มี FUTURES position</div>
      )}

      <div className="mt-2 text-muted-foreground">Open Orders</div>
      {futuresOrders.length > 0 ? (
        <div className="space-y-1">
          {futuresOrders.map((order) => (
            <div
              key={`${order.symbol}-${order.side}-${order.price}-${order.vol}`}
              className="flex items-center justify-between"
            >
              <span className="text-muted-foreground">
                {order.symbol} {order.side}
              </span>
              <span className="font-mono text-foreground">
                {order.vol} @ {order.price}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground">ไม่มี FUTURES open orders</div>
      )}
    </div>
  ) : (
    <div className="text-xs text-muted-foreground">FUTURES unavailable</div>
  )}
</div>
      <Row label="APY" value={`${data.apy.toFixed(1)}%`} />
      <Row label="Safe Withdraw" value={`$${data.safeWithdraw}`} />
      <div className="mt-2 text-[10px] text-muted-foreground">
        อัปเดต {data.updatedAt}
      </div>
    </div>
  );
}
