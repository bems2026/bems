// `render.mjs` opens each template twice — once plain, once with `?theme=dark` — and this is
// the only thing that tells them apart. Same `data-theme` attribute the app itself flips.
if (new URLSearchParams(location.search).get('theme') === 'dark') {
  document.documentElement.dataset.theme = 'dark';
}
