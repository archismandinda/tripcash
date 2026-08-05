// 30-day rate line chart: pure geometry (unit-tested) + a small SVG renderer
// with a scrub crosshair + tooltip. Single series → no legend; the sheet
// title names it. Colors come from CSS variables (validated per theme).

// Map a [[date, value], …] series into pixel-space geometry.
export function chartModel(series, w = 340, h = 120, pad = { t: 10, r: 6, b: 18, l: 6 }) {
  const values = series.map(([, v]) => v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || max * 0.001 || 1; // flat series still renders mid-height
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const points = series.map(([date, value], i) => ({
    date,
    value,
    x: pad.l + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW),
    y: pad.t + (1 - (value - min) / span) * innerH,
  }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const baseline = h - pad.b;
  const area = `${path} L${points[points.length - 1].x.toFixed(1)},${baseline} L${points[0].x.toFixed(1)},${baseline} Z`;
  return { points, path, area, min, max, w, h, pad };
}

// Rates span ~0.001 (IDR→USD) to ~25,000 (USD→VND): significant digits, not
// fixed decimals.
export function formatRate(v) {
  if (!Number.isFinite(v)) return "";
  return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 5 }).format(v);
}

const SHORT_DATE = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function renderChart(container, series) {
  const m = chartModel(series);
  const last = m.points[m.points.length - 1];
  container.innerHTML = `
    <svg viewBox="0 0 ${m.w} ${m.h}" class="rate-chart" role="img"
         aria-label="30 day rate history, ${formatRate(m.min)} to ${formatRate(m.max)}">
      <line class="grid" x1="${m.pad.l}" y1="${m.pad.t}" x2="${m.w - m.pad.r}" y2="${m.pad.t}"/>
      <line class="grid" x1="${m.pad.l}" y1="${(m.pad.t + m.h - m.pad.b) / 2}" x2="${m.w - m.pad.r}" y2="${(m.pad.t + m.h - m.pad.b) / 2}"/>
      <line class="grid" x1="${m.pad.l}" y1="${m.h - m.pad.b}" x2="${m.w - m.pad.r}" y2="${m.h - m.pad.b}"/>
      <path class="area" d="${m.area}"/>
      <path class="line" d="${m.path}"/>
      <circle class="dot-end" cx="${last.x}" cy="${last.y}" r="3.5"/>
      <line class="cross" y1="${m.pad.t}" y2="${m.h - m.pad.b}" hidden/>
      <circle class="dot-hover" r="4" hidden/>
      <text class="ax" x="${m.pad.l}" y="${m.h - 5}">${SHORT_DATE(series[0][0])}</text>
      <text class="ax end" x="${m.w - m.pad.r}" y="${m.h - 5}">${SHORT_DATE(last.date)}</text>
    </svg>
    <div class="chart-tip" hidden></div>
  `;
  const svg = container.querySelector("svg");
  const cross = svg.querySelector(".cross");
  const dot = svg.querySelector(".dot-hover");
  const tip = container.querySelector(".chart-tip");

  const showAt = (p) => {
    cross.setAttribute("x1", p.x);
    cross.setAttribute("x2", p.x);
    dot.setAttribute("cx", p.x);
    dot.setAttribute("cy", p.y);
    cross.hidden = dot.hidden = tip.hidden = false;
    tip.textContent = `${SHORT_DATE(p.date)} · ${formatRate(p.value)}`;
    const rect = svg.getBoundingClientRect();
    const leftPx = Math.min(Math.max((p.x / m.w) * rect.width - tip.offsetWidth / 2, 0), rect.width - tip.offsetWidth);
    tip.style.left = `${leftPx}px`;
  };
  const scrub = (e) => {
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * m.w;
    let nearest = m.points[0];
    for (const p of m.points) if (Math.abs(p.x - x) < Math.abs(nearest.x - x)) nearest = p;
    showAt(nearest);
  };
  svg.addEventListener("pointerdown", (e) => {
    scrub(e);
    try { svg.setPointerCapture(e.pointerId); } catch { /* keep scrubbing anyway */ }
  });
  svg.addEventListener("pointermove", scrub);
  // Mouse users get hover-out cleanup back to the latest point; on touch the
  // pointer line stays where the finger left it.
  svg.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") showAt(last);
  });
  // Start with the pointer on the latest point so scrubbing is discoverable.
  showAt(last);
}
