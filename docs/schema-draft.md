# SQLite 表结构草案（第一版）

写于 2026-11-03。术语见 [GLOSSARY.md](../GLOSSARY.md)，背后的取舍见 [docs/adr/](./adr/)。这是草案，写正式代码时可以按实际需要调整，但改动如果违背了 ADR，要先改 ADR。

## 总体原则

- 路径全部存相对路径（[ADR 0003](./adr/0003-paths-relative-to-chosen-directories.md)）。
- 时间全部存 ISO 8601 的 UTC 文本，例如 `2026-11-03T13:20:00Z`。
- 能算出来的不存：游玩时长、上次游玩、收件箱条目都现算。几百个游戏的规模，现算足够快。
- 字段名用英文，取值用英文代码，界面文字走 i18n。

## 表

```sql
PRAGMA foreign_keys = ON;

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
  folder_name         TEXT NOT NULL,                 -- 游戏文件夹，相对于游戏目录；卸载后保留，用来接回。双击解压到游戏目录外的存完整路径（ADR 0003 补充）
  uninstalled_at      TEXT,                          -- 非 NULL = 已卸载（ADR 0004）
  launch_file         TEXT,                          -- 启动文件，相对于游戏文件夹
  use_locale_emulator INTEGER NOT NULL DEFAULT 0,    -- 用 LE 启动
  source_kind         TEXT CHECK (source_kind IN ('dlsite', 'manual', 'tg')),  -- 资料来源；NULL = 待补资料；'tg' 第二版才用
  source_ref          TEXT,                          -- dlsite：RJ 号；tg（第二版）：频道 + 帖子编号
  version             TEXT,                          -- 迁移 004：版本号，先从压缩包名取，取不到用文件夹名；接回新版本时更新
  version_manual      INTEGER NOT NULL DEFAULT 0,    -- 迁移 004：用户在详情页改过版本号，以后不再自动覆盖
  cover_source        TEXT CHECK (cover_source IN ('manual', 'dlsite', 'folder', 'rpgmaker', 'screenshot')),  -- 迁移 004：封面来源，高的自动替换低的，manual（含手动截图）永不被自动替换
  favorite            INTEGER NOT NULL DEFAULT 0,    -- 迁移 006：收藏
  recent_extract_at   TEXT,                          -- 迁移 006：在游戏库“最近解压”里的时间（新解压、加入现成文件夹、接回）；启动一次或清空后是 NULL
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
  last_error          TEXT,                          -- 迁移 003：上次解压失败的原因（JSON：reason / detail / need / free），重开程序后照样显示
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
  modified_at TEXT,                                  -- 迁移 004：文件修改时间 = 下载时间，收件箱按它排序；压缩包取最新那一卷
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
  last_success_at  TEXT,
  position         INTEGER NOT NULL DEFAULT 0,       -- 迁移 002：尝试顺序，设置页可以手动排；试成功的挪到最前
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
  ended_at    TEXT,                                  -- NULL = 正在运行；程序崩溃留下的半截会话，下次启动时按最后一次心跳收尾
  seconds     INTEGER                                -- 运行中每 3 秒心跳更新一次，结束时写最终值
);
CREATE INDEX play_sessions_game ON play_sessions(game_id, started_at);

-- 设置：一份键值表
CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL                               -- JSON
);

-- 数据库版本，迁移用
PRAGMA user_version = 1;
```

## 设置项

