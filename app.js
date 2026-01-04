// Aunty Acid Comics App - auntyacidapp.pages.dev

// Service Worker Registration
if ('serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('./sw.js', { scope: './' })
			.then(reg => console.log('SW registered'))
			.catch(err => console.log('SW registration failed'));
	});
}

// Global variables
let currentselectedDate, formattedComicDate, formattedDate;
let year, month, day;
let pictureUrl = '';
let previousUrl = '';
let previousclicked = false;
let deferredPrompt = null;

const START_DATE = new Date('2013-05-06');
const CORS_PROXY = 'https://corsproxy.garfieldapp.workers.dev/cors-proxy?';

/**
 * Preload adjacent comic images for faster navigation
 * @param {Date} currentDate - Current comic date
 */
function preloadAdjacentComics(currentDate) {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	
	// Preload previous comic (if not before start date)
	const prevDate = new Date(currentDate);
	prevDate.setDate(prevDate.getDate() - 1);
	if (prevDate >= START_DATE) {
		const y = prevDate.getFullYear();
		const m = String(prevDate.getMonth() + 1).padStart(2, '0');
		const d = String(prevDate.getDate()).padStart(2, '0');
		const prevUrl = `${CORS_PROXY}https://www.gocomics.com/aunty-acid/${y}/${m}/${d}`;
		
		fetch(prevUrl)
			.then(response => response.text())
			.then(text => {
				const imageUrl = extractComicImageUrl(text);
				if (imageUrl) {
					const img = new Image();
					img.src = imageUrl;
				}
			})
			.catch(() => {}); // Silently ignore errors
	}
	
	// Preload next comic (if not after today)
	const nextDate = new Date(currentDate);
	nextDate.setDate(nextDate.getDate() + 1);
	if (nextDate <= today) {
		const y = nextDate.getFullYear();
		const m = String(nextDate.getMonth() + 1).padStart(2, '0');
		const d = String(nextDate.getDate()).padStart(2, '0');
		const nextUrl = `${CORS_PROXY}https://www.gocomics.com/aunty-acid/${y}/${m}/${d}`;
		
		fetch(nextUrl)
			.then(response => response.text())
			.then(text => {
				const imageUrl = extractComicImageUrl(text);
				if (imageUrl) {
					const img = new Image();
					img.src = imageUrl;
				}
			})
			.catch(() => {}); // Silently ignore errors
	}
}

/**
 * Extract comic image URL from GoComics HTML
 * @param {string} text - HTML content
 * @returns {string|null} Image URL or null
 */
