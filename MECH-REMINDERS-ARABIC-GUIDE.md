# دليل إعداد فايربيس النهائي لمشروع MechHub (Mech Reminders)

هذا الدليل مخصص لك خطوة بخطوة وبأبسط شكل ممكن دون الحاجة لأي خبرة برمجية.

---

## الحالة الحالية (ما تم إنجازه تلقائياً)
✔ تم تفعيل تسجيل الدخول عبر Google في مشروع `mechhub-reminders`.  
✔ تم إنشاء قاعدة بيانات Cloud Firestore الافتراضية `(default)`.  
✔ تم تسجيل النطاق المعتمد `ahmedramadantajeldin-rgb.github.io`.  
✔ تم ربط الكود بالكامل بـ Firebase v10.14.1 وتجهيز جميع الملفات.

---

## الخطوة الوحيدة المتبقية في Firebase Console (تستغرق دقيقة واحدة)

قاعدة البيانات تعمل حالياً بالقواعد الافتراضية التي تمنع القراءة والكتابة (`Missing or insufficient permissions`).  
لكي يتمكن الطلاب من رؤية المواعيد وتتمكن أنت وزميلك من إدارتها، يجب فقط نشر القواعد الأمنية المخصصة:

### خطوات نشر القواعد الأمنية (Security Rules):
1. افتح متصفحك واذهب إلى لوحة تحكم فايربيس:  
   <https://console.firebase.google.com/>
2. اختر مشروعك: **`mechhub-reminders`**.
3. من القائمة الجانبية في أقصى اليسار، اضغط على **Build** ثم اختر **Firestore Database**.
4. في أعلى الصفحة، اضغط على تبويب **Rules** (القواعد).
5. ستجد مربع نص به كود القواعد الافتراضية القديمة. **امسح كل ما بداخله بالكامل**.
6. انسخ الكود التالي بالكامل والصقه في المربع:

