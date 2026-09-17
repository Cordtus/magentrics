import {
  buildDashboardData,
  buildMultiUserDashboardData,
  exportDateRange,
  filterExport,
} from "./dashboard-core.js";

// The packaged build ships the same data/latest.json + data/snapshots layout,
// so this path is identical in development and in the shared copy. A missing
// pointer (fresh checkout, never refreshed) just means the dashboard is empty.
async function loadBundledSnapshot() {
  try {
    const response = await fetch("data/latest.json", { cache: "no-store" });
    if (!response.ok) return null;
    const pointer = await response.json();
    if (!pointer || typeof pointer.snapshot !== "string") return null;
    await import(new URL(`data/${pointer.snapshot}`, import.meta.url).href);
    return globalThis.CODEX_USAGE_DATA || null;
  } catch (_error) {
    return null;
  }
}

const bundledData = await loadBundledSnapshot();

(function () {
  const COLORS = {
    accent: "#55e3c3",
    blue: "#82aaff",
    amber: "#f0bf73",
    violet: "#b49af5",
    rose: "#e78ac3",
    grid: "rgba(48, 67, 76, 0.48)",
    text: "#b2c0c0",
    muted: "#78898c",
  };

  const formatters = {
    currency: new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    compact: new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    }),
    integer: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }),
    percent: new Intl.NumberFormat("en-US", {
      style: "percent",
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }),
    date: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }),
    month: new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }),
  };

  const elements = {
    body: document.body,
    dashboard: document.getElementById("dashboard"),
    emptyState: document.getElementById("empty-state"),
    rangePanel: document.getElementById("range-panel"),
    rangeStart: document.getElementById("range-start"),
    rangeEnd: document.getElementById("range-end"),
    rangeReset: document.getElementById("range-reset"),
    sourceRow: document.getElementById("source-row"),
    sourceToggles: document.getElementById("source-toggles"),

    summaryGrid: document.getElementById("summary-grid"),
    userDetailControl: document.getElementById("user-detail-control"),
    userDetailSelect: document.getElementById("user-detail-select"),
    userComparisonSection: document.getElementById("user-comparison-section"),
    userComparisonDataBody: document.getElementById("user-comparison-data-body"),
    modelTableBody: document.getElementById("model-table-body"),
    monthlyTableBody: document.getElementById("monthly-table-body"),
    timelineDataBody: document.getElementById("timeline-data-body"),
    timelinePeriodHeading: document.getElementById("timeline-period-heading"),
    compositionDataBody: document.getElementById("composition-data-body"),
    cumulativeDataBody: document.getElementById("cumulative-data-body"),
    fileInput: document.getElementById("file-input"),
    launcherButton: document.getElementById("launcher-button"),
    launcherDialog: document.getElementById("launcher-dialog"),
    launcherClose: document.getElementById("launcher-close"),
    errorRegion: document.getElementById("error-region"),
    errorTitle: document.getElementById("error-title"),
    errorMessage: document.getElementById("error-message"),
    dismissError: document.getElementById("dismiss-error"),
    chartStatus: document.getElementById("chart-status"),
    dropOverlay: document.getElementById("drop-overlay"),
    granularityToggle: document.getElementById("granularity-toggle"),
    scaleToggle: document.getElementById("scale-toggle"),
    timelineCanvas: document.getElementById("timeline-chart"),
    timelineFallback: document.getElementById("timeline-fallback"),
    userComparisonCanvas: document.getElementById("user-comparison-chart"),
    userComparisonFallback: document.getElementById("user-comparison-fallback"),
    compositionCanvas: document.getElementById("composition-chart"),
    compositionFallback: document.getElementById("composition-fallback"),
    modelsCanvas: document.getElementById("models-chart"),
    modelsFallback: document.getElementById("models-fallback"),
    monthlyCanvas: document.getElementById("monthly-chart"),
    monthlyFallback: document.getElementById("monthly-fallback"),
    cumulativeCanvas: document.getElementById("cumulative-chart"),
    cumulativeFallback: document.getElementById("cumulative-fallback"),
  };

  const state = {
    model: null,
    source: null,
    bundle: null,
    detailId: null,
    granularity: "daily",
    tokenScale: "logarithmic",
    charts: Object.create(null),
    chartFailures: new Set(),
    metricNodes: new Map(),
    sources: null,
    selectedIds: null,
    rawSingle: null,
    bounds: null,
    range: { start: null, end: null },
    dragDepth: 0,
    loadSequence: 0,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };

  function parseUTCDate(value) {
    if (typeof value !== "string") return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(value) {
    const date = parseUTCDate(value);
    return date ? formatters.date.format(date) : "—";
  }

  function formatMonth(value) {
    const date = parseUTCDate(`${value}-01`);
    return date ? formatters.month.format(date) : value;
  }

  function formatCompact(value) {
    return formatters.compact.format(Number(value) || 0);
  }

  function formatInteger(value) {
    return formatters.integer.format(Number(value) || 0);
  }

  function formatCurrency(value) {
    return formatters.currency.format(Number(value) || 0);
  }

  function formatPercent(value) {
    return formatters.percent.format(Number(value) || 0);
  }

  function setLoading(isLoading) {
    elements.launcherButton.classList.toggle("is-loading", isLoading);
    elements.fileInput.disabled = isLoading;
    elements.body.setAttribute("aria-busy", String(isLoading));
  }

  function clearError() {
    elements.errorRegion.hidden = true;
    elements.errorMessage.textContent = "";
  }

  function showError(title, message, focus) {
    elements.errorTitle.textContent = title;
    elements.errorMessage.textContent = message;
    elements.errorRegion.hidden = false;
    if (focus) elements.errorRegion.focus({ preventScroll: false });
  }

  function errorDetail(error) {
    if (error && typeof error.message === "string") {
      return error.message.replace(/\s+/g, " ").trim();
    }
    return "This is not a compatible usage JSON file.";
  }

  function retentionMessage() {
    return state.model
      ? " Your current data is unchanged."
      : " Load or drop a compatible usage JSON file.";
  }

  // ponytail: 700ms count-up; add a shared timeline only if cards get staggered.
  function animateValue(element, from, to, format) {
    if (state.reducedMotion || !Number.isFinite(from) || from === to) {
      element.textContent = format(to);
      return;
    }
    const startedAt = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - startedAt) / 700);
      const eased = 1 - (1 - progress) ** 3;
      element.textContent = format(from + (to - from) * eased);
      if (progress < 1) requestAnimationFrame(step);
      else element.textContent = format(to);
    };
    requestAnimationFrame(step);
  }

  function makeMetric(metric) {
    let node = state.metricNodes.get(metric.label);
    if (!node || !node.wrapper.isConnected) {
      const wrapper = document.createElement("div");
      wrapper.className = "metric";

      const term = document.createElement("dt");
      term.textContent = metric.label;

      const description = document.createElement("dd");
      const valueElement = document.createElement("span");
      valueElement.className = "metric-value";

      const note = document.createElement("small");

      description.append(valueElement, note);
      wrapper.append(term, description);
      node = { wrapper, valueElement, note, previous: metric.raw };
      state.metricNodes.set(metric.label, node);
    }

    node.note.textContent = metric.detail;
    if (metric.exact) node.valueElement.title = metric.exact;
    else node.valueElement.removeAttribute("title");

    animateValue(node.valueElement, node.previous, metric.raw, metric.format);
    node.previous = metric.raw;
    return node.wrapper;
  }

  function renderSummary(summary) {
    const outputShare = summary.outputTokens > 0
      ? summary.reasoningOutputTokens / summary.outputTokens
      : 0;

    const metrics = [
      {
        label: "Estimated cost",
        raw: summary.costUSD,
        format: formatCurrency,
        detail: "Estimated by ccusage",
        exact: String(summary.costUSD),
      },
      {
        label: "Total tokens",
        raw: summary.totalTokens,
        format: formatCompact,
        detail: `${formatCompact(summary.inputTokens)} input`,
        exact: formatInteger(summary.totalTokens),
      },
      {
        label: "Output tokens",
        raw: summary.outputTokens,
        format: formatCompact,
        detail: "Reasoning included",
        exact: formatInteger(summary.outputTokens),
      },
      {
        label: "Reasoning tokens",
        raw: summary.reasoningOutputTokens,
        format: formatCompact,
        detail: `${formatPercent(outputShare)} of output`,
        exact: formatInteger(summary.reasoningOutputTokens),
      },
      {
        label: "Cache-read tokens",
        raw: summary.cacheReadTokens,
        format: formatCompact,
        detail: `${formatPercent(summary.cacheReadShare)} of total`,
        exact: formatInteger(summary.cacheReadTokens),
      },
      {
        label: "Active days",
        raw: summary.recordedDays,
        format: formatInteger,
        detail: `${formatDate(summary.dateStart)} – ${formatDate(summary.dateEnd)}`,
        exact: null,
      },
    ];

    elements.summaryGrid.replaceChildren(...metrics.map(makeMetric));
  }

  function makeCell(value, options) {
    const settings = options || {};
    const cell = document.createElement(settings.header ? "th" : "td");
    cell.textContent = value;
    if (settings.header) cell.scope = "row";
    if (settings.className) cell.className = settings.className;
    if (settings.title) cell.title = settings.title;
    return cell;
  }

  function renderModelTable(models) {
    if (!models.length) {
      const row = document.createElement("tr");
      const cell = makeCell("No model data.", { className: "table-empty" });
      cell.colSpan = 6;
      row.append(cell);
      elements.modelTableBody.replaceChildren(row);
      return;
    }

    const rows = models.map((model) => {
      const row = document.createElement("tr");
      const fallbackCell = makeCell(formatInteger(model.fallbackOccurrences), {
        className: "fallback-count",
      });
      fallbackCell.dataset.hasFallback = String(model.fallbackOccurrences > 0);
      row.append(
        makeCell(model.model, { header: true, className: "model-name" }),
        makeCell(formatCompact(model.totalTokens), { title: formatInteger(model.totalTokens) }),
        makeCell(formatCompact(model.outputTokens), { title: formatInteger(model.outputTokens) }),
        makeCell(formatCompact(model.reasoningOutputTokens), {
          title: `${formatInteger(model.reasoningOutputTokens)} (included in output)`,
        }),
        makeCell(formatInteger(model.recordedDays)),
        fallbackCell,
      );
      return row;
    });

    elements.modelTableBody.replaceChildren(...rows);
  }

  function renderMonthlyTable(monthly) {
    if (!monthly.length) {
      const row = document.createElement("tr");
      const cell = makeCell("No monthly data.", { className: "table-empty" });
      cell.colSpan = 7;
      row.append(cell);
      elements.monthlyTableBody.replaceChildren(row);
      return;
    }

    const rows = monthly.map((month) => {
      const row = document.createElement("tr");
      row.append(
        makeCell(formatMonth(month.month), { header: true, className: "month-name" }),
        makeCell(formatCurrency(month.costUSD), { title: String(month.costUSD) }),
        makeCell(formatCompact(month.totalTokens), { title: formatInteger(month.totalTokens) }),
        makeCell(formatCompact(month.outputTokens), { title: formatInteger(month.outputTokens) }),
        makeCell(formatCompact(month.reasoningOutputTokens), {
          title: `${formatInteger(month.reasoningOutputTokens)} (included in output)`,
        }),
        makeCell(formatPercent(month.cacheReadShare)),
        makeCell(formatInteger(month.recordedDays)),
      );
      return row;
    });

    elements.monthlyTableBody.replaceChildren(...rows);
  }

  function renderTimelineData(rows, isWeekly) {
    elements.timelinePeriodHeading.textContent = isWeekly ? "Week starting" : "Date";
    const dateKey = isWeekly ? "weekStart" : "date";
    const tableRows = rows.map((period) => {
      const row = document.createElement("tr");
      row.append(
        makeCell(formatDate(period[dateKey]), { header: true, className: "month-name" }),
        makeCell(formatCurrency(period.costUSD)),
        makeCell(formatInteger(period.totalTokens)),
        makeCell(formatInteger(isWeekly ? period.recordedDays : 1)),
      );
      return row;
    });
    elements.timelineDataBody.replaceChildren(...tableRows);
  }

  function renderCompositionData(daily) {
    const rows = daily.map((day) => {
      const row = document.createElement("tr");
      row.append(
        makeCell(formatDate(day.date), { header: true, className: "month-name" }),
        makeCell(formatInteger(day.inputTokens)),
        makeCell(formatInteger(day.outputTokens)),
        makeCell(formatInteger(day.reasoningOutputTokens)),
        makeCell(formatInteger(day.cacheReadTokens)),
        makeCell(formatInteger(day.cacheCreationTokens)),
      );
      return row;
    });
    elements.compositionDataBody.replaceChildren(...rows);
  }

  function renderCumulativeData(cumulative) {
    const rows = cumulative.map((period) => {
      const row = document.createElement("tr");
      row.append(
        makeCell(formatDate(period.date), { header: true, className: "month-name" }),
        makeCell(formatCurrency(period.costUSD)),
        makeCell(formatInteger(period.totalTokens)),
      );
      return row;
    });
    elements.cumulativeDataBody.replaceChildren(...rows);
  }

  function updateHeader(summary, detailName) {
    document.title = `AI Usage · ${detailName} · ${formatDate(summary.latestDate || summary.dateEnd)}`;
  }

  function chartAnimation() {
    return state.reducedMotion ? false : { duration: 900, easing: "easeInOutQuart" };
  }

  function commonChartOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      normalized: true,
      animation: chartAnimation(),
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "top",
          align: "start",
          labels: {
            color: COLORS.text,
            usePointStyle: true,
            pointStyle: "circle",
            boxWidth: 7,
            boxHeight: 7,
            padding: 18,
            font: { size: 11 },
          },
        },
        tooltip: {
          backgroundColor: "#111a1f",
          borderColor: "#30434c",
          borderWidth: 1,
          titleColor: "#ecf4f2",
          bodyColor: "#b2c0c0",
          padding: 11,
          displayColors: true,
        },
      },
    };
  }

  function timeScale() {
    return {
      type: "time",
      bounds: "data",
      time: { tooltipFormat: "MMM d, yyyy" },
      grid: { display: false },
      border: { color: COLORS.grid },
      ticks: {
        color: COLORS.muted,
        maxRotation: 0,
        maxTicksLimit: 9,
        font: { size: 10 },
      },
    };
  }

  function destroyChart(name) {
    if (!state.charts[name]) return;
    try {
      state.charts[name].destroy();
    } catch (_error) {
      // A failed CDN or adapter should not block the non-chart dashboard.
    }
    delete state.charts[name];
  }

  function updateChartStatus() {
    if (state.chartFailures.size === 0) {
      elements.chartStatus.hidden = true;
      elements.chartStatus.textContent = "";
      return;
    }
    elements.chartStatus.textContent = "Charts unavailable. Data tables are still available.";
    elements.chartStatus.hidden = false;
  }

  function syncDatasets(chart, next) {
    const current = chart.data.datasets;
    next.forEach((dataset, index) => {
      if (current[index]) Object.assign(current[index], dataset);
      else current[index] = dataset;
    });
    current.length = next.length;
  }

  // Snapshot the canvas being replaced and fade it out over the new render, so
  // an update reads as a trail rather than a hard cut.
  function paintGhost(canvas) {
    if (state.reducedMotion) return;
    const frame = canvas.parentElement;
    if (!frame) return;
    let source;
    try {
      source = canvas.toDataURL("image/png");
    } catch (_error) {
      return;
    }
    frame.querySelectorAll(".chart-ghost").forEach((node) => node.remove());
    const ghost = document.createElement("img");
    ghost.className = "chart-ghost";
    ghost.alt = "";
    ghost.src = source;
    frame.append(ghost);
    requestAnimationFrame(() => ghost.classList.add("chart-ghost--fade"));
    ghost.addEventListener("transitionend", () => ghost.remove(), { once: true });
  }

  function createChart(name, canvas, fallback, config) {
    canvas.hidden = false;
    fallback.hidden = true;

    if (typeof window.Chart !== "function") {
      destroyChart(name);
      state.chartFailures.add(name);
      canvas.hidden = true;
      fallback.hidden = false;
      updateChartStatus();
      return;
    }

    const existing = state.charts[name];
    if (existing) {
      paintGhost(canvas);
      existing.data.labels = config.data.labels;
      syncDatasets(existing, config.data.datasets);
      existing.options = config.options;
      existing.update();
      state.chartFailures.delete(name);
      updateChartStatus();
      return;
    }

    try {
      state.charts[name] = new window.Chart(canvas, config);
      state.chartFailures.delete(name);
    } catch (_error) {
      state.chartFailures.add(name);
      canvas.hidden = true;
      fallback.hidden = false;
    }
    updateChartStatus();
  }

  function renderTimeline(model) {
    const isWeekly = state.granularity === "weekly";
    const rows = isWeekly ? model.weekly : model.daily;
    const dateKey = isWeekly ? "weekStart" : "date";
    renderTimelineData(rows, isWeekly);
    const options = commonChartOptions();
    options.plugins.tooltip.callbacks = {
      label(context) {
        return context.dataset.yAxisID === "cost"
          ? `Estimated cost: ${formatCurrency(context.parsed.y)}`
          : `Total tokens: ${formatInteger(context.parsed.y)}`;
      },
    };
    options.scales = {
      x: timeScale(),
      cost: {
        position: "left",
        beginAtZero: true,
        grid: { color: COLORS.grid },
        border: { display: false },
        title: { display: true, text: "Estimated cost", color: COLORS.muted },
        ticks: {
          color: COLORS.muted,
          callback(value) { return formatCurrency(value); },
          font: { size: 10 },
        },
      },
      tokens: {
        position: "right",
        beginAtZero: true,
        grid: { drawOnChartArea: false },
        border: { display: false },
        title: { display: true, text: "Total tokens", color: COLORS.muted },
        ticks: {
          color: COLORS.muted,
          callback(value) { return formatCompact(value); },
          font: { size: 10 },
        },
      },
    };

    createChart("timeline", elements.timelineCanvas, elements.timelineFallback, {
      data: {
        datasets: [
          {
            type: "bar",
            label: isWeekly ? "Weekly cost" : "Daily cost",
            data: rows.map((row) => ({ x: row[dateKey], y: row.costUSD })),
            yAxisID: "cost",
            backgroundColor: "rgba(85, 227, 195, 0.46)",
            borderColor: COLORS.accent,
            borderWidth: 1,
            borderRadius: 2,
            maxBarThickness: isWeekly ? 22 : 12,
          },
          {
            type: "line",
            label: "Total tokens",
            data: rows.map((row) => ({ x: row[dateKey], y: row.totalTokens })),
            yAxisID: "tokens",
            borderColor: COLORS.blue,
            backgroundColor: COLORS.blue,
            borderWidth: 1.7,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.12,
          },
        ],
      },
      options,
    });
  }

  function renderComposition(model) {
    const series = [
      { key: "inputTokens", label: "Input", color: COLORS.accent },
      { key: "outputTokens", label: "Output", color: COLORS.blue },
      { key: "reasoningOutputTokens", label: "Reasoning (included in output)", color: COLORS.amber, dash: [5, 4] },
      { key: "cacheReadTokens", label: "Cache read", color: COLORS.violet },
      { key: "cacheCreationTokens", label: "Cache creation", color: COLORS.rose },
    ].filter((item) => model.tokenSeriesVisibility[item.key]);

    const options = commonChartOptions();
    options.plugins.tooltip.callbacks = {
      label(context) {
        return `${context.dataset.label}: ${formatInteger(context.parsed.y)}`;
      },
    };
    options.scales = {
      x: timeScale(),
      y: {
        type: state.tokenScale,
        beginAtZero: state.tokenScale === "linear",
        grid: { color: COLORS.grid },
        border: { display: false },
        title: { display: true, text: "Tokens", color: COLORS.muted },
        ticks: {
          color: COLORS.muted,
          callback(value) { return formatCompact(value); },
          font: { size: 10 },
        },
      },
    };

    createChart("composition", elements.compositionCanvas, elements.compositionFallback, {
      type: "line",
      data: {
        datasets: series.map((item) => ({
          label: item.label,
          data: model.daily.map((row) => ({
            x: row.date,
            y: state.tokenScale === "logarithmic" && row[item.key] === 0
              ? null
              : row[item.key],
          })),
          borderColor: item.color,
          backgroundColor: item.color,
          borderWidth: 1.55,
          borderDash: item.dash || [],
          pointRadius: 0,
          pointHoverRadius: 3,
          tension: 0.1,
          spanGaps: false,
        })),
      },
      options,
    });
  }

  function renderModels(model) {
    const options = commonChartOptions();
    options.indexAxis = "y";
    options.interaction = { mode: "nearest", axis: "y", intersect: false };
    options.plugins.legend.display = false;
    options.plugins.tooltip.callbacks = {
      label(context) {
        return `Total tokens: ${formatInteger(context.parsed.x)}`;
      },
      afterBody(items) {
        const usage = model.models[items[0].dataIndex];
        return [
          `Output: ${formatInteger(usage.outputTokens)}`,
          `Reasoning: ${formatInteger(usage.reasoningOutputTokens)}`,
          `Active days: ${formatInteger(usage.recordedDays)}`,
          `Fallback days: ${formatInteger(usage.fallbackOccurrences)}`,
        ];
      },
    };
    options.scales = {
      x: {
        beginAtZero: true,
        grid: { color: COLORS.grid },
        border: { display: false },
        title: { display: true, text: "Total tokens", color: COLORS.muted },
        ticks: {
          color: COLORS.muted,
          callback(value) { return formatCompact(value); },
          font: { size: 10 },
        },
      },
      y: {
        grid: { display: false },
        border: { color: COLORS.grid },
        ticks: {
          autoSkip: false,
          color: COLORS.text,
          font: { family: "ui-monospace, SFMono-Regular, Menlo, monospace", size: 10 },
        },
      },
    };

    createChart("models", elements.modelsCanvas, elements.modelsFallback, {
      type: "bar",
      data: {
        labels: model.models.map((usage) => usage.model),
        datasets: [{
          label: "Total tokens",
          data: model.models.map((usage) => usage.totalTokens),
          backgroundColor: "rgba(130, 170, 255, 0.62)",
          borderColor: COLORS.blue,
          borderWidth: 1,
          borderRadius: 3,
          maxBarThickness: 22,
        }],
      },
      options,
    });
  }

  function renderMonthly(model) {
    const options = commonChartOptions();
    const x = timeScale();
    x.time = {
      unit: "month",
      displayFormats: { month: "MMM yy" },
      tooltipFormat: "MMM yyyy",
    };
    x.ticks.maxTicksLimit = 12;
    options.plugins.tooltip.callbacks = {
      title(items) {
        return formatMonth(items[0].raw.month);
      },
      label(context) {
        return context.dataset.yAxisID === "cost"
          ? `Estimated cost: ${formatCurrency(context.parsed.y)}`
          : `Total tokens: ${formatInteger(context.parsed.y)}`;
      },
      afterBody(items) {
        const row = model.monthlyTimeline[items[0].dataIndex];
        return row.recordedDays === null
          ? []
          : [`Active days: ${formatInteger(row.recordedDays)}`];
      },
    };
    options.scales = {
      x,
      tokens: {
        position: "left",
        beginAtZero: true,
        grid: { color: COLORS.grid },
        border: { display: false },
        title: { display: true, text: "Total tokens", color: COLORS.muted },
        ticks: {
          color: COLORS.muted,
          callback(value) { return formatCompact(value); },
          font: { size: 10 },
        },
      },
      cost: {
        position: "right",
        beginAtZero: true,
        grid: { drawOnChartArea: false },
        border: { display: false },
        title: { display: true, text: "Estimated cost", color: COLORS.muted },
        ticks: {
          color: COLORS.muted,
          callback(value) { return formatCurrency(value); },
          font: { size: 10 },
        },
      },
    };

    const chartRows = model.monthlyTimeline.map((row) => ({
      x: `${row.month}-01`,
      month: row.month,
      recordedDays: row.recordedDays,
      costUSD: row.costUSD,
      totalTokens: row.totalTokens,
    }));

    createChart("monthly", elements.monthlyCanvas, elements.monthlyFallback, {
      data: {
        datasets: [
          {
            type: "bar",
            label: "Total tokens",
            data: chartRows.map((row) => ({ ...row, y: row.totalTokens })),
            yAxisID: "tokens",
            backgroundColor: "rgba(85, 227, 195, 0.48)",
            borderColor: COLORS.accent,
            borderWidth: 1,
            borderRadius: 3,
            maxBarThickness: 44,
          },
          {
            type: "line",
            label: "Estimated cost",
            data: chartRows.map((row) => ({ ...row, y: row.costUSD })),
            yAxisID: "cost",
            borderColor: COLORS.amber,
            backgroundColor: COLORS.amber,
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            spanGaps: false,
            tension: 0.12,
          },
        ],
      },
      options,
    });
  }

  function renderCumulative(model) {
    const options = commonChartOptions();
    options.plugins.tooltip.callbacks = {
      label(context) {
        return context.dataset.yAxisID === "cost"
          ? `Cumulative cost: ${formatCurrency(context.parsed.y)}`
          : `Cumulative tokens: ${formatInteger(context.parsed.y)}`;
      },
    };
    options.scales = {
      x: timeScale(),
      cost: {
        position: "left",
        beginAtZero: true,
        grid: { color: COLORS.grid },
        border: { display: false },
        title: { display: true, text: "Estimated cost", color: COLORS.muted },
        ticks: {
          color: COLORS.muted,
          callback(value) { return formatCurrency(value); },
          font: { size: 10 },
        },
      },
      tokens: {
        position: "right",
        beginAtZero: true,
        grid: { drawOnChartArea: false },
        border: { display: false },
        title: { display: true, text: "Total tokens", color: COLORS.muted },
        ticks: {
          color: COLORS.muted,
          callback(value) { return formatCompact(value); },
          font: { size: 10 },
        },
      },
    };

    createChart("cumulative", elements.cumulativeCanvas, elements.cumulativeFallback, {
      type: "line",
      data: {
        datasets: [
          {
            label: "Cumulative estimated cost",
            data: model.cumulative.map((row) => ({ x: row.date, y: row.costUSD })),
            yAxisID: "cost",
            borderColor: COLORS.accent,
            backgroundColor: "rgba(85, 227, 195, 0.1)",
            borderWidth: 1.8,
            pointRadius: 0,
            pointHoverRadius: 3,
            fill: true,
            tension: 0.08,
          },
          {
            label: "Cumulative total tokens",
            data: model.cumulative.map((row) => ({ x: row.date, y: row.totalTokens })),
            yAxisID: "tokens",
            borderColor: COLORS.blue,
            backgroundColor: COLORS.blue,
            borderWidth: 1.8,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.08,
          },
        ],
      },
      options,
    });
  }

  function renderUserComparisonData(bundle) {
    const rows = [
      { name: "Account total", model: bundle.account },
      ...bundle.users.map((user) => ({ name: user.name, model: user.model })),
    ].map((entry) => {
      const row = document.createElement("tr");
      row.append(
        makeCell(entry.name, { header: true }),
        makeCell(formatCurrency(entry.model.summary.costUSD), {
          title: String(entry.model.summary.costUSD),
        }),
        makeCell(formatCompact(entry.model.summary.totalTokens), {
          title: formatInteger(entry.model.summary.totalTokens),
        }),
        makeCell(formatInteger(entry.model.summary.recordedDays)),
      );
      return row;
    });
    elements.userComparisonDataBody.replaceChildren(...rows);
  }

  function renderUserComparison(bundle) {
    const isWeekly = state.granularity === "weekly";
    const dateKey = isWeekly ? "weekStart" : "date";
    const series = [
      { label: "Account total", model: bundle.account, color: COLORS.accent, width: 2.2 },
      ...bundle.users.map((user, index) => ({
        label: user.name,
        model: user.model,
        color: [COLORS.blue, COLORS.violet, COLORS.amber, COLORS.rose][index % 4],
        width: 1.55,
      })),
    ];
    const options = commonChartOptions();
    options.plugins.tooltip.callbacks = {
      label(context) {
        return `${context.dataset.label}: ${formatInteger(context.parsed.y)}`;
      },
    };
    options.scales = {
      x: timeScale(),
      y: {
        beginAtZero: true,
        grid: { color: COLORS.grid },
        border: { display: false },
        title: { display: true, text: "Total tokens", color: COLORS.muted },
        ticks: {
          color: COLORS.muted,
          callback(value) { return formatCompact(value); },
          font: { size: 10 },
        },
      },
    };

    renderUserComparisonData(bundle);
    createChart("userComparison", elements.userComparisonCanvas, elements.userComparisonFallback, {
      type: "line",
      data: {
        datasets: series.map((entry) => ({
          label: entry.label,
          data: (isWeekly ? entry.model.weekly : entry.model.daily).map((row) => ({
            x: row[dateKey],
            y: row.totalTokens,
          })),
          borderColor: entry.color,
          backgroundColor: entry.color,
          borderWidth: entry.width,
          pointRadius: 0,
          pointHoverRadius: 3,
          tension: 0.12,
          spanGaps: false,
        })),
      },
      options,
    });
  }

  function hideUserComparison() {
    destroyChart("userComparison");
    state.chartFailures.delete("userComparison");
    elements.userComparisonSection.hidden = true;
    updateChartStatus();
  }

  function renderDashboard(model, source, detailName) {
    updateHeader(model.summary, detailName);
    renderSummary(model.summary);
    renderModelTable(model.models);
    renderMonthlyTable(model.monthly);
    renderCompositionData(model.daily);
    renderCumulativeData(model.cumulative);
    elements.emptyState.hidden = true;
    elements.dashboard.hidden = false;
    renderTimeline(model);
    renderComposition(model);
    renderModels(model);
    renderMonthly(model);
    renderCumulative(model);

    if (state.bundle) {
      elements.userComparisonSection.hidden = false;
      renderUserComparison(state.bundle);
    } else {
      hideUserComparison();
    }
  }

  function isMultiUserBundle(raw) {
    return raw !== null
      && typeof raw === "object"
      && !Array.isArray(raw)
      && Array.isArray(raw.users);
  }

  function configureDetailSelector(bundle) {
    if (!bundle) {
      elements.userDetailSelect.replaceChildren();
      elements.userDetailControl.hidden = true;
      return;
    }

    const options = [
      ["account", "Account total"],
      ...bundle.users.map((user) => [user.id, user.name]),
    ].map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    });
    elements.userDetailSelect.replaceChildren(...options);
    elements.userDetailSelect.value = "account";
    elements.userDetailControl.hidden = false;
  }

  function selectDetail(detailId) {
    if (!state.bundle) return;
    const user = state.bundle.users.find((entry) => entry.id === detailId);
    state.detailId = detailId;
    state.model = user ? user.model : state.bundle.account;
    const detailName = user ? user.name : "Account total";
    elements.userDetailSelect.value = user ? user.id : "account";
    renderDashboard(state.model, state.source, detailName);
  }

  function renderSourceToggles() {
    if (!state.sources || state.sources.length < 2) {
      elements.sourceToggles.replaceChildren();
      elements.sourceRow.hidden = true;
      return;
    }
    const buttons = state.sources.map((source) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "toggle-button";
      button.textContent = source.name;
      button.setAttribute("aria-pressed", String(state.selectedIds.has(source.id)));
      button.addEventListener("click", () => {
        if (state.selectedIds.has(source.id)) {
          if (state.selectedIds.size === 1) return;
          state.selectedIds.delete(source.id);
        } else {
          state.selectedIds.add(source.id);
        }
        renderSourceToggles();
        applyRange();
      });
      return button;
    });
    elements.sourceToggles.replaceChildren(...buttons);
    elements.sourceRow.hidden = false;
  }

  function setRangeBounds() {
    const dates = [];
    const collect = (raw) => {
      const range = exportDateRange(raw);
      if (range) dates.push(range.start, range.end);
    };
    if (state.sources) state.sources.forEach((entry) => collect(entry.raw));
    else if (state.rawSingle) collect(state.rawSingle);

    if (state.sources) {
      const ids = state.sources.map((entry) => entry.id);
      const kept = state.selectedIds
        ? ids.filter((id) => state.selectedIds.has(id))
        : ids;
      state.selectedIds = new Set(kept.length > 0 ? kept : ids);
      renderSourceToggles();
    } else {
      state.selectedIds = null;
    }

    if (dates.length === 0) {
      state.bounds = null;
      elements.rangePanel.hidden = true;
      state.range = { start: null, end: null };
      return;
    }

    dates.sort();
    state.bounds = { start: dates[0], end: dates[dates.length - 1] };
    state.range = { start: null, end: null };
    for (const [input, value] of [
      [elements.rangeStart, state.bounds.start],
      [elements.rangeEnd, state.bounds.end],
    ]) {
      input.min = state.bounds.start;
      input.max = state.bounds.end;
      input.value = value;
    }
    elements.rangePanel.hidden = false;
  }

  function applyRange() {
    const range = state.range;
    if (state.sources) {
      const sources = state.sources
        .filter((entry) => state.selectedIds.has(entry.id))
        .map((entry) => ({ ...entry, raw: filterExport(entry.raw, range) }));
      state.bundle = buildMultiUserDashboardData(sources);
      configureDetailSelector(state.bundle);
      const known = state.bundle.users.some((user) => user.id === state.detailId);
      selectDetail(known ? state.detailId : "account");
      return;
    }
    if (!state.rawSingle) return;
    state.bundle = null;
    state.detailId = "selected";
    state.model = buildDashboardData(filterExport(state.rawSingle, range));
    configureDetailSelector(null);
    renderDashboard(
      state.model,
      state.source,
      state.source.kind === "generated" ? "Loaded export" : state.source.name,
    );
  }

  function activateRaw(raw, source, focusOnError) {
    try {
      state.source = source;
      if (isMultiUserBundle(raw)) {
        state.sources = raw.users.map((user) => ({
          id: user.id,
          name: user.name,
          raw: user.data,
        }));
        state.rawSingle = null;
      } else {
        state.sources = null;
        state.rawSingle = raw;
      }
      setRangeBounds();
      applyRange();
    } catch (error) {
      showError(
        source.kind === "generated" ? "Snapshot data is invalid" : `Could not load ${source.name}`,
        `${errorDetail(error)}${retentionMessage()}`,
        focusOnError,
      );
      return false;
    }

    clearError();
    return true;
  }

  async function loadFile(file) {
    if (!file) return;
    const sequence = ++state.loadSequence;
    setLoading(true);

    try {
      const text = await file.text();
      if (sequence !== state.loadSequence) return;
      let raw;
      try {
        raw = JSON.parse(text);
      } catch (error) {
        throw new Error(`Malformed JSON: ${errorDetail(error)}`);
      }
      activateRaw(raw, { kind: "selected", name: file.name || "selected file" }, true);
    } catch (error) {
      if (sequence === state.loadSequence) {
        showError(
          `Could not load ${file.name || "selected file"}`,
          `${errorDetail(error)}${retentionMessage()}`,
          true,
        );
      }
    } finally {
      if (sequence === state.loadSequence) setLoading(false);
      elements.fileInput.value = "";
    }
  }

  function closeLauncher() {
    if (elements.launcherDialog.open) elements.launcherDialog.close();
  }

  function setupRangeSelector() {
    const apply = () => {
      let start = elements.rangeStart.value || null;
      let end = elements.rangeEnd.value || null;
      if (start && end && start > end) {
        [start, end] = [end, start];
        elements.rangeStart.value = start;
        elements.rangeEnd.value = end;
      }
      state.range = { start, end };
      if (state.sources || state.rawSingle) applyRange();
    };

    elements.rangeStart.addEventListener("change", apply);
    elements.rangeEnd.addEventListener("change", apply);
    elements.rangeReset.addEventListener("click", () => {
      if (state.bounds) {
        elements.rangeStart.value = state.bounds.start;
        elements.rangeEnd.value = state.bounds.end;
      }
      state.range = { start: null, end: null };
      if (state.sources || state.rawSingle) applyRange();
    });
  }

  function setupLauncher() {
    elements.launcherButton.addEventListener("click", () => elements.launcherDialog.showModal());
    elements.launcherClose.addEventListener("click", closeLauncher);
    document.querySelectorAll("[data-copy-target]").forEach((button) => {
      button.addEventListener("click", async () => {
        const command = document.getElementById(button.dataset.copyTarget).textContent.trim();
        try {
          await navigator.clipboard.writeText(command);
        } catch (_error) {
          const input = document.createElement("textarea");
          input.value = command;
          input.setAttribute("readonly", "");
          input.style.position = "fixed";
          input.style.opacity = "0";
          document.body.append(input);
          input.select();
          document.execCommand("copy");
          input.remove();
        }
        button.dataset.copied = "true";
        button.setAttribute("aria-label", "Command copied");
        button.title = "Copied";
        window.setTimeout(() => {
          button.dataset.copied = "false";
          button.setAttribute("aria-label", "Copy generation command");
          button.title = "Copy command";
        }, 1600);
      });
    });
  }

  function setToggle(group, attribute, activeValue) {
    group.querySelectorAll(`button[data-${attribute}]`).forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset[attribute] === activeValue));
    });
  }

  function setupToggles() {
    elements.granularityToggle.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-granularity]");
      if (!button || button.dataset.granularity === state.granularity) return;
      state.granularity = button.dataset.granularity;
      setToggle(elements.granularityToggle, "granularity", state.granularity);
      if (state.model) renderTimeline(state.model);
      if (state.bundle) renderUserComparison(state.bundle);
    });

    elements.scaleToggle.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-scale]");
      if (!button || button.dataset.scale === state.tokenScale) return;
      state.tokenScale = button.dataset.scale;
      setToggle(elements.scaleToggle, "scale", state.tokenScale);
      if (state.model) renderComposition(state.model);
    });
  }

  function setupDetailSelector() {
    elements.userDetailSelect.addEventListener("change", () => {
      selectDetail(elements.userDetailSelect.value);
    });
  }

  function dragHasFiles(event) {
    return Boolean(event.dataTransfer)
      && Array.from(event.dataTransfer.types || []).includes("Files");
  }

  function hideDropOverlay() {
    state.dragDepth = 0;
    elements.body.classList.remove("is-dragging");
    elements.dropOverlay.setAttribute("aria-hidden", "true");
  }

  function setupFileLoading() {
    elements.fileInput.addEventListener("change", () => {
      closeLauncher();
      loadFile(elements.fileInput.files && elements.fileInput.files[0]);
    });

    document.addEventListener("dragenter", (event) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      state.dragDepth += 1;
      elements.body.classList.add("is-dragging");
      elements.dropOverlay.setAttribute("aria-hidden", "false");
    });

    document.addEventListener("dragover", (event) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });

    document.addEventListener("dragleave", (event) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      state.dragDepth = Math.max(0, state.dragDepth - 1);
      if (state.dragDepth === 0) hideDropOverlay();
    });

    document.addEventListener("drop", (event) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      const file = event.dataTransfer.files && event.dataTransfer.files[0];
      hideDropOverlay();
      if (file) loadFile(file);
    });

    window.addEventListener("blur", hideDropOverlay);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideDropOverlay();
    });
  }

  // ponytail: 30s poll of the local publisher pointers, swap for SSE if the
  // opencode server ever streams usage events to the browser.
  function setupLiveReload() {
    if (!new URLSearchParams(window.location.search).has("live")) return;
    if (window.location.protocol === "file:") {
      showError(
        "Live mode needs a server",
        "This dashboard must be served over http for live mode; run node serve.js.",
        false,
      );
      return;
    }

    let generatedAt = null;
    const refresh = async () => {
      try {
        if (state.source && state.source.kind === "selected") return;
        const pointerResponse = await fetch(`data/latest.json?ts=${Date.now()}`, { cache: "no-store" });
        if (!pointerResponse.ok) return;
        const pointer = await pointerResponse.json();
        if (!pointer || !pointer.generatedAt || pointer.generatedAt === generatedAt) return;
        const dataResponse = await fetch(`data/latest-data.json?ts=${Date.now()}`, { cache: "no-store" });
        if (!dataResponse.ok) return;
        const bundle = await dataResponse.json();
        if (activateRaw(bundle, { kind: "generated", name: "local snapshot" }, false)) {
          generatedAt = pointer.generatedAt;
        }
      } catch (_error) {
        // Transient file/serve error; retry on the next interval.
      }
    };

    refresh();
    window.setInterval(refresh, 30000);
  }

  function initialize() {
    setupToggles();
    setupDetailSelector();
    setupLauncher();
    setupRangeSelector();
    setupFileLoading();
    setupLiveReload();
    elements.dismissError.addEventListener("click", clearError);

    if (bundledData) {
      activateRaw(bundledData, { kind: "generated", name: "local snapshot" }, false);
    }

    requestAnimationFrame(() => elements.body.classList.add("is-ready"));
  }

  initialize();
}());
