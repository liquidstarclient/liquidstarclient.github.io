const SUPPORT_LIVE_API_URL = 'https://liquid-star.liquidstarvoxiom.workers.dev/api';
const SUPPORT_WORKER_HOSTNAME = 'liquid-star.liquidstarvoxiom.workers.dev';
const SUPPORT_API_URL = window.LS_SUPPORT_API_URL || (
  window.location.hostname === SUPPORT_WORKER_HOSTNAME ? '/api' : SUPPORT_LIVE_API_URL
);

const DEVICE_KEY = 'ls_support_device_v1';
const VISITOR_KEY = 'ls_support_visitor_v1';
const TICKET_KEY = 'ls_support_ticket_v1';
const LAST_SEEN_KEY = 'ls_support_last_seen_v1';
const POLL_INTERVAL_MS = 7000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const chatForm = document.querySelector('[data-chat-form]');
const chatLog = document.querySelector('[data-chat-log]');
const helpChat = document.querySelector('.help-chat');
const chatSubmit = document.querySelector('[data-chat-submit]');
const visitorLabel = document.querySelector('[data-visitor-label]');
const quickQuestions = document.querySelectorAll('[data-question]');
const imageInput = document.querySelector('[data-image-input]');
const imagePreview = document.querySelector('[data-image-preview]');
const imagePreviewImage = document.querySelector('[data-image-preview-image]');
const imagePreviewName = document.querySelector('[data-image-preview-name]');
const imageRemove = document.querySelector('[data-image-remove]');
const adminCall = document.querySelector('[data-admin-call]');

const randomId = () => window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

const getDeviceId = () => {
  let deviceId = localStorage.getItem(DEVICE_KEY);
  if (!deviceId) {
    deviceId = randomId();
    localStorage.setItem(DEVICE_KEY, deviceId);
  }
  return deviceId;
};

const loadStoredJson = (key) => {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
};

const state = {
  deviceId: getDeviceId(),
  visitor: loadStoredJson(VISITOR_KEY),
  ticket: loadStoredJson(TICKET_KEY),
  currentTicket: null,
  image: null,
  imagePreviewUrl: null,
  displayedTicketId: null,
  displayedMessageIds: new Set(),
  pollTimer: null,
  busy: false,
  adminCooldownUntil: 0
};

const setVisitorLabel = (text, status = 'idle') => {
  if (!visitorLabel) return;
  visitorLabel.textContent = text;
  visitorLabel.className = `online-dot is-${status}`;
};

const setBusy = (busy) => {
  state.busy = busy;
  chatForm?.classList.toggle('is-busy', busy);
  helpChat?.classList.toggle('is-sending', busy);
  if (chatSubmit) chatSubmit.disabled = busy;
  if (chatForm?.elements.question) chatForm.elements.question.disabled = busy;
  if (imageInput) imageInput.disabled = busy;
  if (typeof updateTicketControls === 'function') updateTicketControls();
};

