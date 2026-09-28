'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const constants = source.slice(source.indexOf('const GO_COMICS_BASE_URL'), source.indexOf('function getStoredJson'));
const helpers = source.slice(source.indexOf('function buildComicPageUrl'), source.indexOf('async function fetchShareImageBlob'));
const proxyUrl = 'https://auntyacid-corsproxy.garfieldapp.workers.dev/?';

function createLookup(fetch) {
	const context = vm.createContext({ fetch, AbortSignal });
	vm.runInContext(`${constants}\n${helpers}`, context);
	return context.fetchComicPageHtml;
}

test('page lookup makes only one encoded proxy request and preserves its result', async () => {
	const requests = [];
	const lookup = createLookup(async (url, options) => {
		requests.push({ url, options });
		return { ok: true, text: async () => '<html>comic page</html>' };
	});
	const result = await lookup('2026/09/20');
	assert.equal(requests.length, 1);
	assert.equal(requests[0].url, proxyUrl + encodeURIComponent('https://www.gocomics.com/aunty-acid/2026/09/20'));
	assert.ok(requests[0].options.signal instanceof AbortSignal);
	assert.equal(result.text, '<html>comic page</html>');
	assert.equal(result.usedProxy, true);
});

test('proxy HTTP errors surface without trying GoComics directly', async () => {
	const requests = [];
	const lookup = createLookup(async url => {
		requests.push(url);
		return { ok: false, status: 503 };
	});
	await assert.rejects(lookup('2026/09/20'), /Proxy fetch failed \(503\)/);
	assert.equal(requests.length, 1);
	assert.ok(requests[0].startsWith(proxyUrl));
});

test('network and timeout failures propagate without a direct-fetch fallback', async () => {
	for (const error of [new TypeError('Network failure'), new DOMException('Timed out', 'TimeoutError')]) {
		let requests = 0;
		const lookup = createLookup(async url => {
			requests++;
			assert.ok(url.startsWith(proxyUrl));
			throw error;
		});
		await assert.rejects(lookup('2026/09/20'), failure => failure === error);
		assert.equal(requests, 1);
	}
});
