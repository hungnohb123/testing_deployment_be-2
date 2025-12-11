# Hướng dẫn triển khai Backend lên Vercel (Serverless)

Hướng dẫn này giúp bạn deploy backend Express.js lên Vercel sử dụng Serverless Functions.

## 1. Yêu cầu chuẩn bị

- Đã cài Node.js và npm
- Đã cài Vercel CLI (`npm i -g vercel`)
- Có tài khoản Vercel

## 2. Cấu trúc dự án

Thư mục backend nên có dạng:

```
BE/
  app.js
  package.json
  vercel.json
  ...
```

## 3. Cấu hình Vercel

Tạo file `vercel.json` (đã có sẵn):

```json
{
  "version": 2,
  "builds": [{ "src": "app.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "app.js" }]
}
```

- Cấu hình này giúp Vercel nhận diện `app.js` là entry point cho serverless function.

## 4. Biến môi trường

- Lưu các biến bí mật (ví dụ JWT_SECRET) trên dashboard Vercel hoặc file `.env.local` (không commit lên git).
- Ví dụ `.env.local`:
  ```env
  JWT_SECRET=your_jwt_secret_key
  ```

## 5. Cài đặt dependencies

Chạy trong thư mục BE:

```
npm install
```

## 6. Kiểm thử local

Có thể kiểm thử bằng lệnh:

```
vercel dev
```

- Lệnh này mô phỏng môi trường serverless của Vercel trên máy bạn.

## 7. Deploy lên Vercel

Chạy lệnh:

```
vercel
```

- Làm theo hướng dẫn để liên kết/tạo project.
- Chọn thư mục BE làm root.

## 8. Sau khi deploy

- Vercel sẽ cung cấp một URL (ví dụ: `https://your-backend.vercel.app`).
- Tất cả các route Express sẽ hoạt động tại URL này.

## 9. Lưu ý

- Serverless function có thể bị cold start và giới hạn thời gian thực thi.
- Luôn dùng biến môi trường cho thông tin bí mật.
- Database nên dùng Vercel KV/Upstash Redis như đã cấu hình trong code.

## 10. Xử lý sự cố

- Kiểm tra dashboard Vercel để xem log build và lỗi.
- Đảm bảo mọi dependencies đều có trong `package.json`.
- Đảm bảo file entry trùng với cấu hình trong `vercel.json`.

---

Tham khảo thêm: https://vercel.com/docs/concepts/functions/serverless-functions
