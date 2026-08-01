(function () {
  "use strict";

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
    sourceLabel: document.getElementById("source-label"),
    dateRange: document.getElementById("date-range"),
    latestRecord: document.getElementById("latest-record"),
    summaryHeading: document.getElementById("summary-heading"),
    summaryGrid: document.getElementById("summary-grid"),
    detailDescription: document.getElementById("detail-description"),
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
    fileAction: document.getElementById("file-action"),
    fileActionText: document.getElementById("file-action-text"),
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
    elements.fileAction.classList.toggle("is-loading", isLoading);
    elements.fileInput.disabled = isLoading;
    elements.fileActionText.textContent = isLoading ? "Reading JSON" : "Load JSON";
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
    return "This is not a ccusage Codex JSON file.";
  }

  function retentionMessage() {
    return state.model
      ? " Your current data is unchanged."
      : " Load or drop a ccusage Codex JSON file.";
  }

  function makeMetric(label, value, detail, exactValue) {
    const wrapper = document.createElement("div");
    wrapper.className = "metric";

    const term = document.createElement("dt");
    term.textContent = label;

    const description = document.createElement("dd");
    const displayedValue = document.createElement("span");
    displayedValue.className = "metric-value";
    displayedValue.textContent = value;
    if (exactValue) displayedValue.title = exactValue;

    const note = document.createElement("small");
    note.textContent = detail;

    description.append(displayedValue, note);
    wrapper.append(term, description);
    return wrapper;
  }

  function renderSummary(summary) {
    const outputShare = summary.outputTokens > 0
      ? summary.reasoningOutputTokens / summary.outputTokens
      : 0;

    const metrics = [
      makeMetric(
        "Estimated cost",
        formatCurrency(summary.costUSD),
        "Estimated by ccusage",
        String(summary.costUSD),
      ),
      makeMetric(
        "Total tokens",
        formatCompact(summary.totalTokens),
        `${formatCompact(summary.inputTokens)} input`,
        formatInteger(summary.totalTokens),
      ),
      makeMetric(
        "Output tokens",
        formatCompact(summary.outputTokens),
        "Reasoning included",
        formatInteger(summary.outputTokens),
      ),
      makeMetric(
        "Reasoning tokens",
        formatCompact(summary.reasoningOutputTokens),
        `${formatPercent(outputShare)} of output`,
        formatInteger(summary.reasoningOutputTokens),
      ),
      makeMetric(
        "Cache-read tokens",
        formatCompact(summary.cacheReadTokens),
        `${formatPercent(summary.cacheReadShare)} of total`,
        formatInteger(summary.cacheReadTokens),
      ),
      makeMetric(
        "Active days",
        formatInteger(summary.recordedDays),
        `${formatDate(summary.dateStart)} – ${formatDate(summary.dateEnd)}`,
      ),
    ];

    elements.summaryGrid.replaceChildren(...metrics);
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

  function updateHeader(summary, source, detailName) {
    elements.sourceLabel.textContent = source.kind === "generated"
      ? "Bundled data"
      : source.name;
    elements.dateRange.textContent = `${formatDate(summary.dateStart)} – ${formatDate(summary.dateEnd)}`;
    elements.latestRecord.textContent = `Updated ${formatDate(summary.latestDate || summary.dateEnd)}`;
    document.title = `Codex Usage · ${detailName} · ${formatDate(summary.latestDate || summary.dateEnd)}`;
  }

  function chartAnimation() {
    return state.reducedMotion ? false : { duration: 320 };
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

  function createChart(name, canvas, fallback, config) {
    destroyChart(name);
    canvas.hidden = false;
    fallback.hidden = true;

    if (typeof window.Chart !== "function") {
      state.chartFailures.add(name);
      canvas.hidden = true;
      fallback.hidden = false;
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
    updateHeader(model.summary, source, detailName);
    elements.summaryHeading.textContent = detailName;
    elements.detailDescription.textContent = state.bundle
      ? detailName === "Account total"
        ? "Combined usage across all bundled users."
        : `Separate usage for ${detailName}; account totals remain available above.`
      : "A session-only ccusage export. Reload to restore bundled data.";
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

  function activateRaw(raw, source, focusOnError) {
    try {
      if (isMultiUserBundle(raw)) {
        state.bundle = window.CodexUsageCore.buildMultiUserDashboardData(
          raw.users.map((user) => ({
            id: user.id,
            name: user.name,
            raw: user.data,
          })),
        );
        state.source = source;
        configureDetailSelector(state.bundle);
        selectDetail("account");
      } else {
        state.bundle = null;
        state.detailId = "selected";
        state.model = window.CodexUsageCore.buildDashboardData(raw);
        state.source = source;
        configureDetailSelector(null);
        renderDashboard(state.model, source, source.kind === "generated" ? "Bundled export" : source.name);
      }
    } catch (error) {
      showError(
        source.kind === "generated" ? "Bundled data is invalid" : `Could not load ${source.name}`,
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

  function initialize() {
    setupToggles();
    setupDetailSelector();
    setupFileLoading();
    elements.dismissError.addEventListener("click", clearError);

    if (!window.CodexUsageCore
      || typeof window.CodexUsageCore.buildDashboardData !== "function"
      || typeof window.CodexUsageCore.buildMultiUserDashboardData !== "function") {
      elements.sourceLabel.textContent = "No usage data";
      showError(
        "Dashboard files are incomplete",
        "dashboard-core.js is missing, so data cannot be loaded.",
        false,
      );
      elements.body.classList.add("is-ready");
      return;
    }

    if (Object.prototype.hasOwnProperty.call(window, "CODEX_USAGE_DATA")) {
      activateRaw(
        window.CODEX_USAGE_DATA,
        { kind: "generated", name: "usage-data.js" },
        false,
      );
    } else {
      elements.sourceLabel.textContent = "No usage data";
      showError(
        "Bundled data is unavailable",
        "usage-data.js is missing. Load or drop a ccusage Codex JSON file.",
        false,
      );
    }

    requestAnimationFrame(() => elements.body.classList.add("is-ready"));
  }

  initialize();
}());