function extractComicImageUrl(text) {
	// Try featureassets CDN (current GoComics CDN)
	let match = text.match(/https:\/\/featureassets\.gocomics\.com\/assets\/[a-f0-9]+/);
	if (match) return match[0];
	
	// Try amuniversal CDN (legacy)
	match = text.match(/https:\/\/assets\.amuniversal\.com\/[a-f0-9]+/);
	if (match) return match[0];
	
	// Try og:image meta tag
	match = text.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
	if (match && match[1] && (match[1].includes('gocomics') || match[1].includes('amuniversal'))) {
		return match[1];
	}
	
	// Fallback to picture tag
	match = text.match(/<picture[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?<\/picture>/i);
	if (match && match[1]) return match[1];
	
	return null;
}

// Helper functions
const $ = (id) => document.getElementById(id);
const getFavs = () => JSON.parse(localStorage.getItem('favs')) || [];
const setFavs = (favs) => localStorage.setItem('favs', JSON.stringify(favs));

function updateFavIcon(isFavorite) {
	const favicon = document.querySelector('.favicon');
	if (favicon) {
		favicon.setAttribute('fill', isFavorite ? 'currentColor' : 'none');
	}
}

function formatDate(datetoFormat) {
	day = String(datetoFormat.getDate()).padStart(2, '0');
	month = String(datetoFormat.getMonth() + 1).padStart(2, '0');
	year = datetoFormat.getFullYear();
}

// Notification Toast System
function showNotification(message, duration = 3000) {
	const toast = $('notificationToast');
	const content = toast.querySelector('.notification-content');
	if (content) content.textContent = message;
	toast.classList.add('show');
	
	if (duration > 0) {
		setTimeout(() => hideNotification(), duration);
	}
}

function hideNotification() {
	const toast = $('notificationToast');
	toast.classList.remove('show');
}

// Settings Panel
function toggleSettings() {
	const panel = document.querySelector('.settings-panel');
	panel.classList.toggle('visible');
	updateExportButtonState();
}

function hideSettings() {
	const panel = document.querySelector('.settings-panel');
	panel.classList.remove('visible');
}

// ========================================
// DRAGGABLE TOOLBAR (GarfieldApp pattern)
// ========================================

/**
 * Calculate optimal centered toolbar position between logo and comic
 * @param {HTMLElement} toolbar - Toolbar element
 * @returns {{top: number, left: number}|null} Optimal position or null if not calculable
 */
function calculateOptimalToolbarPosition(toolbar) {
	const header = document.querySelector('.app-header');
	const comic = $('comic');
	if (!header || !comic) return null;
	
	const headerRect = header.getBoundingClientRect();
	const comicRect = comic.getBoundingClientRect();
	const toolbarHeight = toolbar.offsetHeight || toolbar.getBoundingClientRect().height;
	const toolbarWidth = toolbar.offsetWidth || toolbar.getBoundingClientRect().width;
	
	if (!toolbarHeight || !toolbarWidth) return null;
	
	const headerBottom = headerRect.bottom;
	const comicTop = comicRect.top;
	const availableSpace = comicTop - headerBottom;
	
	// Safety check: if available space is too small or negative, place below header
	if (availableSpace < toolbarHeight + 20) {
		const safeTop = headerBottom + 10;
		const left = (window.innerWidth - toolbarWidth) / 2;
		return { top: safeTop, left };
	}
	
	// Calculate centered position between header and comic
	const top = headerBottom + Math.max(10, (availableSpace - toolbarHeight) / 2);
	const left = (window.innerWidth - toolbarWidth) / 2;
	
	// Final safety: ensure we're not overlapping comic
	if (top + toolbarHeight > comicTop - 5) {
		return { top: Math.max(headerBottom + 10, comicTop - toolbarHeight - 10), left };
	}
	
	return { top, left };
}

/**
 * Check if toolbar is within snap zone of optimal position
 */
function isInSnapZone(top, toolbar) {
	const optimal = calculateOptimalToolbarPosition(toolbar);
	if (!optimal) return false;
	const SNAP_THRESHOLD = 25;
	return Math.abs(top - optimal.top) <= SNAP_THRESHOLD;
}

/**
 * Store toolbar position with relative metadata
 */
function storeToolbarPosition(top, left, toolbar) {
	const positionData = { top, left };
	
	// Track position relative to comic
	const comic = $('comic');
	const toolbarRect = toolbar.getBoundingClientRect();
	
	if (comic && toolbarRect.height > 0) {
		const comicRect = comic.getBoundingClientRect();
		const belowComic = toolbarRect.top >= comicRect.bottom;
		positionData.belowComic = belowComic;
		if (belowComic) {
			positionData.offsetFromComic = Math.max(15, toolbarRect.top - comicRect.bottom);
		}
	}
	
	localStorage.setItem('toolbarPos', JSON.stringify(positionData));
}

/**
 * Keep toolbar within viewport bounds and not overlapping logo/comic
 */
function clampToolbarInView() {
	const toolbar = $('mainToolbar');
	if (!toolbar) return;
	
	const isOptimalMode = localStorage.getItem('toolbarOptimal') === 'true';
	
	if (isOptimalMode) {
		// Toolbar is in optimal mode - recalculate centered position
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				const optimalPos = calculateOptimalToolbarPosition(toolbar);
				if (optimalPos) {
					const header = document.querySelector('.app-header');
					const comic = $('comic');
					
					if (header && comic) {
						const headerRect = header.getBoundingClientRect();
						const comicRect = comic.getBoundingClientRect();
						const toolbarHeight = toolbar.offsetHeight;
						
						let safeTop = optimalPos.top;
						
						// Ensure not overlapping header/logo
						if (safeTop < headerRect.bottom + 10) {
							safeTop = headerRect.bottom + 10;
						}
						
						// Ensure not overlapping comic
						if (safeTop + toolbarHeight > comicRect.top - 5) {
							safeTop = Math.max(headerRect.bottom + 10, comicRect.top - toolbarHeight - 10);
						}
						
						toolbar.style.top = safeTop + 'px';
						toolbar.style.left = optimalPos.left + 'px';
						toolbar.style.transform = 'none';
						storeToolbarPosition(safeTop, optimalPos.left, toolbar);
					} else {
						toolbar.style.top = optimalPos.top + 'px';
						toolbar.style.left = optimalPos.left + 'px';
						toolbar.style.transform = 'none';
					}
				}
			});
		});
		return;
	}
	
	// Custom position mode - maintain relative positioning
	const savedPosRaw = localStorage.getItem('toolbarPos');
	const savedPos = savedPosRaw ? JSON.parse(savedPosRaw) : null;
	
	if (!savedPos) {
		// No saved position - center between logo and comic
		positionToolbarCentered(toolbar);
		return;
	}
	
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			const rect = toolbar.getBoundingClientRect();
			const toolbarHeight = rect.height;
			const toolbarWidth = toolbar.offsetWidth;
			const viewportWidth = window.innerWidth;
			const viewportHeight = window.innerHeight;
			
			const comic = $('comic');
			const header = document.querySelector('.app-header');
			
			let newTop = savedPos.top;
			let newLeft = (viewportWidth - toolbarWidth) / 2; // Always center horizontally
			
			// If below comic, maintain that relationship
			if (savedPos.belowComic && comic) {
				const comicRect = comic.getBoundingClientRect();
				const storedGap = savedPos.offsetFromComic || 15;
				newTop = comicRect.bottom + storedGap;
			}
			
			// Viewport boundary clamping
			const maxTop = viewportHeight - toolbarHeight - 10;
			if (newTop < 0) newTop = 0;
			if (newTop > maxTop) newTop = maxTop;
			
			// Ensure we don't overlap header/logo
			if (header) {
				const headerRect = header.getBoundingClientRect();
				if (newTop < headerRect.bottom + 10) {
					newTop = headerRect.bottom + 10;
				}
			}
			
			// Ensure we don't overlap comic (unless intentionally below it)
			if (comic && !savedPos.belowComic) {
				const comicRect = comic.getBoundingClientRect();
				if (newTop + toolbarHeight > comicRect.top - 5 && newTop < comicRect.bottom) {
					// Toolbar would overlap comic - push it above
					newTop = Math.max(header ? header.getBoundingClientRect().bottom + 10 : 0, comicRect.top - toolbarHeight - 10);
				}
			}
			
			// Apply position if changed
			const currentTop = parseFloat(toolbar.style.top) || 0;
			const currentLeft = parseFloat(toolbar.style.left) || 0;
			
			if (Math.abs(currentTop - newTop) > 1 || Math.abs(currentLeft - newLeft) > 1) {
				toolbar.style.top = newTop + 'px';
				toolbar.style.left = newLeft + 'px';
				toolbar.style.transform = 'none';
				
				// Preserve metadata
				const overrides = savedPos.belowComic ? { belowComic: true, offsetFromComic: savedPos.offsetFromComic || 15 } : {};
				storeToolbarPosition(newTop, newLeft, toolbar);
			}
		});
	});
}

