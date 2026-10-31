# Libitum music

中文 Linux 网易云音乐桌面客户端，使用 Electron、React、TypeScript 和 mpv。当前目标为 **Ubuntu 24.04 x86_64**，支持 Wayland 和 X11，不需要部署公共音乐代理。

> 0.2.0 当前等待真实账号收藏验收。客户端会话和收藏链路已经调整，自动测试与真实账号验证分别记录，不能把模拟测试当成收藏同步已成功。发布状态和结果见 [更新日志](CHANGELOG.md) 与 [验证记录](VALIDATION.md)。

## 下载与安装

打开 [GitHub Releases](https://github.com/kuranshi/Libitum-Music/releases)，展开对应版本的 **Assets**。Ubuntu 用户推荐下载 `libitum-music-0.2.0-amd64.deb`；`Source code.zip` 是源码，不是安装程序。未正式发布的构建以本地安装包或明确标记的预发布附件为准。

### Ubuntu：推荐安装 .deb

在安装包所在文件夹打开终端，执行：

```bash
sudo apt update
sudo apt install ./libitum-music-0.2.0-amd64.deb
```

安装器会处理 mpv、ffmpeg、pulseaudio-utils 和桌面运行库依赖。然后从应用菜单启动 **Libitum music**，或运行：

```bash
cloud-music-player
```

如果安装包在其他位置，请把命令中的文件名替换为完整路径，并为含空格的路径加引号。提示找不到文件时，先确认当前目录及实际文件名。

从旧版升级时先通过“退出应用”完全退出，再执行同一条 `sudo apt install ./…deb` 命令。内部 Debian 包名仍是 `cloud-music-player`，因此会升级现有安装，并保留本机账号、设置、队列和下载，不会生成第二个旧品牌入口。

### AppImage

下载 `libitum-music-0.2.0-x86_64.AppImage`。Ubuntu 24.04 先安装外部组件：

```bash
sudo apt update
sudo apt install mpv ffmpeg pulseaudio-utils libsecret-1-0 libfuse2t64
chmod +x ./libitum-music-0.2.0-x86_64.AppImage
./libitum-music-0.2.0-x86_64.AppImage
```

AppImage 不自带系统 mpv、FFmpeg 或 PulseAudio 工具。FUSE、用户命名空间及 Chromium sandbox 受发行版配置影响；Ubuntu 上遇到这类启动错误，优先使用 `.deb`。不要以关闭浏览器沙箱作为常规安装方法。

下载 `SHA256SUMS` 并与安装包放在同一目录后，可核对内容：

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

### 卸载

```bash
sudo apt remove cloud-music-player
```

AppImage 用户退出程序后删除对应 AppImage 即可。卸载不会自动清除用户目录中的账号数据、壁纸、PEQ 或音乐下载。

## 功能与操作

- 搜索歌曲、歌手、专辑和歌单，查看详情、播放全部、加入队列、喜欢及本地下载。
- 播放详情和播放栏里的歌手名可点击进入歌手主页，查看热门歌曲及分页专辑列表；专辑可继续打开详情。
- 每日推荐、推荐歌单、排行榜、新专辑、私人 FM 和推荐模式漫游。
- 扫码及本人 Cookie 登录；会话由后台处理，有安全系统密钥环时加密保存，否则仅本次运行有效。
- 标准、较高、极高、无损、Hi-Res；界面区分所选与实际音质，显示试听状态。账号权限和版权决定可用内容。
- 点击底部封面或歌名打开播放详情。评论默认收起，点击播放详情右上角“评论”后从右侧滑入，与封面各占半屏。评论独立滚动，可用关闭按钮或 Esc 收起；在“设置 → 外观与播放页”关闭“启用歌曲评论”后不再请求评论。
- “加入歌单”可把当前歌曲或歌曲行加入本人创建的可编辑歌单。“我喜欢的音乐”继续使用爱心按钮。
- 输出设备在“设置 → 播放与输出”选择。常用列表只展示优先后端，其他路径在“显示高级音频后端”中；不同 HDMI 输出继续区分。
- 指定设备断开时暂停并提示重新选择，切换设备保留当前歌曲与进度。
- 进度条以 mpv 实际时间为准，拖动取消或窗口失焦后恢复实时显示；主窗口和悬浮卡片使用相同交互，状态通知停更时回查实际时间。
- 下载中心支持并发、取消、重试及本地播放。下载使用服务端返回的真实格式，不保存试听片段为完整歌曲；音质不匹配时要求重新选择。

### 收藏失败与状态确认

专辑和歌单收藏会读取当前状态、提交一次操作并回查结果。明确拒绝保留原状态；网络中断而结果未知时显示“状态待确认”，点击该按钮只刷新状态，不自动再次写入。

“设置 → 账号与隐私 → 查看诊断”显示本次运行的接口、错误码和认证字段是否存在，不显示字段值。登录失效或 CSRF 字段缺失时重新扫码；403 访问拒绝、频率限制和明确风控分别提示。手机端官方限制仍需按官方提示处理，客户端不能保证解除。

重新登录或导入 Cookie 请在应用内进行，不要把 Cookie、密码或令牌发到聊天、Issues 或源代码中。

### 十段 PEQ

点击播放栏的均衡器按钮，或进入“设置 → 音效”。编辑十段频率、增益、Q 和类型，支持峰值、低架、高架、单段旁路及前级。点击“应用 PEQ”生效，不重新开始歌曲；关闭总开关并应用可旁路整个均衡器。

支持 APO／AutoEQ 格式和每行“频率、增益、Q”三列。以下为合成示例：

```text
Preamp: -4 dB
Filter 1: ON PK Fc 1000 Hz Gain -3 dB Q 1
Filter 2: ON LSC Fc 105 Hz Gain 2 dB Q 0.71
```

```text
1000 -3 1
105 2 0.71
```

导入先预览，确认后应用；最多十段，不支持的滤波器或越界值会明确报错。频率 20–20000 Hz、增益 ±24 dB、Q 0.1–20、前级 -30–12 dB。超出当前歌曲采样率有效范围的频段暂不应用并提示。PEQ 仅影响播放，不修改下载文件。

### 频谱与壁纸

在播放详情或“设置 → 外观与播放页”开启真实频谱，可选择单色、渐变及颜色。需要 PulseAudio 或 PipeWire 的 PulseAudio 兼容服务，以及 `pulseaudio-utils`。只监听本应用的 mpv 播放流，不录制麦克风、不采集整机混音、不保存 PCM。ALSA 直通或无法定位本应用播放流时显示不可用原因，音乐继续播放。

原生 PipeWire 输出还需要 `pw-dump`（Ubuntu 的 `pipewire-bin`），用于确认播放节点属于本应用。工具已安装但旧候选构建仍提示无法监听时，可先在“播放与输出 → 显示高级音频后端”选择同一设备的 PulseAudio 路径，重新开启频谱；更新修正版后可继续使用原生 PipeWire。相同版本候选包替换安装时使用 `sudo apt install --reinstall ./libitum-music-0.2.0-amd64.deb`。

壁纸支持 JPEG、PNG、WebP、GIF、BMP、AVIF 和 MP4、WebM、MOV、MKV、AVI。视频导入需要 FFmpeg，会转换为不高于 1080p / 30fps 的静音 MP4，可取消，失败保留原背景。图片最大 64 MB，视频最大 4 GB。

可选择仅播放详情或整个应用使用壁纸，调整亮度、遮罩，并开启播放时旋转封面。壁纸沿用当前浅色、深色或系统主题；评论、设置和导航使用相应主题的清晰面板。视频始终静音循环，页面隐藏时暂停；封面旋转随音乐暂停。

“外观与播放页”和播放详情右上角“视觉”均提供独立的壁纸模糊（0–40 px）与面板模糊（0–30 px）滑杆，显示当前数值。拖动即时预览，松开保存；面板模糊只影响背景，文字保持清晰。封面和壁纸固定，歌词与评论分别滚动。

全局壁纸连续延伸到左侧导航。可选择开启“壁纸文字自动配色”（默认关闭），依据主色与明暗分布选择文字和强调色，并保留必要遮罩；分析仅在本机内存中完成，视频定时抽样且隐藏时停止。关闭后使用主题或自定义文字颜色。

“自定义配色与字体”支持背景颜色、文字颜色及系统已安装字体，点击“应用外观”保存；背景色在未使用壁纸时可见，“跟随主题”可清除自定义颜色。设置、评论和弹窗继续使用主题面板，保持可读性。

### 悬浮卡片

在“设置 → 悬浮卡片”开启。卡片显示歌名、歌手、封面、进度，以及上下首、播放／暂停、喜欢和音量控制。

开启后关闭主窗口只隐藏主界面，音乐与下载继续。卡片“返回主窗口”恢复界面；关闭卡片会停用卡片并恢复主窗口；电源按钮明确退出整个应用。

保留原生 Wayland。置顶和程序恢复窗口位置受桌面协议限制；X11 会保存并校验位置。需要兼容窗口行为时可在完全退出后手动使用 `cloud-music-player --ozone-platform=x11`，应用不会自动切换。

## 本机数据与仓库隐私

状态位于 `~/.config/cloud-music-player/`，下载默认位于系统音乐目录下的“Libitum music 下载”，具体位置以设置为准。会话仅在有效密钥环下使用 Electron safeStorage 加密；不把 `basic_text` 当作安全存储。退出账号清除会话、队列和账号下载记录，已经下载的音频文件保留。

壁纸、导入的 PEQ、播放队列、会话、历史及下载均属于本机数据。仓库根目录采用允许列表，资源目录只允许项目图标；依赖、构建、安装包、日志、截图和个人媒体继续忽略。不要强制添加私人文件。Release 只附明确生成的安装包及校验文件。

## 开发、验证与打包

需要 Node.js 24、npm、mpv、ffmpeg、pulseaudio-utils；打包 `.deb` 需要 `dpkg-deb` 和 `du`。

```bash
npm ci
# 如果 Electron 安装脚本尚未运行：
node node_modules/electron/install.js
npm run dev
```

```bash
npm run typecheck
npm test
npm run test:media
npm run test:e2e
npm run test:network
npm run test:audio
npm run package
npm run audit:release -- --packaged
```

单元及 Electron 流程使用明确启用的合成测试数据与临时目录。正式安装包无法通过测试环境变量启用模拟账号。公开网络检查不使用真实账号；音频集成检查使用暂停的静音文件及临时虚拟输出，不录制麦克风，结束后清理。

`npm run package` 生成 AppImage 和 `.deb`，产物位于 `release/`。`node scripts/smoke-packaged.cjs --network` 使用隔离目录检查正式包启动及真实公开首页。`npm run audit:release -- --packaged` 检查发布文件允许列表、敏感内容及打包根目录。

真实账号验收仍需本人在应用内完成：扫码后收藏及取消一个歌单、一个专辑，在官方客户端核对，并重启检查状态。不要把凭证加入自动化脚本。详细验证边界见 [VALIDATION.md](VALIDATION.md)。

网易云接口锁定 `@neteasecloudmusicapienhanced/api@4.41.1`，不启用跨平台替代音源。首版范围之外仍包括音乐云盘、手机号验证码、多账号并行和其他音乐平台；不提供应用内自动更新。

## 许可证

应用图标使用透明圆角 PNG，Ubuntu 菜单和 Dock 不再显示外部白色方框。

MIT；第三方组件说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。mpv、FFmpeg、PulseAudio 工具通过系统单独安装，遵循各自许可证。
