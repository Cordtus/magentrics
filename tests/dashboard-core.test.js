'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDashboardData, buildMultiUserDashboardData } = require('../dashboard-core.js');

function canonicalExport() {
	return {
		daily: [
			{
				date: '2026-02-04',
				inputTokens: 3,
				outputTokens: 6,
				reasoningOutputTokens: 4,
				cacheCreationTokens: 2,
				cacheReadTokens: 14,
				totalTokens: 25,
				costUSD: 1.25,
				models: {
					beta: {
						inputTokens: 3,
						outputTokens: 6,
						reasoningOutputTokens: 4,
						cacheCreationTokens: 2,
						cacheReadTokens: 14,
						totalTokens: 25,
						isFallback: true,
					},
				},
			},
			{
				date: '2026-01-31',
				inputTokens: 10,
				outputTokens: 4,
				reasoningOutputTokens: 2,
				cacheCreationTokens: 0,
				cacheReadTokens: 6,
				totalTokens: 20,
				costUSD: 1.25,
				models: {
					alpha: {
						inputTokens: 10,
						outputTokens: 4,
						reasoningOutputTokens: 2,
						cacheCreationTokens: 0,
						cacheReadTokens: 6,
						totalTokens: 20,
						isFallback: true,
					},
				},
			},
			{
				date: '2026-02-02',
				inputTokens: 7,
				outputTokens: 4,
				reasoningOutputTokens: 1,
				cacheCreationTokens: 0,
				cacheReadTokens: 9,
				totalTokens: 20,
				costUSD: 2.5,
				models: {
					alpha: {
						inputTokens: 5,
						outputTokens: 3,
						reasoningOutputTokens: 1,
						cacheCreationTokens: 0,
						cacheReadTokens: 2,
						totalTokens: 10,
						isFallback: false,
					},
					beta: {
						inputTokens: 2,
						outputTokens: 1,
						reasoningOutputTokens: 0,
						cacheCreationTokens: 0,
						cacheReadTokens: 7,
						totalTokens: 10,
						isFallback: true,
					},
				},
			},
		],
		totals: {
			inputTokens: 20,
			outputTokens: 14,
			reasoningOutputTokens: 7,
			cacheCreationTokens: 2,
			cacheReadTokens: 29,
			totalTokens: 65,
			costUSD: 5,
		},
	};
}

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function exportWithDays(days) {
	const totals = {
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		costUSD: 0,
		inputTokens: 0,
		outputTokens: 0,
		reasoningOutputTokens: 0,
		totalTokens: 0,
	};

	for (const day of days) {
		for (const field of [
			'cacheCreationTokens',
			'cacheReadTokens',
			'inputTokens',
			'outputTokens',
			'reasoningOutputTokens',
			'totalTokens',
		]) {
			totals[field] += day[field];
		}
		totals.costUSD += day.costUSD;
	}

	return { daily: clone(days), totals };
}

test('builds sorted summaries and recorded-period aggregates without filling sparse dates', () => {
	const raw = canonicalExport();
	const original = clone(raw);

	const result = buildDashboardData(raw);

	assert.deepEqual(result.summary, {
		inputTokens: 20,
		outputTokens: 14,
		reasoningOutputTokens: 7,
		cacheCreationTokens: 2,
		cacheReadTokens: 29,
		totalTokens: 65,
		costUSD: 5,
		cacheReadShare: 29 / 65,
		recordedDays: 3,
		dateStart: '2026-01-31',
		dateEnd: '2026-02-04',
		latestDate: '2026-02-04',
	});
	assert.deepEqual(
		result.daily.map((day) => day.date),
		['2026-01-31', '2026-02-02', '2026-02-04'],
	);
	assert.deepEqual(result.weekly, [
		{
			weekStart: '2026-01-26',
			inputTokens: 10,
			outputTokens: 4,
			reasoningOutputTokens: 2,
			cacheCreationTokens: 0,
			cacheReadTokens: 6,
			totalTokens: 20,
			costUSD: 1.25,
			recordedDays: 1,
			cacheReadShare: 0.3,
		},
		{
			weekStart: '2026-02-02',
			inputTokens: 10,
			outputTokens: 10,
			reasoningOutputTokens: 5,
			cacheCreationTokens: 2,
			cacheReadTokens: 23,
			totalTokens: 45,
			costUSD: 3.75,
			recordedDays: 2,
			cacheReadShare: 23 / 45,
		},
	]);
	assert.deepEqual(result.monthly, [
		{
			month: '2026-01',
			inputTokens: 10,
			outputTokens: 4,
			reasoningOutputTokens: 2,
			cacheCreationTokens: 0,
			cacheReadTokens: 6,
			totalTokens: 20,
			costUSD: 1.25,
			recordedDays: 1,
			cacheReadShare: 0.3,
		},
		{
			month: '2026-02',
			inputTokens: 10,
			outputTokens: 10,
			reasoningOutputTokens: 5,
			cacheCreationTokens: 2,
			cacheReadTokens: 23,
			totalTokens: 45,
			costUSD: 3.75,
			recordedDays: 2,
			cacheReadShare: 23 / 45,
		},
	]);
	assert.deepEqual(result.cumulative, [
		{ date: '2026-01-31', costUSD: 1.25, totalTokens: 20 },
		{ date: '2026-02-02', costUSD: 3.75, totalTokens: 40 },
		{ date: '2026-02-04', costUSD: 5, totalTokens: 65 },
	]);
	assert.deepEqual(raw, original, 'the source export must not be mutated');
	assert.notStrictEqual(result.daily[0], raw.daily[1]);
});

