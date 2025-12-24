-- =========================================
-- TẠO DATABASE & DỌN SẠCH SCHEMA CŨ
-- =========================================

CREATE DATABASE IF NOT EXISTS building_management
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE building_management;

-- Xóa view & bảng nếu đã tồn tại (để script chạy lại nhiều lần không lỗi)
DROP VIEW IF EXISTS transactions;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS services;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS user;
SET FOREIGN_KEY_CHECKS = 1;

-- =========================================
-- BẢNG USER (CƯ DÂN)
-- =========================================

CREATE TABLE user (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name      VARCHAR(100),
  first_name     VARCHAR(100) NOT NULL,
  last_name      VARCHAR(100) NOT NULL,
  phone          VARCHAR(20) UNIQUE NOT NULL,
  apartment_id   VARCHAR(20) NOT NULL,
  state          ENUM('active', 'inactive') DEFAULT 'active',
  cccd           VARCHAR(20) UNIQUE,
  birth_date     DATE,
  role           VARCHAR(30),
  residency_status VARCHAR(30),
  email          VARCHAR(50),
  password       VARCHAR(100) NOT NULL,
  
  -- Thêm 2 cột cho chức năng Quên mật khẩu
  reset_password_token   VARCHAR(255) DEFAULT NULL,
  reset_password_expires DATETIME DEFAULT NULL,

  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
)
ENGINE = InnoDB
DEFAULT CHARSET = utf8mb4
COLLATE = utf8mb4_unicode_ci;

-- Index để hỗ trợ FOREIGN KEY từ services
ALTER TABLE user
  ADD INDEX idx_user_apartment (apartment_id);

-- =========================================
-- BẢNG PAYMENTS (THANH TOÁN)
-- =========================================

