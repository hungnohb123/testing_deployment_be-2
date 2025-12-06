USE building_management;
-- DÙNG CHO US 001: user (thay cho residents)
CREATE TABLE user (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) UNIQUE NOT NULL,
  apartment_id VARCHAR(20) NOT NULL,
  state ENUM('active', 'inactive') DEFAULT 'active',
  cccd VARCHAR(20) UNIQUE,
  birth_date DATE,
  role VARCHAR(30),
  residency_status VARCHAR(30),
  email VARCHAR(30),
  password VARCHAR(100) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- DÙNG CHO US 008 VÀ 009: thanh toán và tra cứu
CREATE TABLE payments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  resident_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  state TINYINT NOT NULL DEFAULT 0,
  transaction_ref VARCHAR(50) UNIQUE NOT NULL,
  feetype VARCHAR(30),
  payment_date DATE,
  payment_form VARCHAR(50),
  payer_account VARCHAR(50),
  payer_name VARCHAR(150),
  provider_tx_id VARCHAR(100),
  verification_method VARCHAR(50),
  verified_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT payments_ibfk_1 FOREIGN KEY (resident_id) REFERENCES user(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);


describe payments;
describe user;
-- tăt chế độ an toàn
set sql_safe_updates = 0;
update user
set full_name = concat(first_name,'',last_name);
-- bật chế độ an toàn
set sql_safe_updates = 1;
INSERT INTO user (
  full_name, first_name, last_name, phone, apartment_id, 
  state, cccd, birth_date, role, residency_status, email, password
) VALUES (
  'Đỗ Văn B', 'Văn', 'B', '0938099203', 'Tầng 7 - Phòng 713',
  'Active', '077204000123', '1999-10-30', 'Cư dân', 'người thuê', 'dovanb@gmail.com', 'password'
); 
sELECT id, full_name FROM user ORDER BY id DESC LIMIT 1;
select * from payments;
INSERT INTO payments (
  resident_id, amount, state, transaction_ref,
  payer_account, payer_name, provider_tx_id, verification_method,
  feetype, payment_date, payment_form
) VALUES (
  1,                -- id của cư dân (đổi nếu khác)
  250000,           -- số tiền
  0,                -- chưa thanh toán (false)
  'TRX20251024-0001',   -- mã giao dịch
  '1234567890',     -- số tài khoản người chuyển
  'Đỗ Văn B',       -- tên chủ tài khoản
  NULL,             -- provider_tx_id (chưa có vì chưa thanh toán)
  'manual',         -- phương thức kiểm tra (ví dụ manual/webhook)
  'Phí quản lý tháng 10',  -- loại phí
  NULL,             -- payment_date (chưa thanh toán)
  'Chuyển khoản QR' -- hình thức thanh toán
);

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

UPDATE payments
SET state = 1,
    provider_tx_id = 'BANKTX9999',
    verified_at = NOW(),
    updated_at = NOW(),
    payment_date = CURRENT_DATE()
WHERE transaction_ref = 'TRX20251024-0001';

create table notifications(
  id INT AUTO_INCREMENT PRIMARY KEY,
  notification_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_date DATETIME DEFAULT NULL,
  apartment_id VARCHAR(20) NOT NULL,
  content TEXT NOT NULL
  );
  
  INSERT INTO notifications (notification_date, sent_date, apartment_id, content) VALUES
-- 1. Thông báo bảo trì điện
(NOW(), NULL, 'A1-101', 'Ban quản lý thông báo: Căn hộ A1-101 sẽ tạm ngắt điện từ 9h đến 11h sáng ngày 26/10 để bảo trì hệ thống điện tầng 1.'),

-- 2. Thông báo thu phí dịch vụ
(NOW(), NULL, 'B2-202', 'Ban quản lý thông báo: Phí dịch vụ tháng 10 của căn hộ B2-202 là 250.000đ. Vui lòng thanh toán trước ngày 30/10.'),

-- 3. Thông báo sự cố nước
(NOW(), NULL, 'C3-303', 'Thông báo: Hệ thống nước tại tầng 3 sẽ bị gián đoạn từ 14h đến 17h ngày 25/10 để khắc phục rò rỉ.'),

-- 4. Thông báo kiểm tra phòng cháy chữa cháy
(NOW(), NULL, 'D4-404', 'Ban quản lý thông báo: Ngày 27/10 sẽ diễn ra kiểm tra hệ thống PCCC. Cư dân căn hộ D4-404 vui lòng có mặt để phối hợp.'),

-- 5. Thông báo chung
(NOW(), NULL, 'E5-505', 'Ban quản lý tòa nhà: Vui lòng đeo thẻ cư dân khi ra vào tòa nhà để đảm bảo an ninh.');
select * FROM notifications;
select * from user;
select * from payments;
SET sql_safe_updates = 0;
delete from payments;
delete from user;
delete from notifications;

SET sql_safe_updates = 1;
SET FOREIGN_KEY_CHECKS = 0;
-- reset auto_increment
TRUNCATE TABLE payments;
TRUNCATE TABLE user;
truncate notifications;
-- must be carefull
-- ...existing code...
-- trong transaction
CREATE OR REPLACE VIEW transactions AS
SELECT id, resident_id, amount, state, transaction_ref, feetype, payment_date, payment_form, provider_tx_id, payer_account, payer_name, created_at, verified_at
FROM payments;
ALTER TABLE user AUTO_INCREMENT = 1;

SET FOREIGN_KEY_CHECKS = 1;