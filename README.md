# auntyacidapp

Published at https://my-pwa-apps.github.io/auntyacidapp/ by GitHub Pages
from this repository's `main` branch (root directory).

Comic page requests, including adjacent-date preloads, go directly through
the dedicated CORS proxy. GoComics does not permit direct browser fetches
from the app's origin. The proxy worker is deployed separately from `worker/`.

Run the page-fetch regression tests with `node --test tests/page-fetch.test.js`.
Bump `CACHE_NAME` in `sw.js` when changing cached app files before deploying.