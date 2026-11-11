/**
 * The height the app should take on an installed iOS web app, or null to
 * leave it to CSS. With a translucent status bar, iOS can lay a home-screen
 * app out shorter than the screen -- by about the status bar's height --
 * so the box pinned to the screen's edges stops short and leaves a dead
 * strip under the section bar. The screen's own height is the real one.
 */
export function appHeight(v: { standalone: boolean; innerHeight: number; screenWidth: number; screenHeight: number; landscape: boolean }): number | null {
  if (!v.standalone) return null
  // iOS reports the screen in portrait whichever way the phone is held.
  const tall = v.landscape ? Math.min(v.screenWidth, v.screenHeight) : Math.max(v.screenWidth, v.screenHeight)
  return tall > v.innerHeight ? tall : null
}

/** Keep --app-h on the root element up to date; see appHeight. */
export function fitInstalledScreen(): void {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
    || window.matchMedia('(display-mode: standalone)').matches
  const update = (): void => {
    const h = appHeight({
      standalone,
      innerHeight: window.innerHeight,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      landscape: window.matchMedia('(orientation: landscape)').matches,
    })
    if (h === null) document.documentElement.style.removeProperty('--app-h')
    else document.documentElement.style.setProperty('--app-h', `${h}px`)
  }
  update()
  window.addEventListener('resize', update)
  window.addEventListener('orientationchange', update)
}
