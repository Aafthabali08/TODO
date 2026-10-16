// Shown instead of the planner when an admin has blocked or suspended the account.
// The user can still raise and follow tickets, for example to request access again.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = iso => iso ? new Date(iso).toLocaleString() : '';
const label = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };

export function showRestricted({ restricted, cloud, user, signOut }) {
  document.body.classList.add('signed-out');
  let el = document.querySelector('#restricted-screen');
  if (!el) { el = document.createElement('section'); el.id = 'restricted-screen'; el.className = 'auth-screen restricted-screen'; document.body.append(el); }
  const title = restricted.status === 'blocked' ? 'Your account is blocked.' : 'Your account is suspended.';
  const detail = restricted.status === 'blocked' ? 'You can’t open your planner until an admin restores access.' : `Access returns automatically on ${when(restricted.until)}.`;
  el.innerHTML = `<div class="auth-story"><a class="brand" href="/"><span class="brandmark">d.</span>dayform</a><div><span class="heading-tag">ACCOUNT ACCESS</span><h1>${title}</h1><p>${detail}${restricted.reason ? `<br><br><b>Reason:</b> ${esc(restricted.reason)}` : ''}</p></div><small>Signed in as ${esc(user.email)}</small></div>
  <div class="auth-panel"><div class="auth-card restricted-card"><span class="heading-tag">REQUEST ACCESS</span><h2>Tell us what happened.</h2><form id="access-form"><label>Subject<input name="subject" maxlength="120" required value="Please restore my access"></label><label>Message<textarea name="message" rows="4" maxlength="4000" required placeholder="Anything that helps the admin review your account"></textarea></label><button class="primary full" type="submit">Send request ↗</button></form><p id="access-message" role="status"></p><div id="access-tickets"></div><button class="soft-button full" id="restricted-signout">Sign out</button></div></div>`;
  const list = el.querySelector('#access-tickets'), msg = el.querySelector('#access-message');
  async function load() {
    try {
      const tickets = await cloud.myTickets();
      list.innerHTML = tickets.length ? `<h3>Your requests</h3>${tickets.map(t => `<article class="mini-ticket"><div><b>${esc(t.subject)}</b><span class="ticket-status ${t.status}">${label[t.status]}</span></div><small>${when(t.createdAt)}</small>${(t.replies || []).map(r => `<p class="reply ${r.by}"><b>${esc(r.name)}:</b> ${esc(r.text)}</p>`).join('')}</article>`).join('')}` : '';
    } catch (e) { list.textContent = 'Couldn’t load your requests: ' + e.code; }
  }
  el.querySelector('#access-form').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target), button = e.target.querySelector('button'); button.disabled = true;
    try { await cloud.createTicket({ category: 'access', subject: f.get('subject'), message: f.get('message') }); e.target.reset(); msg.textContent = 'Request sent. An admin will review it.'; await load(); }
    catch (err) { msg.textContent = 'Couldn’t send: ' + (err.code || err.message); } finally { button.disabled = false; }
  };
  el.querySelector('#restricted-signout').onclick = async () => { await signOut(); location.reload(); };
  el.hidden = false; load();
}
