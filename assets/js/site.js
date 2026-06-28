const header = document.querySelector('[data-header]');
const revealItems = document.querySelectorAll('[data-reveal]:not([hidden])');
const faqItems = document.querySelectorAll('[data-faq-item]');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(pointer: fine)');

const GLOBAL_LIVE_SUPPORT_API_URL = 'https://liquid-star.liquidstarvoxiom.workers.dev/api';
const GLOBAL_WORKER_HOSTNAME = 'liquid-star.liquidstarvoxiom.workers.dev';
const GLOBAL_SUPPORT_API_URL = window.LS_SUPPORT_API_URL || (
  window.location.hostname === GLOBAL_WORKER_HOSTNAME ? '/api' : GLOBAL_LIVE_SUPPORT_API_URL
);
const SUPPORT_DEVICE_KEY = 'ls_support_device_v1';
const SUPPORT_VISITOR_KEY = 'ls_support_visitor_v1';
const SUPPORT_TICKET_KEY = 'ls_support_ticket_v1';
const SUPPORT_LAST_SEEN_KEY = 'ls_support_last_seen_v1';
const SUPPORT_NOTIFIED_KEY = 'ls_support_notified_v1';
const IS_SUPPORT_PAGE = /\/support\/?(?:index\.html)?$/i.test(window.location.pathname.replace(/\\/g, '/'));

const loadSupportValue = (key) => {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
};

const navActions = document.querySelector('.nav-actions');
const discordNavLink = navActions?.querySelector('a[href*="discord"]');
const supportNavLink = document.querySelector('nav a[href*="support"]');
let supportBell = null;
let supportBellDot = null;
let notificationAudioContext = null;

if (navActions && discordNavLink) {
  supportBell = document.createElement('a');
  supportBell.className = 'support-bell';
  supportBell.href = supportNavLink?.href || 'support/index.html';
  supportBell.setAttribute('aria-label', 'Open support messages');
  supportBell.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span aria-hidden="true"></span>';
  supportBellDot = supportBell.querySelector('span');
  navActions.insertBefore(supportBell, discordNavLink);
}

const unlockNotificationSound = () => {
  if (!notificationAudioContext && (window.AudioContext || window.webkitAudioContext)) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    notificationAudioContext = new AudioContextClass();
  }
  notificationAudioContext?.resume?.();
};

document.addEventListener('pointerdown', unlockNotificationSound, { once: true, passive: true });
document.addEventListener('keydown', unlockNotificationSound, { once: true });

const playNotificationSound = () => {
  if (!notificationAudioContext || notificationAudioContext.state !== 'running') return;
  const now = notificationAudioContext.currentTime;
  [660, 880].forEach((frequency, index) => {
    const oscillator = notificationAudioContext.createOscillator();
    const gain = notificationAudioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, now + index * .09);
    gain.gain.linearRampToValueAtTime(.055, now + index * .09 + .015);
    gain.gain.exponentialRampToValueAtTime(.001, now + index * .09 + .17);
    oscillator.connect(gain).connect(notificationAudioContext.destination);
    oscillator.start(now + index * .09);
    oscillator.stop(now + index * .09 + .18);
  });
};

const setSupportBellUnread = (unread) => {
  supportBell?.classList.toggle('has-unread', unread);
  if (supportBell) supportBell.setAttribute('aria-label', unread ? 'New support message — open chat' : 'Open support messages');
};

const markSupportSeen = (createdAt) => {
  if (!createdAt) return;
  localStorage.setItem(SUPPORT_LAST_SEEN_KEY, createdAt);
  setSupportBellUnread(false);
};

const pollSupportNotifications = async () => {
  if (IS_SUPPORT_PAGE) {
    setSupportBellUnread(false);
    return;
  }
  const deviceId = localStorage.getItem(SUPPORT_DEVICE_KEY);
  const visitor = loadSupportValue(SUPPORT_VISITOR_KEY);
  const ticket = loadSupportValue(SUPPORT_TICKET_KEY);
  if (!deviceId || !visitor?.id || !visitor?.token || !ticket?.id || !ticket?.accessToken) {
    setSupportBellUnread(false);
    return;
  }
  try {
    const response = await fetch(`${GLOBAL_SUPPORT_API_URL}/tickets/${encodeURIComponent(ticket.id)}`, {
      credentials: window.location.protocol === 'file:' ? 'omit' : 'include',
      cache: 'no-store',
      headers: {
        'X-Device-ID': deviceId,
        'X-Visitor-ID': visitor.id,
        'X-Visitor-Token': visitor.token,
        'X-Ticket-ID': ticket.id,
        'X-Ticket-Token': ticket.accessToken
      }
    });
    if (!response.ok) return;
    const data = await response.json();
    const staffMessages = (data.ticket?.messages || []).filter((message) => message.author === 'staff');
    const latest = staffMessages.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
    if (!latest) return;
    const lastSeen = localStorage.getItem(SUPPORT_LAST_SEEN_KEY) || '';
    const unread = String(latest.createdAt) > lastSeen;
    setSupportBellUnread(unread);
    if (unread && localStorage.getItem(SUPPORT_NOTIFIED_KEY) !== latest.id) {
      localStorage.setItem(SUPPORT_NOTIFIED_KEY, latest.id);
      playNotificationSound();
    }
  } catch {}
};