test('keeps reasoning within output while aggregating models and fallback model-days', () => {
	const result = buildDashboardData(canonicalExport());

	assert.equal(result.summary.totalTokens, 65);
	assert.equal(
		result.summary.inputTokens +
			result.summary.outputTokens +
			result.summary.cacheCreationTokens +
			result.summary.cacheReadTokens,
		65,
		'reasoning is already included in output and must not be added again',
	);
	assert.deepEqual(result.models, [
		{
			model: 'beta',
			inputTokens: 5,
			outputTokens: 7,
			reasoningOutputTokens: 4,
			cacheCreationTokens: 2,
			cacheReadTokens: 21,
			totalTokens: 35,
			recordedDays: 2,
			fallbackOccurrences: 2,
		},
		{
			model: 'alpha',
			inputTokens: 15,
			outputTokens: 7,
			reasoningOutputTokens: 3,
			cacheCreationTokens: 0,
			cacheReadTokens: 8,
			totalTokens: 30,
			recordedDays: 2,
			fallbackOccurrences: 1,
		},
	]);
});

test('inserts null monthly timeline gaps without adding rows to the source-backed summary', () => {
	const raw = canonicalExport();
	raw.daily[0].date = '2026-03-04';
	raw.daily[2].date = '2026-03-02';

	const result = buildDashboardData(raw);

	assert.deepEqual(
		result.monthly.map((month) => month.month),
		['2026-01', '2026-03'],
		'the exact monthly summary must include only months present in the export',
	);
	assert.deepEqual(result.monthlyTimeline, [
		{
			month: '2026-01',
			inputTokens: 10,
			outputTokens: 4,
			reasoningOutputTokens: 2,
			cacheCreationTokens: 0,
			cacheReadTokens: 6,
			totalTokens: 20,
			costUSD: 1.25,
			recordedDays: 1,
			cacheReadShare: 0.3,
		},
		{
			month: '2026-02',
			inputTokens: null,
			outputTokens: null,
			reasoningOutputTokens: null,
			cacheCreationTokens: null,
			cacheReadTokens: null,
			totalTokens: null,
			costUSD: null,
			recordedDays: null,
			cacheReadShare: null,
		},
		{
			month: '2026-03',
			inputTokens: 10,
			outputTokens: 10,
			reasoningOutputTokens: 5,
			cacheCreationTokens: 2,
			cacheReadTokens: 23,
			totalTokens: 45,
			costUSD: 3.75,
			recordedDays: 2,
			cacheReadShare: 23 / 45,
		},
	]);
});

test('marks zero-only token series hidden and ignores unknown future fields', () => {
	const raw = {
		futureRootField: 'ignored',
		daily: [
			{
				date: '2026-03-01',
				inputTokens: 1,
				outputTokens: 2,
				reasoningOutputTokens: 0,
				cacheCreationTokens: 0,
				cacheReadTokens: 0,
				totalTokens: 3,
				costUSD: 0.1,
				futureDailyField: 42,
				models: {
					alpha: {
						inputTokens: 1,
						outputTokens: 2,
						reasoningOutputTokens: 0,
						cacheCreationTokens: 0,
						cacheReadTokens: 0,
						totalTokens: 3,
						isFallback: false,
						futureModelField: true,
					},
				},
			},
		],
		totals: {
			inputTokens: 1,
			outputTokens: 2,
			reasoningOutputTokens: 0,
			cacheCreationTokens: 0,
			cacheReadTokens: 0,
			totalTokens: 3,
			costUSD: 0.1,
			futureTotalsField: 'ignored',
		},
	};

	const result = buildDashboardData(raw);

	assert.deepEqual(result.tokenSeriesVisibility, {
		inputTokens: true,
		outputTokens: true,
		reasoningOutputTokens: false,
		cacheCreationTokens: false,
		cacheReadTokens: false,
	});
	assert.equal('futureDailyField' in result.daily[0], false);
	assert.equal('futureModelField' in result.daily[0].models.alpha, false);
	assert.equal('futureTotalsField' in result.summary, false);
});

test('accepts normal floating-point cost accumulation differences', () => {
	const raw = canonicalExport();
	raw.daily[0].costUSD = 0.1;
	raw.daily[1].costUSD = 0.1;
	raw.daily[2].costUSD = 0.1;
	raw.totals.costUSD = 0.3;

	const result = buildDashboardData(raw);

	assert.equal(result.summary.costUSD, 0.3);
});

