// In a browser the Studio lives in a frame over the app; borrow its doorway.
window.slake = parent.slakeStudio
window.slakeWallUrl = parent.slakeWallUrl
;(() => {
  const folder = document.getElementById('openFolder')
  if (folder) folder.hidden = true
  // A way out of the panel: a Done button, and Esc.
  const done = document.createElement('button')
  done.textContent = 'Done'
  done.className = 'link'
  done.style.cssText = 'position:absolute;top:18px;right:20px;margin:0;font-size:14px;font-weight:600'
  done.onclick = () => window.slake.closeStudio()
  const head = document.querySelector('.top')
  if (head) { head.style.position = 'relative'; head.append(done) }
})()
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.slake.closeStudio() })
