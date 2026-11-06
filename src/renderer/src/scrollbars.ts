// 滚动条平时隐去：滚动时、鼠标靠近时出现（加 .sb-on，样式里淡入淡出），停下约 1 秒后淡出。按住不放时不淡出，方便拖动。
const IDLE_MS = 1000
const NEAR_PX = 32

const timers = new Map<Element, ReturnType<typeof setTimeout>>()
let pressed = false

function show(el: Element) {
  el.classList.add('sb-on')
  clearTimeout(timers.get(el))
  timers.set(el, setTimeout(() => {
    if (pressed) return show(el) // 还按着：再等一轮
    el.classList.remove('sb-on')
    timers.delete(el)
  }, IDLE_MS))
}

// 鼠标所在元素和它的祖先里，鼠标贴近滚动条那一边的滚动容器
function showNear(e: MouseEvent) {
  for (let el = e.target instanceof Element ? e.target : null; el; el = el.parentElement) {
    const down = el.scrollHeight > el.clientHeight
    const across = el.scrollWidth > el.clientWidth
    if (!down && !across) continue
    const r = el.getBoundingClientRect()
    const near = (down && e.clientX >= r.right - NEAR_PX) || (across && e.clientY >= r.bottom - NEAR_PX)
    if (!near) continue
    const { overflowX, overflowY } = getComputedStyle(el)
    if ((down && /auto|scroll/.test(overflowY)) || (across && /auto|scroll/.test(overflowX))) show(el)
  }
}

export function autoHideScrollbars() {
  const opts = { capture: true, passive: true }
  document.addEventListener('scroll', (e) => e.target instanceof Element && show(e.target), opts)
  document.addEventListener('mousemove', showNear, opts)
  document.addEventListener('mousedown', (e) => ((pressed = true), showNear(e)), opts)
  document.addEventListener('mouseup', () => (pressed = false), opts)
  window.addEventListener('blur', () => (pressed = false)) // 按着切走窗口时收不到 mouseup
}
