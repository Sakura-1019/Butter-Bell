-- 0.2.0：版本号、封面来源、分卷的下载时间
-- 版本号从压缩包名（取不到再用文件夹名）里取；用户在详情页手动改过的（version_manual = 1）不再自动覆盖
ALTER TABLE games ADD COLUMN version TEXT;
ALTER TABLE games ADD COLUMN version_manual INTEGER NOT NULL DEFAULT 0;
-- 封面从哪来，决定谁能自动替换谁（src/core/cover.ts）：manual > dlsite > folder > rpgmaker > screenshot
ALTER TABLE games ADD COLUMN cover_source TEXT CHECK (cover_source IN ('manual', 'dlsite', 'folder', 'rpgmaker', 'screenshot'));
-- 以前的封面只有两种来路：选了 DLsite 候选，或者手动填写 / 换封面
UPDATE games SET cover_source = CASE WHEN source_kind = 'dlsite' THEN 'dlsite' ELSE 'manual' END WHERE cover_file IS NOT NULL;
-- 分卷文件的修改时间，也就是下载时间，收件箱按它排序；旧数据下次扫描时补上
ALTER TABLE volumes ADD COLUMN modified_at TEXT;
