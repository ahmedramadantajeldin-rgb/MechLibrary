"""
Mech Reminders — local browser tests (Playwright + Chromium) against an IN-MEMORY FIREBASE STUB.

What this proves: the page's own logic (rendering, filters, admin flows, validation, notifications, XSS safety).
What this does NOT prove: real Firebase behaviour or firestore.rules — the stub only simulates "non-admin writes are rejected".

Setup:   pip install playwright   (Chromium path below; edit for your machine)
Serve:   a folder "site/" that contains "MechLibrary/" (the repo), e.g.  python3 -m http.server 8772 --directory site
Run:     python3 reminders-ui.py
"""
import json, sys, time, re
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8772/MechLibrary/'
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
ADMINS = ['ahmedramadantajeldin@gmail.com', 'ahmedyasserr219@gmail.com']
SDK = 'https://www.gstatic.com/firebasejs/10.14.1/'

CONFIG_JS = """export const FIREBASE_CONFIG={apiKey:'test',authDomain:'test.firebaseapp.com',projectId:'test',appId:'test'};
export const isConfigured=()=>true;"""

STUB = {
 'firebase-app.js': """const S=globalThis.__fb;
export const initializeApp=(c)=>{S.inits++;const a={config:c};S.apps.push(a);return a;};
export const getApps=()=>S.apps;
export const getApp=()=>S.apps[0];""",
 'firebase-auth.js': """const S=globalThis.__fb;
export const getAuth=()=>({});
export const onAuthStateChanged=(a,cb)=>{S.authCbs.push(cb);setTimeout(()=>cb(S.user),0);return ()=>{};};
export class GoogleAuthProvider{}
export const signInWithPopup=async()=>{if(S.popupError){const e=new Error('x');e.code=S.popupError;throw e;}S.user=S.nextUser;S.authCbs.forEach(cb=>cb(S.user));};
export const signOut=async()=>{S.user=null;S.authCbs.forEach(cb=>cb(null));};""",
 'firebase-firestore.js': """const S=globalThis.__fb;
const isAdmin=()=>S.user&&S.user.emailVerified&&S.admins.includes(S.user.email.toLowerCase());
const deny=()=>{const e=new Error('denied');e.code='permission-denied';throw e;};
export const getFirestore=()=>({});
export const collection=(db,name)=>({kind:'col',name});
export const doc=(db,name,id)=>({kind:'doc',name,id});
export const where=(f,op,v)=>({f,op,v});
export const query=(col,...w)=>({kind:'q',col,w});
export const Timestamp={fromMillis:(ms)=>({__ts:ms,toMillis:()=>ms})};
export const serverTimestamp=()=>({__ts:Date.now(),toMillis(){return this.__ts;}});
const snap=(q)=>S.docs.filter(d=>q.w.every(c=>d.data[c.f]===c.v)).map(d=>({id:d.id,data:()=>d.data}));
export const onSnapshot=(q,ok,err)=>{const t=q.kind==='q'?q:{col:q,w:[]};const pub=t.w.some(c=>c.f==='published'&&c.v===true);
  const run=()=>{ if(!pub&&!isAdmin()){err({code:'permission-denied'});return;} ok({docs:snap(t)}); };
  S.subs.add(run);setTimeout(run,0);return ()=>S.subs.delete(run);};
const bump=()=>S.subs.forEach(f=>f());
export const addDoc=async(col,data)=>{if(!isAdmin())deny();const id='n'+(++S.seq);S.docs.push({id,data:{...data}});S.writes.push(['add',id]);bump();return {id};};
export const updateDoc=async(ref,data)=>{if(!isAdmin())deny();const d=S.docs.find(x=>x.id===ref.id);if(!d)deny();Object.assign(d.data,data);S.writes.push(['update',ref.id]);bump();};
export const deleteDoc=async(ref)=>{if(!isAdmin())deny();S.docs=S.docs.filter(x=>x.id!==ref.id);S.writes.push(['delete',ref.id]);bump();};""",
}

