Codex Asset Console · Windows

完整安装：将 codex-asset-console-skill.zip 解压到
%USERPROFILE%\.codex\skills

先预览：
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\codex-asset-console\scripts\install-bundled.ps1" -WhatIf

再安装：
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\codex-asset-console\scripts\install-bundled.ps1"

默认目录：
- %LOCALAPPDATA%\Programs\Codex Asset Console
- %LOCALAPPDATA%\CodexAssetConsole
- %LOCALAPPDATA%\CodexAssetConsoleService

验证包：
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\codex-asset-console\scripts\verify.ps1" -BundleOnly
