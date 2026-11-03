-- 解压失败的原因记在压缩包上（JSON：reason / detail / need / free），重开程序后收件箱还能显示，不用再点一次解压
ALTER TABLE archives ADD COLUMN last_error TEXT;