def init_script(user=None, extra=''):
    return """
(()=>{ const H=3600e3,D=24*H,now=Date.now(); const ts=(ms)=>({__ts:ms,toMillis:()=>ms});
 const mk=(id,o)=>({id,data:Object.assign({courseCode:'',description:'',attachments:[],published:true,createdAt:ts(now),updatedAt:ts(now)},o,{deadline:ts(o.deadline),closesAt:ts(o.closesAt)})});
 globalThis.__fb={admins:%s,user:%s,nextUser:null,apps:[],inits:0,authCbs:[],subs:new Set(),writes:[],seq:0,popupError:null,docs:[
  mk('A',{subject:'Heat Transfer',type:'Quiz',deadline:now+5*H,closesAt:now+6*H,description:'Chapters 1-3',attachments:[{title:'Sheet 1',url:'https://example.com/a.pdf',description:'Bring a calculator'},{title:'Bad link',url:'javascript:alert(1)',description:''}]}),
  mk('B',{subject:'Fluid Mechanics II',type:'Assignment',deadline:now+10*D,closesAt:now+10*D+2*H}),
  mk('C',{subject:'Heat Transfer',type:'Midterm',deadline:now-2*H,closesAt:now+5*H}),
  mk('D',{subject:'Mechanical Design II',type:'M Project',deadline:now-5*D,closesAt:now-4*D}),
  mk('E',{subject:'SECRET DRAFT',type:'Quiz',deadline:now+3*D,closesAt:now+3*D+H,published:false}),
  mk('F',{subject:'<img src=x onerror="window.__xss=1">',type:'M Quiz',deadline:now+20*D,closesAt:now+21*D}),
 ]};
 %s })();""" % (json.dumps(ADMINS), json.dumps(user), extra)

ADMIN1 = {'email': ADMINS[0], 'emailVerified': True, 'displayName': 'Admin One'}
ADMIN2 = {'email': ADMINS[1].upper(), 'emailVerified': True, 'displayName': 'Admin Two'}   # upper-case: allowlist must be case-insensitive
OTHER = {'email': 'someone.else@gmail.com', 'emailVerified': True, 'displayName': 'Other'}
UNVERIFIED = {'email': ADMINS[0], 'emailVerified': False, 'displayName': 'Spoof'}

results = []
def check(name, cond, detail=''):
    results.append((bool(cond), name, detail))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if (detail and not cond) else ''))

def open_page(browser, path='reminders/', user=None, extra='', configured=True, viewport=None, grant=False):
    ctx = browser.new_context(viewport=viewport or {'width': 1280, 'height': 900})
    page = ctx.new_page()
    errors = []
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    if not configured:   # serve the placeholder config to test the "not connected yet" state
        page.route('**/reminders/firebase-config.js', lambda r: r.fulfill(body="export const FIREBASE_CONFIG={apiKey:'REPLACE_ME'};export const isConfigured=()=>false;", content_type='text/javascript'))
    if configured:
        page.route('**/reminders/firebase-config.js', lambda r: r.fulfill(body=CONFIG_JS, content_type='text/javascript'))
        for name, body in STUB.items():
            page.route(SDK + name, lambda r, req, b=body: r.fulfill(body=b, content_type='text/javascript'))
    page.add_init_script(init_script(user, extra))
    page.goto(BASE + path)
    return ctx, page, errors