window.addEventListener('ls-support-seen', (event) => markSupportSeen(event.detail?.createdAt));
window.addEventListener('ls-support-notification', playNotificationSound);
window.addEventListener('storage', (event) => {
  if ([SUPPORT_LAST_SEEN_KEY, SUPPORT_TICKET_KEY].includes(event.key)) pollSupportNotifications();
});

pollSupportNotifications();
window.setInterval(pollSupportNotifications, 15000);

const updateHeader = () => {
  header?.classList.toggle('is-scrolled', window.scrollY > 12);
};

updateHeader();
window.addEventListener('scroll', updateHeader, { passive: true });

const pageScrollbar = document.createElement('div');
const pageScrollbarThumb = document.createElement('div');
pageScrollbar.className = 'page-scrollbar';
pageScrollbar.setAttribute('aria-hidden', 'true');
pageScrollbarThumb.className = 'page-scrollbar-thumb';
pageScrollbar.append(pageScrollbarThumb);
document.body.append(pageScrollbar);

let scrollbarFrame = 0;
let scrollbarDragging = false;
let scrollbarDragOffset = 0;
let scrollbarTravel = 0;
let pageScrollRange = 0;

const renderPageScrollbar = () => {
  scrollbarFrame = 0;
  const viewportHeight = window.innerHeight;
  const pageHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  pageScrollRange = Math.max(0, pageHeight - viewportHeight);
  pageScrollbar.hidden = pageScrollRange < 2;
  if (pageScrollbar.hidden) return;

  const thumbHeight = Math.max(48, Math.round((viewportHeight / pageHeight) * (viewportHeight - 8)));
  scrollbarTravel = Math.max(0, viewportHeight - thumbHeight - 8);
  const thumbTop = 4 + (window.scrollY / pageScrollRange) * scrollbarTravel;
  pageScrollbarThumb.style.height = `${thumbHeight}px`;
  pageScrollbarThumb.style.transform = `translate3d(0, ${thumbTop - 4}px, 0)`;
};

const queuePageScrollbar = () => {
  if (!scrollbarFrame) scrollbarFrame = window.requestAnimationFrame(renderPageScrollbar);
};

pageScrollbarThumb.addEventListener('pointerdown', (event) => {
  scrollbarDragging = true;
  scrollbarDragOffset = event.clientY - pageScrollbarThumb.getBoundingClientRect().top;
  pageScrollbarThumb.classList.add('is-dragging');
  pageScrollbarThumb.setPointerCapture(event.pointerId);
  event.preventDefault();
});

pageScrollbarThumb.addEventListener('pointermove', (event) => {
  if (!scrollbarDragging || !scrollbarTravel) return;
  const nextTop = Math.min(scrollbarTravel, Math.max(0, event.clientY - scrollbarDragOffset - 4));
  window.scrollTo({ top: (nextTop / scrollbarTravel) * pageScrollRange, behavior: 'auto' });
});

const stopScrollbarDrag = (event) => {
  if (!scrollbarDragging) return;
  scrollbarDragging = false;
  pageScrollbarThumb.classList.remove('is-dragging');
  if (pageScrollbarThumb.hasPointerCapture(event.pointerId)) pageScrollbarThumb.releasePointerCapture(event.pointerId);
};

pageScrollbarThumb.addEventListener('pointerup', stopScrollbarDrag);
pageScrollbarThumb.addEventListener('pointercancel', stopScrollbarDrag);
window.addEventListener('scroll', queuePageScrollbar, { passive: true });
window.addEventListener('resize', queuePageScrollbar, { passive: true });
new ResizeObserver(queuePageScrollbar).observe(document.body);
queuePageScrollbar();

