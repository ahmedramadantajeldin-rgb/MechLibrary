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

service cloud.firestore {
  match /databases/{database}/documents {

    // المديران المصرح لهما فقط بحسابات Google مؤكدة ومحمية
    function isAdmin() {
      return request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.email.lower() in [
          'ahmedramadantajeldin@gmail.com',
          'ahmedyasserr219@gmail.com'
        ];
    }

    function validAttachment(a) {
      return a is map
        && a.keys().hasOnly(['title', 'url', 'description'])
        && a.keys().hasAll(['title', 'url'])
        && a.title is string && a.title.size() > 0 && a.title.size() <= 120
        && a.url is string && a.url.size() <= 2000 && a.url.matches('^https://[^\\s]+$')
        && (!('description' in a) || (a.description is string && a.description.size() <= 300));
    }

    function validAttachments(l) {
      return l is list && l.size() <= 10
        && (l.size() < 1  || validAttachment(l[0]))
        && (l.size() < 2  || validAttachment(l[1]))
        && (l.size() < 3  || validAttachment(l[2]))
        && (l.size() < 4  || validAttachment(l[3]))
        && (l.size() < 5  || validAttachment(l[4]))
        && (l.size() < 6  || validAttachment(l[5]))
        && (l.size() < 7  || validAttachment(l[6]))
        && (l.size() < 8  || validAttachment(l[7]))
        && (l.size() < 9  || validAttachment(l[8]))
        && (l.size() < 10 || validAttachment(l[9]));
    }

    function validSubmission(d) {
      return d.keys().hasOnly(['subject', 'type', 'courseCode', 'description', 'deadline', 'closesAt',
                               'attachments', 'published', 'createdAt', 'updatedAt'])
        && d.keys().hasAll(['subject', 'type', 'deadline', 'closesAt', 'attachments', 'published', 'createdAt', 'updatedAt'])
        && d.subject is string && d.subject.size() > 0 && d.subject.size() <= 120
        && d.type in ['Assignment', 'Quiz', 'Midterm', 'M Assignment', 'M Quiz', 'M Midterm', 'M Project']
        && (!('courseCode' in d) || (d.courseCode is string && d.courseCode.size() <= 40))
        && (!('description' in d) || (d.description is string && d.description.size() <= 1000))
        && d.deadline is timestamp && d.closesAt is timestamp && d.closesAt >= d.deadline
        && d.published is bool
        && validAttachments(d.attachments)
        && d.updatedAt == request.time;
    }

    match /submissions/{id} {
      // الزوار يرون فقط المواعيد المنشورة (published == true)
      // المسودات غير المنشورة محجوبة تماماً ولا يراها إلا المديران
      allow get, list: if isAdmin() || resource.data.published == true;

      allow create: if isAdmin()
        && validSubmission(request.resource.data)
        && request.resource.data.createdAt == request.time;

      allow update: if isAdmin()
        && validSubmission(request.resource.data)
        && request.resource.data.createdAt == resource.data.createdAt;

      allow delete: if isAdmin();
    }

    // إغلاق أي مسارات أو مجموعات أخرى بالكامل
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
4. سجّل الدخول بحسابك: `ahmedramadantajeldin@gmail.com` أو `ahmedyasserr219@gmail.com`.
5. ستفتح لك لوحة التحكم **Manage submissions**.
6. اضغط على **+ New submission**، أضف تكليفاً تجريبياً، واضغط **Save** كمسودة (Draft).
7. ستلاحظ أن المسودة تظهر لك فقط في لوحة التحكم، ولا تظهر للطلاب في الأعلى.
8. اضغط **Publish** ثم أكد النشر، ستظهر فوراً في قائمة الطلاب الرئيسية.
9. اضغط **Sign out**، ستختفي لوحة التحكم والمسودات فوراً ويبقى الموعد المنشور ظاهراً للجميع.
