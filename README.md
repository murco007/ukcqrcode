# 碗粿張 QR 點餐

GitHub Pages 前台與 Supabase Ordering Edge Function 點餐系統。

- 顧客：掃描桌牌 QR Code、瀏覽分類菜單、送出訂單、備註與點餐查詢。
- 門市：前台結帳、廚房出餐、每日營收、菜單管理、桌牌 QR Code、電話／網路預購、員工管理與列印。
- 前台網址： https://murco007.github.io/ukcqrcode/
- 官方粉絲專頁： https://www.facebook.com/profile.php?id=61551696695325
- Google Maps 位置：24.1651821, 120.6940609（台中市北屯區昌平店）。

## 設定

1. Supabase 專案 `ukcqrcode` 已套用資料庫 schema 與店主登入帳號。
2. `cloud.js` 只包含 Supabase publishable key；不可將 service role key 或資料庫密碼放入前端。
3. `supabase/functions/ordering/` 為訂單後端；GitHub Pages 由 `.github/workflows/pages.yml` 發佈。
4. 菜單內容及價格是初始化範例，預設暫未上架；店主登入後請先至「餐點管理」核對與調整。
5. 專案管理入口：`?page=/login`，帳號 `murco007`。初始 PIN 請以建立通知為準。