/**
 * Position toolbar centered between header and comic
 */
function positionToolbarCentered(toolbar, savePosition = false) {
	if (!toolbar || toolbar.offsetHeight === 0) return;
	
	const optimal = calculateOptimalToolbarPosition(toolbar);
	if (!optimal) {
		// Fallback: place below header if we can't compute optimal
		const header = document.querySelector('.app-header');
		if (!header) return;
		const headerRect = header.getBoundingClientRect();
		const toolbarWidth = toolbar.offsetWidth || toolbar.getBoundingClientRect().width;
		const left = (window.innerWidth - toolbarWidth) / 2;
		const top = headerRect.bottom + 10;
		toolbar.style.left = left + 'px';
		toolbar.style.top = top + 'px';
		toolbar.style.transform = 'none';
		if (savePosition) {
			storeToolbarPosition(top, left, toolbar);
		}
		return;
	}
	
	toolbar.style.left = optimal.left + 'px';
	toolbar.style.top = optimal.top + 'px';
	toolbar.style.transform = 'none';
	
	if (savePosition) {
		storeToolbarPosition(optimal.top, optimal.left, toolbar);
		localStorage.setItem('toolbarOptimal', 'true');
	}
}

function initializeToolbar() {
	const toolbar = $('mainToolbar');
	if (!toolbar) return;
	
	// Check for saved position
	const savedPosRaw = localStorage.getItem('toolbarPos');
	const savedPos = savedPosRaw ? JSON.parse(savedPosRaw) : null;
	const isOptimalMode = localStorage.getItem('toolbarOptimal') === 'true';
	
	if (savedPos && typeof savedPos.top === 'number') {
		if (isOptimalMode) {
			// Toolbar was in optimal mode - recalculate optimal position on load
			const tryOptimalPosition = () => {
				const optimalPos = calculateOptimalToolbarPosition(toolbar);
				if (optimalPos) {
					toolbar.style.top = optimalPos.top + 'px';
					toolbar.style.left = optimalPos.left + 'px';
					toolbar.style.transform = 'none';
				}
			};
			
			// Try immediately and after load
			setTimeout(tryOptimalPosition, 0);
			setTimeout(tryOptimalPosition, 50);
			window.addEventListener('load', () => {
				setTimeout(tryOptimalPosition, 100);
				setTimeout(() => {
					tryOptimalPosition();
					const pos = calculateOptimalToolbarPosition(toolbar);
					if (pos) storeToolbarPosition(pos.top, pos.left, toolbar);
				}, 300);
			});
		} else {
			// Apply saved custom position immediately
			toolbar.style.top = savedPos.top + 'px';
			toolbar.style.left = (window.innerWidth - toolbar.offsetWidth) / 2 + 'px';
			toolbar.style.transform = 'none';
		}
	} else {
		// No saved position - calculate centered position
		const header = document.querySelector('.app-header');
		if (header) {
			const headerRect = header.getBoundingClientRect();
			toolbar.style.top = (headerRect.bottom + 10) + 'px';
			toolbar.style.left = '50%';
			toolbar.style.transform = 'translateX(-50%)';
		}
		
		// Position correctly after elements load
		const tryPosition = () => {
			toolbar.style.transform = 'none';
			positionToolbarCentered(toolbar, false);
		};
		
		const finalPosition = () => {
			toolbar.style.transform = 'none';
			positionToolbarCentered(toolbar, true);
			localStorage.setItem('toolbarOptimal', 'true');
		};
		
		setTimeout(tryPosition, 0);
		setTimeout(tryPosition, 50);
		setTimeout(tryPosition, 100);
		window.addEventListener('load', () => {
			tryPosition();
			setTimeout(finalPosition, 300);
		});
	}
	
	// Make toolbar draggable (vertical only)
	makeDraggable(toolbar);
	
	// Clamp on resize
	let resizeTimeout;
	window.addEventListener('resize', () => {
		clearTimeout(resizeTimeout);
		resizeTimeout = setTimeout(() => {
			clampToolbarInView();
		}, 100);
	});
}

