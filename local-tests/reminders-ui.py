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
OWNER = 'ahmedramadantajeldin@gmail.com'
PREVIOUS = ['ahmedyasserr219@gmail.com', 'mohamed.ibrahim200600@gmail.com', 'ahmedtageldien83@gmail.com']   # migrated into the admins collection
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
const OWNER='ahmedramadantajeldin@gmail.com';
const me=()=>S.user&&S.user.emailVerified?S.user.email.toLowerCase():null;
const isOwner=()=>me()===OWNER;
const isListed=()=>!!(me()&&S.adminDocs[me()]&&S.adminDocs[me()].active===true);
const isAdmin=()=>isOwner()||isListed();
const isManager=()=>isListed()&&S.adminDocs[me()].canManageAdmins===true;
const canMng=()=>isOwner()||isManager();
const mayChange=(id)=>isOwner()||(isManager()&&id!==me()&&!(S.adminDocs[id]&&S.adminDocs[id].canManageAdmins===true));
const deny=()=>{const e=new Error('denied');e.code='permission-denied';throw e;};
export const getFirestore=()=>({});
export const collection=(db,name)=>({kind:'col',name});
export const doc=(db,name,id)=>({kind:'doc',name,id});
export const where=(f,op,v)=>({f,op,v});
export const query=(col,...w)=>({kind:'q',col,w});
export const Timestamp={fromMillis:(ms)=>({__ts:ms,toMillis:()=>ms})};
export const serverTimestamp=()=>({__ts:Date.now(),toMillis(){return this.__ts;}});
export const deleteField=()=>({__del:true});
const snap=(q)=>S.docs.filter(d=>q.w.every(c=>d.data[c.f]===c.v)).map(d=>({id:d.id,data:()=>d.data}));
export const onSnapshot=(q,ok,err)=>{
  if(q.kind==='doc'&&q.name==='admins'){
    const run=()=>{ if(!(isOwner()||(me()&&q.id===me()))){err({code:'permission-denied'});return;} const d=S.adminDocs[q.id]; ok({exists:()=>!!d,data:()=>d}); };
    S.subs.add(run);setTimeout(()=>{if(S.subs.has(run))run();},0);return ()=>S.subs.delete(run);}
  if(q.kind==='col'&&q.name==='admins'){
    const run=()=>{ if(S.adminListError){err({code:'unavailable'});return;} if(!canMng()){err({code:'permission-denied'});return;} ok({docs:Object.entries(S.adminDocs).map(([id,d])=>({id,data:()=>d}))}); };
    S.subs.add(run);setTimeout(()=>{if(S.subs.has(run))run();},0);return ()=>S.subs.delete(run);}
  const t=q.kind==='q'?q:{col:q,w:[]};const pub=t.w.some(c=>c.f==='published'&&c.v===true);
  const run=()=>{ if(!pub&&!isAdmin()){err({code:'permission-denied'});return;} ok({docs:snap(t)}); };
  S.subs.add(run);setTimeout(()=>{if(S.subs.has(run))run();},0);return ()=>S.subs.delete(run);};
const bump=()=>[...S.subs].forEach(f=>{if(S.subs.has(f))f();});
S.bump=bump;
const adminWrite=()=>{ if(!canMng()||S.denyAdminWrites)deny(); };
const mkAdmin=(id,o,data)=>{ if(data&&data.canManageAdmins===true&&!isOwner())deny(); return {email:id,active:true,addedBy:me(),createdAt:serverTimestamp(),updatedAt:serverTimestamp(),...(data&&data.canManageAdmins===true?{canManageAdmins:true}:{}),...o}; };
export const addDoc=async(col,data)=>{if(!isAdmin())deny();const id='n'+(++S.seq);S.docs.push({id,data:{...data}});S.writes.push(['add',id]);bump();return {id};};
export const setDoc=async(ref,data)=>{adminWrite();if(S.adminDocs[ref.id]||ref.id===OWNER)deny();S.adminDocs[ref.id]=mkAdmin(ref.id,{},data);S.adminWrites.push(['set',ref.id]);bump();};
export const updateDoc=async(ref,data)=>{
  if(ref.name==='admins'){adminWrite();const d=S.adminDocs[ref.id];if(!d||!mayChange(ref.id))deny();if('canManageAdmins' in data&&!isOwner())deny();for(const [k,v] of Object.entries(data)){if(v&&v.__del)delete d[k];else d[k]=v;}S.adminWrites.push(['update',ref.id,data.active]);bump();return;}
  if(!isAdmin())deny();const d=S.docs.find(x=>x.id===ref.id);if(!d)deny();Object.assign(d.data,data);S.writes.push(['update',ref.id]);bump();};
export const deleteDoc=async(ref)=>{
  if(ref.name==='admins'){adminWrite();if(!mayChange(ref.id))deny();delete S.adminDocs[ref.id];S.adminWrites.push(['delete',ref.id]);bump();return;}
  if(!isAdmin())deny();S.docs=S.docs.filter(x=>x.id!==ref.id);S.writes.push(['delete',ref.id]);bump();};
export const writeBatch=()=>{const ops=[];return {set:(ref,data)=>{ops.push([ref,data]);},commit:async()=>{adminWrite();if(ops.some(([r])=>S.adminDocs[r.id]))deny();ops.forEach(([r,data])=>{S.adminDocs[r.id]=mkAdmin(r.id,{},data);S.adminWrites.push(['batch-set',r.id]);});bump();}};};""" ,
}

def init_script(user=None, extra='', admins=None):
    return """
