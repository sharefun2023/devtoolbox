// a11y.js — 让 div/span 上的 onclick 控件可被键盘激活（WCAG 2.1.1）。
// 只做一件事：把 [role="button"][tabindex] 上的 Enter / Space 转发成 click。
// 不复制、不替换任何页面自己的逻辑 —— 事件委托，任何时刻新增的控件都自动生效。
(function () {
  if (window.__dtA11yInstalled) return;
  window.__dtA11yInstalled = true;
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var el = e.target;
    if (!el || !el.getAttribute) return;
    if (el.getAttribute('role') !== 'button' || el.getAttribute('tabindex') === null) return;
    if (el.tagName === 'BUTTON' || el.tagName === 'A') return;
    e.preventDefault();          // 阻止 Space 滚动页面
    el.click();                  // 走页面原本的 onclick，行为完全一致
  });
})();