test('builds named user views and a date-union account total without collapsing fallback model-days', () => {
	const myself = canonicalExport();
	const mariusDay = clone(myself.daily[2]);
	mariusDay.models.alpha.isFallback = true;
	mariusDay.models.beta.isFallback = true;
	const marius = exportWithDays([mariusDay]);

	const result = buildMultiUserDashboardData([
		{ id: 'myself', name: 'Myself', raw: myself },
		{ id: 'marius', name: 'Marius', raw: marius },
	]);

	assert.deepEqual(
		result.users.map((user) => ({ id: user.id, name: user.name })),
		[
			{ id: 'myself', name: 'Myself' },
			{ id: 'marius', name: 'Marius' },
		],
	);
	assert.equal(result.account.summary.totalTokens, 85);
	assert.equal(result.account.summary.costUSD, 7.5);
	assert.equal(result.account.summary.recordedDays, 3);
	assert.deepEqual(
		result.account.daily.find((day) => day.date === '2026-02-02'),
		{
			date: '2026-02-02',
			inputTokens: 14,
			outputTokens: 8,
			reasoningOutputTokens: 2,
			cacheCreationTokens: 0,
			cacheReadTokens: 18,
			totalTokens: 40,
			costUSD: 5,
		},
	);
	assert.deepEqual(
		result.account.models.map((model) => ({
			model: model.model,
			totalTokens: model.totalTokens,
			fallbackOccurrences: model.fallbackOccurrences,
		})),
		[
			{ model: 'beta', totalTokens: 45, fallbackOccurrences: 3 },
			{ model: 'alpha', totalTokens: 40, fallbackOccurrences: 2 },
		],
	);
});

test('rejects missing top-level and row fields with a diagnostic path', () => {
	assert.throws(() => buildDashboardData(null), /root must be an object/);
	assert.throws(() => buildDashboardData({ totals: {} }), /root\.daily must be an array/);

	const missingModelMetric = canonicalExport();
	delete missingModelMetric.daily[0].models.beta.outputTokens;
	assert.throws(
		() => buildDashboardData(missingModelMetric),
		/daily\[0\]\.models\.beta\.outputTokens/,
	);
});

test('rejects invalid and duplicate calendar dates', () => {
	const invalidDate = canonicalExport();
	invalidDate.daily[0].date = '2026-02-30';
	assert.throws(() => buildDashboardData(invalidDate), /daily\[0\]\.date must be a valid YYYY-MM-DD date/);

	const duplicateDate = canonicalExport();
	duplicateDate.daily[1].date = '2026-02-04';
	assert.throws(() => buildDashboardData(duplicateDate), /duplicate daily date 2026-02-04/);
});

test('rejects invalid numeric values, reasoning overflow, and non-boolean fallback flags', () => {
	const negativeMetric = canonicalExport();
	negativeMetric.daily[0].costUSD = -1;
	assert.throws(() => buildDashboardData(negativeMetric), /daily\[0\]\.costUSD/);

	const infiniteMetric = canonicalExport();
	infiniteMetric.totals.costUSD = Number.POSITIVE_INFINITY;
	assert.throws(() => buildDashboardData(infiniteMetric), /totals\.costUSD/);

	const reasoningOverflow = canonicalExport();
	reasoningOverflow.daily[0].reasoningOutputTokens = 7;
	assert.throws(
		() => buildDashboardData(reasoningOverflow),
		/daily\[0\]\.reasoningOutputTokens cannot exceed daily\[0\]\.outputTokens/,
	);

	const invalidFallback = canonicalExport();
	invalidFallback.daily[0].models.beta.isFallback = 1;
	assert.throws(() => buildDashboardData(invalidFallback), /daily\[0\]\.models\.beta\.isFallback must be a boolean/);
});

test('rejects token identities and model, daily, or top-level reconciliation failures', () => {
	const invalidModelIdentity = canonicalExport();
	invalidModelIdentity.daily[0].models.beta.totalTokens = 26;
	assert.throws(
		() => buildDashboardData(invalidModelIdentity),
		/daily\[0\]\.models\.beta\.totalTokens must equal input, output, cache creation, and cache read tokens/,
	);

	const invalidModelReconciliation = canonicalExport();
	invalidModelReconciliation.daily[0].inputTokens = 4;
	invalidModelReconciliation.daily[0].totalTokens = 26;
	invalidModelReconciliation.totals.inputTokens = 21;
	invalidModelReconciliation.totals.totalTokens = 66;
	assert.throws(
		() => buildDashboardData(invalidModelReconciliation),
		/daily\[0\]\.inputTokens does not reconcile with its models/,
	);

	const invalidTopLevelReconciliation = canonicalExport();
	invalidTopLevelReconciliation.totals.inputTokens = 21;
	invalidTopLevelReconciliation.totals.totalTokens = 66;
	assert.throws(
		() => buildDashboardData(invalidTopLevelReconciliation),
		/totals\.inputTokens does not reconcile with daily rows/,
	);

	const invalidCostReconciliation = canonicalExport();
	invalidCostReconciliation.totals.costUSD = 5.01;
	assert.throws(
		() => buildDashboardData(invalidCostReconciliation),
		/totals\.costUSD does not reconcile with daily rows/,
	);
});
