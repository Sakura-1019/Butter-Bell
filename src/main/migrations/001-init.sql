-- 第一版的表结构，来自 docs/schema-draft.md。迁移文件一旦发布就不再改，改表结构写新的迁移。

-- 游戏 Game
CREATE TABLE games (
  id                  INTEGER PRIMARY KEY,
  title               TEXT NOT NULL,                 -- 名称，没资料时先用文件夹名
  original_title      TEXT,                          -- 原名
  circle              TEXT,                          -- 社团
  description         TEXT,                          -- 简介
  cover_file          TEXT,                          -- 封面，相对于数据目录，如 covers/12.jpg；NULL = 待补封面
  play_status         TEXT NOT NULL DEFAULT 'wishlist'
                      CHECK (play_status IN ('playing', 'wishlist', 'completed')),  -- 在玩 / 想玩 / 通关
  folder_name         TEXT NOT NULL,                 -- 游戏文件夹，相对于游戏目录；卸载后保留，用来接回
  uninstalled_at      TEXT,                          -- 非 NULL = 已卸载（ADR 0004）
  launch_file         TEXT,                          -- 启动文件，相对于游戏文件夹
  use_locale_emulator INTEGER NOT NULL DEFAULT 0,    -- 用 LE 启动
  source_kind         TEXT CHECK (source_kind IN ('dlsite', 'manual', 'tg')),  -- 资料来源；NULL = 待补资料；'tg' 第二版才用
  source_ref          TEXT,                          -- dlsite：RJ 号；tg（第二版）：频道 + 帖子编号
  added_at            TEXT NOT NULL
);
-- 同一时刻一个游戏文件夹只属于一个没卸载的游戏
CREATE UNIQUE INDEX games_installed_folder ON games(folder_name) WHERE uninstalled_at IS NULL;

-- 同套 Bundle：用户确认属于同一个游戏的多个压缩包
CREATE TABLE bundles (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,                         -- 共同的名字，也是解压出来的游戏文件夹名
  created_at  TEXT NOT NULL
);

-- 压缩包 Archive：身份 = 首个分卷原始文件名 + 总大小（ADR 0001）
CREATE TABLE archives (
  id                  INTEGER PRIMARY KEY,
  first_volume_name   TEXT NOT NULL,                 -- 首个分卷的原始文件名（只是文件名，不含目录）
  total_size          INTEGER NOT NULL,              -- 所有分卷加起来的字节数
  format              TEXT NOT NULL,                 -- rar / 7z / zip / zst …
  current_dir         TEXT,                          -- 现在所在的目录，相对于仓库目录（'' = 根，'已解压' = 已解压子文件夹）；NULL = 找不到了（进了回收站或被移走）
  state               TEXT NOT NULL DEFAULT 'inbox'
                      CHECK (state IN ('inbox', 'extracted', 'ignored')),
  bundle_id           INTEGER REFERENCES bundles(id) ON DELETE SET NULL,
  game_id             INTEGER REFERENCES games(id) ON DELETE SET NULL,  -- 解压出了哪个游戏；接回就靠它
  subfolder           TEXT,                          -- 同套时，它在游戏文件夹里占的子文件夹
  password_cipher     BLOB,                          -- 解压密码，safeStorage 密文（ADR 0002）；NULL = 不知道或不需要
  needs_password      INTEGER NOT NULL DEFAULT 0,    -- 常用密码都试过还解不开，界面标红
  first_seen_at       TEXT NOT NULL,
  extracted_at        TEXT,
  UNIQUE (first_volume_name, total_size)
);

-- 分卷 Volume：一个压缩包的各个文件，只有一个文件的压缩包也有一行
CREATE TABLE volumes (
  archive_id  INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,                      -- 从 1 开始
  file_name   TEXT NOT NULL,
  size        INTEGER NOT NULL,
  PRIMARY KEY (archive_id, seq)
);

-- 用户点过“不是同一套”的同套建议，避免下次再提示
CREATE TABLE rejected_bundle_suggestions (
  archive_ids TEXT PRIMARY KEY                       -- 排好序的 archives.id，用逗号连起来，如 '12,13,15'
);

-- 用户忽略的现成文件夹（现成文件夹本身不建表，每次扫描游戏目录现算）
CREATE TABLE ignored_loose_folders (
  folder_name TEXT PRIMARY KEY,                      -- 相对于游戏目录
  ignored_at  TEXT NOT NULL
);

-- 常用密码表
CREATE TABLE common_passwords (
  id               INTEGER PRIMARY KEY,
  password_cipher  BLOB NOT NULL,                    -- safeStorage 密文
  last_success_at  TEXT,                             -- 尝试顺序：最近成功过的排前面
  created_at       TEXT NOT NULL
);

-- 标签
CREATE TABLE tags (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE game_tags (
  game_id  INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (game_id, tag_id)
);

-- 游玩会话
CREATE TABLE play_sessions (
  id          INTEGER PRIMARY KEY,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  started_at  TEXT NOT NULL,
  ended_at    TEXT,                                  -- NULL = 正在运行；程序崩溃留下的半截会话，下次启动时丢掉
  seconds     INTEGER                                -- 结束时写入
);
CREATE INDEX play_sessions_game ON play_sessions(game_id, started_at);

-- 设置：一份键值表
CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL                               -- JSON
);