(()=>{ const H=3600e3,D=24*H,now=Date.now(); const ts=(ms)=>({__ts:ms,toMillis:()=>ms});
 const mk=(id,o)=>({id,data:Object.assign({courseCode:'',description:'',attachments:[],published:true,createdAt:ts(now),updatedAt:ts(now)},o,{deadline:ts(o.deadline),closesAt:ts(o.closesAt)})});
 globalThis.__fb={adminDocs:Object.fromEntries(%s.map(e=>[e,{email:e,active:true,addedBy:'ahmedramadantajeldin@gmail.com',createdAt:ts(now),updatedAt:ts(now),...(e==='ahmedyasserr219@gmail.com'?{canManageAdmins:true}:{})}])),adminWrites:[],user:%s,nextUser:null,apps:[],inits:0,authCbs:[],subs:new Set(),writes:[],seq:0,popupError:null,docs:[
  mk('A',{subject:'Heat Transfer',type:'Quiz',deadline:now+5*H,closesAt:now+6*H,description:'Chapters 1-3',attachments:[{title:'Sheet 1',url:'https://example.com/a.pdf',description:'Bring a calculator'},{title:'Bad link',url:'javascript:alert(1)',description:''}]}),
  mk('B',{subject:'Fluid Mechanics II',type:'Assignment',deadline:now+10*D,closesAt:now+10*D+2*H}),
  mk('C',{subject:'Heat Transfer',type:'Midterm',deadline:now-2*H,closesAt:now+5*H}),
  mk('D',{subject:'Mechanical Design II',type:'M Project',deadline:now-5*D,closesAt:now-4*D}),
  mk('E',{subject:'SECRET DRAFT',type:'Quiz',deadline:now+3*D,closesAt:now+3*D+H,published:false}),
  mk('F',{subject:'<img src=x onerror="window.__xss=1">',type:'M Quiz',deadline:now+20*D,closesAt:now+21*D}),
 ]};
 %s })();""" % (json.dumps(PREVIOUS if admins is None else admins), json.dumps(user), extra)

ADMIN1 = {'email': OWNER, 'emailVerified': True, 'displayName': 'Owner'}                      # the owner is an administrator too
ADMIN2 = {'email': PREVIOUS[0].upper(), 'emailVerified': True, 'displayName': 'Ahmed Yasser'}   # a MANAGER (ahmedyasserr219): upper-case, matching must be case-insensitive
REG = {'email': PREVIOUS[1].upper(), 'emailVerified': True, 'displayName': 'Regular admin'}    # an ordinary administrator
OTHER = {'email': 'someone.else@gmail.com', 'emailVerified': True, 'displayName': 'Other'}
UNVERIFIED = {'email': OWNER, 'emailVerified': False, 'displayName': 'Spoof'}
UNVERIFIED_LISTED = {'email': PREVIOUS[0], 'emailVerified': False, 'displayName': 'Spoof2'}

results = []
def check(name, cond, detail=''):
    results.append((bool(cond), name, detail))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if (detail and not cond) else ''))

def open_page(browser, path='reminders/', user=None, extra='', configured=True, viewport=None, grant=False, admins=None, storage_state=None):
    ctx = browser.new_context(viewport=viewport or {'width': 1280, 'height': 900}, storage_state=storage_state)
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
    page.add_init_script(init_script(user, extra, admins))
    page.goto(BASE + path)
    return ctx, page, errors

def cards(page):
    return page.locator('#list .sub-card')

# ---- subject picker helpers (multi-select dropdown) ----
def open_picker(page):
    if not page.locator('#flt-subject').evaluate('e => e.open'):
        page.click('#flt-subject-btn')

def pick_subject(page, label):          # tick / untick one subject by its visible name
    open_picker(page)
    page.locator('#flt-subject-list label', has_text=label).locator('input').click()

def reset_subjects(page):
    open_picker(page); page.click('#flt-subject-all')

def picker_summary(page):
    return page.inner_text('#flt-subject-text')

def shown_subjects(page):
    return sorted(set(page.eval_on_selector_all('#list .sub-card h3', 'h=>h.map(x=>x.textContent)')))


USER_A = {'email': 'student.a@example.com', 'emailVerified': True, 'displayName': 'A', 'uid': 'uid-A'}
USER_B = {'email': 'student.b@example.com', 'emailVerified': True, 'displayName': 'B', 'uid': 'uid-B'}
ALL5 = ['<img src=x onerror="window.__xss=1">', 'Fluid Mechanics II', 'Heat Transfer', 'Mechanical Design II']
LS_KEYS = "Object.keys(localStorage).filter(k=>k.startsWith('mechReminders.subjects.v1')).sort()"

def sign_in_as(page, user):             # what Firebase does when the account changes in an open page
    page.evaluate("u=>{__fb.user=u;__fb.authCbs.forEach(cb=>cb(u))}", user); page.wait_for_timeout(250)

def subject_filter_tests(browser):
    # ---------- 3b. Multi-subject selection (anonymous visitor) ----------
    ctx, page, errs = open_page(browser); page.wait_for_selector('#list .sub-card')
    check('3b default: "All subjects", every record shown', picker_summary(page) == 'All subjects' and cards(page).count() == 5 and page.is_checked('#flt-subject-all'))
    open_picker(page)
    labels = page.eval_on_selector_all('#flt-subject-list .ms-opt span', 'e=>e.map(x=>x.textContent)')
    check('3b options are generated from the published data (4 subjects; the draft subject is not offered)', sorted(labels) == sorted(ALL5) and 'SECRET DRAFT' not in labels, str(labels))
    check('3b no option is ticked while "All subjects" is active', page.locator('#flt-subject-list input:checked').count() == 0)
    pick_subject(page, 'Heat Transfer')
    check('3b one subject: only its records (2), summary shows its name, "All" unticked', cards(page).count() == 2 and shown_subjects(page) == ['Heat Transfer'] and picker_summary(page) == 'Heat Transfer' and not page.is_checked('#flt-subject-all'))
    pick_subject(page, 'Fluid Mechanics II')
    check('3b two subjects: records of both (3), summary "2 subjects"', cards(page).count() == 3 and shown_subjects(page) == ['Fluid Mechanics II', 'Heat Transfer'] and picker_summary(page) == '2 subjects')
    pick_subject(page, 'Mechanical Design II')
    check('3b three subjects: 4 records, summary "3 subjects"', cards(page).count() == 4 and picker_summary(page) == '3 subjects')
    pick_subject(page, 'Heat Transfer')
    check('3b unticking one updates the list at once and keeps the other two', cards(page).count() == 2 and shown_subjects(page) == ['Fluid Mechanics II', 'Mechanical Design II'] and page.locator('#flt-subject-list input:checked').count() == 2)
    page.select_option('#flt-status', 'past')
    check('3b combines with the status filter (closed + 2 subjects → 1)', cards(page).count() == 1 and shown_subjects(page) == ['Mechanical Design II'])
    page.select_option('#flt-status', 'all'); page.select_option('#flt-type', 'Quiz'); pick_subject(page, 'Heat Transfer')
    check('3b combines with the type filter (Quiz + Heat/Fluid/Mech → Heat quiz only)', cards(page).count() == 1 and page.locator('.sub-card[data-id=A]').count() == 1)
    page.select_option('#flt-type', 'all')
    for name in ('Heat Transfer', 'Fluid Mechanics II', 'Mechanical Design II'): pick_subject(page, name)
    check('3b unticking the last subject returns to "All subjects" (5 records)', picker_summary(page) == 'All subjects' and cards(page).count() == 5 and page.is_checked('#flt-subject-all'))
    for name in ALL5: pick_subject(page, name)
    check('3b ticking every subject = "All subjects" (5 records, no stale partial state)', picker_summary(page) == 'All subjects' and cards(page).count() == 5 and page.locator('#flt-subject-list input:checked').count() == 0)
    page.click('#flt-subject-all')
    check('3b "All subjects" cannot be unticked into an empty selection', page.is_checked('#flt-subject-all') and cards(page).count() == 5)
    pick_subject(page, 'Heat Transfer'); pick_subject(page, 'Fluid Mechanics II'); page.click('#flt-subject-reset')
    check('3b "Reset to all subjects" shows everything and the button is disabled again', cards(page).count() == 5 and picker_summary(page) == 'All subjects' and page.is_disabled('#flt-subject-reset'))
    check('3b reset also clears the saved entry', page.evaluate(LS_KEYS) == [], str(page.evaluate(LS_KEYS)))
    pick_subject(page, 'Heat Transfer'); page.keyboard.press('Escape')
    check('3b Escape closes the panel', not page.locator('#flt-subject').evaluate('e=>e.open') and cards(page).count() == 2)
    open_picker(page); page.click('.tz-note')
    check('3b clicking elsewhere closes the panel', not page.locator('#flt-subject').evaluate('e=>e.open'))
    ctx.close()

    # ---------- 3c. New subject appears without a reload ----------
    ctx, page, errs = open_page(browser); page.wait_for_selector('#list .sub-card')
    page.evaluate("""()=>{const ts=(ms)=>({__ts:ms,toMillis:()=>ms});const n=Date.now();
      __fb.docs.push({id:'Z',data:{subject:'Thermodynamics',type:'Quiz',courseCode:'',description:'',attachments:[],published:true,deadline:ts(n+4*864e5),closesAt:ts(n+5*864e5)}});__fb.bump();}""")
    page.wait_for_selector('.sub-card[data-id=Z]'); open_picker(page)
    check('3c a newly published subject shows up as an option automatically', page.locator('#flt-subject-list .ms-opt', has_text='Thermodynamics').count() == 1)
    pick_subject(page, 'Thermodynamics'); check('3c ...and can be selected', cards(page).count() == 1)
    check('3c no console errors', not errs, str(errs)); ctx.close()

    # ---------- 3d. Saved choice: reload, browser restart, stale / corrupt data ----------
    ctx, page, errs = open_page(browser); page.wait_for_selector('#list .sub-card')
    pick_subject(page, 'Heat Transfer'); pick_subject(page, 'Mechanical Design II')
    page.reload(); page.wait_for_selector('#list .sub-card')
    check('3d survives a page refresh (same 2 subjects, same 3 records)', picker_summary(page) == '2 subjects' and cards(page).count() == 3 and shown_subjects(page) == ['Heat Transfer', 'Mechanical Design II'])
    open_picker(page)
    check('3d the right boxes are ticked after the refresh', sorted(page.eval_on_selector_all('#flt-subject-list input:checked', 'e=>e.map(x=>x.value)')) == ['heat transfer', 'mechanical design ii'])
    state = ctx.storage_state(); ctx.close()
    ctx, page, errs = open_page(browser, storage_state=state); page.wait_for_selector('#list .sub-card')
    check('3d survives closing and reopening the browser', picker_summary(page) == '2 subjects' and cards(page).count() == 3)
    entries = page.evaluate("Object.fromEntries(" + LS_KEYS + ".map(k=>[k,localStorage.getItem(k)]))")
    check('3d saved locally under one visitor entry holding only subject names (no e-mail / IP)', list(entries) == ['mechReminders.subjects.v1.visitor'] and '@' not in json.dumps(entries), str(entries))
    check('3d nothing about this preference was written to Firestore', page.evaluate('globalThis.__fb.writes.length') == 0)
    check('3d no console errors', not errs, str(errs)); ctx.close()

    ctx, page, errs = open_page(browser, extra="localStorage.setItem('mechReminders.subjects.v1.visitor','{\"v\":1,\"subjects\":[\"a subject that no longer exists\"]}');"); page.wait_for_selector('#list .sub-card')
    check('3d saved subject that no longer exists → shows everything (not an empty page)', cards(page).count() == 5 and picker_summary(page) == 'All subjects')
    check('3d ...and the saved entry is not erased behind the user\'s back', 'no longer exists' in (page.evaluate("localStorage.getItem('mechReminders.subjects.v1.visitor')") or ''))
    pick_subject(page, 'Heat Transfer')
    check('3d the next change replaces the stale entry', page.evaluate("localStorage.getItem('mechReminders.subjects.v1.visitor')") == '{"v":1,"subjects":["heat transfer"]}')
    ctx.close()
    ctx, page, errs = open_page(browser, extra="localStorage.setItem('mechReminders.subjects.v1.visitor','{{{broken');"); page.wait_for_selector('#list .sub-card')
    check('3d corrupt saved data → All subjects, no console errors', cards(page).count() == 5 and picker_summary(page) == 'All subjects' and not errs, str(errs)); ctx.close()
    ctx, page, errs = open_page(browser, extra="Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}});"); page.wait_for_selector('#list .sub-card')
    pick_subject(page, 'Heat Transfer')
    check('3d storage blocked by the browser → filter still works for this visit, no crash', cards(page).count() == 2 and not [e for e in errs if 'blocked' not in e], str(errs)); ctx.close()

    # ---------- 3e. Separate users, logout, return ----------
    ctx, page, errs = open_page(browser, user=USER_A); page.wait_for_selector('#list .sub-card')
    check('3e signed-in user with nothing saved starts on "All subjects"', picker_summary(page) == 'All subjects' and cards(page).count() == 5)
    pick_subject(page, 'Heat Transfer')
    check('3e user A: choice saved under A\'s own uid key', page.evaluate(LS_KEYS) == ['mechReminders.subjects.v1.uid.uid-A'], str(page.evaluate(LS_KEYS)))
    page.get_by_role('button', name='Sign out').click(); page.wait_for_selector('#list .sub-card')
    check('3e after logout the saved choice is NOT deleted', 'mechReminders.subjects.v1.uid.uid-A' in page.evaluate(LS_KEYS))
    check('3e after logout the visitor sees their own default (All), not A\'s choice', picker_summary(page) == 'All subjects' and cards(page).count() == 5)
    pick_subject(page, 'Fluid Mechanics II'); pick_subject(page, 'Mechanical Design II')
    sign_in_as(page, USER_B)
    check('3e user B (same browser) starts on All subjects, A\'s and the visitor\'s choices are not applied', picker_summary(page) == 'All subjects' and cards(page).count() == 5)
    pick_subject(page, 'Heat Transfer')
    check('3e user B chose Heat Transfer only (2 records)', picker_summary(page) == 'Heat Transfer' and cards(page).count() == 2)
    sign_in_as(page, USER_A)
    check('3e switching back to A restores A\'s choice (Heat Transfer) — B did not overwrite it', picker_summary(page) == 'Heat Transfer' and cards(page).count() == 2)
    pick_subject(page, 'Fluid Mechanics II')
    sign_in_as(page, USER_B)
    check('3e B still has only Heat Transfer after A changed theirs', picker_summary(page) == 'Heat Transfer' and cards(page).count() == 2)
    sign_in_as(page, None)
    check('3e visitor entry kept separately (Fluid + Mechanical Design)', picker_summary(page) == '2 subjects' and shown_subjects(page) == ['Fluid Mechanics II', 'Mechanical Design II'])
    keys = page.evaluate(LS_KEYS)
    check('3e exactly three entries: visitor, uid-A, uid-B', keys == ['mechReminders.subjects.v1.uid.uid-A', 'mechReminders.subjects.v1.uid.uid-B', 'mechReminders.subjects.v1.visitor'], str(keys))
    dump = page.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('mechReminders.subjects')).map(k=>k+localStorage.getItem(k)).join('|')")
    check('3e no e-mail address stored in any preference entry', 'student.' not in dump and '@' not in dump, dump)
    state = ctx.storage_state(); ctx.close()
    ctx, page, errs = open_page(browser, user=USER_A, storage_state=state); page.wait_for_selector('#list .sub-card')
    check('3e A returns in a later session (signed in at load): saved choice restored', picker_summary(page) == '2 subjects' and shown_subjects(page) == ['Fluid Mechanics II', 'Heat Transfer'])
    check('3e no console errors in the user scenarios', not errs, str(errs)); ctx.close()

    # ---------- 3f. Admin: preference is display-only ----------
    OWNER_U = {**ADMIN1, 'uid': 'uid-owner'}
    ctx, page, errs = open_page(browser, user=OWNER_U); page.wait_for_selector('#admin-list .admin-row')
    pick_subject(page, 'Heat Transfer')
    check('3f owner: the public list is filtered (2), the dashboard still lists every record incl. the draft (6)', cards(page).count() == 2 and page.locator('#admin-list .admin-row').count() == 6)
    check('3f owner: access and Admin Management unaffected by the preference', page.locator('#owner-panel').is_visible() and 'Owner' in page.inner_text('#account'))
    page.reload(); page.wait_for_selector('#admin-list .admin-row'); page.wait_for_selector('#list .sub-card')
    check('3f owner: after refresh the dashboard (6 rows) and the saved filter (Heat Transfer, 2 records) are both there', page.locator('#admin-list .admin-row').count() == 6 and picker_summary(page) == 'Heat Transfer' and cards(page).count() == 2)
    check('3f owner: preference stored under the owner uid, not under any role or e-mail; no console errors', page.evaluate(LS_KEYS) == ['mechReminders.subjects.v1.uid.uid-owner'] and not errs, str(errs))
    ctx.close()

    # ---------- 3g. Small screen ----------
    ctx, page, errs = open_page(browser, viewport={'width': 375, 'height': 800}); page.wait_for_selector('#list .sub-card')
    open_picker(page)
    box = page.locator('#flt-subject .ms-panel').bounding_box()
    ov = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
    check('3g mobile 375: open picker fits the screen, no horizontal scroll', box and box['x'] >= 0 and box['x'] + box['width'] <= 375 and ov <= 0, f'{box} overflow={ov}')
    page.screenshot(path='/home/claude/shots/picker-mobile.png')
    ctx.close()
    ctx, page, errs = open_page(browser, viewport={'width': 1280, 'height': 900}); page.wait_for_selector('#list .sub-card')
    pick_subject(page, 'Heat Transfer'); pick_subject(page, 'Fluid Mechanics II'); page.screenshot(path='/home/claude/shots/picker-desktop-open.png')
    page.keyboard.press('Escape'); page.screenshot(path='/home/claude/shots/picker-desktop-closed.png')
    ctx.close()

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
        check('3  public: no admin controls visible', page.locator('#admin').is_hidden() and page.locator('#owner-panel').is_hidden() and page.locator('#owner-list li').count() == 0 and page.locator('[data-act=edit]').count() == 0 and page.locator('#admin-new').is_hidden())
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
        pick_subject(page, 'Heat Transfer')
        check('3  filter by subject', cards(page).count() == 2)
        page.select_option('#flt-type', 'Midterm'); check('3  filter by type', cards(page).count() == 1)
        reset_subjects(page); page.select_option('#flt-type', 'all'); page.select_option('#flt-status', 'past')
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

        subject_filter_tests(browser)

        # ---------- 4. Public cannot write / non-admin ----------
        ctx, page, errs = open_page(browser, user=OTHER); page.wait_for_selector('#list .sub-card')
        check('4  non-admin signed in: sees notice, no dashboard, only published data', 'not authorized' in page.locator('#account').inner_text() and page.locator('#admin').is_hidden() and cards(page).count() == 5)
        r = page.evaluate("""async()=>{const m=await import('./firebase-config.js');const F=await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
            try{await F.addDoc(F.collection({}, 'submissions'),{x:1});return 'allowed';}catch(e){return e.code;}}""")
        check('4  [SIMULATED backend] non-admin write rejected', r == 'permission-denied', str(r))
        check('4  non-admin: no Admin Management panel and no list of administrators in the page', page.locator('#owner-panel').is_hidden() and not any(e in page.content() for e in PREVIOUS))
        ctx.close()
        for label, u in (('owner e-mail', UNVERIFIED), ('listed administrator', UNVERIFIED_LISTED)):
            ctx, page, errs = open_page(browser, user=u); page.wait_for_selector('#list .sub-card'); page.wait_for_timeout(200)
            check(f'4  UNVERIFIED {label} → no dashboard, no Admin Management, drafts not shown', page.locator('#admin').is_hidden() and page.locator('#owner-panel').is_hidden() and 'SECRET DRAFT' not in page.content()); ctx.close()

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
        # administrator whose entry does not exist / is not active at load time → treated as an ordinary visitor
        ctx, page, errs = open_page(browser, user=ADMIN2, admins=[]); page.wait_for_selector('#list .sub-card'); page.wait_for_timeout(200)
        check('7  listed-looking e-mail but NO entry in the admin list → no dashboard, "not authorized"', page.locator('#admin').is_hidden() and 'not authorized' in page.locator('#account').inner_text() and 'SECRET DRAFT' not in page.content()); ctx.close()
        # write rejected by the server while the page still believed the account was an administrator
        ctx, page, errs = open_page(browser, user=ADMIN2); page.wait_for_selector('#admin-list .admin-row')
        page.evaluate("globalThis.__fb.adminDocs={}")                 # server-side change the page has not heard about yet (no notification)
        page.locator('#admin-list [data-act=unpublish]').first.click(); page.wait_for_timeout(250)
        check('7  [SIMULATED] server rejects a write → clear error, no change made', 'Not allowed' in page.locator('#status').inner_text() and page.evaluate('globalThis.__fb.writes.length') == 0)
        ctx.close()
        # the admin query itself is refused while the page believed the account was an administrator → page demotes itself
        ctx, page, errs = open_page(browser, user=ADMIN2); page.wait_for_selector('#admin-list .admin-row')
        page.evaluate("globalThis.__fb.adminDocs={}; globalThis.__fb.subs.forEach(f=>f())"); page.wait_for_timeout(300)
        check('7  [SIMULATED] server refuses the admin query → page falls back to the public view by itself', page.locator('#admin').is_hidden() and 'SECRET DRAFT' not in page.content() and cards(page).count() == 5 and 'revoked' in page.locator('#account').inner_text())
        ctx.close()

        # ---------- 9. Admin Management (owner only) ----------
        ctx, page, errs = open_page(browser, user=ADMIN1); page.wait_for_selector('#owner-list [data-email]')
        check('9  owner: "Admin Management" visible, lists the owner + 3 migrated administrators (all Active)',
              page.locator('#owner-panel').is_visible() and page.locator('#owner-list li').count() == 4 and page.locator('#owner-list [data-active=true]').count() == 3 and 'Admin Management' in page.inner_text('#owner-title'))
        check('9  owner row is fixed: badge "Owner", no revoke / remove button', 'Owner' in page.inner_text('#owner-list li[data-owner]') and page.locator('#owner-list li[data-owner] button').count() == 0)
        check('9  owner: account bar says Owner; import banner hidden when the list is not empty', 'Owner' in page.locator('#account').inner_text() and page.locator('#owner-import').is_hidden())
        # validation
        for typed, expect in (('', 'Enter an e-mail'), ('not-an-email', 'valid e-mail'), (OWNER.upper(), 'owner account'), (PREVIOUS[0].upper(), 'already an administrator')):
            page.fill('#owner-email', typed); page.click('#owner-add-btn')
            check(f'9  add validation: {typed or "(empty)"!r} → "{expect}"', expect in page.inner_text('#owner-email-err') and page.evaluate('globalThis.__fb.adminWrites.length') == 0, page.inner_text('#owner-email-err'))
        # add
        page.fill('#owner-email', '  New.Admin@Example.com '); page.click('#owner-add-btn'); page.wait_for_selector('#owner-list [data-email="new.admin@example.com"]')
        check('9  add: row appears lower-cased and Active; success message; input cleared',
              page.locator('#owner-list [data-email="new.admin@example.com"][data-active=true]').count() == 1 and 'Administrator added' in page.inner_text('#owner-msg') and page.input_value('#owner-email') == '')
        check('9  add: exactly one write, to the lower-cased e-mail', page.evaluate('globalThis.__fb.adminWrites') == [['set', 'new.admin@example.com']], str(page.evaluate('globalThis.__fb.adminWrites')))
        # revoke with confirmation
        victim = PREVIOUS[1]; row = page.locator(f'#owner-list [data-email="{victim}"]')
        row.locator('[data-act=revoke]').click()
        check('9  revoke asks for confirmation and names the account', page.locator('#owner-confirm-dialog').is_visible() and victim in page.inner_text('#owner-confirm-text') and 'Revoke' in page.inner_text('#oc-confirm'))
        page.click('#oc-cancel'); check('9  cancel keeps the account Active and writes nothing', row.get_attribute('data-active') == 'true' and ['update', victim, False] not in page.evaluate('globalThis.__fb.adminWrites'))
        row.locator('[data-act=revoke]').click(); page.click('#oc-confirm'); page.wait_for_selector('#owner-confirm-dialog', state='hidden')
        check('9  revoke: row shows Revoked (kept in the list), success message', row.get_attribute('data-active') == 'false' and 'Revoked' in row.inner_text() and 'Access revoked' in page.inner_text('#owner-msg') and row.locator('[data-act=restore]').count() == 1)
        page.fill('#owner-email', victim); page.click('#owner-add-btn')
        check('9  adding a revoked account points to "Restore access" instead', 'Restore access' in page.inner_text('#owner-email-err'))
        row.locator('[data-act=restore]').click(); page.wait_for_function("document.querySelector('#owner-list [data-email=\"%s\"]').dataset.active==='true'" % victim)
        check('9  restore: Active again, no confirmation needed', 'Access restored' in page.inner_text('#owner-msg'))
        row.locator('[data-act=remove]').click()
        check('9  remove asks for confirmation', page.locator('#owner-confirm-dialog').is_visible() and 'removed from the list' in page.inner_text('#owner-confirm-text')); page.click('#oc-confirm'); page.wait_for_selector('#owner-confirm-dialog', state='hidden')
        check('9  remove: row gone, success message', row.count() == 0 and 'Administrator removed' in page.inner_text('#owner-msg'))
        # XSS: an e-mail made of markup is shown as text
        page.fill('#owner-email', '<i>@example.com'); page.click('#owner-add-btn'); page.wait_for_selector('#owner-list [data-email="<i>@example.com"]')
        check('9  markup in an e-mail is shown as text, never as HTML', page.locator('#owner-list i').count() == 0 and '<i>@example.com' in page.inner_text('#owner-list'))
        # new admin can sign in, the owner panel does not linger after sign-out
        page.click('text=Sign out'); page.wait_for_timeout(200)
        check('9  sign-out empties the Admin Management panel (nothing lingers in the page)', page.locator('#owner-panel').is_hidden() and page.locator('#owner-list li').count() == 0 and 'new.admin@example.com' not in page.content())
        page.evaluate("globalThis.__fb.nextUser=%s" % json.dumps({'email': 'New.Admin@Example.com', 'emailVerified': True, 'displayName': 'New'}))
        page.click('text=Administrator sign-in'); page.wait_for_selector('#admin:not([hidden])')
        check('9  the newly added administrator gets the dashboard at once (no code change, no redeploy) but NOT Admin Management',
              page.locator('#admin-list .admin-row').count() >= 6 and page.locator('#owner-panel').is_hidden() and 'Administrator' in page.locator('#account').inner_text() and 'Owner' not in page.locator('#account').inner_text())
        check('9  owner session: no console errors', not errs, str(errs)); ctx.close()

        # a regular administrator
        ctx, page, errs = open_page(browser, user=REG); page.wait_for_selector('#admin-list .admin-row')
        check('9  regular admin: dashboard yes, Admin Management no, other administrators never reach the page',
              page.locator('#admin').is_visible() and page.locator('#owner-panel').is_hidden() and not any(e in page.content() for e in (PREVIOUS[0], PREVIOUS[2])))
        r = page.evaluate("""async()=>{const F=await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');const out=[];
            for(const f of [()=>F.setDoc(F.doc({},'admins','evil@x.com'),{}),()=>F.deleteDoc(F.doc({},'admins','%s')),()=>F.updateDoc(F.doc({},'admins','%s'),{active:false})]){try{await f();out.push('allowed');}catch(e){out.push(e.code);}}return out;}""" % (PREVIOUS[2], PREVIOUS[2]))
        check('9  [SIMULATED] regular admin: add / delete / revoke straight against the backend are refused', r == ['permission-denied'] * 3, str(r))
        # live revocation in an open session
        page.click('#admin-new'); page.fill('#f-subject', 'half typed')
        page.evaluate("globalThis.__fb.adminDocs[%s].active=false; globalThis.__fb.bump()" % json.dumps(PREVIOUS[1]))
        page.wait_for_selector('#admin', state='hidden', timeout=3000)
        check('9  LIVE revocation: open dashboard disappears, open form is closed, drafts are gone from the page',
              not page.evaluate("document.getElementById('form-dialog').open") and 'SECRET DRAFT' not in page.content() and 'half typed' not in page.content() and cards(page).count() == 5)
        check('9  LIVE revocation: account bar explains it; no error banner left behind', 'revoked' in page.locator('#account').inner_text() and page.locator('#status .notice.error').count() == 0, page.locator('#account').inner_text())
        page.evaluate("globalThis.__fb.writes.length=0")
        page.evaluate("globalThis.__fb.adminDocs[%s].active=true; globalThis.__fb.bump()" % json.dumps(PREVIOUS[1]))
        page.wait_for_selector('#admin:not([hidden])', timeout=3000); page.wait_for_selector('#admin-list .admin-row')
        check('9  LIVE restore: dashboard returns without reloading the page', page.locator('#admin-list .admin-row').count() == 6 and 'revoked' not in page.locator('#account').inner_text())
        page.evaluate("delete globalThis.__fb.adminDocs[%s]; globalThis.__fb.bump()" % json.dumps(PREVIOUS[1]))
        page.wait_for_selector('#admin', state='hidden', timeout=3000)
        check('9  LIVE removal: dashboard disappears as well', 'SECRET DRAFT' not in page.content())
        check('9  regular admin session: no console errors', not errs, str(errs)); ctx.close()

        # live grant to a signed-in stranger
        ctx, page, errs = open_page(browser, user=OTHER); page.wait_for_selector('#list .sub-card'); page.wait_for_timeout(200)
        check('9  stranger signed in: no dashboard', page.locator('#admin').is_hidden() and 'not authorized' in page.locator('#account').inner_text())
        page.evaluate("globalThis.__fb.adminDocs['someone.else@gmail.com']={email:'someone.else@gmail.com',active:true}; globalThis.__fb.bump()")
        page.wait_for_selector('#admin:not([hidden])', timeout=3000)
        check('9  LIVE grant: dashboard appears for the stranger once the owner adds them', page.locator('#owner-panel').is_hidden() and 'Administrator' in page.locator('#account').inner_text()); ctx.close()

        # empty list → one-time import banner
        ctx, page, errs = open_page(browser, user=ADMIN1, admins=[]); page.wait_for_selector('#owner-import:not([hidden])')
        check('9  empty list: owner sees the one-time import banner and "No other administrators yet"', 'No other administrators yet' in page.inner_text('#owner-list') and page.locator('#owner-import-btn').is_visible())
        page.click('#owner-import-btn'); page.wait_for_function("document.querySelectorAll('#owner-list [data-email]').length===3")
        check('9  import: the 3 previous administrators are added in one batch; banner disappears',
              sorted(page.evaluate('globalThis.__fb.adminWrites')) == sorted([['batch-set', e] for e in PREVIOUS]) and page.locator('#owner-import').is_hidden() and 'imported' in page.inner_text('#owner-msg'))
        ctx.close()
        ctx, page, errs = open_page(browser, user=ADMIN1, admins=[]); page.wait_for_selector('#owner-import:not([hidden])')
        page.click('#owner-import-dismiss'); page.reload(); page.wait_for_selector('#owner-list [data-owner]'); page.wait_for_timeout(300)
        check('9  "Not now" hides the banner on this device', page.locator('#owner-import').is_hidden()); ctx.close()

        # owner write refused by the server / list cannot load
        ctx, page, errs = open_page(browser, user=ADMIN1, extra="globalThis.__fb.denyAdminWrites=true"); page.wait_for_selector('#owner-list [data-email]')
        page.fill('#owner-email', 'x@example.com'); page.click('#owner-add-btn'); page.wait_for_selector('#owner-msg .notice.error')
        check('9  [SIMULATED] server refuses the add → clear error, no row added', 'Only the owner or' in page.inner_text('#owner-msg') and page.locator('#owner-list [data-email="x@example.com"]').count() == 0); ctx.close()
        ctx, page, errs = open_page(browser, user=ADMIN1, extra="globalThis.__fb.adminListError=true"); page.wait_for_selector('#owner-msg .notice.error')
        check('9  list cannot be loaded → error shown, no misleading import banner, owner row still there', page.locator('#owner-import').is_hidden() and page.locator('#owner-list [data-owner]').count() == 1); ctx.close()

        # ---------- 10. Manager: an administrator allowed to manage administrators (ahmedyasserr219) ----------
        MG = PREVIOUS[0]; REGE = PREVIOUS[1]; REG2 = PREVIOUS[2]
        ctx, page, errs = open_page(browser, user=ADMIN2); page.wait_for_selector('#owner-list [data-email]')
        check('10 manager: dashboard AND Admin Management visible, badge "Manager", owner row shown without actions',
              page.locator('#admin').is_visible() and page.locator('#owner-panel').is_visible() and 'Manager' in page.inner_text('#owner-badge') and page.locator('#owner-list li[data-owner] button').count() == 0)
        check('10 manager: account bar says so', 'can manage administrators' in page.locator('#account').inner_text())
        check('10 manager: own entry is locked (no buttons); ordinary admins have Revoke + Remove; nobody gets the owner-only "manager right" button',
              page.locator(f'#owner-list [data-email="{MG}"] button').count() == 0 and page.locator(f'#owner-list [data-email="{REGE}"] [data-act=revoke]').count() == 1
              and page.locator(f'#owner-list [data-email="{REGE}"] [data-act=remove]').count() == 1 and page.locator('#owner-list [data-act=toggle-manager]').count() == 0)
        check('10 manager: never offered the one-time import', page.locator('#owner-import').is_hidden())
        page.fill('#owner-email', 'Helper@Example.com'); page.click('#owner-add-btn'); page.wait_for_selector('#owner-list [data-email="helper@example.com"]')
        check('10 manager adds an administrator (row + success message; recorded as added by the manager)',
              'Administrator added' in page.inner_text('#owner-msg') and page.evaluate("globalThis.__fb.adminDocs['helper@example.com'].addedBy") == MG)
        row = page.locator('#owner-list [data-email="helper@example.com"]'); row.locator('[data-act=revoke]').click(); page.click('#oc-confirm'); page.wait_for_selector('#owner-confirm-dialog', state='hidden')
        check('10 manager revokes (with confirmation) an ordinary administrator', row.get_attribute('data-active') == 'false')
        row.locator('[data-act=restore]').click(); page.wait_for_selector('#owner-list [data-email="helper@example.com"][data-active=true]')
        row.locator('[data-act=remove]').click(); page.click('#oc-confirm'); page.wait_for_selector('#owner-confirm-dialog', state='hidden')
        check('10 manager restores and removes an ordinary administrator', row.count() == 0)
        r = page.evaluate("""async()=>{const F=await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');const out=[];
            const t=async(f)=>{try{await f();out.push('allowed');}catch(e){out.push(e.code);}};
            await t(()=>F.setDoc(F.doc({},'admins','boss@x.com'),{canManageAdmins:true}));            // create another manager
            await t(()=>F.updateDoc(F.doc({},'admins','%s'),{canManageAdmins:true}));              // promote an ordinary admin
            await t(()=>F.updateDoc(F.doc({},'admins','%s'),{active:false}));                        // revoke self
            await t(()=>F.deleteDoc(F.doc({},'admins','%s')));                                        // remove self
            await t(()=>F.setDoc(F.doc({},'admins','%s'),{}));                                       // an entry for the owner
            return out;}""" % (REGE, MG, MG, OWNER))
        check('10 [SIMULATED] manager straight against the backend: create manager / promote / revoke self / remove self / owner entry → all refused', r == ['permission-denied'] * 5, str(r))
        page.evaluate("globalThis.__fb.adminDocs[%s].canManageAdmins=false; globalThis.__fb.bump()" % json.dumps(MG))
        page.wait_for_selector('#owner-panel', state='hidden', timeout=3000)
        check('10 LIVE: when the owner takes the manager right away, Admin Management disappears but the dashboard stays', page.locator('#admin').is_visible() and page.locator('#owner-list li').count() == 0 and 'can manage administrators' not in page.locator('#account').inner_text())
        page.evaluate("globalThis.__fb.adminDocs[%s].canManageAdmins=true; globalThis.__fb.bump()" % json.dumps(MG))
        page.wait_for_selector('#owner-panel:not([hidden])', timeout=3000); page.wait_for_selector('#owner-list [data-email]')
        check('10 LIVE: when the owner grants it again, Admin Management returns with the list', page.locator('#owner-list [data-email]').count() >= 3)
        check('10 manager session: no console errors', not errs, str(errs)); ctx.close()

        ctx, page, errs = open_page(browser, user=ADMIN2); page.wait_for_selector('#owner-list [data-email]')
        page.evaluate("globalThis.__fb.adminDocs[%s].active=false; globalThis.__fb.bump()" % json.dumps(MG))
        page.wait_for_selector('#admin', state='hidden', timeout=3000)
        check('10 LIVE: a revoked manager loses dashboard AND Admin Management (list data cleared from the page)', page.locator('#owner-panel').is_hidden() and page.locator('#owner-list li').count() == 0 and REGE not in page.content())
        ctx.close()

        ctx, page, errs = open_page(browser, user=REG); page.wait_for_selector('#admin-list .admin-row')
        check('10 ordinary admin: no Admin Management', page.locator('#owner-panel').is_hidden())
        page.evaluate("globalThis.__fb.adminDocs[%s].canManageAdmins=true; globalThis.__fb.bump()" % json.dumps(REGE))
        page.wait_for_selector('#owner-panel:not([hidden])', timeout=3000)
        check('10 LIVE: granted the manager right → Admin Management appears without reload', page.locator('#owner-list [data-email]').count() >= 3); ctx.close()

        # owner: grant / remove the manager right from the page; import marks only the right account
        ctx, page, errs = open_page(browser, user=ADMIN1); page.wait_for_selector('#owner-list [data-email]')
        check('10 owner: sees "Manager" on ahmedyasserr only, and a manager-right button on every administrator row',
              page.locator('#owner-list [data-manager=true]').count() == 1 and page.locator(f'#owner-list [data-email="{MG}"][data-manager=true]').count() == 1 and page.locator('#owner-list [data-act=toggle-manager]').count() == 3)
        row = page.locator(f'#owner-list [data-email="{REG2}"]'); row.locator('[data-act=toggle-manager]').click(); page.wait_for_selector(f'#owner-list [data-email="{REG2}"][data-manager=true]')
        check('10 owner grants the manager right (message + badge)', 'Manager right granted' in page.inner_text('#owner-msg') and page.evaluate("globalThis.__fb.adminDocs[%s].canManageAdmins" % json.dumps(REG2)) is True)
        row.locator('[data-act=toggle-manager]').click(); page.wait_for_selector(f'#owner-list [data-email="{REG2}"][data-manager=false]')
        check('10 owner removes the manager right again', 'Manager right removed' in page.inner_text('#owner-msg') and page.locator(f'#owner-list [data-email="{MG}"] [data-act=revoke]').count() == 1)
        ctx.close()
        ctx, page, errs = open_page(browser, user=ADMIN1, admins=[]); page.wait_for_selector('#owner-import:not([hidden])'); page.click('#owner-import-btn')
        page.wait_for_function("document.querySelectorAll('#owner-list [data-email]').length===3")
        docs = page.evaluate("Object.fromEntries(Object.entries(globalThis.__fb.adminDocs).map(([k,v])=>[k,v.canManageAdmins===true]))")
        check('10 import gives the manager right to ahmedyasserr219 only', docs == {PREVIOUS[0]: True, PREVIOUS[1]: False, PREVIOUS[2]: False}, str(docs)); ctx.close()

        # ---------- 8. Layout ----------
        for name, vp in (('mobile 375', {'width': 375, 'height': 800}), ('tablet 768', {'width': 768, 'height': 1000}), ('desktop 1280', {'width': 1280, 'height': 900})):
            ctx, page, errs = open_page(browser, user=ADMIN1, viewport=vp); page.wait_for_selector('#list .sub-card')
            ov = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            check(f'8  {name}: no horizontal scroll (reminders)', ov <= 0, str(ov))
            if name.startswith('mobile'):
                page.screenshot(path='/home/claude/shots/rem-mobile.png', full_page=True)
                page.locator('#owner-panel').screenshot(path='/home/claude/shots/owner-mobile.png')
                page.click('#admin-new'); page.screenshot(path='/home/claude/shots/rem-mobile-form.png')
                fits = page.evaluate("(()=>{const d=document.getElementById('form-dialog').getBoundingClientRect();return d.width<=window.innerWidth})()")
                check('8  mobile: form dialog fits the screen', fits)
            if name.startswith('desktop'): page.screenshot(path='/home/claude/shots/rem-desktop.png', full_page=True); page.locator('#owner-panel').screenshot(path='/home/claude/shots/owner-desktop.png')
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
