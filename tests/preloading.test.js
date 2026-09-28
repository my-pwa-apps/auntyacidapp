'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const constants = source.slice(source.indexOf('const START_DATE'), source.indexOf('function getStoredJson'));
const helpers = source.slice(source.indexOf('function shouldPrefetch'), source.indexOf('// ArcaMax fallback'));
const randomClick = source.slice(source.indexOf('function RandomClick'), source.indexOf('function DateChange'));
const IMAGE = 'https://featureassets.gocomics.com/assets/0123456789abcdef';
const html = key => `<meta content="${IMAGE}" property="og:image"><link href="https://www.gocomics.com/aunty-acid/${key}" rel="canonical">`;
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(fetchPage = async key => ({ text: html(key) })) {
	const timers = [];
	const requests = [];
	const images = [];
	const warnings = [];
	const favorites = [];
	const nodes = { showfavs: { checked: false }, Next: { disabled: false } };
	let clock = new Date(2026, 8, 28, 12).getTime();
	class ClockDate extends Date {
		constructor(...args) { super(...(args.length ? args : [clock])); }
		static now() { return clock; }
	}
	const context = vm.createContext({
		URL, Date: ClockDate,
		navigator: { onLine: true },
		currentselectedDate: new Date(2024, 0, 5),
		$: id => nodes[id],
		getFavs: () => favorites,
		fetchComicPageHtml: key => { requests.push(key); return fetchPage(key); },
		Image: class { set src(value) { images.push(value); } },
		setTimeout: (callback, delay) => { const timer = { callback, delay, cancelled: false }; timers.push(timer); return timer; },
		clearTimeout: timer => { if (timer) timer.cancelled = true; },
		console: { warn: (...args) => warnings.push(args) },
		CompareDates: () => { nodes.Next.disabled = vm.runInContext('unpublishedNext === dateKey(currentselectedDate)', context); },
		showNotification() {},
		showComic: (direction, randomMode) => { context.lastShow = { direction, randomMode }; }
	});
	vm.runInContext(`${constants}\n${helpers}\n${randomClick}`, context);
	return {
		context, nodes, timers, requests, images, warnings, favorites,
		read: code => vm.runInContext(code, context),
		advance: ms => { clock += ms; },
		runScheduled: async () => {
			const work = timers.splice(0);
			for (const timer of work) {
				if (!timer.cancelled) timer.callback();
				await settle();
			}
		}
	};
}

test('two comics in each direction start 150ms apart and navigation reuses the lookup', async () => {
	const h = harness();
	h.context.preloadAdjacentComics(h.context.currentselectedDate);
	assert.deepEqual(h.timers.map(timer => timer.delay), [0, 150, 300, 450]);
	await h.runScheduled();
	assert.deepEqual(h.requests, ['2024/01/04', '2024/01/06', '2024/01/03', '2024/01/07']);
	assert.equal(h.images.length, 4);
	await h.context.getComic('2024/01/06');
	assert.equal(h.requests.length, 4, 'navigating to a preloaded date must not fetch the page again');
});

test('in-progress foreground and preload requests share one lookup', async () => {
	let finish;
	const h = harness(() => new Promise(resolve => { finish = resolve; }));
	const first = h.context.getComic('2024/01/05');
	const second = h.context.getComic('2024/01/05');
	assert.equal(first, second);
	assert.equal(h.requests.length, 1);
	finish({ text: html('2024/01/05') });
	await first;
	assert.equal(h.read('inflightComics.size'), 0);
});

test('failed lookups are not cached and can be retried', async () => {
	let fail = true;
	const h = harness(async key => {
		if (fail) throw Object.assign(new Error('Forbidden'), { status: 403 });
		return { text: html(key) };
	});
	await assert.rejects(h.context.getComic('2024/01/05'), /Forbidden/);
	fail = false;
	await h.context.getComic('2024/01/05');
	assert.equal(h.requests.length, 2);
});

