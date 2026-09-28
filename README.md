# auntyacidapp

Published at https://my-pwa-apps.github.io/auntyacidapp/ by GitHub Pages
from this repository's `main` branch (root directory).

Comic page requests, including adjacent-date preloads, go directly through
the dedicated CORS proxy. GoComics does not permit direct browser fetches
from the app's origin. The proxy worker is deployed separately from `worker/`.

Comic images are selected from GoComics' `og:image` metadata, never the first
generic CDN URL (which can be an unrelated site-wide recommendation). Display
and adjacent-date preloads use the same extractor. The ArcaMax backup is only
displayed when its reported strip date matches the requested date. Failed
loads clear the old image rather than showing it under a new date; stale
requests cannot overwrite newer navigation, and repeated images do not skip dates.

## Preloading

After a successful load, the app warms two comics in each direction, starting
requests 150 ms apart. Favorites-only browsing warms the nearest favorites.
Using Random switches preloading to three random candidates from the active
selection; subsequent Random clicks consume that queue. Ordinary navigation
switches back to adjacent preloading (there is no separate Shuffle toggle).

Preloads are skipped offline, in Data Saver mode, on slow-2g/2g connections,
or below 0.5 Mbps when the browser supplies connection information. Pending
scheduled work is cancelled on navigation, and stale results cannot change
the random queue or navigation controls.

Display and preloads share a bounded, 500-entry in-memory date-to-image cache
and in-flight lookups. No HTML is retained. Today's entries expire after one
minute. Redirected pages are stored only under their actual date; foreground
navigation also updates the date picker to that date. A next-day redirect
back to the current/earlier date, or a 404, temporarily disables Next for one
minute. Transient errors such as 403/timeouts do not disable it.

Run the regression tests with `node --test tests/*.test.js`.
Bump `CACHE_NAME` in `sw.js` when changing cached app files before deploying.