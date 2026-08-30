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
  ป้องกันได้แค่ระดับ "กันคนทั่วไปสุ่มยิง" ไม่ใช่ระดับ enterprise auth — ถ้าข้อมูลคนไข้
  ละเอียดอ่อนมาก ควรพิจารณา backend ที่รองรับ auth จริงในระยะยาว
- ข้อมูลที่ระบบเก็บเป็นข้อมูลสุขภาพส่วนบุคคล (PDPA) — อย่าเปิด Web App แบบไม่มี token
  เด็ดขาด
