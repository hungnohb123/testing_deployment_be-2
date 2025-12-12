# Danh sách package cần cài cho Backend

Chạy các lệnh sau trong thư mục BE để cài đặt đầy đủ các package cần thiết:

```
npm install express cors bcryptjs jsonwebtoken dayjs express-rate-limit @vercel/kv
```

## Ý nghĩa các package:
- **express**: Framework backend chính
- **cors**: Hỗ trợ CORS cho API
- **bcryptjs**: Mã hóa mật khẩu
- **jsonwebtoken**: Xác thực JWT
- **dayjs**: Xử lý ngày giờ
- **express-rate-limit**: Giới hạn số lần request (rate limiting)
- **@vercel/kv**: Kết nối Vercel KV/Upstash Redis

---
Bạn chỉ cần chạy 1 lệnh trên là đủ để cài toàn bộ dependencies cho backend.