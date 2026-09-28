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

Run the regression tests with `node --test tests/*.test.js`.
Bump `CACHE_NAME` in `sw.js` when changing cached app files before deploying.