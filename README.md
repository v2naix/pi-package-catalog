# pi-package-catalog

一个用于管理个人 [Pi](https://pi.dev) Package 清单的小工具。

它将“多台电脑共享哪些 Package”和“每台电脑实际启用哪些资源”分开管理：

- Package 来源提交到 Git；
- extensions、skills、prompts、themes 的启用选择保留在本机；
- Pi 的其他设置以及不受本工具管理的 Package 不会被覆盖。

## 为什么需要它

Pi 本身可以通过 `pi install` 和 `pi config` 管理 Package，但用户级配置通常都保存在同一个 `~/.pi/agent/settings.json` 中。

如果直接同步整个 settings 文件，不同电脑的模型、主题、路径和资源选择很容易互相覆盖。本工具只同步 Package 来源清单，并为每台电脑单独保存资源选择。

例如，Git 中共享：

```json
{
  "version": 1,
  "packages": [
    "npm:@scope/package",
    "git:github.com/owner/repo"
  ]
}
```

但电脑 A 可以只启用其中的 `diff.ts`，电脑 B 可以启用整个 Package。

## 文件说明

| 文件 | 是否提交 Git | 用途 |
|---|---:|---|
| `catalog.json` | 是 | 多台电脑共享的 Package 来源清单 |
| `catalog.local.json` | 否 | 当前电脑对清单内 Package 的启用和过滤选择 |
| `catalog.local.example.json` | 是 | 本地选择文件示例 |
| `~/.pi/agent/settings.json` | 否 | Pi 的实际用户配置，本工具只维护其中相关的 `packages` 条目 |

如果设置了 `PI_CODING_AGENT_DIR`，本工具会改用：

```text
$PI_CODING_AGENT_DIR/settings.json
```

## 环境要求

需要：

- Node.js；
- pnpm；
- Pi CLI（使用 `config` 命令时需要）。

项目没有第三方运行时依赖，clone 后即可使用：

```bash
git clone <your-github-repo-url> ~/.pi/pi-package-catalog
cd ~/.pi/pi-package-catalog
pnpm catalog --help
```

## 快速开始

### 1. 添加 Package

支持 Pi 接受的 npm、Git 和本地 Package 来源：

```bash
pnpm catalog add npm:@scope/package
pnpm catalog add git:github.com/owner/repo
pnpm catalog add git:github.com/owner/repo@v1.0.0
pnpm catalog add /absolute/path/to/local/package
```

该命令会：

1. 将来源加入 `catalog.json`；
2. 更新当前电脑的 Pi settings；
3. 用显式的 exclude-all 过滤器将新 Package 默认设为禁用，避免突然加载其中所有资源，同时让 `pi config` 仍能列出这些资源。

然后提交共享清单：

```bash
git add catalog.json
git commit -m "add Pi package"
git push
```

> 本地绝对路径通常不能跨电脑复用。需要跨设备同步时，优先使用 npm 或 Git 来源。

### 2. 选择要启用的资源

运行：

```bash
pnpm catalog config
```

它会依次执行：

1. `apply`：把共享清单和当前电脑的选择合并到 Pi settings；
2. 打开官方的 `pi config`；
3. `capture`：把新的选择保存到 `catalog.local.json`。

在 `pi config` 中可以按 Package 分别启用或禁用：

- extensions；
- skills；
- prompt templates；
- themes。

`catalog.local.json` 已被 `.gitignore` 忽略，因此选择只影响当前电脑。

### 3. 在另一台电脑同步

```bash
cd ~/.pi/pi-package-catalog
git pull
pnpm catalog apply
```

`apply` 会把新来源加入该电脑的 Pi settings。第一次出现的 Package 默认禁用；如需调整，继续运行：

```bash
pnpm catalog config
```

Pi 会根据 settings 在启动时解析和安装缺失的 npm/Git Package。

## 命令参考

### `pnpm catalog add <source>`

将 Package 来源加入共享清单：

```bash
pnpm catalog add git:github.com/owner/repo
```

重复添加同一个字符串不会产生重复条目。

### `pnpm catalog remove <source>`

从共享清单、当前电脑的本地选择和 Pi settings 中移除由本工具管理的来源：

```bash
pnpm catalog remove git:github.com/owner/repo
```

该操作不会删除其他不受本工具管理的 Package。

### `pnpm catalog apply`

将配置合并到 Pi settings：

```bash
pnpm catalog apply
```

合并规则：

- `catalog.json` 决定应当存在的受管 Package；
- `catalog.local.json` 优先提供当前电脑的选择；
- 本地选择不存在时，尽量保留 settings 中已有的选择；
- 全新 Package 为四类资源写入 `!**/*`（全部排除），使其默认禁用但仍可在 `pi config` 中选择；
- 旧版本生成的、没有资源规则的 `{ "autoload": false }` 条目会自动迁移为上述过滤器；
- settings 中不受本工具管理的 Package 原样保留；
- 已从共享清单删除的受管 Package 会从 settings 中移除。

### `pnpm catalog config`

推荐的日常配置入口：

```bash
pnpm catalog config
```

等价于：

```text
apply → pi config → capture
```

### `pnpm catalog capture`

从当前 Pi settings 中读取清单内 Package 的选择，并写入 `catalog.local.json`：

```bash
pnpm catalog capture
```

通常不需要单独运行。只有直接执行过官方命令：

```bash
pi config
```

之后，才需要手动执行 `capture` 保存选择。

`capture` 只处理 `catalog.json` 中登记的 Package，不会接管其他 Package，也不会捕获主题、模型等非 Package 设置。

### `pnpm catalog status`

显示当前电脑上清单内每个 Package 的启用状态：

```bash
pnpm catalog status
```

示例：

```text
enabled   npm:@scope/package
disabled  git:github.com/owner/repo
```

### `pnpm catalog --help`

显示命令帮助和当前使用的配置文件路径：

```bash
pnpm catalog --help
```

## 常用工作流

### 添加一个 Package 并在当前电脑启用部分资源

```bash
pnpm catalog add git:github.com/owner/repo
pnpm catalog config
git add catalog.json
git commit -m "add owner/repo"
git push
```

### 拉取他人在共享清单中添加的 Package

```bash
git pull
pnpm catalog apply
pnpm catalog config
```

### 直接使用过 `pi config` 后保存选择

```bash
pi config
pnpm catalog capture
```

### 更新已安装的 Package

Package 仍然直接关联各自的 npm 或 Git 上游。本工具不复制安装产物，也不代替 Pi 的更新机制：

```bash
pi update --extensions
```

对于带版本号的 npm 来源或带 ref 的 Git 来源，Pi 会遵循相应的固定版本规则。

## 与 Pi Package 的关系

本工具不是新的 Package 格式，也不负责执行 extension。它只是管理 Pi settings 中的一组 `packages` 来源。

实际资源仍由 Pi Package 提供。一个 Package 可以同时包含多个：

```text
extensions/
skills/
prompts/
themes/
```

因此，零散的个人 extensions 可以集中放入一个普通的聚合 Pi Package（例如 `pi-extras`），然后将这个 Package 作为一个 Git 或本地来源加入清单，无需为每个 TS 文件创建仓库。

## 当前边界

当前版本只管理：

```json
{
  "packages": []
}
```

它不会管理 settings 顶层的：

- `extensions`；
- `skills`；
- `prompts`；
- `themes`；
- 模型、Provider、主题等其他 Pi 设置。

如果要管理单个 TS 文件，推荐先将它放进一个聚合 Pi Package，再由本工具管理该 Package。

## 安全提示

Pi extensions 会以当前用户权限执行任意代码。添加第三方 Package 或网上找到的 TS 文件前，应当：

- 阅读源码；
- 检查许可证；
- 优先固定 npm 版本、Git tag 或 commit；
- 避免未经审核地跟随远程仓库最新分支。

## 其他调用方式

命令也可以通过安装后生成的 `pi-package-catalog` 可执行文件运行。
