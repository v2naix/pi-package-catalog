# pi-toolbox

用 GitHub 维护完整的 [Pi](https://pi.dev) Package 工具箱，同时让每台电脑独立选择实际加载的 extensions、skills、prompts 和 themes。

## 数据分层

- `toolbox.json`：共享 Package 清单，提交到 GitHub。
- `toolbox.local.json`：当前电脑的资源选择，已被 Git 忽略。
- `~/.pi/agent/settings.json`：脚本生成和维护其中的 `packages` 字段；其他 Pi 设置和非工具箱 Package 会被保留。

脚本也支持 `$PI_CODING_AGENT_DIR/settings.json`。

## 开始使用

```bash
git clone <your-github-repo-url> ~/repos/ai/pi-toolbox
cd ~/repos/ai/pi-toolbox
```

不需要安装依赖。

### 添加共享 Package

```bash
pnpm toolbox:add -- git:github.com/owner/repo
pnpm toolbox:add -- npm:@scope/package
```

新 Package 会加入 `toolbox.json`，并在当前电脑上默认禁用。提交共享清单：

```bash
git add toolbox.json
git commit -m "add package to toolbox"
git push
```

### 在另一台电脑同步

```bash
git pull
pnpm toolbox:apply
```

`apply` 会把新增 Package 以 `autoload: false` 写入 Pi 设置，不会覆盖该电脑原有的本地选择。

### 每台电脑独立选择资源

```bash
pnpm toolbox:config
```

该命令会依次：

1. 应用共享工具箱；
2. 打开 Pi 官方的 `pi config`；
3. 将选择保存到本机的 `toolbox.local.json`；
4. 保持共享的 `toolbox.json` 不变。

如果直接运行过 `pi config`，随后执行：

```bash
pnpm toolbox:capture
```

### 更新 Package

```bash
pi update --extensions
```

Package 仍然直接关联各自的 npm 或 Git 上游；工具箱只同步来源清单，不复制安装产物。

## 其他命令

```bash
pnpm toolbox:status
pnpm toolbox:remove -- git:github.com/owner/repo
pnpm check
```

- `status`：查看当前电脑上的启用状态。
- `remove`：从共享工具箱和当前 Pi 设置中移除来源。
- `check`：检查脚本语法。

也可以直接运行：

```bash
node scripts/toolbox.mjs --help
```