function makeDraggable(element) {
	let isDragging = false;
	let startY = 0;
	let startTop = 0;
	
	const onStart = (e) => {
		// Don't drag if clicking a button
		if (e.target.closest('.toolbar-button')) return;
		
		isDragging = true;
		const clientY = e.touches ? e.touches[0].clientY : e.clientY;
		startY = clientY;
		startTop = element.offsetTop;
		element.style.cursor = 'grabbing';
		element.style.transition = 'none';
		
		e.preventDefault();
	};
	
	const onMove = (e) => {
		if (!isDragging) return;
		
		const clientY = e.touches ? e.touches[0].clientY : e.clientY;
		const deltaY = clientY - startY;
		let newTop = startTop + deltaY;
		
		// Clamp to viewport
		const minTop = 10;
		const maxTop = window.innerHeight - element.offsetHeight - 10;
		newTop = Math.max(minTop, Math.min(maxTop, newTop));
		
		element.style.top = newTop + 'px';
		
		e.preventDefault();
	};
	
	const onEnd = () => {
		if (!isDragging) return;
		isDragging = false;
		element.style.cursor = 'grab';
		element.style.transition = '';
		
		// Save position with snap-to-optimal behavior
		const numericTop = parseFloat(element.style.top) || 100;
		const numericLeft = parseFloat(element.style.left) || 0;
		
		// Check if in snap zone - if so, snap to optimal
		const optimal = calculateOptimalToolbarPosition(element);
		if (optimal && isInSnapZone(numericTop, element)) {
			element.style.left = optimal.left + 'px';
			element.style.top = optimal.top + 'px';
			element.style.transform = 'none';
			storeToolbarPosition(optimal.top, optimal.left, element);
			localStorage.setItem('toolbarOptimal', 'true');
		} else {
			storeToolbarPosition(numericTop, numericLeft, element);
			localStorage.removeItem('toolbarOptimal');
		}
	};
	
	// Mouse events
	element.addEventListener('mousedown', onStart);
	document.addEventListener('mousemove', onMove);
	document.addEventListener('mouseup', onEnd);
	
	// Touch events
	element.addEventListener('touchstart', onStart, { passive: false });
	document.addEventListener('touchmove', onMove, { passive: false });
	document.addEventListener('touchend', onEnd);
}

function updateExportButtonState() {
	const exportBtn = $('exportFavs');
	const favs = getFavs();
	if (exportBtn) {
		exportBtn.disabled = favs.length === 0;
	}
}

// Export/Import Favorites
function exportFavorites() {
	const favs = getFavs();
	if (favs.length === 0) {
		showNotification('No favorites to export!');
		return;
	}
	
	const data = {
		app: 'AuntyAcid',
		version: '1.0',
		exportDate: new Date().toISOString(),
		favorites: favs
	};
	
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `auntyacid-favorites-${new Date().toISOString().split('T')[0]}.json`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
	
	showNotification(`Exported ${favs.length} favorite(s)!`);
}

function importFavorites() {
	const input = $('importFile');
	if (input) input.click();
}

function handleImportFile(event) {
	const file = event.target.files[0];
	if (!file) return;
	
	const reader = new FileReader();
	reader.onload = (e) => {
		try {
			const data = JSON.parse(e.target.result);
			
			if (!data.favorites || !Array.isArray(data.favorites)) {
				showNotification('Invalid favorites file format!');
				return;
			}
			
			const currentFavs = getFavs();
			const newFavs = [...new Set([...currentFavs, ...data.favorites])].sort();
			setFavs(newFavs);
			
			const importedCount = newFavs.length - currentFavs.length;
			showNotification(`Imported ${importedCount} new favorite(s)! Total: ${newFavs.length}`);
			
			// Update UI
			$('showfavs').disabled = newFavs.length === 0;
			updateExportButtonState();
			CompareDates();
			showComic();
		} catch (err) {
			showNotification('Error reading favorites file!');
		}
	};
	reader.readAsText(file);
	event.target.value = '';
}

// PWA Install Prompt

// Check if app is already installed (standalone mode, including Microsoft Store PWA)
function isAppInstalled() {
	// Check display-mode (works for browser-installed PWAs and Microsoft Store PWAs)
	if (window.matchMedia('(display-mode: standalone)').matches) return true;
	if (window.matchMedia('(display-mode: window-controls-overlay)').matches) return true;
	// iOS Safari standalone mode
	if (navigator.standalone === true) return true;
	// Document referrer check for installed PWAs
	if (document.referrer.includes('android-app://')) return true;
	return false;
}

