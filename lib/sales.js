// Daily sales maths (mirrors get_daily_sales() in PLANNING.md Part 3 §3.3).
// "Today" is the restaurant's timezone day, not UTC and not the browser's.

export const RESTAURANT_TZ = 'Asia/Karachi';

export function dayKey(date, timeZone = RESTAURANT_TZ) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(date)
  );
}

export function hourOf(date, timeZone = RESTAURANT_TZ) {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(date))
  );
}

export function formatHour(h) {
  const suffix = h < 12 ? 'am' : 'pm';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${suffix}`;
}

export function isToday(date, timeZone = RESTAURANT_TZ) {
  return dayKey(date, timeZone) === dayKey(new Date(), timeZone);
}

export function computeDailySales(orders, { day = dayKey(new Date()), timeZone = RESTAURANT_TZ } = {}) {
  const todays = orders.filter((o) => dayKey(o.created_at, timeZone) === day);
  const valid = todays.filter((o) => o.status !== 'cancelled');

  const gross = valid.reduce((n, o) => n + Number(o.total), 0);
  const collected = valid.filter((o) => o.payment_status === 'paid').reduce((n, o) => n + Number(o.total), 0);
  const itemsSold = valid.reduce((n, o) => n + o.items.reduce((m, i) => m + i.qty, 0), 0);

  const itemMap = new Map();
  for (const o of valid) {
    for (const i of o.items) {
      const cur = itemMap.get(i.name) || { name: i.name, emoji: i.emoji, qty: 0, revenue: 0 };
      cur.qty += i.qty;
      cur.revenue += i.qty * Number(i.price || 0);
      itemMap.set(i.name, cur);
    }
  }
  const topItems = [...itemMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  // Sales by hour: from the first hour with orders (or 12pm) to now / the last order
  const nowHour = hourOf(new Date(), timeZone);
  const hours = valid.map((o) => hourOf(o.created_at, timeZone));
  const first = Math.min(12, ...hours, nowHour);
  const last = Math.max(nowHour, ...hours);
  const byHour = [];
  for (let h = first; h <= last; h++) {
    const inHour = valid.filter((o) => hourOf(o.created_at, timeZone) === h);
    byHour.push({ hour: h, total: inHour.reduce((n, o) => n + Number(o.total), 0), count: inHour.length });
  }

  return {
    day,
    orders: todays,
    orderCount: valid.length,
    gross,
    collected,
    pendingPayment: gross - collected,
    avgOrder: valid.length ? Math.round(gross / valid.length) : 0,
    itemsSold,
    cancelledCount: todays.length - valid.length,
    activeCount: todays.filter((o) => ['pending', 'preparing', 'ready'].includes(o.status)).length,
    topItems,
    byHour,
  };
}
