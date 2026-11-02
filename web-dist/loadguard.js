// If the page never gets going, show a Reload screen instead of a blank one.
function slakeCheck () {
  setTimeout(function () {
    var ready = ['lounge', 'welcome', 'chat'].some(function (id) { var e = document.getElementById(id); return e && !e.hidden })
    if (!ready) document.getElementById('loadFail').style.display = 'grid'
  }, 4000)
}
window.addEventListener('error', slakeCheck)
window.addEventListener('unhandledrejection', slakeCheck)
document.addEventListener('DOMContentLoaded', function () { var b = document.getElementById('loadReload'); if (b) b.addEventListener('click', function () { location.reload() }) })
