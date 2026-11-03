-- 常用密码表可以手动排顺序：解压时从上往下试，试成功的挪到最前面。
-- 已有的密码按原来的规则（最近成功的在前，没成功过的按添加顺序）排好
ALTER TABLE common_passwords ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
WITH o AS (SELECT id, ROW_NUMBER() OVER (ORDER BY last_success_at IS NULL, last_success_at DESC, id) AS n FROM common_passwords)
UPDATE common_passwords SET position = (SELECT n FROM o WHERE o.id = common_passwords.id);
