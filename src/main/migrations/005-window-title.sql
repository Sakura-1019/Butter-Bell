-- 0.2.1：游戏运行时记下的主窗口标题（原样），识别信息时清洗成候补词（src/core/window-title.ts）
ALTER TABLE games ADD COLUMN window_title TEXT;
