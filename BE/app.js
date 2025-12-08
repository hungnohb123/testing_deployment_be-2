// app.js (hoặc index.js nếu bạn dùng tên này)
// Backend dùng Express nhưng chạy trên Vercel serverless
// Database: Vercel KV (Upstash Redis – NoSQL, key-value)

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const express = require("express");
const cors = require("cors");
const { kv } = require("@vercel/kv");

const app = express();

app.use(express.json());

// ================== CORS ==================
const allowedOrigins = [
  "https://it-3180-2025-1-se-08.vercel.app",
  "https://testing-deployment-fe.vercel.app",
  "http://localhost:3000",
];

const corsOptions = {
  origin: function (origin, callback) {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

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

    const id = await nextId("seq:resident"); // có thể thiếu s
    const full_name = `${first_name.trim()} ${last_name.trim()}`;

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
      password,
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
    if (password !== undefined && password !== null)
      updated.password = password;

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

    const id = await nextId("seq:payments");
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
    await kv.zadd(`payments:residents:${resident_id}`, {
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
  //có thể thiếu s
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
  const { resident_id } = req.params; // không hiện thông báo
  try {
    const ids = await kv.zrange(`payments:residents:${resident_id}`, 0, -1, {
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
    await kv.zrem(`payments:resident:${p.resident_id}`, String(id));

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
    const id = await nextId("seq:notification"); // có thể thiếu s
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

app.post("/login", async (req, res) => {
  const { username, password, role } = req.body || {};

  if (!username || !password || !role) {
    return res
      .status(400)
      .json({ error: "Thiếu username, password hoặc role" });
  }

  try {
    let id = await kv.get(`login:email:${username}`);
    if (!id) {
      id = await kv.get(`login:phone:${username}`);
    }
    if (!id) {
      return res
        .status(401)
        .json({ error: "Sai tài khoản, mật khẩu hoặc vai trò" });
    }

    const user = await kv.get(residentKey(id));
    if (
      !user ||
      user.password !== password ||
      user.role !== role ||
      (user.state && String(user.state).toLowerCase() === "inactive")
    ) {
      return res
        .status(401)
        .json({ error: "Sai tài khoản, mật khẩu hoặc vai trò" });
    }

    const safeUser = { ...user };
    delete safeUser.password;

    res.json({ message: "Đăng nhập thành công", user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================== EXPORT CHO VERCEL ==================
module.exports = app;