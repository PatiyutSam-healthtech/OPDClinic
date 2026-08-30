# OPDClinic — เชื่อม GAS Backend เข้ากับ index.html (external frontend)

โครงสร้างใหม่: `index.html` ใน repo นี้เป็น front-end แยกจาก Apps Script,
ยิง `fetch()` ไปหา GAS Web App (`gas/Code.gs`) แทน `google.script.run`

**สำคัญ: ขั้นตอนด้านล่างนี้ออกแบบมาให้ไม่กระทบระบบ/ข้อมูลที่ใช้งานอยู่จริงเลย**
เพราะสร้าง deployment ใหม่แยกต่างหาก โดยไม่แตะ deployment เดิมที่หน้าคลินิกใช้อยู่

## 1. สำรองข้อมูลก่อน (safety net)
เปิด Google Sheet ที่เป็นฐานข้อมูลคลินิก → `File > Make a copy` เก็บไว้เฉยๆ

## 2. เพิ่มโค้ดใน Apps Script project จริง
เปิดโปรเจกต์ Apps Script เดิม (ตัวที่ผูกกับ Sheet คลินิก) แล้วนำเนื้อหาจาก
`gas/Code.gs` ในนี้ไป **แทนที่/รวม** เข้ากับ `Code.gs` เดิมของคุณ
(ฟังก์ชันเดิมทุกตัว logic เหมือนเดิม 100% มีแค่เพิ่ม `LockService` ในฟังก์ชันเขียนข้อมูล
และเพิ่ม `doPost`, `handleApi`, `jsonOut` ใหม่ ส่วน `doGet` ปรับให้ตรวจ `action`
พารามิเตอร์ก่อน ถ้าไม่มีจะ serve หน้า HTML เดิมเหมือนเดิมทุกประการ)

## 3. ตั้งค่า API Token
`Project Settings` (ไอคอนเฟือง) > `Script Properties` > `Add script property`
- Property: `API_TOKEN`
- Value: สุ่มสตริงยาวๆ เก็บเป็นความลับ (เช่นจาก password generator)

## 4. ทดสอบก่อนด้วย Test Deployment (ไม่กระทบ production)
`Deploy > Test deployments` จะได้ URL แบบ `.../dev` — ใช้ URL นี้ทดสอบก่อน
ใส่ใน `index.html` ชั่วคราว (ตัวแปร `API_URL`, `API_TOKEN`) แล้วลองใช้งานทุกแท็บให้ครบ
ขั้นตอนนี้**ไม่กระทบ URL ที่หน้าคลินิกใช้งานอยู่จริงเลย**

## 5. เมื่อพร้อมแล้ว สร้าง Deployment ใหม่แยกต่างหาก
`Deploy > New deployment`:
- Type: **Web app**
- Execute as: **Me**
- Who has access: **Anyone**

⚠️ อย่าไปแก้ deployment เดิม (ที่มี URL ที่หน้าคลินิกใช้งานอยู่) — สร้างเป็น
deployment ใหม่ต่างหาก จะได้ URL ใหม่คนละอันสำหรับ API โดยเฉพาะ
deployment เดิมจะยังคงทำงานเหมือนเดิมทุกประการ ไม่เปลี่ยนแปลง

จะได้ URL รูปแบบ `https://script.google.com/macros/s/XXXXXXXXXXXX/exec`

## 6. ใส่ค่าจริงใน index.html
แก้ 2 บรรทัดนี้ในไฟล์ `index.html` (อยู่ต้น `<script>` ท้ายไฟล์):

```js
const API_URL   = 'https://script.google.com/macros/s/XXXXXXXXXXXX/exec';
const API_TOKEN = 'ค่าเดียวกับที่ตั้งใน Script Properties';
```

## 7. Host index.html
เช่น GitHub Pages ของ repo นี้ หรือ static hosting อื่น

## หมายเหตุด้านความปลอดภัย
- `API_TOKEN` ฝั่ง client จะมองเห็นได้ผ่าน view-source เสมอ (เพราะเป็น static site)
  ป้องกันได้แค่ระดับ "กันคนทั่วไปสุ่มยิง" ไม่ใช่ระดับ enterprise auth
- ข้อมูลที่ระบบเก็บเป็นข้อมูลสุขภาพส่วนบุคคล (PDPA) — อย่าเปิด Web App แบบไม่มี token
  เด็ดขาด

---

## 8. อัปเดต: เพิ่มระบบ Login (Username/Password)

โค้ดเวอร์ชันล่าสุดใน `gas/Code.gs` เพิ่มระบบ login เข้ามา — สร้าง sheet ใหม่ 2 ตัว
แบบ additive เท่านั้น (`Users`, `Sessions`) ไม่แตะ sheet เดิมเลย แต่มีผลกับ **API
เท่านั้น** (ทุก action ยกเว้น `login` ตอนนี้ต้องมี session token ที่ได้จากการ login
มาด้วย) — **ไม่กระทบ URL เดิม/deployment เดิมที่หน้าคลินิกใช้เปิดผ่าน GAS โดยตรง**
เพราะ path นั้นไม่ผ่าน `handleApi` เลย