CREATE TABLE payments (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  resident_id     BIGINT UNSIGNED NOT NULL,
  amount          DECIMAL(12,2) NOT NULL,
  state           TINYINT NOT NULL DEFAULT 0,   -- 0: chưa thanh toán, 1: đã thanh toán
  transaction_ref VARCHAR(50) UNIQUE NOT NULL,
  feetype         VARCHAR(30),
  payment_date    DATE,
  payment_form    VARCHAR(50),
  payer_account   VARCHAR(50),
  payer_name      VARCHAR(150),
  provider_tx_id  VARCHAR(100),
  verification_method VARCHAR(50),
  verified_at     DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT payments_ibfk_1
    FOREIGN KEY (resident_id) REFERENCES user(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
)
ENGINE = InnoDB
DEFAULT CHARSET = utf8mb4
COLLATE = utf8mb4_unicode_ci;

-- =========================================
-- BẢNG NOTIFICATIONS (THÔNG BÁO)
-- =========================================

CREATE TABLE notifications (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  notification_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_date         DATETIME DEFAULT NULL,
  apartment_id      VARCHAR(20) NOT NULL,
  content           TEXT NOT NULL
)
ENGINE = InnoDB
DEFAULT CHARSET = utf8mb4
COLLATE = utf8mb4_unicode_ci;

-- =========================================
-- BẢNG SERVICES (DỊCH VỤ / KHIẾU NẠI / KHAI BÁO)
-- =========================================

CREATE TABLE services (
  service_id   INT AUTO_INCREMENT PRIMARY KEY,  -- Khóa chính

  apartment_id VARCHAR(20) NOT NULL,            -- Khóa ngoại tới user.apartment_id

  content VARCHAR(255) NOT NULL,

  -- content ENUM(
  --   'Làm thẻ xe',
  --   'Sửa chữa căn hộ',
  --   'Vận chuyển đồ',
  --   'Dọn dẹp căn hộ',
  --   'tài sản chung',
  --   'mất tài sản',
  --   'Khai báo thông tin'
  -- ) NOT NULL,

  service_type ENUM(
    'Dịch vụ trung cư',
    'Khiếu nại',
    'Khai báo tạm trú'
  ) NOT NULL,

  ben_xu_ly ENUM(
    'Công an',
    'Ban quản trị'
  ) NOT NULL,

  servicestatus ENUM(
    'Đã ghi nhận',
    'Đã xử lý'
  ) NOT NULL DEFAULT 'Đã ghi nhận',

  handle_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note        TEXT,

  CONSTRAINT fk_services_apartment
    FOREIGN KEY (apartment_id)
    REFERENCES user(apartment_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
)
ENGINE = InnoDB
DEFAULT CHARSET = utf8mb4
COLLATE = utf8mb4_unicode_ci;

-- =========================================
-- VIEW TRANSACTIONS (DÙNG ĐỂ TRA CỨU GIAO DỊCH)
-- =========================================

CREATE OR REPLACE VIEW transactions AS
SELECT
  id,
  resident_id,
  amount,
  state,
  transaction_ref,
  feetype,
  payment_date,
  payment_form,
  provider_tx_id,
  payer_account,
  payer_name,
  created_at,
  verified_at
FROM payments;

-- =========================================
-- DỮ LIỆU MẪU ĐỂ TEST API
-- =========================================

-- 1. Thêm 1 user mẫu
INSERT INTO user (
  full_name, first_name, last_name, phone, apartment_id,
  state, cccd, birth_date, role, residency_status, email, password
) VALUES (
  'Đỗ Văn B', 'Văn', 'B', '0938099203', 'Tầng 7 - Phòng 713',
  'active',                      -- phải đúng ENUM ('active', 'inactive')
  '077204000123', '1999-10-30',
  'Cư dân', 'người thuê',
  'dovanb@gmail.com', 'password'
);

-- Lấy id user mới tạo (để ghi nhớ nếu cần)
SELECT id, full_name FROM user ORDER BY id DESC LIMIT 1;

-- Giả sử id = 1, tạo 1 payment mẫu
INSERT INTO payments (
  resident_id, amount, state, transaction_ref,
  payer_account, payer_name, provider_tx_id, verification_method,
  feetype, payment_date, payment_form
) VALUES (
  1,                  -- id cư dân
  250000,             -- số tiền
  0,                  -- 0: chưa thanh toán
  'TRX20251024-0001', -- mã giao dịch
  '1234567890',       -- số tài khoản
  'Đỗ Văn B',         -- tên chủ tài khoản
  NULL,               -- provider_tx_id (chưa có)
  'manual',           -- cách kiểm tra (ví dụ: manual/webhook)
  'Phí quản lý tháng 10',
  NULL,               -- payment_date (chưa thanh toán)
  'Chuyển khoản QR'
);

-- Xem thử join user + payments
SELECT 
  p.id, 
  r.full_name, 
  p.amount, 
  p.state AS is_paid, 
  p.transaction_ref, 
  p.feetype, 
  p.payer_account, 
  p.payer_name,
  p.payment_date
FROM payments p
JOIN user r ON p.resident_id = r.id;

-- Cập nhật payment sang đã thanh toán
UPDATE payments
SET state = 1,
    provider_tx_id = 'BANKTX9999',
    verified_at = NOW(),
    updated_at = NOW(),
    payment_date = CURRENT_DATE()
WHERE transaction_ref = 'TRX20251024-0001';

-- 2. Thêm 1 vài notifications mẫu
INSERT INTO notifications (notification_date, sent_date, apartment_id, content) VALUES
  (NOW(), NULL, 'A1-101', 'Ban quản lý thông báo: Căn hộ A1-101 sẽ tạm ngắt điện từ 9h đến 11h sáng ngày 26/10 để bảo trì hệ thống điện tầng 1.'),
  (NOW(), NULL, 'B2-202', 'Ban quản lý thông báo: Phí dịch vụ tháng 10 của căn hộ B2-202 là 250.000đ. Vui lòng thanh toán trước ngày 30/10.'),
  (NOW(), NULL, 'C3-303', 'Thông báo: Hệ thống nước tại tầng 3 sẽ bị gián đoạn từ 14h đến 17h ngày 25/10 để khắc phục rò rỉ.'),
  (NOW(), NULL, 'D4-404', 'Ban quản lý thông báo: Ngày 27/10 sẽ diễn ra kiểm tra hệ thống PCCC. Cư dân căn hộ D4-404 vui lòng có mặt để phối hợp.'),
  (NOW(), NULL, 'E5-505', 'Ban quản lý tòa nhà: Vui lòng đeo thẻ cư dân khi ra vào tòa nhà để đảm bảo an ninh.');

-- 3. (Tuỳ chọn) Thêm 1 service mẫu để test API /services

INSERT INTO services (
  apartment_id, content, service_type, ben_xu_ly, servicestatus, note
) VALUES (
  'Tầng 7 - Phòng 713',
  'Làm thẻ xe',
  'Dịch vụ trung cư',
  'Ban quản trị',
  'Đã ghi nhận',
  'Làm thêm 1 thẻ xe máy'
);

-- Xem nhanh dữ liệu
SELECT * FROM user;
SELECT * FROM payments;
SELECT * FROM notifications;
SELECT * FROM services;