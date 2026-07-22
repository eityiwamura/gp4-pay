(function () {
  document.querySelectorAll('.brand-pill-group').forEach(group => {
    group.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const category = group.dataset.category;
      const brand = btn.dataset.value;

      [...group.querySelectorAll('button')].forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll(`.brand-tiles[data-category="${category}"]`).forEach(el => {
        el.style.display = (el.dataset.brand === brand) ? '' : 'none';
      });
    });
  });
})();