```javascript
rules_version = '2';

// Mech Reminders — Firestore security rules.
// These rules protect the data, not the web page. They are the FINAL authority on who may do what.
// Deploy via Firebase Console → Firestore Database → Rules → Publish  (or: firebase deploy --only firestore:rules).
//
// Who can do what
//   • OWNER  — one fixed Google account (ownerEmail() below). Always an administrator, and the only account that can
//              add, revoke, restore or remove other administrators. Not stored in the database, so nobody — not even
//              by editing documents — can remove or disable the owner.
//   • MANAGER — an ADMIN whose document also has  canManageAdmins == true  (granted by the owner only). A manager can add,
//              revoke, restore and remove ordinary admins, but can NOT touch the owner, other managers, or themselves,
//              and can never grant or take away the manager right.
//   • ADMIN  — a verified Google account whose document  admins/{e-mail}  exists with  active == true.
//              Admins manage Mech Reminders records but cannot read or change the admin list (except their own document).
//   • PUBLIC — anyone: may read published records only.
//
// The admin list lives in the "admins" collection, so adding / removing an administrator never requires editing
// this file or redeploying the website. Every request re-reads the admin document, so a revoked account loses
// write access on its very next request (no cached permission data: custom claims are deliberately NOT used).

service cloud.firestore {
  match /databases/{database}/documents {

    // ------------------------------------------------------------------ identity helpers

    // The single, fixed owner. Keep in sync with OWNER_EMAIL in reminders/core.js (UI hint only).
    function ownerEmail() {
      return 'ahmedramadantajeldin@gmail.com';
    }

    // Signed in with Firebase Authentication AND the e-mail address is verified by the identity provider.
    function isVerified() {
      return request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.email is string;
    }

    function myEmail() {
      return request.auth.token.email.lower();
    }

    function isOwner() {
      return isVerified() && myEmail() == ownerEmail();
    }

    function adminPath(email) {
      return /databases/$(database)/documents/admins/$(email);
    }

    // Listed in the central admin list and currently enabled.
    function isListedAdmin() {
      return isVerified()
        && exists(adminPath(myEmail()))
        && get(adminPath(myEmail())).data.active == true;
    }

    function isAdmin() {
      return isOwner() || isListedAdmin();
    }

    // An active administrator that the owner has marked as allowed to manage the list.
    function isManager() {
      return isListedAdmin()
        && get(adminPath(myEmail())).data.get('canManageAdmins', false) == true;
    }

    function canManageAdmins() {
      return isOwner() || isManager();
    }

    // ------------------------------------------------------------------ admin list: admins/{e-mail}
    //
    // Document id = the administrator's e-mail address in lower case. Fields:
    //   email (== id), active (bool), addedBy (who added it), createdAt, updatedAt,
    //   optional canManageAdmins (bool, owner-only), and — only while active == false — revokedAt, revokedBy.

    function validEmail(e) {
      return e is string
        && e.size() >= 5
        && e.size() <= 254
        && e == e.lower()
        && e.matches('^[^\\s@/]+@[^\\s@/]+\\.[^\\s@/]+$');
    }

    function validAdminDoc(adminId, d) {
      return d.keys().hasOnly(['email', 'active', 'addedBy', 'createdAt', 'updatedAt', 'revokedAt', 'revokedBy', 'canManageAdmins'])
        && d.keys().hasAll(['email', 'active', 'addedBy', 'createdAt', 'updatedAt'])
        && d.email == adminId
        && validEmail(d.email)
        && d.email != ownerEmail()                  // the owner is never an entry in the list
        && d.active is bool
        && d.addedBy is string
        && d.updatedAt == request.time
        && (!('canManageAdmins' in d) || d.canManageAdmins is bool)
        && (d.active == true
              ? (!('revokedAt' in d) && !('revokedBy' in d))
              : (d.revokedAt == request.time && d.revokedBy == myEmail()));
    }

    // May this request change the existing entry `r`? The owner may change any entry. A manager may change only ordinary
    // admins: not other managers, not themselves (the owner has no entry at all).
    function mayChangeEntry(adminId, r) {
      return isOwner()
        || (isManager()
            && adminId != myEmail()
            && r.get('canManageAdmins', false) == false);
    }

    match /admins/{adminId} {

      // Owner and managers read the whole list. Everyone else can read ONLY their own document
      // (the website uses this to notice immediately when access is granted or revoked).
      allow get: if canManageAdmins()
        || (isVerified() && adminId == myEmail());
      allow list: if canManageAdmins();

      // Owner or manager can add administrators. Only the owner can make someone a manager.
      allow create: if canManageAdmins()
        && validAdminDoc(adminId, request.resource.data)
        && request.resource.data.active == true
        && request.resource.data.createdAt == request.time
        && request.resource.data.addedBy == myEmail()      // the audit field names the person who really added it
        && (isOwner() || request.resource.data.get('canManageAdmins', false) == false);

      // Owner or manager can revoke / restore. E-mail, creation time and "added by" can never change, and only the
      // owner can add or remove the manager right.
      allow update: if canManageAdmins()
        && mayChangeEntry(adminId, resource.data)
        && validAdminDoc(adminId, request.resource.data)
        && request.resource.data.createdAt == resource.data.createdAt
        && request.resource.data.addedBy == resource.data.addedBy
        && (isOwner()
            || request.resource.data.get('canManageAdmins', false) == resource.data.get('canManageAdmins', false));

      // Owner or manager can remove an administrator document. The owner has none, so the owner cannot be removed.
      allow delete: if canManageAdmins()
        && adminId != ownerEmail()
        && mayChangeEntry(adminId, resource.data);
    }

    // ------------------------------------------------------------------ Mech Reminders records

    function validAttachment(a) {
      return a is map
        && a.keys().hasOnly(['title', 'url', 'description'])
        && a.keys().hasAll(['title', 'url'])
        && a.title is string
        && a.title.size() > 0
        && a.title.size() <= 120
        && a.url is string
        && a.url.size() <= 2000
        && a.url.matches('^https://[^\\s]+$')
        && (!('description' in a)
            || (a.description is string
                && a.description.size() <= 300));
    }

    // Validate up to 10 attachments.
    // Keep in sync with MAX_ATTACHMENTS in core.js.
    function validAttachments(l) {
      return l is list
        && l.size() <= 10
        && (l.size() < 1 || validAttachment(l[0]))
        && (l.size() < 2 || validAttachment(l[1]))
        && (l.size() < 3 || validAttachment(l[2]))
        && (l.size() < 4 || validAttachment(l[3]))
        && (l.size() < 5 || validAttachment(l[4]))
        && (l.size() < 6 || validAttachment(l[5]))
        && (l.size() < 7 || validAttachment(l[6]))
        && (l.size() < 8 || validAttachment(l[7]))
        && (l.size() < 9 || validAttachment(l[8]))
        && (l.size() < 10 || validAttachment(l[9]));
    }

    function validSubmission(d) {
      return d.keys().hasOnly([
          'subject',
          'type',
          'courseCode',
          'description',
          'deadline',
          'closesAt',
          'attachments',
          'published',
          'createdAt',
          'updatedAt'
        ])
        && d.keys().hasAll([
          'subject',
          'type',
          'deadline',
          'closesAt',
          'attachments',
          'published',
          'createdAt',
          'updatedAt'
        ])
        && d.subject is string
        && d.subject.size() > 0
        && d.subject.size() <= 120
        && d.type in [
          'Assignment',
          'Quiz',
          'Midterm',
          'M Assignment',
          'M Quiz',
          'M Midterm',
          'M Project'
        ]
        && (!('courseCode' in d)
            || (d.courseCode is string
                && d.courseCode.size() <= 40))
        && (!('description' in d)
            || (d.description is string
                && d.description.size() <= 1000))
        && d.deadline is timestamp
        && d.closesAt is timestamp
        && d.closesAt >= d.deadline
        && d.published is bool
        && validAttachments(d.attachments)
        && d.updatedAt == request.time;
    }

    match /submissions/{id} {

      // Anyone can read published records.
      // Admins can also read unpublished drafts.
      // Public queries must filter by published == true.
      // (Anonymous visitors short-circuit inside isAdmin(), so they never trigger the admin lookup.)
      allow get, list: if isAdmin()
        || resource.data.published == true;

      // Only admins can create valid records.
      allow create: if isAdmin()
        && validSubmission(request.resource.data)
        && request.resource.data.createdAt == request.time;

      // Only admins can update records.
      // The original creation timestamp cannot be changed.
      allow update: if isAdmin()
        && validSubmission(request.resource.data)
        && request.resource.data.createdAt
            == resource.data.createdAt;

      // Only admins can delete records.
      allow delete: if isAdmin();
    }

    // Deny all access to every other collection and document.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

7. اضغط على الزر الأزرق في الأعلى: **Publish** (نشر).
8. ستظهر لك رسالة خضراء صغيرة أسفل الزر تؤكد: **Rules published successfully**.

---

## كيف تتأكد أن كل شيء يعمل بنجاح؟

بمجرد الضغط على **Publish**:
1. افتح صفحة التذكيرات: `https://ahmedramadantajeldin-rgb.github.io/MechLibrary/reminders/` (أو محلياً).
2. ستجد الصفحة تحمّل وتظهر رسالة: **"No deadlines have been published yet"** (لم تعد هناك رسالة خطأ أو صلاحيات).
3. اضغط على زر **Administrator sign-in** في الأعلى.
4. سجّل الدخول بحساب المالك: `ahmedramadantajeldin@gmail.com` (أو بأي أدمن مضاف في قسم **Admin Management**).
5. ستفتح لك لوحة التحكم **Manage submissions**.
6. اضغط على **+ New submission**، أضف تكليفاً تجريبياً، واضغط **Save** كمسودة (Draft).
7. ستلاحظ أن المسودة تظهر لك فقط في لوحة التحكم، ولا تظهر للطلاب في الأعلى.
8. اضغط **Publish** ثم أكد النشر، ستظهر فوراً في قائمة الطلاب الرئيسية.
9. اضغط **Sign out**، ستختفي لوحة التحكم والمسودات فوراً ويبقى الموعد المنشور ظاهراً للجميع.