window.addEventListener('beforeinstallprompt', (e) => {
	// Don't show install prompt if already installed
	if (isAppInstalled()) {
		e.preventDefault();
		return;
	}
	e.preventDefault();
	deferredPrompt = e;
	showInstallButton();
});

// Hide install button when app gets installed
window.addEventListener('appinstalled', () => {
	deferredPrompt = null;
	hideInstallButton();
	showNotification('App installed successfully!');
});

function showInstallButton() {
	// Never show install button if already installed
	if (isAppInstalled()) return;
	const installBtn = $('installBtn');
	if (installBtn && deferredPrompt) {
		installBtn.style.display = 'block';
	}
}

function hideInstallButton() {
	const installBtn = $('installBtn');
	if (installBtn) installBtn.style.display = 'none';
}

async function handleInstall() {
	if (!deferredPrompt) return;
	
	deferredPrompt.prompt();
	const { outcome } = await deferredPrompt.userChoice;
	
	if (outcome === 'accepted') {
		showNotification('App installed successfully!');
	}
	
	deferredPrompt = null;
	hideInstallButton();
}

// Share functionality
async function Share() {
	if (!navigator.share) {
		showNotification('Sharing not supported on this device');
		return;
	}
	
	if (!pictureUrl) {
		showNotification('No comic to share. Please load a comic first.');
		return;
	}
	
	try {
		// Load image into canvas to handle CORS and create shareable blob
		const tempImg = new Image();
		tempImg.crossOrigin = 'anonymous';
		
		// Try loading directly first, then via proxy
		await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
			tempImg.onload = () => { clearTimeout(timeout); resolve(); };
			tempImg.onerror = () => { clearTimeout(timeout); reject(new Error('Load failed')); };
			tempImg.src = pictureUrl;
		}).catch(async () => {
			// Try with CORS proxy on failure
			const proxyUrl = `${CORS_PROXY}${encodeURIComponent(pictureUrl)}`;
			return new Promise((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Proxy timeout')), 5000);
				tempImg.onload = () => { clearTimeout(timeout); resolve(); };
				tempImg.onerror = () => { clearTimeout(timeout); reject(new Error('Proxy failed')); };
				tempImg.src = proxyUrl;
			});
		});
		
		// Convert image to blob via canvas
		const canvas = document.createElement('canvas');
		canvas.width = tempImg.width;
		canvas.height = tempImg.height;
		canvas.getContext('2d').drawImage(tempImg, 0, 0);
		
		const blob = await new Promise((resolve, reject) => {
			canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Blob creation failed')), 'image/jpeg', 0.95);
		});
		
		// Share with file
		const file = new File([blob], 'auntyacid.jpg', { type: 'image/jpeg', lastModified: Date.now() });
		await navigator.share({
			url: 'https://auntyacidapp.pages.dev',
			text: 'Shared from AuntyAcid App',
			files: [file]
		});
	} catch (err) {
		// Fallback to text-only sharing on error
		if (err.name === 'SecurityError' || err.message?.includes('failed')) {
			try {
				await navigator.share({
					url: 'https://auntyacidapp.pages.dev',
					text: `Shared from AuntyAcid App - Comic for ${formattedComicDate || 'today'}`
				});
				return;
			} catch (fallbackErr) {
				// Silent fail if sharing canceled
			}
		}
		
		// Show error only if not user-canceled
		if (err.name !== 'AbortError') {
			showNotification('Failed to share. Please try again.');
		}
	}
}

// Favorites management
function Addfav() {
	formattedComicDate = `${year}/${month}/${day}`;
	let favs = getFavs();
	const index = favs.indexOf(formattedComicDate);
	
	if (index === -1) {
		favs.push(formattedComicDate);
		updateFavIcon(true);
		$('showfavs').disabled = false;
	} else {
		favs.splice(index, 1);
		updateFavIcon(false);
		if (favs.length === 0) {
			$('showfavs').checked = false;
			$('showfavs').disabled = true;
		}
	}
	
	favs.sort();
	setFavs(favs);
	CompareDates();
	showComic();
}

// Navigation functions
function PreviousClick() {
	const favs = getFavs();
	if ($('showfavs').checked) {
		const index = favs.indexOf(formattedComicDate);
		if (index > 0) {
			currentselectedDate = new Date(favs[index - 1]);
		}
	} else {
		currentselectedDate.setDate(currentselectedDate.getDate() - 1);
	}
	previousclicked = true;
	CompareDates();
	showComic('previous'); // Filmstrip slide animation
}

function NextClick() {
	const favs = getFavs();
	if ($('showfavs').checked) {
		const index = favs.indexOf(formattedComicDate);
		if (index < favs.length - 1) {
			currentselectedDate = new Date(favs[index + 1]);
		}
	} else {
		currentselectedDate.setDate(currentselectedDate.getDate() + 1);
	}
	CompareDates();
	showComic('next'); // Filmstrip slide animation
}

function FirstClick() {
	const favs = getFavs();
	currentselectedDate = $('showfavs').checked 
		? new Date(favs[0]) 
		: new Date(Date.UTC(2013, 4, 6, 12));
	CompareDates();
	showComic('morph'); // Blur morph animation
}