if (!reducedMotion.matches && finePointer.matches) {
  let targetX = window.innerWidth / 2;
  let targetY = window.innerHeight / 2;
  let currentX = targetX;
  let currentY = targetY;
  let ambientFrame = 0;
  let ambientSpawned = false;

  // Stay hidden until we know where the cursor actually is, so the glow
  // never flashes in a corner — it spawns directly on the pointer.
  document.body.style.setProperty('--ambient-opacity', '0');

  const renderAmbient = () => {
    currentX += (targetX - currentX) * 0.085;
    currentY += (targetY - currentY) * 0.085;
    document.body.style.setProperty('--ambient-x', `${currentX}px`);
    document.body.style.setProperty('--ambient-y', `${currentY}px`);

    if (Math.abs(targetX - currentX) > 0.2 || Math.abs(targetY - currentY) > 0.2) {
      ambientFrame = window.requestAnimationFrame(renderAmbient);
    } else {
      ambientFrame = 0;
    }
  };

  window.addEventListener('pointermove', (event) => {
    targetX = event.clientX;
    targetY = event.clientY;
    if (!ambientSpawned) {
      // First sighting of the cursor: snap straight to it, no travel from a corner.
      ambientSpawned = true;
      currentX = targetX;
      currentY = targetY;
      document.body.style.setProperty('--ambient-x', `${currentX}px`);
      document.body.style.setProperty('--ambient-y', `${currentY}px`);
    }
    document.body.style.setProperty('--ambient-opacity', '.82');
    if (!ambientFrame) ambientFrame = window.requestAnimationFrame(renderAmbient);
  }, { passive: true });

  document.documentElement.addEventListener('mouseleave', () => {
    if (ambientSpawned) document.body.style.setProperty('--ambient-opacity', '.34');
  });
}

if (reducedMotion.matches || !('IntersectionObserver' in window)) {
  revealItems.forEach((item) => item.classList.add('is-visible'));
} else {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px' });

  revealItems.forEach((item) => revealObserver.observe(item));
}

faqItems.forEach((item) => {
  const button = item.querySelector('.faq-question');

  button?.addEventListener('click', () => {
    const shouldOpen = !item.classList.contains('is-open');

    faqItems.forEach((otherItem) => {
      const otherButton = otherItem.querySelector('.faq-question');
      const isCurrent = otherItem === item && shouldOpen;
      otherItem.classList.toggle('is-open', isCurrent);
      otherButton?.setAttribute('aria-expanded', String(isCurrent));
    });

    if (shouldOpen && item.classList.contains('launcher-faq')) {
      const l = item.querySelector('[data-ls-launcher]');
      if (l && typeof l._resetGuide === 'function') {
        l._resetGuide();
      }
    }
  });
});

