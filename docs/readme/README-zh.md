<div align="center">

# YouTube Music

[![GitHub release](https://img.shields.io/github/release/th-ch/youtube-music.svg?style=for-the-badge&logo=youtube-music)](https://github.com/th-ch/youtube-music/releases/)
[![GitHub license](https://img.shields.io/github/license/th-ch/youtube-music.svg?style=for-the-badge)](https://github.com/th-ch/youtube-music/blob/master/LICENSE)
[![eslint code style](https://img.shields.io/badge/code_style-eslint-5ed9c7.svg?style=for-the-badge)](https://github.com/th-ch/youtube-music/blob/master/eslint.config.mjs)
[![Build status](https://img.shields.io/github/actions/workflow/status/th-ch/youtube-music/build.yml?branch=master&style=for-the-badge&logo=youtube-music)](https://GitHub.com/th-ch/youtube-music/releases/)
[![GitHub All Releases](https://img.shields.io/github/downloads/th-ch/youtube-music/total?style=for-the-badge&logo=youtube-music)](https://GitHub.com/th-ch/youtube-music/releases/)
[![AUR](https://img.shields.io/aur/version/youtube-music-bin?color=blueviolet&style=for-the-badge&logo=youtube-music)](https://aur.archlinux.org/packages/youtube-music-bin)
[![Known Vulnerabilities](https://snyk.io/test/github/th-ch/youtube-music/badge.svg)](https://snyk.io/test/github/th-ch/youtube-music)

</div>

![截图](/web/screenshot.png "截图")


<div align="center">
	<a href="https://github.com/th-ch/youtube-music/releases/latest">
		<img src="../../web/youtube-music.svg" width="400" height="100" alt="YouTube Music SVG">
	</a>
</div>

其他语言版本: [🇰🇷](./docs/readme/README-ko.md), [🇫🇷](./docs/readme/README-fr.md), [🇮🇸](./docs/readme/README-is.md), [🇨🇱 🇪🇸](./docs/readme/README-es.md), [🇷🇺](./docs/readme/README-ru.md), [🇭🇺](./docs/readme/README-hu.md)

**基于 Electron 的 YouTube Music 封装，具有以下特点：**

- 原生外观和感觉，旨在保持原始界面
- 自定义插件框架：根据您的需求（样式、内容、功能）更改 YouTube Music，一键启用/禁用插件

## 演示图片

|                          播放器屏幕（专辑颜色主题和环境光）                                               |
|:---------------------------------------------------------------------------------------------------------:|
|![Screenshot1](https://github.com/th-ch/youtube-music/assets/16558115/53efdf73-b8fa-4d7b-a235-b96b91ea77fc)|

## 目录

- [功能](#功能)
- [可用插件](#可用插件)
- [翻译](#翻译)
- [下载](#下载)
  - [Arch Linux](#arch-linux)
  - [macOS](#macos)
  - [Windows](#windows)
    - [如何在没有网络连接的情况下安装？（Windows）](#如何在没有网络连接的情况下安装windows)
- [主题](#主题)
- [开发](#开发)
- [构建自己的插件](#构建自己的插件)
  - [创建插件](#创建插件)
  - [常见用例](#常见用例)
- [构建](#构建)
- [生产预览](#生产预览)
- [测试](#测试)
- [许可证](#许可证)
- [常见问题](#常见问题)

## 功能：

- **暂停时自动确认**（始终启用）：禁用["继续观看？"](https://user-images.githubusercontent.com/61631665/129977894-01c60740-7ec6-4bf0-9a2c-25da24491b0e.png)弹窗，这个弹窗会在一段时间后暂停音乐

- 以及更多...

## 可用插件：

- **广告拦截器**：开箱即用地拦截所有广告和跟踪

- **专辑操作**：添加取消不喜欢、不喜欢、喜欢和取消喜欢按钮，以便将其应用于播放列表或专辑中的所有歌曲

- **专辑颜色主题**：根据专辑颜色调色板应用动态主题和视觉效果

- **环境模式**：通过将视频中的柔和颜色投射到屏幕背景中，应用照明效果

- **音频压缩器**：对音频应用压缩（降低信号最响亮部分的音量并提高最柔和部分的音量）

- **模糊导航栏**：使导航栏透明且模糊

- **绕过年龄限制**：绕过 YouTube 的年龄验证

- **字幕选择器**：启用字幕

- **紧凑侧边栏**：始终将侧边栏设置为紧凑模式

- **交叉淡入淡出**：在歌曲之间交叉淡入淡出

- **禁用自动播放**：使每首歌曲以"暂停"模式开始

- **[Discord](https://discord.com/) 丰富状态**：通过[丰富状态](https://user-images.githubusercontent.com/28219076/104362104-a7a0b980-5513-11eb-9744-bb89eabe0016.png)向朋友展示您正在听的内容

- **下载器**：[直接从界面](https://user-images.githubusercontent.com/61631665/129977677-83a7d067-c192-45e1-98ae-b5a4927393be.png)下载 MP3 [(youtube-dl)](https://github.com/ytdl-org/youtube-dl)

- **均衡器**：添加滤镜以提升或减弱特定频率范围（例如低音增强器）

- **指数音量**：使音量滑块[呈指数变化](https://greasyfork.org/en/scripts/397686-youtube-music-fix-volume-ratio/)，使选择较低音量更容易

- **应用内菜单**：[为栏目提供精美的暗色外观](https://user-images.githubusercontent.com/78568641/112215894-923dbf00-8c29-11eb-95c3-3ce15db27eca.png)

  > （如果在启用此插件和隐藏菜单选项后无法访问菜单，请参阅[这篇文章](https://github.com/th-ch/youtube-music/issues/410#issuecomment-952060709)）

- **Scrobbler**：添加对 [Last.fm](https://www.last.fm/) 和 [ListenBrainz](https://listenbrainz.org/) 的 scrobbling 支持

- **Lumia Stream**：添加 [Lumia Stream](https://lumiastream.com/) 支持

- **Lyrics Genius**：为大多数歌曲添加歌词支持

- **Music Together**：与他人共享播放列表。当主机播放一首歌曲时，其他所有人都会听到相同的歌曲

- **导航**：直接集成在界面中的下一个/返回导航箭头，就像在您喜欢的浏览器中一样

- **无 Google 登录**：从界面中移除 Google 登录按钮和链接

- **通知**：当歌曲开始播放时显示通知（Windows 上提供[交互式通知](https://user-images.githubusercontent.com/78568641/114102651-63ce0e00-98d0-11eb-9dfe-c5a02bb54f9c.png)）

- **画中画**：允许将应用切换到画中画模式

- **播放速度**：快速聆听，慢速聆听！[添加控制歌曲速度的滑块](https://user-images.githubusercontent.com/61631665/129976003-e55db5ba-bf42-448c-a059-26a009775e68.png)

- **精确音量**：使用鼠标滚轮/热键精确控制音量，带有自定义 HUD 和可自定义的音量步进

- **快捷键（和 MPRIS）**：允许为播放（播放/暂停/下一首/上一首）设置全局热键 + 通过覆盖媒体键禁用[媒体 OSD](https://user-images.githubusercontent.com/84923831/128601225-afa38c1f-dea8-4209-9f72-0f84c1dd8b54.png) + 启用 Ctrl/CMD + F 进行搜索 + 启用 Linux MPRIS 支持媒体键 + 为[高级用户](https://github.com/th-ch/youtube-music/issues/106#issuecomment-952156902)提供[自定义热键](https://github.com/Araxeus/youtube-music/blob/1e591d6a3df98449bcda6e63baab249b28026148/providers/song-controls.js#L13-L50)

- **跳过不喜欢的歌曲**：跳过不喜欢的歌曲

- **跳过静音**：自动跳过静音部分

- [**SponsorBlock**](https://github.com/ajayyy/SponsorBlock)：自动跳过非音乐部分，如介绍/结尾或音乐视频中没有播放歌曲的部分

- **同步歌词**：使用 [LRClib](https://lrclib.net) 等提供商提供歌曲的同步歌词。

- **任务栏媒体控制**：从[Windows 任务栏](https://user-images.githubusercontent.com/78568641/111916130-24a35e80-8a82-11eb-80c8-5021c1aa27f4.png)控制播放

- **TouchBar**：macOS 的自定义 TouchBar 布局

- **Tuna OBS**：与 [OBS](https://obsproject.com/) 的插件 [Tuna](https://obsproject.com/forum/resources/tuna.843/) 集成

- **视频质量更改器**：允许通过视频覆盖层上的[按钮](https://user-images.githubusercontent.com/78568641/138574366-70324a5e-2d64-4f6a-acdd-dc2a2b9cecc5.png)更改视频质量

- **视频切换**：添加[按钮](https://user-images.githubusercontent.com/28893833/173663950-63e6610e-a532-49b7-9afa-54cb57ddfc15.png)在视频/歌曲模式之间切换。还可以选择完全移除视频选项卡

- **可视化器**：不同的音乐可视化器

## 翻译

您可以在 [Hosted Weblate](https://hosted.weblate.org/projects/youtube-music/) 上帮助翻译。

<a href="https://hosted.weblate.org/engage/youtube-music/">
  <img src="https://hosted.weblate.org/widget/youtube-music/i18n/multi-auto.svg" alt="翻译状态" />
  <img src="https://hosted.weblate.org/widget/youtube-music/i18n/287x66-black.png" alt="翻译状态 2" />
</a>

## 下载

您可以查看[最新版本](https://github.com/th-ch/youtube-music/releases/latest)以快速找到最新版本。

### Arch Linux

从 AUR 安装 [`youtube-music-bin`](https://aur.archlinux.org/packages/youtube-music-bin) 包。有关 AUR 安装说明，请参阅此[维基页面](https://wiki.archlinux.org/index.php/Arch_User_Repository#Installing_packages)。

### macOS

您可以使用 Homebrew 安装应用（请参阅 [cask 定义](https://github.com/th-ch/homebrew-youtube-music)）：

```bash
brew install th-ch/youtube-music/youtube-music
```

如果您手动安装应用并在启动应用时收到"已损坏且无法打开"的错误，请在终端中运行以下命令：

```bash
/usr/bin/xattr -cr /Applications/YouTube\ Music.app
```

### Windows

您可以使用 [Scoop 包管理器](https://scoop.sh) 从 [`extras` bucket](https://github.com/ScoopInstaller/Extras) 安装 `youtube-music` 包。

```bash
scoop bucket add extras
scoop install extras/youtube-music
```

或者，您可以使用 [Winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/)，Windows 11 的官方 CLI 包管理器来安装 `th-ch.YouTubeMusic` 包。

*注意：Microsoft Defender SmartScreen 可能会阻止安装，因为它来自"未知发布者"。对于手动安装，在尝试运行从 GitHub 手动下载的可执行文件（.exe）时也是如此（相同文件）。*

```bash
winget install th-ch.YouTubeMusic
```

#### 如何在没有网络连接的情况下安装？（Windows）

- 在[发布页面](https://github.com/th-ch/youtube-music/releases/latest)下载适合您设备架构的 `*.nsis.7z` 文件。
  - 64 位 Windows 使用 `x64`
  - 32 位 Windows 使用 `ia32`
  - ARM64 Windows 使用 `arm64`
- 在发布页面下载安装程序（`*-Setup.exe`）
- 将它们放在**同一目录**中。
- 运行安装程序。

## 主题

您可以加载 CSS 文件来更改应用的外观（选项 > 视觉调整 > 主题）。

一些预定义的主题可在 https://github.com/kerichdev/themes-for-ytmdesktop-player 找到。

## 开发

```bash
git clone https://github.com/th-ch/youtube-music
cd youtube-music
pnpm install --frozen-lockfile
pnpm dev
```

## 构建自己的插件

使用插件，您可以：

- 操作应用 - 来自 electron 的 `BrowserWindow` 被传递给插件处理程序
- 通过操作 HTML/CSS 来更改前端

### 创建插件

在 `src/plugins/YOUR-PLUGIN-NAME` 中创建一个文件夹：

- `index.ts`：插件的主文件
```typescript
import style from './style.css?inline'; // 以内联方式导入样式

import { createPlugin } from '@/utils';

export default createPlugin({
  name: '插件标签',
  restartNeeded: true, // 如果值为 true，ytmusic 会显示重启对话框
  config: {
    enabled: false,
  }, // 您的自定义配置
  stylesheets: [style], // 您的自定义样式,
  menu: async ({ getConfig, setConfig }) => {
    // 所有 *Config 方法都被包装为 Promise<T>
    const config = await getConfig();
    return [
      {
        label: '菜单',
        submenu: [1, 2, 3].map((value) => ({
          label: `值 ${value}`,
          type: 'radio',
          checked: config.value === value,
          click() {
            setConfig({ value });
          },
        })),
      },
    ];
  },
  backend: {
    start({ window, ipc }) {
      window.maximize();

      // 您可以与渲染器插件通信
      ipc.handle('some-event', () => {
        return 'hello';
      });
    },
    // 当配置更改时触发
    onConfigChange(newConfig) { /* ... */ },
    // 当插件禁用时触发
    stop(context) { /* ... */ },
  },
  renderer: {
    async start(context) {
      console.log(await context.ipc.invoke('some-event'));
    },
    // 仅渲染器可用的钩子
    onPlayerApiReady(api: YoutubePlayer, context: RendererContext) {
      // 轻松设置插件配置
      context.setConfig({ myConfig: api.getVolume() });
    },
    onConfigChange(newConfig) { /* ... */ },
    stop(_context) { /* ... */ },
  },
  preload: {
    async start({ getConfig }) {
      const config = await getConfig();
    },
    onConfigChange(newConfig) {},
    stop(_context) {},
  },
});
```

### 常见用例

- 注入自定义 CSS：在同一文件夹中创建一个 `style.css` 文件，然后：

```typescript
// index.ts
import style from './style.css?inline'; // 以内联方式导入样式

import { createPlugin } from '@/utils';

export default createPlugin({
  name: '插件标签',
  restartNeeded: true, // 如果值为 true，ytmusic 将显示重启对话框
  config: {
    enabled: false,
  }, // 您的自定义配置
  stylesheets: [style], // 您的自定义样式
  renderer() {} // 定义渲染器钩子
});
```

- 如果您想更改 HTML：

```typescript
import { createPlugin } from '@/utils';

export default createPlugin({
  name: '插件标签',
  restartNeeded: true, // 如果值为 true，ytmusic 将显示重启对话框
  config: {
    enabled: false,
  }, // 您的自定义配置
  renderer() {
    // 移除登录按钮
    document.querySelector(".sign-in-link.ytmusic-nav-bar").remove();
  } // 定义渲染器钩子
});
```

- 前端和后端之间的通信：可以使用 electron 的 ipcMain 模块完成。查看 `index.ts` 文件和 `sponsorblock` 插件中的示例。

## 构建

1. 克隆仓库
2. 按照[此指南](https://pnpm.io/installation)安装 `pnpm`
3. 运行 `pnpm install --frozen-lockfile` 安装依赖项
4. 运行 `pnpm build:OS`

- `pnpm dist:win` - Windows
- `pnpm dist:linux` - Linux (amd64)
- `pnpm dist:linux:deb-arm64` - Linux (arm64 for Debian)
- `pnpm dist:linux:rpm-arm64` - Linux (arm64 for Fedora)
- `pnpm dist:mac` - macOS (amd64)
- `pnpm dist:mac:arm64` - macOS (arm64)

使用 [electron-builder](https://github.com/electron-userland/electron-builder) 为 macOS、Linux 和 Windows 构建应用。

## 生产预览

```bash
pnpm start
```

## 测试

```bash
pnpm test
```

使用 [Playwright](https://playwright.dev/) 测试应用。

## 许可证

MIT © [th-ch](https://github.com/th-ch/youtube-music)

## 常见问题

### 为什么应用菜单没有显示？

如果 `隐藏菜单` 选项已开启 - 您可以使用 <kbd>alt</kbd> 键（或者如果使用应用内菜单插件，则使用 <kbd>\`</kbd> [反引号]）显示菜单
