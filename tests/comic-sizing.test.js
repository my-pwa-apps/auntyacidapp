'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const sizing = source.slice(source.indexOf('function fitComicToViewport'), source.indexOf('function initializeComicSizing'));

function harness() {
	const properties = {};
	const nodes = {
		comic: { naturalWidth: 1000, naturalHeight: 800 },
		'comic-wrapper': { style: {}, getBoundingClientRect: () => ({ top: 200 }) },
		mainToolbar: { offsetHeight: 66 },
		'comic-container': { paddingBottom: '10px' },
		'controls-container': { getBoundingClientRect: () => ({ height: 80 }) }
	};
	const elements = {
		main: { paddingBottom: '8px' },
		'.copyright-footer': { offsetHeight: 18 }
	};
	const context = vm.createContext({
		$: id => nodes[id],
		document: {
			body: { paddingBottom: '40px' },
			documentElement: { style: { setProperty: (key, value) => { properties[key] = value; } } },
			querySelector: selector => elements[selector]
		},
		window: { innerHeight: 700, scrollY: 0 },
		getComputedStyle: element => element,
		clampToolbarInView() {}
	});
	vm.runInContext(sizing, context);
	return { context, nodes, elements, properties, width: () => parseFloat(nodes['comic-wrapper'].style.maxWidth) };
}

test('comic height fits the viewport after reserving navigation, controls and footer', () => {
	const h = harness();
	h.context.fitComicToViewport();
	assert.equal(h.width(), (700 - 200 - 18 - 80 - 40) * 1000 / 800);
	assert.equal(h.properties['--toolbar-space'], '86px');
});

test('larger windows retain the original 900px maximum width', () => {
	const h = harness();
	h.context.window.innerHeight = 1600;
	h.context.fitComicToViewport();
	assert.equal(h.width(), 900);
});

test('scroll position does not change the fitted size', () => {
	const h = harness();
	h.context.fitComicToViewport();
	const width = h.width();
	h.context.window.scrollY = 100;
	h.nodes['comic-wrapper'].getBoundingClientRect = () => ({ top: 100 });
	h.context.fitComicToViewport();
	assert.equal(h.width(), width);
});

test('mobile visible viewport is used without shrinking the comic during pinch zoom', () => {
	const h = harness();
	h.context.window.visualViewport = { scale: 1, height: 600 };
	h.context.fitComicToViewport();
	assert.equal(h.width(), (600 - 200 - 18 - 80 - 40) * 1000 / 800);
	h.context.window.visualViewport = { scale: 2, height: 300 };
	h.context.fitComicToViewport();
	assert.equal(h.width(), (700 - 200 - 18 - 80 - 40) * 1000 / 800);
});

test('exceptionally short windows retain a visible comic with scrolling', () => {
	const h = harness();
	h.context.window.innerHeight = 250;
	h.context.fitComicToViewport();
	assert.equal(h.width(), 80 * 1000 / 800);
});

test('image loads and footer wrapping are accounted for without invalid sizes', () => {
	const h = harness();
	h.nodes.comic.naturalWidth = 0;
	h.context.fitComicToViewport();
	assert.equal(h.nodes['comic-wrapper'].style.maxWidth, undefined);
	h.nodes.comic.naturalWidth = 800;
	h.nodes.comic.naturalHeight = 1000;
	h.elements['.copyright-footer'].offsetHeight = 50;
	h.context.fitComicToViewport();
	assert.equal(h.width(), (700 - 200 - 18 - 80 - 58) * 800 / 1000);
});

test('fractional control heights do not produce an extra scrollbar', () => {
	const h = harness();
	h.nodes['controls-container'].getBoundingClientRect = () => ({ height: 80.4 });
	h.context.fitComicToViewport();
	assert.equal(h.width(), 361 * 1000 / 800);
});