document.querySelectorAll('[data-ls-launcher]').forEach((launcher) => {
  const tabs = [...launcher.querySelectorAll('[data-ls-tab]')];
  const panels = [...launcher.querySelectorAll('[data-ls-panel]')];
  const view = launcher.querySelector('[data-ls-view]');
  const footAction = launcher.querySelector('[data-ls-foot-action]');
  const actionLabels = { home: 'Go home', join: 'Join', follow: 'Locate', find: 'Scan', settings: 'Back', launch: 'Launch' };
  let currentTab = 'home';
  let heightTransition = 0;

  const playBtn = launcher.querySelector('[data-ls-play-btn]');
  const settingsBtn = launcher.querySelector('[data-ls-settings]');
  const localBtn = launcher.querySelector('[data-ls-local-btn]');
  const pointerEl = launcher.querySelector('.ls-guide-pointer');

  const startSimulation = () => {
    showPanel('launch');
    const progressBar = launcher.querySelector('.ls-progress-bar');
    const progressStatus = launcher.querySelector('.ls-launch-status');
    if (!progressBar || !progressStatus) return;
    
    progressBar.style.width = '0%';
    progressStatus.textContent = 'Loading local assets...';
    progressStatus.style.color = 'rgba(255,255,255,.5)';
    
    let progress = 0;
    if (launcher._launchInterval) clearInterval(launcher._launchInterval);
    
    launcher._launchInterval = setInterval(() => {
      progress += Math.floor(Math.random() * 12) + 6;
      if (progress >= 100) {
        progress = 100;
        clearInterval(launcher._launchInterval);
        launcher._launchInterval = null;
        progressBar.style.width = '100%';
        progressStatus.textContent = 'Ready to play! Enjoy.';
        progressStatus.style.color = '#4caf50';
      } else {
        progressBar.style.width = `${progress}%`;
        if (progress > 35 && progress < 75) {
          progressStatus.textContent = 'Downloading cheat definitions...';
        } else if (progress >= 75) {
          progressStatus.textContent = 'Injecting secure payload...';
        }
      }
    }, 150);
  };

  const resetLauncher = () => {
    if (launcher._launchInterval) {
      clearInterval(launcher._launchInterval);
      launcher._launchInterval = null;
    }
    currentTab = 'home';
    launcher.style.setProperty('--ls-tab-index', '0');
    tabs.forEach((t, i) => {
      const isSelected = i === 0;
      t.classList.toggle('is-active', isSelected);
      t.setAttribute('aria-selected', String(isSelected));
      t.tabIndex = isSelected ? 0 : -1;
    });
    
    if (playBtn) {
      playBtn.textContent = 'Go to Home';
      playBtn.classList.remove('ls-pulse-play');
    }
    
    if (settingsBtn) {
      settingsBtn.classList.add('ls-pulse-settings');
      if (pointerEl) {
        settingsBtn.appendChild(pointerEl);
        pointerEl.style.display = 'block';
      }
    }
    
    if (localBtn) {
      localBtn.classList.add('ls-pulse-local');
      const segment = localBtn.closest('[data-ls-segment]');
      if (segment) {
        segment.querySelectorAll('button').forEach((btn) => {
          btn.classList.toggle('is-active', btn.textContent.trim() === 'Local');
        });
      }
    }

    const progressBar = launcher.querySelector('.ls-progress-bar');
    const progressStatus = launcher.querySelector('.ls-launch-status');
    if (progressBar) progressBar.style.width = '0%';
    if (progressStatus) {
      progressStatus.textContent = 'Loading locally...';
      progressStatus.style.color = 'rgba(255,255,255,.5)';
    }

    showPanel('home');
  };

  launcher._resetGuide = resetLauncher;

  const showPanel = (name) => {
    const currentPanel = panels.find((panel) => panel.classList.contains('is-active'));
    const nextPanel = panels.find((panel) => panel.dataset.lsPanel === name);
    if (!view || !nextPanel || currentPanel === nextPanel) return;

    const startHeight = view.offsetHeight;
    const transitionId = ++heightTransition;
    if (!reducedMotion.matches) view.style.height = `${startHeight}px`;

    currentPanel?.classList.remove('is-active');
    currentPanel?.setAttribute('aria-hidden', 'true');
    nextPanel.classList.add('is-active');
    nextPanel.setAttribute('aria-hidden', 'false');
    if (footAction) footAction.textContent = actionLabels[name] || 'Select';

    if (reducedMotion.matches) {
      view.style.height = 'auto';
      return;
    }

    const endHeight = nextPanel.scrollHeight;
    window.requestAnimationFrame(() => {
      view.style.height = `${endHeight}px`;
    });
    window.setTimeout(() => {
      if (heightTransition === transitionId) view.style.height = 'auto';
    }, 380);
  };

  const selectTab = (tab) => {
    const index = tabs.indexOf(tab);
    if (index < 0) return;
    currentTab = tab.dataset.lsTab;
    launcher.style.setProperty('--ls-tab-index', String(index));
    tabs.forEach((otherTab) => {
      const isSelected = otherTab === tab;
      otherTab.classList.toggle('is-active', isSelected);
      otherTab.setAttribute('aria-selected', String(isSelected));
      otherTab.tabIndex = isSelected ? 0 : -1;
    });
    showPanel(currentTab);
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const nextIndex = (tabs.indexOf(tab) + direction + tabs.length) % tabs.length;
      tabs[nextIndex].focus();
      selectTab(tabs[nextIndex]);
    });
  });

  settingsBtn?.addEventListener('click', () => {
    showPanel('settings');
    settingsBtn.classList.remove('ls-pulse-settings');
    if (pointerEl && localBtn) {
      localBtn.appendChild(pointerEl);
      pointerEl.style.display = 'block';
    }
  });

  launcher.querySelector('[data-ls-back]')?.addEventListener('click', () => showPanel(currentTab));

  playBtn?.addEventListener('click', () => {
    const isLocalSelected = localBtn?.classList.contains('is-active');
    if (isLocalSelected) {
      playBtn.classList.remove('ls-pulse-play');
      if (pointerEl) pointerEl.style.display = 'none';
      startSimulation();
    } else {
      if (settingsBtn) {
        settingsBtn.classList.add('ls-pulse-settings');
        if (pointerEl) {
          settingsBtn.appendChild(pointerEl);
          pointerEl.style.display = 'block';
        }
      }
    }
  });

  launcher.querySelectorAll('[data-ls-segment]').forEach((segment) => {
    segment.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        segment.querySelectorAll('button').forEach((option) => option.classList.toggle('is-active', option === button));
        if (button.textContent.trim() === 'Local') {
          button.classList.remove('ls-pulse-local');
          setTimeout(() => {
            showPanel('home');
            if (playBtn) {
              playBtn.textContent = 'Play';
              playBtn.classList.add('ls-pulse-play');
              if (pointerEl) {
                playBtn.appendChild(pointerEl);
                pointerEl.style.display = 'block';
              }
            }
          }, 600);
        }
      });
    });
  });

  launcher.querySelectorAll('.ls-switch').forEach((control) => {
    control.addEventListener('click', () => {
      const isOn = control.classList.toggle('is-on');
      control.setAttribute('aria-pressed', String(isOn));
    });
  });

  launcher.querySelectorAll('[data-ls-range]').forEach((range) => {
    const output = range.parentElement?.querySelector('output');
    range.addEventListener('input', () => {
      if (output) output.textContent = `${range.value}${range.dataset.suffix || ''}`;
    });
  });
});