test('cache is bounded and today expires after one minute', async () => {
	const h = harness();
	for (let index = 0; index < 501; index++) {
		const key = h.context.dateKey(new Date(2020, 0, 1 + index));
		await h.context.getComic(key);
	}
	assert.equal(h.read('comicCache.size'), 500);
	assert.equal(h.read("comicCache.has('2020/01/01')"), false);
	await h.context.getComic('2026/09/28');
	const count = h.requests.length;
	await h.context.getComic('2026/09/28');
	assert.equal(h.requests.length, count);
	h.advance(60000);
	await h.context.getComic('2026/09/28');
	assert.equal(h.requests.length, count + 1);
});

test('connection guards cover Data Saver, 2G, downlink threshold and offline', () => {
	const h = harness();
	for (const connection of [{ saveData: true }, { effectiveType: 'slow-2g' }, { effectiveType: '2g' }, { downlink: 0.49 }]) {
		h.context.navigator.connection = connection;
		h.context.preloadAdjacentComics(h.context.currentselectedDate);
		assert.equal(h.timers.length, 0);
	}
	h.context.navigator.connection = { downlink: 0.5, effectiveType: '4g' };
	assert.equal(h.context.shouldPrefetch(), true);
	delete h.context.navigator.connection;
	assert.equal(h.context.shouldPrefetch(), true);
	h.context.navigator.onLine = false;
	assert.equal(h.context.shouldPrefetch(), false);
});

test('preloads respect first and latest date boundaries', async () => {
	const h = harness();
	h.context.currentselectedDate = new Date(2013, 4, 6);
	h.context.preloadAdjacentComics(h.context.currentselectedDate);
	await h.runScheduled();
	assert.deepEqual(h.requests, ['2013/05/07', '2013/05/08']);
	h.context.currentselectedDate = new Date(2026, 8, 28);
	h.context.cancelPreloads();
	h.context.preloadAdjacentComics(h.context.currentselectedDate);
	await h.runScheduled();
	assert.deepEqual(h.requests.slice(2), ['2026/09/27', '2026/09/26']);
});

test('favorites preloads follow the selected list rather than calendar neighbors', async () => {
	const h = harness();
	h.nodes.showfavs.checked = true;
	h.favorites.push('2024/01/01', '2024/01/03', '2024/01/05', '2024/02/01', '2024/03/01');
	h.context.preloadAdjacentComics(h.context.currentselectedDate);
	await h.runScheduled();
	assert.deepEqual(h.requests, ['2024/01/03', '2024/02/01', '2024/01/01', '2024/03/01']);
});

test('cancelled and obsolete scheduled work cannot start more lookups', async () => {
	const h = harness();
	h.context.preloadAdjacentComics(h.context.currentselectedDate);
	h.context.cancelPreloads();
	await h.runScheduled();
	assert.equal(h.requests.length, 0);
	h.context.preloadAdjacentComics(h.context.currentselectedDate);
	h.context.navigator.connection = { saveData: true };
	await h.runScheduled();
	assert.equal(h.requests.length, 0);
});

test('a redirected next day disables Next temporarily without poisoning its cache', async () => {
	const h = harness(async key => ({ text: html(key === '2024/01/06' ? '2024/01/05' : key) }));
	h.context.preloadAdjacentComics(h.context.currentselectedDate);
	await h.runScheduled();
	assert.equal(h.nodes.Next.disabled, true);
	assert.equal(h.read("comicCache.has('2024/01/06')"), false);
	assert.equal(h.read("comicCache.has('2024/01/05')"), true);
	assert.equal(h.timers[0].delay, 60000);
	await h.runScheduled();
	assert.equal(h.nodes.Next.disabled, false);
});

