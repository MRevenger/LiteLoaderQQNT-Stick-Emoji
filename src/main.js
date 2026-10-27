const {ipcMain} = require("electron");
const fs = require("fs");
const path = require("path");
const {Config} = require("./Config");
const {pluginLog} = require("./utils/log");

const pluginPath = path.join(LiteLoader.plugins.stick_emoji.path.plugin);//插件目录
const configPath = path.join(pluginPath, "config.json");
const config = Config.config
let selfUid = null

// 9.9.28 取不到 pinia 的 curMsgs，右键贴表情靠这份索引定位会话信息。
// 由收到 onMsgInfoListUpdate 的渲染进程主动推上来（各窗口只收到自己那份事件）。
const msgIndex = new Map()
const MSG_INDEX_LIMIT = 2000

function rememberMsgList(msgList) {
    if (!Array.isArray(msgList)) return
    for (const msg of msgList) {
        if (!msg?.msgId) continue
        msgIndex.delete(String(msg.msgId))
        msgIndex.set(String(msg.msgId), {
            chatType: msg.chatType,
            peerUid: msg.peerUid,
            msgSeq: msg.msgSeq
        })
        if (msgIndex.size > MSG_INDEX_LIMIT) msgIndex.delete(msgIndex.keys().next().value)
    }
}

onLoad()

// LiteLoader 在 session 初始化完成时调用；9.9.x 的标识是 uid（u_xxx）而不是数字 QQ 号
module.exports.onLogin = uid => { selfUid = uid == null ? null : String(uid) }

module.exports.onBrowserWindowCreated = window => {
    // window 为 Electron 的 BrowserWindow

    // 旧宿主用 ___!boot 同步取 webContentsId；9.9.x 已改用 ipcMain.handle 提供，这里保留兼容
    window.webContents.on('ipc-message-sync', (event, channel) => {
        if (channel === '___!boot') {
            event.returnValue = {
                enabled: true,
                webContentsId: window.webContents.id.toString(),
            };
        }
    });
}

function onLoad() {
    pluginLog("启动！")

    ipcMain.handle("LiteLoader.stick_emoji.getSelfUid", () => selfUid)
    ipcMain.on("LiteLoader.stick_emoji.rememberMsgs", (event, list) => rememberMsgList(list))
    ipcMain.handle("LiteLoader.stick_emoji.getMsgInfo", (event, msgId) => {
        const info = msgIndex.get(String(msgId)) ?? null
        return {found: info != null, info, size: msgIndex.size}
    })
    ipcMain.handle("LiteLoader.stick_emoji.getWebContentsId", event => event.sender.id.toString())
    ipcMain.handle("LiteLoader.stick_emoji.getMenuHTML", () => fs.readFileSync(path.join(config.pluginPath, 'src/pluginMenu.html'), 'utf-8'))
    ipcMain.handle("LiteLoader.stick_emoji.getConfig", () => Config.getConfig())
    ipcMain.handle("LiteLoader.stick_emoji.debugLog", (event, message) => {
        try { fs.appendFileSync(path.join(config.pluginPath, "debug.log"), "[" + new Date().toISOString() + "] " + message + "\n") } catch { }
    })
    ipcMain.handle("LiteLoader.stick_emoji.setConfig", async (event, newConfig) => Config.setConfig(newConfig))//更新配置，并且返回新的配置

    //设置配置
    Config.initConfig(pluginPath, configPath)
}