⚠️ **นี่คือการเปลี่ยนแปลงที่ต้องอัป Code.gs + index.html พร้อมกัน** เพราะ
`index.html` เวอร์ชันใหม่จะยิง API พร้อม session token เสมอ ถ้า deploy โค้ดใหม่ฝั่ง
GAS แต่ index.html ฝั่ง GitHub Pages ยังเป็นเวอร์ชันเก่า (ยังไม่มีหน้า login) จะเรียก
API ไม่ได้ชั่วคราวจนกว่าจะอัปเดตให้ครบทั้งคู่

ขั้นตอน:

1. เอาโค้ด `gas/Code.gs` เวอร์ชันล่าสุดไปวางทับใน Apps Script project (เหมือนเดิม
   ตามที่เคยทำ)
2. ไปที่ `Deploy > Manage deployments` เลือก **deployment ของ API** (ตัวที่สร้าง
   แยกไว้ต่างหาก ไม่ใช่ตัวเดิม) กด แก้ไข (ไอคอนดินสอ) แล้วเลือก **Version: New
   version** เพื่อให้ deployment นี้รันโค้ดที่เพิ่ง paste ไป (ไม่ต้องแตะ deployment
   เดิมที่หน้าคลินิกใช้อยู่)
3. สร้างบัญชีผู้ใช้แรก: ใน Apps Script Editor เลือกฟังก์ชัน `_seedAdminUser` จาก
   dropdown ด้านบน (ก่อนกด Run ให้แก้ username/password/ชื่อที่แสดงในฟังก์ชันนี้ก่อน)
   แล้วกด **Run** ครั้งเดียว — จะสร้าง sheet `Users` อัตโนมัติพร้อมบัญชีแรกให้
   (ดูผลลัพธ์ได้ที่ Execution log) จะสร้างผู้ใช้เพิ่มทีหลังก็เรียก
   `createOrUpdateUser('username', 'password', 'ชื่อที่แสดง')` แบบเดียวกันได้เรื่อยๆ
4. เอา `index.html` เวอร์ชันล่าสุดไป deploy ทับที่ GitHub Pages (ตรวจว่า `API_URL`/
   `API_TOKEN` ยังเป็นค่าจริงของคุณอยู่ เพราะเป็นไฟล์คนละตัวกับที่ให้ไปรอบแรก)
5. เปิดหน้าเว็บ จะเจอหน้า login ก่อนเข้าใช้งาน — ทดสอบด้วยบัญชีที่สร้างไว้ในข้อ 3

**หมายเหตุ:**
- รหัสผ่านเก็บเป็น SHA-256 hash ใน sheet `Users` ไม่เก็บ plaintext
- Session หมดอายุอัตโนมัติใน 12 ชั่วโมง (ปรับได้ที่ตัวแปร `SESSION_DURATION_MS`
  ใน `Code.gs`)
- บัญชีที่สร้างผ่าน `_seedAdminUser`/`createOrUpdateUser` (Apps Script Editor)
  จะได้สิทธิ์ **admin** โดย default

---

## 9. อัปเดต: หน้า "จัดการผู้ใช้" ในตัวเว็บ (เพิ่ม/แก้ไข/รีเซ็ตรหัสผ่านได้เอง)

โค้ดล่าสุดเพิ่มระบบสิทธิ์ 2 ระดับ: **admin** (จัดการผู้ใช้ได้) และ **staff**
(ใช้งานระบบปกติ ไม่เห็นเมนู "จัดการผู้ใช้") — เพิ่มคอลัมน์ `Role` ใน sheet `Users`
โค้ดจะ**เพิ่มคอลัมน์นี้ให้อัตโนมัติ**ตอนรันครั้งแรกหลังอัปเดต (migrate แบบ
additive ไม่กระทบข้อมูล user เดิม) และตั้งผู้ใช้เดิมทุกคนเป็น admin ไว้ก่อน
กันไม่ให้ล็อกตัวเองออกจากหน้าจัดการผู้ใช้

ขั้นตอนอัปเดต (เหมือนรอบก่อนหน้า):
1. เอา `gas/Code.gs` ล่าสุดไปวางทับใน Apps Script project
2. `Deploy > Manage deployments` → deployment ของ API → แก้ไข → **Version: New
   version**
3. เอา `index.html` ล่าสุดไป deploy ทับที่ GitHub Pages
4. Login ด้วยบัญชีเดิม จะเห็นเมนู **"จัดการผู้ใช้"** ในแถบด้านซ้าย (เฉพาะบัญชีที่
   เป็น admin) — ใช้หน้านี้เพิ่ม/แก้ไข/ปิดใช้งาน/รีเซ็ตรหัสผ่านผู้ใช้คนอื่นได้เลย
   ไม่ต้องเข้า Apps Script Editor อีกต่อไป

**กันเหตุการณ์ล็อกตัวเอง:** ระบบจะไม่ยอมให้ถอดสิทธิ์ admin หรือปิดใช้งานบัญชี
admin คนสุดท้ายของระบบ (จะขึ้น error แทน) เพื่อกันไม่ให้ไม่มีใครจัดการระบบได้เลย
