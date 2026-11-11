-- 0.3.0 导航：收藏，和游戏库最上面的“最近解压”分组（新解压、加入现成文件夹、接回时记下时间；启动一次或点“清空”后变回 NULL）
-- 升级前就在库里的游戏都是 NULL，不进“最近解压”
ALTER TABLE games ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN recent_extract_at TEXT;