---

## إدارة الأدمنز (Admin Management) — جديد

قائمة الأدمنز لم تعد مكتوبة في الكود ولا في القواعد. هي محفوظة في Firestore داخل مجموعة `admins` (مستند لكل إيميل).

**من يقدر يدير القائمة؟**
| الحساب | الصلاحية |
|---|---|
| **المالك** `ahmedramadantajeldin@gmail.com` | يضيف ويسحب ويعيد ويحذف أي أدمن، ويمنح أو يسحب صلاحية "إدارة الأدمنز". ثابت داخل القواعد ولا يمكن لأي حساب حذفه أو تعطيله. |
| **مدير أدمنز (Manager)** — أحمد ياسر `ahmedyasserr219@gmail.com` | يضيف أدمنز جدد، ويسحب ويعيد ويحذف الأدمنز العاديين. **لا** يستطيع لمس المالك ولا مديرًا آخر ولا نفسه، ولا يستطيع منح هذه الصلاحية لأحد. |
| أدمن عادي | يدير التذكيرات فقط. لا يرى قسم Admin Management. |

**أول مرة بعد نشر القواعد (خطوة واحدة):**
1. سجّل الدخول بحساب المالك. سيظهر قسم **Admin Management**.
2. القائمة فارغة في البداية، فسيظهر إطار **Import previous administrators**. اضغط الزر ليُضاف الثلاثة السابقون (`ahmedyasserr219` و`mohamed.ibrahim200600` و`ahmedtageldien83`) دفعة واحدة، ويحصل أحمد ياسر تلقائيًا على صلاحية الإدارة.
   - إلى أن تضغط الزر يعمل المالك فقط (القائمة فارغة).

**بعد ذلك:**
- **إضافة أدمن:** اكتب الإيميل واضغط **Add admin**. يعمل فورًا بدون تعديل ملفات أو نشر.
- **سحب الصلاحيات:** **Revoke access** (مع تأكيد). يبقى الحساب في القائمة بحالة Revoked ويمكن إعادته بـ **Restore access**.
- **الحذف:** **Remove** (مع تأكيد).
- **منح/سحب صلاحية الإدارة (للمالك فقط):** زر **Allow managing admins** / **Remove manager right** بجانب كل أدمن.
- سحب صلاحيات مدير يوقف قدرته على الإدارة وعلى كتابة التذكيرات فورًا، وتختفي لوحته من صفحته المفتوحة خلال ثوانٍ.
- اكتب الإيميل كما هو بالضبط في حساب Google.
