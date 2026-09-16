(function attachCodexUsageCore(root, factory) {
	'use strict';

	const api = factory();

	if (typeof module === 'object' && module.exports) {
		module.exports = api;
	} else {
		root.CodexUsageCore = api;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCodexUsageCore() {
	'use strict';

	const TOKEN_FIELDS = [
		'inputTokens',
		'outputTokens',
		'reasoningOutputTokens',
		'cacheCreationTokens',
		'cacheReadTokens',
		'totalTokens',
	];
	const TOKEN_COMPONENT_FIELDS = [
		'inputTokens',
		'outputTokens',
		'cacheCreationTokens',
		'cacheReadTokens',
	];
	const TOKEN_SERIES_FIELDS = [
		'inputTokens',
		'outputTokens',
		'reasoningOutputTokens',
		'cacheCreationTokens',
		'cacheReadTokens',
	];

	function fail(message) {
		throw new TypeError(message);
	}

	function isObject(value) {
		return value !== null && typeof value === 'object' && !Array.isArray(value);
	}

	function normalizeExport(raw) {
		if (!isObject(raw) || !Array.isArray(raw.daily)) return raw;
		if (!raw.daily.some((day) => Array.isArray(day && day.modelBreakdowns))) return raw;

		const daily = raw.daily.map((day) => {
			const models = Object.fromEntries(day.modelBreakdowns.map((model) => {
				const inputTokens = model.inputTokens || 0;
				const outputTokens = model.outputTokens || 0;
				const cacheCreationTokens = model.cacheCreationTokens || 0;
				const cacheReadTokens = model.cacheReadTokens || 0;
				return [model.modelName || 'unknown', {
					cacheCreationTokens,
					cacheReadTokens,
					inputTokens,
					isFallback: false,
					outputTokens,
					reasoningOutputTokens: 0,
					totalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
				}];
			}));
			const inputTokens = day.inputTokens || 0;
			const outputTokens = day.outputTokens || 0;
			const cacheCreationTokens = day.cacheCreationTokens || 0;
			const cacheReadTokens = day.cacheReadTokens || 0;
			return {
				cacheCreationTokens,
				cacheReadTokens,
				costUSD: day.totalCost || 0,
				date: day.date,
				inputTokens,
				models,
				outputTokens,
				reasoningOutputTokens: 0,
				totalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
			};
		});
		const totals = daily.reduce((result, day) => {
			for (const field of TOKEN_FIELDS) result[field] += day[field];
			result.costUSD += day.costUSD;
			return result;
		}, { ...zeroTokenMetrics(), costUSD: 0 });
		return { daily, totals };
	}

	function assertObject(value, path) {
		if (!isObject(value)) {
			fail(`${path} must be an object`);
		}
	}

	function assertToken(value, path) {
		if (!Number.isSafeInteger(value) || value < 0) {
			fail(`${path} must be a non-negative safe integer`);
		}
		return value;
	}

	function assertCost(value, path) {
		if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
			fail(`${path} must be a non-negative finite number`);
		}
		return value;
	}

	function readTokenMetrics(source, path) {
		const metrics = {};
		for (const field of TOKEN_FIELDS) {
			metrics[field] = assertToken(source[field], `${path}.${field}`);
		}

		if (metrics.reasoningOutputTokens > metrics.outputTokens) {
			fail(`${path}.reasoningOutputTokens cannot exceed ${path}.outputTokens`);
		}

		const componentTotal = TOKEN_COMPONENT_FIELDS.reduce(
			(sum, field) => sum + metrics[field],
			0,
		);
		if (metrics.totalTokens !== componentTotal) {
			fail(
				`${path}.totalTokens must equal input, output, cache creation, and cache read tokens`,
			);
		}

		return metrics;
	}

	function readUsageMetrics(source, path) {
		return {
			...readTokenMetrics(source, path),
			costUSD: assertCost(source.costUSD, `${path}.costUSD`),
		};
	}

	function isValidDateString(value) {
		if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			return false;
		}

		const date = new Date(`${value}T00:00:00.000Z`);
		return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
	}

	function normalizeModel(model, path) {
		assertObject(model, path);
		const metrics = readTokenMetrics(model, path);
		if (typeof model.isFallback !== 'boolean') {
			fail(`${path}.isFallback must be a boolean`);
		}

		return {
			...metrics,
			isFallback: model.isFallback,
		};
	}

	function zeroTokenMetrics() {
		return Object.fromEntries(TOKEN_FIELDS.map((field) => [field, 0]));
	}

	function addTokenMetrics(target, source) {
		for (const field of TOKEN_FIELDS) {
			target[field] += source[field];
		}
	}

	function normalizeDay(day, index) {
		const path = `daily[${index}]`;
		assertObject(day, path);

		if (!isValidDateString(day.date)) {
			fail(`${path}.date must be a valid YYYY-MM-DD date`);
		}

		const metrics = readUsageMetrics(day, path);
		assertObject(day.models, `${path}.models`);

		const modelTotals = zeroTokenMetrics();
		const modelEntries = [];
		for (const modelName of Object.keys(day.models).sort()) {
			if (modelName.length === 0) {
				fail(`${path}.models must not contain an empty model name`);
			}
			const modelPath = `${path}.models.${modelName}`;
			const normalizedModel = normalizeModel(day.models[modelName], modelPath);
			addTokenMetrics(modelTotals, normalizedModel);
			modelEntries.push([modelName, normalizedModel]);
		}

		for (const field of TOKEN_FIELDS) {
			if (metrics[field] !== modelTotals[field]) {
				fail(`${path}.${field} does not reconcile with its models`);
			}
		}

		return {
			date: day.date,
			...metrics,
			models: Object.fromEntries(modelEntries),
			cacheReadShare: ratio(metrics.cacheReadTokens, metrics.totalTokens),
		};
	}

	function ratio(numerator, denominator) {
		return denominator === 0 ? 0 : numerator / denominator;
	}

	function costsMatch(actual, expected) {
		const tolerance = Math.max(
			1e-9,
			Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected)) * 64,
		);
		return Math.abs(actual - expected) <= tolerance;
	}

	function normalizeAndValidate(raw) {
		assertObject(raw, 'root');
		if (!Array.isArray(raw.daily)) {
			fail('root.daily must be an array');
		}
		assertObject(raw.totals, 'root.totals');

		const dates = new Set();
		const daily = raw.daily.map((day, index) => {
			const normalized = normalizeDay(day, index);
			if (dates.has(normalized.date)) {
				fail(`duplicate daily date ${normalized.date}`);
			}
			dates.add(normalized.date);
			return normalized;
		});
		daily.sort((left, right) => {
			if (left.date < right.date) {
				return -1;
			}
			if (left.date > right.date) {
				return 1;
			}
			return 0;
		});

		const totals = readUsageMetrics(raw.totals, 'totals');
		const dailyTotals = {
			...zeroTokenMetrics(),
			costUSD: 0,
		};
		for (const day of daily) {
			addTokenMetrics(dailyTotals, day);
			dailyTotals.costUSD += day.costUSD;
		}

		for (const field of TOKEN_FIELDS) {
			if (totals[field] !== dailyTotals[field]) {
				fail(`totals.${field} does not reconcile with daily rows`);
			}
		}
		if (!costsMatch(totals.costUSD, dailyTotals.costUSD)) {
			fail('totals.costUSD does not reconcile with daily rows');
		}

		return { daily, totals };
	}

	function mondayFor(dateString) {
		const date = new Date(`${dateString}T00:00:00.000Z`);
		const weekday = date.getUTCDay();
		const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
		date.setUTCDate(date.getUTCDate() - daysSinceMonday);
		return date.toISOString().slice(0, 10);
	}

	function aggregatePeriods(daily, keyName, keyForDay) {
		const periods = new Map();

		for (const day of daily) {
			const key = keyForDay(day);
			let period = periods.get(key);
			if (!period) {
				period = {
					[keyName]: key,
					...zeroTokenMetrics(),
					costUSD: 0,
					recordedDays: 0,
				};
				periods.set(key, period);
			}

			addTokenMetrics(period, day);
			period.costUSD += day.costUSD;
			period.recordedDays += 1;
		}

		return Array.from(periods.values(), (period) => ({
			...period,
			cacheReadShare: ratio(period.cacheReadTokens, period.totalTokens),
		}));
	}

	function nextMonth(month) {
		const date = new Date(`${month}-01T00:00:00.000Z`);
		date.setUTCMonth(date.getUTCMonth() + 1);
		return date.toISOString().slice(0, 7);
	}

	function buildMonthlyTimeline(monthly) {
		if (monthly.length === 0) {
			return [];
		}

		const byMonth = new Map(monthly.map((period) => [period.month, period]));
		const endMonth = monthly[monthly.length - 1].month;
		const timeline = [];

		for (let month = monthly[0].month; month <= endMonth; month = nextMonth(month)) {
			timeline.push(byMonth.get(month) || {
				month,
				...Object.fromEntries(TOKEN_FIELDS.map((field) => [field, null])),
				costUSD: null,
				recordedDays: null,
				cacheReadShare: null,
			});
		}

		return timeline;
	}

	function aggregateModels(daily) {
		const models = new Map();

		for (const day of daily) {
			for (const [modelName, usage] of Object.entries(day.models)) {
				let model = models.get(modelName);
				if (!model) {
					model = {
						model: modelName,
						...zeroTokenMetrics(),
						recordedDays: 0,
						fallbackOccurrences: 0,
					};
					models.set(modelName, model);
				}

				addTokenMetrics(model, usage);
				model.recordedDays += 1;
				if (usage.isFallback) {
					model.fallbackOccurrences += 1;
				}
			}
		}

		return sortModels(Array.from(models.values()));
	}

	function sortModels(models) {
		return models.sort((left, right) => {
			const tokenDifference = right.totalTokens - left.totalTokens;
			if (tokenDifference !== 0) {
				return tokenDifference;
			}
			if (left.model < right.model) {
				return -1;
			}
			if (left.model > right.model) {
				return 1;
			}
			return 0;
		});
	}

	function buildCumulative(daily) {
		let costUSD = 0;
		let totalTokens = 0;

		return daily.map((day) => {
			costUSD += day.costUSD;
			totalTokens += day.totalTokens;
			return {
				date: day.date,
				costUSD,
				totalTokens,
			};
		});
	}

	function buildDashboardModel(daily, totals, models) {
		const dateStart = daily.length === 0 ? null : daily[0].date;
		const dateEnd = daily.length === 0 ? null : daily[daily.length - 1].date;
		const monthly = aggregatePeriods(daily, 'month', (day) => day.date.slice(0, 7));

		return {
			summary: {
				...totals,
				cacheReadShare: ratio(totals.cacheReadTokens, totals.totalTokens),
				recordedDays: daily.length,
				dateStart,
				dateEnd,
				latestDate: dateEnd,
			},
			daily,
			weekly: aggregatePeriods(daily, 'weekStart', (day) => mondayFor(day.date)),
			monthly,
			monthlyTimeline: buildMonthlyTimeline(monthly),
			models,
			cumulative: buildCumulative(daily),
			tokenSeriesVisibility: Object.fromEntries(
				TOKEN_SERIES_FIELDS.map((field) => [
					field,
					daily.some((day) => day[field] > 0),
				]),
			),
		};
	}

	function buildDashboardData(raw) {
		const { daily, totals } = normalizeAndValidate(normalizeExport(raw));
		return buildDashboardModel(daily, totals, aggregateModels(daily));
	}

	function addUsageMetrics(target, source) {
		addTokenMetrics(target, source);
		target.costUSD += source.costUSD;
	}

	function aggregateAccountDaily(users) {
		const days = new Map();

		for (const user of users) {
			for (const day of user.model.daily) {
				let accountDay = days.get(day.date);
				if (!accountDay) {
					accountDay = {
						date: day.date,
						...zeroTokenMetrics(),
						costUSD: 0,
					};
					days.set(day.date, accountDay);
				}
				addUsageMetrics(accountDay, day);
			}
		}

		return Array.from(days.values()).sort((left, right) => {
			if (left.date < right.date) return -1;
			if (left.date > right.date) return 1;
			return 0;
		});
	}

	function aggregateAccountModels(users) {
		const models = new Map();

		for (const user of users) {
			for (const usage of user.model.models) {
				let model = models.get(usage.model);
				if (!model) {
					model = {
						model: usage.model,
						...zeroTokenMetrics(),
						recordedDays: 0,
						fallbackOccurrences: 0,
					};
					models.set(usage.model, model);
				}
				addTokenMetrics(model, usage);
				model.recordedDays += usage.recordedDays;
				model.fallbackOccurrences += usage.fallbackOccurrences;
			}
		}

		return sortModels(Array.from(models.values()));
	}

	function buildMultiUserDashboardData(sources) {
		if (!Array.isArray(sources) || sources.length === 0) {
			fail('sources must be a non-empty array');
		}

		const ids = new Set();
		const users = sources.map((source, index) => {
			const path = `sources[${index}]`;
			assertObject(source, path);
			if (typeof source.id !== 'string' || source.id.length === 0) {
				fail(`${path}.id must be a non-empty string`);
			}
			if (ids.has(source.id)) {
				fail(`duplicate source id ${source.id}`);
			}
			ids.add(source.id);
			if (typeof source.name !== 'string' || source.name.length === 0) {
				fail(`${path}.name must be a non-empty string`);
			}

			return {
				id: source.id,
				name: source.name,
				model: buildDashboardData(source.raw),
			};
		});
		const totals = {
			...zeroTokenMetrics(),
			costUSD: 0,
		};

		for (const user of users) {
			addUsageMetrics(totals, user.model.summary);
		}

		return {
			users,
			account: buildDashboardModel(
				aggregateAccountDaily(users),
				totals,
				aggregateAccountModels(users),
			),
		};
	}

	return {
		buildDashboardData,
		buildMultiUserDashboardData,
		normalizeExport,
	};
});
