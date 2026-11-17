/* Controles padronizados da barra superior IPCVT.
   Mantém os botões de tema e configurações originais e seus eventos. */
(() => {
  'use strict';
  const el = (tag, className, label) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (label != null) node.textContent = label;
    return node;
  };
  const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const isStrategy = location.pathname.includes('/planejamento-estrategico/');
  const returnHref = isStrategy ? '../comissao.html' : 'comissao.html';
  const applyFallbackTheme = () => {
    document.body.classList.add('ipcvt-fallback-theme');
    const current = () => document.documentElement.getAttribute('data-portal-theme') === 'dark';
    const set = dark => {
      document.documentElement.setAttribute('data-portal-theme', dark ? 'dark' : 'light');
      try { localStorage.setItem('ipcvt-portal-theme', dark ? 'dark' : 'light'); } catch (_) {}
      document.querySelectorAll('.ipcvt-fallback-toggle').forEach(button => {
        button.setAttribute('aria-label', dark ? 'Ativar modo claro' : 'Ativar modo escuro');
        button.setAttribute('aria-pressed', String(dark));
        button.title = dark ? 'Ativar modo claro' : 'Ativar modo escuro';
        const icon = button.querySelector('.ipcvt-fallback-symbol');
        if (icon) icon.textContent = dark ? '☀' : '☾';
      });
    };
    if (!document.documentElement.hasAttribute('data-portal-theme')) {
      try { set(localStorage.getItem('ipcvt-portal-theme') === 'dark'); } catch (_) { set(false); }
    }
    return () => {
      const button = el('button', 'ipcvt-theme-button ipcvt-fallback-toggle');
      button.type = 'button';
      const icon = el('span', 'ipcvt-fallback-symbol', current() ? '☀' : '☾');
      icon.setAttribute('aria-hidden','true');
      button.append(icon);
      button.addEventListener('click', () => set(!current()));
      set(current());
      return button;
    };
  };
  let fallbackThemeButton;

  function newMenuItem(href, label) {
    const a = el('a', 'ipcvt-overflow-item', label);
    a.href = href;
    return a;
  }
  function placeInMenu(container, selector, text) {
    const item = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!item) return false;
    if (text) item.textContent = text;
    item.classList.add('ipcvt-overflow-item');
    container.append(item);
    return true;
  }
  function standardBar({ header, actions, theme, move = [], links = [], navLinks = [], themeFactory }) {
    const root = typeof header === 'string' ? document.querySelector(header) : header;
    const target = typeof actions === 'string' ? document.querySelector(actions) : actions;
    if (!root || !target || target.querySelector(':scope > .ipcvt-bar-actions')) return;
    const themeButton = typeof theme === 'string' ? document.querySelector(theme) : theme;
    const button = themeButton || (themeFactory && themeFactory());
    const controls = el('div', 'ipcvt-bar-actions');
    if (button) {
      button.classList.add('ipcvt-theme-button');
      button.title = button.getAttribute('aria-label') || 'Alternar tema';
      controls.append(button);
    }
    const dropdown = el('details', 'ipcvt-overflow');
    const summary = el('summary', '', '|||');
    summary.setAttribute('aria-label', 'Abrir opções e configurações');
    summary.title = 'Opções e configurações';
    dropdown.append(summary);
    const menu = el('div','ipcvt-overflow-panel');
    const unique = new Set();
    for (const [selector, rename] of move) {
      const source = typeof selector === 'string' ? document.querySelector(selector) : selector;
      if (!source || unique.has(source)) continue;
      unique.add(source);
      placeInMenu(menu, source, rename);
    }
    for (const [href,label] of links) {
      if (!menu.querySelector('a[href="' + href + '"]')) menu.append(newMenuItem(href,label));
    }
    if (navLinks.length) {
      if (menu.children.length) menu.append(el('div','ipcvt-menu-divider'));
      for (const link of navLinks) {
        const clone = link.cloneNode(true);
        clone.className = 'ipcvt-overflow-item';
        clone.removeAttribute('aria-current');
        menu.append(clone);
      }
    }
    if (menu.children.length === 0) menu.append(newMenuItem('index.html','Voltar para o Portal'));
    dropdown.append(menu);
    controls.append(dropdown);
    target.append(controls);
    dropdown.addEventListener('click', ev => {
      if (ev.target.closest('.ipcvt-overflow-item')) dropdown.open = false;
    });
    document.addEventListener('click', ev => {
      if (dropdown.open && !dropdown.contains(ev.target)) dropdown.open = false;
    });
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && dropdown.open) { dropdown.open = false; summary.focus(); }
    });
  }

  function plannerTopbar() {
    const bar = document.querySelector('#planner-app .pm-topbar .pm-toolbar');
    const more = document.getElementById('pm-more');
    if (!bar || !more || more.dataset.ipcvtStandardized) return;
    more.dataset.ipcvtStandardized = 'true';
    const theme = document.getElementById('theme-toggle');
    const back = bar.querySelector('.pm-commission-back');
    const menu = more.querySelector('.pm-more-menu');
    const summary = more.querySelector('#pm-account');
    if (summary) {
      const avatar = summary.querySelector('#pm-avatar');
      summary.textContent = '|||';
      summary.setAttribute('aria-label', 'Abrir opções e configurações');
      summary.title = 'Opções e configurações';
      if (avatar) { avatar.hidden = true; summary.append(avatar); }
    }
    more.classList.add('ipcvt-planner-more');
    if (back && menu) {
      back.classList.add('ipcvt-overflow-item');
      back.textContent = 'Voltar para Comissão';
      menu.append(back);
    } else if (menu) {
      menu.append(newMenuItem('comissao.html','Voltar para Comissão'));
    }
    const redundantTheme = document.getElementById('pm-theme');
    if (redundantTheme) redundantTheme.classList.add('ipcvt-hidden-menu-command');
    if (theme) {
      theme.classList.add('ipcvt-theme-button');
      bar.append(theme);
    }
    bar.append(more); // direita: |||; imediatamente à esquerda: sol/lua
  }

  function strategyReactBar() {
    const bar = document.querySelector('#root .topbar');
    if (!bar || bar.querySelector('.ipcvt-bar-actions')) return;
    const original = bar.querySelector('.theme-switch');
    if (!original) return;
    original.classList.add('ipcvt-native-theme-hidden');
    const proxy = el('button','ipcvt-theme-button ipcvt-strategy-theme');
    proxy.type = 'button';
    proxy.addEventListener('click', () => original.click());
    const icon = el('span','ipcvt-fallback-symbol');
    icon.setAttribute('aria-hidden','true');
    proxy.append(icon);
    const sync = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      icon.textContent = dark ? '☀' : '☾';
      proxy.setAttribute('aria-label',dark ? 'Ativar modo claro' : 'Ativar modo escuro');
      proxy.title = proxy.getAttribute('aria-label');
      proxy.setAttribute('aria-pressed',String(dark));
    };
    sync();
    const themeObserver = new MutationObserver(sync);
    themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    standardBar({header:bar,actions:bar,theme:proxy,links:[['../comissao.html','Voltar para Comissão']]});
  }

  function initialize() {
    if (page === 'index.html' && !isStrategy) {
      standardBar({
        header:'.portal-bar',actions:'.portal-bar-actions',theme:'#portal-theme-toggle',
        navLinks:[...document.querySelectorAll('.portal-nav a')]
      });
      const old = document.getElementById('portal-mobile-menu');
      if (old) old.classList.add('ipcvt-retired-nav-toggle');
    } else if (page === 'comissao.html') {
      standardBar({header:'header.topbar',actions:'.commission-top-actions',theme:'#commission-theme-toggle',
        move:[['.commission-top-actions .back-link','Voltar para o Portal'],['#authorization-toggle',null]],
        links:[['index.html','Voltar para o Portal']]});
    } else if (page === 'agenda-anual.html') {
      standardBar({header:'.app-bar',actions:'.agenda-header-actions',theme:'#agenda-theme-toggle',
        move:[['.agenda-return','Voltar para o Portal'],['#agenda-settings-button','Configurar fontes dos calendários']],
        links:[['index.html','Voltar para o Portal']]});
    } else if (page === 'escala_geral.html') {
      standardBar({header:'.scale-topbar',actions:'.scale-topbar-actions',theme:'#scale-theme-toggle',
        move:[['.scale-topbar-actions .scale-portal-link','Voltar para o Portal']],
        links:[['comissao.html','Voltar para Comissão'],['index.html','Voltar para o Portal']]});
    } else if (page === 'vaquinhas.html') {
      standardBar({header:'.campaign-header',actions:'.campaign-header nav',theme:'#vaquinhas-theme-toggle',
        move:[['.campaign-header .portal-return','Voltar para o Portal']],
        links:[['comissao.html','Voltar para Comissão'],['index.html','Voltar para o Portal']]});
    } else if (page === 'planner.html' || page === 'planner-painel.html') {
      const legacy = document.querySelector('header.site-header .portal-links');
      const gateTheme = document.getElementById('theme-toggle-gate') || document.getElementById('theme-toggle');
      if (legacy) standardBar({header:'header.site-header',actions:legacy,theme:gateTheme,
        move:[...legacy.querySelectorAll('a')].map(a => [a, a.href.includes('comissao.html') ? 'Voltar para Comissão' : 'Voltar para o Portal']),
        links:[['comissao.html','Voltar para Comissão']]});
      if (page === 'planner.html') plannerTopbar();
      else {
        // Versão auxiliar: reutiliza o menu de conta, sem criar um segundo menu.
        const pmBar=document.querySelector('#planner-app .pm-toolbar');
        const more=document.getElementById('pm-more');
        if (pmBar && more && !more.dataset.ipcvtStandardized) {
          more.dataset.ipcvtStandardized='true';
          more.classList.add('ipcvt-planner-more');
          const summary=more.querySelector('#pm-account');
          if (summary) {
            const avatar=summary.querySelector('#pm-avatar');
            summary.textContent='|||';
            summary.title='Opções e configurações';
            summary.setAttribute('aria-label','Abrir opções e configurações');
            if(avatar){avatar.hidden=true;summary.append(avatar);}
          }
          const oldTheme=document.getElementById('pm-theme');
          if(oldTheme)oldTheme.classList.add('ipcvt-hidden-menu-command');
          const menu=more.querySelector('.pm-more-menu');
          if(menu){
            menu.querySelectorAll('a.pm-menu-link').forEach(a=>a.remove());
            menu.append(newMenuItem('comissao.html','Voltar para Comissão'));
          }
          const proxy=el('button','ipcvt-theme-button ipcvt-planner-legacy-theme');
          proxy.type='button';
          const icon=el('span','ipcvt-fallback-symbol');
          icon.setAttribute('aria-hidden','true');
          proxy.append(icon);
          const sync=()=>{
            const dark=document.documentElement.dataset.theme==='dark';
            icon.textContent=dark?'☀':'☾';
            proxy.setAttribute('aria-label',dark?'Ativar modo claro':'Ativar modo escuro');
            proxy.title=proxy.getAttribute('aria-label');
          };
          proxy.addEventListener('click',()=>document.getElementById('theme-toggle')?.click());
          new MutationObserver(sync).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
          sync();
          pmBar.append(proxy,more);
        }
      }
    } else if (page === 'revisao_repertorio.html') {
      fallbackThemeButton=applyFallbackTheme();
      const header=document.querySelector('body > header');
      standardBar({header,actions:header?.querySelector('nav'),themeFactory:fallbackThemeButton,
        move:[...header.querySelectorAll('nav > a')].map(a=>[a,a.href.includes('comissao.html')?'Voltar para Comissão':'Voltar para o Portal']),
        links:[[returnHref,'Voltar para Comissão']]});
    } else if (page === 'votacao.html') {
      fallbackThemeButton=applyFallbackTheme();
      const app=document.getElementById('app');
      const mount=()=>{
        const header=app?.querySelector(':scope > header');
        if (!header) return;
        const right=header.querySelector(':scope > div > div:last-child');
        standardBar({header,actions:right,themeFactory:fallbackThemeButton,
          links:[['comissao.html','Voltar para Comissão']]});
      };
      mount();
      if(app)new MutationObserver(mount).observe(app,{childList:true});
    } else if (isStrategy) {
      const gateTheme=document.getElementById('gate-theme');
      if(gateTheme) {
        const key='ipcvt-estrategico-tema';
        let dark=false;
        try { dark=localStorage.getItem(key)==='dark'; } catch (_) {}
        const render=()=>{
          document.body.classList.toggle('gate-dark',dark);
          const icon=document.getElementById('gate-theme-icon');
          if(icon)icon.textContent=dark?'☀':'☾';
          const label=document.getElementById('gate-theme-text');
          if(label)label.textContent=dark?'Modo claro':'Modo escuro';
          gateTheme.setAttribute('aria-label',dark?'Ativar modo claro':'Ativar modo escuro');
          gateTheme.setAttribute('aria-pressed',String(dark));
        };
        gateTheme.addEventListener('click',()=>{
          dark=!dark;
          try{localStorage.setItem(key,dark?'dark':'light');}catch(_){}
          render();
        });
        render();
      }
      standardBar({header:'.strategic-gate-header',actions:'.strategic-gate-nav',theme:'#gate-theme',
        move:[['.strategic-gate-back','Voltar para Comissão']],
        links:[['../comissao.html','Voltar para Comissão']]});
      strategyReactBar();
      const root=document.getElementById('root');
      if(root)new MutationObserver(strategyReactBar).observe(root,{childList:true,subtree:true});
    }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',initialize,{once:true});
  else initialize();
})();
