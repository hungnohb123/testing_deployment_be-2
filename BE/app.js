// app.js (hoặc index.js nếu bạn dùng tên này)
// Backend dùng Express nhưng chạy trên Vercel serverless
// Database: Vercel KV (Upstash Redis – NoSQL, key-value)

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);
const express = require("express");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const app = express();

app.set("trust proxy", 1); // Lấy IP người dùng thật thay vì IP Vercel

// ================== CORS ==================
const allowedOrigins = [
  "https://it-3180-2025-1-se-08.vercel.app",
  "https://testing-deployment-fe.vercel.app",
  "http://localhost:3000",
];

const corsOptions = {
  origin: allowedOrigins,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // Preflight cho mọi route
app.use(express.json());

// ================== RATE LIMITING ==================
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 6, // tối đa 6 lần
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Đăng nhập quá nhiều lần. Vui lòng thử lại sau 1 phút" }, // Trả về JSON gọn gàng
  skip: (req, res) => req.method === "OPTIONS",
});

const { kv } = require("@vercel/kv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
// ================== JWT CONFIG ==================
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";
const JWT_EXPIRES_IN = "7d"; // hoặc "1d"

// ================== HELPER: ID & KEY ==================

async function nextId(seqKey) {
  // Tạo id tự tăng (1,2,3,...) bằng KV
  const id = await kv.incr(seqKey);
  return id;
}

function residentKey(id) {
  return `residents:${id}`;
}

function paymentKey(id) {
  return `payments:${id}`;
}

function notificationKey(id) {
  return `notifications:${id}`;
}

// *** THÊM MỚI: helper cho services ***
function serviceKey(id) {
  return `services:${id}`;
}
// *** THÊM MỚI: helper cho forms ***
function formKey(id) {
  return `forms:${id}`;
}

// ================== ROOT & HEALTH ==================
app.get("/", (req, res) => {
  res.send("Hello Express + Vercel KV!");
});

app.get("/health", (req, res) => res.json({ ok: true }));

// ====================================================
// =============== RESIDENTS (US-001) =================
// ====================================================

// helper: cập nhật index login & chủ hộ theo căn hộ
async function updateResidentIndexes(oldUser, newUser) {
  // Login email
  if (oldUser?.email && oldUser.email !== newUser.email) {
    await kv.del(`login:email:${oldUser.email}`);
  }
  if (newUser.email) {
    await kv.set(`login:email:${newUser.email}`, newUser.id);
  }

  // Login phone
  if (oldUser?.phone && oldUser.phone !== newUser.phone) {
    await kv.del(`login:phone:${oldUser.phone}`);
  }
  if (newUser.phone) {
    await kv.set(`login:phone:${newUser.phone}`, newUser.id);
  }

  // Index chủ hộ theo căn hộ
  const oldIsOwner =
    oldUser &&
    oldUser.residency_status &&
    String(oldUser.residency_status).toLowerCase() === "chủ hộ";
  const newIsOwner =
    newUser &&
    newUser.residency_status &&
    String(newUser.residency_status).toLowerCase() === "chủ hộ";

  if (
    oldIsOwner &&
    (!newIsOwner || oldUser.apartment_id !== newUser.apartment_id)
  ) {
    await kv.del(`residents:ownerByApartment:${oldUser.apartment_id}`);
  }
  if (newIsOwner) {
    await kv.set(
      `residents:ownerByApartment:${newUser.apartment_id}`,
      newUser.id
    );
  }
}

// GET all users
app.get("/residents", async (req, res) => {
  try {
    const ids = await kv.zrange("residents:all", 0, -1);
    const residents = await Promise.all(
      ids.map((id) => kv.get(residentKey(id)))
    );
    res.json(residents.filter(Boolean));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single user
app.get("/residents/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const r = await kv.get(residentKey(id));
    if (!r) return res.status(404).json({ error: "User not found" });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create user
app.post("/residents", async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      phone,
      apartment_id,
      cccd,
      birth_date,
      role,
      residency_status,
      email,
      password,
    } = req.body || {};
    if (!first_name || !last_name || !phone || !apartment_id || !password) {
      return res.status(400).json({
        error:
          "Thiếu trường bắt buộc: first_name, last_name, phone, apartment_id, password",
      });
    }

    const id = await nextId("seq:resident");
    const full_name = `${first_name.trim()} ${last_name.trim()}`;
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const user = {
      id,
      full_name,
      first_name,
      last_name,
      phone,
      apartment_id,
      cccd: cccd || null,
      birth_date: birth_date || null,
      role: role || null,
      residency_status: residency_status || null,
      email: email || null,
      password: hashedPassword,
      state: "active",
    };

    await kv.set(residentKey(id), user);
    await kv.zadd("residents:all", { score: id, member: String(id) });
    await updateResidentIndexes(null, user);

    res.status(201).json({ message: "Thêm người dùng thành công", id: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update user
app.put("/residents/:id", async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "Thiếu id" });

  try {
    const existing = await kv.get(residentKey(id));
    if (!existing)
      return res.status(404).json({ error: "Không tìm thấy người dùng" });

    const {
      first_name,
      last_name,
      phone,
      apartment_id,
      state,
      cccd,
      birth_date,
      role,
      residency_status,
      email,
      password,
    } = req.body || {};

    const updated = { ...existing };

    if (first_name !== undefined && first_name !== null)
      updated.first_name = first_name;
    if (last_name !== undefined && last_name !== null)
      updated.last_name = last_name;

    if (
      (first_name !== undefined && first_name !== null) ||
      (last_name !== undefined && last_name !== null)
    ) {
      const f = first_name !== undefined ? first_name : existing.first_name;
      const l = last_name !== undefined ? last_name : existing.last_name;
      updated.full_name = `${(f || "").trim()} ${(l || "").trim()}`;
    }

    if (phone !== undefined && phone !== null) updated.phone = phone;
    if (apartment_id !== undefined && apartment_id !== null)
      updated.apartment_id = apartment_id;
    if (state !== undefined && state !== null) updated.state = state;
    if (cccd !== undefined && cccd !== null) updated.cccd = cccd;
    if (birth_date !== undefined && birth_date !== null)
      updated.birth_date = birth_date;
    if (role !== undefined && role !== null) updated.role = role;
    if (residency_status !== undefined && residency_status !== null)
      updated.residency_status = residency_status;
    if (email !== undefined && email !== null) updated.email = email;
    if (password !== undefined && password !== null) {
      const saltRounds = 10;
      updated.password = await bcrypt.hash(password, saltRounds);
    }

    await kv.set(residentKey(id), updated);
    await updateResidentIndexes(existing, updated);

    res.json({ message: "Cập nhật thành công" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE user (soft delete: state = 'inactive')
app.delete("/residents/:id", async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "Thiếu id" });

  try {
    const user = await kv.get(residentKey(id));
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy cư dân" });
    }

    const currentState = user.state;
    if (currentState && String(currentState).toLowerCase() === "inactive") {
      return res.json({
        message: "Resident đã ở trạng thái inactive (đã xóa mềm trước đó)",
      });
    }

    user.state = "inactive";
    await kv.set(residentKey(id), user);

    res.json({
      message: "Resident soft-deleted (state set to inactive)",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====================================================
// =================== PAYMENTS (US-008) ==============
// ====================================================

function decoratePayment(p) {
  if (!p) return p;
  return {
    ...p,
    is_paid: p.state === 1,
    status_text: p.state === 1 ? "Đã thanh toán" : "Chưa thanh toán",
  };
}

// GET mock fees
app.get("/fees", (req, res) => {
  res.json([
    { id: 1, description: "Phí quản lý tháng 10", amount: 300000 },
    { id: 2, description: "Phí gửi xe", amount: 100000 },
  ]);
});

// POST create payment (generate transaction_ref)
app.post("/payments", async (req, res) => {
  try {
    const { resident_id, amount, feetype, payment_form } = req.body || {};
    if (!resident_id || !amount) {
      return res.status(400).json({ error: "Thiếu resident_id hoặc amount" });
    }

    const id = await nextId("seq:payment");
    const transaction_ref = `TRX_${Date.now()}`;
    const nowIso = new Date().toISOString();

    const payment = {
      id,
      resident_id,
      amount,
      state: 0,
      transaction_ref,
      feetype: feetype || null,
      payment_date: null,
      payment_form: payment_form || null,
      provider_tx_id: null,
      payer_account: null,
      payer_name: null,
      verification_method: null,
      verified_at: null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    await kv.set(paymentKey(id), payment);
    await kv.zadd("payments:all", {
      score: Date.parse(nowIso),
      member: String(id),
    });
    await kv.zadd(`payments:resident:${resident_id}`, {
      score: Date.parse(nowIso),
      member: String(id),
    });
    await kv.set(`payments:txref:${transaction_ref}`, id);

    res.status(201).json({
      message: "Tạo giao dịch thành công",
      transaction_ref,
      payment_id: id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST payment callback (webhook mock)
app.post("/payments/callback", async (req, res) => {
  try {
    console.log("callback body:", req.body);

    const transaction_ref = String(req.body?.transaction_ref || "").trim();
    const statusRaw = String(req.body?.status || "").trim();
    const status = statusRaw.toLowerCase();

    const allowed = new Set(["success", "failed"]);
    if (!transaction_ref || !allowed.has(status)) {
      return res
        .status(400)
        .json({ error: "transaction_ref hoặc status không hợp lệ" });
    }

    const paymentId = await kv.get(`payments:txref:${transaction_ref}`);
    if (!paymentId) {
      return res.status(409).json({
        error: "Không tìm thấy transaction pending hoặc đã được xác nhận",
      });
    }
    const key = paymentKey(paymentId);
    const payment = await kv.get(key);
    if (!payment || payment.state !== 0) {
      return res.status(409).json({
        error:
          "Không cập nhật được: không tìm thấy transaction pending hoặc đã được xác nhận trước đó",
      });
    }

    const { provider_tx_id, payer_account, payer_name } = req.body;

    if (status === "success") {
      payment.state = 1;
      payment.provider_tx_id = provider_tx_id || payment.provider_tx_id;
      payment.payer_account = payer_account || payment.payer_account;
      payment.payer_name = payer_name || payment.payer_name;
      payment.verification_method = "webhook";
      payment.verified_at = new Date().toISOString();
      payment.updated_at = new Date().toISOString();

      await kv.set(key, payment);
      return res.json({
        message: "Cập nhật trạng thái giao dịch thành công",
      });
    } else {
      payment.provider_tx_id = provider_tx_id || payment.provider_tx_id;
      payment.payer_account = payer_account || payment.payer_account;
      payment.payer_name = payer_name || payment.payer_name;
      payment.verification_method = "webhook";
      payment.updated_at = new Date().toISOString();

      await kv.set(key, payment);
      return res.json({
        message: "Giao dịch đánh dấu failed/ignored (đã ghi provider info)",
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /payment-status?resident_id=...
app.get("/payment-status", async (req, res) => {
  const { resident_id } = req.query;
  if (!resident_id) return res.status(400).json({ error: "Thiếu resident_id" });

  try {
    const ids = await kv.zrange(`payments:residents:${resident_id}`, 0, -1, {
      rev: true,
    });

    const payments = await Promise.all(ids.map((id) => kv.get(paymentKey(id))));

    const mapped = payments.filter(Boolean).map(decoratePayment);
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all payments (with user name)
app.get("/payments", async (req, res) => {
  try {
    const ids = await kv.zrange("payments:all", 0, -1, { rev: true });
    const payments = await Promise.all(ids.map((id) => kv.get(paymentKey(id))));

    const mapped = [];
    for (const p of payments) {
      if (!p) continue;
      const r = await kv.get(residentKey(p.resident_id));
      const merged = decoratePayment({
        ...p,
        resident_name: r?.full_name || null,
        apartment_id: r?.apartment_id || null,
      });
      mapped.push(merged);
    }
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET payments by resident_id
app.get("/payments/by-resident/:resident_id", async (req, res) => {
  const { resident_id } = req.params;
  try {
    const ids = await kv.zrange(`payments:resident:${resident_id}`, 0, -1, {
      rev: true,
    });
    const payments = await Promise.all(ids.map((id) => kv.get(paymentKey(id))));
    const mapped = [];
    for (const p of payments) {
      if (!p) continue;
      const r = await kv.get(residentKey(p.resident_id));
      const merged = decoratePayment({
        ...p,
        resident_name: r?.full_name || null,
        apartment_id: r?.apartment_id || null,
      });
      mapped.push(merged);
    }
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET one payment by id
app.get("/payments/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const p = await kv.get(paymentKey(id));
    if (!p) return res.status(404).json({ error: "Payment not found" });
    const r = await kv.get(residentKey(p.resident_id));
    const merged = decoratePayment({
      ...p,
      resident_name: r?.full_name || null,
      apartment_id: r?.apartment_id || null,
    });
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH: cập nhật trạng thái thanh toán (state) cho payment
app.patch("/payments/:id", async (req, res) => {
  const { id } = req.params;
  const {
    state, // Dùng cho việc đổi trạng thái (0 hoặc 1)
    feetype, // Dùng cho AccountPayment
    amount, // Dùng cho AccountPayment
    payment_date, // Dùng cho AccountPayment
  } = req.body || {};

  try {
    const p = await kv.get(paymentKey(id));
    if (!p) return res.status(404).json({ error: "Không tìm thấy giao dịch" });

    // Use case 1: Cập nhật STATE (từ 0 -> 1 hoặc 1 -> 0)
    if (state !== undefined && (state === 0 || state === 1)) {
      p.state = state;

      if (state === 1) {
        const vnDate = dayjs().tz("Asia/Ho_Chi_Minh").format("YYYY-MM-DD");
        if (!p.payment_date) {
          p.payment_date = vnDate;
        }
      } else {
        p.payment_date = null;
      }
    }

    // Use case 2: Cập nhật chi tiết
    if (feetype !== undefined) p.feetype = feetype;
    if (amount !== undefined) p.amount = amount;
    if (payment_date !== undefined) p.payment_date = payment_date || null;

    p.updated_at = new Date().toISOString();

    await kv.set(paymentKey(id), p);
    res.json({ message: "Cập nhật giao dịch thành công" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE payment (xóa hẳn giao dịch)
app.delete("/payments/:id", async (req, res) => {
  const { id } = req.params;

  if (!id) return res.status(400).json({ error: "Thiếu id" });

  try {
    const p = await kv.get(paymentKey(id));
    if (!p) {
      return res.status(404).json({ error: "Không tìm thấy giao dịch để xóa" });
    }

    await kv.del(paymentKey(id));
    await kv.zrem("payments:all", String(id));
    await kv.zrem(`payments:residents:${p.resident_id}`, String(id));

    if (p.transaction_ref) {
      await kv.del(`payments:txref:${p.transaction_ref}`);
    }

    res.json({ message: "Đã xóa giao dịch thành công" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====================================================
// ================== NOTIFICATIONS ===================
// ====================================================

// GET all notifications (with owner_name)
app.get("/notifications", async (req, res) => {
  try {
    const ids = await kv.zrange("notifications:all", 0, -1, { rev: true });
    const notis = await Promise.all(
      ids.map((id) => kv.get(notificationKey(id)))
    );

    const results = [];
    for (const n of notis) {
      if (!n) continue;
      let owner_name = null;
      if (n.apartment_id) {
        const ownerId = await kv.get(
          `residents:ownerByApartment:${n.apartment_id}`
        );
        if (ownerId) {
          const owner = await kv.get(residentKey(ownerId));
          owner_name = owner?.full_name || null;
        }
      }
      results.push({ ...n, owner_name });
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create notification
app.post("/notifications", async (req, res) => {
  const { apartment_id, content } = req.body || {};
  if (!apartment_id || !content) {
    return res.status(400).json({ error: "Thiếu apartment_id hoặc content" });
  }
  try {
    const id = await nextId("seq:notification");
    const nowIso = new Date().toISOString();

    const noti = {
      id,
      apartment_id,
      content,
      notification_date: nowIso,
      sent_date: null,
    };

    await kv.set(notificationKey(id), noti);
    await kv.zadd("notifications:all", {
      score: Date.parse(nowIso),
      member: String(id),
    });

    res.status(201).json({ message: "Thông báo được tạo", id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH mark notification as sent
app.patch("/notifications/:id/send", async (req, res) => {
  const { id } = req.params;
  try {
    const noti = await kv.get(notificationKey(id));
    if (!noti) return res.status(404).json({ error: "Notification not found" });

    noti.sent_date = new Date().toISOString();
    await kv.set(notificationKey(id), noti);

    res.json({ message: "Notification marked as sent" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /notifications/:id — chỉnh sửa thông báo
app.put("/notifications/:id", async (req, res) => {
  const { id } = req.params;
  const { apartment_id, content, notification_date, sent_date } =
    req.body || {};

  if (!id) return res.status(400).json({ error: "Thiếu id thông báo" });

  try {
    const noti = await kv.get(notificationKey(id));
    if (!noti)
      return res
        .status(404)
        .json({ error: "Không tìm thấy thông báo để cập nhật" });

    const update = { ...noti };

    if (apartment_id !== undefined) {
      if (apartment_id.trim() === "") {
        return res.status(400).json({
          error: "Trường Người nhận (apartment_id) không được để trống.",
        });
      }
      update.apartment_id = apartment_id.trim();
    }

    if (content !== undefined) {
      if (content.trim() === "") {
        return res
          .status(400)
          .json({ error: "Trường Nội dung không được để trống." });
      }
      update.content = content.trim();
    }

    if (notification_date !== undefined) {
      update.notification_date = notification_date || null;
    }

    if (sent_date !== undefined) {
      update.sent_date = sent_date || null;
    }

    await kv.set(notificationKey(id), update);
    res.json({ message: "Cập nhật thông báo thành công" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE notification
app.delete("/notifications/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const noti = await kv.get(notificationKey(id));
    if (!noti) return res.status(404).json({ error: "Notification not found" });

    await kv.del(notificationKey(id));
    await kv.zrem("notifications:all", String(id));

    res.json({ message: "Notification deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====================================================
// ====================== LOGIN =======================
// ====================================================

app.post("/login", loginLimiter, async (req, res) => {
  const { username, password, role } = req.body || {};

  // 1. Validate Input (Nhanh nhất - không tốn I/O)
  if (!username || !password || !role) {
    return res.status(400).json({ error: "Thiếu thông tin đăng nhập" });
  }

  try {
    // 2. Tìm User (Tốn I/O - Bắt buộc)
    let id = await kv.get(`login:email:${username}`);
    if (!id) {
      id = await kv.get(`login:phone:${username}`);
    }

    if (!id) {
      return res.status(404).json({ error: "Tài khoản không tồn tại" });
    }

    const user = await kv.get(residentKey(id));
    if (!user) {
      return res.status(404).json({ error: "Dữ liệu người dùng lỗi" });
    }

    // 3. Check Status (Rất nhanh - CPU thấp)
    // Ưu tiên chặn tài khoản bị khóa để tiết kiệm tài nguyên
    const userState = String(user.state || "inactive").toLowerCase();
    if (userState !== "active") {
      return res.status(403).json({
        error: "Tài khoản chưa kích hoạt hoặc đã bị khóa",
      });
    }

    // 4. Check Role (Rất nhanh - CPU thấp)
    // Nếu sai Role, chặn luôn, không cần tốn công check pass
    if (user.role !== role) {
      return res.status(403).json({
        error: `Tài khoản này không có quyền truy cập với vai trò ${role}`,
      });
    }

    // 5. Check Password (CHẬM - CPU cao)
    // Chỉ thực hiện khi 4 bước trên đã qua. Đây là bước tốn tài nguyên nhất.
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: "Mật khẩu không chính xác" });
    }

    // 6. Tạo Token (Thành công)
    const safeUser = { ...user };
    delete safeUser.password;

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        full_name: user.full_name,
        apartment_id: user.apartment_id,
        email: user.email,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({ message: "Đăng nhập thành công", user: safeUser, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

// ====================================================
// ==================== SERVICES ======================
// ====================================================

// Enum theo đúng bảng services trong MySQL (design)
const SERVICE_TYPES = ["Dịch vụ trung cư", "Khiếu nại", "Khai báo tạm trú"];

const CONTENT_BY_TYPE = {
  "Dịch vụ trung cư": [
    "Làm thẻ xe",
    "Sửa chữa căn hộ",
    "Vận chuyển đồ",
    "Dọn dẹp căn hộ",
  ],
  "Khiếu nại": ["tài sản chung", "mất tài sản"],
  "Khai báo tạm trú": ["Khai báo thông tin"],
};

const HANDLER_BY_TYPE = {
  "Dịch vụ trung cư": "Ban quản trị",
  "Khiếu nại": "Công an",
  "Khai báo tạm trú": "Ban quản trị",
};

const SERVICE_STATUS = ["Đã ghi nhận", "Đã xử lý"];

const PROBLEMS = [
  "Phản hồi chậm",
  "Thiếu chuyên nghiệp",
  "Chi phí đắt",
  "Ko vấn đề",
];

const RATES = [
  "Chất lượng cao",
  "Chất lượng tốt",
  "Chất lượng ổn",
  "Chất lượng kém",
];

// -------- POST /services: tạo mới service --------
app.post("/services", async (req, res) => {
  const {
    apartment_id,
    service_type,
    content,
    note,
    problems,
    rates,
    scripts,
    servicestatus, // cho phép gửi lên, mặc định "Đã ghi nhận"
  } = req.body || {};

  try {
    // 1) Validate input bắt buộc
    if (!apartment_id || !service_type || !content) {
      return res.status(400).json({
        error: "Thiếu apartment_id, service_type hoặc content",
      });
    }

    // 2) Kiểm tra loại dịch vụ
    if (!SERVICE_TYPES.includes(service_type)) {
      return res.status(400).json({
        error:
          "service_type không hợp lệ. Chỉ nhận: 'Dịch vụ trung cư', 'Khiếu nại', 'Khai báo tạm trú'",
      });
    }

    // 3) Kiểm tra content hợp lệ với loại đó
    const allowedContents = CONTENT_BY_TYPE[service_type] || [];
    if (!allowedContents.includes(content)) {
      return res.status(400).json({
        error: `Content không hợp lệ cho loại '${service_type}'. Chỉ nhận: ${allowedContents.join(
          ", "
        )}`,
      });
    }

    // 4) servicestatus (nếu không gửi thì mặc định "Đã ghi nhận")
    const serviceStatusValue =
      servicestatus && SERVICE_STATUS.includes(servicestatus)
        ? servicestatus
        : "Đã ghi nhận";

    // 5) problems & rates theo enum
    const problemsValue = problems || "Ko vấn đề";
    if (!PROBLEMS.includes(problemsValue)) {
      return res.status(400).json({
        error: `problems không hợp lệ. Chỉ nhận: ${PROBLEMS.join(", ")}`,
      });
    }

    const ratesValue = rates || "Chất lượng ổn";
    if (!RATES.includes(ratesValue)) {
      return res.status(400).json({
        error: `rates không hợp lệ. Chỉ nhận: ${RATES.join(", ")}`,
      });
    }

    const ben_xu_ly = HANDLER_BY_TYPE[service_type];
    const nowIso = new Date().toISOString();
    const id = await nextId("seq:service");

    const service = {
      id, // tương ứng service_id trong bảng MySQL
      apartment_id,
      service_type,
      content,
      ben_xu_ly,
      servicestatus: serviceStatusValue,
      handle_date: nowIso, // trong MySQL default CURRENT_TIMESTAMP
      note: note || null,
      problems: problemsValue,
      rates: ratesValue,
      scripts: scripts || null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    // Lưu KV
    await kv.set(serviceKey(id), service);
    await kv.zadd("services:all", {
      score: Date.parse(nowIso),
      member: String(id),
    });
    await kv.zadd(`services:apartment:${apartment_id}`, {
      score: Date.parse(nowIso),
      member: String(id),
    });

    return res.status(201).json({
      message: "Tạo yêu cầu dịch vụ thành công",
      service_id: id,
    });
  } catch (err) {
    console.error("POST /services error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// -------- GET /services: tất cả services --------
app.get("/services", async (req, res) => {
  try {
    const ids = await kv.zrange("services:all", 0, -1, { rev: true });
    const services = await Promise.all(ids.map((id) => kv.get(serviceKey(id))));
    res.json(services.filter(Boolean));
  } catch (err) {
    console.error("GET /services error:", err);
    res.status(500).json({ error: err.message });
  }
});

// -------- GET /services/by-apartment/:apartment_id --------
app.get("/services/by-apartment/:apartment_id", async (req, res) => {
  const { apartment_id } = req.params;
  try {
    const ids = await kv.zrange(`services:apartment:${apartment_id}`, 0, -1, {
      rev: true,
    });
    const services = await Promise.all(ids.map((id) => kv.get(serviceKey(id))));
    res.json(services.filter(Boolean));
  } catch (err) {
    console.error("GET /services/by-apartment error:", err);
    res.status(500).json({ error: err.message });
  }
});

// -------- GET /services/:id --------
app.get("/services/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const service = await kv.get(serviceKey(id));
    if (!service) {
      return res.status(404).json({ error: "Không tìm thấy dịch vụ" });
    }
    res.json(service);
  } catch (err) {
    console.error("GET /services/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// -------- PATCH /services/:id --------
app.patch("/services/:id", async (req, res) => {
  const { id } = req.params;
  const {
    service_type,
    content,
    servicestatus,
    note,
    problems,
    rates,
    scripts,
  } = req.body || {};

  try {
    let service = await kv.get(serviceKey(id));
    if (!service) {
      return res.status(404).json({ error: "Không tìm thấy dịch vụ" });
    }

    // 1) Đổi loại dịch vụ / content
    if (service_type !== undefined || content !== undefined) {
      const newServiceType =
        service_type !== undefined ? service_type : service.service_type;
      const newContent = content !== undefined ? content : service.content;

      if (!SERVICE_TYPES.includes(newServiceType)) {
        return res.status(400).json({
          error:
            "service_type không hợp lệ. Chỉ nhận: 'Dịch vụ trung cư', 'Khiếu nại', 'Khai báo tạm trú'",
        });
      }

      const allowedContents = CONTENT_BY_TYPE[newServiceType] || [];
      if (!allowedContents.includes(newContent)) {
        return res.status(400).json({
          error: `Content không hợp lệ cho loại '${newServiceType}'. Chỉ nhận: ${allowedContents.join(
            ", "
          )}`,
        });
      }

      service.service_type = newServiceType;
      service.content = newContent;
      service.ben_xu_ly = HANDLER_BY_TYPE[newServiceType];
    }

    // 2) servicestatus
    if (servicestatus !== undefined) {
      if (!SERVICE_STATUS.includes(servicestatus)) {
        return res.status(400).json({
          error:
            "servicestatus không hợp lệ (chỉ nhận 'Đã ghi nhận' hoặc 'Đã xử lý')",
        });
      }
      service.servicestatus = servicestatus;

      // Nếu chuyển sang "Đã xử lý" thì cập nhật handle_date
      if (servicestatus === "Đã xử lý") {
        service.handle_date = new Date().toISOString();
      }
    }

    // 3) note
    if (note !== undefined) {
      service.note = note || null;
    }

    // 4) problems
    if (problems !== undefined) {
      if (!PROBLEMS.includes(problems)) {
        return res.status(400).json({
          error: `problems không hợp lệ. Chỉ nhận: ${PROBLEMS.join(", ")}`,
        });
      }
      service.problems = problems;
    }

    // 5) rates
    if (rates !== undefined) {
      if (!RATES.includes(rates)) {
        return res.status(400).json({
          error: `rates không hợp lệ. Chỉ nhận: ${RATES.join(", ")}`,
        });
      }
      service.rates = rates;
    }

    // 6) scripts (text tự do)
    if (scripts !== undefined) {
      service.scripts = scripts || null;
    }

    service.updated_at = new Date().toISOString();

    await kv.set(serviceKey(id), service);

    return res.json({ message: "Cập nhật dịch vụ thành công" });
  } catch (err) {
    console.error("PATCH /services/:id error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// -------- DELETE /services/:id --------
app.delete("/services/:id", async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "Thiếu id" });

  try {
    const service = await kv.get(serviceKey(id));
    if (!service) {
      return res.status(404).json({ error: "Không tìm thấy dịch vụ để xóa" });
    }

    await kv.del(serviceKey(id));
    await kv.zrem("services:all", String(id));
    await kv.zrem(`services:apartment:${service.apartment_id}`, String(id));

    res.json({ message: "Đã xóa dịch vụ thành công" });
  } catch (err) {
    console.error("DELETE /services/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ====================================================
// ====================== FORMS =======================
// ====================================================
//
// Forms: liên kết cư dân + dịch vụ
// KV structure:
//   form:<id>  => object form
//   forms:all  => zset tất cả forms (score = created_at)
//   forms:apartment:<apartment_id> => zset theo căn hộ
//   forms:service:<service_id>     => zset theo service

// -------- POST /forms: tạo mới form --------
app.post("/forms", async (req, res) => {
  const {
    full_name,
    apartment_id,
    cccd,
    dob,
    start_date,
    end_date,
    note,
    service_id,
  } = req.body || {};

  try {
    // bắt buộc: full_name, apartment_id
    if (!full_name || !apartment_id) {
      return res.status(400).json({
        error: "Thiếu full_name hoặc apartment_id",
      });
    }

    const id = await nextId("seq:form");
    const nowIso = new Date().toISOString();

    const form = {
      id, // tương ứng form_id trong bảng MySQL
      full_name,
      apartment_id,
      cccd: cccd || null,
      dob: dob || null, // lưu string ISO / Y-M-D, FE tự chuẩn hóa
      start_date: start_date || null,
      end_date: end_date || null,
      note: note || null,
      service_id: service_id || null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    await kv.set(formKey(id), form);
    await kv.zadd("forms:all", {
      score: Date.parse(nowIso),
      member: String(id),
    });
    await kv.zadd(`forms:apartment:${apartment_id}`, {
      score: Date.parse(nowIso),
      member: String(id),
    });
    if (service_id) {
      await kv.zadd(`forms:service:${service_id}`, {
        score: Date.parse(nowIso),
        member: String(id),
      });
    }

    return res.status(201).json({
      message: "Tạo form thành công",
      form_id: id,
    });
  } catch (err) {
    console.error("POST /forms error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// -------- GET /forms: tất cả forms --------
app.get("/forms", async (req, res) => {
  try {
    const ids = await kv.zrange("forms:all", 0, -1, { rev: true });
    const forms = await Promise.all(ids.map((id) => kv.get(formKey(id))));
    res.json(forms.filter(Boolean));
  } catch (err) {
    console.error("GET /forms error:", err);
    res.status(500).json({ error: err.message });
  }
});

// -------- GET /forms/:id: chi tiết 1 form --------
app.get("/forms/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const form = await kv.get(formKey(id));
    if (!form) {
      return res.status(404).json({ error: "Không tìm thấy form" });
    }
    res.json(form);
  } catch (err) {
    console.error("GET /forms/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// -------- GET /forms/by-apartment/:apartment_id --------
app.get("/forms/by-apartment/:apartment_id", async (req, res) => {
  const { apartment_id } = req.params;
  try {
    const ids = await kv.zrange(`forms:apartment:${apartment_id}`, 0, -1, {
      rev: true,
    });
    const forms = await Promise.all(ids.map((id) => kv.get(formKey(id))));
    res.json(forms.filter(Boolean));
  } catch (err) {
    console.error("GET /forms/by-apartment error:", err);
    res.status(500).json({ error: err.message });
  }
});

// -------- GET /forms/by-service/:service_id --------
app.get("/forms/by-service/:service_id", async (req, res) => {
  const { service_id } = req.params;
  try {
    const ids = await kv.zrange(`forms:service:${service_id}`, 0, -1, {
      rev: true,
    });
    const forms = await Promise.all(ids.map((id) => kv.get(formKey(id))));
    res.json(forms.filter(Boolean));
  } catch (err) {
    console.error("GET /forms/by-service error:", err);
    res.status(500).json({ error: err.message });
  }
});

// -------- PATCH /forms/:id: cập nhật form --------
app.patch("/forms/:id", async (req, res) => {
  const { id } = req.params;
  const {
    full_name,
    apartment_id,
    cccd,
    dob,
    start_date,
    end_date,
    note,
    service_id,
  } = req.body || {};

  try {
    let form = await kv.get(formKey(id));
    if (!form) {
      return res.status(404).json({ error: "Không tìm thấy form" });
    }

    const oldApartment = form.apartment_id;
    const oldServiceId = form.service_id;

    if (full_name !== undefined) form.full_name = full_name || "";
    if (apartment_id !== undefined) form.apartment_id = apartment_id || "";
    if (cccd !== undefined) form.cccd = cccd || null;
    if (dob !== undefined) form.dob = dob || null;
    if (start_date !== undefined) form.start_date = start_date || null;
    if (end_date !== undefined) form.end_date = end_date || null;
    if (note !== undefined) form.note = note || null;
    if (service_id !== undefined) form.service_id = service_id || null;

    form.updated_at = new Date().toISOString();

    await kv.set(formKey(id), form);

    // cập nhật lại index zset nếu đổi apartment hoặc service
    if (apartment_id !== undefined && apartment_id !== oldApartment) {
      await kv.zrem(`forms:apartment:${oldApartment}`, String(id));
      await kv.zadd(`forms:apartment:${form.apartment_id}`, {
        score: Date.parse(form.created_at || form.updated_at),
        member: String(id),
      });
    }

    if (service_id !== undefined && service_id !== oldServiceId) {
      if (oldServiceId) {
        await kv.zrem(`forms:service:${oldServiceId}`, String(id));
      }
      if (form.service_id) {
        await kv.zadd(`forms:service:${form.service_id}`, {
          score: Date.parse(form.created_at || form.updated_at),
          member: String(id),
        });
      }
    }

    return res.json({ message: "Cập nhật form thành công" });
  } catch (err) {
    console.error("PATCH /forms/:id error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// -------- DELETE /forms/:id --------
app.delete("/forms/:id", async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "Thiếu id" });

  try {
    const form = await kv.get(formKey(id));
    if (!form) {
      return res.status(404).json({ error: "Không tìm thấy form để xóa" });
    }

    await kv.del(formKey(id));
    await kv.zrem("forms:all", String(id));
    await kv.zrem(`forms:apartment:${form.apartment_id}`, String(id));
    if (form.service_id) {
      await kv.zrem(`forms:service:${form.service_id}`, String(id));
    }

    res.json({ message: "Đã xóa form thành công" });
  } catch (err) {
    console.error("DELETE /forms/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================== EXPORT CHO VERCEL ==================
module.exports = app;
