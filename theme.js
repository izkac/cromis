// One source of truth for the theme: the visitor's own choice if they made one,
// otherwise whatever the OS asks for. Loaded blocking in <head>, so the right
// palette is stamped on <html> before the first paint and nothing flashes.
(() => {
  const root = document.documentElement
  const light = matchMedia("(prefers-color-scheme: light)")
  const stored = () => {
    try { return localStorage.getItem("theme") } catch { return null }
  }
  const apply = (theme) => { root.dataset.theme = theme }

  apply(stored() || (light.matches ? "light" : "dark"))

  // Follow the OS until the visitor picks a side.
  light.addEventListener("change", (e) => {
    if (!stored()) apply(e.matches ? "light" : "dark")
  })

  addEventListener("DOMContentLoaded", () => {
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      button.addEventListener("click", () => {
        const next = root.dataset.theme === "light" ? "dark" : "light"
        apply(next)
        try { localStorage.setItem("theme", next) } catch { /* private mode */ }
      })
    }
  })
})()
