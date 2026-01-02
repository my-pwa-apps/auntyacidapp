# Aunty Acid PWA - AI Coding Instructions

## Project Overview
A Progressive Web App for browsing Aunty Acid comic strips from GoComics. Deployed to Cloudflare Pages at `auntyacidapp.pages.dev`. Part of a family of comic apps (shares patterns with GarfieldApp, DirkJanApp).

## Architecture

### Core Files (in repository root)
- `index.html` - Single-page app with toolbar, settings panel, notification toast
- `app.js` - All application logic (~1150 lines): navigation, favorites, sharing, swipe, draggable toolbar
- `main.css` - Pink/purple themed styles with CSS custom properties (~820 lines)
- `sw.js` - Service worker with stale-while-revalidate caching + navigation fallback
- `manifest.webmanifest` - PWA manifest (uses relative paths `./` for cross-platform compatibility)

### Comic Data Flow
1. User navigates (buttons/swipe/date picker)
2. `showComic(direction)` fetches GoComics page via CORS proxy
3. `extractComicImageUrl()` extracts image using regex patterns (featureassets.gocomics.com or assets.amuniversal.com)
4. Comic displayed with animations: `'next'`/`'previous'` (throw-out), `'morph'` (blur), or `null` (instant)
5. Adjacent comics preloaded via `preloadAdjacentComics()`

### Key Constants
```javascript
const START_DATE = new Date('2013-05-06');  // First Aunty Acid comic
const CORS_PROXY = 'https://corsproxy.garfieldapp.workers.dev/cors-proxy?';
```

## Code Patterns

### DOM Helper
Use `$()` for getElementById: `$('comic')`, `$('DatePicker')`, `$('mainToolbar')`, etc.

### LocalStorage Keys
- `favs` - JSON array of favorite dates (format: "YYYY/MM/DD")
- `lastcomic` - Last viewed comic date
- `stat` - Swipe enabled ("true"/"false")
- `showfavs` - Show only favorites mode ("true"/"false")
- `lastdate` - Remember last comic setting
- `toolbarPos` - JSON object `{top, left, belowComic?, offsetFromComic?}`
- `toolbarOptimal` - Toolbar in auto-centered mode ("true")

### Favorites Pattern
```javascript
const getFavs = () => JSON.parse(localStorage.getItem('favs')) || [];
const setFavs = (favs) => localStorage.setItem('favs', JSON.stringify(favs));
```

### Notification Toast
```javascript
showNotification('Message here', 3000);  // duration in ms, 0 = persistent
hideNotification();
```

### Event Listeners
Use optional chaining with addEventListener in DOMContentLoaded:
```javascript
$('buttonId')?.addEventListener('click', handlerFunction);
```

### Draggable Toolbar System
Toolbar uses snap-to-optimal positioning between header and comic:
- `initializeToolbar()` - Sets up position from localStorage or calculates optimal
- `makeDraggable()` - Vertical-only drag with snap zones
- `clampToolbarInView()` - Keeps toolbar visible after resize/comic load

## CSS Conventions

### Theme Colors (Pink/Purple)
```css
--primary-color: #9b59b6;      /* Purple */
--primary-light: #ffc0cb;       /* Pink */
--primary-gradient: linear-gradient(135deg, #ffc0cb 0%, #ff69b4 100%);
```

### Component Classes
- `.toolbar` / `.toolbar-button` - Floating draggable navigation bar with SVG icons
- `.settings-panel` / `.settings-panel.visible` - Modal settings panel
- `.notification-toast` / `.notification-toast.show` - Toast messages
- `.icon-button` - Circular action buttons (settings, favorite, share)
- `.comic-outgoing`, `.throw-out-left/right`, `.fade-in-new` - Comic transition animations

## Service Worker
Bump `CACHE_NAME` version in `sw.js` when deploying changes:
```javascript
const CACHE_NAME = 'auntyacid-v27';  // Increment version number
```

## PWA Manifest
Use relative paths (`./`) for all URLs to ensure cross-platform compatibility (Android & Windows):
```json
"start_url": ".",
"scope": ".",
"icons": [{ "src": "./manifest-icon-192.maskable.png", ... }]
```

## Deployment
- Hosted on Cloudflare Pages at `auntyacidapp.pages.dev`
- Push to main branch triggers auto-deploy
- No build step required (static files)

## Related Projects
Reference `https://github.com/my-pwa-apps/GarfieldApp` for shared patterns