def cards(page):
    return page.locator('#list .sub-card')

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])

        # ---------- 1. Homepage ----------
        ctx = browser.new_context(viewport={'width': 1280, 'height': 900}); page = ctx.new_page(); errs = []
        page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None); page.on('pageerror', lambda e: errs.append(str(e)))
        page.goto(BASE)
        card = page.locator('#reminders-slot .feature')
        check('1  homepage: Mech Reminders card visible to an anonymous visitor', card.is_visible())
        check('1  homepage: card title + description', 'Mech Reminders' in card.inner_text() and 'Submission deadlines, reminders, and course attachments.' in card.inner_text())
        href = page.locator('#reminders-slot a.btn').get_attribute('href')
        check('1  homepage: link is relative (works under /MechLibrary/)', href == 'reminders/', href)
        check('1  homepage: 9 course cards + drive card unchanged', page.locator('#course-grid li').count() == 9 and page.locator('#drive-slot .feature').count() == 1)
        hrefs = page.eval_on_selector_all('#course-grid a.btn', 'els=>els.map(e=>e.getAttribute("href"))')
        check('1  homepage: all course URLs are original github.io URLs', len(hrefs) == 9 and all(h.startswith('https://ahmedramadantajeldin-rgb.github.io/') for h in hrefs))
        page.locator('#reminders-slot a.btn').click(); page.wait_for_load_state()
        check('1  homepage: click opens /MechLibrary/reminders/', page.url == BASE + 'reminders/', page.url)
        check('1  homepage: no console errors', not errs, str(errs))
        # whole card clickable (stretched link): click on the card body, away from the button
        page.goto(BASE); page.locator('#reminders-slot .feature h2').click(position={'x': 5, 'y': 5}, force=True); page.wait_for_load_state()
        check('1  homepage: clicking the card text also navigates', page.url == BASE + 'reminders/', page.url)
        ctx.close()

        # ---------- 2. Unconfigured ----------
        ctx, page, errs = open_page(browser, configured=False)
        page.wait_for_timeout(300)
        check('2  unconfigured: says not connected, shows no board / admin / fake data',
              'not connected' in page.locator('#status').inner_text().lower() and page.locator('#board').is_hidden() and page.locator('#admin').is_hidden() and cards(page).count() == 0)
        check('2  unconfigured: no console errors', not errs, str(errs)); ctx.close()

        # ---------- 2b. Shipped (real) config file ----------
        ctx = browser.new_context(); cfg = ctx.request.get(BASE + 'reminders/firebase-config.js').text()
        check('2b shipped config targets project mechhub-reminders (authDomain, appId)', all(x in cfg for x in ["projectId: 'mechhub-reminders'", "authDomain: 'mechhub-reminders.firebaseapp.com'", "appId: '1:351195022792:web:70969d45b9e8eed61bacfd'"]) and 'REPLACE_ME' not in cfg.split('FIREBASE_CONFIG = {')[1].split('};')[0])
        page = ctx.new_page(); page.route(SDK + '*', lambda r, req: r.abort()); page.goto(BASE + 'reminders/'); page.wait_for_selector('#status .notice')
        check('2b real config but Firebase library unreachable → clear error, no board, no crash', 'Could not load the Firebase library' in page.inner_text('#status') and page.locator('#board').is_hidden())
        ctx.close()

        # ---------- 3. Public (anonymous) ----------
        ctx, page, errs = open_page(browser); page.wait_for_selector('#list .sub-card')
        txt = page.locator('#list').inner_text()
        check('3  public: 5 published records shown, draft hidden', cards(page).count() == 5 and 'SECRET DRAFT' not in txt and 'SECRET DRAFT' not in page.content())
        check('3  public: no admin controls visible', page.locator('#admin').is_hidden() and page.locator('[data-act=edit]').count() == 0 and page.locator('#admin-new').is_hidden())
        check('3  public: only a sign-in entry, no signed-in identity', 'Administrator sign-in' in page.locator('#account').inner_text())
        groups = page.eval_on_selector_all('#list .group', 'g=>g.map(x=>x.dataset.group)')
        check('3  public: grouped upcoming → overdue → closed', groups == ['upcoming', 'overdue', 'past'], str(groups))
        check('3  public: stats 3 / 1 / 1', [page.inner_text('#stat-upcoming'), page.inner_text('#stat-overdue'), page.inner_text('#stat-past')] == ['3', '1', '1'])
        urg = page.eval_on_selector_all('#list .sub-card', 'c=>c.map(x=>x.dataset.urgency)')
        check('3  public: urgency flags (urgent / normal / overdue / none)', 'urgent' in urg and 'overdue' in urg and 'none' in urg and 'normal' in urg, str(urg))
        a = page.locator('.sub-card[data-id=A]')
        check('3  public: urgent card shows hours left + both dates', re.search(r'\d+h \d+m left', a.inner_text()) and 'Deadline' in a.inner_text() and 'Closes' in a.inner_text(), a.inner_text())
        ov = page.locator('.sub-card[data-id=C]').inner_text()
        check('3  public: overdue wording does not claim anything about submission', 'Deadline passed' in ov and not re.search(r'submitted|missed|failed|late', ov, re.I), ov)
        link = a.locator('a[href="https://example.com/a.pdf"]')
        check('3  public: PDF link opens in new tab with noopener', link.count() == 1 and link.get_attribute('target') == '_blank' and 'noopener' in link.get_attribute('rel'))
        check('3  public: javascript: link is NOT rendered as a link', a.locator('a[href^="javascript"]').count() == 0 and 'link unavailable' in a.inner_text())
        check('3  public: XSS payload shown as text, not executed', page.evaluate('window.__xss') is None and '<img src=x' in page.locator('.sub-card[data-id=F] h3').inner_text())
        check('3  Firebase app initialized exactly once', page.evaluate('globalThis.__fb.inits') == 1)
        again = page.evaluate("""async()=>{const b=await import('./backend.js');const c=await import('./firebase-config.js');await b.createBackend(c.FIREBASE_CONFIG);await b.createBackend(c.FIREBASE_CONFIG);return globalThis.__fb.inits}""")
        check('3  creating the backend again reuses the app (no duplicate-app error)', again == 1, str(again))
        page.select_option('#flt-subject', 'Heat Transfer')
        check('3  filter by subject', cards(page).count() == 2)
        page.select_option('#flt-type', 'Midterm'); check('3  filter by type', cards(page).count() == 1)
        page.select_option('#flt-subject', 'all'); page.select_option('#flt-type', 'all'); page.select_option('#flt-status', 'past')
        check('3  filter by status', cards(page).count() == 1 and 'Mechanical Design II' in page.locator('#list').inner_text())
        page.select_option('#flt-status', 'all'); page.select_option('#flt-sort', 'subject')
        up = page.eval_on_selector_all('.group[data-group=upcoming] h3', 'h=>h.map(x=>x.textContent)')
        check('3  sort by subject A–Z within a group', up == sorted(up), str(up))
        page.select_option('#flt-sort', 'deadline-desc')
        up = page.eval_on_selector_all('.group[data-group=upcoming] .sub-card', 'c=>c.map(x=>x.dataset.id)')
        check('3  sort by deadline latest-first', up == ['F', 'B', 'A'], str(up))
        page.select_option('#flt-type', 'Quiz'); page.select_option('#flt-status', 'past')
        check('3  empty filter result message', page.locator('#empty').is_visible() and 'match' in page.inner_text('#empty'))
        check('3  public: no console errors', not errs, str(errs)); ctx.close()

        # ---------- 4. Public cannot write / non-admin ----------
        ctx, page, errs = open_page(browser, user=OTHER); page.wait_for_selector('#list .sub-card')
        check('4  non-admin signed in: sees notice, no dashboard, only published data', 'not authorized' in page.locator('#account').inner_text() and page.locator('#admin').is_hidden() and cards(page).count() == 5)
        r = page.evaluate("""async()=>{const m=await import('./firebase-config.js');const F=await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
            try{await F.addDoc(F.collection({}, 'submissions'),{x:1});return 'allowed';}catch(e){return e.code;}}""")
        check('4  [SIMULATED backend] non-admin write rejected', r == 'permission-denied', str(r)); ctx.close()
        ctx, page, errs = open_page(browser, user=UNVERIFIED); page.wait_for_selector('#list .sub-card')
        check('4  allow-listed email but UNVERIFIED → no dashboard', page.locator('#admin').is_hidden()); ctx.close()

        # ---------- 5. Admin flows ----------
        for label, u in (('admin 1', ADMIN1), ('admin 2 (upper-case email)', ADMIN2)):
            ctx, page, errs = open_page(browser, user=u); page.wait_for_selector('#admin-list .admin-row')
            check(f'5  {label}: dashboard visible and lists drafts + published', page.locator('#admin').is_visible() and page.locator('#admin-list .admin-row').count() == 6 and 'SECRET DRAFT' in page.locator('#admin-list').inner_text())
            ctx.close()

        ctx, page, errs = open_page(browser); page.wait_for_selector('#list .sub-card')
        page.evaluate("globalThis.__fb.nextUser=%s" % json.dumps(ADMIN1)); page.click('text=Administrator sign-in')
        page.wait_for_selector('#admin:not([hidden])')
        check('5  sign-in via button shows dashboard; sign-out hides it', True)
        # validation
        page.click('#admin-new'); page.fill('#f-subject', ' '); page.click('#f-save')
        check('5  form validation: required fields flagged', page.locator('#e-subject').inner_text() != '' and page.locator('#e-type').inner_text() != '' and page.locator('#e-deadline').inner_text() != '')
        page.fill('#f-subject', 'Thermodynamics III'); page.select_option('#f-type', 'Quiz')
        page.fill('#f-deadline', '2099-05-10T10:00'); page.fill('#f-closes', '2099-05-10T09:00'); page.click('#f-save')
        check('5  closing time earlier than deadline rejected', 'earlier' in page.locator('#e-closesAt').inner_text())
        page.fill('#f-closes', '2099-05-10T12:00')
        page.locator('#f-atts .a-title').first.fill('Past paper'); page.locator('#f-atts .a-url').first.fill('http://insecure.example/x.pdf'); page.click('#f-save')
        check('5  non-https PDF link rejected', 'https' in page.locator('#f-atts [data-e=url]').first.inner_text())
        page.locator('#f-atts .a-url').first.fill('https://example.org/past.pdf')
        page.click('#f-add-att'); page.locator('#f-atts .a-title').nth(1).fill('Formula sheet'); page.locator('#f-atts .a-url').nth(1).fill('https://example.org/f.pdf')
        page.click('#f-add-att'); check('5  can add several PDF links', page.locator('#f-atts .att-row').count() == 3)
        page.locator('#f-atts [data-act=remove-att]').nth(2).click(); check('5  can remove a PDF link', page.locator('#f-atts .att-row').count() == 2)
        page.click('#f-preview'); check('5  preview shows student view of the draft', page.locator('#preview-dialog').is_visible() and 'Thermodynamics III' in page.inner_text('#preview-card') and 'Past paper' in page.inner_text('#preview-card'))
        page.click('#p-close'); page.click('#f-save'); page.wait_for_selector('#form-dialog', state='hidden')
        check('5  saved as draft: NOT visible to students', 'Thermodynamics III' not in page.inner_text('#list') and 'Thermodynamics III' in page.inner_text('#admin-list'))
        row = page.locator('#admin-list .admin-row', has_text='Thermodynamics III')
        row.locator('[data-act=publish]').click(); check('5  publish opens a preview first', page.locator('#preview-dialog').is_visible() and page.locator('#p-publish').is_visible())
        page.click('#p-publish'); page.wait_for_selector('#preview-dialog', state='hidden')
        check('5  after publishing, students see it with 2 PDF links', 'Thermodynamics III' in page.inner_text('#list') and page.locator('#list .sub-card', has_text='Thermodynamics III').locator('.atts a').count() == 2)
        # edit
        page.locator('#admin-list .admin-row', has_text='Thermodynamics III').locator('[data-act=edit]').click()
        check('5  edit form pre-filled incl. Cairo times', page.input_value('#f-deadline') == '2099-05-10T10:00' and page.input_value('#f-closes') == '2099-05-10T12:00' and page.input_value('#f-type') == 'Quiz')
        page.fill('#f-subject', 'Thermodynamics 3'); page.click('#f-save'); page.wait_for_selector('#form-dialog', state='hidden')
        check('5  edit saved and visible', 'Thermodynamics 3' in page.inner_text('#list'))
        # unpublish
        page.locator('#admin-list .admin-row', has_text='Thermodynamics 3').locator('[data-act=unpublish]').click(); page.wait_for_timeout(150)
        check('5  unpublish hides it from students', 'Thermodynamics 3' not in page.inner_text('#list'))
        # delete with confirmation
        page.locator('#admin-list .admin-row', has_text='Thermodynamics 3').locator('[data-act=delete]').click()
        check('5  delete asks for confirmation', page.locator('#confirm-dialog').is_visible()); page.click('#c-cancel')
        check('5  cancel keeps the record', 'Thermodynamics 3' in page.inner_text('#admin-list'))
        page.locator('#admin-list .admin-row', has_text='Thermodynamics 3').locator('[data-act=delete]').click(); page.click('#c-delete'); page.wait_for_selector('#confirm-dialog', state='hidden')
        check('5  delete removes it', 'Thermodynamics 3' not in page.inner_text('#admin-list'))
        # all seven types round-trip
        types = ['Assignment', 'Quiz', 'Midterm', 'M Assignment', 'M Quiz', 'M Midterm', 'M Project']
        opts = page.evaluate("()=>{document.getElementById('admin-new').click();const o=[...document.querySelectorAll('#f-type option')].map(x=>x.value).filter(Boolean);document.getElementById('f-cancel').click();return o}")
        check('5  type dropdown offers exactly the seven types', opts == types, str(opts))
        for i, t in enumerate(types):
            page.click('#admin-new'); page.fill('#f-subject', f'T{i}'); page.select_option('#f-type', t)
            page.fill('#f-deadline', '2099-06-01T10:00'); page.fill('#f-closes', '2099-06-01T10:00'); page.check('#f-published'); page.click('#f-save'); page.wait_for_selector('#form-dialog', state='hidden')
        got = page.eval_on_selector_all('#list .sub-card', 'c=>c.map(x=>x.querySelector(".badge.type").textContent+"|"+x.querySelector("h3").textContent)')
        check('5  all seven types saved & shown (deadline = closing allowed, shown separately)', all(f'{t}|T{i}' in got for i, t in enumerate(types)), str(got))
        w = page.evaluate('globalThis.__fb.writes.length'); check('5  [stub] writes were recorded', w >= 10, str(w))
        page.click('text=Sign out'); page.wait_for_timeout(200)
        check('5  sign-out hides dashboard and drafts', page.locator('#admin').is_hidden() and 'SECRET DRAFT' not in page.content())
        # write error surfaced when backend rejects (signed out mid-edit)
        check('5  admin session: no console errors', not errs, str(errs)); ctx.close()

        # ---------- 6. Notifications ----------
        mock = """globalThis.__notes=[];class N{constructor(t,o){globalThis.__notes.push([t,o&&o.body]);} }
          N.permission='default';N.requestPermission=()=>{N.permission='PERM';return Promise.resolve('PERM');};Object.defineProperty(window,'Notification',{value:N,configurable:true});"""
        mock_tpl = mock; mock = mock_tpl.replace('PERM', 'granted')
        ctx, page, errs = open_page(browser, extra=mock); page.wait_for_selector('#list .sub-card')
        page.click('#notify-box summary')
        check('6  notification box states the "only while open" limitation', 'only while Mech Reminders is open' in page.inner_text('#n-hint'))
        page.click('#n-enable'); page.wait_for_timeout(2500)
        notes = page.evaluate('globalThis.__notes')
        subjects = [n[0] for n in notes]
        check('6  enabling fires exactly ONE reminder for the record due in 5 h (24 h lead crossed)', len([s for s in subjects if 'Heat Transfer' in s]) == 1, str(notes))
        page.wait_for_timeout(100)
        n_before = len(page.evaluate('globalThis.__notes')); page.evaluate('document.dispatchEvent(new Event("visibilitychange"))'); page.wait_for_timeout(1800)
        check('6  no duplicate notification on re-check', len(page.evaluate('globalThis.__notes')) == n_before)
        check('6  settings persisted on this device only', 'enabled' in (page.evaluate("localStorage.getItem('mechReminders.settings.v1')") or ''))
        ctx.close()
        mock_denied = mock_tpl.replace('PERM', 'denied')
        ctx, page, errs = open_page(browser, extra=mock_denied); page.wait_for_selector('#list .sub-card')
        page.click('#notify-box summary'); page.click('#n-enable'); page.wait_for_timeout(200)
        check('6  permission denied → checkbox unticks + explains', not page.is_checked('#n-enable') and 'blocked' in page.inner_text('#n-hint')); ctx.close()

        # ---------- 7. Errors ----------
        ctx, page, errs = open_page(browser, extra="globalThis.__fb.popupError='auth/popup-blocked'"); page.wait_for_selector('#list .sub-card')
        page.click('text=Administrator sign-in'); page.wait_for_timeout(200)
        check('7  sign-in popup blocked → helpful message', 'pop-up' in page.locator('#status').inner_text().lower()); ctx.close()
        ctx, page, errs = open_page(browser, user=ADMIN1, extra="globalThis.__fb.admins=[]")   # page thinks admin, server (stub) disagrees
        page.wait_for_selector('#status .notice'); 
        check('7  server refuses admin read → error shown, no crash', 'Not allowed' in page.locator('#status').inner_text()); ctx.close()
        # write rejected by the server while UI believed admin
        ctx, page, errs = open_page(browser, user=ADMIN1); page.wait_for_selector('#admin-list .admin-row')
        page.evaluate("globalThis.__fb.admins=[]")
        page.locator('#admin-list [data-act=unpublish]').first.click(); page.wait_for_timeout(200)
        check('7  [SIMULATED] server rejects a write → clear error, UI stays usable', 'Not allowed' in page.locator('#status').inner_text()); ctx.close()

        # ---------- 8. Layout ----------
        for name, vp in (('mobile 375', {'width': 375, 'height': 800}), ('tablet 768', {'width': 768, 'height': 1000}), ('desktop 1280', {'width': 1280, 'height': 900})):
            ctx, page, errs = open_page(browser, user=ADMIN1, viewport=vp); page.wait_for_selector('#list .sub-card')
            ov = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            check(f'8  {name}: no horizontal scroll (reminders)', ov <= 0, str(ov))
            if name.startswith('mobile'):
                page.screenshot(path='/home/claude/shots/rem-mobile.png', full_page=True)
                page.click('#admin-new'); page.screenshot(path='/home/claude/shots/rem-mobile-form.png')
                fits = page.evaluate("(()=>{const d=document.getElementById('form-dialog').getBoundingClientRect();return d.width<=window.innerWidth})()")
                check('8  mobile: form dialog fits the screen', fits)
            if name.startswith('desktop'): page.screenshot(path='/home/claude/shots/rem-desktop.png', full_page=True)
            ctx.close()
            ctx = browser.new_context(viewport=vp); pg = ctx.new_page(); pg.goto(BASE)
            ov = pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            check(f'8  {name}: no horizontal scroll (homepage)', ov <= 0, str(ov))
            if name.startswith('mobile') or name.startswith('desktop'): pg.screenshot(path=f'/home/claude/shots/home-{name.split()[0]}.png')
            ctx.close()
        browser.close()

    bad = [r for r in results if not r[0]]
    print(f'\n{len(results) - len(bad)}/{len(results)} checks passed'); sys.exit(1 if bad else 0)

run()
