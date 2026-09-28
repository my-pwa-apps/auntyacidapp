'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const extraction = source.slice(source.indexOf('function extractComicImageUrl'), source.indexOf('// ArcaMax fallback'));
const fallback = source.slice(source.indexOf('async function fetchFromArcamax'), source.indexOf('function showArcamaxFallbackNotice'));
const display = source.slice(source.indexOf('function showComic(direction'), source.indexOf('// Date comparison and button state management'));
const dateHelpers = source.slice(source.indexOf('function dateKey'), source.indexOf('function getComic'));
const SITE_IMAGE = 'https://featureassets.gocomics.com/assets/f98fbb20ac400135fdb0005056a9545d';
const JAN_5 = 'https://featureassets.gocomics.com/assets/7ffd84d07179013c2a81005056a9545d';
const JAN_6 = 'https://featureassets.gocomics.com/assets/0123456789abcdef';
const page = url => `<img src="${SITE_IMAGE}"><meta property="og:image" content="${url}">`;

function extractor() {
	const context = vm.createContext({ URL });
	vm.runInContext(extraction, context);
	return context.extractComicImageUrl;
}

test('two dates with the same site-wide image select their own og:image', () => {
	const extract = extractor();
	assert.equal(extract(page(JAN_5)), JAN_5);
	assert.equal(extract(page(JAN_6)), JAN_6);
});

test('metadata supports either attribute order, name, single quotes and escaped ampersands', () => {
	const extract = extractor();
	assert.equal(extract(`<META content='${JAN_5}?width=1400&amp;quality=90' name='og:image'>`), `${JAN_5}?width=1400&quality=90`);
	assert.equal(extract('<meta property="og:image" content="https://assets.amuniversal.com/abcdef">'), 'https://assets.amuniversal.com/abcdef');
});

test('missing, malformed or foreign metadata never falls back to unrelated assets', () => {
	const extract = extractor();
	for (const html of [undefined, '', `<img src="${SITE_IMAGE}">`, page('not a URL'), page('https://featureassets.gocomics.com.evil.example/abc'), page('http://featureassets.gocomics.com/assets/abc')]) {
		assert.equal(extract(html), null);
	}
	assert.equal(extract(page('https://example.com/abc') + page(JAN_5)), JAN_5);
});

test('ArcaMax backup requires the requested calendar date, not just its latest image', async () => {
	const context = vm.createContext({
		_arcamaxModule: { getAuthenticatedComic: async () => ({ success: true, imageUrl: JAN_5, stripDate: new Date(2024, 0, 5) }) }
	});
	vm.runInContext(fallback, context);
	assert.equal(await context.fetchFromArcamax(new Date(2024, 0, 5)), JAN_5);
	assert.equal(await context.fetchFromArcamax(new Date(2024, 0, 6)), null);
	context._arcamaxModule.getAuthenticatedComic = async () => ({ success: true, imageUrl: JAN_5, stripDate: null });
	assert.equal(await context.fetchFromArcamax(new Date(2024, 0, 5)), null);
});

function displayContext(fetchComicPageHtml) {
	const nodes = {
		comic: {
			src: JAN_6,
			complete: true,
			removeAttribute(name) { if (name === 'src') this.src = ''; }
		},
		DatePicker: {},
		showfavs: { checked: false }
	};
	const notices = [];
	const context = vm.createContext({
		URL, Date,
		currentselectedDate: new Date(2024, 0, 5),
		comicLoadSequence: 0,
		pictureUrl: JAN_6,
		previousUrl: JAN_6,
		START_DATE: new Date(2013, 4, 6),
		cancelPreloads() {},
		randomBrowsing: false,
		getComic: async date => {
			const { text } = await fetchComicPageHtml(date);
			return { url: context.extractComicImageUrl(text), date: context.extractComicPageDate(text) || date };
		},
		fetchFromArcamax: async () => null,
		$: id => nodes[id],
		window: { location: { href: 'https://example.com/' } },
		localStorage: { setItem() {} },
		getFavs: () => [],
		updateFavIcon() {},
		CompareDates() {},
		preloadAdjacentComics() {},
		clampToolbarInView() {},
		hideArcamaxFallbackNotice() {},
		showArcamaxFallbackNotice() {},
		showNotification: message => notices.push(message),
		setTimeout() {},
		console: { warn() {} }
	});
	vm.runInContext(`
		let year, month, day, formattedDate, formattedComicDate;
		function formatDate(date) {
			year = date.getFullYear();
			month = String(date.getMonth() + 1).padStart(2, '0');
			day = String(date.getDate()).padStart(2, '0');
		}
		${extraction}
		${dateHelpers}
		${display}
	`, context);
	return { context, nodes, notices };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('display uses comic metadata and does not skip a date with a repeated strip', async () => {
	const requests = [];
	const { context, nodes } = displayContext(async date => {
		requests.push(date);
		return { text: page(JAN_5) };
	});
	context.showComic();
	await settle();
	assert.equal(nodes.comic.src, JAN_5);
	context.currentselectedDate = new Date(2024, 0, 4);
	context.showComic();
	await settle();
	assert.equal(nodes.DatePicker.value, '2024-01-04');
	assert.equal(nodes.comic.src, JAN_5);
	assert.deepEqual(requests, ['2024/01/05', '2024/01/04']);
});

test('out-of-order responses cannot overwrite the newly selected date', async () => {
	const pending = [];
	const { context, nodes } = displayContext(() => new Promise(resolve => pending.push(resolve)));
	context.showComic();
	context.currentselectedDate = new Date(2024, 0, 6);
	context.showComic();
	pending[1]({ text: page(JAN_6) });
	await settle();
	pending[0]({ text: page(JAN_5) });
	await settle();
	assert.equal(nodes.DatePicker.value, '2024-01-06');
	assert.equal(nodes.comic.src, JAN_6);
});

test('failed extraction clears the old comic rather than relabeling it', async () => {
	const { context, nodes, notices } = displayContext(async () => ({ text: `<img src="${SITE_IMAGE}">` }));
	context.showComic();
	await settle();
	assert.equal(nodes.comic.src, '');
	assert.equal(context.pictureUrl, '');
	assert.match(notices[0], /Could not load the comic for 2024\/01\/05/);
});

test('an old fallback cannot replace a later successful navigation', async () => {
	let finishFallback;
	const { context, nodes } = displayContext(async date => {
		if (date === '2024/01/05') throw new Error('HTTP 403');
		return { text: page(JAN_6) };
	});

	context.fetchFromArcamax = () => new Promise(resolve => { finishFallback = resolve; });
	context.showComic();
	await settle();
	context.currentselectedDate = new Date(2024, 0, 6);
	context.showComic();
	await settle();
	finishFallback(JAN_5);
	await settle();
	assert.equal(nodes.comic.src, JAN_6);
	assert.equal(nodes.DatePicker.value, '2024-01-06');
});

test('foreground redirects display and label the actual comic date', async () => {
	const { context, nodes } = displayContext(async () => ({
		text: page(JAN_5) + '<meta property="og:url" content="https://www.gocomics.com/aunty-acid/2024/01/04">'
	}));
	context.showComic();
	await settle();
	assert.equal(nodes.DatePicker.value, '2024-01-04');
	assert.equal(nodes.comic.src, JAN_5);
});
