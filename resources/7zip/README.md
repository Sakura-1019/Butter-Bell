# 自带的 7-Zip

- 版本：7-Zip 26.05（2026-10-21）x64，作者 Igor Pavlov。
- 来源：https://www.7-zip.org/a/7z2605-x64.exe（官网跳转到官方仓库 ip7z/7zip 的 Release）。安装包 SHA-256 `fd99e86f57d8f429ef5ed045bf98315af962e2309b0f1ba87a147a44c71647d0`，和 GitHub Release 上标的 digest 一致。
- 只取了安装包里的 `7z.exe`、`7z.dll` 和 `License.txt`，文件没有改动。
- 许可证：GNU LGPL，`7z.dll` 里的 RAR 解压代码另有 unRAR 许可限制（不能用来重新做出 RAR 压缩器），全文见 `License.txt`。按许可证要求，这份 `License.txt` 随程序一起分发。
- 打包时 electron-builder 把这个文件夹原样放到 `resources/7zip/`（见 `electron-builder.yml` 的 `extraResources`）。

升级：从 7-zip.org 下载新的 x64 安装包，用 `7zr.exe x 安装包.exe` 解开，替换这三个文件，再更新本文件里的版本和哈希。