function LastClick() {
	const favs = getFavs();
	currentselectedDate = $('showfavs').checked 
		? new Date(favs[favs.length - 1]) 
		: new Date();
	CompareDates();
	showComic('morph'); // Blur morph animation
}

function RandomClick() {
	const favs = getFavs();
	if ($('showfavs').checked) {
		const randomIndex = Math.floor(Math.random() * favs.length);
		currentselectedDate = new Date(favs[randomIndex]);
	} else {
		const start = START_DATE.getTime();
		const end = Date.now();
		currentselectedDate = new Date(start + Math.random() * (end - start));
	}
	CompareDates();
	showComic('morph'); // Blur morph animation
}

function DateChange() {
	currentselectedDate = new Date($('DatePicker').value);
	CompareDates();
	showComic('morph'); // Blur morph animation
}

// Display comic with animation
// direction: 'next', 'previous' for filmstrip slide; 'morph' for blur effect; null for no animation
function showComic(direction = null) {
	formatDate(currentselectedDate);
	formattedDate = `${year}-${month}-${day}`;
	formattedComicDate = `${year}/${month}/${day}`;
	$('DatePicker').value = formattedDate;
	
	const siteUrl = `${CORS_PROXY}https://www.gocomics.com/aunty-acid/${formattedComicDate}`;
	localStorage.setItem('lastcomic', currentselectedDate);
	
	fetch(siteUrl)
		.then(response => {
			if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
			return response.text();
		})
		.then(text => {
			// Extract comic image URL using the reusable function
			const imageUrl = extractComicImageUrl(text);
			
			if (!imageUrl) {
				showNotification('Could not load comic for this date');
				return;
			}
			
			pictureUrl = imageUrl;
			
			// DEBUG: Animation logging
			const DEBUG_ANIMATION = true;
			if (DEBUG_ANIMATION) {
				console.log('🖼️ URL comparison:', { 
					newUrl: pictureUrl?.substring(0, 60) + '...', 
					previousUrl: previousUrl?.substring(0, 60) + '...',
					urlsAreDifferent: pictureUrl !== previousUrl
				});
			}
			
			if (pictureUrl !== previousUrl) {
				const comicImg = $('comic');
				const wrapper = $('comic-wrapper');
				
				// Animate transition based on direction
				// Check if there's an existing image to animate from (not empty, not the page URL)
				const hasExistingImage = comicImg.src && 
					comicImg.src !== '' && 
					comicImg.src !== window.location.href &&
					!comicImg.src.endsWith('/');
				
				if (DEBUG_ANIMATION) {
					console.log('🎬 Animation Debug:', {
						direction,
						hasExistingImage,
						'comicImg.src': comicImg.src,
						'window.location.href': window.location.href,
						'pictureUrl': pictureUrl,
						'previousUrl': previousUrl
					});
				}
				
				if (direction && hasExistingImage) {
					if (DEBUG_ANIMATION) console.log('✅ Animation condition passed, direction:', direction);
					
					if (direction === 'next' || direction === 'previous') {
						if (DEBUG_ANIMATION) console.log('🎞️ Running THROW-OUT animation');
						// THROW-OUT animation - fling old comic away while new fades in
						const throwOutClass = direction === 'previous' ? 'throw-out-right' : 'throw-out-left';
						
						// Create a clone of current comic to throw out
						const outgoingClone = comicImg.cloneNode(true);
						outgoingClone.removeAttribute('id');
						outgoingClone.classList.add('comic-outgoing');
						outgoingClone.classList.remove('throw-out-left', 'throw-out-right', 'no-transition', 'fade-in-new', 'visible');
						wrapper.appendChild(outgoingClone);
						
						// Set new image source - start hidden, fade in
						comicImg.classList.add('fade-in-new');
						comicImg.src = pictureUrl;
						
						// Force reflow
						outgoingClone.offsetHeight;
						
						requestAnimationFrame(() => {
							requestAnimationFrame(() => {
								// Throw out the old comic
								outgoingClone.classList.add(throwOutClass);
								// Fade in new comic
								comicImg.classList.add('visible');
								
								// Cleanup after animation
								setTimeout(() => {
									outgoingClone.remove();
									comicImg.classList.remove('fade-in-new', 'visible');
								}, 400);
							});
						});
					} else if (direction === 'morph') {
						if (DEBUG_ANIMATION) console.log('🌀 Running MORPH animation');
						// BLUR MORPH animation - blur out old, fade in new
						const outgoingClone = comicImg.cloneNode(true);
						outgoingClone.removeAttribute('id');
						// Remove any leftover animation classes from the clone
						outgoingClone.classList.remove('throw-out-left', 'throw-out-right', 'fade-in-new', 'visible', 'no-transition');
						outgoingClone.classList.add('comic-pixelate-outgoing');
						wrapper.appendChild(outgoingClone);
						if (DEBUG_ANIMATION) console.log('🌀 Clone created and appended');
						
						// Reset the main comic and disable transition to prevent any sliding
						comicImg.classList.add('no-transition');
						comicImg.classList.remove('throw-out-left', 'throw-out-right', 'fade-in-new', 'visible');
						comicImg.style.transform = 'translateX(0)';
						
						// Force reflow to apply changes immediately
						comicImg.offsetHeight;
						
						// Load new image underneath
						comicImg.src = pictureUrl;
						
						// Wait for new image to load, THEN blur out clone
						const startMorph = () => {
							if (DEBUG_ANIMATION) console.log('🌀 startMorph() called - blurring out clone');
							// Use requestAnimationFrame to ensure the DOM is ready
							requestAnimationFrame(() => {
								outgoingClone.classList.add('morph-out');
							});
							
							// Remove clone and cleanup after animation completes
							setTimeout(() => {
								if (DEBUG_ANIMATION) console.log('🌀 Morph complete - cleaning up');
								outgoingClone.remove();
								comicImg.classList.remove('no-transition');
								comicImg.style.transform = '';
							}, 600);
						};
						
						// Use requestAnimationFrame to ensure browser has processed the src change
						requestAnimationFrame(() => {
							if (comicImg.complete) {
								if (DEBUG_ANIMATION) console.log('🌀 Image already complete, starting morph immediately');
								startMorph();
							} else {
								if (DEBUG_ANIMATION) console.log('🌀 Waiting for image load...');
								comicImg.addEventListener('load', startMorph, { once: true });
							}
						});
					}
				} else {
					// First load or no animation - just set source
					if (DEBUG_ANIMATION) console.log('❌ Animation skipped - direction:', direction, 'hasExistingImage:', hasExistingImage);
					comicImg.src = pictureUrl;
				}
			} else if (previousclicked) {
				if (DEBUG_ANIMATION) console.log('⚠️ URL same but previousclicked=true, calling PreviousClick()');
				PreviousClick();
			} else {
				if (DEBUG_ANIMATION) console.log('⏭️ URL unchanged, skipping update entirely');
			}
			
			previousclicked = false;
			previousUrl = pictureUrl;
			
			// Update favorite icon based on current comic
			const favs = getFavs();
			updateFavIcon(favs.includes(formattedComicDate));
			
			// Update navigation button states
			CompareDates();
			
			// Preload adjacent comics for faster navigation
			preloadAdjacentComics(currentselectedDate);
			
			// Ensure toolbar doesn't overlap the newly loaded comic
			const comicElement = $('comic');
			if (comicElement.complete) {
				setTimeout(clampToolbarInView, 50);
			} else {
				comicElement.addEventListener('load', () => {
					setTimeout(clampToolbarInView, 50);
				}, { once: true });
			}
		})
		.catch(error => {
			showNotification('Could not load comic');
		});
}

