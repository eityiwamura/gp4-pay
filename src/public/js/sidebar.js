(function () {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebarToggle');
  const icon = document.getElementById('sidebarToggleIcon');
  if (!sidebar || !toggle) return;

  const STORAGE_KEY = 'gp4-sidebar-collapsed';

  function applyState(collapsed) {
    sidebar.classList.toggle('collapsed', collapsed);
    icon.textContent = collapsed ? '›' : '‹';
  }

  const saved = localStorage.getItem(STORAGE_KEY) === '1';
  applyState(saved);

  toggle.addEventListener('click', function () {
    const collapsed = !sidebar.classList.contains('collapsed');
    applyState(collapsed);
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  });
})();
