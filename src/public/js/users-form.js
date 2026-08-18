(function () {
  document.querySelectorAll('form[data-confirm]').forEach(form => {
    form.addEventListener('submit', e => {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });

  const role = document.getElementById('role');
  const fieldset = document.getElementById('permFieldset');
  const hint = document.getElementById('permHint');
  if (!role || !fieldset || !hint) return;

  function sync() {
    const isAdmin = role.value === 'admin';
    fieldset.classList.toggle('disabled', isAdmin);
    fieldset.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.disabled = isAdmin; });
    hint.textContent = isAdmin
      ? 'Administrador acessa todas as telas — não há o que escolher.'
      : 'Marque as telas que este usuário poderá abrir. As demais ficam bloqueadas.';
  }

  role.addEventListener('change', sync);
  sync();
})();