// Date comparison and button state management
function CompareDates() {
	const favs = getFavs();
	const showFavsChecked = $('showfavs').checked;
	let startDate, endDate;
	
	$('DatePicker').disabled = showFavsChecked;
	startDate = showFavsChecked && favs.length ? new Date(favs[0]) : new Date('2013/05/06');
	
	startDate.setHours(0, 0, 0, 0);
	currentselectedDate.setHours(0, 0, 0, 0);
	currentselectedDate = new Date(currentselectedDate);
	
	const isAtStart = currentselectedDate.getTime() <= startDate.getTime();
	$('Previous').disabled = isAtStart;
	$('First').disabled = isAtStart;
	
	if (isAtStart) {
		formatDate(startDate);
		currentselectedDate = new Date(Date.UTC(year, month - 1, day, 12));
	}
	
	endDate = showFavsChecked && favs.length ? new Date(favs[favs.length - 1]) : new Date();
	endDate.setHours(0, 0, 0, 0);
	
	const isAtEnd = currentselectedDate.getTime() >= endDate.getTime();
	$('Next').disabled = isAtEnd;
	$('Last').disabled = isAtEnd;
	
	if (isAtEnd) {
		formatDate(endDate);
		currentselectedDate = new Date(Date.UTC(year, month - 1, day, 12));
	}
	
	if (showFavsChecked && favs.length === 1) {
		$('Random').disabled = true;
		$('Previous').disabled = true;
		$('First').disabled = true;
	} else {
		$('Random').disabled = false;
	}
}

// URL Parameter handling
function handleUrlParams() {
	const params = new URLSearchParams(window.location.search);
	
	if (params.get('action') === 'random') {
		RandomClick();
	}
	
	if (params.get('view') === 'favorites') {
		const favs = getFavs();
		if (favs.length > 0) {
			$('showfavs').checked = true;
			localStorage.setItem('showfavs', 'true');
		}
	}
}

// Initialize App
function initApp() {
	previousclicked = false;
	previousUrl = '';
	
	const favs = getFavs();
	const showFavsChecked = $('showfavs').checked;
	
	if (favs.length === 0) {
		$('showfavs').checked = false;
		$('showfavs').disabled = true;
		currentselectedDate = $('DatePicker').valueAsDate = new Date();
	} else if (showFavsChecked) {
		currentselectedDate = new Date(favs[0]);
	} else {
		currentselectedDate = $('DatePicker').valueAsDate = new Date();
		$('Next').disabled = true;
		$('Current').disabled = true;
	}
	
	formatDate(new Date());
	$('DatePicker').setAttribute('max', `${year}-${month}-${day}`);
	
	if ($('lastdate').checked && localStorage.getItem('lastcomic')) {
		currentselectedDate = new Date(localStorage.getItem('lastcomic'));
	}
	
	// Handle URL parameters
	handleUrlParams();
	
	CompareDates();
	showComic();
	updateExportButtonState();
}