| key | 取值 | 说明 |
|---|---|---|
| `archive_dir` | 绝对路径 | 仓库目录，首次设置向导里选 |
| `library_dir` | 绝对路径 | 游戏目录，首次设置向导里选 |
| `post_extract_action` | `"keep"` / `"recycle"` / `"move"` / 不存在 | 解压后处理；不存在表示第一次解压时要问 |
| `locale_emulator_path` | 绝对路径 / 不存在 | `LEProc.exe` 的位置；没设时 LE 开关不可用 |
| `privacy_mode` | `true` / `false` | 隐私模式当前状态，关程序时记住 |
| `privacy_on_start` | `true` / `false` | 每次启动都先模糊，默认 `false` |
| `theme` | `"system"` / `"light"` / `"dark"` | 默认 `system` |
| `language` | `"zh-CN"` … | 界面语言 |
| `inbox_sort` | `{ "key", "desc" }`：key 是 `modified` / `name` / `size` / `added`，desc 是 true / false | 待解压的排序，默认下载时间、新的在前 |
| `my_tags` | 字符串数组 / 不存在 | 我的标签；不存在时用内置的人气分类（`src/core/genres.json` 的 `popular`） |
| `nav_order` | 六个页面名的数组 | 左侧导航的顺序，长按拖动后保存；默认 `recent, library, favorites, inbox, completed, uninstalled` |
| `library_sort` | `{ "key", "desc" }`：key 是 `added` / `lastPlayed` / `title` / `playtime` | 游戏库、收藏、已通关的排序，默认加入时间、新的在前 |
| `capture_hotkey` | Electron 快捷键写法 / `false` | 手动截图的全局快捷键，默认 `CommandOrControl+Alt+F12`；`false` = 关掉；只在有游戏运行时注册 |

## 常见操作在表上怎么体现

- **收件箱**：`archives.state = 'inbox'` 的压缩包（同一个 `bundle_id` 的合成一行），加上游戏目录里既不是某个游戏的 `folder_name`、也不在 `ignored_loose_folders` 里的文件夹。
- **同套建议**：扫描时现算，排除 `rejected_bundle_suggestions` 里的组合，不存表。
- **解压**：成功后 `state = 'extracted'`，写 `game_id`、`extracted_at`，按解压后处理更新 `current_dir`。同套解压到 `bundles.name` 那个文件夹，每个压缩包写各自的 `subfolder`。
- **新游戏的默认状态**：想玩。
- **卸载**：游戏文件夹进回收站，写 `uninstalled_at`；它的压缩包 `state` 改回 `inbox`（`game_id` 保留），这样重新解压就能接回。其余不动。
- **接回**：解压一个 `game_id` 指向已卸载游戏的压缩包时，清掉 `uninstalled_at`，必要时更新 `folder_name`。原来的启动文件在新文件夹里还在就接着用。现成文件夹的名字和某个已卸载游戏的 `folder_name` 一样时，扫描游戏目录时自动接回（不进收件箱），它的压缩包回到 `extracted`。
- **彻底移除记录**：只对已卸载的游戏。删 `games` 那一行，没人用的标签一起删；会话和标签关联跟着删，压缩包的 `game_id` 变 NULL。
- **从 DLsite 选定候选**：写 `original_title`、`circle`、`description`、`source_kind = 'dlsite'`、`source_ref = RJ 号`；封面下载到 `covers/`；名称只在还是文件夹名时才覆盖。DLsite 类型词只在选候选的界面里列出（按 id 换成标签库的中文名，R-18G 不列；属于我的标签的默认勾上），勾上的才写进 `tags`，不另存。迁移 006 把以前存的日文类型词换成中文名。
- **游玩时长 / 上次游玩**：`SUM(seconds)` / `MAX(started_at)`。
- **已有游戏的新版本**：第一版当作一个新游戏，不做关联（第二版和系列作合并一起考虑）。0.2.0 起，接回时（同一个压缩包记录，或同名现成文件夹）`version` 跟着更新，`version_manual = 1` 的除外。
- **封面优先级**（0.2.0）：手选 > DLsite > 游戏目录里的图片 > RPG Maker 标题画面 > 自动截图。入库、接回、程序启动时在游戏文件夹里找；没封面的游戏启动后自动截图。被替换的封面文件删掉。

## 第二版预留

- `games.source_kind` 已允许 `'tg'`，`source_ref` 写频道和帖子编号。
- TG 帖子可以用 `archives` 的身份（文件名 + 大小）直接匹配。
- 存档备份、CG/音乐归类、系列作合并到时候再加表，第一版不建空表。