const appendMessage = (message, notify = false) => {
  if (!chatLog || state.displayedMessageIds.has(message.id)) return;
  state.displayedMessageIds.add(message.id);
  const element = document.createElement('div');
  const className = message.author === 'visitor'
    ? 'user-message'
    : message.author === 'staff'
      ? 'bot-message staff-message'
      : 'system-message';
  element.className = `chat-message ${className}`;

  if (message.content) {
    const text = document.createElement('span');
    text.textContent = message.content;
    element.appendChild(text);
  }
  if (message.attachmentUrl) {
    const link = document.createElement('a');
    link.href = message.attachmentUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';
    if (String(message.attachmentType || '').startsWith('image/')) {
      const image = document.createElement('img');
      image.src = message.attachmentUrl;
      image.alt = message.attachmentName || 'Ticket attachment';
      image.loading = 'lazy';
      link.appendChild(image);
    } else {
      link.className = 'file-attachment';
      link.textContent = `↗ ${message.attachmentName || 'Open attachment'}`;
    }
    element.appendChild(link);
  }
  if (message.author === 'visitor') {
    const row = document.createElement('div');
    row.className = 'user-row';
    row.appendChild(element);
    const status = document.createElement('small');
    status.className = 'message-status';
    status.textContent = 'Delivered';
    row.appendChild(status);
    chatLog.appendChild(row);
  } else if (message.author === 'staff') {
    const row = document.createElement('div');
    row.className = 'staff-row';

    const identity = document.createElement('div');
    identity.className = 'staff-identity';
    if (message.staffAvatarUrl) {
      const avatar = document.createElement('img');
      avatar.className = 'staff-avatar';
      avatar.src = message.staffAvatarUrl;
      avatar.alt = '';
      identity.appendChild(avatar);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'staff-avatar staff-avatar-fallback';
      fallback.textContent = String(message.staffRole || 'S').slice(0, 1).toUpperCase();
      identity.appendChild(fallback);
    }
    const role = document.createElement('strong');
    role.className = 'staff-role-label';
    role.textContent = message.staffRole || 'Staff';
    if (/^#[0-9a-f]{6}$/i.test(message.staffRoleColor || '')) role.style.color = message.staffRoleColor;
    identity.appendChild(role);

    row.appendChild(identity);
    row.appendChild(element);
    chatLog.appendChild(row);
  } else {
    chatLog.appendChild(element);
  }

  if (message.author === 'staff' && message.createdAt) {
    if (notify) {
      window.dispatchEvent(new CustomEvent('ls-support-notification', { detail: { messageId: message.id } }));
    }
    localStorage.setItem(LAST_SEEN_KEY, message.createdAt);
    window.dispatchEvent(new CustomEvent('ls-support-seen', { detail: { createdAt: message.createdAt } }));
  }
  chatLog.scrollTop = chatLog.scrollHeight;
};

const appendNotice = (content, kind = 'system') => appendMessage({
  id: `notice-${kind}-${Date.now()}-${Math.random()}`,
  author: 'system',
  content
});

const requestHeaders = () => {
  const headers = { 'Content-Type': 'application/json', 'X-Device-ID': state.deviceId };
  if (state.visitor) {
    headers['X-Visitor-ID'] = state.visitor.id;
    headers['X-Visitor-Token'] = state.visitor.token;
  }
  if (state.ticket) {
    headers['X-Ticket-ID'] = state.ticket.id;
    headers['X-Ticket-Token'] = state.ticket.accessToken;
  }
  return headers;
};

const request = async (path, options = {}) => {
  let response;
  try {
    response = await fetch(`${SUPPORT_API_URL}${path}`, {
      ...options,
      credentials: window.location.protocol === 'file:' ? 'omit' : 'include',
      cache: 'no-store',
      headers: { ...requestHeaders(), ...(options.headers || {}) }
    });
  } catch {
    throw new Error('Support is temporarily offline. Please use Discord for now.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Support request failed.');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
};

const ensureVisitor = async () => {
  setVisitorLabel(state.visitor?.id || 'ASSIGNING ID', 'idle');
  try {
    const data = await request('/visitor-session', {
      method: 'POST',
      body: JSON.stringify({ deviceId: state.deviceId })
    });
    if (data.visitorToken) {
      state.visitor = { ...data.visitor, token: data.visitorToken };
      localStorage.setItem(VISITOR_KEY, JSON.stringify(state.visitor));
    } else if (state.visitor && data.visitor) {
      state.visitor = { ...state.visitor, ...data.visitor };
      localStorage.setItem(VISITOR_KEY, JSON.stringify(state.visitor));
    }
    setVisitorLabel(state.visitor.id, 'open');
    return true;
  } catch (error) {
    if (error.status === 401) {
      localStorage.removeItem(VISITOR_KEY);
      state.visitor = null;
    }
    setVisitorLabel('ID LOCKED', 'offline');
    appendNotice(error.message || 'Could not assign a support ID. Please use Discord.');
    return false;
  }
};

const stopPolling = () => {
  window.clearTimeout(state.pollTimer);
  state.pollTimer = null;
};

const schedulePoll = () => {
  stopPolling();
  if (!state.ticket || document.hidden) return;
  state.pollTimer = window.setTimeout(refreshTicket, POLL_INTERVAL_MS);
};

const updateTicketControls = () => {
  const ticketOpen = state.currentTicket?.status === 'open';
  const coolingDown = Date.now() < state.adminCooldownUntil;
  if (adminCall) {
    adminCall.disabled = !ticketOpen || state.currentTicket?.pingDisabled || coolingDown || state.busy;
    adminCall.title = state.currentTicket?.pingDisabled
      ? 'Disabled by staff'
      : coolingDown
        ? 'Admins can be called once per hour'
        : ticketOpen ? 'Ping codemeteor and lolua' : 'Open a ticket first';
  }
  if (imageInput) imageInput.accept = state.currentTicket?.allowFiles ? '' : 'image/png,image/jpeg,image/webp,image/gif';
};

const renderTicket = (ticket, accessToken) => {
  state.currentTicket = ticket;
  if (accessToken) {
    state.ticket = { id: ticket.id, accessToken };
    localStorage.setItem(TICKET_KEY, JSON.stringify(state.ticket));
  }
  const isExistingRender = state.displayedTicketId === ticket.id;
  if (!isExistingRender) {
    state.displayedTicketId = ticket.id;
    state.displayedMessageIds.clear();
    chatLog?.replaceChildren();
  }
  ticket.messages.forEach((message) => appendMessage(message, isExistingRender && message.author === 'staff'));
  if (ticket.status === 'closed') {
    localStorage.removeItem(TICKET_KEY);
    state.ticket = null;
    stopPolling();
    updateTicketControls();
    if (chatForm?.elements.question) chatForm.elements.question.placeholder = 'Send a message to open a new ticket…';
    return;
  }
  if (chatForm?.elements.question) chatForm.elements.question.placeholder = 'Reply to support…';
  updateTicketControls();
  schedulePoll();
};

async function refreshTicket() {
  if (!state.ticket || !state.visitor) return;
  try {
    const data = await request(`/tickets/${encodeURIComponent(state.ticket.id)}`);
    if (data.ticket) renderTicket(data.ticket);
  } catch (error) {
    if (error.status === 404 || error.status === 401) {
      localStorage.removeItem(TICKET_KEY);
      state.ticket = null;
      state.currentTicket = null;
      updateTicketControls();
      appendNotice('This saved ticket is no longer available. You can open a new one.');
    } else {
      schedulePoll();
    }
  }
}

const clearImage = () => {
  state.image = null;
  if (state.imagePreviewUrl) URL.revokeObjectURL(state.imagePreviewUrl);
  state.imagePreviewUrl = null;
  if (imageInput) imageInput.value = '';
  if (imagePreview) imagePreview.hidden = true;
  imagePreview?.classList.remove('is-file');
  if (imagePreviewImage) imagePreviewImage.removeAttribute('src');
};

const fileToPayload = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve({ name: file.name, type: file.type, data: reader.result });
  reader.onerror = () => reject(new Error('The file could not be read.'));
  reader.readAsDataURL(file);
});