// Native Swipe Detection
const swipeDetection = {
	startX: 0,
	startY: 0,
	threshold: 50, // Minimum distance for swipe
	restraint: 100, // Maximum perpendicular distance
	allowedTime: 500, // Maximum time for swipe
	startTime: 0,
	
	init() {
		const target = document.body;
		
		target.addEventListener('touchstart', (e) => {
			const touch = e.changedTouches[0];
			this.startX = touch.pageX;
			this.startY = touch.pageY;
			this.startTime = Date.now();
		}, { passive: true });
		
		target.addEventListener('touchend', (e) => {
			if (!$('swipe')?.checked) return;
			
			const touch = e.changedTouches[0];
			const distX = touch.pageX - this.startX;
			const distY = touch.pageY - this.startY;
			const elapsedTime = Date.now() - this.startTime;
			
			if (elapsedTime > this.allowedTime) return;
			
			// Horizontal swipe
			if (Math.abs(distX) >= this.threshold && Math.abs(distY) <= this.restraint) {
				if (distX > 0) {
					PreviousClick(); // Swipe right
				} else {
					NextClick(); // Swipe left
				}
			}
			// Vertical swipe
			else if (Math.abs(distY) >= this.threshold && Math.abs(distX) <= this.restraint) {
				if (distY > 0) {
					RandomClick(); // Swipe down
				} else {
					LastClick(); // Swipe up
				}
			}
		}, { passive: true });
	}
};

// Initialize swipe detection
swipeDetection.init();

// Event Listeners - DOM Content Loaded
document.addEventListener('DOMContentLoaded', () => {
	// Initialize checkbox states from localStorage FIRST
	const swipeCheckbox = $('swipe');
	const lastdateCheckbox = $('lastdate');
	const showfavsCheckbox = $('showfavs');
	
	if (swipeCheckbox) swipeCheckbox.checked = localStorage.getItem('stat') !== 'false';
	if (lastdateCheckbox) lastdateCheckbox.checked = localStorage.getItem('lastdate') !== 'false';
	
	const showFavsStatus = localStorage.getItem('showfavs') === 'true';
	if (showfavsCheckbox) showfavsCheckbox.checked = showFavsStatus;
	
	// Navigation buttons
	$('First')?.addEventListener('click', FirstClick);
	$('Previous')?.addEventListener('click', PreviousClick);
	$('Random')?.addEventListener('click', RandomClick);
	$('DatePicker')?.addEventListener('change', DateChange);
	$('Next')?.addEventListener('click', NextClick);
	$('Last')?.addEventListener('click', LastClick);
	
	// Date picker button - opens the hidden date picker
	$('DatePickerBtn')?.addEventListener('click', () => {
		const datePicker = $('DatePicker');
		if (datePicker) {
			datePicker.showPicker?.() || datePicker.click();
		}
	});
	
	// Initialize toolbar
	initializeToolbar();
	
	// Icon buttons
	$('settingsBtn')?.addEventListener('click', toggleSettings);
	$('favheart')?.addEventListener('click', Addfav);
	$('shareBtn')?.addEventListener('click', Share);
	
	// Settings panel
	$('settingsCloseBtn')?.addEventListener('click', hideSettings);
	$('exportFavs')?.addEventListener('click', exportFavorites);
	$('importFavs')?.addEventListener('click', importFavorites);
	$('importFile')?.addEventListener('change', handleImportFile);
	
	// Notification close
	document.querySelector('.notification-close')?.addEventListener('click', hideNotification);
	
	// Install button
	$('installBtn')?.addEventListener('click', handleInstall);
	// Hide install button if app is already installed (including Microsoft Store PWA)
	if (isAppInstalled()) {
		hideInstallButton();
	}
	
	// Checkbox handlers
	$('swipe')?.addEventListener('change', function() {
		localStorage.setItem('stat', this.checked ? 'true' : 'false');
	});
	
	$('lastdate')?.addEventListener('change', function() {
		localStorage.setItem('lastdate', this.checked ? 'true' : 'false');
	});
	
	$('showfavs')?.addEventListener('change', function() {
		localStorage.setItem('showfavs', this.checked ? 'true' : 'false');
		CompareDates();
		showComic();
	});
	
	// Close settings panel when clicking outside
	document.addEventListener('click', (e) => {
		const panel = document.querySelector('.settings-panel');
		const settingsBtn = $('settingsBtn');
		if (panel?.classList.contains('visible') && 
			!panel.contains(e.target) && 
			!settingsBtn?.contains(e.target)) {
			hideSettings();
		}
	});
	
	// Initialize app
	initApp();
});