test('only a definitive 404 disables Next; 403, timeout and missing metadata do not', async () => {
	for (const status of [403, 404, 500, 'TimeoutError', 'no-image']) {
		const h = harness(async key => {
			if (key !== '2024/01/06') return { text: html(key) };
			if (status === 'no-image') return { text: '<html>No metadata</html>' };
			throw Object.assign(new Error('Lookup failed'), { status });
		});
		h.context.preloadAdjacentComics(h.context.currentselectedDate);
		await h.runScheduled();
		assert.equal(h.nodes.Next.disabled, status === 404, String(status));
		assert.ok(h.warnings.length);
	}
});

test('stale availability results cannot disable navigation after another load', async () => {
	let finish;
	const h = harness(key => key === '2024/01/06'
		? new Promise(resolve => { finish = resolve; })
		: Promise.resolve({ text: html(key) }));
	h.context.preloadAdjacentComics(h.context.currentselectedDate);
	await h.runScheduled();
	h.context.cancelPreloads();
	h.context.currentselectedDate = new Date(2024, 1, 1);
	finish({ text: html('2024/01/05') });
	await settle();
	assert.equal(h.nodes.Next.disabled, false);
});

test('Random warms three distinct candidates and consumes cached dates', async () => {
	const h = harness();
	h.read('randomBrowsing = true');
	h.context.preloadAdjacentComics(h.context.currentselectedDate);
	assert.deepEqual(h.timers.map(timer => timer.delay), [0, 150, 300]);
	await h.runScheduled();
	assert.equal(new Set(h.requests).size, 3);
	assert.ok(!h.requests.includes('2024/01/05'));
	const queued = h.read('randomQueue[0].date');
	h.context.RandomClick();
	assert.equal(h.context.dateKey(h.context.currentselectedDate), queued);
	assert.equal(h.context.lastShow.randomMode, true);
	await h.context.getComic(queued);
	assert.equal(h.requests.length, 3);
});

test('random queues respect favorites and discard work when that selection changes', async () => {
	const h = harness();
	h.nodes.showfavs.checked = true;
	h.favorites.push('2024/01/05', '2024/02/01', '2024/03/01', '2024/04/01');
	h.read('randomBrowsing = true');
	h.context.preloadAdjacentComics(h.context.currentselectedDate);
	await h.runScheduled();
	assert.equal(h.read('randomQueue.length'), 3);
	assert.ok(h.requests.every(key => h.favorites.includes(key)));
	h.favorites.splice(0, h.favorites.length, '2024/05/01');
	h.context.RandomClick();
	assert.equal(h.context.dateKey(h.context.currentselectedDate), '2024/05/01');
	assert.equal(h.read('randomQueue.length'), 0);
});

test('date parsing is local and page dates support both metadata attribute orders', () => {
	const h = harness();
	assert.equal(h.context.dateFromKey('2024-03-10').getHours(), 0);
	assert.equal(h.context.dateFromKey('2024-02-30'), null);
	assert.equal(h.context.extractComicPageDate('<meta content="https://www.gocomics.com/aunty-acid/2024/03/10" property="og:url">'), '2024/03/10');
	assert.equal(h.context.extractComicPageDate(html('2024/03/10')), '2024/03/10');
	assert.equal(h.context.extractComicPageDate(html('2024/02/30')), null);
});

test('Random shortcut starts one random load rather than replacing it with ordinary navigation', () => {
	const h = harness();
	h.context.URLSearchParams = URLSearchParams;
	h.context.window = { location: { search: '?action=random' } };
	h.context.localStorage = { getItem: () => null };
	h.context.formatDate = () => { h.context.year = 2026; h.context.month = '09'; h.context.day = '28'; };
	h.context.updateExportButtonState = () => {};
	h.nodes.DatePicker = { setAttribute() {} };
	h.nodes.lastdate = { checked: false };
	const loads = [];
	h.context.showComic = (direction, randomMode) => loads.push({ direction, randomMode });
	const startup = source.slice(source.indexOf('function handleUrlParams'), source.indexOf('// Native Swipe Detection'));
	vm.runInContext(startup, h.context);
	h.context.initApp();
	assert.equal(loads.length, 1);
	assert.equal(loads[0].randomMode, true);
});