const sendMessage = async (message, company = '') => {
  const cleanMessage = message.trim();
  if ((!cleanMessage && !state.image) || state.busy) return;
  if (!state.visitor && !(await ensureVisitor())) return;
  setBusy(true);
  try {
    const attachment = state.image ? await fileToPayload(state.image) : null;
    const data = await request('/tickets/messages', {
      method: 'POST',
      body: JSON.stringify({ message: cleanMessage, attachment, deviceId: state.deviceId, company })
    });
    clearImage();
    if (data.ticket) renderTicket(data.ticket, data.accessToken);
  } catch (error) {
    if (error.status === 409 && error.data?.ticket) {
      renderTicket(error.data.ticket);
      return;
    }
    appendNotice(error.message || 'The message did not reach Discord. Please use the Discord button instead.');
  } finally {
    setBusy(false);
    chatForm?.elements.question?.focus();
  }
};

const selectAttachment = (file) => {
  if (!file) return clearImage();
  const isImage = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type);
  const filesAllowed = Boolean(state.currentTicket?.allowFiles);
  if ((!isImage && !filesAllowed) || file.size > (filesAllowed ? MAX_FILE_BYTES : MAX_IMAGE_BYTES)) {
    clearImage();
    appendNotice(filesAllowed ? 'Choose a file smaller than 10 MB.' : 'Choose a PNG, JPG, WEBP, or GIF smaller than 4 MB.');
    return;
  }
  clearImage();
  state.image = file;
  imagePreview?.classList.toggle('is-file', !isImage);
  if (isImage) {
    state.imagePreviewUrl = URL.createObjectURL(file);
    if (imagePreviewImage) imagePreviewImage.src = state.imagePreviewUrl;
  } else if (imagePreviewImage) {
    imagePreviewImage.removeAttribute('src');
  }
  if (imagePreviewName) imagePreviewName.textContent = file.name;
  if (imagePreview) imagePreview.hidden = false;
};

imageInput?.addEventListener('change', () => {
  selectAttachment(imageInput.files?.[0]);
});

document.addEventListener('paste', (event) => {
  const file = event.clipboardData?.files?.[0];
  if (!file) return;
  event.preventDefault();
  selectAttachment(file);
});

let dragDepth = 0;
helpChat?.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer?.types?.includes('Files')) return;
  event.preventDefault();
  dragDepth += 1;
  helpChat.classList.add('is-dragging-file');
});

helpChat?.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types?.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});

helpChat?.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) helpChat.classList.remove('is-dragging-file');
});

helpChat?.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  helpChat.classList.remove('is-dragging-file');
  selectAttachment(event.dataTransfer?.files?.[0]);
});

imageRemove?.addEventListener('click', clearImage);

adminCall?.addEventListener('click', async () => {
  if (!state.ticket || state.busy) return;
  setBusy(true);
  updateTicketControls();
  try {
    const data = await request('/tickets/ping', {
      method: 'POST',
      body: JSON.stringify({ deviceId: state.deviceId })
    });
    state.adminCooldownUntil = Date.now() + Number(data.retryAfter || 3600) * 1000;
    if (data.ticket) renderTicket(data.ticket);
    window.setTimeout(updateTicketControls, Number(data.retryAfter || 3600) * 1000);
  } catch (error) {
    appendNotice(error.message || 'Admins could not be called. Please use Discord directly.');
  } finally {
    setBusy(false);
    updateTicketControls();
  }
});

chatForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = chatForm.elements.question.value;
  const company = chatForm.elements.company.value;
  chatForm.elements.question.value = '';
  sendMessage(message, company);
});

quickQuestions.forEach((button) => button.addEventListener('click', () => sendMessage(button.dataset.question || '')));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPolling();
  else if (state.ticket) refreshTicket();
});

window.addEventListener('beforeunload', () => {
  stopPolling();
  if (state.imagePreviewUrl) URL.revokeObjectURL(state.imagePreviewUrl);
});

ensureVisitor().then((ready) => {
  if (ready && state.ticket) refreshTicket();
  else updateTicketControls();
});
